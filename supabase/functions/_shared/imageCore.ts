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
import { GATEWAY_IMAGE_MODEL } from "./gatewayImage.ts";

/** One id, defined next to the story path that also uses it. */
export const IMAGE_MODEL = GATEWAY_IMAGE_MODEL;

/** A description, not an essay. */
export const IMAGE_PROMPT_MAX = 500;

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
