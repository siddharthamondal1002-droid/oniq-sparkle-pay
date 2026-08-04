// ONIQ — Free & Legal Surfaces loop, Phase 5: markets are a LINK-OUT, never a
// display.
//
// WHY THERE ARE NO PRICES IN THIS FILE
//
// There is no free data source that permits commercial display of exchange
// quotes. Alpha Vantage, Finnhub and Twelve Data free tiers are
// non-commercial or otherwise restricted; exchange delayed feeds require a
// redistribution agreement; NSE publishes no public API and scraping it
// breaches its terms. Showing a Nifty level or an S&P level sourced from a
// free tier is a licence breach, not a grey area, and a disclaimer does not
// cure an unlicensed redistribution.
//
// This replaced a home-screen ticker that scraped ibjarates.com for gold and
// silver rates and pulled spot prices from two APIs whose licences had never
// been established. That shipped. It does not any more.
//
// So ONIQ sends the user to their broker or exchange in one tap and displays
// no number it is not licensed to show. Deep links only — package id, scheme,
// web fallback — through the same launcher the app directory already uses.
//
// AXIS: user-selected market, defaulting to HOME country, not Current Region.
// An Indian user standing in Dubai still tracks the Nifty. This is the
// opposite of Watch, where territorial streaming rights force Current Region.

import type { AppEntry, Country } from "@/data/appRegistry";

/**
 * A market destination. Structurally an AppEntry so `launchAppEntry` and
 * `effectiveLaunchType` work unchanged — including `verified: false` forcing
 * webOnly at runtime, which is what stops a wrong package id opening the Play
 * Store on a dead listing.
 */
export type MarketApp = AppEntry & {
  /** What the user actually gets there. Never a claim about ONIQ's data. */
  kind: "broker" | "exchange" | "regulator";
};

const e = (
  id: string,
  name: string,
  countries: Country[],
  webUrl: string,
  kind: MarketApp["kind"],
  extra: Partial<MarketApp> = {},
): MarketApp => ({
  id,
  name,
  tagline:
    kind === "exchange"
      ? "Official exchange"
      : kind === "regulator"
        ? "Regulator — check before you invest"
        : "Broker",
  category: "markets",
  countries,
  webUrl,
  status: "active",
  // Text-only tiles. Phase 7 forbids exchange, broker and publisher logos.
  color: "#1F2937",
  letter: name.charAt(0).toUpperCase(),
  launchType: extra.packageId ? "package" : "webOnly",
  // Deliberately conservative. `verified: false` degrades to the web URL at
  // runtime, which always works. A package id is only trusted once someone
  // has actually confirmed the listing — an unverified one silently sends
  // users to a Play Store 404.
  verified: false,
  kind,
  ...extra,
});

/**
 * Exchanges are listed as the neutral, always-correct destination for a
 * country. Brokers are listed only where the app is the mainstream way people
 * actually reach that market. ONIQ recommends none of them and takes nothing
 * from any of them.
 */
export const MARKET_APPS: MarketApp[] = [
  // India
  e("nse-india", "NSE India", ["IN"], "https://www.nseindia.com", "exchange"),
  e("bse-india", "BSE India", ["IN"], "https://www.bseindia.com", "exchange"),
  e("zerodha-kite", "Zerodha Kite", ["IN"], "https://kite.zerodha.com", "broker"),
  e("groww", "Groww", ["IN"], "https://groww.in", "broker"),
  e("sebi", "SEBI (regulator)", ["IN"], "https://www.sebi.gov.in", "regulator"),

  // United States
  e("nasdaq", "Nasdaq", ["US"], "https://www.nasdaq.com", "exchange"),
  e("nyse", "NYSE", ["US"], "https://www.nyse.com", "exchange"),
  e("schwab", "Charles Schwab", ["US"], "https://www.schwab.com", "broker"),
  e("fidelity", "Fidelity", ["US"], "https://www.fidelity.com", "broker"),
  e("sec-investor", "SEC Investor.gov", ["US"], "https://www.investor.gov", "regulator"),

  // United Kingdom
  e("lse", "London Stock Exchange", ["GB"], "https://www.londonstockexchange.com", "exchange"),
  e("hargreaves", "Hargreaves Lansdown", ["GB"], "https://www.hl.co.uk", "broker"),
  e("fca-register", "FCA Register", ["GB"], "https://register.fca.org.uk", "regulator"),

  // United Arab Emirates
  e("dfm", "Dubai Financial Market", ["AE"], "https://www.dfm.ae", "exchange"),
  e("adx", "Abu Dhabi Securities Exchange", ["AE"], "https://www.adx.ae", "exchange"),
  e("sca-uae", "UAE Securities & Commodities Authority", ["AE"], "https://www.sca.gov.ae", "regulator"),

  // Canada
  e("tsx", "Toronto Stock Exchange", ["CA"], "https://www.tsx.com", "exchange"),
  e("questrade", "Questrade", ["CA"], "https://www.questrade.com", "broker"),
  e("ciro", "CIRO (regulator)", ["CA"], "https://www.ciro.ca", "regulator"),

  // Australia
  e("asx", "ASX", ["AU"], "https://www.asx.com.au", "exchange"),
  e("commsec", "CommSec", ["AU"], "https://www.commsec.com.au", "broker"),
  e("asic-moneysmart", "ASIC Moneysmart", ["AU"], "https://moneysmart.gov.au", "regulator"),

  // Singapore
  e("sgx", "SGX", ["SG"], "https://www.sgx.com", "exchange"),
  e("mas-sg", "Monetary Authority of Singapore", ["SG"], "https://www.mas.gov.sg", "regulator"),
];

/** Destinations for a market, exchanges and regulators first. */
export function marketAppsFor(country: Country): MarketApp[] {
  const order: MarketApp["kind"][] = ["exchange", "broker", "regulator"];
  return MARKET_APPS.filter((m) => m.countries.includes(country)).sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );
}

/**
 * Shown wherever markets appear. Not a liability disclaimer — a disclaimer
 * would not cure an unlicensed redistribution anyway — but an honest
 * statement of what ONIQ is and is not doing.
 */
export const MARKET_NOTICE =
  "ONIQ shows no prices or index levels. These open the exchange or broker directly, where the official figures are.";
