/**
 * EVERY PHONE PATH MUST DERIVE THE SAME ACCOUNT FROM THE SAME NUMBER.
 *
 * If two sign-in routes disagree about the synthetic email, the same human
 * gets two Supabase accounts — two wallets, two histories — and the failure is
 * SILENT: a returning user simply looks new. As of 2026-09-05 the derivation
 * was copy-pasted into `verify-otp` and `msg91-verify-session`, and
 * `normalizeIndian` into `send-otp` as well.
 *
 * `_shared/phoneIdentity.ts` is now the authority, and the new
 * `firebase-phone-session` uses it. The three existing copies are deliberately
 * NOT refactored — rewriting three live auth paths to prove a point is a worse
 * risk than the drift it prevents — so this test holds them to the shared
 * definition instead. If any copy changes, this fails and someone has to
 * decide deliberately rather than discover it from a support ticket.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeIndian, syntheticEmail } from "../../../supabase/functions/_shared/phoneIdentity";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const COPIES = [
  "supabase/functions/verify-otp/index.ts",
  "supabase/functions/msg91-verify-session/index.ts",
];
const NORMALIZE_COPIES = [...COPIES, "supabase/functions/send-otp/index.ts"];

describe("the shared derivation behaves as every copy expects", () => {
  it("keys on the bare ten digits, whatever the caller sent", () => {
    for (const raw of [
      "9000000001",
      "+919000000001",
      "919000000001",
      "0919000000001",
      "+91 90000 00001",
    ]) {
      expect(normalizeIndian(raw), raw).toBe("9000000001");
    }
  });

  it("refuses anything that is not an Indian mobile", () => {
    for (const raw of ["", "12345", "5000000001", "90000000012", "+12025550143", "abcdefghij"]) {
      expect(normalizeIndian(raw), raw).toBeNull();
    }
  });

  it("produces the address the accounts are already keyed to", () => {
    // Frozen: changing this orphans every existing phone account.
    expect(syntheticEmail("9000000001")).toBe("phone_9000000001@oniq.phone");
  });
});

describe("no copy has drifted", () => {
  it.each(COPIES)("%s derives the same synthetic email", (p) => {
    const src = read(p);
    const m = src.match(/const syntheticEmail = \(phone: string\) =>\s*(`[^`]+`)/);
    expect(m, `no syntheticEmail found in ${p}`).not.toBeNull();
    // Evaluate the copy's template against the shared one, rather than
    // string-matching the source — a reformat should not fail this, a changed
    // domain must.
    const copy = (phone: string) => eval("((phone) => " + m![1] + ")")(phone);
    expect(copy("9000000001")).toBe(syntheticEmail("9000000001"));
  });

  it.each(NORMALIZE_COPIES)("%s normalises identically", (p) => {
    const src = read(p);
    const m = src.match(/function normalizeIndian\(raw: string\): string \| null \{[\s\S]*?\n\}/);
    expect(m, `no normalizeIndian found in ${p}`).not.toBeNull();
    const copy = eval(`(${m![0].replace(/: string \| null|: string/g, "")})`) as (
      r: string,
    ) => string | null;
    for (const raw of [
      "9000000001",
      "+919000000001",
      "919000000001",
      "5000000001",
      "",
      "+12025550143",
    ]) {
      expect(copy(raw), `${p} on ${raw}`).toBe(normalizeIndian(raw));
    }
  });
});
