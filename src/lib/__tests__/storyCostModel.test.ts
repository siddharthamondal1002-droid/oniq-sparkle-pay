/**
 * The policy, as a test (owner directive, 2026-08-15): ONE per-minute rate
 * per grade, ONE margin — 26% — with generation AND infrastructure (payment
 * fee + flat storage) recovered first.
 *
 * The mandate is now a FLOOR rather than a target. Under the old 28/26/21
 * ladder each duration aimed at its own number and drift in either direction
 * was a fault. With a flat rate the flat per-film cost is recovered once per
 * minute rather than once per film, so realised margin RISES with duration —
 * 27% at a minute, 32% at five. That is arithmetic, not drift, so what is
 * asserted is the floor plus strict linearity.
 *
 * The one exception is pinned honestly rather than excluded: 30 seconds
 * cannot clear the floor, because half a minute pays all of a flat cost and
 * collects half the rate. See storyPricingSql.test.ts.
 */
import { describe, expect, it } from "vitest";
import { PRICE_TIERS } from "@/lib/storyPricing";
import {
  MOVIE_TIERS,
  costPaisePerMinute,
  marginTargetFor,
  oniqMarginAt,
  priceFor,
} from "@/lib/storyCostModel";

const TOLERANCE = 0.015;

describe("story pricing sits on the mandated margins", () => {
  it("clears the 26% floor at every duration of a minute or more", () => {
    for (const grade of ["classic", "movie"] as const) {
      const rows = grade === "classic" ? PRICE_TIERS : MOVIE_TIERS;
      for (const t of rows.filter((r) => r.seconds >= 60)) {
        const m = oniqMarginAt(grade, t.seconds, t.pricePaise);
        expect(
          m,
          `${t.label}: ${(m * 100).toFixed(1)}% is under the 26% floor`,
        ).toBeGreaterThanOrEqual(marginTargetFor() - TOLERANCE);
      }
    }
  });

  it("charges one flat rate — no duration gets a price of its own", () => {
    for (const grade of ["classic", "movie"] as const) {
      const rows = grade === "classic" ? PRICE_TIERS : MOVIE_TIERS;
      // Per-minute price implied by each row; every one must be identical.
      const implied = new Set(rows.map((t) => Math.round((t.pricePaise * 60) / t.seconds)));
      expect(implied.size, `${grade} has ${implied.size} rates — that is a ladder again`).toBe(1);
    }
  });

  it("mandates a single margin, not a ladder", () => {
    for (const s of [30, 60, 120, 180, 300]) expect(marginTargetFor(s)).toBe(0.26);
  });

  it("published prices are within one rounding step of the formula", () => {
    for (const t of PRICE_TIERS) {
      expect(Math.abs(priceFor("classic", t.seconds) - t.pricePaise)).toBeLessThanOrEqual(100);
    }
    for (const t of MOVIE_TIERS) {
      expect(Math.abs(priceFor("movie", t.seconds) - t.pricePaise)).toBeLessThanOrEqual(100);
    }
  });

  it("movie costs a modest premium over classic — it is the IN-HOUSE engine", () => {
    // Repriced 2026-08-13 (owner directive): movie grade runs on the owned
    // cinematography stack, so its only extra marginal cost is render
    // compute — ~1.2x classic, not the ~10x of a rented video model. If this
    // ratio ever balloons, the movie grade has quietly gone back to renting.
    const ratio = costPaisePerMinute("movie") / costPaisePerMinute("classic");
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(2);
  });

  it("movie tiers cover the same durations the classic chart sells", () => {
    expect(MOVIE_TIERS.map((t) => t.seconds)).toEqual(PRICE_TIERS.map((t) => t.seconds));
  });
});
