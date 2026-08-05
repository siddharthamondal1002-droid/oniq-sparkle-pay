/**
 * The two language lists must not drift apart again.
 *
 * THE BUG THIS PINS
 *
 * Scout's picker offered 25 languages including Arabic, Spanish, French and
 * Chinese. SUPPORTED_LANGS in supabase/functions/_shared/llm.ts — which every
 * AI surface reads — held English plus twelve Indian languages and nothing
 * else. langInstruction() returns "" for an unknown code, so choosing any
 * international language produced NO instruction and the model answered in
 * English. Silently: no error, no fallback notice, nothing in a log.
 *
 * The edge function cannot import from src/, so the map is a necessary copy.
 * This test is what makes the copy safe.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_LANGUAGE_NAMES,
  ALL_LANGUAGES,
  INDIAN_LANGUAGES,
  INTERNATIONAL_LANGUAGES,
  LANGUAGE_COUNT,
  isRtlLanguage,
  languageByCode,
  speechLocaleFor,
} from "@/data/languages";

const ROOT = process.cwd();
const llm = readFileSync(join(ROOT, "supabase/functions/_shared/llm.ts"), "utf8");

/** Parse SUPPORTED_LANGS out of the Deno file. */
function edgeLangs(): Record<string, string> {
  const start = llm.indexOf("export const SUPPORTED_LANGS");
  const body = llm.slice(llm.indexOf("{", start), llm.indexOf("};", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s*"?([A-Za-z-]+)"?:\s*"([^"]+)",/gm)) out[m[1]] = m[2];
  return out;
}

describe("the AI can actually speak every language the UI offers", () => {
  const edge = edgeLangs();

  it("parsed the edge map at all (a broken parser would pass everything)", () => {
    expect(Object.keys(edge).length).toBeGreaterThan(40);
  });

  it("every offered language is in the edge map", () => {
    const missing = ALL_LANGUAGES.filter((l) => !edge[l.code]).map((l) => l.code);
    expect(
      missing,
      `offered in the UI but the AI has no instruction for them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the edge map contains nothing the UI does not offer", () => {
    const extra = Object.keys(edge).filter((c) => !languageByCode(c));
    expect(extra, `in the edge map but not the registry: ${extra.join(", ")}`).toEqual([]);
  });

  it("the English names match exactly, since they go into the prompt", () => {
    for (const l of ALL_LANGUAGES) {
      expect(edge[l.code], `${l.code} name differs between UI and edge`).toBe(l.english);
    }
  });

  it("Arabic specifically is instructable — the language that surfaced this", () => {
    expect(edge["ar"]).toBe("Arabic");
    expect(AI_LANGUAGE_NAMES["ar"]).toBe("Arabic");
  });

  it("langInstruction still short-circuits on English and unknown codes", () => {
    // Not a defect: English needs no instruction, and an unknown code must not
    // produce "Respond in undefined".
    expect(llm).toMatch(/if \(!code \|\| code === "en"\) return ""/);
    expect(llm).toMatch(/if \(!name\) return ""/);
  });
});

describe("the registry is coherent", () => {
  it("has no duplicate codes", () => {
    const codes = ALL_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every language a label, an English name and a speech locale", () => {
    for (const l of ALL_LANGUAGES) {
      expect(l.label.length, l.code).toBeGreaterThan(1);
      expect(l.english.length, l.code).toBeGreaterThan(2);
      expect(l.speech, l.code).toMatch(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);
    }
  });

  it("covers all 22 scheduled Indian languages", () => {
    // The Eighth Schedule is a defined list, which is why it is the right
    // boundary — "popular Indian languages" invites quiet omissions.
    expect(INDIAN_LANGUAGES.length).toBe(22);
    for (const name of [
      "Hindi",
      "Bengali",
      "Tamil",
      "Telugu",
      "Marathi",
      "Gujarati",
      "Kannada",
      "Malayalam",
      "Punjabi",
      "Odia",
      "Assamese",
      "Urdu",
      "Sanskrit",
      "Kashmiri",
      "Sindhi",
      "Nepali",
      "Konkani",
      "Manipuri (Meitei)",
      "Bodo",
      "Dogri",
      "Maithili",
      "Santali",
    ]) {
      expect(
        INDIAN_LANGUAGES.some((l) => l.english === name),
        `${name} missing from the Indian list`,
      ).toBe(true);
    }
  });

  it("covers the languages ONIQ's own markets run on", () => {
    // AE → Arabic, CA → French, SG → Mandarin, Malay and Tamil.
    for (const name of ["Arabic", "French", "Simplified Chinese", "Malay"]) {
      expect(
        INTERNATIONAL_LANGUAGES.some((l) => l.english === name),
        `${name} missing — a market ONIQ ships to runs on it`,
      ).toBe(true);
    }
    expect(INDIAN_LANGUAGES.some((l) => l.english === "Tamil")).toBe(true);
  });

  it("marks the right-to-left scripts", () => {
    for (const code of ["ar", "ur", "fa", "he"]) {
      expect(isRtlLanguage(code), `${code} should be RTL`).toBe(true);
    }
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("hi")).toBe(false);
  });

  it("falls back safely for an unknown code", () => {
    expect(languageByCode("zz")).toBeNull();
    expect(speechLocaleFor("zz")).toBe("en-IN");
    expect(isRtlLanguage("zz")).toBe(false);
  });
});

describe("the language count is counted, not typed", () => {
  const learn = readFileSync(join(ROOT, "src/routes/_authenticated/app.learn.tsx"), "utf8");
  const marketing = readFileSync(join(ROOT, "src/data/marketingCopy.ts"), "utf8");

  it("LANGUAGE_COUNT matches the registry", () => {
    expect(LANGUAGE_COUNT).toBe(ALL_LANGUAGES.length);
  });

  it("Scout renders the count rather than a literal", () => {
    expect(learn).toMatch(/\{LANGUAGE_COUNT\} languages/);
    expect(learn, "a hardcoded 25 is back").not.toMatch(/25 languages/);
  });

  it("the marketing stat derives from the registry", () => {
    expect(marketing).toMatch(/SCOUT_LANGUAGES = LANGUAGE_COUNT/);
    expect(marketing, "a hardcoded 25-language claim is back").not.toMatch(/"A 25-language/);
  });

  it("Scout reads the shared registry, not its own list", () => {
    expect(learn).toMatch(/from "@\/data\/languages"/);
    expect(learn, "Scout has its own hardcoded list again").not.toMatch(
      /const INDIAN_LANGS: Array</,
    );
  });
});
