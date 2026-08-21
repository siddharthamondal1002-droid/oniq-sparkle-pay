import { describe, expect, it } from "vitest";
import {
  LIVING_BOB_PCT,
  LIVING_BREATH,
  LIVING_SWAY_PCT,
  livingSubjectMotion,
} from "@/lib/livingMotion";

describe("livingSubjectMotion — a subject that is alive, not frozen", () => {
  it("is deterministic for the same (frame, fps, seed)", () => {
    const a = livingSubjectMotion(45, 30, 12345);
    const b = livingSubjectMotion(45, 30, 12345);
    expect(a).toEqual(b);
  });

  it("actually MOVES over time — offsets change frame to frame", () => {
    const f0 = livingSubjectMotion(0, 30, 999);
    const f30 = livingSubjectMotion(30, 30, 999);
    const f60 = livingSubjectMotion(60, 30, 999);
    // Not all three identical — a static plate would give the same every frame.
    const same = f0.dx === f30.dx && f30.dx === f60.dx && f0.scale === f60.scale;
    expect(same).toBe(false);
  });

  it("stays within the small, edge-safe envelope (never a lurch)", () => {
    for (let frame = 0; frame < 300; frame++) {
      const m = livingSubjectMotion(frame, 30, 777);
      expect(Math.abs(m.dx)).toBeLessThanOrEqual(LIVING_SWAY_PCT + 1e-9);
      expect(Math.abs(m.dy)).toBeLessThanOrEqual(LIVING_BOB_PCT + 1e-9);
      expect(Math.abs(m.scale)).toBeLessThanOrEqual(LIVING_BREATH + 1e-9);
    }
  });

  it("different seeds breathe on different rhythms", () => {
    const a = livingSubjectMotion(20, 30, 1);
    const b = livingSubjectMotion(20, 30, 2);
    expect(a).not.toEqual(b);
  });

  it("gain 0 (or junk input) returns no motion", () => {
    expect(livingSubjectMotion(20, 30, 1, 0)).toEqual({ dx: 0, dy: 0, scale: 0 });
    expect(livingSubjectMotion(NaN, 30, 1)).toEqual({ dx: 0, dy: 0, scale: 0 });
    expect(livingSubjectMotion(20, 0, 1)).toEqual({ dx: 0, dy: 0, scale: 0 });
  });

  it("the mid plane moves less than the near plane (gain scales it)", () => {
    const near = livingSubjectMotion(37, 30, 555, 1);
    const mid = livingSubjectMotion(37, 30, 555, 0.5);
    expect(Math.abs(mid.dx)).toBeLessThanOrEqual(Math.abs(near.dx) + 1e-9);
    expect(Math.abs(mid.scale)).toBeCloseTo(Math.abs(near.scale) * 0.5, 6);
  });
});
