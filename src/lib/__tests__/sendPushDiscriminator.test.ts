/**
 * `send-push` has several ways to answer `sent: 0`, and until 2026-09-13 most
 * of them were byte-identical on the wire.
 *
 * MEASURED on production `client_error_reports`, surface `send-push`:
 *
 *   >= 2026-09-07   {"kind":"message","sent":0,"failed":0,"unaddressed":1}   x12
 *   <= 2026-09-05   {"kind":"message","sent":0,"failed":0}                   (the rest)
 *
 * Every report written since the witness was fixed carries a POSITIVE
 * `unaddressed`, which is the registration branch: those recipients had no
 * device_tokens row, so nothing was dispatched and FCM was never asked. That
 * disproves the standing hypothesis that the Firebase service account had
 * stopped minting a token — a transport fault would have addressed somebody.
 *
 * The states now pinned apart: a failed database read (ours), an empty
 * conversation (nobody to tell), nobody registered (theirs), no access token
 * (ours), and a per-address provider refusal (the provider's, by code).
 *
 * Read from source rather than executed: the function is Deno, and importing
 * it here would drag `Deno.env` into the browser program — the boundary
 * `geminiReplyModel.test.ts` documents. Comments are stripped first, because
 * the comments beside each branch quote every field under test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/send-push/index.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("our own faults are never reported as the recipient's", () => {
  it("a failed member lookup is a 500, not an empty conversation", () => {
    expect(CODE).toContain("error: othersErr");
    expect(CODE).toContain('error: "recipient lookup failed"');
    // The shape that made a database error indistinguishable from success.
    expect(CODE).not.toMatch(/othersErr[\s\S]{0,200}noRecipients:\s*true/);
  });

  it("a failed token lookup is a 500, not `unaddressed`", () => {
    expect(CODE).toContain("error: tokensErr");
    expect(CODE).toContain('error: "address lookup failed"');
  });
});

describe("the ways send-push answers sent:0", () => {
  it("an empty conversation says so, instead of returning a bare zero", () => {
    expect(CODE).not.toMatch(/JSON\.stringify\(\{\s*sent:\s*0,\s*failed:\s*0\s*\}\)/);
    expect(CODE).toContain("noRecipients: true");
  });

  it("the registration branch reports how many had no address, with a reason", () => {
    expect(CODE).toContain("unaddressed: recipientIds.length");
    expect(CODE).toContain("reasons: { no_device_token: recipientIds.length }");
  });

  it("a token that was needed and never minted counts every address it lost", () => {
    // Not a bare bump: the early 500 abandons the whole FCM batch, so the
    // count must be the batch size or the reason table under-reports.
    expect(CODE).toContain('bumpReason("no_access_token", fcmTokens.length)');
  });
});

describe("the reason table is a closed set", () => {
  it("declares its codes and folds anything else into `other`", () => {
    expect(CODE).toContain("REASON_CODES");
    expect(CODE).toMatch(/REASON_CODES\.has\([\s\S]{0,80}"other"/);
  });

  it("turns an HTTP status into a bounded code rather than a free string", () => {
    expect(CODE).toContain("function httpCode(");
    expect(CODE).toContain('bumpReason(httpCode(');
  });

  it("counts a provider refusal by its structured code, never its prose", () => {
    expect(CODE).toContain("if (fcmErr?.errorCode) reasonCode = fcmErr.errorCode;");
    // A token, an endpoint or a raw error body must never be what gets
    // counted — that is the whole reason this is a code table.
    expect(CODE).not.toMatch(/bumpReason\(\s*token/);
    expect(CODE).not.toMatch(/bumpReason\(\s*errText/);
    expect(CODE).not.toMatch(/bumpReason\(\s*r\.error/);
    expect(CODE).not.toMatch(/bumpReason\(\s*sub\./);
  });

  it("separates a timeout from an unexplained throw and nothing more", () => {
    expect(CODE).toContain('"timeout" : "throw"');
  });
});

describe("what the response claims about delivery", () => {
  it("separates provider acceptance from handset delivery", () => {
    // `sent` has been read as "it arrived" for months. FCM returning 200 only
    // means Google took custody.
    expect(CODE).toContain("acceptedByProvider:");
    expect(CODE).toContain("deliveredToHandset: null");
  });

  it("keeps `sent` rather than renaming it out from under its readers", () => {
    expect(CODE).toContain("sent: sent + webSent");
  });

  it("reports the reason counts on the main response", () => {
    expect(CODE).toMatch(/\n\s*reasons,/);
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
