// ONIQ Originals — Episode 1 timeline.
//
// Durations are MEASURED audio lengths (ffprobe on the generated narration
// mp3s), never the word-count estimate in originalsScript.ts — an estimate
// drifts further out of sync with every scene.
//
// `motion` follows the intent of each scene's motionPrompt in
// src/data/originals.ts (camera and movement only, never a re-description of
// the subject).

export const FPS = 30;
/** Cross-dissolve between scenes, in seconds. */
export const TRANSITION = 0.5;

export type Ep1Scene = {
  id: string;
  /** Real narration length in seconds. */
  seconds: number;
  /** Ken Burns zoom over the scene: 'in' | 'out' | 'none'. */
  zoom: 'in' | 'out' | 'none';
  /** Pan travel direction over the scene. */
  pan: 'none' | 'left' | 'right' | 'up' | 'down';
};

export const EP1_SCENES: Ep1Scene[] = [
  { id: 'ep1_s01', seconds: 22.32, zoom: 'in', pan: 'none' },
  { id: 'ep1_s02', seconds: 14.784, zoom: 'in', pan: 'none' },
  { id: 'ep1_s03', seconds: 16.632, zoom: 'in', pan: 'down' },
  { id: 'ep1_s04', seconds: 8.808, zoom: 'none', pan: 'down' },
  { id: 'ep1_s05', seconds: 17.112, zoom: 'none', pan: 'right' },
  { id: 'ep1_s06', seconds: 29.784, zoom: 'in', pan: 'none' },
  { id: 'ep1_s07', seconds: 16.584, zoom: 'in', pan: 'none' },
  { id: 'ep1_s08', seconds: 19.32, zoom: 'out', pan: 'up' },
  { id: 'ep1_s09', seconds: 45.048, zoom: 'in', pan: 'none' },
  { id: 'ep1_s10', seconds: 35.352, zoom: 'in', pan: 'none' },
  { id: 'ep1_s11', seconds: 26.208, zoom: 'none', pan: 'down' },
  { id: 'ep1_s12', seconds: 40.944, zoom: 'out', pan: 'none' },
];

export const EP1_FRAMES = EP1_SCENES.map((s) => Math.round(s.seconds * FPS));
export const TRANSITION_FRAMES = Math.round(TRANSITION * FPS);

/** Total after transition overlaps. */
export const EP1_TOTAL =
  EP1_FRAMES.reduce((a, b) => a + b, 0) - TRANSITION_FRAMES * (EP1_SCENES.length - 1);
