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
