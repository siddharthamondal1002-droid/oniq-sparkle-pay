import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RIGS_SRC = readFileSync(join(ROOT, "remotion/src/rig/characterRig.ts"), "utf8");
const HEADS_SRC = readFileSync(join(ROOT, "remotion/src/rig/expressionHeads.ts"), "utf8");

/**
 * Rung 7's data gate. Eye geometry was measured (grids, closed-lid
 * composite proofs, adversarial re-derivation) and these pin what
 * survives without eyes on the image: a pupil outside its face, a lid
 * colour that isn't a colour, an aperture wider than the face, or an eye
 * span that disagrees with the recorded interocular would each put a
 * flickering skin ellipse somewhere on a character's forehead at blink
 * rate. Text-parsed like every test that crosses into remotion/.
 */

type Eyes = {
  owner: string;
  left: { x: number; y: number };
  right: { x: number; y: number };
  width: number;
  lid: string;
  interocular: number;
  crop: { x: number; y: number; width: number; height: number };
};

// Strict about what sits BETWEEN the fields — only the mouth line and
// comments — so an eyeless entry (jarJinni and his busts) can never lend
// its crop to the next entry's eyes.
const EYES_RE =
  /crop:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)\s*\},\s*(?:\/\/[^\n]*\n\s*)*mouth:[^}]*\},\s*(?:\/\/[^\n]*\n\s*)*interocular:\s*([\d.]+),\s*(?:\/\/[^\n]*\n\s*)*eyes:\s*\{\s*(?:\/\/[^\n]*\n\s*)*left:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)\s*\},\s*right:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)\s*\},\s*width:\s*([\d.]+),\s*lid:\s*'(#[0-9a-f]{6})',/g;

function eyesIn(src: string, label: string): Eyes[] {
  return [...src.matchAll(EYES_RE)].map((m, i) => ({
    owner: `${label}[${i}]`,
    crop: { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: Number(m[4]) },
    interocular: Number(m[5]),
    left: { x: Number(m[6]), y: Number(m[7]) },
    right: { x: Number(m[8]), y: Number(m[9]) },
    width: Number(m[10]),
    lid: m[11],
  }));
}

describe("the measured eye geometry", () => {
  const all = [...eyesIn(RIGS_SRC, "rig"), ...eyesIn(HEADS_SRC, "bust")];

  it("holds the whole measured set: ten blinking figures, six blinking busts", () => {
    // jarJinni's molten eyes are the one deliberate absence among the
    // eleven figures; his glow-eyed busts and the closed-lid sigh carry
    // none either. An entry vanishing here is lost data, not a reformat.
    expect(eyesIn(RIGS_SRC, "rig")).toHaveLength(10);
    expect(eyesIn(HEADS_SRC, "bust")).toHaveLength(6);
    expect(
      /jarJinni:[\s\S]*?NO eyes, deliberately/.test(RIGS_SRC),
      "jarJinni's deliberate absence lost its explanation",
    ).toBe(true);
  });

  it("keeps both pupils inside their face's crop, left of right, roughly level", () => {
    for (const e of all) {
      for (const p of [e.left, e.right]) {
        expect(p.x, e.owner).toBeGreaterThan(e.crop.x);
        expect(p.x, e.owner).toBeLessThan(e.crop.x + e.crop.width);
        expect(p.y, e.owner).toBeGreaterThan(e.crop.y);
        // Eyes live in the upper half of any face crop.
        expect(p.y, e.owner).toBeLessThan(e.crop.y + e.crop.height / 2);
      }
      expect(e.right.x, e.owner).toBeGreaterThan(e.left.x);
      // A tilted head tips the eye line a few pixels, never more.
      expect(Math.abs(e.right.y - e.left.y), e.owner).toBeLessThanOrEqual(4);
    }
  });

  it("keeps the eye span within 15% of the recorded interocular, sized like eyes", () => {
    for (const e of all) {
      const span = Math.hypot(e.right.x - e.left.x, e.right.y - e.left.y);
      const drift = Math.abs(span - e.interocular) / e.interocular;
      // One band for the whole cast — captain's rung-2 interocular was
      // the outlier and the verify pass corrected it to the measured 40.
      expect(drift, `${e.owner} span ${span.toFixed(1)} vs ${e.interocular}`).toBeLessThan(
        0.155,
      );
      // An aperture is part of a face: smaller than the span, bigger than a dot.
      expect(e.width, e.owner).toBeGreaterThan(5);
      expect(e.width, e.owner).toBeLessThan(span);
    }
  });
});
