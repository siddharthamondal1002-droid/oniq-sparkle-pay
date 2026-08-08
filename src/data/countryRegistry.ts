// ONIQ country registry — the ONE source of truth for country-dependent
// behaviour. Pure data + pure helpers; no React, no side effects, no storage.
//
// Two axes (see src/lib/country.ts and src/lib/region.ts):
//   homeCountry    — identity: locale, currency, tiles, faith, legal regime.
//   currentRegion  — where the body is: emergency + crisis numbers only.
//
// RULE: no `country === "IN"` conditionals in components. Everything a
// component needs comes from getCountryConfig() or isAvailable().

import type { Country } from "@/data/appRegistry";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import { CRISIS_LINES, type CrisisLine } from "@/data/crisisLines";

export type { Country, CrisisLine };
export { ALL_COUNTRIES };

export type LegalRegime = "DPDP" | "UKGDPR" | "PIPEDA" | "APA" | "PDPA" | "PDPL" | "US_STATE";

export type EmergencyNumbers = {
  police: string;
  fire: string;
  ambulance: string;
  /** Single number that reaches all services, where one exists. */
  unified?: string;
};

export type CountryConfig = {
  code: Country;
  locales: string[];
  defaultLocale: string;
  dir: "ltr" | "rtl";
  currency: string;
  /** Grouping locale — 'en-IN' gives lakh/crore, not thousands. */
  numberLocale: string;
  emergency: EmergencyNumbers;
  crisisLines: CrisisLine[];
  legalRegime: LegalRegime;
  /** Digital age of consent. India's DPDP Act: 18. Baseline elsewhere: 13. */
  minorAge: number;
  /** Whether the health hub may exist and store health data at all. */
  healthDataAllowed: boolean;
};

