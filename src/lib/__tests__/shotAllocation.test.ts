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
  snapCutsToPauses,
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

/**
 * Snapping moves the cuts and must not move anything else.
 *
 * The sum is the invariant that matters, for exactly the reason at the top of
 * this file: a scene that gains or loses a frame moves every scene after it.
 * Everything else here is a constraint that, if it slipped, would produce an
 * edit that is worse than the weighted one it replaced — a shot too short to
 * read, or a shot longer than the clip that has to fill it.
 */
describe("snapCutsToPauses puts cuts on the language", () => {
  const LOOSE = { maxShift: 45, minFrames: 45 };

  it("moves a cut onto a nearby pause", () => {
    // Cut sits at 100; a pause at 108 is 8 frames away.
    expect(snapCutsToPauses([100, 100], [108], LOOSE)).toEqual([108, 92]);
  });

  it("keeps the total identical, whatever it does", () => {
    const pauses = [17, 44, 90, 131, 168, 212, 255, 301, 340, 388];
    for (let n = 1; n <= 6; n++) {
      for (let total = 300; total <= 1400; total += 37) {
        const weights = Array.from({ length: n }, (_, i) => 1 + (i % 3) * 0.4);
        const frames = allocateFrames(weights, total);
        const snapped = snapCutsToPauses(frames, pauses, LOOSE);
        expect(snapped.reduce((a, b) => a + b, 0), `${n} shots, ${total} frames`).toBe(total);
        expect(snapped.length).toBe(frames.length);
      }
    }
  });

  /**
   * Added after a mutation that changed "nearest legal pause" to "furthest"
   * passed the whole suite. Every other test only constrained the sum and the
   * floor, both of which a furthest-match satisfies just as well — while moving
   * the cut five times further from where the shot list intended it.
   */
  it("picks the nearest legal pause when several are in range", () => {
    // Cut at 100. Pauses at 90 (10 away) and 150 (50 away), both legal.
    expect(snapCutsToPauses([100, 100], [90, 150], { maxShift: 60, minFrames: 45 })).toEqual([
      90, 110,
    ]);
  });

  it("breaks an equidistant tie toward the earlier pause", () => {
    // 90 and 110 are both 10 frames from the cut. It has to be the same one
    // every run, for the reason allocateFrames breaks its ties deterministically.
    expect(snapCutsToPauses([100, 100], [90, 110], { maxShift: 60, minFrames: 45 })).toEqual([
      90, 110,
    ]);
  });

  it("refuses to drag a cut further than maxShift", () => {
    // The only pause is 40 frames away and the budget is 10.
    expect(snapCutsToPauses([100, 100], [140], { maxShift: 10, minFrames: 10 })).toEqual([100, 100]);
  });

  it("never produces a shot below the floor", () => {
    // A pause at 12 would leave a 12-frame first shot.
    expect(snapCutsToPauses([100, 100], [12], { maxShift: 200, minFrames: 45 })).toEqual([100, 100]);
  });

  it("will not lengthen a shot past the frames its clip actually has", () => {
    // The cut would happily move right to the pause at 130, but shot 0's source
    // only has 110 frames. This is the constraint that decides whether the fix
    // needs the raw generations or a regeneration.
    const capped = snapCutsToPauses([100, 100], [130], {
      maxShift: 60,
      minFrames: 20,
      maxFrames: [110, 200],
    });
    expect(capped).toEqual([100, 100]);

    // Same cut, same pause, with the raw clip's real headroom: it moves.
    const free = snapCutsToPauses([100, 100], [130], {
      maxShift: 60,
      minFrames: 20,
      maxFrames: [301, 301],
    });
    expect(free).toEqual([130, 70]);
  });

  /**
   * This replaced a test that asserted "two cuts never take the same pause".
   * That test passed against an implementation with the collision guard REMOVED
   * — it was vacuous, because the cut ordering already made a collision
   * impossible and the guard was unreachable. The guard is gone; what is worth
   * testing is the property that made it unnecessary, on inputs where a naive
   * nearest-pause pass really would collapse two cuts onto one frame.
   */
  it("keeps every shot at or above the floor when pauses cluster", () => {
    // Three cuts, and a dense knot of pauses that a per-cut nearest-match would
    // happily drag all of them into.
    const frames = [100, 100, 100, 100];
    const pauses = [148, 150, 151, 152, 155];
    const out = snapCutsToPauses(frames, pauses, { maxShift: 160, minFrames: 45 });
    expect(out.reduce((a, b) => a + b, 0)).toBe(400);
    for (const [i, f] of out.entries()) {
      expect(f, `shot ${i} of ${JSON.stringify(out)}`).toBeGreaterThanOrEqual(45);
    }
  });

  it("keeps cuts strictly increasing across a fuzz of pause layouts", () => {
    for (let seed = 1; seed <= 200; seed++) {
      // Deterministic pseudo-random layouts; no clock, no Math.random.
      const pauses = Array.from({ length: 12 }, (_, i) => ((seed * 37 + i * 53) % 900) + 20);
      const frames = allocateFrames([1, 1.3, 0.8, 1.1, 0.9], 1000);
      const out = snapCutsToPauses(frames, pauses, { maxShift: 60, minFrames: 45 });
      expect(out.reduce((a, b) => a + b, 0), `seed ${seed}`).toBe(1000);
      for (const f of out) expect(f, `seed ${seed}: ${JSON.stringify(out)}`).toBeGreaterThanOrEqual(45);
    }
  });

  it("leaves a single-shot scene alone", () => {
    expect(snapCutsToPauses([250], [10, 20, 30], LOOSE)).toEqual([250]);
  });

  it("is a no-op when there are no pauses to snap to", () => {
    const frames = allocateFrames([1, 2, 1.5], 900);
    expect(snapCutsToPauses(frames, [], LOOSE)).toEqual(frames);
  });

  it("rejects inputs it cannot honour", () => {
    expect(() => snapCutsToPauses([], [1], LOOSE)).toThrow(/no shots/);
    expect(() => snapCutsToPauses([10.5, 20], [1], LOOSE)).toThrow(/integers/);
    expect(() => snapCutsToPauses([10, 20], [1], { maxShift: -1, minFrames: 45 })).toThrow(
      /maxShift/,
    );
    expect(() =>
      snapCutsToPauses([10, 20], [1], { maxShift: 5, minFrames: 1, maxFrames: [10] }),
    ).toThrow(/maxFrames has 1 entries for 2 shots/);
  });
});
