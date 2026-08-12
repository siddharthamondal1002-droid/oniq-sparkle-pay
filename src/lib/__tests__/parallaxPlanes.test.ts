import { describe, expect, it } from "vitest";
import {
  PARALLAX,
  nearPlaneAlpha,
  normalizeDepth,
  planeCoverage,
} from "@/lib/parallaxPlanes";

/**
 * The plane math is the part of the parallax stage that cannot be eyeballed:
 * a wrong normalisation or a hard band edge shows up as cardboarding in a
 * finished film, hours after the bug. These pin the invariants the worker
 * and the composition both trust.
 */
describe("normalizeDepth", () => {
  it("maps the range to 0..1 with nearest at 1", () => {
    const d = normalizeDepth(new Float32Array([50, 100, 150]));
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(0.5);
    expect(d[2]).toBe(1);
  });

  it("normalises a FLAT map to all-far, which degrades to plain Ken Burns", () => {
    const d = normalizeDepth(new Float32Array([7, 7, 7, 7]));
    expect(Array.from(d)).toEqual([0, 0, 0, 0]);
    // ...and the empty near plane then fails the coverage gate:
    const alpha = nearPlaneAlpha(d, PARALLAX.threshold);
    expect(planeCoverage(alpha)).toBeLessThan(PARALLAX.minCoverage);
  });
});

describe("nearPlaneAlpha", () => {
  it("is fully transparent well below the threshold and opaque well above", () => {
    const d = new Float32Array([0.1, 0.9]);
    const a = nearPlaneAlpha(d, 0.55);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(255);
  });

  it("feathers across the threshold instead of hard-cutting", () => {
    // Sample inside the feather band: strictly between 0 and 255.
    const a = nearPlaneAlpha(new Float32Array([0.55]), 0.55, 0.08);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[0]).toBeLessThan(255);
    // And monotone through the band.
    const ramp = nearPlaneAlpha(new Float32Array([0.5, 0.53, 0.55, 0.57, 0.6]), 0.55, 0.08);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
  });

  it("rejects a threshold outside (0,1) loudly", () => {
    expect(() => nearPlaneAlpha(new Float32Array([0.5]), 0)).toThrow(/threshold/);
    expect(() => nearPlaneAlpha(new Float32Array([0.5]), 1)).toThrow(/threshold/);
  });
});

describe("planeCoverage", () => {
  it("reads 0 for empty, 1 for solid, and the fraction between", () => {
    expect(planeCoverage(new Uint8Array(0))).toBe(0);
    expect(planeCoverage(new Uint8Array([255, 255]))).toBe(1);
    expect(planeCoverage(new Uint8Array([255, 0, 0, 0]))).toBeCloseTo(0.25);
  });

  it("gates the degenerate shots the research called out", () => {
    // A distant landscape: near plane almost empty — no parallax.
    const landscape = new Uint8Array(100).fill(0);
    landscape[0] = 255;
    expect(planeCoverage(landscape)).toBeLessThan(PARALLAX.minCoverage);
    // A face filling the frame: near plane almost everything — no parallax.
    const face = new Uint8Array(100).fill(255);
    face[0] = 0;
    expect(planeCoverage(face)).toBeGreaterThan(PARALLAX.maxCoverage);
  });
});
