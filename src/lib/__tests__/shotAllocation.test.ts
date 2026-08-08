/**
 * The one property that matters here is that the split is EXACT.
 *
 * Episode 3's clips sit inside scene blocks whose offsets the music duck, the
 * narration mounts and every later scene all depend on. A one-frame rounding
 * error inside scene 3 moves scenes 4 through 16, and it looks perfect in every
 * still. So the sum is tested against a wide sweep of inputs rather than a
 * couple of hand-picked ones.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SHOT_SECONDS,
  MIN_SHOT_SECONDS,
  allocateFrames,
  checkShotFrames,
  minimumShots,
} from "@/lib/shotAllocation";

describe("allocateFrames splits a scene exactly", () => {
  it("sums to the total for every shape of input", () => {
    // A sweep rather than examples: rounding bugs hide in specific remainders,
    // and the whole point is that no remainder is allowed to escape.
    const weightSets = [
      [1],
      [1, 1],
      [1, 1, 1],
      [1, 2],
      [2, 1],
      [1, 1, 1, 1, 1],
      [0.9, 1.1, 1, 0.9],
      [3, 1, 1, 1, 1, 1, 1],
      [1, 1000],
      [7, 7, 7],
    ];
    for (const weights of weightSets) {
      for (let total = weights.length; total <= 1400; total += 7) {
        const frames = allocateFrames(weights, total);
        expect(
          frames.reduce((a, b) => a + b, 0),
          `weights ${JSON.stringify(weights)} total ${total}`,
        ).toBe(total);
        expect(frames.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it("gives a heavier shot more frames than a lighter one", () => {
    const [a, b, c] = allocateFrames([1, 2, 3], 600);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect([a, b, c]).toEqual([100, 200, 300]);
  });

  it("is within one frame of the ideal share", () => {
    // Largest remainder's actual guarantee. A naive floor would be up to n-1
    // frames light on the last shot, which this catches.
    const weights = [0.9, 1.1, 1, 0.9, 1.2];
    const total = 1000;
    const sum = weights.reduce((x, y) => x + y, 0);
    for (const [i, f] of allocateFrames(weights, total).entries()) {
      expect(Math.abs(f - (total * weights[i]) / sum)).toBeLessThan(1);
    }
  });

  it("breaks fractional ties toward the earlier shot", () => {
    // Three equal shots over 100 frames: 33.33 each, one frame left over.
    // It has to go somewhere, and it has to go there every single run.
    expect(allocateFrames([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(allocateFrames([1, 1, 1], 100)).toEqual(allocateFrames([1, 1, 1], 100));
  });

  it("rejects weights that cannot mean anything", () => {
    expect(() => allocateFrames([], 100)).toThrow(/no shots/);
    expect(() => allocateFrames([1, 0], 100)).toThrow(/weight 1 is 0/);
    expect(() => allocateFrames([1, -1], 100)).toThrow(/weight 1 is -1/);
    expect(() => allocateFrames([1, NaN], 100)).toThrow(/finite and positive/);
    expect(() => allocateFrames([1, 1], 100.5)).toThrow(/not an integer/);
    expect(() => allocateFrames([1, 1], -1)).toThrow(/negative/);
  });

  it("can still starve a shot to zero, which is why the check exists", () => {
    // Exactness does NOT imply usability: a wild weight ratio produces a
    // zero-frame shot that sums correctly and renders as nothing at all.
    // allocateFrames stays honest arithmetic; checkShotFrames is the guard.
    const frames = allocateFrames([1, 1000], 100);
    expect(frames.reduce((a, b) => a + b, 0)).toBe(100);
    expect(frames[0]).toBe(0);
    expect(checkShotFrames(frames, 30).some((v) => v.reason === "too-short")).toBe(true);
  });
});

describe("checkShotFrames catches what the generator cannot make", () => {
  const FPS = 30;

  it("passes a shot at exactly the ceiling", () => {
    // 10.000s is generatable. Rejecting it would force a pointless extra clip
    // on any scene whose arithmetic happens to land square on the limit.
    expect(checkShotFrames([MAX_SHOT_SECONDS * FPS], FPS)).toEqual([]);
  });

  it("fails a shot one frame over the ceiling", () => {
    const [v] = checkShotFrames([MAX_SHOT_SECONDS * FPS + 1], FPS);
    expect(v.reason).toBe("too-long");
    expect(v.index).toBe(0);
    expect(v.seconds).toBeCloseTo(10.033, 3);
  });

  it("passes a shot at exactly the floor and fails one below it", () => {
    expect(checkShotFrames([MIN_SHOT_SECONDS * FPS], FPS)).toEqual([]);
    expect(checkShotFrames([MIN_SHOT_SECONDS * FPS - 1], FPS)[0].reason).toBe("too-short");
  });

  it("reports every bad shot, not just the first", () => {
    // Finding these one paid render at a time is the failure this prevents.
    const violations = checkShotFrames([301, 150, 10, 400], FPS);
    expect(violations.map((v) => v.index)).toEqual([0, 2, 3]);
    expect(violations.map((v) => v.reason)).toEqual(["too-long", "too-short", "too-long"]);
  });

  it("honours overridden limits", () => {
    expect(checkShotFrames([200], FPS, { maxSeconds: 5 })[0].reason).toBe("too-long");
    expect(checkShotFrames([200], FPS, { maxSeconds: 5, minSeconds: 0 }).length).toBe(1);
  });
});

describe("minimumShots sizes a scene before its audio exists", () => {
  it("never returns a count whose shots would exceed the ceiling", () => {
    for (let s = 0.5; s <= 90; s += 0.5) {
      const n = minimumShots(s);
      expect(s / n, `${s}s over ${n} shots`).toBeLessThanOrEqual(MAX_SHOT_SECONDS);
    }
  });

  it("does not add a shot for a scene that lands exactly on the ceiling", () => {
    expect(minimumShots(10)).toBe(1);
    expect(minimumShots(20)).toBe(2);
    expect(minimumShots(20.1)).toBe(3);
  });

  it("rejects a duration that is not one", () => {
    expect(() => minimumShots(0)).toThrow(/positive duration/);
    expect(() => minimumShots(-3)).toThrow(/positive duration/);
    expect(() => minimumShots(NaN)).toThrow(/positive duration/);
  });
});
