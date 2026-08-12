/**
 * Narration into mouth shapes — the piece that makes a character SPEAK.
 *
 * ONIQ's Stories now render motion in-house on CPU rather than through a video
 * model, so nothing generates a talking mouth for us any more. This derives one
 * from two things we already have for every scene: the script text, and a
 * measurement of where the voice actually is in the audio.
 *
 * WHAT THIS IS NOT. It is not forced alignment. A real aligner (Montreal, or a
 * whisper-class model) matches each phoneme to its acoustic evidence and knows
 * that "read" was said as /rɛd/. This does something much cheaper: it maps
 * letters to mouth shapes, weights them by how long that shape is typically
 * held, and distributes them across the speech runs the envelope measured.
 *
 * That choice is deliberate and worth defending, because the honest version is
 * available and I am not using it:
 *
 *   - A whisper-class aligner means torch in the render path. For an EPISODE,
 *     rendered once out of band, that would be fine. For a Story, rendered per
 *     user on demand, a multi-second model load per job is the whole latency
 *     budget spent before a single frame exists.
 *   - Rhubarb Lip Sync is the right tool and ships as a GitHub release binary,
 *     which this environment's proxy refuses (403). Not a preference — a wall.
 *   - The error this makes is drift WITHIN a speech run, bounded by the run's
 *     own length, because every run is re-anchored to measured audio. It cannot
 *     accumulate across a scene. At 30fps with eight distinct shapes, a shape
 *     landing a frame or two early reads as fine; a mouth that does not move at
 *     all reads as broken. This trades an error nobody sees for one everybody
 *     sees.
 *
 * WHERE IT IS WRONG, plainly, so nobody mistakes it for alignment:
 *   - Silent letters. Handled for trailing 'e' only; "though" still spends
 *     shapes on 'g' and 'h'.
 *   - Heteronyms. "lead" and "lead" get identical mouths.
 *   - Stress and rhythm. Weights are per-shape averages, not per-utterance, so
 *     an emphasised word gets no extra room.
 *   - Numerals and symbols. "1994" is not spoken as four characters, and this
 *     does not expand it. Write narration in words.
 *
 * PURE. No audio decoding, no clock, no filesystem. The measurement that
 * produces `segments` lives in `remotion/scripts/measure-speech.mjs` and runs
 * out of band, exactly like the pause table and the scene durations — the
 * browser bundle cannot open an mp3, and a value derived from audio has to be
 * reviewable by a person and identical on every machine.
 *
 * Feed it `segmentsFromSpans(EP3_SPEECH[scene], frames)`. NOT
 * `segmentsFromPauses` — that reuses the cut-placement table and measurably
 * never lets the mouth rest; see the note on that function.
 */
// RELATIVE, not the "@/" alias, and it has to stay that way.
//
// The Remotion bundle imports this module across the project boundary the same
// way it already imports shotAllocation.ts and ep3Shots.ts — by relative path,
// with `webpackOverride: (c) => c`. Nothing teaches that webpack config about
// "@/", so an aliased import here fails to resolve at BUNDLE time, which
// surfaces as a module-not-found before a single frame renders rather than as
// anything to do with mouths. Every app module the composition reaches has to
// obey this; it is why the two it already reaches have no aliased imports.
import { allocateFrames } from "./shotAllocation";

/**
 * The Preston Blair mouth set, as Rhubarb names it.
 *
 * Deliberately this vocabulary and not one of my own invention: it is what 2D
 * animators have drawn against for decades, so an artist handed "we need A
 * through H plus X" knows exactly what to deliver, and any existing mouth sheet
 * already matches.
 */
export type Viseme =
  /** Closed. m, b, p. */
  | "A"
  /** Slightly open, teeth together. Most consonants. */
  | "B"
  /** Open. e, i. */
  | "C"
  /** Wide open. a. */
  | "D"
  /** Rounded. o. */
  | "E"
  /** Puckered. u, w. */
  | "F"
  /** Teeth on lip. f, v. */
  | "G"
  /** Tongue up. l. */
  | "H"
  /** Rest. Silence. */
  | "X";

export const REST: Viseme = "X";

/**
 * How long each shape is held, relative to the others.
 *
 * Vowels carry the duration of speech and consonants are transitions through
 * it — a plosive is over in a frame while a held vowel can run a quarter of a
 * second. Uniform weights make the mouth chatter evenly like a typewriter,
 * which is the single most recognisable way bad lip sync looks bad.
 *
 * These are ratios, not milliseconds. The absolute duration comes from the
 * measured audio; only the proportions are set here.
 */
