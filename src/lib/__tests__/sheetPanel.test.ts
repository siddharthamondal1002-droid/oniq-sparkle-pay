/**
 * SHEET → ATTACHABLE PANEL — the adapter must never guess.
 *
 * Evidence base: sheets reproduce their own panel layout when conditioned
 * (measured shot 04; again on 5871421e's mis-kinded scene asset — the 2x2
 * baker grid on val-5871421e). The adapter's contract, pinned here on
 * synthetic images (no binary fixtures):
 *
 *   confident grid + one clearly best figure panel → that panel;
 *   anything ambiguous → a named refusal, so the caller's text-only
 *   fallback stays byte-identical to the pre-adapter behavior.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type RawImage,
  scalePanel,
  selectSheetPanel,
} from "../sheetPanel.ts";

/** A w×h RGBA canvas filled with one gray level. */
function canvas(w: number, h: number, level = 240): RawImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function setPx(img: RawImage, x: number, y: number, level: number): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = level;
  img.data[i + 1] = level;
  img.data[i + 2] = level;
}

/** A blobby dark "figure" filling the middle `frac` of a region. */
function drawFigure(
  img: RawImage,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  frac = 0.55,
): void {
  const fw = Math.floor(rw * frac);
  const fh = Math.floor(rh * frac);
  const x0 = rx + Math.floor((rw - fw) / 2);
  const y0 = ry + Math.floor((rh - fh) / 2);
  for (let y = y0; y < y0 + fh; y++) {
    for (let x = x0; x < x0 + fw; x++) setPx(img, x, y, 60);
  }
}

/** Dense small strokes — the signature of a caption/label strip. */
function drawTextStrip(img: RawImage, rx: number, ry: number, rw: number, rh: number): void {
  for (let y = ry + 2; y < ry + rh - 2; y += 3) {
    for (let x = rx + 2; x < rx + rw - 2; x += 4) {
      setPx(img, x, y, 30);
      setPx(img, x + 1, y, 30);
    }
  }
}

/** A 2×2 sheet: white gutters at the midlines, figures where asked. */
function twoByTwo(
  fill: (img: RawImage, cell: (r: number, c: number) => [number, number, number, number]) => void,
): RawImage {
  const img = canvas(200, 200, 235);
  // Gutters: 6px flat white bands at the midlines, edge to edge.
  for (let d = -3; d < 3; d++) {
    for (let j = 0; j < 200; j++) {
      setPx(img, 100 + d, j, 255);
      setPx(img, j, 100 + d, 255);
    }
  }
  const cell = (r: number, c: number): [number, number, number, number] => [
    c === 0 ? 4 : 106,
    r === 0 ? 4 : 106,
    90,
    90,
  ];
  fill(img, cell);
  return img;
}

describe("selectSheetPanel — the confident path", () => {
  it("extracts the largest-figure panel from a clean 2×2 sheet", () => {
    const img = twoByTwo((im, cell) => {
      drawFigure(im, ...cell(0, 0), 0.7); // big figure top-left
      drawFigure(im, ...cell(0, 1), 0.45); // smaller figures elsewhere
      drawFigure(im, ...cell(1, 0), 0.45);
      // bottom-right left empty
    });
    const d = selectSheetPanel(img);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.grid).toEqual({ cols: 2, rows: 2 });
      // Top-left cell chosen.
      expect(d.panel.x).toBeLessThan(50);
      expect(d.panel.y).toBeLessThan(50);
      expect(d.mass).toBeGreaterThan(0.2);
    }
  });

  it("skips the empty quadrant and picks the fuller figure", () => {
    const img = twoByTwo((im, cell) => {
      drawFigure(im, ...cell(0, 0), 0.45); // modest figure top-left
      drawFigure(im, ...cell(1, 1), 0.7); // fuller figure bottom-right
    });
    const d = selectSheetPanel(img);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.panel.x).toBeGreaterThan(90);
      expect(d.panel.y).toBeGreaterThan(90);
    }
  });

  it("a sheet with a single occupied region reads as single-pose and refuses", () => {
    // Only one quadrant carries content → the projections see one island,
    // indistinguishable from a single-pose image. Refuse, never guess.
    const img = twoByTwo((im, cell) => {
      drawFigure(im, ...cell(1, 1), 0.6);
    });
    const d = selectSheetPanel(img);
    expect(d).toEqual({ ok: false, reason: "SHEET_NO_GRID_DETECTED" });
  });

  it("skips a text-heavy label cell in favor of the drawn figure", () => {
    const img = twoByTwo((im, cell) => {
      drawTextStrip(im, ...cell(0, 0)); // dense label strokes
      drawFigure(im, ...cell(1, 1), 0.5);
    });
    const d = selectSheetPanel(img);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.panel.x).toBeGreaterThan(90);
      expect(d.panel.y).toBeGreaterThan(90);
    }
  });
});

