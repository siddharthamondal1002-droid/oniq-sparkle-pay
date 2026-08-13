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
import { PRICE_TIERS } from "@/lib/storyPricing";
import { MOVIE_TIERS } from "@/lib/storyCostModel";

const SQL = readFileSync(
  // The NEWEST pricing migration is the one canonical chart. 20260811180000
  // until the movie grade was repriced to its measured cost.
  join(process.cwd(), "supabase/migrations/20260813170000_movie_reprice_measured.sql"),
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
  it("classic rows equal PRICE_TIERS, all active", () => {
    const rows = chart().filter((r) => r.grade === "classic");
    for (const r of rows) expect(r.active).toBe("true");
    expect(rows.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise }))).toEqual(
      PRICE_TIERS.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise })),
    );
  });

  it("movie rows equal MOVIE_TIERS, all inactive until the clip stage ships", () => {
    const rows = chart().filter((r) => r.grade === "movie");
    for (const r of rows) expect(r.active).toBe("false");
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
