// The nine mouth shapes, drawn rather than generated.
//
// WHY DRAWN. The whole point of moving Stories in-house is that a second of
// finished video costs no gateway call. Mouth art from the image model would be
// a one-time cost per character rather than a per-second one, so it is
// affordable — but it does not exist yet, and waiting for it would leave the
// entire rig unproven. These paths let the pipeline be rendered and watched
// today, and they are the fallback for any character with no sheet drawn.
//
// They are deliberately plain: a lip line and an opening, in one colour. Not
// "good art that happens to be code" — a legible placeholder whose TIMING can
// be judged, because timing is the thing this rig has to get right and the
// thing a still frame cannot show.
//
// SWAPPING IN REAL ART. Replace <Mouth> with an <Img> per viseme keyed off the
// same `Viseme` union. Nothing else changes: the cue track, the weights and the
// measurement are all art-independent. Keep the same 100x60 viewBox and the
// same baseline so a sheet drops in without re-registering placement.
import type { Viseme } from '../../../src/lib/visemes';

/**
 * viewBox coordinates, shared by every shape.
 *
 * The mouth is drawn around (50, 30) with the lip line at y=30, so a sheet of
 * real art can be registered by putting its lip line on that row and nothing
 * needs to know which shape it is looking at.
 */
export const MOUTH_VIEWBOX = { width: 100, height: 60, cx: 50, cy: 30 };

export type MouthShape = {
  /** Outer lip outline, always closed. */
  outline: string;
  /** The dark opening. Absent on a closed mouth, which is the point of A and X. */
  opening?: string;
  /** Upper teeth, where the shape shows them. */
  teeth?: string;
};

/**
 * Preston Blair A-H plus X, as SVG paths.
 *
 * The distinctions that carry the read, in rough order of how much they matter:
 *   - OPEN vs CLOSED (A/X against everything else). Most of the effect.
 *   - WIDE vs ROUND (D/C against E/F). Vowel colour.
 *   - Teeth showing (B, G). What makes consonants look like consonants.
 * A shape that gets those three right reads correctly at 1080p even drawn this
 * plainly; one that gets them wrong is not rescued by better art.
 */
export const MOUTH_SHAPES: Readonly<Record<Viseme, MouthShape>> = {
  // Closed, lips together. m, b, p.
  A: {
    outline: 'M 22 30 Q 50 26 78 30 Q 50 34 22 30 Z',
  },
  // Slightly open, teeth nearly together. Most consonants.
  B: {
    outline: 'M 24 30 Q 50 20 76 30 Q 50 40 24 30 Z',
    opening: 'M 30 30 Q 50 24 70 30 Q 50 36 30 30 Z',
    teeth: 'M 32 28 Q 50 25 68 28 L 68 30 Q 50 27 32 30 Z',
  },
  // Open, relaxed. e, i.
  C: {
    outline: 'M 24 28 Q 50 14 76 28 Q 50 46 24 28 Z',
    opening: 'M 31 28 Q 50 19 69 28 Q 50 40 31 28 Z',
    teeth: 'M 33 25 Q 50 21 67 25 L 67 27 Q 50 23 33 27 Z',
  },
  // Wide open. a.
  D: {
    outline: 'M 22 26 Q 50 6 78 26 Q 50 54 22 26 Z',
    opening: 'M 30 26 Q 50 12 70 26 Q 50 47 30 26 Z',
  },
  // Rounded. o.
  E: {
    outline: 'M 34 30 Q 50 12 66 30 Q 50 48 34 30 Z',
    opening: 'M 39 30 Q 50 18 61 30 Q 50 42 39 30 Z',
  },
  // Puckered, small and forward. u, w.
  F: {
    outline: 'M 39 30 Q 50 19 61 30 Q 50 41 39 30 Z',
    opening: 'M 43 30 Q 50 24 57 30 Q 50 36 43 30 Z',
  },
  // Teeth on lower lip. f, v.
  G: {
    outline: 'M 26 30 Q 50 22 74 30 Q 50 38 26 30 Z',
    opening: 'M 32 31 Q 50 28 68 31 Q 50 36 32 31 Z',
    teeth: 'M 33 27 Q 50 24 67 27 L 67 31 Q 50 28 33 31 Z',
  },
  // Tongue up behind the teeth. l.
  H: {
    outline: 'M 26 29 Q 50 17 74 29 Q 50 43 26 29 Z',
    opening: 'M 32 29 Q 50 22 68 29 Q 50 38 32 29 Z',
    teeth: 'M 34 26 Q 50 23 66 26 L 66 28 Q 50 25 34 28 Z',
  },
  // Rest. Silence. Softer than A — a closed mouth at rest is not a pressed one,
  // and holding the m/b/p shape through every pause makes a character look
  // like they are permanently about to speak.
  X: {
    outline: 'M 26 30 Q 50 27 74 30 Q 50 33 26 30 Z',
  },
};
