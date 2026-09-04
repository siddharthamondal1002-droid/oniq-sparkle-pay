/**
 * MUSIC — the pure half, and the measured facts pinned so they cannot drift.
 *
 * The model id is asserted here for the same reason llm.ts keeps a measured
 * 404 table: an id in this codebase is a claim about what a key can actually
 * call, and the only thing that established this one was a POST.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MUSIC_MODEL,
  MUSIC_PROMPT_MAX,
  validateMusicPrompt,
} from "../../../supabase/functions/_shared/musicCore";

const ROOT = process.cwd();
const FN = readFileSync(join(ROOT, "supabase/functions/music-generate/index.ts"), "utf8");

/** Comments describe code; they are not code. Same rule searchSpendCoverage uses. */
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the music prompt gate", () => {
  it("refuses an empty prompt with something a person can act on", () => {
    expect(validateMusicPrompt("")).toBe("Describe the music you want.");
  });

  it("accepts an ordinary sentence", () => {
    expect(validateMusicPrompt("calm piano for studying")).toBeNull();
  });

  it("refuses a prompt past the ceiling, and names the ceiling", () => {
    const long = "a".repeat(MUSIC_PROMPT_MAX + 1);
    expect(validateMusicPrompt(long)).toContain(String(MUSIC_PROMPT_MAX));
  });

  it("accepts a prompt exactly at the ceiling", () => {
    expect(validateMusicPrompt("a".repeat(MUSIC_PROMPT_MAX))).toBeNull();
  });
});

describe("the model id is the one that was measured", () => {
  it("is the -preview id, because the unsuffixed one 404s", () => {
    // Measured 2026-09-04: models/lyria-3-pro is "not found for API version
    // v1beta"; lyria-3-pro-preview:generateContent returns 200.
    expect(MUSIC_MODEL).toBe("lyria-3-pro-preview");
  });

  it("is called with generateContent, not predict", () => {
    expect(FN).toMatch(/:generateContent/);
    expect(FN).not.toMatch(/:predict/);
  });

  it("sends Google's native contents shape with an explicit role", () => {
    // The OpenAI field names come back as "Unknown name ...: Cannot find field".
    expect(FN).toMatch(/contents:\s*\[\{\s*role:\s*"user"/);
  });
});

describe("the cost guards are in the order that keeps them honest", () => {
  it("checks the kill switch, the admin gate and the cap before the call", () => {
    const killSwitch = FN.indexOf("music_enabled");
    const adminGate = FN.indexOf("music_admin_only");
    const cap = FN.indexOf("music_daily_cap");
    const call = FN.indexOf("await fetch(`${GOOGLE_URL}");
    expect(killSwitch).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(killSwitch).toBeLessThan(call);
    expect(adminGate).toBeLessThan(call);
    expect(cap).toBeLessThan(call);
  });

  it("has no retry around the billable call", () => {
    // A prompt Google refuses will be refused again identically, and a loop is
    // how a month of credits disappears in an hour. Checked against CODE: the
    // header comment says the word "retry" precisely to explain its absence.
    expect(CODE).not.toMatch(/\bretry\b|\.retries|maxRetries/i);
    expect(CODE.match(/await fetch\(/g) ?? []).toHaveLength(1);
  });

  it("never puts the key's VALUE in a log or a reply", () => {
    // The NAME of a missing variable is operator information; no value ever
    // is — which is why the "not set" log below is allowed to name it.
    const key = CODE.match(/const key = ([A-Za-z.()"'_ ]+);/)?.[1];
    expect(key).toContain("GOOGLE_AI_API_KEY");
    for (const call of CODE.matchAll(/(console\.[a-z]+|json)\(([^;]*)\)/g)) {
      expect(call[2], `${call[1]} must not carry the key`).not.toMatch(/\bkey\b(?!Env)/);
    }
    // It may only ever reach the provider URL.
    expect(CODE.match(/encodeURIComponent\(key\)/g) ?? []).toHaveLength(1);
  });
});
