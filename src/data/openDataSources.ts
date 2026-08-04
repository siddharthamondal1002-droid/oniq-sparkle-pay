// ONIQ — Free & Legal Surfaces loop, Phase 5 (Glance) + Phase 6 (provenance).
//
// Every open dataset ONIQ actually calls, with its licence recorded next to
// it. Attribution is a LICENCE CONDITION, not a courtesy — a missing notice is
// a breach — so `requiredNotice` is reproduced verbatim and rendered on the
// attributions screen.
//
// The rule this file enforces: if a source's licence cannot be established,
// it does not ship. No exceptions, and what was rejected is recorded below
// rather than quietly forgotten.

export type OpenDataSource = {
  id: string;
  /** Specifically what ONIQ uses it for. Not a generic category. */
  usedFor: string;
  source: string;
  licence: string;
  licenceUrl: string;
  /** Exact text the licence requires, verbatim, or null if none is required. */
  requiredNotice: string | null;
  /** True only when the terms permit commercial use without a paid tier. */
  freeForCommercialUse: boolean;
  /** Whether calling it needs a key, and therefore an account and a quota. */
  requiresApiKey: boolean;
  endpoint: string;
  notes?: string;
};

export const OPEN_DATA_SOURCES: OpenDataSource[] = [
  {
    id: "nager-date",
    usedFor: "Public holiday dates, including Indian state-level observances.",
    source: "Nager.Date",
    licence: "MIT",
    licenceUrl: "https://github.com/nager/Nager.Date/blob/master/LICENSE.md",
    requiredNotice: null,
    freeForCommercialUse: true,
    requiresApiKey: false,
    endpoint: "https://date.nager.at/api/v3",
    notes:
      "Open source, no key, no rate limit, 100+ countries. India is returned with ISO 3166-2 subdivision codes on the `counties` field, which is what makes state-level filtering possible — the national list alone is wrong for most Indian users.",
  },
  {
    id: "frankfurter",
    usedFor: "Currency REFERENCE rates. Never presented as a tradable quote.",
    source: "Frankfurter (European Central Bank reference rates)",
    licence: "Open data, ECB-derived; Frankfurter is MIT-licensed",
    licenceUrl: "https://github.com/lineofflight/frankfurter/blob/main/LICENSE",
    requiredNotice: null,
    freeForCommercialUse: true,
    requiresApiKey: false,
    endpoint: "https://api.frankfurter.dev/v1",
    notes:
      "ECB publishes these as daily reference rates for information purposes — explicitly not for transactions. ONIQ labels them as such. Rates update once per working day around 16:00 CET; presenting them as live would be a misrepresentation, not just a licensing question.",
  },
];

/**
 * Sources considered and REJECTED, with the reason. Kept in the codebase so
 * nobody re-adds one after a search finds it and assumes it was never
 * evaluated.
 */
export const REJECTED_SOURCES: { source: string; reason: string }[] = [
  {
    source: "Open-Meteo",
    reason:
      "Free tier is restricted to non-commercial use; commercial use requires the paid plan. Out under a no-paid-tiers constraint.",
  },
  {
    source: "Alpha Vantage / Finnhub / Twelve Data",
    reason:
      "Free tiers are non-commercial or otherwise restricted, and none conveys the right to display exchange quotes commercially.",
  },
  {
    source: "NSE India",
    reason: "No public API; scraping the site breaches its terms.",
  },
  {
    source: "ibjarates.com",
    reason:
      "Bullion rates were being scraped from HTML. No licence to redistribute, and scraping breaches the site's terms. Removed from production.",
  },
  {
    source: "api.gold-api.com / open.er-api.com",
    reason: "Licence never established, so they cannot ship under the Phase 6 rule.",
  },
  {
    source: "Google Maps Platform Weather API",
    reason:
      "Paid Maps Platform SKU — requires a billing account, bills per request beyond the monthly credit, restricts caching and requires attribution. Excluded by the no-paid-tiers constraint.",
  },
];

export function sourceById(id: string): OpenDataSource | null {
  return OPEN_DATA_SOURCES.find((s) => s.id === id) ?? null;
}