export const VISEME_WEIGHT: Readonly<Record<Viseme, number>> = {
  A: 1, // closed, brief
  B: 1,
  C: 2, // vowels held
  D: 2.5,
  E: 2,
  F: 2,
  G: 1.2,
  H: 1.2,
  X: 1,
};

/**
 * Letters and digraphs to mouth shapes.
 *
 * Digraphs are checked first and MUST be, or "sh" is scanned as s-then-h and
 * spends two shapes on one sound. Order within this table does not matter; the
 * scanner tries length 2 before length 1.
 */
const DIGRAPH: Readonly<Record<string, Viseme>> = {
  sh: "B",
  ch: "B",
  th: "B",
  ph: "G",
  wh: "F",
  qu: "F",
  oo: "F",
  ou: "F",
  ow: "F",
  ee: "C",
  ea: "C",
  ie: "C",
  ai: "C",
  ay: "C",
  oa: "E",
  oi: "E",
  oy: "E",
  au: "D",
  aw: "D",
};

const LETTER: Readonly<Record<string, Viseme>> = {
  a: "D",
  e: "C",
  i: "C",
  o: "E",
  u: "F",
  y: "C",
  w: "F",
  m: "A",
  b: "A",
  p: "A",
  f: "G",
  v: "G",
  l: "H",
  // Everything else is a generic consonant.
  c: "B",
  d: "B",
  g: "B",
  h: "B",
  j: "B",
  k: "B",
  n: "B",
  q: "B",
  r: "B",
  s: "B",
  t: "B",
  x: "B",
  z: "B",
};

/**
 * One word into the shapes a mouth makes saying it.
 *
 * Returns an empty array for anything with no letters in it, so punctuation and
 * stray symbols cost no time rather than producing a spurious shape.
 */
export function wordToVisemes(word: string): Viseme[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return [];

  // Trailing silent 'e'. English is full of it and spending a held C on the end
  // of "make" leaves the mouth hanging open into the next word.
  //
  // The magic-e pattern needs a vowel EARLIER in the word — that is what makes
  // the final e silent. "the" fails it (its only vowel is the e itself) and
  // "see" fails it too (the stem already ends in a vowel, so the pair is one
  // held sound). Getting this wrong in the obvious direction shuts the mouth on
  // the commonest word in English.
  const stem = w.slice(0, -1);
  const silentE =
    w.length >= 3 && w.endsWith("e") && /[aeiou]/.test(stem) && !/[aeiou]$/.test(stem);
  const letters = silentE ? stem : w;

  const out: Viseme[] = [];
  for (let i = 0; i < letters.length;) {
    const two = letters.slice(i, i + 2);
    const asDigraph = two.length === 2 ? DIGRAPH[two] : undefined;
    if (asDigraph) {
      out.push(asDigraph);
      i += 2;
      continue;
    }
    // A doubled consonant is one sound: "letter" is not l-e-t-t-e-r.
    if (letters[i] === letters[i + 1]) {
      out.push(LETTER[letters[i]] ?? "B");
      i += 2;
      continue;
    }
    out.push(LETTER[letters[i]] ?? "B");
    i += 1;
  }

  // Never let one word collapse to nothing once it had letters.
  return out.length > 0 ? out : ["B"];
}

/** A run of actual speech, in frames, measured from the audio. */
export type SpeechSegment = {
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
};

/** One mouth shape, held from `startFrame` for `frames`. */
export type MouthCue = {
  startFrame: number;
  frames: number;
  viseme: Viseme;
};

export type VisemeOptions = {
  /**
   * Fewest frames a shape may be held.
   *
   * Below about two frames at 30fps a mouth shape reads as a flicker rather
   * than a sound, and a row of them looks like a rendering fault. When a
   * segment cannot fit every shape at this length, shapes are DROPPED rather
   * than shortened — losing a consonant is invisible, strobing is not.
   */
  minHoldFrames?: number;
};

const DEFAULT_MIN_HOLD = 2;

/** Keep `capacity` shapes, evenly spaced, always including the first and last. */
function thin(visemes: Viseme[], capacity: number): Viseme[] {
  if (visemes.length <= capacity) return visemes;
  if (capacity === 1) return [visemes[0]];
  const kept: Viseme[] = [];
  for (let k = 0; k < capacity; k++) {
    kept.push(visemes[Math.round((k * (visemes.length - 1)) / (capacity - 1))]);
  }
  return kept;
}

