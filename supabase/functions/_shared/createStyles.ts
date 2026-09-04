/**
 * THE STYLE AND MOOD CHIPS the owner's reference draws on Create — Image and
 * Create — Music, and the one thing that makes them safe to ship.
 *
 * THEY ARE PROMPT TEXT, NOT AN API PARAMETER. That distinction is the whole
 * design. This repo's rule is that a model id or a request field goes into
 * code only after a POST has proved this key may use it — and neither Gemini's
 * image endpoint nor Lyria has a verified `style` or `mood` field here. So
 * these do not invent one. A chip appends a CLAUSE to the prompt, which is
 * how a person would have written it themselves, and which cannot 400.
 *
 * THE VOCABULARY IS CLOSED, AND THE SUFFIX IS BUILT SERVER-SIDE. The client
 * sends a short token like "cinematic" and gets it checked against this list;
 * anything else is dropped rather than rejected, because an unknown chip is a
 * client that is ahead of its server, not an attack, and a person should get
 * their picture. What a caller must never be able to do is post arbitrary
 * text into a second prompt slot on a paid model, which is exactly what
 * accepting a free-text `style` would be.
 *
 * THE PERSON'S OWN WORDS STILL LEAD. The suffix is appended, never prepended:
 * "a red bicycle against a blue wall. Cinematic..." reads as their sentence
 * with a note after it, where the reverse reads as the style's picture with
 * their subject as an afterthought. The same ordering the music brief uses.
 *
 * PURE — no network, no key — so every branch is unit-tested.
 */

/** What Create — Image offers. "auto" is the absence of a style, not a style. */
export const IMAGE_STYLES = ["auto", "realistic", "cinematic", "anime"] as const;
export type ImageStyle = (typeof IMAGE_STYLES)[number];

/** What Create — Music offers. */
export const MUSIC_MOODS = ["chill", "energetic", "cinematic", "happy"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

/**
 * The clause each style adds.
 *
 * Written as a photographer or illustrator would describe the LOOK, not as an
 * adjective — "cinematic" alone is a word models interpret loosely, where
 * naming the lighting and the framing gets a consistent result. Kept short:
 * a long suffix starts to compete with the subject.
 */
const IMAGE_STYLE_CLAUSE: Record<Exclude<ImageStyle, "auto">, string> = {
  realistic:
    "Photographic and realistic: natural light, true-to-life colour, real materials and textures.",
  cinematic:
    "Cinematic: shallow depth of field, dramatic directional light, filmic colour grading, wide framing.",
  anime:
    "Anime illustration: clean linework, cel shading, expressive faces, saturated colour, painted backgrounds.",
};

const MUSIC_MOOD_CLAUSE: Record<MusicMood, string> = {
  chill: "Relaxed and unhurried, warm and easy, gentle groove.",
  energetic: "High energy, driving rhythm, bright and forward.",
  cinematic: "Cinematic and wide, building, orchestral weight and atmosphere.",
  happy: "Bright and joyful, major key, uplifting.",
};

/** A caller's value, or null when it is absent or not one of ours. */
export function readImageStyle(v: unknown): ImageStyle | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (IMAGE_STYLES as readonly string[]).includes(s) ? (s as ImageStyle) : null;
}

export function readMusicMood(v: unknown): MusicMood | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (MUSIC_MOODS as readonly string[]).includes(s) ? (s as MusicMood) : null;
}

/**
 * The prompt with the style clause after it, or the prompt unchanged.
 *
 * "auto" returns the prompt untouched — it means "no style", so adding words
 * that say so would be worse than adding nothing. An empty prompt is returned
 * as-is too: composing onto nothing would manufacture a prompt out of a chip,
 * and the caller's own emptiness check is what should speak.
 */
export function withImageStyle(prompt: string, style: unknown): string {
  const s = readImageStyle(style);
  if (!s || s === "auto" || !prompt.trim()) return prompt;
  return `${prompt.trim().replace(/[.\s]+$/, "")}. ${IMAGE_STYLE_CLAUSE[s]}`;
}

export function withMusicMood(prompt: string, mood: unknown): string {
  const m = readMusicMood(mood);
  if (!m || !prompt.trim()) return prompt;
  return `${prompt.trim().replace(/[.\s]+$/, "")}. ${MUSIC_MOOD_CLAUSE[m]}`;
}

/* ------------------------------------------------------------ aspect ratio
 * THIS ONE IS A REAL REQUEST FIELD, and that is the difference.
 *
 * Style and Mood above are prompt text because no verified field exists for
 * them. Aspect ratio is not like that — MEASURED 2026-09-04 against the real
 * key, and measured properly, which means three separate things were checked:
 *
 *   1. THE FIELD IS ACCEPTED.
 *        generationConfig.imageConfig.aspectRatio = "16:9"   200
 *        generationConfig.aspectRatio             = "16:9"   400
 *            Unknown name "aspectRatio" at 'generation_config':
 *            Cannot find field.
 *      So it is nested, and only nested.
 *
 *   2. THE ERROR SHAPE IS TRUSTWORTHY, which is what makes (1) mean anything.
 *      A deliberate nonsense sibling was sent as a control:
 *        imageConfig.nonsenseFieldXyz             = "16:9"   400
 *            Unknown name "nonsenseFieldXyz" at
 *            'generation_config.image_config': Cannot find field.
 *      An endpoint that silently swallowed unknown fields would have returned
 *      200 there, and the 200 in (1) would have proved nothing.
 *
 *   3. IT IS NOT ACCEPTED AND IGNORED. The returned PIXELS change, and every
 *      value this file offers was POSTed rather than assumed from the three
 *      that happened to get tested first:
 *        control (no aspectRatio)  1408x768
 *        1:1                       1024x1024
 *        3:4                        896x1200
 *        16:9                      1376x768
 *        9:16                       768x1376
 *      This is the check that matters most and the one easiest to skip. A
 *      parameter accepted and ignored is a control that lies, and it looks
 *      identical to a working one from the status code alone.
 *
 * DURATION, ASKED FOR IN THE SAME REFERENCE, IS NOT REAL AND IS NOT BUILT.
 * Every shape returned 400 on lyria-3-pro-preview, identical to the nonsense
 * control: durationSeconds, audioConfig.durationSeconds and
 * musicConfig.durationSeconds all "Cannot find field". There is no duration
 * parameter on Lyria via this key, so Create - Music gets no Duration row
 * rather than four chips that change nothing.
 * -------------------------------------------------------------------------- */

/** What Create - Image offers, in the reference's order. */
export const ASPECT_RATIOS = ["1:1", "3:4", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * A caller's value, or null when it is absent or not one of ours.
 *
 * The allowlist is the point: `aspectRatio` reaches Google verbatim, so an
 * unchecked value would let a caller put arbitrary text into a request field
 * on a paid model. Google would reject it, but the charge and the round trip
 * would already have happened.
 */
export function readAspectRatio(v: unknown): AspectRatio | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return (ASPECT_RATIOS as readonly string[]).includes(s) ? (s as AspectRatio) : null;
}

/**
 * The `imageConfig` for a generation, or undefined to send none at all.
 *
 * Undefined rather than an empty object: the endpoint has rejected malformed
 * config shapes before, and there is no reason to send a field that says
 * nothing. Omitting it is also what the measured CONTROL did, so "no ratio
 * chosen" is a request that has been proven to work rather than a new one.
 */
export function imageConfigFor(aspectRatio: unknown): { aspectRatio: string } | undefined {
  const r = readAspectRatio(aspectRatio);
  return r ? { aspectRatio: r } : undefined;
}
