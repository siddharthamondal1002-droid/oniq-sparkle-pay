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

import { shotShowsAFace } from "./faceQuality.ts";
import { FILM_CONTINUITY_RULES } from "./filmQuality.ts";

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
  /**
   * Optional expression/action cue for the in-house composer's fourth slot —
   * what the subject DOES, as opposed to what the camera does. Unused by the
   * Veo composer, which measured subject description as harmful there.
   */
  action?: string;
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
 * THE IN-HOUSE (LTX) VIDEO PROMPT. Four concerns, in one flowing paragraph.
 *
 * WHY A SECOND COMPOSER RATHER THAN A FLAG ON THE FIRST. composeVideoPrompt
 * above is tuned to Veo and every one of its rules is MEASURED on episode 3 —
 * no subject re-description (it fights the starting frame), no names (the
 * third-party-content classifier matches them; five of nine shots refused on
 * run 72). Those findings are about Veo's classifier and Veo's conditioning.
 * LTX runs on ONIQ's own GPU, has no content classifier in the path at all,
 * and conditions differently. Making one function serve both through a flag
 * would put two engines' evidence in one body of code where a change for one
 * silently moves the other. So the Veo composer stays exactly as it was
 * measured, and this one stands next to it.
 *
 * THE STRUCTURE, and where it comes from. LTX's own prompting guidance asks
 * for ONE detailed English paragraph, ordered: the main action first, then
 * the specifics of movement and appearance, then the scene, then the camera,
 * then how it changes over time. Labelled sections ("Camera: …") are not that
 * shape — the text encoder reads prose, and a label is a token it has no use
 * for. So the four concerns are ordered, not tagged:
 *
 *   1. VISUAL CONDITION   what the frame holds — a short anchor so an i2v
 *                         sample stays on the image it was given instead of
 *                         drifting off it over 97 frames.
 *   2. MOTION             what moves.
 *   3. CAMERA             how the camera moves, named explicitly and once.
 *   4. EXPRESSION/ACTION  what the subject does, and what is said.
 *
 * WHAT THE OLD ONE SENT. `composeVideoPrompt` for a shot with no authored
 * motion produced exactly "Very slow push in. Ambient movement only: air,
 * light, cloth." — twelve words, no subject, no scene, no expression, for a
 * four-second clip. On Veo that is correct, because Veo holds the starting
 * frame hard. On LTX it is most of what the model was ever told about the
 * shot, and the audit's soft, drifting faces are what came back.
 *
 * BOUNDED, because the text encoder's window is shared with everything else
 * and a paragraph that overruns it silently loses its tail — which is the
 * expression, the part the audit says is missing.
 */

/** The visual anchor's share of the prompt. The rest is motion and camera. */
const MAX_CONDITION_CHARS = 220;

/** Used when a shot authored no camera move. Named, so it is never implicit. */
export const DEFAULT_CAMERA = "static camera, locked off, very slow push in";

/**
 * Used when a shot has a person in it and authored no expression or line.
 * Describes BEHAVIOUR, never identity — see the note at the call site.
 */
export const DEFAULT_EXPRESSION =
  "the face stays in focus and holds its expression, features stable throughout";

/**
 * Does this motion text already name its own camera move? If it does, the
 * camera slot must not add a second one — two camera instructions in one
 * prompt is how a clip ends up drifting in two directions at once.
 */
export function namesACameraMove(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(static|locked off|push in|pull back|pan|tilt|track|tracking|dolly|crane|zoom|handheld|orbit|aerial|close[- ]?up|wide shot|over[- ]the[- ]shoulder|low angle|high angle)\b/.test(
    t,
  );
}

/**
 * The frame's own description, cut down to an anchor.
 *
 * The FIRST sentence only, and the character-lock block never. A lock is
 * wardrobe and identity written for the IMAGE model — it has already done its
 * job by the time a still exists, and repeating it at the video model buys
 * nothing while spending the budget the expression needs. Same rule as the
 * Veo composer's, kept for a different reason: not refusals here, but tokens.
 */
