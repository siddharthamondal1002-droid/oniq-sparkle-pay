/**
 * The one property that matters: no tier is sold for less than it costs.
 *
 * A price chart is a place where an arithmetic slip is invisible until it is a
 * bill. The cost side here is derived from planStory and from measured render
 * speed, so a change to the shot rate — or a rise in a provider's price —
 * moves the cost and can quietly cross a published price. This file is what
 * turns that into a failing test instead of a monthly surprise.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  MIN_MARGIN,
  PRICE_TIERS,
  type StoryCostRates,
  costOf,
  priceChart,
  priceFor,
} from "@/lib/storyPricing";

describe("no Story is sold below what it costs", () => {
  it("clears the margin on every tier", () => {
    for (const tier of priceChart()) {
      expect(
        tier.margin,
        `${tier.label} is priced at ${tier.pricePaise} paise against a cost of ` +
          `${tier.cost.totalPaise} — margin ${tier.margin.toFixed(2)}, floor ${MIN_MARGIN}`,
      ).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });

  it("still clears it if the unverified rates turn out to be double", () => {
    // THE RATES ARE THE WEAK PART. Two of the four are placeholders, so the
    // chart has to survive being wrong about them — not by a rounding error,
    // but by a factor. If this fails, the prices are resting on a guess.
    const doubled: StoryCostRates = {
      imagePaise: DEFAULT_RATES.imagePaise * 2,
      ttsPaisePerSecond: DEFAULT_RATES.ttsPaisePerSecond * 2,
      plotPaise: DEFAULT_RATES.plotPaise * 2,
      runnerPaisePerMinute: DEFAULT_RATES.runnerPaisePerMinute,
    };
    for (const tier of priceChart(doubled)) {
      expect(tier.margin, `${tier.label} loses money at double the assumed rates`).toBeGreaterThan(
        1,
      );
    }
  });
});

describe("the shape of the chart", () => {
  it("never charges more per minute for a longer film, past the first minute", () => {
    // Below a minute the per-minute figure is flat, because the shot count is
    // still climbing faster than the clock (4 shots at 30s, 9 at 60s) and there
    // is no economy of scale to pass on yet. From a minute up there is, and a
    // chart where a longer film cost MORE per minute would be indefensible at
    // the till — so that half is asserted rather than left to good intentions.
    const fromAMinute = priceChart().filter((t) => t.seconds >= 60);
    for (let i = 1; i < fromAMinute.length; i++) {
      expect(
        fromAMinute[i].perMinutePaise,
        `${fromAMinute[i].label} costs more per minute than ${fromAMinute[i - 1].label}`,
      ).toBeLessThanOrEqual(fromAMinute[i - 1].perMinutePaise);
    }
  });

  it("offers a longer film for more money, always", () => {
    const chart = priceChart();
    for (let i = 1; i < chart.length; i++) {
      expect(chart[i].pricePaise).toBeGreaterThan(chart[i - 1].pricePaise);
    }
  });
});

describe("the cost model behaves like the thing it models", () => {
  it("costs more for a longer film", () => {
    const lengths = PRICE_TIERS.map((t) => costOf(t.seconds).totalPaise);
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i], `tier ${i} is not dearer than tier ${i - 1}`).toBeGreaterThan(
        lengths[i - 1],
      );
    }
  });

  it("charges the fixed runner boot to short films hardest", () => {
    // The reason the chart is per Story and not a flat per-minute rate. A
    // 30-second film is not a tenth of a five-minute one, because 75 seconds of
    // Chromium download is paid either way — and pricing per minute would
    // either overcharge the long film or lose money on the short one.
    const short = costOf(30);
    const long = costOf(300);
    const shortPerSecond = short.totalPaise / short.seconds;
    const longPerSecond = long.totalPaise / long.seconds;
    expect(shortPerSecond).toBeGreaterThan(longPerSecond);
  });

  it("itemises to the total, so a surprising bill can be explained", () => {
    const c = costOf(60);
    const summed =
      c.breakdown.plot + c.breakdown.images + c.breakdown.narration + c.breakdown.runner;
    expect(summed).toBe(c.totalPaise);
  });

  it("prices images per shot, from the same planner the renderer uses", () => {
    // Not a second copy of the shot maths. If planStory changes, this moves.
    const c = costOf(60);
    expect(c.breakdown.images).toBe(c.shots * DEFAULT_RATES.imagePaise);
    expect(c.shots).toBe(9); // measured: 8.5 shots a minute
  });
});

describe("quoting a length", () => {
  it("rounds UP to the next tier rather than interpolating", () => {
    // Interpolating would quote a price for a length no tier was costed
    // against. Rounding up is the honest direction: the user gets the longer
    // allowance they paid for.
    expect(priceFor(30)?.seconds).toBe(30);
    expect(priceFor(31)?.seconds).toBe(60);
    expect(priceFor(90)?.seconds).toBe(120);
    expect(priceFor(121)?.seconds).toBe(180);
    expect(priceFor(300)?.seconds).toBe(300);
  });

  it("refuses a length past the longest tier instead of guessing", () => {
    // MAX_STORY_SECONDS is 600 and the chart stops at 300. Returning the
    // 5-minute price for a 10-minute film would sell twice the render for the
    // same money; null makes the caller decide.
    expect(priceFor(600)).toBeNull();
  });
});
