import { describe, expect, it } from "vitest";
import { VFX, particlesAt, vfxKindFor, vfxSeed, type VfxKind } from "@/lib/particleField";

/**
 * The particle math's one hard contract is DETERMINISM ACROSS RENDER ORDER:
 * Remotion renders frames out of order in parallel processes, and the film
 * is rendered in halves — any state between frames tears the film at the
 * seam. These pin that, the coordinate bounds the composition trusts, and
 * the words-to-effect gate.
 */
describe("vfxKindFor", () => {
  it("lets the scene's words choose the effect", () => {
    expect(vfxKindFor("Embers drift up from the festival fires")).toBe("embers");
    expect(vfxKindFor("Rain hammers the harbour at night")).toBe("rain");
    expect(vfxKindFor("Snow settles on the pass")).toBe("snow");
    expect(vfxKindFor("Fireflies wake in the moonlit garden")).toBe("fireflies");
    expect(vfxKindFor("A dusty bazaar in late amber light")).toBe("dust");
  });

  it("returns NOTHING for a scene that names nothing — absence is the default", () => {
    expect(vfxKindFor("A quiet palace hall, a princess reading a letter")).toBeNull();
    expect(vfxKindFor("")).toBeNull();
  });

  it("water beats light: a rainy night is rain, not fireflies", () => {
    expect(vfxKindFor("Rain over the moonlit rooftops")).toBe("rain");
  });

  it("does not fire on mere substrings of other words", () => {
    // 'grain' contains 'rain'; the word-boundary anchor must hold.
    expect(vfxKindFor("Sacks of grain stacked in the storehouse")).toBeNull();
  });
});

describe("vfxSeed", () => {
  it("is stable for the same identity and different across identities", () => {
    expect(vfxSeed("3:ep4_s01a")).toBe(vfxSeed("3:ep4_s01a"));
    expect(vfxSeed("3:ep4_s01a")).not.toBe(vfxSeed("4:ep4_s01b"));
  });

  it("is an unsigned 32-bit integer — a JSON-safe plan field", () => {
    for (const id of ["a", "ep4_s13d", "0:still text with words"]) {
      const s = vfxSeed(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});

describe("particlesAt", () => {
  const KINDS = Object.keys(VFX) as VfxKind[];

  it("is a pure function of (kind, seed, frame): identical on every call", () => {
    for (const kind of KINDS) {
      const a = particlesAt(kind, 1234, 137, 30);
      const b = particlesAt(kind, 1234, 137, 30);
      expect(a).toEqual(b);
    }
  });

  it("needs no earlier frame: frame 500 computes without visiting 0..499", () => {
    // The test IS the call pattern: jump straight to a late frame and get
    // the same answer a sequential walk would give (purity implies it, and
    // the render halves depend on it).
    const late = particlesAt("embers", 77, 500, 30);
    const again = particlesAt("embers", 77, 500, 30);
    expect(late).toEqual(again);
    expect(late).not.toEqual(particlesAt("embers", 77, 499, 30));
  });

  it("keeps every particle inside the frame and every opacity in 0..1", () => {
    for (const kind of KINDS) {
      for (const frame of [0, 45, 313, 4000]) {
        for (const p of particlesAt(kind, 999, frame, 30)) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThan(1);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThan(1);
          expect(p.r).toBeGreaterThan(0);
          expect(p.opacity).toBeGreaterThanOrEqual(0);
          expect(p.opacity).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("delivers each kind's full count, and different seeds different air", () => {
    for (const kind of KINDS) {
      expect(particlesAt(kind, 5, 10, 30).length).toBe(VFX[kind].count);
    }
    expect(particlesAt("dust", 1, 10, 30)).not.toEqual(particlesAt("dust", 2, 10, 30));
  });

  it("actually moves: embers rise between frames, rain falls fast", () => {
    const before = particlesAt("embers", 42, 30, 30);
    const after = particlesAt("embers", 42, 45, 30);
    // Track a particle that does not wrap across the half-second.
    const moved = before.findIndex((p, i) => Math.abs(after[i].y - p.y) < 0.5);
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(after[moved].y).toBeLessThan(before[moved].y); // embers go UP
    const r0 = particlesAt("rain", 42, 30, 30);
    const r1 = particlesAt("rain", 42, 33, 30);
    const drop = r0.findIndex((p, i) => r1[i].y > p.y && r1[i].y - p.y < 0.5);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(r1[drop].y - r0[drop].y).toBeGreaterThan(0.05); // fast, in a tenth of a second
  });
});
