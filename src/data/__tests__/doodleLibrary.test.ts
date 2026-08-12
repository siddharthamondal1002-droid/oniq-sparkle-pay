import { describe, expect, it } from "vitest";
import { DOODLES, doodleByKey, doodleFor, doodleScatter } from "@/data/doodleLibrary";

/**
 * The doodle library is a shipped-asset registry AND a wire format: a sent
 * doodle travels as its key, so a key that stops resolving turns somebody's
 * message into a broken image. These tests pin the parts other code trusts.
 */
describe("doodleLibrary", () => {
  it("ships the full Open Doodles set with unique keys", () => {
    expect(DOODLES.length).toBe(33);
    expect(new Set(DOODLES.map((d) => d.key)).size).toBe(DOODLES.length);
  });

  it("gives every doodle a real asset and a spoken label", () => {
    for (const d of DOODLES) {
      expect(d.src, d.key).toBeTruthy();
      // The label is alt text and preview copy — a filename would leak into
      // both, so require prose rather than a bare identifier.
      expect(d.label.length, d.key).toBeGreaterThan(3);
      expect(d.label, d.key).not.toMatch(/Doodle|\.svg/);
    }
  });

  it("resolves every shipped key, and refuses unknown ones", () => {
    for (const d of DOODLES) expect(doodleByKey(d.key)?.key).toBe(d.key);
    expect(doodleByKey("not-a-doodle")).toBeUndefined();
    expect(doodleByKey("")).toBeUndefined();
  });

  it("picks the same figure for a conversation every time", () => {
    const a = doodleFor("conv-abc");
    expect(doodleFor("conv-abc").key).toBe(a.key);
    // Different conversations should not all land on one figure.
    const spread = new Set(
      Array.from({ length: 40 }, (_, i) => doodleFor(`conv-${i}`).key),
    );
    expect(spread.size).toBeGreaterThan(5);
  });

  describe("wallpaper scatter", () => {
    it("is stable per conversation", () => {
      expect(doodleScatter("conv-1")).toEqual(doodleScatter("conv-1"));
    });

    it("never repeats a figure within one wallpaper", () => {
      for (let i = 0; i < 25; i++) {
        const keys = doodleScatter(`conv-${i}`).map((d) => d.key);
        expect(new Set(keys).size, `conv-${i}`).toBe(keys.length);
      }
    });

    it("keeps every figure clear of the header and the composer", () => {
      for (let i = 0; i < 25; i++) {
        for (const d of doodleScatter(`conv-${i}`)) {
          expect(d.top).toBeGreaterThanOrEqual(6);
          expect(d.top).toBeLessThan(90);
          // Left column starts near the edge, right column must still fit.
          expect(d.start).toBeGreaterThanOrEqual(0);
          expect(d.start).toBeLessThan(70);
        }
      }
    });

    it("honours the requested count", () => {
      expect(doodleScatter("x", 3)).toHaveLength(3);
      expect(doodleScatter("x", 12)).toHaveLength(12);
    });
  });
});
