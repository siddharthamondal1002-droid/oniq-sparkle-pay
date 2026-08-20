import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  END_FADE_SECONDS,
  TITLE_SECONDS,
  endFadeAt,
  titleOpacityAt,
} from "@/lib/filmChrome";

const ROOT = join(__dirname, "../../..");
const MODULE_SRC = readFileSync(join(ROOT, "src/lib/filmChrome.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const FILM_SRC = readFileSync(join(ROOT, "remotion/src/story/StoryFilm.tsx"), "utf8");

/**
 * Rung 9's contracts: the chrome is two bounded envelopes that add no
 * frames, gated on the movie grade, with classic films pixel-identical.
 */
describe("the title card envelope", () => {
  const FPS = 30;

  it("rises, holds, releases — all inside its window, gone after", () => {
    const total = TITLE_SECONDS * FPS;
    let sawFull = false;
    for (let f = 0; f < total; f++) {
      const o = titleOpacityAt(f, FPS);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
      if (o === 1) sawFull = true;
    }
    expect(sawFull, "the title never reaches full opacity").toBe(true);
    expect(titleOpacityAt(Math.ceil(total), FPS)).toBe(0);
    expect(titleOpacityAt(-1, FPS)).toBe(0);
    expect(titleOpacityAt(10, 0)).toBe(0);
    // The card must be gone well before a plausible first cut (~4s).
    expect(TITLE_SECONDS).toBeLessThan(4);
  });
});

describe("the closing fade", () => {
  const FPS = 30;

  it("is silent until its window, then eases monotonically to black at the last frame", () => {
    const total = 12 * FPS;
    const windowStart = total - 1 - END_FADE_SECONDS * FPS;
    let prev = 0;
    for (let f = 0; f < total; f++) {
      const o = endFadeAt(f, total, FPS);
      if (f < windowStart) expect(o, `frame ${f}`).toBe(0);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    expect(endFadeAt(total - 1, total, FPS)).toBeCloseTo(1, 5);
    expect(endFadeAt(0, 0, FPS)).toBe(0);
    // A film shorter than the fade still ends black, never over-black.
    for (let f = 0; f < 10; f++) {
      const o = endFadeAt(f, 10, FPS);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe("the wiring pins", () => {
  it("stays zero-import, worker-loadable", () => {
    expect(MODULE_SRC).not.toMatch(/^import /m);
  });

  it("the worker names the grade and the composition gates the chrome on it", () => {
    expect(
      WORKER_SRC.includes("grade: job.grade === 'movie' ? 'movie' : 'classic'"),
      "renderPlan no longer receives the grade — rung 9 never fires",
    ).toBe(true);
    expect(
      FILM_SRC.includes('grade === "movie" && title'),
      "the title card lost its movie gate — classic films would grow chrome",
    ).toBe(true);
    expect(
      FILM_SRC.includes('grade === "movie" ? <EndFade'),
      "the closing fade lost its movie gate",
    ).toBe(true);
    // The chrome overlays paid shots; it must never extend the timeline.
    expect(
      FILM_SRC.includes("storyFrames(shots, usedFps)"),
      "duration no longer derives from the shots alone",
    ).toBe(true);
  });

  it("the composition uses the ceiling-safe audio frame conversion", () => {
    expect(FILM_SRC).toContain("framesForStorySeconds(s.seconds, fps)");
  });
});
