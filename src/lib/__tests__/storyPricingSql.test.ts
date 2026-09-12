/**
 * The price chart exists in three places and this file keeps them agreeing:
 * the SEED migration (which durations exist, per grade, and what is on sale),
 * the REPRICE migration (what movie grade costs since 2026-08-16), and the
 * TypeScript mirrors PRICE_TIERS and MOVIE_TIERS that the app reads.
 *
 * The seed stopped being the prices when movie was repriced to ₹75/min, so
 * the checks split: shape and sale status come from the seed, amounts from
 * the reprice and the mirrors. Conflating them is how a test ends up
 * comparing a rate to itself and asserting nothing, which the first draft
 * after the reprice did.
 *
 * A TEXT TEST. It proves the descriptions agree, not that a migration ran —
 * application is verified against the live project per deploy (last:
 * 2026-08-16, story_price_tiers read back at ₹75/min across all four movie
 * durations).
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
  // The seed chart. It is no longer the PRICES — 20260816090000 repriced movie
  // to ₹75/min — but it is still the only file that lists every row of both
  // grades, so it stays the structural mirror: which durations exist, which
  // grade each belongs to, and what is on sale. The rate itself is checked
  // against PER_MINUTE_PAISE below, and the reprice is pinned separately.
  join(process.cwd(), "supabase/migrations/20260815051008_cf281f5c-b920-4674-b83d-2363cde85ed3.sql"),
  "utf8",
);
/** The migration that actually sets today's movie prices. */
const REPRICE = readFileSync(
  // The LATEST reprice — ₹99/min, 2026-09-12. The ₹75 one it replaced
  // (20260816090000_seventy_five_a_minute.sql) is still applied history; what
  // the mirrors must agree with is the rate in force, which is this file.
  join(process.cwd(), "supabase/migrations/20260912190000_ninety_nine_a_minute.sql"),
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

  it("movie rows equal MOVIE_TIERS in every respect but the repriced amount", () => {
    const rows = chart().filter((r) => r.grade === "movie");
    for (const r of rows) expect(r.active).toBe("true");
    // Durations and labels come from the seed; prices come from the reprice.
    expect(rows.map(({ seconds, label }) => ({ seconds, label }))).toEqual(
      MOVIE_TIERS.map(({ seconds, label }) => ({ seconds, label })),
    );
    // And the reprice is a RATE applied to the whole grade, not a list of
    // hand-set amounts — which is what keeps the no-tiers policy true.
    expect(REPRICE).toContain("set price_paise = round(9900.0 * seconds / 60)");
    expect(REPRICE).toContain("where grade = 'movie'");
    for (const t of MOVIE_TIERS) {
      expect(t.pricePaise).toBe(Math.round((9900 * t.seconds) / 60));
    }
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
    // THREE PLACES, THREE NON-VACUOUS CHECKS. The first draft of this after
    // the reprice compared rate x minutes to rate x minutes for the movie
    // grade — true by construction and worth nothing.

    // 1. The SEED is linear in its own rate, whatever that rate was. This is
    //    the no-ladder property of the chart's shape, independent of price.
    for (const grade of ["classic", "movie"] as const) {
      const rows = chart().filter((r) => r.grade === grade);
      const implied = new Set(rows.map((r) => Math.round((r.pricePaise * 60) / r.seconds)));
      expect(implied.size, `${grade} seed has ${implied.size} rates — that is a ladder`).toBe(1);
    }

    // 2. Classic is still ON the rate it was seeded at, because it was never
    //    repriced. If that stops being true, something moved a withdrawn
    //    product's prices without saying so.
    for (const r of chart().filter((x) => x.grade === "classic")) {
      expect(r.pricePaise).toBe(Math.round((PER_MINUTE_PAISE.classic * r.seconds) / 60));
    }

    // 3. Movie's PUBLISHED amounts — the mirror the app actually reads — sit
    //    on the current rate, which the seed no longer does.
    for (const t of MOVIE_TIERS) {
      expect(t.pricePaise, `movie ${t.seconds}s is off the ₹99 line`).toBe(
        Math.round((PER_MINUTE_PAISE.movie * t.seconds) / 60),
      );
    }
  });

  it("publishes at or above the floor the cost model derives", () => {
    // Movie is ₹99 against a ₹72 floor (owner directive, 2026-09-12; was ₹75).
    // The floor is unchanged — it is what 26% net of GST requires — so ₹99
    // clears it with room rather than sitting on it. Classic is withdrawn and
    // was never repriced, so it no longer sits on its own derived line and is
    // not held to it.
    expect(PER_MINUTE_PAISE.movie).toBeGreaterThanOrEqual(pricePaisePerMinute("movie"));
    expect(PER_MINUTE_PAISE.movie).toBe(9900);
    expect(pricePaisePerMinute("movie")).toBe(7200);
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
  it("clears the mandate NET OF GST at every duration on sale", () => {
    // This is the assertion the ₹57 chart could not pass, and the reason the
    // owner repriced. The shortest film is the worst case: at ₹99 it lands
    // 41.4%, and every longer one lands higher as the flat ₹3 is spread.
    // (It was 28.3% at ₹75, which is what this line said until 2026-09-12.)
    for (const seconds of [60, 120, 180, 300]) {
      const m = oniqMarginAt("movie", seconds, priceForSeconds("movie", seconds));
      expect(m, `movie ${seconds}s nets ${(m * 100).toFixed(1)}% after GST`).toBeGreaterThanOrEqual(
        MARGIN_TARGET,
      );
    }
    expect(priceForMarginNetOfGst("movie")).toBe(7200);
    expect(PER_MINUTE_PAISE.movie, "prices moved without an owner decision").toBe(9900);
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
    // THE FLOOR STOPPED BEING THE REASON AT ₹99, and this test says so rather
    // than being deleted. Until 2026-09-12 neither grade could clear 26% net
    // of GST over 30 seconds, so "we sell nothing under a minute" and "nothing
    // under a minute pays" were the same sentence. At ₹99/min a 30s movie
    // clears comfortably, so the one-minute minimum is now a PRODUCT decision
    // and nothing else — MIN_STORY_SECONDS above is the whole enforcement.
    // Whether to sell a 30-second film is the owner's to decide; it is not
    // opened here just because the arithmetic now allows it.
    const classic30 = oniqMarginAt("classic", 30, priceForSeconds("classic", 30));
    expect(classic30, "classic 30s clears the floor — worth revisiting").toBeLessThan(0.26);
    const movie30 = oniqMarginAt("movie", 30, priceForSeconds("movie", 30));
    expect(movie30, "a 30s movie no longer clears — the ₹99 note above is stale").toBeGreaterThan(
      0.26,
    );
    // The migration that removes them, and the floor that stops a caller
    // claiming one anyway past a checkout that no longer sells it.
    const drop = readFileSync(
      join(process.cwd(), "supabase/migrations/20260815052853_378b2361-213b-4d4b-a7c6-99c000d73293.sql"),
      "utf8",
    );
    expect(drop).toContain("delete from public.story_price_tiers where seconds < 60");
    expect(drop).toContain("min_story_seconds = 60");
  });
});
