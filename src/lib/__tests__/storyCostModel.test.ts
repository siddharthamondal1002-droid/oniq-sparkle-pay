/**
 * The price chart must clear its margin floor AT THE WRITTEN UNIT COSTS.
 *
 * This is the "do the number" test: if someone updates a unit cost (Veo gets
 * a real measured price, the rupee moves, the image model reprices) and a
 * published tier quietly goes underwater, this fails before the chart does.
 * The floor is deliberately below the design margins (~55–70%) so ordinary
 * drift doesn't cry wolf; a tier within ten points of cost is the alarm.
 */
import { describe, expect, it } from "vitest";
import { PRICE_TIERS } from "@/lib/storyPricing";
import { MOVIE_TIERS, costPaisePerMinute, tierMargin } from "@/lib/storyCostModel";

const MARGIN_FLOOR = 0.4;

describe("story pricing clears the margin floor at written unit costs", () => {
  it("classic tiers", () => {
    for (const t of PRICE_TIERS) {
      const m = tierMargin("classic", t.seconds, t.pricePaise);
      expect(m, `${t.label} margin ${(m * 100).toFixed(0)}%`).toBeGreaterThan(MARGIN_FLOOR);
    }
  });

  it("movie tiers", () => {
    for (const t of MOVIE_TIERS) {
      const m = tierMargin("movie", t.seconds, t.pricePaise);
      expect(m, `${t.label} margin ${(m * 100).toFixed(0)}%`).toBeGreaterThan(MARGIN_FLOOR);
    }
  });

  it("movie costs roughly 10x classic to make — the number that forced two grades", () => {
    const ratio = costPaisePerMinute("movie") / costPaisePerMinute("classic");
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(40);
  });

  it("movie tiers cover the same durations the classic chart sells", () => {
    expect(MOVIE_TIERS.map((t) => t.seconds)).toEqual(PRICE_TIERS.map((t) => t.seconds));
  });
});
