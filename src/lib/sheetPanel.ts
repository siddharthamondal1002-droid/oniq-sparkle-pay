/**
 * SHEET → ATTACHABLE PANEL — deterministic character-sheet adapter (Phase J
 * of the character-as-actor brick, 2026-08-22).
 *
 * Character sheets (turnarounds, pose grids) reproduce their own panel
 * layout when conditioned — measured on shot 04 of the 5-shot validation,
 * and again on the 43-shot acceptance film where a panel-styled asset
 * registered as kind:scene rendered a literal 2x2 grid into the frame
 * (job 5871421e, frame evidence on val-5871421e). The casting layer
 * therefore refuses sheets outright. This module is the upgrade path: find
 * the sheet's content panels, score each for figure content, and hand back
 * ONE clean panel to attach — or refuse, exactly as before.
 *
 * HOW IT DECIDES: content projection, not gutter hunting. Panels are
 * islands of content against the sheet's own background; gutters, ruled
 * separators and empty margins are all just the zero-content valleys
 * between them — which sidesteps the trap where a white gutter and a white
 * background are indistinguishable line by line. The grid is the cross
 * product of the X-axis and Y-axis content islands.
 *
 * FAIL-CLOSED IS THE CONTRACT. Every uncertain branch returns a refusal
 * with a named reason; the caller's refusal path is byte-identical to
 * today's SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE behavior. A sheet that
 * cannot be confidently decomposed draws text-only, never a guessed crop.
 * A SINGLE content island is also refused — one island means the "sheet"
 * is a single-pose image, and proving that safe is the registry's job
 * (re-register it as a scene), not a crop heuristic's.
 *
 * PURE AND SELF-CONTAINED — no imports (the story worker imports this file
 * directly under Node type-stripping, like particleField). The worker owns
 * decode (ffmpeg → raw RGBA, downscaled for analysis) and the final crop
 * (ffmpeg crop at original resolution); this module only decides.
 */

export type RawImage = {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
};

export type PanelBox = { x: number; y: number; w: number; h: number };

export type SheetDecision =
  | {
      ok: true;
      /** Chosen panel in the ANALYZED image's coordinates (caller rescales). */
      panel: PanelBox;
      /** Content islands the projection produced, for the audit log. */
      grid: { cols: number; rows: number };
      /** 0..1 figure-mass score of the chosen cell. */
      mass: number;
    }
  | { ok: false; reason: string };

/** Luminance of one pixel. */
function lum(d: Uint8Array, i: number): number {
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
}

/** The sheet's background level: median luminance of the border ring. */
function backgroundLevel(img: RawImage): number {
  const { width, height, data } = img;
  const ring: number[] = [];
  for (let x = 0; x < width; x += 2) {
    ring.push(lum(data, x * 4));
    ring.push(lum(data, ((height - 1) * width + x) * 4));
  }
  for (let y = 0; y < height; y += 2) {
    ring.push(lum(data, y * width * 4));
    ring.push(lum(data, (y * width + width - 1) * 4));
  }
  ring.sort((a, b) => a - b);
  return ring[ring.length >> 1];
}

/** Per-line content fraction: pixels clearly differing from the background. */
function contentProfile(img: RawImage, bg: number, vertical: boolean): number[] {
  const { width, height, data } = img;
  const extent = vertical ? width : height;
  const span = vertical ? height : width;
  const out = new Array<number>(extent);
  for (let i = 0; i < extent; i++) {
    let hits = 0;
    for (let j = 0; j < span; j += 2) {
      const x = vertical ? i : j;
      const y = vertical ? j : i;
      if (Math.abs(lum(data, (y * width + x) * 4) - bg) > 28) hits++;
    }
    out[i] = hits / Math.ceil(span / 2);
  }
  return out;
}

type Island = { start: number; end: number };

/**
 * Maximal runs where the profile carries real content. Runs separated by
 * valleys narrower than `minGap` are merged (thin internal whitespace of a
 * drawing is not a panel gutter), and runs shorter than `minLen` are
 * dropped (stray specks are not panels).
 */
