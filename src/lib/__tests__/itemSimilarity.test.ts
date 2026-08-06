/**
 * The anti-memorisation screen, proved in both directions.
 *
 * A screen that quarantines everything is as useless as one that quarantines
 * nothing, so every test below has a partner: a near-copy must be caught, and
 * an independent question on the SAME topic must not be. The second half is
 * the one that keeps the feature usable.
 */
import { describe, expect, it } from "vitest";
import {
  QUARANTINE_JACCARD,
  QUARANTINE_RUN,
  jaccard,
  longestSharedRun,
  screenItem,
  shingles,
  words,
  wordsDigitBlind,
} from "@/lib/itemSimilarity";

const SOURCE = {
  label: "known-item-1",
  text: "A cyclist covers a distance of 12 km in 40 minutes moving at a steady speed along a level road. Calculate her average speed in kilometres per hour.",
};

describe("primitives", () => {
  it("tokenises and strips punctuation", () => {
    expect(words("Speed, in km/h?")).toEqual(["speed", "in", "km", "h"]);
  });

  it("blinds digits so renumbering does not launder a copy", () => {
    expect(wordsDigitBlind("12 km in 40 minutes")).toEqual(["#", "km", "in", "#", "minutes"]);
  });

  it("builds 5-grams and handles short text without crashing", () => {
    expect(shingles(["a", "b", "c", "d", "e", "f"]).size).toBe(2);
    expect(shingles(["a", "b"]).size).toBe(1);
    expect(shingles([]).size).toBe(0);
  });

  it("measures jaccard and the longest shared run", () => {
    expect(jaccard(new Set(["x"]), new Set(["x"]))).toBe(1);
    expect(jaccard(new Set(["x"]), new Set(["y"]))).toBe(0);
    expect(longestSharedRun(["a", "b", "c", "d"], ["z", "b", "c", "q"])).toBe(2);
    expect(longestSharedRun([], ["a"])).toBe(0);
  });
});

describe("it catches what it is for", () => {
  it("quarantines a verbatim copy", () => {
    const v = screenItem(SOURCE.text, [SOURCE]);
    expect(v.quarantine).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(QUARANTINE_JACCARD);
    expect(v.matchedAgainst).toBe("known-item-1");
  });

  it("quarantines a copy with only the numbers changed", () => {
    // A numerically altered copy is a derivative work, not a new item. This is
    // the specific laundering the digit-blind pass exists to defeat.
    const v = screenItem(
      "A cyclist covers a distance of 18 km in 45 minutes moving at a steady speed along a level road. Calculate her average speed in kilometres per hour.",
      [SOURCE],
    );
    expect(v.quarantine).toBe(true);
    expect(v.reason).toBeTruthy();
  });

  it("quarantines one memorised sentence buried in fresh text", () => {
    // Jaccard alone dilutes to nothing here — the surrounding text is new.
    // The shared-run check is what catches it.
    const v = screenItem(
      "Look at the data table below and answer the questions that follow about local transport. A cyclist covers a distance of 12 km in 40 minutes moving at a steady speed along a level road. Then compare that with the bus timings given and comment on which is quicker over the same route on a weekday.",
      [SOURCE],
    );
    expect(v.quarantine).toBe(true);
    expect(v.longestRun).toBeGreaterThanOrEqual(QUARANTINE_RUN);
  });
});

describe("it leaves independent work alone", () => {
  it("clears a different question on the very same syllabus point", () => {
    // Same topic, same units, same competency — and it must still pass, or
    // the screen makes the subject unteachable.
    const v = screenItem(
      "Meera walks to the market in 25 minutes and returns by the same route in 15 minutes. What was her average speed for the whole trip if the market is 2 km away?",
      [SOURCE],
    );
    expect(v.quarantine).toBe(false);
    expect(v.score).toBeLessThan(QUARANTINE_JACCARD);
  });

  it("clears an item when the corpus is empty", () => {
    const v = screenItem(SOURCE.text, []);
    expect(v.quarantine).toBe(false);
    expect(v.matchedAgainst).toBeNull();
    expect(v.score).toBe(0);
  });

  it("does not fire on shared boilerplate alone", () => {
    const v = screenItem("Calculate her average speed in kilometres per hour.", [SOURCE]);
    // A shared closing instruction is not a copied item. Nine words is under
    // the run threshold on purpose — the threshold is set above clause length.
    expect(v.longestRun).toBeLessThan(QUARANTINE_RUN);
    expect(v.quarantine).toBe(false);
  });
});

describe("the score is fit for the column it lands in", () => {
  it("rounds to three decimals, matching numeric(4,3)", () => {
    const v = screenItem(SOURCE.text, [SOURCE]);
    expect(v.score).toBe(Math.round(v.score * 1000) / 1000);
    expect(v.score).toBeLessThanOrEqual(1);
    expect(v.score).toBeGreaterThanOrEqual(0);
  });

  it("names what it matched, so the quarantine reason is actionable", () => {
    const v = screenItem(SOURCE.text, [SOURCE]);
    expect(v.reason).toContain("known-item-1");
  });
});