/**
 * Fit a sequence of shapes into a span, and say how long each is held.
 *
 * Thins from the middle outward when the span is too short to hold them all.
 * The first and last shapes of a run are the ones a viewer connects to the
 * start and end of the sound, so they survive longest — dropping from the front
 * would make the mouth open late, which is the most visible failure there is.
 *
 * COUNTING SHAPES IS NOT ENOUGH, and this is the subtle part. `span / minHold`
 * says how many shapes fit at the floor, but the frames are then handed out by
 * WEIGHT, and a held vowel takes two and a half times what a closed mouth does.
 * So a set that fits on average can still starve its lightest shape down to a
 * single frame — which is the flicker the floor exists to prevent. The count is
 * therefore an upper bound to start from, not an answer: shapes come out until
 * the actual allocation clears the floor.
 *
 * Terminates: at a capacity of one the single shape takes the whole span, and
 * the span is at least `minHold` or we would not have got here.
 */
function fitAndHold(
  visemes: Viseme[],
  span: number,
  minHold: number,
): { fitted: Viseme[]; held: number[] } {
  const start = Math.min(visemes.length, Math.floor(span / minHold));
  for (let capacity = start; capacity >= 1; capacity--) {
    const fitted = thin(visemes, capacity);
    const held = allocateFrames(
      fitted.map((v) => VISEME_WEIGHT[v]),
      span,
    );
    if (held.every((f) => f >= minHold)) return { fitted, held };
  }
  return { fitted: [], held: [] };
}

/** Merge neighbouring cues that hold the same shape — one sound, one cue. */
function coalesce(cues: MouthCue[]): MouthCue[] {
  const out: MouthCue[] = [];
  for (const cue of cues) {
    const prev = out[out.length - 1];
    if (prev && prev.viseme === cue.viseme && prev.startFrame + prev.frames === cue.startFrame) {
      prev.frames += cue.frames;
      continue;
    }
    out.push({ ...cue });
  }
  return out;
}

/**
 * Build a mouth-cue track for one scene.
 *
 * `totalFrames` is the scene's length, and the returned track covers ALL of it
 * with no gaps: every frame between the measured speech runs holds the rest
 * shape. A composition can therefore look up any frame and always get an answer,
 * which is what keeps the Remotion component free of null checks.
 *
 * The text is distributed across the segments by weight — a segment holding
 * twice the frames gets roughly twice the words. This is the approximation the
 * header describes: it assumes the narration was read in the order it is
 * written, which is true because we generated the audio FROM this text.
 */
export function buildMouthCues(
  text: string,
  segments: readonly SpeechSegment[],
  totalFrames: number,
  options: VisemeOptions = {},
): MouthCue[] {
  if (!Number.isInteger(totalFrames) || totalFrames < 0) {
    throw new Error(`buildMouthCues: totalFrames ${totalFrames} is not a frame count`);
  }
  const minHold = options.minHoldFrames ?? DEFAULT_MIN_HOLD;
  if (!Number.isInteger(minHold) || minHold < 1) {
    throw new Error(`buildMouthCues: minHoldFrames ${minHold} must be a positive integer`);
  }

  let last = 0;
  for (const s of segments) {
    if (!Number.isInteger(s.startFrame) || !Number.isInteger(s.endFrame)) {
      throw new Error(`buildMouthCues: segment ${s.startFrame}-${s.endFrame} is not whole frames`);
    }
    if (s.endFrame <= s.startFrame) {
      throw new Error(`buildMouthCues: segment ${s.startFrame}-${s.endFrame} is empty or reversed`);
    }
    if (s.startFrame < last) {
      throw new Error(`buildMouthCues: segment at ${s.startFrame} overlaps the one before it`);
    }
    if (s.endFrame > totalFrames) {
      throw new Error(`buildMouthCues: segment ends at ${s.endFrame}, past ${totalFrames}`);
    }
    last = s.endFrame;
  }

  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  const perWord = words.map(wordToVisemes).filter((v) => v.length > 0);
  const speechFrames = segments.reduce((a, s) => a + (s.endFrame - s.startFrame), 0);

  // Nothing to say, or nowhere to say it: the whole scene rests. A silent
  // scene is a real case — an establishing shot has no narration — and it must
  // produce a still mouth rather than an empty track the caller has to handle.
  if (perWord.length === 0 || speechFrames === 0) {
    return totalFrames > 0 ? [{ startFrame: 0, frames: totalFrames, viseme: REST }] : [];
  }

  // Split the words between segments in proportion to each segment's frames.
  // allocateFrames sums exactly, so no word is lost or duplicated at a boundary.
  const wordsPerSegment = allocateFrames(
    segments.map((s) => s.endFrame - s.startFrame),
    perWord.length,
  );

  const cues: MouthCue[] = [];
  let cursor = 0; // frame reached so far
  let wordAt = 0;

  for (const [i, segment] of segments.entries()) {
    if (segment.startFrame > cursor) {
      cues.push({ startFrame: cursor, frames: segment.startFrame - cursor, viseme: REST });
    }
    const span = segment.endFrame - segment.startFrame;
    const take = wordsPerSegment[i];
    const visemes = perWord.slice(wordAt, wordAt + take).flat();
    wordAt += take;

    const { fitted, held } = fitAndHold(visemes, span, minHold);
    if (fitted.length === 0) {
      // A speech run too short to hold even one shape. Rest through it rather
      // than emit a one-frame flicker.
      cues.push({ startFrame: segment.startFrame, frames: span, viseme: REST });
      cursor = segment.endFrame;
      continue;
    }

    let at = segment.startFrame;
    for (const [k, viseme] of fitted.entries()) {
      cues.push({ startFrame: at, frames: held[k], viseme });
      at += held[k];
    }
    cursor = segment.endFrame;
  }

  if (cursor < totalFrames) {
    cues.push({ startFrame: cursor, frames: totalFrames - cursor, viseme: REST });
  }

  // No filter for empty cues here on purpose. `fitAndHold` will not return an
  // allocation below the floor and both rest branches are guarded, so a
  // zero-frame cue is unreachable — a filter would be dead code that quietly
  // absorbed the regression it looks like it is guarding against. The coverage
  // check below is the reachable invariant, and it is the one that matters: a
  // track that does not span the scene leaves frames with no mouth on them.
  const track = coalesce(cues);
  const covered = track.reduce((a, c) => a + c.frames, 0);
  if (covered !== totalFrames) {
    throw new Error(`buildMouthCues: track covers ${covered} frames, expected ${totalFrames}`);
  }
  return track;
}

