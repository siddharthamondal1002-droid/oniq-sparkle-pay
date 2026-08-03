/**
 * Phase 3 verification — tile-name resolution and Intl formatting.
 */
import { describe, expect, it } from "vitest";
import { tileName, TILE_LABELS, TILE_LABELS_HI } from "@/lib/i18n/tileLabel";
import { makeFormatters, moneyIn } from "@/lib/format";
import { COUNTRIES } from "@/data/countryRegistry";

describe("tile names", () => {
  const cases: Array<[keyof typeof TILE_LABELS, string, string]> = [
    ["pulse", "Pulse", "खबर"],
    ["miniapps", "Hacks", "जुगाड़"],
    ["learn", "Scout", "भाव"],
    ["rides", "Rides", "सवारी"],
    ["shopping", "Shop", "खरीदारी"],
  ];

  it.each(cases)("%s resolves per locale", (key, en, hi) => {
    expect(tileName("en", key)).toBe(en);
    expect(tileName("hi", key)).toBe(hi);
  });

  it("keeps ONIQ-owned names that need no translation", () => {
    for (const key of ["plug", "faith", "moots", "vitals"] as const) {
      expect(tileName("en", key)).toBe(TILE_LABELS[key]);
      expect(TILE_LABELS_HI[key]).toBeTruthy();
    }
  });

  it("falls back to English for locales without a Hindi table", () => {
    expect(tileName("ta", "pulse")).toBe("Pulse");
  });

  it("toggling locale twice returns the original label (no stale state)", () => {
    const a = tileName("en", "pulse");
    tileName("hi", "pulse");
    expect(tileName("en", "pulse")).toBe(a);
  });
});

describe("Intl money formatting", () => {
  it("uses Indian lakh/crore grouping for IN", () => {
    const out = makeFormatters("IN").money(1234567.89);
    expect(out.replace(/\u00a0/g, " ")).toContain("12,34,567.89");
    expect(out).toContain("₹");
  });

  it("formats every registered country in its own currency", () => {
    for (const code of Object.keys(COUNTRIES) as Array<keyof typeof COUNTRIES>) {
      const out = makeFormatters(code).money(1234.5);
      expect(out.length).toBeGreaterThan(3);
      expect(out).toMatch(/\d/);
    }
  });

  it("pins currency for fixed-denomination data", () => {
    expect(moneyIn(1234567, "INR", "IN").replace(/\u00a0/g, " ")).toContain("12,34,567");
    expect(moneyIn(12.5, "USD", "US")).toContain("$");
  });
});
