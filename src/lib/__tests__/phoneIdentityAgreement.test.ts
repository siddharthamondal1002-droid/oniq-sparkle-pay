/**
 * EVERY PHONE PATH MUST DERIVE THE SAME ACCOUNT FROM THE SAME NUMBER.
 *
 * If two sign-in routes disagree about the synthetic email, the same human
 * gets two Supabase accounts — two wallets, two histories — and the failure is
 * SILENT: a returning user simply looks new.
 *
 * When this guard was written on 2026-09-05 the derivation was copy-pasted
 * into three live edge functions, and the test held those copies to
 * `_shared/phoneIdentity.ts`. The MSG91 path has since been removed (owner
 * directive 2026-09-06 — it never delivered a code and was disabled behind
 * `OTP_LOGIN_ENABLED = false`), so the copies are gone and the guard inverts:
 * instead of checking that copies agree, it now checks that NO copy comes
 * back. One definition, imported.
 *
 * THE DERIVATION IS FROZEN, and that outlives MSG91. Any account created by
 * the old OTP path is keyed to `phone_<digits>@oniq.phone`, and the Firebase
 * path deliberately derives the same address from the same number — so a
 * person who signed in before signs in as THEMSELVES, not as a new user.
 * Changing this string orphans them.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeIndian, syntheticEmail } from "../../../supabase/functions/_shared/phoneIdentity";

const FN_DIR = join(process.cwd(), "supabase/functions");

describe("the shared derivation", () => {
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

  it("produces the address existing phone accounts are already keyed to", () => {
    // FROZEN. Changing it orphans every account the old OTP path created.
    expect(syntheticEmail("9000000001")).toBe("phone_9000000001@oniq.phone");
  });
});

describe("nothing re-implements it privately", () => {
  /** Every edge-function source, including _shared. */
  const sources = (): { rel: string; src: string }[] => {
    const out: { rel: string; src: string }[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${d.name}` : d.name;
        if (d.isDirectory()) walk(join(dir, d.name), rel);
        else if (d.name.endsWith(".ts"))
          out.push({ rel, src: readFileSync(join(dir, d.name), "utf8") });
      }
    };
    walk(FN_DIR, "");
    return out;
  };

  it("only _shared/phoneIdentity.ts defines the synthetic email", () => {
    const definers = sources()
      .filter((f) => /const syntheticEmail\s*=|function syntheticEmail\s*\(/.test(f.src))
      .map((f) => f.rel);
    expect(definers).toEqual(["_shared/phoneIdentity.ts"]);
  });

  it("only _shared/phoneIdentity.ts defines the phone normaliser", () => {
    const definers = sources()
      .filter((f) => /function normalizeIndian\s*\(/.test(f.src))
      .map((f) => f.rel);
    expect(definers).toEqual(["_shared/phoneIdentity.ts"]);
  });

  it("the address domain is not hard-coded anywhere else", () => {
    // A second `@oniq.phone` literal is the same bug wearing a different hat.
    const offenders = sources()
      .filter((f) => f.rel !== "_shared/phoneIdentity.ts" && f.src.includes("@oniq.phone"))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
