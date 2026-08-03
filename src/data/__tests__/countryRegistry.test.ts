import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  ALL_COUNTRIES,
  COUNTRY_REGISTRY,
  FEATURES,
  formatMoney,
  getCountryConfig,
  getEmergency,
  getCrisisLines,
  isAvailable,
  isHealthDataAllowed,
  medicalEmergency,
  getTextDirection,
} from "@/data/countryRegistry";

const REGIMES = ["DPDP", "UKGDPR", "PIPEDA", "APA", "PDPA", "PDPL", "US_STATE"];

describe("country registry contract (Phase 2)", () => {
  it("every country resolves a complete, valid config", () => {
    expect(ALL_COUNTRIES).toHaveLength(7);
    for (const c of ALL_COUNTRIES) {
      const cfg = COUNTRY_REGISTRY[c];
      expect(cfg, c).toBeTruthy();
      expect(cfg.code).toBe(c);
      expect(cfg.locales.length, c).toBeGreaterThan(0);
      expect(cfg.locales, c).toContain(cfg.defaultLocale);
      expect(["ltr", "rtl"], c).toContain(cfg.dir);
      expect(cfg.currency, c).toMatch(/^[A-Z]{3}$/);
      expect(cfg.numberLocale, c).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(REGIMES, c).toContain(cfg.legalRegime);
      expect(typeof cfg.minorAge, c).toBe("number");
      expect(cfg.minorAge, c).toBeGreaterThanOrEqual(13);
      expect(typeof cfg.healthDataAllowed, c).toBe("boolean");
    }
  });

  it("emergency + crisis entries are non-empty everywhere", () => {
    for (const c of ALL_COUNTRIES) {
      const e = getEmergency(c);
      for (const k of ["police", "fire", "ambulance"] as const) {
        expect(e[k], `${c}.${k}`).toMatch(/^\d{3,}$/);
      }
      expect(medicalEmergency(c), c).toMatch(/^\d{3,}$/);
      const lines = getCrisisLines(c);
      expect(lines.length, c).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l.name.length, c).toBeGreaterThan(0);
        expect(l.number, c).toMatch(/^\d+$/);
      }
    }
  });

  it("emergency numbers match the verified table exactly", () => {
    expect(getEmergency("IN")).toEqual({
      unified: "112",
      police: "100",
      fire: "101",
      ambulance: "102",
    });
    expect(getEmergency("US").unified).toBe("911");
    expect(getEmergency("GB").unified).toBe("999");
    expect(getEmergency("AE")).toEqual({ police: "999", fire: "997", ambulance: "998" });
    expect(getEmergency("CA").unified).toBe("911");
    expect(getEmergency("AU").unified).toBe("000");
    expect(getEmergency("SG")).toEqual({ police: "999", fire: "995", ambulance: "995" });
  });

  it("currency formats with the right grouping (lakh/crore for IN)", () => {
    expect(formatMoney(1234567.89, "IN")).toBe("₹12,34,567.89");
    expect(formatMoney(1234567.89, "US")).toBe("$1,234,567.89");
    expect(formatMoney(1000, "GB")).toContain("£");
    expect(formatMoney(1000, "SG")).toContain("$");
    for (const c of ALL_COUNTRIES) {
      expect(formatMoney(1, c).length, c).toBeGreaterThan(1);
    }
  });

  it("direction and minor age follow the regime", () => {
    expect(getTextDirection("AE")).toBe("rtl");
    for (const c of ALL_COUNTRIES.filter((x) => x !== "AE")) {
      expect(getTextDirection(c), c).toBe("ltr");
    }
    expect(getCountryConfig("IN").minorAge).toBe(18);
    for (const c of ALL_COUNTRIES.filter((x) => x !== "IN")) {
      expect(getCountryConfig(c).minorAge, c).toBe(13);
    }
  });

  it("health data is disallowed in AE and allowed elsewhere", () => {
    expect(isHealthDataAllowed("AE")).toBe(false);
    for (const c of ALL_COUNTRIES.filter((x) => x !== "AE")) {
      expect(isHealthDataAllowed(c), c).toBe(true);
    }
    // The hub itself must not render where health data is not allowed.
    expect(isAvailable("vitals", "AE")).toBe(false);
    expect(isAvailable("vitals", "IN")).toBe(true);
  });

  it("capability lists are valid and unique — one list per feature", () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEATURES) {
      if (f.supportedCountries === "*") continue;
      expect(f.supportedCountries.length, f.id).toBeGreaterThan(0);
      for (const c of f.supportedCountries) {
        expect(ALL_COUNTRIES, `${f.id}:${c}`).toContain(c);
      }
    }
  });

  it("isAvailable resolves for every feature × country without throwing", () => {
    for (const f of FEATURES) {
      for (const c of ALL_COUNTRIES) {
        expect(typeof isAvailable(f, c), `${f.id}/${c}`).toBe("boolean");
      }
    }
  });
});

describe("two-axis country model (Phase 1)", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("currentRegion is device-only — never persisted to the backend", () => {
    const src = read("src/lib/region.ts");
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
    expect(src).not.toMatch(/\.from\(/);
    // and no migration mentions it
    const dir = "supabase/migrations";
    for (const f of readdirSync(dir)) {
      expect(read(join(dir, f)).toLowerCase(), f).not.toContain("current_region");
    }
  });

  it("detection is country-code only — no GPS, no coordinates", () => {
    for (const p of ["src/lib/region.ts", "src/lib/region.functions.ts"]) {
      const src = read(p);
      expect(src, p).not.toMatch(/getCurrentPosition|watchPosition|Geolocation|latitude|longitude/);
    }
    expect(read("src/lib/region.functions.ts")).toContain("cf-ipcountry");
  });

  it("home country is backed by the Supabase profile and never auto-changed", () => {
    const src = read("src/lib/country.ts");
    expect(src).toContain("country_code");
    // detection writes only to the region store, never to the home store
    expect(read("src/lib/region.ts")).not.toContain("setCountry");
  });

  it("the crisis card follows currentRegion, falling back to home", () => {
    const src = read("src/components/vitals/CrisisCard.tsx");
    expect(src).toContain("useCurrentRegion");
    expect(src).toContain("region ?? home");
    expect(src).not.toContain("TODO(current-region)");
  });

  it("an Indian user in Dubai gets UAE help, not Indian help", () => {
    const region = "AE" as const;
    expect(medicalEmergency(region)).toBe("998");
    const numbers = getCrisisLines(region).map((l) => l.number);
    expect(numbers).toContain("8004673");
    expect(numbers).not.toContain("14416");
    // ...while identity-driven values still follow Home.
    expect(formatMoney(1234567.89, "IN")).toBe("₹12,34,567.89");
  });

  it("the relocation banner offers, remembers dismissal, and never rewrites home", () => {
    const src = read("src/components/home/RegionBanner.tsx");
    expect(src).toContain("dismissRegionBanner");
    expect(src).toContain("isRegionBannerDismissed");
    expect(src).not.toContain("setCountry");
  });
});