function islands(profile: number[], minLen: number, minGap: number): Island[] {
  const raw: Island[] = [];
  let start = -1;
  for (let i = 0; i < profile.length; i++) {
    const has = profile[i] > 0.02;
    if (has && start < 0) start = i;
    if (!has && start >= 0) {
      raw.push({ start, end: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ start, end: profile.length - 1 });
  const merged: Island[] = [];
  for (const isl of raw) {
    const prev = merged[merged.length - 1];
    if (prev && isl.start - prev.end - 1 < minGap) prev.end = isl.end;
    else merged.push({ ...isl });
  }
  return merged.filter((i) => i.end - i.start + 1 >= minLen);
}

/**
 * Figure mass of a cell: the fraction of its pixels clearly differing from
 * the sheet background. A panel with a drawn character scores high; an
 * empty region scores ~0.
 */
function cellMass(img: RawImage, bg: number, box: PanelBox): number {
  const { width, data } = img;
  let figure = 0;
  let total = 0;
  for (let y = box.y; y < box.y + box.h; y += 2) {
    for (let x = box.x; x < box.x + box.w; x += 2) {
      total++;
      if (Math.abs(lum(data, (y * width + x) * 4) - bg) > 28) figure++;
    }
  }
  return total === 0 ? 0 : figure / total;
}

/**
 * Text-likeness of a cell: labels and caption strips are dense runs of
 * small high-contrast strokes, which show up as many luminance transitions
 * per row. A drawn figure has far fewer, larger regions. Returns mean
 * transitions per row, normalised by cell width.
 */
function textLikeness(img: RawImage, box: PanelBox): number {
  const { width, data } = img;
  let transitions = 0;
  let rows = 0;
  for (let y = box.y; y < box.y + box.h; y += 3) {
    rows++;
    let prev = lum(data, (y * width + box.x) * 4);
    for (let x = box.x + 1; x < box.x + box.w; x++) {
      const l = lum(data, (y * width + x) * 4);
      if (Math.abs(l - prev) > 40) transitions++;
      prev = l;
    }
  }
  return rows === 0 ? 0 : transitions / rows / Math.max(1, box.w);
}

/**
 * THE decision. Analyze a (downscaled) sheet image and either select one
 * clean character panel or refuse with a named reason.
 */
export function selectSheetPanel(img: RawImage): SheetDecision {
  if (
    !img ||
    !Number.isInteger(img.width) ||
    !Number.isInteger(img.height) ||
    img.width < 32 ||
    img.height < 32 ||
    img.data.length !== img.width * img.height * 4
  ) {
    return { ok: false, reason: "SHEET_MALFORMED" };
  }
  const bg = backgroundLevel(img);
  const minDim = Math.min(img.width, img.height);
  const minLen = Math.max(8, Math.floor(minDim * 0.12));
  const minGap = Math.max(2, Math.floor(minDim * 0.02));
  const xIslands = islands(contentProfile(img, bg, true), minLen, minGap);
  const yIslands = islands(contentProfile(img, bg, false), minLen, minGap);
  const cols = xIslands.length;
  const rows = yIslands.length;
  if (cols === 0 || rows === 0) {
    return { ok: false, reason: "SHEET_NO_USABLE_PANEL" };
  }
  if (cols > 6 || rows > 6) {
    return { ok: false, reason: "SHEET_GRID_TOO_DENSE" };
  }
  if (cols === 1 && rows === 1) {
    // One content island is a single-pose image, not a sheet grid. Whether
    // it is safe to attach whole is the asset registry's call (re-register
    // as a scene), not this heuristic's — refuse rather than guess.
    return { ok: false, reason: "SHEET_NO_GRID_DETECTED" };
  }
  let best: { box: PanelBox; mass: number; figurePx: number } | null = null;
  for (const yi of yIslands) {
    for (const xi of xIslands) {
      const box: PanelBox = {
        x: xi.start,
        y: yi.start,
        w: xi.end - xi.start + 1,
        h: yi.end - yi.start + 1,
      };
      // A usable figure panel is a substantial, roughly panel-shaped cell.
      if (box.w < minDim * 0.18 || box.h < minDim * 0.18) continue;
      const aspect = box.w / box.h;
      if (aspect < 0.25 || aspect > 4) continue; // label strips are long+thin
      if (textLikeness(img, box) > 0.12) continue; // caption/label cell
      const mass = cellMass(img, bg, box);
      if (mass < 0.06) continue; // empty intersection of an L-shaped layout
      // Rank by figure PIXELS, not density: island bounds hug their content,
      // so every solid figure's density is near 1 — the panel with the most
      // actual figure is the best reference.
      const figurePx = mass * box.w * box.h;
      if (!best || figurePx > best.figurePx) best = { box, mass, figurePx };
    }
  }
  if (!best) {
    return { ok: false, reason: "SHEET_NO_USABLE_PANEL" };
  }
  return {
    ok: true,
    panel: best.box,
    grid: { cols, rows },
    mass: Number(best.mass.toFixed(3)),
  };
}

/**
 * Rescale a panel chosen on the ANALYZED image back to the ORIGINAL's
 * coordinates, clamped and even-sized (ffmpeg crop prefers even numbers).
 */
export function scalePanel(
  panel: PanelBox,
  analyzed: { width: number; height: number },
  original: { width: number; height: number },
): PanelBox {
  const sx = original.width / analyzed.width;
  const sy = original.height / analyzed.height;
  const x = Math.max(0, Math.floor(panel.x * sx));
  const y = Math.max(0, Math.floor(panel.y * sy));
  let w = Math.min(original.width - x, Math.ceil(panel.w * sx));
  let h = Math.min(original.height - y, Math.ceil(panel.h * sy));
  w -= w % 2;
  h -= h % 2;
  return { x, y, w, h };
}
