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

/**
 * THE FULL-SONG MODEL IS ALREADY 3.5, UNDER AN OLDER NAME.
 *
 * Owner directive 2026-09-04c asked for `lyria-3.5-pro-preview`. Measured:
 * that id 404s, and so does `lyria-3.5-clip-preview`. But the ask is already
 * satisfied — `lyria-3-pro-preview`, which is what MUSIC_MODEL has always
 * been, answers 200 and reports `modelVersion: lyria-3.5`. It is an ALIAS
 * that Google already points at 3.5, so ONIQ has been on the newer engine
 * without the id changing.
 *
 * Measured 2026-09-04, text prompt "a calm lo-fi track":
 *   lyria-3.5-pro-preview    404  not found for v1beta / generateContent
 *   lyria-3.5-clip-preview   404  not found
 *   lyria-3.5                200  5,755,844 B  modelVersion lyria-3.5
 *   lyria-3-pro-preview      200  5,816,261 B  modelVersion lyria-3.5   <- ours
 *   lyria-3-clip-preview     200    993,519 B  modelVersion lyria-3-clip-preview
 *
 * The bare `lyria-3.5` is NOT adopted. It answers, but the alias is what has
 * production history here, and swapping a working id for one that resolves to
 * the same engine buys nothing while risking the alias and the target drifting
 * apart later.
 */

/** ~30 seconds rather than a full song. A genuinely different model. */
export const MUSIC_CLIP_MODEL = "lyria-3-clip-preview";

/**
 * NO AUDIO REFERENCE — and that is not the end of the feature.
 *
 * Sending a recording to Lyria is closed, thoroughly:
 *
 *   lyria + inlineData wav   400  and lyria + inlineData mp3  400, both with
 *        the identical message, so it is not a container or codec problem:
 *        "Unsupported input mime type for this model: audio/s16le"
 *   same prompt, no audio    200  5,578,562 bytes, a real track
 *   :predict on every id     404  lyria supports only generateContent
 *   lyria-002                404  does not exist
 *
 * OWNER DIRECTIVE 2026-09-04c gives the right architecture instead:
 *
 *   reference audio -> Gemini listens -> structured music brief -> Lyria
 *
 * The recording never reaches Lyria; a description of it does. See
 * _shared/musicBrief.ts. That is better than a direct transform, not a
 * consolation prize: ONIQ generates something original from characteristics
 * rather than laundering a recording it does not own.
 */
export const MUSIC_ACCEPTS_AUDIO_REFERENCE = false;

/**
 * AN IMAGE REFERENCE, ON THE OTHER HAND, GOES STRAIGHT IN.
 *
 * The owner said Lyria takes text AND image. Measured 2026-09-04, a 256x256
 * PNG as an inlineData part before the text "music inspired by this picture":
 *
 *   lyria-3-pro-preview    200  5,215,484 B  audio/mpeg back, and the lyrics
 *                               were visibly derived from the picture
 *                               ("Colors bouncing off the walls of my mind
 *                                 ... green and blue and a dash of bright red")
 *   lyria-3-clip-preview   200    994,461 B  audio/mpeg back
 *   lyria-3.5              200    no audio — promptFeedback.blockReason
 *                               PROHIBITED_CONTENT on that one sampling
 *
 * Google billed the image in `promptTokensDetails` as modality IMAGE, 258
 * tokens, so it was genuinely read rather than ignored.
 *
 * THAT LAST ROW IS THE REASON THE CALLER NEEDS A REFUSAL PATH. A safety
 * filter can return 200 with no audio at all, which is a silent failure
 * wearing a success status — the same shape every generation path here
 * guards against.
 */
export const MUSIC_ACCEPTS_IMAGE_REFERENCE = true;

/** What a person may attach as a picture, and the ceiling on it. */
export const MUSIC_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MUSIC_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * What a person may attach as a REFERENCE TRACK.
 *
 * The same list the transcribe path takes, because the file goes to the same
 * place: an ordinary Gemini model, which listens to it and describes it. It
 * never reaches Lyria — see MUSIC_ACCEPTS_AUDIO_REFERENCE above and
 * musicBrief.ts for the pipeline.
 */
export const MUSIC_AUDIO_MIMES = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
] as const;

/** 8 MB decoded — a couple of minutes of compressed audio, not a whole album. */
export const MUSIC_AUDIO_MAX_BYTES = 8 * 1024 * 1024;

/** Base64 with no data: prefix, no whitespace, correct padding. */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The decoded size of a base64 string, WORKED OUT rather than decoded.
 *
 * A 30 MB body is then refused without ever being materialised in memory,
 * which is the same rule the still-upload path follows.
 */
function decodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** The shape checks every inline attachment needs, before the mime-specific ones. */
function inlineFaults(ref: unknown): { mimeType: string; data: string } | string {
  if (typeof ref !== "object" || ref === null) return "That attachment could not be read.";
  const { mimeType, data } = ref as { mimeType?: unknown; data?: unknown };
  if (typeof mimeType !== "string" || typeof data !== "string") {
    return "That attachment could not be read.";
  }
  if (data.length === 0) return "That attachment was empty.";
  // A data: URL prefix is the commonest client mistake and produces an opaque
  // 400 from Google — caught here with a sentence a person can act on.
  if (data.startsWith("data:") || !B64.test(data)) return "That attachment could not be read.";
  return { mimeType, data };
}

/**
 * Returns an error message when an attached PICTURE cannot be sent, or null.
 *
 * Runs before the billable call, so a bad attachment costs nothing. Checked
 * server-side even though the client checks it too: the client is a
 * suggestion.
 */
export function validateMusicImage(ref: unknown): string | null {
  if (ref === undefined || ref === null) return null;
  const parsed = inlineFaults(ref);
  if (typeof parsed === "string") return parsed;
  if (!(MUSIC_IMAGE_MIMES as readonly string[]).includes(parsed.mimeType)) {
    return "Attach a JPG, PNG or WebP picture.";
  }
  if (decodedBytes(parsed.data) > MUSIC_IMAGE_MAX_BYTES) {
    return "That picture is too large. Under 4MB, please.";
  }
  return null;
}

/**
 * Returns an error message when an attached TRACK cannot be sent, or null.
 *
 * The mime is compared on its BASE, before any `;codecs=` parameter:
 * MediaRecorder tags its blobs "audio/webm;codecs=opus", and comparing the
 * whole string would reject every recording the app itself made.
 */
export function validateMusicAudio(ref: unknown): string | null {
  if (ref === undefined || ref === null) return null;
  const parsed = inlineFaults(ref);
  if (typeof parsed === "string") return parsed;
  const base = parsed.mimeType.split(";")[0].trim().toLowerCase();
  if (!(MUSIC_AUDIO_MIMES as readonly string[]).includes(base)) {
    return "Attach an audio file — WAV, MP3, M4A, OGG or WebM.";
  }
  if (decodedBytes(parsed.data) > MUSIC_AUDIO_MAX_BYTES) {
    return "That track is too long. Under 8MB, please.";
  }
  return null;
}

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
