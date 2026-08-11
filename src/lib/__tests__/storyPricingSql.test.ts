/**
 * The price chart exists twice — `story_price_tiers` seed rows in the purchase
 * migration, and `PRICE_TIERS` in storyPricing.ts — and this file is what keeps
 * the two from drifting. It parses the migration's insert and asserts row-level
 * agreement, the same arrangement storyJobsSchema.test.ts has with the quota
 * numbers, and for the same reason: a price that differs between the screen and
 * the charge is only ever noticed by the person who was charged.
 *
 * A text test, not a database test. It proves the two descriptions match; it
 * cannot prove the migration was applied. That happened on 2026-08-10 against
 * the live project, and the dumped definitions were diffed clean.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRICE_TIERS } from "@/lib/storyPricing";
import { MOVIE_TIERS } from "@/lib/storyCostModel";

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260810115624_9ba7e01b-3f20-4d70-974a-029d5f5f1db8.sql",
  ),
  "utf8",
);

/** The seed rows, parsed out of the insert statement. */
function seededTiers(): { seconds: number; label: string; pricePaise: number }[] {
  const insert = SQL.match(
    /insert into public\.story_price_tiers \(seconds, label, price_paise, sort_order\) values\s*([\s\S]*?)\s*on conflict/,
  );
  expect(insert, "the seed insert is not in the migration — the format changed").not.toBeNull();
  const rows = [...(insert?.[1] ?? "").matchAll(/\((\d+),\s*'([^']+)',\s*(\d+),\s*(\d+)\)/g)];
  expect(rows.length, "no rows parsed — the format changed").toBeGreaterThan(0);
  // Returned in sort_order, which is the order the screen shows them in.
  return rows
    .map(([, seconds, label, pricePaise, sortOrder]) => ({
      seconds: Number(seconds),
      label,
      pricePaise: Number(pricePaise),
      sortOrder: Number(sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise }));
}

describe("the price chart is the same in SQL as in TypeScript", () => {
  it("seeds exactly the tiers PRICE_TIERS lists, in the same order", () => {
    expect(seededTiers()).toEqual(
      PRICE_TIERS.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise })),
    );
  });

  it("defaults the tier currency to the one PRICE_TIERS carries", () => {
    // One currency for the whole chart, because that is what the Razorpay
    // account settles in. A second currency is a row, not a migration — but it
    // is also a PRICE_TIERS change, and this stops the row coming alone.
    const m = SQL.match(/currency text not null default '([A-Z]{3})'/);
    expect(m, "story_price_tiers has no currency default").not.toBeNull();
    const currencies = new Set(PRICE_TIERS.map((t) => t.currency));
    expect(currencies).toEqual(new Set([m?.[1]]));
  });

  it("prices rise with length, which is the only sane shape for the chart", () => {
    // Not a mirror check — a sanity rail. A longer Story selling for less than
    // a shorter one is a data-entry slip in either copy, and both copies pass
    // a pure equality test while agreeing on the mistake.
    for (let i = 1; i < PRICE_TIERS.length; i++) {
      expect(PRICE_TIERS[i].seconds).toBeGreaterThan(PRICE_TIERS[i - 1].seconds);
      expect(PRICE_TIERS[i].pricePaise).toBeGreaterThan(PRICE_TIERS[i - 1].pricePaise);
    }
  });

  it("keeps every tier inside the payment rail's bounds question", () => {
    // razorpay-order refuses a tier outside payment_config's min/max rather
    // than charging it. The config is a live row this test cannot see; what it
    // CAN pin is that no tier is zero or negative, which is the half of the
    // mistake that is expressible here.
    for (const t of PRICE_TIERS) {
      expect(t.pricePaise).toBeGreaterThan(0);
      expect(t.seconds).toBeGreaterThan(0);
    }
  });
});

/**
 * Same drift contract for the MOVIE chart: the grade rows seeded by the
 * movie-grade migration and MOVIE_TIERS in storyCostModel.ts must agree.
 * These rows are seeded inactive — the clip stage does not exist yet — so
 * the mirror is what a price review reads, not what anyone is charged today.
 */
const MOVIE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260811170000_movie_grade_pricing.sql"),
  "utf8",
);

describe("the movie chart is the same in SQL as in TypeScript", () => {
  it("seeds exactly the tiers MOVIE_TIERS lists, inactive, in order", () => {
    const insert = MOVIE_SQL.match(
      /insert into public\.story_price_tiers \(seconds, label, price_paise, sort_order, grade, active\) values\s*([\s\S]*?)\s*on conflict/,
    );
    expect(insert, "the movie seed insert is not in the migration").not.toBeNull();
    const rows = [
      ...(insert?.[1] ?? "").matchAll(
        /\((\d+),\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'movie',\s*(true|false)\)/g,
      ),
    ];
    expect(rows.length, "no movie rows parsed — the format changed").toBeGreaterThan(0);
    // Every seeded row is inactive until the clip stage ships.
    for (const [, , , , , active] of rows) expect(active).toBe("false");
    const seeded = rows
      .map(([, seconds, label, pricePaise, sortOrder]) => ({
        seconds: Number(seconds),
        label,
        pricePaise: Number(pricePaise),
        sortOrder: Number(sortOrder),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise }));
    expect(seeded).toEqual(
      MOVIE_TIERS.map(({ seconds, label, pricePaise }) => ({ seconds, label, pricePaise })),
    );
  });
});