export const COUNTRY_REGISTRY: Record<Country, CountryConfig> = {
  IN: {
    code: "IN",
    locales: ["en", "hi"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "INR",
    numberLocale: "en-IN",
    emergency: { unified: "112", police: "100", fire: "101", ambulance: "102" },
    crisisLines: CRISIS_LINES.IN,
    legalRegime: "DPDP",
    minorAge: 18,
    healthDataAllowed: true,
  },
  US: {
    code: "US",
    locales: ["en", "es"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "USD",
    numberLocale: "en-US",
    emergency: { unified: "911", police: "911", fire: "911", ambulance: "911" },
    crisisLines: CRISIS_LINES.US,
    legalRegime: "US_STATE",
    minorAge: 13,
    healthDataAllowed: true,
  },
  GB: {
    code: "GB",
    locales: ["en"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "GBP",
    numberLocale: "en-GB",
    emergency: { unified: "999", police: "999", fire: "999", ambulance: "999" },
    crisisLines: CRISIS_LINES.GB,
    legalRegime: "UKGDPR",
    minorAge: 13,
    healthDataAllowed: true,
  },
  AE: {
    code: "AE",
    locales: ["en", "ar"],
    defaultLocale: "en",
    dir: "rtl",
    currency: "AED",
    numberLocale: "en-AE",
    emergency: { police: "999", fire: "997", ambulance: "998" },
    crisisLines: CRISIS_LINES.AE,
    legalRegime: "PDPL",
    minorAge: 13,
    // UAE health-data localisation: the hub does not exist here. Wired now;
    // storage migration is a separate phase.
    healthDataAllowed: false,
  },
  CA: {
    code: "CA",
    locales: ["en", "fr"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "CAD",
    numberLocale: "en-CA",
    emergency: { unified: "911", police: "911", fire: "911", ambulance: "911" },
    crisisLines: CRISIS_LINES.CA,
    legalRegime: "PIPEDA",
    minorAge: 13,
    healthDataAllowed: true,
  },
  AU: {
    code: "AU",
    locales: ["en"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "AUD",
    numberLocale: "en-AU",
    emergency: { unified: "000", police: "000", fire: "000", ambulance: "000" },
    crisisLines: CRISIS_LINES.AU,
    legalRegime: "APA",
    minorAge: 13,
    healthDataAllowed: true,
  },
  SG: {
    code: "SG",
    locales: ["en", "zh", "ms", "ta"],
    defaultLocale: "en",
    dir: "ltr",
    currency: "SGD",
    numberLocale: "en-SG",
    emergency: { police: "999", fire: "995", ambulance: "995" },
    crisisLines: CRISIS_LINES.SG,
    legalRegime: "PDPA",
    minorAge: 13,
    healthDataAllowed: true,
  },
};

export function getCountryConfig(code: Country | null | undefined): CountryConfig {
  return COUNTRY_REGISTRY[(code ?? "IN") as Country] ?? COUNTRY_REGISTRY.IN;
}

/** Currency + grouping for the HOME country. Never the current region. */
export function formatMoney(amount: number, home: Country): string {
  const c = getCountryConfig(home);
  try {
    return new Intl.NumberFormat(c.numberLocale, {
      style: "currency",
      currency: c.currency,
    }).format(amount);
  } catch {
    return `${c.currency} ${amount}`;
  }
}

/** Emergency numbers for where the user physically IS. */
export function getEmergency(region: Country): EmergencyNumbers {
  return getCountryConfig(region).emergency;
}

/** The single number to dial for help in this region. */
export function primaryEmergency(region: Country): string {
  const e = getEmergency(region);
  return e.unified ?? e.police;
}

/**
 * The number to dial for a medical/psychiatric emergency. Where there is no
 * unified line, this is the ambulance number — UAE's unified-ish 999 is
 * police, and a person in crisis needs 998.
 */
export function medicalEmergency(region: Country): string {
  const e = getEmergency(region);
  return e.unified ?? e.ambulance;
}

export function getCrisisLines(region: Country): CrisisLine[] {
  return getCountryConfig(region).crisisLines;
}

export function getTextDirection(home: Country): "ltr" | "rtl" {
  return getCountryConfig(home).dir;
}

export function isHealthDataAllowed(home: Country): boolean {
  return getCountryConfig(home).healthDataAllowed;
}

// ---------------------------------------------------------------------------
// Capability lists — features declare which countries they support. One list
// per feature, never a per-country flag matrix.
// ---------------------------------------------------------------------------

export type Feature = { id: string; supportedCountries: Country[] | "*" };

const HEALTH_COUNTRIES: Country[] = ALL_COUNTRIES.filter(
  (c) => COUNTRY_REGISTRY[c].healthDataAllowed,
);

export const FEATURES: Feature[] = [
  { id: "ting", supportedCountries: "*" },
  { id: "learn", supportedCountries: "*" },
  { id: "study", supportedCountries: ["IN"] },
  // University & admissions surface — every supported country has a route,
  // institutions and a calendar (Education & Careers loop, Phase 3).
  { id: "university", supportedCountries: "*" },
  // Candidate-side CV builder (Education & Careers loop, Phase 4). Gated at
  // 18+ in the data layer by public.is_adult_18(), not by country.
  { id: "jobs", supportedCountries: "*" },
  // Country-aware directory of real hiring/gig apps. Same 18+ render gate.
  { id: "jobsApps", supportedCountries: "*" },
  { id: "faith", supportedCountries: "*" },
  { id: "pulse", supportedCountries: "*" },
  { id: "miniapps", supportedCountries: "*" },
  { id: "rides", supportedCountries: "*" },
  { id: "official", supportedCountries: "*" },
  { id: "lores", supportedCountries: "*" },
  { id: "wander", supportedCountries: "*" },
  // Health hub does not exist where health data is not allowed.
  { id: "vitals", supportedCountries: HEALTH_COUNTRIES },
  // Local-services marketplace is India-only for now.
  { id: "earn", supportedCountries: ["IN"] },
];

const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function getFeature(id: string): Feature | undefined {
  return FEATURE_BY_ID.get(id);
}

/**
 * Availability is resolved against HOME country. Unsupported means the tile
 * does not render at all — no greyed-out state, no "coming soon".
 * Unknown ids are treated as available so new tiles are never silently lost.
 */
export function isAvailable(feature: Feature | string, home: Country): boolean {
  const f = typeof feature === "string" ? FEATURE_BY_ID.get(feature) : feature;
  if (!f) return true;
  return f.supportedCountries === "*" || f.supportedCountries.includes(home);
}
