// ONIQ Originals — Episode 3 timeline.
//
// SCENE-level only. The per-SHOT split lives in ./shots.ts, because this file
// has to stay importable on its own: scripts/build-bed-envelope.mjs transpiles
// it with ts.transpileModule, which compiles one file and resolves no imports.
// Add an import here and the envelope builder breaks in a way that only shows
// up as a wrong music mix. shots.ts is only ever reached through the webpack
// bundle, which resolves imports properly.
//
// DURATIONS ARE ESTIMATES UNTIL THE NARRATION EXISTS. Every other episode
// manifest carries ffprobe measurements; this one cannot yet, because episode 3
// is being generated as this is written. `MEASURED` below is the switch, and
// scripts/render-ep3.mjs refuses to render while it is false — a timeline built
// on a word-count estimate drifts further out of sync with every scene, and
// that mistake has already cost this project one full render.
//
// To land the real numbers:
//   cd remotion && node scripts/measure-ep3.mjs   # prints the array below
// then paste them in and set MEASURED = true.

export const FPS = 30;
/** Cross-dissolve between SCENES, in seconds. Shots inside a scene hard cut. */
export const TRANSITION = 0.5;

export type Ep3Scene = {
  id: string;
  /** Narration length in seconds. Measured once MEASURED is true. */
  seconds: number;
};

/**
 * False while `seconds` below are word-count estimates rather than ffprobe
 * measurements. The renderer checks it. Do not flip it by hand without
 * replacing the numbers — that is the whole failure this exists to stop.
 */
export const MEASURED = false;

/**
 * Estimated at 140 words per minute (originalsScript.ts `estimateSeconds`).
 *
 * Deliberately the SLOW figure: episode 2 measured ~2.49 words/second against
 * the 2.33 this assumes, so these run slightly long and the shot allocation in
 * shots.ts has headroom rather than overflowing the generator's 10s ceiling
 * when the real audio arrives.
 */
export const EP3_SCENES: Ep3Scene[] = [
  { id: 'ep3_s01', seconds: 19 },
  { id: 'ep3_s02', seconds: 28 },
  { id: 'ep3_s03', seconds: 21 },
  { id: 'ep3_s04', seconds: 30 },
  { id: 'ep3_s05', seconds: 37 },
  { id: 'ep3_s06', seconds: 34 },
  { id: 'ep3_s07', seconds: 14 },
  { id: 'ep3_s08', seconds: 20 },
  { id: 'ep3_s09', seconds: 19 },
  { id: 'ep3_s10', seconds: 24 },
  { id: 'ep3_s11', seconds: 49 },
  { id: 'ep3_s12', seconds: 29 },
  { id: 'ep3_s13', seconds: 31 },
  { id: 'ep3_s14', seconds: 34 },
  { id: 'ep3_s15', seconds: 10 },
  { id: 'ep3_s16', seconds: 24 },
];

export const EP3_FRAMES = EP3_SCENES.map((s) => Math.round(s.seconds * FPS));
export const TRANSITION_FRAMES = Math.round(TRANSITION * FPS);

/** Total after transition overlaps. */
export const EP3_TOTAL =
  EP3_FRAMES.reduce((a, b) => a + b, 0) - TRANSITION_FRAMES * (EP3_SCENES.length - 1);

// NO MUSIC BED YET. Episode 2 has one; episode 3 does not, and adding one is a
// separate job — generate remotion/public/ep3/bed.mp3, export BED_SECONDS and
// BED_LOOP_FRAMES here exactly as ep2/manifest.ts does, then run
// `EPISODE=ep3 node scripts/build-bed-envelope.mjs`. The ducking machinery in
// src/lib/audioDuck.ts is already episode-agnostic; nothing else has to change.
