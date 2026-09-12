/**
 * The policy, as a test (owner directive, 2026-08-15): ONE per-minute rate
 * per grade, ONE margin — 26% — with generation AND infrastructure (payment
 * fee + flat storage) recovered first.
 *
 * The mandate is now a FLOOR rather than a target. Under the old 28/26/21
 * ladder each duration aimed at its own number and drift in either direction
 * was a fault. With a flat rate the flat per-film cost is recovered once per
 * minute rather than once per film, so realised margin RISES with duration —
 * 28% at a minute, 32% at five net of GST. That is arithmetic, not drift, so
 * what is asserted is the floor plus strict linearity.
 *
 * The one exception is pinned honestly rather than excluded: 30 seconds
 * cannot clear the floor, because half a minute pays all of a flat cost and
 * collects half the rate. See storyPricingSql.test.ts.
 *
 * GST SPLIT THAT QUESTION IN TWO, AND THE REPRICE CLOSED IT (2026-08-16).
 * The rate was ₹57, solving for 26% BEFORE tax while the business banked
 * 11.2% — because a GST-inclusive price hands 18/118 of every rupee straight
 * back out. That gap was pinned here as a failing fact rather than smoothed
 * away, and the owner closed it by repricing to ₹75. Both margins are still
 * asserted, before tax and net of it, because the failure mode this file
 * exists to prevent is a margin that moves without anybody deciding it should
 * — in either direction.
 */
import { describe, expect, it } from "vitest";
import { PER_MINUTE_PAISE, PRICE_TIERS, priceForSeconds } from "@/lib/storyPricing";
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
  pricePaisePerMinute,
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
   * THE MANDATE IS MET NET OF GST, at ₹75/min — 28.3% for a one-minute film,
   * rising to 31.5% at five as the flat ₹3 per film is spread.
   *
   * The one-minute case is the worst case and is what the assertion leans on:
   * a rate that clears the floor only on long films is a rate that fails on
   * the length most people buy.
   */
  it("now CLEARS the mandate net of GST, which is the point of the reprice", () => {
    // This test used to assert the opposite. At ₹57 the realised margin was
    // 11.2% against a 26% mandate, and it was pinned as a fact rather than
    // smoothed away so the gap could not go unnoticed. The owner closed it on
    // 2026-08-16 by repricing to ₹75; the assertion flips with the decision.
    const oneMinute = oniqMarginAt("movie", 60, 9900);
    const fiveMinute = oniqMarginAt("movie", 300, 49500);
    expect(
      oneMinute,
      "the shortest film is the worst case and it must clear",
    ).toBeGreaterThanOrEqual(marginTargetFor());
    expect(oneMinute).toBeGreaterThan(0.41);
    expect(oneMinute).toBeLessThan(0.42);
    // Longer films keep more of the price: one flat per-film cost, more minutes.
    expect(fiveMinute).toBeGreaterThan(oneMinute);
    expect(fiveMinute).toBeLessThan(0.45);
  });

  it("prices the tax out of the price, not on top of it", () => {
    // 18/118, not 18/100. The difference is 2.7 points of margin and one
    // character in a diff.
    expect(GST_OF_INCLUSIVE_PRICE).toBeCloseTo(0.152542, 5);
    // Checked on the OLD ₹57 minute deliberately: ₹8.69 came out of it, and
    // added on top it would have been ₹10.26 — turning ₹57 into ₹67.26. That
    // is the mistake, kept here as a number so it cannot be made quietly, and
    // kept at the old price so the arithmetic stays hand-checkable.
    expect(gstPaiseOn(5700)).toBe(869);
    expect(Math.round(5700 * UNIT.gstRate)).toBe(1026);
  });

  it("publishes at or above the floor the formula derives", () => {
    // The floor is what 26% net of GST requires: ₹72. The PUBLISHED rate is
    // ₹75, the owner's round number above it. Holding one against the other
    // is what makes a cost rise that eats the ₹3 gap fail CI rather than
    // quietly eat the margin.
    const floor = pricePaisePerMinute("movie");
    expect(floor, "the derived floor moved").toBe(7200);
    expect(priceForMarginNetOfGst("movie")).toBe(floor);
    expect(PER_MINUTE_PAISE.movie, "prices moved without an owner decision").toBe(9900);
    expect(
      PER_MINUTE_PAISE.movie,
      `published ₹${PER_MINUTE_PAISE.movie / 100} is under the ₹${floor / 100} floor`,
    ).toBeGreaterThanOrEqual(floor);
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

  it("published prices are the PUBLISHED rate times minutes, exactly", () => {
    // priceFor() derives from the floor, and the published rate now sits
    // above it, so the two are deliberately no longer equal — comparing them
    // is how the ₹3 of headroom stays visible instead of being rounded away.
    for (const t of MOVIE_TIERS) {
      expect(t.pricePaise, `${t.label} is off the published line`).toBe(
        Math.round((PER_MINUTE_PAISE.movie * t.seconds) / 60),
      );
      expect(
        t.pricePaise,
        `${t.label} is priced below what the formula requires`,
      ).toBeGreaterThanOrEqual(priceFor("movie", t.seconds));
    }
    // Classic is withdrawn and its rate was left alone, so it still sits on
    // the derived line.
    for (const t of PRICE_TIERS) {
      expect(Math.abs(priceForSeconds("classic", t.seconds) - t.pricePaise)).toBeLessThanOrEqual(
        100,
      );
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
