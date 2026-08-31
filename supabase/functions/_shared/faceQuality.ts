/**
 * The negative prompt, per shot — and the reason a shot gets one at all.
 *
 * THE OLD ONE WAS GLOBAL AND ABOUT MOTION. videogen.py carried exactly this,
 * for every shot of every film:
 *
 *     "worst quality, inconsistent motion, blurry, jittery, distorted"
 *
 * Every term there is about the clip moving badly. Not one is about a face,
 * which is what the 2026-08-31 audit was opened to explain. A wide landscape
 * and a close-up of someone's eyes were being steered away from the same five
 * failure modes, and the ones that actually ruin a face — malformed eyes,
 * duplicated features, warped hands — were never mentioned to the model.
 *
 * SO IT IS PER SHOT, AND IT IS SHORT. A negative prompt is not free: it is
 * encoded by the same text encoder, against the same token budget, as the
 * prompt that says what the shot IS. A long list of everything anyone ever
 * disliked would push the positive prompt out of the window and make the
 * frame worse. The face terms are added only where a face is actually at
 * stake, which is exactly the discipline `MOVIE_RULES` already applies to
 * whether a face appears at all.
 *
 * The worker bounds this at MAX_NEGATIVE_PROMPT_CHARS (400) and refuses
 * anything longer, so the budget is enforced on both sides.
 */

/** Failure modes that apply to any generated clip, face or not. */
const BASE_NEGATIVE = [
  "worst quality",
  "low detail",
  "blurry",
  "flicker",
  "jitter",
  "frame instability",
  "inconsistent motion",
] as const;

/**
 * Added ONLY when a person is legible in the shot. These are the artifacts
 * that make a face read as wrong rather than merely soft.
 */
const FACE_NEGATIVE = [
  "blurry face",
  "soft face",
  "deformed face",
  "malformed eyes",
  "asymmetrical eyes",
  "distorted mouth",
  "duplicate features",
  "extra limbs",
  "warped hands",
] as const;

/** The worker's own ceiling, mirrored so this side never builds an illegal one. */
export const MAX_NEGATIVE_PROMPT_CHARS = 400;

/**
 * Does this shot have a person in it whose face the model could get wrong?
 *
 * Deliberately conservative in the SAFE direction: an unclear shot gets the
 * face terms. Spending a few tokens on a landscape costs a little prompt
 * budget; omitting them from a close-up costs the shot.
 */
export function shotShowsAFace(texts: Array<string | null | undefined>): boolean {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay.trim()) return true;

  // A DENIAL IS CHECKED FIRST, and this ordering is not cosmetic. The person
  // test below matches the word "people" — which is inside the phrase "no
  // people", and inside rung 2 of the worker's own ask ladder ("a place with
  // NO PEOPLE in it"). Testing for a person before testing for the denial of
  // one made every scenery rung claim a face, which is the opposite of what
  // rung 2 is for. Measured against the real rung text, 2026-08-31.
  if (
    /\b(no people|no one|nobody|not a soul|without people|empty of people|deserted|uninhabited|unpeopled)\b/.test(
      hay,
    )
  ) {
    return false;
  }

  const person =
    /\b(he|she|they|him|her|his|face|eyes|hands?|man|woman|girl|boy|child|person|people|figure|character|smiles?|looks?|turns?|speaks?|whispers?)\b/.test(
      hay,
    );
  if (person) return true;

  // No person named and no denial: scenic language settles it, and anything
  // else falls to the safe side.
  const scenic = /\b(landscape|skyline|horizon|vista|panorama|wilderness)\b/.test(hay);
  return !scenic;
}

/**
 * The negative prompt for one shot, bounded.
 *
 * Terms are dropped from the END if the budget is tight, so the
 * highest-value ones (quality, then faces) survive a truncation rather than
 * the list being cut mid-word.
 */
export function negativePromptFor(
  texts: Array<string | null | undefined>,
  limit = MAX_NEGATIVE_PROMPT_CHARS,
): string {
  const terms = shotShowsAFace(texts)
    ? [...FACE_NEGATIVE, ...BASE_NEGATIVE]
    : [...BASE_NEGATIVE];
  const kept: string[] = [];
  for (const term of terms) {
    const candidate = kept.length ? `${kept.join(", ")}, ${term}` : term;
    if (candidate.length > limit) break;
    kept.push(term);
  }
  return kept.join(", ");
}
