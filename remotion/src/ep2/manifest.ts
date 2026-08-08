// ONIQ Originals — Episode 2 timeline.
//
// Durations are MEASURED audio lengths (ffprobe on the generated narration
// mp3s), never the word-count estimate in originalsScript.ts — an estimate
// drifts further out of sync with every scene.
//
// Sixteen scenes, not fourteen: S14 was one 167-word block that measured 65.2
// seconds held on a single still, which reads as a stall. It was split into
// the three beats its paragraph already contained. The longest hold here is
// now S8 at 34.4s, comfortably inside the ~50s ceiling that
// originalsScript.test.ts enforces.
//
// `motion` follows the intent of each scene's motionPrompt in
// src/data/originals.ts (camera and movement only, never a re-description of
// the subject).

export const FPS = 30;
/** Cross-dissolve between scenes, in seconds. */
export const TRANSITION = 0.5;

export type Ep2Scene = {
  id: string;
  /** Real narration length in seconds. */
  seconds: number;
  /** Ken Burns zoom over the scene: 'in' | 'out' | 'none'. */
  zoom: 'in' | 'out' | 'none';
  /** Pan travel direction over the scene. */
  pan: 'none' | 'left' | 'right' | 'up' | 'down';
};

export const EP2_SCENES: Ep2Scene[] = [
  { id: 'ep2_s01', seconds: 28.44, zoom: 'none', pan: 'right' },
  { id: 'ep2_s02', seconds: 6.048, zoom: 'in', pan: 'none' },
  { id: 'ep2_s03', seconds: 19.848, zoom: 'none', pan: 'up' },
  { id: 'ep2_s04', seconds: 15.696, zoom: 'in', pan: 'none' },
  { id: 'ep2_s05', seconds: 17.784, zoom: 'none', pan: 'none' },
  { id: 'ep2_s06', seconds: 9.432, zoom: 'in', pan: 'none' },
  { id: 'ep2_s07', seconds: 31.68, zoom: 'in', pan: 'none' },
  { id: 'ep2_s08', seconds: 34.368, zoom: 'none', pan: 'down' },
  { id: 'ep2_s09', seconds: 15.264, zoom: 'in', pan: 'none' },
  { id: 'ep2_s10', seconds: 29.256, zoom: 'in', pan: 'none' },
  { id: 'ep2_s11', seconds: 8.208, zoom: 'none', pan: 'none' },
  { id: 'ep2_s12', seconds: 30.84, zoom: 'in', pan: 'none' },
  { id: 'ep2_s13', seconds: 32.16, zoom: 'in', pan: 'none' },
  { id: 'ep2_s14', seconds: 23.952, zoom: 'none', pan: 'left' },
  { id: 'ep2_s15', seconds: 25.368, zoom: 'in', pan: 'none' },
  { id: 'ep2_s16', seconds: 13.944, zoom: 'out', pan: 'none' },
];

/**
 * Measured length of the music bed, in seconds (ffprobe on bed.mp3).
 *
 * Measured, not assumed, for the same reason the scene durations are — and
 * verified against the real file by scripts/build-bed-envelope.mjs, which
 * throws if this drifts. The bed is shorter than the episode and has to loop,
 * so a wrong value here shows up as the music restarting in the wrong place.
 */
export const BED_SECONDS = 166.034286;

/** Floor, not round: overrunning the file's end would loop into silence. */
export const BED_LOOP_FRAMES = Math.floor(BED_SECONDS * FPS);

export const EP2_FRAMES = EP2_SCENES.map((s) => Math.round(s.seconds * FPS));
export const TRANSITION_FRAMES = Math.round(TRANSITION * FPS);

/** Total after transition overlaps. */
export const EP2_TOTAL =
  EP2_FRAMES.reduce((a, b) => a + b, 0) - TRANSITION_FRAMES * (EP2_SCENES.length - 1);
