// Camera motion vs subject motion — the ONIQ Director's sharpest check.
//
// Owner directive 2026-08-27 (the film reviewer): a shot that asked for
// "she turns toward the camera" and delivered a static figure under a slow
// pan has FAILED, even though every frame differs from the last. These
// tests build the two cases as pixels and prove the measure separates them.
import { describe, expect, it } from "vitest";
import type { RawImage } from "../sheetPanel";
import {
  GLOBAL_MOTION_SEARCH_PX,
  splitMotion,
  subjectMotionRatio,
  temporalAliveness,
} from "../motionRuntime";

const W = 96;
const H = 64;

/**
 * Video-like content: a smooth low-frequency field, because that is what a
 * generated clip looks like. An early version of this fixture used a
 * high-frequency wrapping ramp and the compensator aliased on it — it
 * recovered a shift of -1 for a true pan of +2. The fixture was the fault,
 * and swapping it fixed the recovery, which is itself worth pinning.
 */
function field(x: number, y: number): number {
  return 40 + 60 * Math.sin(x / 28) + 40 * Math.cos(y / 22) + 30 * Math.sin((x + y) / 40);
}

function frame(cameraX: number, subject: { x: number; y: number } | null): RawImage {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, field(x + cameraX, y)));
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  if (subject) {
    for (let y = subject.y; y < subject.y + 12 && y < H; y++) {
      for (let x = subject.x; x < subject.x + 12 && x < W; x++) {
        const i = (y * W + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 245;
        data[i + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data };
}

/** The four cases the reviewer has to tell apart. */
const FROZEN = [frame(0, { x: 20, y: 20 }), frame(0, { x: 20, y: 20 }), frame(0, { x: 20, y: 20 })];
const PAN_ONLY = [
  frame(0, { x: 20, y: 20 }),
  frame(3, { x: 23, y: 20 }),
  frame(6, { x: 26, y: 20 }),
];
const SUBJECT_ONLY = [
  frame(0, { x: 20, y: 20 }),
  frame(0, { x: 32, y: 20 }),
  frame(0, { x: 44, y: 20 }),
];
const SUBJECT_DURING_PAN = [
  frame(0, { x: 20, y: 20 }),
  frame(3, { x: 35, y: 24 }),
  frame(6, { x: 50, y: 28 }),
];

describe("a frozen clip is never credited with motion", () => {
  it("identical frames score zero on every measure", () => {
    expect(temporalAliveness(FROZEN)).toBe(0);
    const split = splitMotion(FROZEN);
    expect(split.total).toBe(0);
    expect(split.residual).toBe(0);
    expect(subjectMotionRatio(split)).toBe(0);
  });

  it("a single frame, or an unmeasurable pair, scores zero — fail closed", () => {
    expect(splitMotion([frame(0, null)]).total).toBe(0);
    const mismatched = [frame(0, null), { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) }];
    expect(splitMotion(mismatched).total).toBe(0);
  });
});

describe("the camera move is identified and removed", () => {
  it("recovers the pan it compensated, with the right sign and size", () => {
    const split = splitMotion(PAN_ONLY);
    // The scene panned +3px per frame; undoing it is a shift of about -3.
    expect(split.shift.dx).toBeLessThan(-1.5);
    expect(split.shift.dx).toBeGreaterThan(-5);
  });

  it("a locked camera is reported as locked", () => {
    expect(Math.abs(splitMotion(SUBJECT_ONLY).shift.dx)).toBeLessThan(1);
  });
});

describe("residual is what survives a camera move — the number that behaved", () => {
  it("a moving subject keeps its residual whether or not the camera moves", () => {
    const locked = splitMotion(SUBJECT_ONLY).residual;
    const panning = splitMotion(SUBJECT_DURING_PAN).residual;
    expect(locked).toBeGreaterThan(3);
    expect(panning).toBeGreaterThan(3);
    // The subject is what is left in both cases, within a factor of two.
    expect(panning).toBeGreaterThan(locked * 0.5);
  });

  it("a frozen scene leaves nothing behind, however much the frame changed", () => {
    expect(splitMotion(FROZEN).residual).toBe(0);
    expect(temporalAliveness(PAN_ONLY)).toBeGreaterThan(temporalAliveness(SUBJECT_ONLY));
    // ...and yet the pan's residual is well under the subject's: the frame
    // changed more while the scene changed less, which is the whole point.
    expect(splitMotion(PAN_ONLY).residual).toBeLessThan(splitMotion(SUBJECT_ONLY).residual);
  });

  it("the ratio separates the clean cases but NOT the mixed one — recorded, not gated", () => {
    // Measured while building this: subject-only ~0.98, pan-only ~0.37,
    // subject-during-pan ~0.51, a one-pixel drift ~0.76. The last two
    // overlap, so the Director reports the ratio and gates on the
    // aliveness minimum that was calibrated on real clips instead.
    expect(subjectMotionRatio(splitMotion(SUBJECT_ONLY))).toBeGreaterThan(0.9);
    expect(subjectMotionRatio(splitMotion(PAN_ONLY))).toBeLessThan(0.6);
    const mixed = subjectMotionRatio(splitMotion(SUBJECT_DURING_PAN));
    expect(mixed).toBeGreaterThan(0.3);
    expect(mixed).toBeLessThan(0.9);
  });

  it("the search window is bounded, so the measure cannot run away", () => {
    expect(GLOBAL_MOTION_SEARCH_PX).toBeLessThanOrEqual(8);
  });
});
