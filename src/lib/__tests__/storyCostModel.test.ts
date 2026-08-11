/**
 * Every published price must sit ON its mandated margin, at the written unit
 * costs: 28% for the shortest films, 26% mid, 21% for the longest, with
 * generation AND infrastructure (payment fee + storage) recovered first.
 *
 * This is the policy-as-test: if a unit cost moves (Veo gets a measured
 * price, the rupee slides, the image model reprices) and a tier drifts off
 * its mandated margin, this fails before the chart lies. Tolerance is 1.5
 * points — whole-rupee price rounding costs a few tenths, real drift costs
 * more.
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
  it("classic tiers hit their duration's margin target", () => {
    for (const t of PRICE_TIERS) {
      const m = oniqMarginAt("classic", t.seconds, t.pricePaise);
      const target = marginTargetFor(t.seconds);
      expect(
        Math.abs(m - target),
        `${t.label}: margin ${(m * 100).toFixed(1)}% vs target ${target * 100}%`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("movie tiers hit their duration's margin target", () => {
    for (const t of MOVIE_TIERS) {
      const m = oniqMarginAt("movie", t.seconds, t.pricePaise);
      const target = marginTargetFor(t.seconds);
      expect(
        Math.abs(m - target),
        `${t.label}: margin ${(m * 100).toFixed(1)}% vs target ${target * 100}%`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("margins DESCEND with duration — the affordability shape of the policy", () => {
    expect(marginTargetFor(30)).toBeGreaterThan(marginTargetFor(60));
    expect(marginTargetFor(120)).toBeGreaterThan(marginTargetFor(180));
    expect(marginTargetFor(30)).toBe(0.28);
    expect(marginTargetFor(120)).toBe(0.26);
    expect(marginTargetFor(300)).toBe(0.21);
  });

  it("published prices are within one rounding step of the formula", () => {
    for (const t of PRICE_TIERS) {
      expect(Math.abs(priceFor("classic", t.seconds) - t.pricePaise)).toBeLessThanOrEqual(100);
    }
    for (const t of MOVIE_TIERS) {
      expect(Math.abs(priceFor("movie", t.seconds) - t.pricePaise)).toBeLessThanOrEqual(100);
    }
  });

  it("movie still costs roughly 10x classic to make", () => {
    const ratio = costPaisePerMinute("movie") / costPaisePerMinute("classic");
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(40);
  });

  it("movie tiers cover the same durations the classic chart sells", () => {
    expect(MOVIE_TIERS.map((t) => t.seconds)).toEqual(PRICE_TIERS.map((t) => t.seconds));
  });
});
