/**
 * A DEVICE THAT CANNOT REGISTER MUST SAY SO SOMEWHERE.
 *
 * Measured on production 2026-09-07, from the owner's own error inbox: 40
 * `send-push` "accepted but sent 0" reports across 6 senders, and on EVERY one
 * of them the recipient had zero rows in `device_tokens`. So the push that
 * "sent 0" was not a transport failure — there was no address to send to.
 *
 * `initPush()` runs on every authenticated mount, so those accounts had the
 * code run for them and still ended up unreachable. Two of the three ways that
 * happens were invisible: `upsertToken` swallowed an RLS conflict into a
 * `console.warn` (the documented case is a token row still owned by the
 * PREVIOUS account on a shared device), and a throw went into a bare `catch`
 * with a comment saying push is best-effort. Neither reaches a phone's
 * console, so the outcome was an account with no push address for the life of
 * the install and no record anywhere that it had happened.
 *
 * This asserts the reporting, not the registering — the fix is that the
 * failure becomes visible, which is what turns "notifications don't arrive"
 * into a question with an answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const SRC = readFileSync(join(process.cwd(), "src/lib/push.ts"), "utf8");
/*
 * stripComments, NOT executableText, and the difference bit on the first run.
 * Comments here quote the very calls this file reasons about — the prose above
 * `upsertToken` names `reportClientError` and `device_tokens` — so comments
 * must go. But `executableText` also BLANKS string contents, which turns
 * `"push-register"` into `""` and made four of these assertions fail against
 * source that was already correct. A guard has to strip exactly what it is
 * confusing itself with, and no more.
 */
const CODE = stripComments(SRC);

describe("registration failures are reported, not swallowed", () => {
  it("reads a file that plausibly is push.ts", () => {
    expect(CODE).toContain("device_tokens");
    expect(CODE).toContain("initPush");
  });

  it("an upsert error is reported", () => {
    expect(CODE).toMatch(/reportClientError\(\s*"push-register"/);
  });

  it("upsert errors, throws, and FCM registration errors are covered", () => {
    const reports = CODE.match(/reportClientError\(\s*"push-register"/g) ?? [];
    expect(reports.length, "a native registration failure is still silent").toBe(3);
  });

  it("no bare catch is left swallowing the registration path", () => {
    // `catch {` with nothing bound is the shape that hid this. The remaining
    // ones in the file are on the SEND path, which already reports.
    const upsert = CODE.slice(CODE.indexOf("async function upsertToken"));
    const body = upsert.slice(0, upsert.indexOf("export async function initPush"));
    expect(body).not.toMatch(/catch\s*\{/);
  });

  it("THE TOKEN IS NEVER REPORTED — it is the delivery address", () => {
    // A report names the platform and the provider's reason. Putting the token
    // in would publish every device's push address into a table an admin
    // screen renders. `reason` and `platform` are what a fix actually needs.
    // Bound the window to the CALL, not to a character count: an argument
    // list runs to its own `});`, and a fixed slice spills into whatever
    // follows — which is how this assertion first failed against correct code.
    const at = CODE.search(/reportClientError\(\s*"push-register",\s*"device token upsert failed"/);
    expect(at, "the upsert report moved or was renamed").toBeGreaterThan(-1);
    /*
     * THE DETAIL OBJECT, NOT THE WHOLE CALL — and the first version of this
     * got it wrong in the same way the file it guards used to. Banning /token/
     * across the call matched the MESSAGE, `"device token upsert failed"`,
     * which is a name for the problem rather than a leak of anybody's address.
     * A rule against CARRYING a value is not broken by NAMING it, which is
     * exactly what src/test/sourceText.ts exists to say. So the window is the
     * third argument alone: what actually travels to the server.
     */
    const detail = CODE.slice(CODE.indexOf("{", at), CODE.indexOf("});", at) + 1);
    expect(detail).toContain("platform");
    expect(detail).toContain("reason");
    expect(detail, "the push address must never be reported").not.toMatch(/\btoken\b/i);
  });
});