export function visualCondition(still: string | undefined | null): string {
  const text = String(still ?? "")
    // Everything from a lock or setting header onward is scaffolding for the
    // image stage, not a description of the frame.
    .split(/\n\s*(?:Characters?|Cast|Setting|Style)\s*:/i)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  // One sentence. A still prompt is often three, and the second and third are
  // usually lighting and palette, which the starting frame already carries.
  const stop = text.search(/[.!?](\s|$)/);
  const first = stop > 0 ? text.slice(0, stop) : text;
  if (first.length <= MAX_CONDITION_CHARS) return first;
  // Cut at a word boundary rather than mid-word: a truncated word is a token
  // the encoder has to guess at.
  const cut = first.slice(0, MAX_CONDITION_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

/** One sentence: capitalised, ending in exactly one full stop. */
function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  // A quoted line already ends in its own stop INSIDE the quote — appending a
  // second one gives `mine.".`, which is a token the encoder has to make
  // sense of for no reason.
  return /[.!?]["'\u2019\u201d)\]]?$/.test(capped) ? capped : `${capped}.`;
}

/**
 * The video prompt for one shot on ONIQ's own engine. The still is supplied
 * separately as the conditioning frame; this is everything the text encoder
 * is told.
 */
export function composeInHouseVideoPrompt(shot: MovieShot): string {
  const parts: string[] = [];

  // 1. VISUAL CONDITION — what the frame holds.
  const condition = visualCondition(shot.still);
  if (condition) parts.push(sentence(condition));

  // 2. MOTION — what moves. An unauthored shot still has to breathe, and the
  //    fallback says what kind of movement rather than just "ambient".
  const motion = String(shot.motion ?? "").trim();
  parts.push(
    sentence(motion || "Subtle continuous movement: air, light and fabric shift gently"),
  );

  // 3. CAMERA — once, explicitly, and never twice.
  if (!namesACameraMove(motion)) parts.push(sentence(DEFAULT_CAMERA));

  // 4. EXPRESSION / ACTION — and it is FILLED, not left to chance.
  //
  //    An authored cue wins; a spoken line brings its own. What is left is
  //    the common case — story-plot emits no `action` field today — and
  //    leaving the slot empty there would mean the audit's complaint (soft,
  //    drifting faces) gets no instruction against it in exactly the shots
  //    where it matters. So a shot whose own text puts a person in frame gets
  //    a default expression cue, and one that does not gets nothing.
  //
  //    THE DEFAULT NAMES NO PERSON. It says what the face should DO — hold,
  //    stay in focus, not drift — and nothing about who the face belongs to.
  //    No ethnicity, no gender, no age, no occupation, no place: those are the
  //    story's to decide and the still has already decided them.
  if (shot.dialogue && shot.dialogue.line.trim()) {
    const line = shot.dialogue.line.trim().replace(/^"|"$/g, "");
    parts.push(sentence(`The character in frame speaks: "${line}"`));
    parts.push(sentence("Natural lip movement, expression steady and readable"));
  } else if (shot.action && shot.action.trim()) {
    parts.push(sentence(shot.action));
  } else if (shotShowsAFace([shot.still, shot.narration, shot.motion])) {
    parts.push(sentence(DEFAULT_EXPRESSION));
  }

  // VFX last: it is atmosphere over the shot, not the shot.
  if (shot.vfx && shot.vfx.trim()) parts.push(sentence(shot.vfx));

  return parts.join(" ");
}

/**
 * The rules block shared by the plan and batch prompts in story-plot. One copy
 * so the single-call film and the batched film obey the same grammar.
 */
export const MOVIE_RULES = [
  FILM_CONTINUITY_RULES,
  "",
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
  "- Coverage is the continuity strategy: most shots should have nobody",
  "  LEGIBLE in them (hands, objects, wide silhouettes, a doorway). A face",
  "  should appear only where the beat needs it. Where identity IS legible —",
  "  even a distant figure whose clothing reads — repeat the cast lock in the",
  "  `still`.",
].join("\n");
