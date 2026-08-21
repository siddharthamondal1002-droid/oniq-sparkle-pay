/**
 * Portrait preconditioning planner — reshape the owner reference CANVAS to 9:16
 * before conditioning, proven never to cut the actor. Deterministic, no Gemini.
 */
import { describe, expect, it } from "vitest";
import { PRECOND_ASPECT, planPrecondition } from "@/lib/portraitPrecondition";

describe("landscape owner reference → portrait-preconditioned canvas", () => {
  it("1344x768 (the validation's landscape source) expands to a 9:16 canvas", () => {
    const p = planPrecondition(1344, 768);
    expect(p.strategy).toBe("pad-portrait");
    expect(p.padded).toBe(true);
    // Canvas is portrait at the production aspect, full source width kept.
    expect(p.canvasW).toBe(1344);
    expect(p.canvasW / p.canvasH).toBeCloseTo(PRECOND_ASPECT, 2);
    expect(p.canvasH).toBe(Math.round(1344 / PRECOND_ASPECT));
  });

  it("the output canvas is portrait (taller than wide)", () => {
    const p = planPrecondition(1344, 768);
    expect(p.canvasH).toBeGreaterThan(p.canvasW);
  });
});

describe("the actor is intact — only canvas is added, never cropped", () => {
  it("canvas is >= the source in BOTH dimensions (nothing can be clipped)", () => {
    const p = planPrecondition(1344, 768);
    expect(p.canvasW).toBeGreaterThanOrEqual(1344);
    expect(p.canvasH).toBeGreaterThanOrEqual(768);
  });

  it("the whole source sits inside the canvas (face + body retained)", () => {
    const p = planPrecondition(1344, 768);
    // content == source, placed at a non-negative offset that keeps it on-canvas
    expect(p.contentW).toBe(1344);
    expect(p.contentH).toBe(768);
    expect(p.offsetX).toBeGreaterThanOrEqual(0);
    expect(p.offsetY).toBeGreaterThanOrEqual(0);
    expect(p.offsetX + p.contentW).toBeLessThanOrEqual(p.canvasW);
    expect(p.offsetY + p.contentH).toBeLessThanOrEqual(p.canvasH);
    expect(p.actorPreserved).toBe(true);
  });

  it("never scales the source down (content dimensions equal the source)", () => {
    for (const [w, h] of [
      [1344, 768],
      [1645, 917],
      [1920, 1080],
    ]) {
      const p = planPrecondition(w, h);
      expect(p.contentW).toBe(w);
      expect(p.contentH).toBe(h);
    }
  });
});

describe("a source already at/beyond 9:16 needs no preconditioning", () => {
  it("an exact 9:16 source is already-portrait (boundary)", () => {
    const p = planPrecondition(1080, 1920);
    expect(p.strategy).toBe("already-portrait");
    expect(p.padded).toBe(false);
    expect(p.canvasW).toBe(1080);
    expect(p.canvasH).toBe(1920);
    expect(p.actorPreserved).toBe(true);
  });

  it("a source TALLER than 9:16 passes through untouched", () => {
    const p = planPrecondition(500, 1200); // aspect 0.417 < 0.5625
    expect(p.strategy).toBe("already-portrait");
    expect(p.padded).toBe(false);
  });
});

describe("a 3:4-ish portrait source is only mildly expanded to true 9:16", () => {
  it("864x1184 (a portrait owner output, aspect 0.73 > 9:16) gets a small vertical pad", () => {
    const p = planPrecondition(864, 1184);
    expect(p.strategy).toBe("pad-portrait");
    expect(p.padded).toBe(true);
    expect(p.canvasW).toBe(864);
    expect(p.canvasH).toBe(Math.round(864 / PRECOND_ASPECT)); // 1536
    expect(p.canvasH).toBeGreaterThan(1184); // expands, never crops
    expect(p.actorPreserved).toBe(true);
  });
});

describe("degenerate input is flagged, not reshaped blind", () => {
  it("zero / NaN dimensions → skip, flagged, not preserved", () => {
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [NaN, 100],
    ]) {
      const p = planPrecondition(w, h);
      expect(p.strategy).toBe("skip");
      expect(p.flagged).toBe(true);
      expect(p.actorPreserved).toBe(false);
    }
  });
});

describe("purity — the planner is deterministic and side-effect free", () => {
  it("same input → identical plan (no mutation, no randomness)", () => {
    const a = planPrecondition(1344, 768);
    const b = planPrecondition(1344, 768);
    expect(a).toEqual(b);
  });
});