/**
 * The shape to draw on a given frame.
 *
 * Linear scan rather than a binary search: a scene holds a few hundred cues and
 * this is called once per frame by a renderer that is about to composite a PNG,
 * so the lookup is not where the time goes. Written for obviousness instead.
 */
export function visemeAtFrame(cues: readonly MouthCue[], frame: number): Viseme {
  for (const cue of cues) {
    if (frame >= cue.startFrame && frame < cue.startFrame + cue.frames) return cue.viseme;
  }
  return REST;
}

/**
 * Measured speech spans into segments, clamped to the scene.
 *
 * THE CORRECT INPUT. `remotion/scripts/measure-speech.mjs` emits
 * `[startFrame, endFrame)` pairs per scene; this converts them and drops or
 * trims anything past the end of the scene.
 *
 * The clamp is not defensive dressing. A scene's frame count comes from the
 * manifest, which rounds `seconds * fps`, while the spans come from walking the
 * decoded audio — so the last span can legitimately end a frame or two past the
 * scene. Every caller would otherwise have to know that and write the same
 * `Math.min`, and the one who forgets gets a validation throw at render time.
 */
export function segmentsFromSpans(
  spans: readonly (readonly [number, number])[],
  totalFrames: number,
): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  for (const [start, end] of spans) {
    const startFrame = Math.max(0, start);
    const endFrame = Math.min(end, totalFrames);
    if (endFrame > startFrame) out.push({ startFrame, endFrame });
  }
  return out;
}

/**
 * Speech runs from pause CENTRES. A fallback, and a poor one — measured.
 *
 * `measure-ep3-pauses.mjs` emits the midpoint of each silence, because a cut
 * wants to land there. It seemed reasonable to reuse that for the mouth: the
 * runs between consecutive centres look like the speech.
 *
 * They are not. A centre is a point with no width, so the runs it produces tile
 * the scene end to end and there is no silence left anywhere. Run against all
 * sixteen Episode 3 scenes this produced a mouth that rested for 0% of the
 * episode — moving continuously for seven minutes, through every pause, with
 * single shapes stretched to 18 frames to fill the gaps, at 6.75 shapes per
 * second (below the ~8-14 a speaking mouth makes). The same scenes driven by
 * measured spans rest for 24-44% and land at 9.03.
 *
 * So: use `segmentsFromSpans` with a real measurement. This is kept only for
 * audio where a pause table exists and a speech table does not, and it will
 * make the character look like they never stop talking. Because they will not.
 */
