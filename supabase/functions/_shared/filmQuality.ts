export const FILM_CONTINUITY_RULES = [
  "FILM CONTINUITY, non-negotiable:",
  "- One film is one continuous world: keep cast, wardrobe, props, place, weather and time of day stable unless the story itself changes them on screen.",
  "- Coverage is variation around the SAME moment, not a rewrite. Change angle, distance and detail; do not silently swap people, objects or setting facts.",
  "- A beat must picture one clear visual moment. If the action changes, that is the next shot.",
  "- Where identity is legible, repeat the established cast lock verbatim.",
  "- Preserve each established character's species, anatomy and physical description in every shot, including distant silhouettes and inserts. Do not introduce an unrelated foreground actor, and never substitute a human figure for an animal one. Additional characters are allowed when the user's story calls for them; establish them on screen before they carry a beat.",
  "- REFLECTIONS: where the story calls for a reflection, compose one coherent reflection per visible subject, matching its pose, orientation and reflecting surface. Prefer a readable subject-plus-reflection framing over overlapping face-only reflections. Preserve deliberately requested surreal reflections.",
].join("\n");

/**
 * A bounded writing target for generated speech, never a measurement.
 *
 * Returns "" when the film carries VERBATIM narration: that text is the
 * user's own and is measured downstream, so asking a model to resize it
 * would be asking it to rewrite something it must not touch.
 */
export function filmPacingGuidance(
  screenSeconds: number | null | undefined,
  shots: number,
  hasVerbatimNarration: boolean,
): string {
  if (hasVerbatimNarration) return "";
  if (!Number.isFinite(screenSeconds) || !Number.isInteger(shots) || shots < 1) return "";
  const total = Math.max(1, Math.round(Number(screenSeconds)));
  if (total > 600) return "";
  const perShot = total / shots;
  // 2.5 words/second is the speech rate the timeline already assumes; the
  // band leaves room for the short pauses a cut needs.
  const low = Math.max(1, Math.floor(perShot * 2.5 * 0.7));
  const high = Math.max(low, Math.floor(perShot * 2.5 * 0.85));
  return [
    "PACING:",
    `- This film plays for about ${total} seconds across ${shots} shots (~${perShot.toFixed(1)}s per shot).`,
    `- Aim for roughly ${low}–${high} spoken words per shot TOTAL across narration and dialogue; for non-English, natural speech of similar duration.`,
    "- Give each shot its own story beat, with short purposeful pauses rather than long inert holds.",
    "- Do not front-load exposition into one shot while the rest race to catch up, and do not repeat narration as dialogue.",
    "- This is writing guidance, not measured speech duration. Keep the exact shot count and the dialogue limits.",
  ].join("\n");
}
