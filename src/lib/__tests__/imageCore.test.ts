/**
 * IMAGE — the pure half, and the measured facts pinned so they cannot drift.
 *
 * The model id is asserted here for the same reason llm.ts keeps a measured
 * 404 table: an id in this codebase is a claim about what a key can actually
 * call, and the only thing that established this one was a POST.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMAGE_MODEL,
  IMAGE_PROMPT_MAX,
  validateImagePrompt,
} from "../../../supabase/functions/_shared/imageCore";

const ROOT = process.cwd();
const FN = readFileSync(join(ROOT, "supabase/functions/image-generate/index.ts"), "utf8");

/** Comments describe code; they are not code. Same rule searchSpendCoverage uses. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the image prompt gate", () => {
  it("refuses an empty prompt with something a person can act on", () => {
    expect(validateImagePrompt("")).toBe("Describe the picture you want.");
  });

  it("accepts an ordinary sentence", () => {
    expect(validateImagePrompt("a red bicycle against a white wall")).toBeNull();
  });

  it("refuses a prompt past the ceiling, and names the ceiling", () => {
    const long = "a".repeat(IMAGE_PROMPT_MAX + 1);
    expect(validateImagePrompt(long)).toContain(String(IMAGE_PROMPT_MAX));
  });

  it("accepts a prompt exactly at the ceiling", () => {
    expect(validateImagePrompt("a".repeat(IMAGE_PROMPT_MAX))).toBeNull();
  });
});

describe("the model id is the one that was measured", () => {
  it("is the DIRECT id, unprefixed — the gateway's would 404 here", () => {
    // Owner directive 2026-09-04b moved this off the gateway. The two routes
    // carry genuinely different ids for the same model: `google/…` on the
    // gateway, bare on generativelanguage.googleapis.com. POST-verified
    // 2026-09-04 direct: 200, 3,329,851 bytes, one image/jpeg inlineData part.
    expect(IMAGE_MODEL).toBe("gemini-3.1-flash-image");
    expect(IMAGE_MODEL, "a gateway-prefixed id 404s on the direct endpoint").not.toContain("/");
  });

  it("does not redefine the id — it takes the registry's, with its evidence", () => {
    const core = readFileSync(
      join(ROOT, "supabase/functions/_shared/imageCore.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(core).toMatch(/import \{ IMAGE_DIRECT \}/);
    expect(core, "the id is written out a second time").not.toMatch(/"gemini-3/);
  });

  it("goes DIRECT to Google, on the metered key", () => {
    // WHOSE MONEY, asserted rather than trusted to a comment. Owner directive
    // 2026-09-04b: image spends the metered Google account, not Lovable
    // credits, and the gateway must not appear anywhere in this path.
    expect(CODE).toMatch(/GOOGLE_AI_API_KEY/);
    expect(CODE).toMatch(/googleGenerateContent/);
    expect(CODE, "image must not touch gateway credits").not.toMatch(/LOVABLE_API_KEY/);
    expect(CODE, "image must not go through the gateway").not.toMatch(/GATEWAY_IMAGE_URL/);
  });

  it("reads Google's native reply shape, not OpenAI's", () => {
    // Google returns an inlineData part on the first candidate. OpenAI's
    // data[0].b64_json does not exist here, and reading for it would find
    // nothing on every successful call.
    expect(CODE).toMatch(/firstInlinePart\(data, "image\/"\)/);
    expect(CODE).not.toMatch(/b64_json/);
    // usageMetadata is Google's field; `usage` was the gateway's.
    expect(CODE).toMatch(/googleUsage/);
  });

  it("puts an attached reference BEFORE the text, which is what was measured", () => {
    // Measured 2026-09-04: inlineData first, then the instruction, returned an
    // edited image (200, 2,405,500 bytes). The model reads parts in order.
    const parts = CODE.slice(CODE.indexOf("const parts: GooglePart[]"));
    const inlineAt = parts.indexOf("inlineData");
    // `styled` since the Style chip landed — the person's prompt with the
    // chip's clause appended, still built server-side and still one text part.
    const textAt = parts.indexOf("{ text: styled }");
    expect(inlineAt).toBeGreaterThan(-1);
    expect(inlineAt, "the reference must precede the instruction").toBeLessThan(textAt);
  });

  it("validates an attached reference before the billable call", () => {
    const check = CODE.indexOf("validateReferenceImage");
    const call = CODE.indexOf("googleGenerateContent(");
    expect(check).toBeGreaterThan(-1);
    expect(check, "a bad attachment must cost nothing").toBeLessThan(call);
  });
});

describe("the cost guards are in the order that keeps them honest", () => {
  it("checks the kill switch, the admin gate and BOTH caps before the call", () => {
    const call = CODE.indexOf("googleGenerateContent(");
    expect(call).toBeGreaterThan(-1);
    for (const gate of [
      "image_enabled",
      "image_admin_only",
      "image_daily_cap",
      "image_per_user_daily_cap",
    ]) {
      const at = CODE.indexOf(gate);
      expect(at, `${gate} is not read at all`).toBeGreaterThan(-1);
      expect(at, `${gate} is read after the billable call`).toBeLessThan(call);
    }
  });

  it("counts the per-user cap against THIS user, not everyone", () => {
    // A per-user cap that forgets to filter by user is just a second house
    // cap, and it would lock everyone out the moment one person hit it.
    const perUser = CODE.slice(CODE.indexOf("image_per_user_daily_cap") - 600);
    expect(perUser).toMatch(/\.eq\("user_id", user\.id\)/);
  });

  it("counts both caps over a rolling 24h, so midnight cannot double them", () => {
    expect(CODE).toMatch(/24 \* 60 \* 60 \* 1000/);
    // One `since`, used by both counts — two different windows would be a bug
    // nobody would see until a bill arrived.
    expect(CODE.match(/const since =/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\.gte\("created_at", since\)/g) ?? []).toHaveLength(2);
  });

  it("has no retry around the billable call", () => {
    // A prompt the gateway refuses will be refused again identically, and a
    // loop is how a month of credits disappears in an hour. Checked against
    // CODE: the header comment says the word "retry" to explain its absence.
    expect(CODE).not.toMatch(/\bretry\b|\.retries|maxRetries/i);
    // The fetch itself now lives in _shared/googleDirect.ts (which has its own
    // no-retry test); what this file must contain is exactly ONE call to it.
    expect(CODE.match(/googleGenerateContent\(/g) ?? []).toHaveLength(1);
  });

  it("never puts the key's VALUE in a log or a reply", () => {
    // The NAME of a missing variable is operator information; no value ever
    // is — which is why the "not set" log below is allowed to name it.
    const key = CODE.match(/const key = ([A-Za-z.()"'_ ]+);/)?.[1];
    expect(key).toContain("GOOGLE_AI_API_KEY");
    for (const call of CODE.matchAll(/(console\.[a-z]+|json)\(([^;]*)\)/g)) {
      expect(call[2], `${call[1]} must not carry the key`).not.toMatch(/\bkey\b(?!Env)/);
    }
    // It may only ever reach the provider, handed to the shared caller once.
    // googleDirect puts it in the query string (Google rejects a bearer
    // header) and its own test pins that it never reaches a log.
    expect(CODE.match(/^\s*key,$/gm) ?? []).toHaveLength(1);
  });

  it("records a failed attempt rather than discarding it", () => {
    // A call that may still have been charged is part of what happened.
    expect(CODE.match(/status: "failed"/g) ?? []).not.toHaveLength(0);
  });
});