export function segmentsFromPauses(
  pauseFrames: readonly number[],
  totalFrames: number,
): SpeechSegment[] {
  const bounds = [0, ...pauseFrames.filter((f) => f > 0 && f < totalFrames), totalFrames];
  const segments: SpeechSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] > bounds[i]) {
      segments.push({ startFrame: bounds[i], endFrame: bounds[i + 1] });
    }
  }
  return segments;
}

/** One cue as Rhubarb Lip Sync emits it: seconds, and a shape name. */
export type RhubarbCue = {
  start: number;
  end: number;
  value: string;
};

const VISEME_SET: ReadonlySet<string> = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "X"]);

/**
 * A Rhubarb cue list into a full mouth track, in frames.
 *
 * THE MEASURED PATH. `buildMouthCues` above GUESSES: it spells the caption
 * into shapes and spreads them over the speech spans, which reads as talking
 * but matches no particular sound. Rhubarb listens to the actual audio with a
 * phone recognizer and says which shape the mouth makes when — and it speaks
 * this file's exact vocabulary, because the Preston Blair set here IS
 * Rhubarb's alphabet. So the conversion is arithmetic, not translation:
 * seconds to frames, gaps filled with rest, flickers absorbed.
 *
 * The output honours the same invariants as `buildMouthCues`: full coverage
 * of `[0, totalFrames)`, no overlaps, nothing shorter than the minimum hold —
 * a shape held under ~2 frames reads as a rendering fault, so a too-short cue
 * is absorbed into its neighbour rather than shown. An empty or garbage cue
 * list degrades to a resting mouth, never a throw: by the time this runs the
 * audio is already paid for, and a film with a resting mouth beats no film.
 */
export function cuesFromRhubarb(
  rhubarb: readonly RhubarbCue[],
  fps: number,
  totalFrames: number,
  opts: VisemeOptions = {},
): MouthCue[] {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error(`cuesFromRhubarb: totalFrames ${totalFrames} is not a frame count`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`cuesFromRhubarb: fps ${fps} is not a rate`);
  }
  const minHold = opts.minHoldFrames ?? DEFAULT_MIN_HOLD;

  // Seconds to clamped, ordered, non-overlapping frame windows. Rhubarb's
  // cues already abut, but the rounding to frames can re-introduce overlap
  // at boundaries; the later cue yields, matching how ears resolve it.
  type Win = { startFrame: number; endFrame: number; viseme: Viseme };
  const wins: Win[] = [];
  for (const cue of rhubarb) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) continue;
    const viseme = (VISEME_SET.has(cue.value) ? cue.value : "B") as Viseme;
    let startFrame = Math.max(0, Math.round(cue.start * fps));
    const endFrame = Math.min(totalFrames, Math.round(cue.end * fps));
    const prev = wins[wins.length - 1];
    if (prev && startFrame < prev.endFrame) startFrame = prev.endFrame;
    if (endFrame > startFrame) wins.push({ startFrame, endFrame, viseme });
  }

  // Full coverage: rest wherever Rhubarb said nothing.
  const track: MouthCue[] = [];
  let at = 0;
  for (const w of wins) {
    if (w.startFrame > at) track.push({ startFrame: at, frames: w.startFrame - at, viseme: REST });
    track.push({ startFrame: w.startFrame, frames: w.endFrame - w.startFrame, viseme: w.viseme });
    at = w.endFrame;
  }
  if (at < totalFrames) track.push({ startFrame: at, frames: totalFrames - at, viseme: REST });

  // Flickers are absorbed into the cue before them (the first into the one
  // after), then identical neighbours merge. Absorbing can itself create a
  // new too-short head cue, so run to a fixed point; each pass shrinks the
  // track, so this terminates.
  let changed = true;
  while (changed && track.length > 1) {
    changed = false;
    for (let i = 0; i < track.length; i++) {
      if (track[i].frames >= minHold) continue;
      if (i > 0) {
        track[i - 1].frames += track[i].frames;
      } else {
        track[1].startFrame = track[0].startFrame;
        track[1].frames += track[0].frames;
      }
      track.splice(i, 1);
      changed = true;
      break;
    }
  }
  const merged: MouthCue[] = [];
  for (const cue of track) {
    const prev = merged[merged.length - 1];
    if (prev && prev.viseme === cue.viseme) prev.frames += cue.frames;
    else merged.push({ ...cue });
  }

  const covered = merged.reduce((sum, c) => sum + c.frames, 0);
  if (covered !== totalFrames) {
    throw new Error(`cuesFromRhubarb: track covers ${covered} frames, expected ${totalFrames}`);
  }
  return merged;
}
