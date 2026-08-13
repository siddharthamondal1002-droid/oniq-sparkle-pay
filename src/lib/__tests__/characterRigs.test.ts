/**
 * The rig table is geometry somebody MEASURED (rung 2, 2026-08-13: one pass
 * measuring off 3x enlargements, a second adversarial pass re-deriving every
 * number), and these tests pin the invariants that survive without eyes: a
 * mouth outside its crop, a crop outside its sheet, or a worker whose
 * MEASURED_RIGS drifted from the table would each put a mouth on a chin or a
 * puppet nowhere at all, hours of render later.
 *
 * Reads remotion files as TEXT, like every test that crosses into remotion/ —
 * that tree is its own TS project and its extensionless imports do not
 * resolve under the src bundler config.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RIGS_SRC = readFileSync(join(ROOT, "remotion/src/rig/characterRig.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");

type Rig = {
  key: string;
  sheet: string;
  sheetWidth: number;
  sheetHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  mouth: { x: number; y: number; width: number };
};

/** Every entry of CHARACTER_RIGS, parsed from the source text. */
function rigs(): Rig[] {
  const table = RIGS_SRC.match(/export const CHARACTER_RIGS[^=]*=\s*\{([\s\S]*)\n\};/);
  expect(table, "CHARACTER_RIGS not found — the format changed").not.toBeNull();
  const entries = [
    ...(table?.[1] ?? "").matchAll(
      /(\w+):\s*\{\s*(?:\/\/[^\n]*\n\s*)*sheet:\s*'([^']+)',\s*sheetWidth:\s*(\d+),\s*sheetHeight:\s*(\d+),\s*front:\s*\{[\s\S]*?crop:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+),\s*height:\s*([\d.]+)\s*\},[\s\S]*?mouth:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*width:\s*([\d.]+)\s*\},/g,
    ),
  ];
  return entries.map(
    ([, key, sheet, sw, sh, cx, cy, cw, ch, mx, my, mw]) => ({
      key,
      sheet,
      sheetWidth: Number(sw),
      sheetHeight: Number(sh),
      crop: { x: Number(cx), y: Number(cy), width: Number(cw), height: Number(ch) },
      mouth: { x: Number(mx), y: Number(my), width: Number(mw) },
    }),
  );
}

describe("the measured rig table", () => {
  it("holds the full eleven-character repertory", () => {
    expect(rigs().map((r) => r.key).sort()).toEqual([
      "aladdin",
      "aliBaba",
      "captain",
      "fisherman",
      "jarJinni",
      "lampJinni",
      "magician",
      "morgiana",
      "mother",
      "princess",
      "ringJinni",
    ]);
  });

  it("draws every rig from its own committed cut sheet", () => {
    for (const r of rigs()) {
      expect(r.sheet).toBe(`sheets/cut/${r.key}.png`);
      expect(
        existsSync(join(ROOT, "remotion/public", r.sheet)),
        `${r.sheet} is not on disk — the rig would render a blank figure`,
      ).toBe(true);
    }
  });

  it("keeps every crop inside its sheet and every mouth inside its crop", () => {
    for (const { key, sheetWidth, sheetHeight, crop, mouth } of rigs()) {
      expect(crop.x, key).toBeGreaterThanOrEqual(0);
      expect(crop.y, key).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width, key).toBeLessThanOrEqual(sheetWidth);
      expect(crop.y + crop.height, key).toBeLessThanOrEqual(sheetHeight);
      expect(mouth.x - mouth.width / 2, key).toBeGreaterThan(crop.x);
      expect(mouth.x + mouth.width / 2, key).toBeLessThan(crop.x + crop.width);
      expect(mouth.y, key).toBeGreaterThan(crop.y);
      expect(mouth.y, key).toBeLessThan(crop.y + crop.height);
    }
  });

  it("puts every mouth in the upper half of its figure, where faces are", () => {
    // The classic failure this table exists to prevent is a mouth "opening
    // somewhere near the chin" — or worse, anchored into the torso.
    for (const { key, crop, mouth } of rigs()) {
      expect(mouth.y - crop.y, key).toBeLessThan(crop.height / 2);
    }
  });

  it("keeps mouth widths in proportion — a lip line, not a banner", () => {
    for (const { key, crop, mouth } of rigs()) {
      expect(mouth.width, key).toBeGreaterThan(0);
      expect(mouth.width / crop.width, key).toBeLessThan(0.25);
    }
  });

  it("matches the worker's MEASURED_RIGS set exactly — the by-hand sync, pinned", () => {
    const set = WORKER_SRC.match(/const MEASURED_RIGS = new Set\(\[([\s\S]*?)\]\)/);
    expect(set, "MEASURED_RIGS not found in the worker — the format changed").not.toBeNull();
    const keys = [...(set?.[1] ?? "").matchAll(/'(\w+)'/g)].map(([, k]) => k);
    expect(keys.sort()).toEqual(rigs().map((r) => r.key).sort());
  });
});
