/**
 * The face filters' geometry, which is the only part of them that can be
 * tested without a camera and a GPU.
 *
 * Everything downstream — ear size, lens size, how far the eyes blow up — is
 * a multiple of `faceWidth` and `eyeWidth`. If those come out wrong the art is
 * wrong in a way no assertion about drawing calls would catch: dog ears the
 * size of the screen, or sunglasses on a chin. So the measurements are pinned
 * and the painting is left to the eye.
 */
import { describe, expect, it } from "vitest";
import { FACE_FX, geometryFrom, isFaceFilter, type Pt } from "@/lib/faceFx";

/**
 * A synthetic 478-point mesh with a face of known size, upright and centred.
 * Only the indices geometryFrom reads carry meaning; the rest exist so the
 * length check passes, exactly as a real mesh would.
 */
function mesh(over: Record<number, Pt> = {}): Pt[] {
  const pts: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  pts[33] = { x: 0.35, y: 0.4 }; // left eye outer
  pts[133] = { x: 0.45, y: 0.4 }; // left eye inner
  pts[362] = { x: 0.55, y: 0.4 }; // right eye inner
  pts[263] = { x: 0.65, y: 0.4 }; // right eye outer
  pts[1] = { x: 0.5, y: 0.55 }; // nose tip
  pts[10] = { x: 0.5, y: 0.2 }; // head top
  pts[234] = { x: 0.3, y: 0.5 }; // face left
  pts[454] = { x: 0.7, y: 0.5 }; // face right
  for (const [i, p] of Object.entries(over)) pts[Number(i)] = p;
  return pts;
}

describe("geometryFrom", () => {
  it("returns eye centres, not eye corners", () => {
    // The art hangs off the CENTRE of each eye. Using a corner puts the
    // sunglasses lens half a face off to one side.
    const g = geometryFrom(mesh(), 1000, 1000)!;
    expect(g.leftEye).toEqual({ x: 400, y: 400 });
    expect(g.rightEye).toEqual({ x: 600, y: 400 });
  });

  it("scales every measurement into canvas pixels", () => {
    // Landmarks arrive normalised 0..1. Drawing with them unscaled would put
    // the whole face inside the top-left pixel.
    const g = geometryFrom(mesh(), 640, 480)!;
    expect(g.noseTip).toEqual({ x: 320, y: 264 });
    expect(g.faceWidth).toBeCloseTo(0.4 * 640, 5);
    expect(g.eyeWidth).toBeCloseTo(0.1 * 640, 5);
  });

  it("reads head roll off the eye line", () => {
    const level = geometryFrom(mesh(), 1000, 1000)!;
    expect(level.tilt).toBeCloseTo(0, 6);
    // Right eye dropped: the head is rolled that way and the art must follow.
    const rolled = geometryFrom(
      mesh({ 362: { x: 0.55, y: 0.5 }, 263: { x: 0.65, y: 0.5 } }),
      1000,
      1000,
    )!;
    expect(rolled.tilt).toBeGreaterThan(0.3);
  });

  it("refuses a mesh that is not a mesh", () => {
    // A truncated or empty detection must produce nothing to draw rather than
    // NaN coordinates, which paint invisibly and silently.
    expect(geometryFrom([], 640, 480)).toBeNull();
    expect(geometryFrom(mesh().slice(0, 100), 640, 480)).toBeNull();
  });

  it("floors the sizes so a distant face cannot produce zero-size art", () => {
    // All four landmarks on one point — a collapsed detection. Without the
    // floor every radius becomes 0 and the effect vanishes with no error.
    const flat = geometryFrom(
      mesh({
        33: { x: 0.5, y: 0.5 },
        133: { x: 0.5, y: 0.5 },
        234: { x: 0.5, y: 0.5 },
        454: { x: 0.5, y: 0.5 },
      }),
      640,
      480,
    )!;
    expect(flat.eyeWidth).toBeGreaterThan(0);
    expect(flat.faceWidth).toBeGreaterThan(0);
  });
});

describe("the filter registry", () => {
  it("knows which ids need the landmarker", () => {
    expect(isFaceFilter("dog")).toBe(true);
    expect(isFaceFilter("bigeyes")).toBe(true);
    expect(isFaceFilter("shades")).toBe(true);
    // The colour filters and the gallery photo must NOT drag in 15 MB of
    // model — that is the whole reason the check exists.
    expect(isFaceFilter("noir")).toBe(false);
    expect(isFaceFilter("photo")).toBe(false);
    expect(isFaceFilter("none")).toBe(false);
  });

  it("cannot be fooled by an inherited property name", () => {
    // FACE_FX is a plain object; a bare `in` or truthiness check would answer
    // yes for "toString" and then call it as a draw function.
    expect(isFaceFilter("toString")).toBe(false);
    expect(isFaceFilter("constructor")).toBe(false);
  });

  it("has a painter for every id it claims", () => {
    for (const id of Object.keys(FACE_FX)) {
      expect(typeof FACE_FX[id], `${id} has no painter`).toBe("function");
    }
  });
});
