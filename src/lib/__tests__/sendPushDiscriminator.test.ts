/**
 * `send-push` has THREE ways to answer `sent: 0`, and until 2026-09-13 two of
 * them were byte-identical on the wire.
 *
 * MEASURED on production `client_error_reports`, surface `send-push`:
 *
 *   >= 2026-09-07   {"kind":"message","sent":0,"failed":0,"unaddressed":1}   x12
 *   <= 2026-09-05   {"kind":"message","sent":0,"failed":0}                   (the rest)
 *
 * Every report written since the witness was fixed carries a POSITIVE
 * `unaddressed`, which is the registration branch: those recipients had no
 * device_tokens row, so nothing was ever dispatched and FCM was never asked.
 * That disproves the standing hypothesis that the Firebase service account had
 * stopped minting an access token — a transport fault would have addressed
 * somebody and reported `unaddressed: null`.
 *
 * The remaining hole was the THIRD state: a conversation with no other members
 * returned a bare `{sent:0,failed:0}`, indistinguishable from a row written
 * before `unaddressed` existed. These pin the three states apart, and pin that
 * the empty-conversation case is no longer filed as a fault at all.
 *
 * Read from source rather than executed: the function is Deno, and importing
 * it here would drag `Deno.env` into the browser program — the same boundary
 * `geminiReplyModel.test.ts` documents. Comments are stripped first, because
 * the comments beside each branch quote every field under test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/send-push/index.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the three ways send-push answers sent:0", () => {
  it("an empty conversation says so, instead of returning a bare zero", () => {
    // The exact shape that made three states read as two.
    expect(CODE).not.toMatch(/JSON\.stringify\(\{\s*sent:\s*0,\s*failed:\s*0\s*\}\)/);
    expect(CODE).toContain("noRecipients: true");
  });

  it("the registration branch still reports how many had no address", () => {
    expect(CODE).toContain("unaddressed: recipientIds.length");
  });

  it("a token that was needed and never minted is its own reason, not silence", () => {
    expect(CODE).toContain('bumpReason("no_access_token")');
  });
});

describe("what the response claims about delivery", () => {
  it("separates provider acceptance from handset delivery", () => {
    // `sent` has been read as "it arrived" for months. FCM returning 200 only
    // means Google took custody.
    expect(CODE).toContain("acceptedByProvider:");
    expect(CODE).toContain("deliveredToHandset: null");
  });

  it("reports reason counts, and reason CODES only", () => {
    expect(CODE).toMatch(/\n\s*reasons,/);
    // A code is an FCM enum or a status number. A token or endpoint must never
    // be what gets counted — that is the whole reason this is a code table and
    // not a message list.
    expect(CODE).not.toMatch(/bumpReason\(\s*token/);
    expect(CODE).not.toMatch(/bumpReason\(\s*errText/);
  });

  it("counts a provider refusal by its structured code, not by its prose", () => {
    expect(CODE).toContain("if (fcmErr?.errorCode) reasonCode = fcmErr.errorCode;");
    expect(CODE).toContain("bumpReason(reasonCode)");
  });
});

describe("the client witness", () => {
  const CLIENT = readFileSync(join(process.cwd(), "src/lib/push.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("stops filing an empty conversation as a failure", () => {
    expect(CLIENT).toContain("d?.noRecipients");
  });

  it("carries the reason codes into the report", () => {
    expect(CLIENT).toContain("reasons: d?.reasons ?? null");
  });
});
