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
  it("is the id the gateway answered, not the lite sibling that 400s", () => {
    // Measured 2026-09-04 on the gateway: google/gemini-3.1-flash-image
    // returns 200 with a b64_json image; google/gemini-3.1-flash-lite-image
    // routes but answers the same body 400 upstream_error.
    expect(IMAGE_MODEL).toBe("google/gemini-3.1-flash-image");
  });

  it("does not redefine the id — it imports the one the story path uses", () => {
    const core = readFileSync(
      join(ROOT, "supabase/functions/_shared/imageCore.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(core).toMatch(/import \{ GATEWAY_IMAGE_MODEL \}/);
    expect(core, "the id is written out a second time").not.toMatch(/"google\/gemini/);
  });

  it("goes to the gateway, on gateway credits", () => {
    // WHOSE MONEY, asserted rather than trusted to a comment: the owner's
    // 2026-09-04 mapping put image on the Lovable gateway, and the metered
    // Google key must not appear anywhere in this path.
    expect(CODE).toMatch(/GATEWAY_IMAGE_URL/);
    expect(CODE).toMatch(/LOVABLE_API_KEY/);
    expect(CODE, "image must not touch the metered key").not.toMatch(/GOOGLE_AI_API_KEY/);
    expect(CODE, "image must not call Google directly").not.toMatch(/generativelanguage/);
  });

  it("reads the OpenAI-shaped reply the gateway actually sends", () => {
    expect(CODE).toMatch(/b64_json/);
    // usageMetadata is Google's native field; this endpoint reports `usage`.
    expect(CODE).not.toMatch(/usageMetadata/);
  });
});

describe("the cost guards are in the order that keeps them honest", () => {
  it("checks the kill switch, the admin gate and BOTH caps before the call", () => {
    const call = CODE.indexOf("await fetch(IMAGE_URL");
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
    expect(CODE.match(/await fetch\(/g) ?? []).toHaveLength(1);
  });

  it("never puts the key's VALUE in a log or a reply", () => {
    // The NAME of a missing variable is operator information; no value ever
    // is — which is why the "not set" log below is allowed to name it.
    const key = CODE.match(/const key = ([A-Za-z.()"'_ ]+);/)?.[1];
    expect(key).toContain("LOVABLE_API_KEY");
    for (const call of CODE.matchAll(/(console\.[a-z]+|json)\(([^;]*)\)/g)) {
      expect(call[2], `${call[1]} must not carry the key`).not.toMatch(/\bkey\b(?!Env)/);
    }
    // It may only ever reach the provider, in the Authorization header.
    expect(CODE.match(/Bearer \$\{key\}/g) ?? []).toHaveLength(1);
  });

  it("records a failed attempt rather than discarding it", () => {
    // A call that may still have been charged is part of what happened.
    expect(CODE.match(/status: "failed"/g) ?? []).not.toHaveLength(0);
  });
});
