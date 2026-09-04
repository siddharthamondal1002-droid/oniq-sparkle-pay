/**
 * MUSIC — the pure half, so the guards can be unit-tested without a network.
 *
 * Owner directive 2026-09-04 mapped "full music/song" onto Lyria 3 Pro. The
 * split here is the one every other ONIQ generation stage uses: everything
 * that can be decided from the request alone lives in this file and is tested,
 * and the edge function keeps only the calls that need a key.
 */

/**
 * The model id, as the owner named it and as Google's catalogue spells it.
 *
 * MEASURED 2026-09-04 on the metered key: `lyria-3-pro-preview:generateContent`
 * returns 200 with an audio/mpeg part. Three Lyria ids are visible to this key
 * — `lyria-3-clip-preview` (a 30s model), `lyria-3-pro-preview`, and
 * `lyria-3.5` — and all three declare generateContent, NOT predict. The
 * unsuffixed `lyria-3-pro` the owner's note implies does not exist: it 404s
 * with "not found for API version v1beta, or is not supported for predict".
 *
 * AND THE ID IS AN ALIAS. Calling `lyria-3-pro-preview` came back
 * `modelVersion: "lyria-3.5"`. Pinning this string pins what ONIQ ASKS FOR,
 * not what answers, which is why every row records the version that served
 * instead of copying this constant into the ledger.
 */
export const MUSIC_MODEL = "lyria-3-pro-preview";

/** A sentence, not an essay. Long prompts do not buy longer songs here. */
export const MUSIC_PROMPT_MAX = 300;

/**
 * Returns an error message when the prompt cannot be sent, or null when it can.
 *
 * Validation runs AFTER the cap and BEFORE the billable call, which is the
 * order the cost guard needs: a rejected prompt must not consume a slot, and a
 * slot must not be consumed by a call that was never going to be made.
 */
export function validateMusicPrompt(prompt: string): string | null {
  if (!prompt) return "Describe the music you want.";
  if (prompt.length > MUSIC_PROMPT_MAX) {
    return `Keep it under ${MUSIC_PROMPT_MAX} characters.`;
  }
  return null;
}
