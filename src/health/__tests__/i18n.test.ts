import { describe, expect, it } from "vitest";
import { HEALTH_STRINGS, fill, registerHealthTranslations } from "@/health/i18n";
import { DICTIONARIES, lookup } from "@/lib/i18n/dictionaries";
import { DOCUMENT_KINDS, PROVENANCE_SOURCES, RECORD_KINDS } from "@/health/domain";
import { AI_REFUSAL_REASONS, PROVIDER_REFUSAL_CODES } from "@/health/ai/types";

const LANGS = ["en", "hi", "bn"] as const;

describe("English, Hindi and Bengali carry the same keys", () => {
  it("key sets are identical and every value is a non-empty string", () => {
    const en = Object.keys(HEALTH_STRINGS.en).sort();
    expect(en.length).toBeGreaterThan(60);
    for (const lang of LANGS) {
      expect(Object.keys(HEALTH_STRINGS[lang]).sort(), lang).toEqual(en);
      for (const [k, v] of Object.entries(HEALTH_STRINGS[lang])) {
        expect(k, lang).toMatch(/^health\./);
        expect(typeof v === "string" && v.trim().length > 0, `${lang} ${k}`).toBe(true);
      }
    }
  });

  it("Hindi and Bengali are actually translated, not English copied", () => {
    const same = Object.keys(HEALTH_STRINGS.en).filter(
      (k) =>
        HEALTH_STRINGS.hi[k] === HEALTH_STRINGS.en[k] ||
        HEALTH_STRINGS.bn[k] === HEALTH_STRINGS.en[k],
    );
    expect(same).toEqual([]);
  });

  it("labels every kind, document kind and provenance source", () => {
    for (const k of RECORD_KINDS) expect(HEALTH_STRINGS.en[`health.kind.${k}`], k).toBeTruthy();
    for (const k of DOCUMENT_KINDS) expect(HEALTH_STRINGS.en[`health.doc.${k}`], k).toBeTruthy();
    for (const s of PROVENANCE_SOURCES)
      expect(HEALTH_STRINGS.en[`health.provenance.${s}`], s).toBeTruthy();
    expect(HEALTH_STRINGS.en["health.provenance.unknown"]).toMatch(/AI/);
  });

  it("has a sentence for every gateway refusal reason and every provider refusal code", () => {
    // A provider's own declination (`response.refusals`) is rendered under
    // its code; a code with no sentence would be dropped on the floor in
    // three languages the day a provider emits one.
    for (const reason of AI_REFUSAL_REASONS) {
      expect(HEALTH_STRINGS.en[`health.reason.${reason}`], reason).toBeTruthy();
    }
    for (const code of PROVIDER_REFUSAL_CODES) {
      expect(HEALTH_STRINGS.en[`health.ai.refusal.${code}`], code).toBeTruthy();
    }
  });
});

describe("registration and lookup", () => {
  it("resolves per language after registering, and falls back to English elsewhere", () => {
    registerHealthTranslations();
    registerHealthTranslations();
    expect(lookup("hi", "health.title")).toBe("स्वास्थ्य");
    expect(lookup("bn", "health.title")).toBe("স্বাস্থ্য");
    expect(lookup("ta", "health.title")).toBe("Health");
  });

  it("the nav label lives in the base dictionaries for all three", () => {
    expect(DICTIONARIES.en["nav.health"]).toBe("Health");
    expect(DICTIONARIES.hi["nav.health"]).toBe("स्वास्थ्य");
    expect(DICTIONARIES.bn["nav.health"]).toBe("স্বাস্থ্য");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fill("On since {date}", { date: "8 Sep 2026" })).toBe("On since 8 Sep 2026");
    expect(fill("{a} {b}", { a: "x" })).toBe("x {b}");
  });
});
