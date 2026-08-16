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
 *
 * GST SPLITS THAT QUESTION IN TWO (2026-08-16). The chart still clears 26%
 * BEFORE TAX — that is what the formula solves for and marginBeforeTaxAt is
 * what checks it. What ONIQ actually banks, on a GST-inclusive price, is
 * about 11-15%. Both numbers are asserted here. Neither is quietly dropped,
 * because the failure mode this file exists to prevent is a margin that moves
 * without anybody deciding it should.
 */
import { describe, expect, it } from "vitest";
import { PER_MINUTE_PAISE, PRICE_TIERS } from "@/lib/storyPricing";
import {
  MOVIE_TIERS,
  UNIT,
  costPaisePerMinute,
  marginTargetFor,
  GST_OF_INCLUSIVE_PRICE,
  gstPaiseOn,
  marginBeforeTaxAt,
  oniqMarginAt,
  priceForMarginNetOfGst,
  priceFor,
} from "@/lib/storyCostModel";

const TOLERANCE = 0.015;

describe("story pricing sits on the mandated margins", () => {
  it("clears the 26% floor BEFORE TAX at every duration of a minute or more", () => {
    // The question this chart was built to answer, and it still answers it:
    // pricePaisePerMinute solves for exactly this and the rows are its output.
    for (const grade of ["classic", "movie"] as const) {
      const rows = grade === "classic" ? PRICE_TIERS : MOVIE_TIERS;
      for (const t of rows.filter((r) => r.seconds >= 60)) {
        const m = marginBeforeTaxAt(grade, t.seconds, t.pricePaise);
        expect(
          m,
          `${t.label}: ${(m * 100).toFixed(1)}% is under the 26% floor before tax`,
        ).toBeGreaterThanOrEqual(marginTargetFor() - TOLERANCE);
      }
    }
  });

  /**
   * AND THE MANDATE IS NOT MET ONCE GST IS COUNTED. That is recorded here as
   * a fact rather than smoothed away, because the alternative — quietly
   * dropping the assertion, or quietly raising the prices — is how a 26%
   * mandate becomes an 11% business without anybody deciding to.
   *
   * The published price is GST-inclusive (owner, 2026-08-16), so 18/118 of
   * every rupee taken is tax that arrives and leaves again. At ₹57/min the
   * realised margin is ~11% at one minute, rising toward ~15% at five as the
   * flat ₹3 per film is spread over more minutes.
   *
   * priceForMarginNetOfGst() says what the rate would have to be — ₹72/min.
   * Whether to go there is the owner's call; this test only refuses to let
   * the gap go unnoticed, and will fail if it moves in either direction.
   */
  it("records the realised margin net of GST, which is BELOW the mandate", () => {
    const oneMinute = oniqMarginAt("movie", 60, 5700);
    const fiveMinute = oniqMarginAt("movie", 300, 28500);
    expect(oneMinute).toBeLessThan(marginTargetFor());
    expect(oneMinute).toBeGreaterThan(0.1);
    expect(oneMinute).toBeLessThan(0.13);
    // Longer films keep more of the price: one flat per-film cost, more minutes.
    expect(fiveMinute).toBeGreaterThan(oneMinute);
    expect(fiveMinute).toBeLessThan(0.17);
  });

  it("prices the tax out of the price, not on top of it", () => {
    // 18/118, not 18/100. The difference is 2.7 points of margin and one
    // character in a diff.
    expect(GST_OF_INCLUSIVE_PRICE).toBeCloseTo(0.152542, 5);
    // ₹8.69 of the ₹57 minute. Added on top it would have been ₹10.26, and
    // the ₹57 would have become ₹67.26 — which is the mistake, stated as a
    // number so it cannot be made quietly.
    expect(gstPaiseOn(5700)).toBe(869);
    expect(Math.round(5700 * UNIT.gstRate)).toBe(1026);
  });

  it("computes what the rate would have to be, without applying it", () => {
    // Wired to nothing on purpose: repricing is an owner decision, and this
    // exists so the decision has an arithmetic answer to look at.
    expect(priceForMarginNetOfGst("movie")).toBe(7200);
    expect(PER_MINUTE_PAISE.movie, "prices moved without an owner decision").toBe(5700);
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