describe("selectSheetPanel — fail-closed refusals", () => {
  it("refuses a malformed image", () => {
    const d = selectSheetPanel({ width: 10, height: 10, data: new Uint8Array(1) });
    expect(d).toEqual({ ok: false, reason: "SHEET_MALFORMED" });
  });

  it("refuses when no gutter grid exists (single-pose image)", () => {
    const img = canvas(200, 200, 200);
    drawFigure(img, 0, 0, 200, 200, 0.6);
    const d = selectSheetPanel(img);
    expect(d).toEqual({ ok: false, reason: "SHEET_NO_GRID_DETECTED" });
  });

  it("refuses a grid whose every cell is empty", () => {
    const img = twoByTwo(() => {});
    const d = selectSheetPanel(img);
    expect(d).toEqual({ ok: false, reason: "SHEET_NO_USABLE_PANEL" });
  });

  it("refuses a chaotic many-panel strip", () => {
    // Seven separate content islands across one row — denser than any sane
    // pose sheet, so the adapter refuses rather than picking from chaos.
    const img = canvas(400, 200, 235);
    for (let k = 0; k < 7; k++) {
      drawFigure(img, k * 56 + 8, 60, 40, 80, 0.8);
    }
    const d = selectSheetPanel(img);
    expect(d).toEqual({ ok: false, reason: "SHEET_GRID_TOO_DENSE" });
  });
});

describe("scalePanel", () => {
  it("maps analysis coordinates to even-sized source crops, clamped", () => {
    const box = scalePanel(
      { x: 4, y: 4, w: 90, h: 90 },
      { width: 200, height: 200 },
      { width: 1000, height: 1000 },
    );
    expect(box.x).toBe(20);
    expect(box.y).toBe(20);
    expect(box.w % 2).toBe(0);
    expect(box.h % 2).toBe(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
    expect(box.y + box.h).toBeLessThanOrEqual(1000);
  });
});

describe("the story worker carries the adapter, fail-closed", () => {
  const src = readFileSync(
    join(process.cwd(), "remotion/scripts/story-worker.mjs"),
    "utf8",
  );

  it("tries the panel adapter before refusing a sheet, and still refuses on null", () => {
    expect(src).toMatch(/adaptSheetReference\(pick\.referenceUrl\)/);
    // The refusal reason survives verbatim as the adapter's fallback.
    expect(src).toMatch(/refAudit\.reason = 'SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE';/);
  });

  it("audits the adapter's decision when it attaches", () => {
    expect(src).toMatch(/sheetAdapter = 'panel-extract'/);
    expect(src).toMatch(/sheetGrid/);
    expect(src).toMatch(/sheetMass/);
  });

  it("decides in the pure module, not ad hoc in the worker", () => {
    expect(src).toMatch(/import \{ selectSheetPanel, scalePanel \} from '\.\.\/\.\.\/src\/lib\/sheetPanel\.ts'/);
  });
});
