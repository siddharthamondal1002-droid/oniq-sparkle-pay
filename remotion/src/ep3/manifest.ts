// ONIQ Originals — Episode 3 timeline.
//
// SCENE-level only. The per-SHOT split lives in ./shots.ts, because this file
// has to stay importable on its own: scripts/build-bed-envelope.mjs transpiles
// it with ts.transpileModule, which compiles one file and resolves no imports.
// Add an import here and the envelope builder breaks in a way that only shows
// up as a wrong music mix. shots.ts is only ever reached through the webpack
// bundle, which resolves imports properly.
//
// DURATIONS ARE MEASURED, never estimated. `MEASURED` is the switch and
// scripts/render-ep3.mjs refuses to render while it is false — a timeline built
// on a word-count estimate drifts further out of sync with every scene, and
// that mistake has already cost this project one full render.
//
// Re-measure after ANY change to the narration mp3s:
//   cd remotion && node scripts/measure-ep3.mjs   # prints the array below

export const FPS = 30;
/** Cross-dissolve between SCENES, in seconds. Shots inside a scene hard cut. */
export const TRANSITION = 0.5;

export type Ep3Scene = {
  id: string;
  /** Narration length in seconds. Measured once MEASURED is true. */
  seconds: number;
};

/**
 * True once `seconds` below are ffprobe measurements rather than word-count
 * estimates. The renderer checks it. Do not flip it by hand without replacing
 * the numbers — that is the whole failure this exists to stop.
 */
export const MEASURED = true;

/**
 * MEASURED with ffprobe against remotion/public/ep3/*.mp3 — never the word
 * count. Reproduce with `node scripts/measure-ep3.mjs`, which also cross-checks
 * each container duration against the decoded audio and refuses a truncated
 * file.
 *
 * 414.7s of narration. The 140wpm planning estimate these replaced said 423s,
 * which is close in total and wrong per scene by up to 6s in both directions —
 * S10 came in 6.3s LONGER than estimated and S13 5.1s shorter. That is exactly
 * why an estimate is never rendered: the error does not cancel, it accumulates
 * as drift between the picture and the voice.
 *
 * Three scenes (S04, S06, S10) overflowed their shot budget when these landed,
 * and shots.ts refused to load until each gained one more shot. The list is now
 * 60 shots rather than 57.
 */
export const EP3_SCENES: Ep3Scene[] = [
  { id: 'ep3_s01', seconds: 16.200 },
  { id: 'ep3_s02', seconds: 29.088 },
  { id: 'ep3_s03', seconds: 20.736 },
  { id: 'ep3_s04', seconds: 35.448 },
  { id: 'ep3_s05', seconds: 36.000 },
  { id: 'ep3_s06', seconds: 38.808 },
  { id: 'ep3_s07', seconds: 14.208 },
  { id: 'ep3_s08', seconds: 19.656 },
  { id: 'ep3_s09', seconds: 15.576 },
  { id: 'ep3_s10', seconds: 30.264 },
  { id: 'ep3_s11', seconds: 43.848 },
  { id: 'ep3_s12', seconds: 28.608 },
  { id: 'ep3_s13', seconds: 25.944 },
  { id: 'ep3_s14', seconds: 31.584 },
  { id: 'ep3_s15', seconds: 10.248 },
  { id: 'ep3_s16', seconds: 18.528 },
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
