export const FILM_CONTINUITY_RULES = [
  "FILM CONTINUITY, non-negotiable:",
  "- One film is one continuous world: keep cast, wardrobe, props, place, weather and time of day stable unless the story itself changes them on screen.",
  "- Coverage is variation around the SAME moment, not a rewrite. Change angle, distance and detail; do not silently swap people, objects or setting facts.",
  "- A beat must picture one clear visual moment. If the action changes, that is the next shot.",
  "- Where identity is legible, repeat the established cast lock verbatim.",
].join("\n");

export function filmPacingGuidance(
  screenSeconds: number | null | undefined,
  shots: number,
  hasNarration: boolean,
): string {
  if (!Number.isFinite(screenSeconds) || !Number.isInteger(shots) || shots < 1) return "";
  const total = Math.max(1, Math.round(Number(screenSeconds)));
  const perShot = total / shots;
  const wordsPerShot = Math.max(1, Math.round(perShot * 2.5));
  return [
    "PACING:",
    `- This film plays for about ${total} seconds across ${shots} shots (~${perShot.toFixed(1)}s per shot).`,
    hasNarration
      ? `- Keep each narration line sized to that slot — about ${wordsPerShot} spoken words on average, shorter on quick beats.`
      : "- Keep each beat to one screen action at a time; quick slots need terse beats.",
    "- Do not front-load exposition into one shot while the rest race to catch up.",
  ].join("\n");
}
