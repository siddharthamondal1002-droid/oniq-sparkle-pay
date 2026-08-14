// VERBATIM MODE — the user's words reach the narrator's mouth untouched.
//
// Owner directive, 2026-08-14: when the "My words" toggle is on, a supplied
// story is NOT retold by Ting. This module is the mechanical half of that
// promise: slice the user's text into shot-sized narration pieces, in
// order, unchanged, and estimate how long they take to speak — because
// narration is the film's clock, and the clock decides whether the story
// FITS the seconds the user bought.
//
// THE PRICING GUARD IS THE POINT of the estimate. A five-hundred-word
// story on a sixty-second purchase would render three and a half minutes
// of film for sixty seconds of money — narration-as-clock stretches shots
// to whatever the audio measures. So a verbatim story must fit a band
// around the purchase: long enough that shots are not dead air, short
// enough that the meter is honest. The band is enforced in the client
// (before the buy button) and again in the worker (before the first
// billable call).
//
// ZERO IMPORTS, like every module the story worker loads directly.

/** Speech rate for the estimate. Measured narration averages ~150 wpm. */
export const SPOKEN_WORDS_PER_SECOND = 2.5;

/**
 * The fit band, as fractions of the purchased seconds. Below the floor the
 * film is mostly silence; above the ceiling the user gets minutes they did
 * not pay for. Enforced at claim time AND at the worker's pre-flight.
 */
export const VERBATIM_MIN_FILL = 0.5;
export const VERBATIM_MAX_FILL = 1.25;

/** The TTS ceiling per call — mirrors story-voice's MAX_TEXT, by test. */
export const MAX_NARRATION_CHARS = 1200;

/**
 * The longest film verbatim mode can honestly make. The prompt is capped
 * at 2000 characters (claim RPC and textarea alike) — roughly 340 words,
 * ~136s of speech — so the 300s tier's floor (150s) is unreachable. The
 * toggle refuses past this instead of telling the user to paste a story
 * the input cannot hold. Mirrored by the claim RPC's own `wanted > 180`.
 */
export const VERBATIM_MAX_SECONDS = 180;

/** Rough seconds of speech in a text. Zero for empty. */
export function estimateSpokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words / SPOKEN_WORDS_PER_SECOND;
}

/** Does the text fit the purchase? The one question both gates ask. */
export function verbatimFits(
  text: string,
  requestedSeconds: number,
): { fits: boolean; spokenSeconds: number; reason: string | null } {
  const spokenSeconds = estimateSpokenSeconds(text);
  if (requestedSeconds <= 0) return { fits: false, spokenSeconds, reason: "no duration" };
  if (requestedSeconds > VERBATIM_MAX_SECONDS) {
    return {
      fits: false,
      spokenSeconds,
      reason: `works up to ${VERBATIM_MAX_SECONDS}s — the prompt box cannot hold a longer story`,
    };
  }
  const fill = spokenSeconds / requestedSeconds;
  if (fill < VERBATIM_MIN_FILL) {
    return {
      fits: false,
      spokenSeconds,
      reason: `reads as ~${Math.round(spokenSeconds)}s of speech — too short for a ${requestedSeconds}s film`,
    };
  }
  if (fill > VERBATIM_MAX_FILL) {
    return {
      fits: false,
      spokenSeconds,
      reason: `reads as ~${Math.round(spokenSeconds)}s of speech — longer than the ${requestedSeconds}s bought`,
    };
  }
  return { fits: true, spokenSeconds, reason: null };
}

/**
 * Sentences, kept word for word — each piece carries its original inner
 * spacing and punctuation; BETWEEN sentences the original whitespace run
 * is normalized to one space when pieces are joined, which the spoken
 * audio cannot distinguish. Splits after . ! ? … (with any
 * closing quotes/brackets attached) when followed by whitespace; a text
 * with no terminal punctuation is one sentence. A sentence longer than
 * MAX_NARRATION_CHARS is hard-split at word boundaries — the TTS ceiling
 * outranks prose aesthetics.
 */
export function sentencesOf(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const rough = t.split(/(?<=[.!?…]["'”’)\]]*)\s+/);
  const out: string[] = [];
  for (const s of rough) {
    if (s.length <= MAX_NARRATION_CHARS) {
      if (s) out.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > MAX_NARRATION_CHARS) {
      let cut = rest.lastIndexOf(" ", MAX_NARRATION_CHARS);
      if (cut <= 0) cut = MAX_NARRATION_CHARS;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * The user's text as `shotCount` narration chunks: in order, verbatim,
 * every chunk non-empty, packed so spoken lengths come out roughly even
 * (greedy by estimated seconds — the same balancing a film editor does by
 * feel). Returns null when the text cannot fill the shots (fewer sentences
 * than shots) or a chunk would breach the TTS ceiling; the callers treat
 * null as "verbatim mode cannot honestly make this film".
 */
export function packNarrations(text: string, shotCount: number): string[] | null {
  if (!Number.isInteger(shotCount) || shotCount <= 0) return null;
  const sentences = sentencesOf(text);
  if (sentences.length < shotCount) return null;

  const chunks: string[] = [];
  let cursor = 0;
  for (let shot = 0; shot < shotCount; shot++) {
    const shotsLeft = shotCount - shot;
    const sentencesLeft = sentences.length - cursor;
    // Never take so many that a later shot goes empty, always take at
    // least one, and stop the current chunk once it reaches its fair
    // share of the REMAINING speech.
    const maxTake = sentencesLeft - (shotsLeft - 1);
    const remainingSeconds = estimateSpokenSeconds(sentences.slice(cursor).join(" "));
    const target = remainingSeconds / shotsLeft;
    let take = 1;
    let taken = estimateSpokenSeconds(sentences[cursor]);
    while (take < maxTake) {
      const next = estimateSpokenSeconds(sentences[cursor + take]);
      if (taken + next / 2 > target) break;
      taken += next;
      take += 1;
    }
    const chunk = sentences.slice(cursor, cursor + take).join(" ");
    if (chunk.length > MAX_NARRATION_CHARS) return null;
    chunks.push(chunk);
    cursor += take;
  }
  return chunks;
}
