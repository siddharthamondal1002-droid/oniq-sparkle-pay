/**
 * The bed has to stay out of the narrator's way and it has to not pump.
 *
 * Both failures are audible and neither is visible: a still-frame check, a
 * file size and a duration all look identical whether the mix is right or the
 * music is sitting on top of the voice. So the mixing decisions are asserted
 * here rather than discovered on playback.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUCK,
  applyEdgeFades,
  layOnTimeline,
  sceneStartFrames,
  speechToGain,
} from "@/lib/audioDuck";

/** n frames of silence, then n frames of loud speech, then n of silence. */
function pulse(n: number, level = 1): number[] {
  return [...Array<number>(n).fill(0), ...Array<number>(n).fill(level), ...Array<number>(n).fill(0)];
}

describe("scene starts account for the transition overlap", () => {
  it("advances by the scene length minus one overlap", () => {
    // Three 100-frame scenes overlapping by 10 start at 0, 90, 180 — not
    // 0, 100, 200. Using the naive sum slides the envelope progressively out
    // of sync with the voice, worsening through the episode.
    expect(sceneStartFrames([100, 100, 100], 10)).toEqual([0, 90, 180]);
  });

  it("is the identity when nothing overlaps", () => {
    expect(sceneStartFrames([100, 50, 25], 0)).toEqual([0, 100, 150]);
  });

  it("matches the total-length arithmetic the manifest uses", () => {
    const frames = [120, 90, 60];
    const transition = 15;
    const starts = sceneStartFrames(frames, transition);
    const end = starts[starts.length - 1] + frames[frames.length - 1];
    // Same formula as EP*_TOTAL: sum minus one overlap per join.
    const expected = frames.reduce((a, b) => a + b, 0) - transition * (frames.length - 1);
    expect(end).toBe(expected);
  });
});

describe("the bed gets out of the way of the voice", () => {
  const gain = speechToGain(pulse(120));

  it("settles near the quiet level while speech continues", () => {
    // Sampled well after the attack has had time to complete.
    expect(gain[220]).toBeCloseTo(DEFAULT_DUCK.under, 2);
  });

  it("returns toward the loud level once speech stops", () => {
    const last = gain[gain.length - 1];
    expect(last).toBeGreaterThan(DEFAULT_DUCK.under * 2);
    expect(last).toBeLessThanOrEqual(DEFAULT_DUCK.alone);
  });

  it("never exceeds the alone level or drops below the under level", () => {
    for (const g of speechToGain(pulse(60, 0.9))) {
      expect(g).toBeLessThanOrEqual(DEFAULT_DUCK.alone + 1e-9);
      expect(g).toBeGreaterThanOrEqual(DEFAULT_DUCK.under - 1e-9);
    }
  });

  it("ignores levels under the threshold, so room tone does not duck it", () => {
    // A near-silent lead-in must not pin the bed down for the whole episode.
    const quiet = Array<number>(90).fill(DEFAULT_DUCK.threshold / 2);
    const gains = speechToGain(quiet);
    expect(gains[gains.length - 1]).toBeCloseTo(DEFAULT_DUCK.alone, 3);
  });
});

describe("it does not pump", () => {
  it("falls faster than it rises", () => {
    // Asymmetry is the anti-pumping property. If release were as fast as
    // attack, the bed would surge in every gap between words.
    expect(DEFAULT_DUCK.releaseFrames).toBeGreaterThan(DEFAULT_DUCK.attackFrames * 3);
  });

  it("changes gain smoothly, never in a step", () => {
    // A hard switch at the threshold is an audible click, and on a sustained
    // pad it is very audible. The largest single-frame jump must stay small
    // relative to the full range.
    const gain = speechToGain(pulse(90));
    const range = DEFAULT_DUCK.alone - DEFAULT_DUCK.under;
    let biggest = 0;
    for (let i = 1; i < gain.length; i++) {
      biggest = Math.max(biggest, Math.abs(gain[i] - gain[i - 1]));
    }
    expect(biggest).toBeLessThan(range * 0.25);
  });

  it("rides through a comma instead of surging", () => {
    // Six frames of silence mid-sentence — a breath, not a gap. The bed must
    // barely move.
    const speech = [...Array<number>(90).fill(1), ...Array<number>(6).fill(0), ...Array<number>(90).fill(1)];
    const gain = speechToGain(speech);
    const duringGap = Math.max(...gain.slice(90, 96));
    expect(duringGap).toBeLessThan(DEFAULT_DUCK.under + (DEFAULT_DUCK.alone - DEFAULT_DUCK.under) * 0.2);
  });
});

describe("overlapping scenes do not read as a gap", () => {
  it("takes the louder of two overlapping narrations", () => {
    // During a cross-dissolve both scenes are audible. Overwriting with the
    // later scene would show a hole wherever its narration had not started
    // yet, and the bed would swell straight into the next line.
    const a = [1, 1, 1, 1];
    const b = [0, 0, 1, 1];
    const timeline = layOnTimeline([a, b], [0, 2], 6);
    expect(timeline).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("drops anything past the end of the episode", () => {
    expect(layOnTimeline([[1, 1, 1]], [2], 4)).toEqual([0, 0, 1, 1]);
  });
});

describe("edge fades", () => {
  it("starts silent and ends silent", () => {
    const faded = applyEdgeFades(Array<number>(100).fill(0.5), 10, 10);
    expect(faded[0]).toBe(0);
    expect(faded[faded.length - 1]).toBe(0);
    expect(faded[50]).toBe(0.5);
  });

  it("leaves the middle untouched and preserves length", () => {
    const gain = Array<number>(50).fill(0.3);
    const faded = applyEdgeFades(gain, 5, 5);
    expect(faded).toHaveLength(50);
    expect(faded[25]).toBe(0.3);
    // Pure: the input array is not modified in place.
    expect(gain[0]).toBe(0.3);
  });
});
