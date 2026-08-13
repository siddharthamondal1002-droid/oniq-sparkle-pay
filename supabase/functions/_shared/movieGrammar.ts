// The movie grammar — what turns a slideshow plan into a FILM plan.
//
// Everything in here is distilled from actually making "Aladdin and the
// Wonderful Lamp" (episode 3: sixty Veo clips from sixty stills, cut in
// Remotion), not from a style guide. The lessons that earned their place:
//
// STILL/MOTION SPLIT IS LOAD-BEARING. The image model gets what the frame IS;
// the video model gets what MOVES, alongside that frame as `starting_frame`.
// A motion prompt that re-describes the subject fights the image it was given
// and produces drift. Text-to-video without a starting frame ignores the style
// prompt entirely (measured, 2026-08-08) — so motion prompts carry camera and
// movement ONLY.
//
// NEVER SEND CHARACTER LOCKS TO THE VIDEO MODEL. The lock's job ends when the
// still exists. Names in the video prompt invite third-party-content refusals
// (episode 3 hit these; they are sampling-flaky and retryable) and buy nothing.
//
// COVERAGE BEATS CONSISTENCY-PROMPTING. Four takes of the same face read as a
// glitch; a wide, then hands, then an object, then the face read as filmmaking.
// Thirty-four of Aladdin's sixty shots have nobody legible in them, and that —
// not better prompting — is the character-consistency strategy.
//
// DIALOGUE IS NEW CAPABILITY, NOT DECORATION. Veo 3.1 generates native audio:
// a quoted line in the prompt comes back spoken by the character in shot, with
// lip movement. The grammar for it is strict because a paragraph of speech in
// a ten-second clip truncates mid-word: one speaker, one short line, marked
// with `says:` and double quotes.

/** Camera moves the video model executes reliably from a starting frame. */
export const CAMERA_MOVES = [
  "static camera, locked off",
  "very slow push in",
  "slow pull back",
  "slow pan left",
  "slow pan right",
  "slow tilt up",
  "slow tilt down",
  "handheld drift, barely perceptible",
  "tracking alongside the subject",
  "crane rise revealing the scene",
  "low angle looking up",
  "high angle looking down",
  "over-the-shoulder hold",
] as const;

/** Shot sizes — every plan must vary these; a film of mediums is a slideshow. */
export const SHOT_SIZES = [
  "establishing",
  "wide",
  "medium",
  "close",
  "extreme close / insert",
] as const;

/**
 * VFX vocabulary that survives the image→video handoff. These are phrased as
 * ATMOSPHERE IN MOTION, because that is what a video model can actually add to
 * a given frame — particles, light, weather, not object transformations.
 */
export const VFX_VOCAB = [
  "dust motes turning in a shaft of light",
  "embers drifting upward",
  "smoke curling and thickening",
  "swirling golden magic glow",
  "heat shimmer rising",
  "rain streaking past, surfaces glistening",
  "snow falling softly",
  "fog rolling low across the ground",
  "lens flare as the light source crosses frame",
  "flickering firelight playing on the walls",
  "sparks scattering on impact",
  "water rippling and catching light",
] as const;

/** One speaker, one short line. Longer truncates mid-word in a 10s clip. */
export const MAX_DIALOGUE_WORDS = 14;

export type MovieShot = {
  still: string;
  narration: string;
  /** What MOVES — camera + subject movement only. Never re-describes the frame. */
  motion?: string;
  /** Optional spoken line for this shot. */
  dialogue?: { speaker: string; line: string };
  /** Optional atmosphere/effect cue from (or in the spirit of) VFX_VOCAB. */
  vfx?: string;
};

/**
 * The Veo-ready video prompt for one shot. The still is supplied separately as
 * `starting_frame`; this composes ONLY what moves and what is heard.
 *
 * Dialogue uses the `X says: "…"` grammar Veo's native audio responds to — and
 * X is ALWAYS the generic "The character in frame", never the speaker's name.
 * The model can see who is speaking; the name buys nothing and costs shots.
 * This stopped being theory on the first movie-grade proof film (run 72,
 * 2026-08-13): five of nine shots were refused by the content filter, and
 * three of the five carried `Aladdin says:` — a famous name is exactly what a
 * third-party-content classifier matches. The speaker's NAME still matters
 * elsewhere: the worker hashes it to keep the character's TTS voice stable.
 * Same family of lesson as "never send cast locks to the video model" above.
 */
export function composeVideoPrompt(shot: MovieShot): string {
  const parts: string[] = [];
  if (shot.motion && shot.motion.trim()) {
    parts.push(shot.motion.trim());
  } else {
    // A frame with no authored motion still needs to breathe on screen.
    parts.push("Very slow push in. Ambient movement only: air, light, cloth.");
  }
  if (shot.vfx && shot.vfx.trim()) {
    parts.push(shot.vfx.trim().replace(/\.?$/, "."));
  }
  if (shot.dialogue && shot.dialogue.line.trim()) {
    const line = shot.dialogue.line.trim().replace(/^"|"$/g, "");
    parts.push(`The character in frame says: "${line}"`);
  }
  return parts.join(" ");
}

/**
 * The rules block shared by the plan and batch prompts in story-plot. One copy
 * so the single-call film and the batched film obey the same grammar.
 */
export const MOVIE_RULES = [
  "MOVIE GRAMMAR — these fields turn frames into film:",
  "- `motion`: one or two sentences of what MOVES in the shot — a camera move",
  `  (${["static", "push in", "pull back", "pan", "tilt", "tracking", "crane rise", "low angle", "high angle"].join(", ")})`,
  "  plus subject movement. NEVER re-describe what the frame already shows —",
  "  the video model receives the image; re-description makes it drift. Write",
  "  movement only: 'She turns toward the window. Slow push in.'",
  "- Vary camera angles across the film the way an editor would: establish",
  "  wide, then coverage — a detail insert, an over-the-shoulder, a close-up.",
  "  Never the same size twice in a row.",
  '- `dialogue`: OPTIONAL — { "speaker": name, "line": text }. Use it in the',
  `  shots where a character speaking carries the beat. One speaker, at most`,
  `  ${MAX_DIALOGUE_WORDS} words — longer truncates mid-word. The line is IN ADDITION to`,
  "  narration, like a film cutting between narrator and scene.",
  "- `vfx`: OPTIONAL — one atmosphere or effect cue, phrased as motion:",
  `  ${["dust motes in light", "embers drifting", "smoke curling", "golden magic glow", "heat shimmer", "rain streaking", "fog rolling", "firelight flickering"].join("; ")}.`,
  "  Effects are atmosphere a video model can ADD to a frame — never object",
  "  transformations, which it cannot.",
  "- Coverage is the consistency strategy: most shots should have nobody",
  "  LEGIBLE in them (hands, objects, wide silhouettes, a doorway). A face",
  "  should appear only where the beat needs it. Where identity IS legible —",
  "  even a distant figure whose clothing reads — repeat the cast lock in the",
  "  `still`.",
].join("\n");
