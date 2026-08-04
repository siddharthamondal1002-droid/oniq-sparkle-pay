/**
 * Markets are a link-out. ONIQ displays no quote it is not licensed to show.
 *
 * Origin: the home screen shipped a ticker that scraped ibjarates.com for 24K
 * gold and silver rates and topped them up from api.gold-api.com and
 * open.er-api.com, neither of whose licences had been established. No free
 * source permits commercial display of exchange or bullion quotes, and a
 * disclaimer does not cure an unlicensed redistribution.
 *
 * These tests fail if a price display or a forbidden source comes back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import { MARKET_APPS, marketAppsFor } from "@/data/marketApps";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** Source files, excluding this test and the registry's own explanatory prose. */
function sourceFiles(): { path: string; text: string }[] {
  return [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase"))]
    // Two exclusions, both for the same reason: naming a forbidden source in
    // order to forbid it is the opposite of calling it.
    //   - tests assert "we never call X", so they contain X;
    //   - openDataSources.ts records WHY each source was rejected.
    // Scanning either flagged our own due diligence as a violation.
    .filter((p) => !p.includes("__tests__"))
    .filter((p) => !p.endsWith("openDataSources.ts"))
    .map((path) => ({ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }));
}

describe("no market data is fetched or displayed", () => {
  const files = sourceFiles();

  it.each([
    ["ibjarates (scraped bullion rates)", /ibjarates/i],
    ["gold-api.com", /gold-api\.com/i],
    ["open.er-api.com", /open\.er-api\.com/i],
    ["Alpha Vantage", /alphavantage|alpha_vantage/i],
    ["Finnhub", /finnhub/i],
    ["Twelve Data", /twelvedata|twelve_data/i],
    ["NSE scraping", /nseindia\.com\/api|nseindia\.com\/get/i],
    ["Open-Meteo (non-commercial free tier)", /open-meteo|openmeteo/i],
  ])("never calls %s", (_label, pattern) => {
    // A URL in a comment explaining why we do not use it is fine; a call is not.
    const offenders = files
      .filter(({ text }) =>
        text
          .split("\n")
          .some((line) => pattern.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("has no market-ticker edge function left", () => {
    const fns = files.map((f) => f.path).filter((p) => p.includes("functions/market-ticker"));
    expect(fns).toEqual([]);
  });
});

describe("market registry", () => {
  it("gives every supported country at least one destination", () => {
    for (const c of ALL_COUNTRIES) {
      expect(marketAppsFor(c).length, `${c} has no market destination`).toBeGreaterThan(0);
    }
  });

  it("carries no price, quote or index field", () => {
    for (const m of MARKET_APPS) {
      const keys = Object.keys(m).join(" ").toLowerCase();
      for (const banned of ["price", "quote", "index", "level", "change", "ticker"]) {
        expect(keys.includes(banned), `${m.id} exposes a "${banned}" field`).toBe(false);
      }
    }
  });

  it("always has a working web fallback", () => {
    for (const m of MARKET_APPS) {
      expect(m.webUrl, `${m.id} has no webUrl`).toMatch(/^https:\/\//);
    }
  });

  it("uses text names only — no logo or image asset", () => {
    for (const m of MARKET_APPS) {
      const blob = JSON.stringify(m).toLowerCase();
      expect(blob).not.toMatch(/\.png|\.jpg|\.jpeg|\.svg|\.webp|logo/);
    }
  });

  it("leads with the exchange, not a broker", () => {
    // The neutral destination goes first: ONIQ recommends no broker.
    for (const c of ALL_COUNTRIES) {
      const first = marketAppsFor(c)[0];
      expect(["exchange", "regulator"], `${c} leads with ${first.kind}`).toContain(first.kind);
    }
  });
});
