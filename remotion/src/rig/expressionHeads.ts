// The expression heads the artist already drew, measured — rung 5's data.
//
// Four sheets carry alternate heads beside the figure: Ali Baba's three
// labeled FACE EXPRESSIONS, the mother's two, the jar jinni's four, the
// lamp jinni's slow quiet smile. Each entry below is a bust's rect on its
// sheet, its painted mouth, and its interocular distance — measured off 3x
// grid enlargements and adversarially re-derived, the rung-2 discipline,
// because a guessed mouth anchor on a SWAPPED head fails twice: the bust
// lands off the face AND the viseme overlay draws on the wrong lips.
//
// HOW A SWAP IS PLACED — mouth-to-mouth, scaled by interocular ratio. The
// bust is drawn so its mouth centre lands exactly on the base figure's
// measured mouth anchor, at scale (base interocular / bust interocular).
// Two things follow, and they are the whole design:
//   - The viseme overlay keeps drawing at the SAME screen position it
//     always has; a swap changes which face sits under it, never where the
//     mouth is. No mouth math changes anywhere.
//   - The overlay's width takes the LARGER of the base mouth and the
//     bust's painted mouth (scaled), so a grinning bust's painted teeth
//     cannot ghost out from behind a narrower rest shape.
//
// WHO IS NOT HERE, deliberately:
//   - magician: four heads drawn, all bare-haired — the rigged figure
//     wears a turban, and a swap would undress him mid-shot. Wardrobe
//     continuity is what the cast locks exist for; the heads stay unused.
//   - lampJinni's "Solemn and Patient" duplicates the base face, and
//     "Mildly Weary" is a 3/4 view that cannot sit on a front-facing body.
//   - aladdin, princess, fisherman, captain, morgiana, ringJinni: no
//     expression heads on their sheets. They keep their painted face, and
//     that absence is fine — a wrong face is worse than a constant one.
import type { Emotion } from '../../../src/lib/expressionGrammar';
import type { MouthAnchor, Rect } from './characterRig';

export type ExpressionHead = {
  /** The whole bust on the sheet — headwear and shoulders, no captions. */
  crop: Rect;
  /** The bust's own painted mouth, sheet pixels. */
  mouth: MouthAnchor;
  /** Pupil-to-pupil on the bust — the scale key against the base face. */
  interocular: number;
};

/**
 * rig key -> emotion -> measured bust. A missing entry means the character
 * has no drawn face for that feeling and keeps the base head — the same
 * absence-is-default contract as vfxKindFor and walkFor.
 *
 * MEASURED 2026-08-14, the rung-2 discipline end to end: one pass reading
 * 3x-16x grid enlargements with a composite proof per bust (mouth-to-mouth
 * over the base figure, viewed clean before reporting), then an
 * independent adversarial re-derivation of every mouth and interocular.
 * Verdicts: nine CONFIRMED, one CORRECTED (aliBaba.surprise — the first
 * pass measured only the teeth band; the painted mouth is 30px, corners
 * colour-verified at 16x). jarJinni's crop left edges are trimmed past
 * the sheet's "1."-"4." label ghosts; its stern head was measured too
 * (mouth (993,175) w23, interocular 38, crop 937/63/126/177) but maps to
 * no Emotion and stays out of the table. jarJinni.sigh's interocular is
 * the composite-proven SCALE KEY (raw closed-lid read 39 under-scales the
 * swap and lets the base ears peek; 36 covers clean — the composite is
 * the arbiter). lampJinni.smile: the base topknot peeks above the bust's
 * shorter skull in matching colours and reads as the figure's own hair.
 */
export const EXPRESSION_HEADS: Readonly<
  Record<string, Partial<Record<Emotion, ExpressionHead>>>
> = {
  aliBaba: {
    joy: {
      crop: { x: 74, y: 162, width: 134, height: 188 },
      mouth: { x: 159.5, y: 257.5, width: 38 },
      interocular: 31.8,
    },
    wonder: {
      crop: { x: 232, y: 158, width: 136, height: 192 },
      mouth: { x: 326, y: 266.5, width: 26 },
      interocular: 32.2,
    },
    surprise: {
      // The one CORRECTED entry: the verify pass re-derived the mouth.
      crop: { x: 403, y: 157, width: 147, height: 193 },
      mouth: { x: 485, y: 266, width: 30 },
      interocular: 33,
    },
  },
  mother: {
    joy: {
      crop: { x: 64, y: 88, width: 244, height: 270 },
      mouth: { x: 186, y: 231, width: 53 },
      interocular: 51,
    },
    sorrow: {
      crop: { x: 329, y: 101, width: 211, height: 296 },
      mouth: { x: 433, y: 260, width: 38 },
      interocular: 51.5,
    },
  },
  jarJinni: {
    anger: {
      crop: { x: 1426, y: 36, width: 160, height: 209 },
      mouth: { x: 1484, y: 177, width: 30 },
      interocular: 39,
    },
    wonder: {
      // 3/4-turned head with no right ear of its own; the base's ear tip
      // peeks beside the cheek and reads as the head's own ear.
      crop: { x: 1092, y: 64, width: 150, height: 178 },
      mouth: { x: 1155, y: 176, width: 25 },
      interocular: 33,
    },
    // The Ancient Sigh face carries both the weary and the grieving
    // registers — closed lids, bowed air. One measured bust, two doors in.
    weary: {
      crop: { x: 1262, y: 64, width: 143, height: 182 },
      mouth: { x: 1315, y: 175, width: 26 },
      interocular: 36,
    },
    sorrow: {
      crop: { x: 1262, y: 64, width: 143, height: 182 },
      mouth: { x: 1315, y: 175, width: 26 },
      interocular: 36,
    },
  },
  lampJinni: {
    joy: {
      crop: { x: 1244, y: 368, width: 218, height: 285 },
      mouth: { x: 1356.1, y: 511, width: 53.6 },
      interocular: 48.4,
    },
  },
};
