import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HEADS_SRC = readFileSync(join(ROOT, "remotion/src/rig/expressionHeads.ts"), "utf8");
const RIGS_SRC = readFileSync(join(ROOT, "remotion/src/rig/characterRig.ts"), "utf8");

/**
 * Rung 5's data table is geometry somebody MEASURED (3x grids, composite
 * proofs, an independent re-derivation pass — the rung-2 discipline), and
 * these pin what survives without eyes: a bust mouth outside its crop, a
 * crop outside the sheet, an interocular that cannot be a face, or an
 * emotion key the grammar can never produce would each put a face in the
 * wrong place hours of render later. Parsed as TEXT, like every test that
 * crosses into remotion/ — that tree's extensionless imports do not
 * resolve under the src bundler config.
 */

type Head = {
  rig: string;
  emotion: string;
  crop: { x: number; y: number; width: number; height: number };
  mouth: { x: number; y: number; width: number };
  interocular: number;
};

/** The sheets that carry measured busts, per the survey recorded in the table doc. */
const RIGGED_SHEETS = new Set(["aliBaba", "mother", "jarJinni", "lampJinni"]);
const EMOTIONS = new Set(["anger", "sorrow", "surprise", "joy", "wonder", "weary"]);

function heads(): Head[] {
  // The empty form the scaffolding shipped with — measurement lands
  // separately, and an empty table must parse as zero heads, not a
  // format error.
  if (/export const EXPRESSION_HEADS[^=]*=\s*\{\};/.test(HEADS_SRC)) return [];
  const table = HEADS_SRC.match(/export const EXPRESSION_HEADS[^=]*=\s*\{([\s\S]*)\n\};/);
  expect(table, "EXPRESSION_HEADS not found — the format changed").not.toBeNull();
  const out: Head[] = [];
  const rigBlocks = [
    ...(table?.[1] ?? "").matchAll(/(\w+):\s*\{([\s\S]*?)\n  \}/g),
  ];
  for (const [, rig, body] of rigBlocks) {
    const entries = [
      ...body.matchAll(
        /(\w+):\s*\{\s*(?:\/\/[^\n]*\n\s*)*crop:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)\s*\},\s*(?:\/\/[^\n]*\n\s*)*mouth:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+)\s*\},\s*(?:\/\/[^\n]*\n\s*)*interocular:\s*([\d.]+)/g,
      ),
    ];
    for (const [, emotion, cx, cy, cw, ch, mx, my, mw, io] of entries) {
      out.push({
        rig,
        emotion,
        crop: { x: Number(cx), y: Number(cy), width: Number(cw), height: Number(ch) },
        mouth: { x: Number(mx), y: Number(my), width: Number(mw) },
        interocular: Number(io),
      });
    }
  }
  return out;
}

describe("the measured expression-head table", () => {
  it("names only sheets that carry busts, and only feelings the grammar can pick", () => {
    for (const h of heads()) {
      expect(RIGGED_SHEETS.has(h.rig), `${h.rig} has no expression busts on its sheet`).toBe(
        true,
      );
      expect(EMOTIONS.has(h.emotion), `${h.rig}.${h.emotion}: not an Emotion`).toBe(true);
    }
  });

  it("keeps every bust inside its 1600x894 sheet, and every mouth inside its bust", () => {
    for (const h of heads()) {
      const id = `${h.rig}.${h.emotion}`;
      expect(h.crop.x, id).toBeGreaterThanOrEqual(0);
      expect(h.crop.y, id).toBeGreaterThanOrEqual(0);
      expect(h.crop.x + h.crop.width, id).toBeLessThanOrEqual(1600);
      expect(h.crop.y + h.crop.height, id).toBeLessThanOrEqual(894);
      expect(h.mouth.x, id).toBeGreaterThan(h.crop.x);
      expect(h.mouth.x, id).toBeLessThan(h.crop.x + h.crop.width);
      expect(h.mouth.y, id).toBeGreaterThan(h.crop.y);
      expect(h.mouth.y, id).toBeLessThan(h.crop.y + h.crop.height);
      expect(h.mouth.width, id).toBeGreaterThan(0);
      expect(h.mouth.width, id).toBeLessThan(h.crop.width);
    }
  });

  it("holds interoculars a face could actually have", () => {
    for (const h of heads()) {
      const id = `${h.rig}.${h.emotion}`;
      // Busts are drawn between half and double their figure's head scale;
      // outside 20..80 sheet px nothing on these 1600-wide sheets is a face.
      expect(h.interocular, id).toBeGreaterThan(20);
      expect(h.interocular, id).toBeLessThan(80);
      // The swap scale (base/bust) must stay in a range that neither
      // shrinks the face to a stamp nor blows it past the figure.
      const base = RIGS_SRC.match(
        new RegExp(`${h.rig}:[\\s\\S]*?interocular:\\s*([\\d.]+),`),
      );
      expect(base, `${h.rig} missing base interocular`).not.toBeNull();
      const s = Number(base?.[1]) / h.interocular;
      expect(s, `${id} swap scale ${s.toFixed(2)}`).toBeGreaterThan(0.4);
      expect(s, `${id} swap scale ${s.toFixed(2)}`).toBeLessThan(1.6);
    }
  });
});
