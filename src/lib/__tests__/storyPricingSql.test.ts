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
import { MIN_STORY_SECONDS } from "@/lib/storyPlan";
import {
  MARGIN_TARGET,
  MOVIE_TIERS,
  UNIT,
  marginBeforeTaxAt,
  oniqMarginAt,
  priceForMarginNetOfGst,
  pricePaisePerMinute,
} from "@/lib/storyCostModel";

const SQL = readFileSync(
  // The NEWEST pricing migration is the one canonical chart. Latest:
  // 2026-08-15, tiers replaced by a single per-minute rate per grade. The
  // 30s rows it seeds are DELETED by 20260815060000_drop_thirty_seconds.sql
  // — see the sub-minute test below, which pins that removal.
  join(process.cwd(), "supabase/migrations/20260815000000_per_minute_pricing.sql"),
  "utf8",
);

type Row = { seconds: number; label: string; pricePaise: number; grade: string; active: string };

/** Every row of the canonical upsert, in sort order. */
function chart(): Row[] {
  // Rows the drop migration removes are not part of the published chart.
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
  // 10 seeded, 8 published: the two sub-minute rows are deleted downstream.
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
    .filter((r) => r.seconds >= 60)
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

  it("holds the 26% floor at every duration on sale, before tax", () => {
    // BEFORE TAX is the question the chart was built to answer: the rate is
    // solved from cost, payment fee and a 26% margin, and every published row
    // is that rate times minutes. GST does not enter the formula, so it must
    // not enter the check on the formula either — see the test below for what
    // it does to the number ONIQ actually banks.
    for (const grade of ["classic", "movie"] as const) {
      for (const seconds of [60, 120, 180, 300]) {
        const m = marginBeforeTaxAt(grade, seconds, priceForSeconds(grade, seconds));
        expect(m, `${grade} ${seconds}s fell under the mandate`).toBeGreaterThanOrEqual(0.26);
      }
    }
  });

  /**
   * AND WHAT IS LEFT AFTER GST, which is not 26% and is not pretended to be.
   *
   * The published price is GST-inclusive (owner, 2026-08-16), so 18/118 of
   * every rupee taken is tax passing through. Recorded against the SQL chart
   * rather than only against the TypeScript model, because it is the SQL that
   * bills: if someone edits the migration to a rate that changes this, the gap
   * moves here first.
   */
  it("records what the chart actually nets after GST — below the mandate", () => {
    for (const seconds of [60, 120, 180, 300]) {
      const m = oniqMarginAt("movie", seconds, priceForSeconds("movie", seconds));
      expect(m, `movie ${seconds}s: GST no longer costs what it costs`).toBeLessThan(MARGIN_TARGET);
      expect(m).toBeGreaterThan(0.1);
    }
    // The rate that WOULD hold the mandate net of GST. Nothing derives a price
    // from it — repricing is the owner's call — so this pins both the answer
    // and the fact that it has not been acted on.
    expect(priceForMarginNetOfGst("movie")).toBe(7200);
    expect(PER_MINUTE_PAISE.movie, "prices moved without an owner decision").toBe(5700);
  });

  /**
   * The sub-minute film is withdrawn, and this is why it had to be.
   *
   * The arithmetic that killed it is asserted rather than described: a flat
   * per-film cost cannot be recovered by a per-minute price, so 30s would
   * land under the floor at the published rate. If a future change ever makes
   * a sub-minute film clear 26% honestly, this test fails and someone gets to
   * reconsider — which is the point.
   */
  it("sells nothing under a minute, because nothing under a minute clears the floor", () => {
    expect(MIN_STORY_SECONDS).toBe(60);
    for (const t of PRICE_TIERS) expect(t.seconds).toBeGreaterThanOrEqual(60);
    for (const t of MOVIE_TIERS) expect(t.seconds).toBeGreaterThanOrEqual(60);
    for (const grade of ["classic", "movie"] as const) {
      // Before tax, deliberately. Net of GST nothing clears 26% today, so the
      // net-of-GST version of this check would pass for a reason that has
      // nothing to do with sub-minute films — a tripwire that can no longer
      // trip is worse than no tripwire.
      const would = marginBeforeTaxAt(grade, 30, priceForSeconds(grade, 30));
      expect(would, `${grade} 30s would now clear the floor — worth revisiting`).toBeLessThan(0.26);
    }
    // The migration that removes them, and the floor that stops a caller
    // claiming one anyway past a checkout that no longer sells it.
    const drop = readFileSync(
      join(process.cwd(), "supabase/migrations/20260815060000_drop_thirty_seconds.sql"),
      "utf8",
    );
    expect(drop).toContain("delete from public.story_price_tiers where seconds < 60");
    expect(drop).toContain("min_story_seconds = 60");
  });
});
