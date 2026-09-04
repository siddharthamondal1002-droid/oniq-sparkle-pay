/**
 * IMAGE — the pure half, so the guards can be unit-tested without a network.
 *
 * Owner reference 2026-09-04 drew Image as a live Create card. The engine it
 * runs on is not new: ONIQ has drawn story stills through the Lovable gateway
 * since 2026-09-01, and the id moved to Nano Banana 2 with the owner's model
 * mapping. What was missing was a screen and the guards a user-facing,
 * money-spending button needs.
 *
 * WHY THIS DOES NOT REUSE drawStillViaGateway. That helper carries STORY
 * semantics: it forces a 9:16 portrait suffix, inlines a character reference,
 * and folds a negative prompt into the ask as a sentence. A person typing
 * "a red bicycle" into Create wants a picture of a red bicycle, not a portrait
 * shot conditioned on a cast lock. The model id is imported from that file so
 * there is still exactly one place the id lives.
 */
import { IMAGE_DIRECT } from "./modelRegistry.ts";

/**
 * The id Create — Image calls, DIRECT on Google.
 *
 * Owner directive 2026-09-04b: "make images, Voice, music, documents direct
 * Gemini not via lovable". This no longer follows the story path's gateway id
 * — the two routes have genuinely different ids (`gemini-3.1-flash-image`
 * here, `google/gemini-3.1-flash-image` there), so pointing at the gateway
 * constant would send a prefixed id to an endpoint that 404s on it.
 *
 * Taken from the registry rather than restated, so the id and its measured
 * verification stay in one place.
 */
export const IMAGE_MODEL = IMAGE_DIRECT.id;

/** A description, not an essay. */
export const IMAGE_PROMPT_MAX = 500;

/**
 * A REFERENCE IMAGE, which the direct route made possible.
 *
 * Measured 2026-09-04: the same id accepts an inlineData part before the text
 * and returns an edited picture (200, 2,405,500 bytes). The gateway's
 * OpenAI-shaped endpoint had no field for this at all, so "attach a picture"
 * is new capability, not a restyle.
 */
export type ReferenceImage = { mimeType: string; data: string };

/** What the model took in the probe, and what a phone camera actually emits. */
export const REFERENCE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * The decoded ceiling for an attached picture.
 *
 * 4 MB decoded. The client already downscales to 1024px JPEG before sending,
 * which lands around 100-300 KB, so this is a guard against a crafted body
 * rather than a limit a real photo meets. It is checked on DECODED length,
 * not on the base64 string: base64 is 4/3 the size of what it carries, and a
 * limit applied to the encoded form silently admits a third more than it says.
 */
export const REFERENCE_MAX_BYTES = 4 * 1024 * 1024;

/** Base64 with no data: prefix, no whitespace, correct padding. */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Returns an error message when an attached picture cannot be sent, or null.
 *
 * Runs BEFORE the billable call, like validateImagePrompt, so a bad
 * attachment costs nothing. Everything here is checked server-side even
 * though the client checks it too: the client is a suggestion.
 */
export function validateReferenceImage(ref: unknown): string | null {
  if (ref === undefined || ref === null) return null;
  if (typeof ref !== "object") return "That attachment could not be read.";
  const { mimeType, data } = ref as Partial<ReferenceImage>;
  if (typeof mimeType !== "string" || typeof data !== "string") {
    return "That attachment could not be read.";
  }
  if (!(REFERENCE_MIMES as readonly string[]).includes(mimeType)) {
    return "Attach a JPG, PNG or WebP picture.";
  }
  if (data.length === 0) return "That attachment was empty.";
  // A data: URL prefix is the commonest client mistake and produces a body
  // Google rejects with an opaque 400 — catch it here with a sentence a
  // person can act on.
  if (data.startsWith("data:")) return "That attachment could not be read.";
  if (!B64.test(data)) return "That attachment could not be read.";
  // 3/4 of the encoded length, less the padding, is the decoded size — worked
  // out rather than decoded, so a 30 MB body is refused without ever being
  // materialised in memory.
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decoded = Math.floor((data.length * 3) / 4) - padding;
  if (decoded > REFERENCE_MAX_BYTES) return "That picture is too large. Under 4MB, please.";
  return null;
}

/**
 * Returns an error message when the prompt cannot be sent, or null when it can.
 *
 * Runs AFTER the caps and BEFORE the billable call, which is the order the
 * cost guard needs: a rejected prompt must not consume a slot, and a slot must
 * not be consumed by a call that was never going to be made.
 */
export function validateImagePrompt(prompt: string): string | null {
  if (!prompt) return "Describe the picture you want.";
  if (prompt.length > IMAGE_PROMPT_MAX) {
    return `Keep it under ${IMAGE_PROMPT_MAX} characters.`;
  }
  return null;
}
