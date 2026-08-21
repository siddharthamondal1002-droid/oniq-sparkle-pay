/**
 * Portrait reframe planner — proven against the exact dimensions the live batch
 * returned, with the owner's hard rule: never a crop that cuts the actor.
 */
import { describe, expect, it } from "vitest";
import {
  PORTRAIT_ASPECT,
  PORTRAIT_H,
  PORTRAIT_W,
  SAFE_COVER_KEEP,
  planPortrait,
} from "@/lib/portraitReframe";

describe("output is always the production 1080x1920", () => {
  for (const [w, h] of [
    [1344, 768],
    [864, 1184],
    [500, 1200],
    [1080, 1920],
  ]) {
    it(`${w}x${h} → 1080x1920`, () => {
      const p = planPortrait(w, h);
      expect(p.outputW).toBe(PORTRAIT_W);
      expect(p.outputH).toBe(PORTRAIT_H);
    });
  }
});

describe("portrait/near-square sources cover safely (no actor cut)", () => {
  it("864x1184 (the batch's portrait output) keeps ~77% via a centre crop", () => {
    const p = planPortrait(864, 1184);
    expect(p.strategy).toBe("cover");
    expect(p.actorPreserved).toBe(true);
    expect(p.flagged).toBe(false);
    // Crops the sides to the target aspect, keeping >= the safe fraction.
    expect(p.crop).not.toBeNull();
    expect(p.crop!.w / 864).toBeGreaterThanOrEqual(SAFE_COVER_KEEP);
    expect(p.crop!.w / p.crop!.h).toBeCloseTo(PORTRAIT_ASPECT, 2);
  });

  it("a source TALLER than 9:16 crops top/bottom, full width", () => {
    const p = planPortrait(500, 1200);
    expect(p.strategy).toBe("cover");
    expect(p.crop!.w).toBe(500);
    expect(p.crop!.h).toBeLessThan(1200);
    expect(p.actorPreserved).toBe(true);
  });
});

describe("landscape sources never centre-crop the actor away", () => {
  it("1344x768 (the batch's landscape output) with NO subject → pad, flagged, nothing cut", () => {
    const p = planPortrait(1344, 768);
    expect(p.strategy).toBe("pad");
    expect(p.crop).toBeNull();
    expect(p.actorPreserved).toBe(true); // the whole image is kept
    expect(p.flagged).toBe(true); // but it's a framing compromise
  });

  it("1344x768 WITH a centred subject → actor-aware crop-subject", () => {
    const p = planPortrait(1344, 768, { cx: 0.5, halfW: 0.15 });
    expect(p.strategy).toBe("crop-subject");
    expect(p.actorPreserved).toBe(true);
    expect(p.flagged).toBe(false);
    // A 9:16 slice of a 768-tall frame is 432 wide, centred.
    expect(p.crop!.w).toBe(Math.round(768 * PORTRAIT_ASPECT));
    expect(p.crop!.w / p.crop!.h).toBeCloseTo(PORTRAIT_ASPECT, 2);
  });

  it("clamps the subject slice to the frame and still contains an off-centre actor", () => {
    const p = planPortrait(1344, 768, { cx: 0.12, halfW: 0.1 });
    expect(p.strategy).toBe("crop-subject");
    expect(p.crop!.x).toBeGreaterThanOrEqual(0);
    // subject right edge (0.22*1344=296) is inside the slice [0,432]
    expect(0.22 * 1344).toBeLessThanOrEqual(p.crop!.x + p.crop!.w);
  });

  it("pads (not cuts) when even a centred slice cannot contain a very wide subject", () => {
    const p = planPortrait(1344, 768, { cx: 0.5, halfW: 0.45 });
    expect(p.strategy).toBe("pad");
    expect(p.actorPreserved).toBe(true);
    expect(p.flagged).toBe(true);
  });
});

describe("degenerate input is flagged, not rendered blind", () => {
  it("zero/NaN dimensions → pad, flagged, not preserved", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [NaN, 100],
    ]) {
      const p = planPortrait(w, h);
      expect(p.strategy).toBe("pad");
      expect(p.flagged).toBe(true);
      expect(p.actorPreserved).toBe(false);
    }
  });
});
