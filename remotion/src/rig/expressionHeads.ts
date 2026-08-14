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
 */
export const EXPRESSION_HEADS: Readonly<
  Record<string, Partial<Record<Emotion, ExpressionHead>>>
> = {};
