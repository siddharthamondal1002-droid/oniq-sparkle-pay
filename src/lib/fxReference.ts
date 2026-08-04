// Currency REFERENCE rates via Frankfurter (European Central Bank data).
// MIT-licensed service, ECB-derived data, no key, free for commercial use.
//
// THESE ARE NOT TRADABLE QUOTES, AND THE UI MUST NOT IMPLY THEY ARE.
//
// The ECB publishes these once per working day, around 16:00 CET, "for
// information purposes" — explicitly not for transactions. Two consequences,
// and the second is the one that actually bites:
//
//  1. Licensing: reference rates are open. Live tradable FX is not, and no
//     free tier conveys the right to display it commercially. That is the same
//     reason markets are a link-out (src/data/marketApps.ts).
//  2. Accuracy: a rate that updates once a working day, shown without saying
//     so, is a misrepresentation regardless of who licensed it. Somebody
//     sending money on Sunday deserves to know the number is Friday's.
//
// So every rate carries the date it was published, and the UI says what it is.

export type FxReference = {
  base: string;
  quote: string;
  rate: number;
  /** The ECB publication date for this rate — never "now". */
  asOf: string;
  stale: boolean;
};

const BASE = "https://api.frankfurter.dev/v1";

export const FX_NOTICE =
  "European Central Bank reference rate, published once each working day. It is not a live quote and not a rate you can trade at.";

/** Rates older than this are flagged — weekends and holidays are normal. */
const STALE_AFTER_DAYS = 4;

export function isStale(asOf: string, now: Date = new Date()): boolean {
  const then = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(then)) return true;
  return (now.getTime() - then) / 86_400_000 > STALE_AFTER_DAYS;
}

export function parseRate(
  json: { base?: string; date?: string; rates?: Record<string, number> },
  quote: string,
  now: Date = new Date(),
): FxReference | null {
  const rate = json?.rates?.[quote];
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const asOf = typeof json.date === "string" ? json.date : "";
  if (!asOf) return null;
  return {
    base: json.base ?? "",
    quote,
    rate,
    asOf,
    stale: isStale(asOf, now),
  };
}

export async function fetchReferenceRate(
  base: string,
  quote: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FxReference | null> {
  if (base === quote) return null;
  const res = await fetchImpl(`${BASE}/latest?base=${base}&symbols=${quote}`);
  if (!res.ok) throw new Error(`fx ${res.status}`);
  return parseRate(await res.json(), quote);
}
