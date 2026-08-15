/**
 * The price chart exists twice — the CANONICAL upsert in the newest pricing
 * migration, and the TypeScript mirrors (PRICE_TIERS for classic,
 * MOVIE_TIERS in storyCostModel) — and this file is what keeps them from
 * drifting. Earlier migrations seeded earlier charts; the canonical-chart
 * convention says the NEWEST pricing migration lists every row of both
 * grades, and that is the statement parsed here. A text test: it proves the
 * two descriptions agree, not that the migration was applied — application
 * is verified against the live project per deploy (last: 2026-08-11, raw
 * psql output).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PER_MINUTE_PAISE, PRICE_TIERS, priceForSeconds } from "@/lib/storyPricing";
import {
  MARGIN_TARGET,
  MOVIE_TIERS,
  UNIT,
  oniqMarginAt,
  pricePaisePerMinute,
} from "@/lib/storyCostModel";

const SQL = readFileSync(
  // The NEWEST pricing migration is the one canonical chart. Latest:
  // 2026-08-15, tiers replaced by a single per-minute rate per grade.
  join(process.cwd(), "supabase/migrations/20260815000000_per_minute_pricing.sql"),
  "utf8",
);

type Row = { seconds: number; label: string; pricePaise: number; grade: string; active: string };

/** Every row of the canonical upsert, in sort order. */
function chart(): Row[] {
  const insert = SQL.match(
    /insert into public\.story_price_tiers \(seconds, label, price_paise, sort_order, grade, active\) values\s*([\s\S]*?)\s*on conflict/,
  );
  expect(insert, "the canonical chart is not in the migration — the format changed").not.toBeNull();
  const rows = [
    ...(insert?.[1] ?? "").matchAll(
      /\((\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'(classic|movie)',\s*(true|false)\)/g,
    ),
  ];
  expect(rows.length, "no rows parsed — the format changed").toBe(10);
  return rows
    .map(([, seconds, label, pricePaise, sortOrder, grade, active]) => ({
      seconds: Number(seconds),
      label,
      pricePaise: Number(pricePaise),
      sortOrder: Number(sortOrder),
      grade,
      active,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ seconds, label, pricePaise, grade, active }) => ({
      seconds,
      label,
      pricePaise,
      grade,
      active,
    }));
}

describe("the canonical price chart matches the TypeScript mirrors", () => {
  it("classic rows equal PRICE_TIERS, all OFF SALE since the movie launch", () => {
    // Owner directive 2026-08-13: classic inactive for now, movie active.
    const rows = chart().filter((r) => r.grade === "classic");
    for (const r of rows) expect(r.active).toBe("false");
    expect(rows.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise }))).toEqual(
      PRICE_TIERS.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise })),
    );
  });

  it("movie rows equal MOVIE_TIERS, all ON SALE — the in-house engine's tier", () => {
    const rows = chart().filter((r) => r.grade === "movie");
    for (const r of rows) expect(r.active).toBe("true");
    expect(rows.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise }))).toEqual(
      MOVIE_TIERS.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise })),
    );
  });

  it("prices rise with length within each grade", () => {
    for (const grade of ["classic", "movie"] as const) {
      const rows = chart().filter((r) => r.grade === grade);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].seconds).toBeGreaterThan(rows[i - 1].seconds);
        expect(rows[i].pricePaise).toBeGreaterThan(rows[i - 1].pricePaise);
      }
    }
  });

  it("every price is inside the payment rail's expressible bounds", () => {
    for (const r of chart()) {
      expect(r.pricePaise).toBeGreaterThan(0);
      expect(r.seconds).toBeGreaterThan(0);
    }
  });

  it("one currency across both mirrors", () => {
    const currencies = new Set([
      ...PRICE_TIERS.map((t) => t.currency),
      ...MOVIE_TIERS.map((t) => t.currency),
    ]);
    expect(currencies).toEqual(new Set(["INR"]));
  });
});

/**
 * THE NO-TIERS INVARIANT (owner directive, 2026-08-15).
 *
 * The policy is not "these five prices"; it is "one rate, times minutes". A
 * chart can satisfy a margin check row by row and still have quietly grown a
 * tier — a row nudged for retail prettiness, a duration given its own
 * discount. Linearity is the property that says the ladder is really gone, so
 * it is asserted directly against the SQL rather than inferred from the
 * TypeScript that is supposed to mirror it.
 */
describe("the per-minute rate", () => {
  it("prices every published duration at exactly rate x minutes", () => {
    for (const grade of ["classic", "movie"] as const) {
      const rows = chart().filter((r) => r.grade === grade);
      const rate = PER_MINUTE_PAISE[grade];
      for (const r of rows) {
        expect(r.pricePaise, `${grade} ${r.seconds}s is not on the ${rate}/min line`).toBe(
          Math.round((rate * r.seconds) / 60),
        );
      }
    }
  });

  it("derives that rate from the cost model rather than hand-setting it", () => {
    expect(PER_MINUTE_PAISE.classic).toBe(pricePaisePerMinute("classic"));
    expect(PER_MINUTE_PAISE.movie).toBe(pricePaisePerMinute("movie"));
    // The owner's measured generation cost is the input everything hangs off.
    expect(UNIT.genPaisePerMinute).toBe(3150);
    expect(MARGIN_TARGET).toBe(0.26);
  });

  it("holds the 26% floor from one minute up, and admits where it does not", () => {
    for (const grade of ["classic", "movie"] as const) {
      for (const seconds of [60, 120, 180, 300]) {
        const m = oniqMarginAt(grade, seconds, priceForSeconds(grade, seconds));
        expect(m, `${grade} ${seconds}s fell under the mandate`).toBeGreaterThanOrEqual(0.26);
      }
      // 30s cannot clear it: a flat per-film cost is not recoverable by a
      // per-minute price. Pinned so the shortfall stays a known, visible
      // decision instead of becoming a surprise on a margin review.
      const short = oniqMarginAt(grade, 30, priceForSeconds(grade, 30));
      expect(short).toBeLessThan(0.26);
      expect(short).toBeGreaterThan(0.2);
    }
  });
});
