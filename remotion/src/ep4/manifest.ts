// ONIQ Originals — Episode 4 timeline ("Aladdin and the Ember King").
//
// SCENE-level only, exactly like ep3/manifest.ts and for the same reason: this
// file must stay importable on its own — scripts/build-bed-envelope.mjs
// transpiles it single-file with no import resolution. The per-SHOT split
// lives in ./shots.ts, which only the webpack bundle loads.
//
// DURATIONS ARE MEASURED, never estimated. Re-measure after ANY change to the
// narration mp3s:
//   cd remotion && EPISODE=ep4 node scripts/measure-ep3.mjs

export const FPS = 30;

/**
 * Cross-dissolve between SCENES, in seconds. Shots inside a scene hard cut.
 *
 * A quarter second, inherited from ep3 with ep3's own lesson re-checked
 * against THIS episode's audio (2026-08-13): the narration sits inside each
 * scene's Sequence and consecutive Sequences overlap by exactly this long, so
 * the overlap is silent only if the outgoing tail silence plus the incoming
 * head silence covers it. Measured across all fourteen ep4 mp3s the tightest
 * join covers it with margin — the numbers are in the build ledger. Re-measure
 * before raising this.
 */
export const TRANSITION = 0.25;

export type Ep4Scene = {
  id: string;
  /** Narration length in seconds. Measured once MEASURED is true. */
  seconds: number;
};

/**
 * True once `seconds` below are ffprobe measurements rather than word-count
 * estimates. The renderer checks it.
 */
export const MEASURED = true;

/**
 * MEASURED with ffprobe against remotion/public/ep4/*.mp3 (the 14 scene
 * narrations generated 2026-08-13, multi-voice scenes concatenated from their
 * segments). 366.9s of narration — the 140wpm planning estimate said ~403s,
 * ~10% high, which is exactly why estimates are never rendered.
 */
export const EP4_SCENES: Ep4Scene[] = [
  { id: 'ep4_s01', seconds: 22.416 },
  { id: 'ep4_s02', seconds: 23.112 },
  { id: 'ep4_s03', seconds: 29.28 },
  { id: 'ep4_s04', seconds: 25.464 },
  { id: 'ep4_s05', seconds: 25.464 },
  { id: 'ep4_s06', seconds: 24.216 },
  { id: 'ep4_s07', seconds: 30.576 },
  { id: 'ep4_s08', seconds: 21.552 },
  { id: 'ep4_s09', seconds: 27.216 },
  { id: 'ep4_s10', seconds: 28.2 },
  { id: 'ep4_s11', seconds: 25.752 },
  { id: 'ep4_s12', seconds: 23.712 },
  { id: 'ep4_s13', seconds: 28.368 },
  { id: 'ep4_s14', seconds: 31.56 },
];

export const EP4_FRAMES = EP4_SCENES.map((s) => Math.round(s.seconds * FPS));
export const TRANSITION_FRAMES = Math.round(TRANSITION * FPS);

/** Total after transition overlaps. */
export const EP4_TOTAL =
  EP4_FRAMES.reduce((a, b) => a + b, 0) - TRANSITION_FRAMES * (EP4_SCENES.length - 1);

// NO MUSIC BED YET — same standing gap as ep3. The ducking machinery in
// src/lib/audioDuck.ts is episode-agnostic; adding a bed is generate
// public/ep4/bed.mp3, export BED_SECONDS/BED_LOOP_FRAMES here, and run
// EPISODE=ep4 node scripts/build-bed-envelope.mjs.
