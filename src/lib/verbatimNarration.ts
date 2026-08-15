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
 * The prompt box's ceiling, in characters.
 *
 * OWNER DIRECTIVE, 2026-08-14: raised 2000 -> 5000. The old cap was set
 * before verbatim mode existed, when a prompt was a one-line brief rather
 * than the film's actual script. At 2000 it silently beheaded pasted
 * stories — three of the owner's own jobs stored exactly 2000 characters —
 * and it put the 300s tier permanently out of reach. The owner accepted the
 * added token spend on Ting's plot call and the content gate to fix both.
 *
 * THE ONE TS SOURCE OF TRUTH. The textarea, the counter, the was-it-cut
 * warning, story-plot's own guard and the claim RPC all quote this number;
 * mirrored to SQL and to the edge function by test, because five literals
 * drift and a cap that disagrees with itself refuses work the user already
 * paid the UI for.
 */
export const MAX_PROMPT_CHARS = 5000;

/**
 * The longest film verbatim mode can honestly make.
 *
 * It is the prompt cap that decides this, not taste: a tier is reachable
 * only if its FLOOR (half the purchased seconds) can be spoken by a story
 * the input box can physically hold. At 5000 characters — about 833 words
 * at ~6 characters a word, ~333s of speech at 2.5 wps — the deepest tier
 * that clears its own floor is 666s, past the 600s platform maximum. So
 * nothing on sale is unreachable any more, and this constant is now the
 * platform ceiling rather than a real restriction.
 *
 * It is kept rather than deleted because the fit band still needs an upper
 * bound to reason against, and because a tier that IS out of reach must
 * still say so rather than take the money. Mirrored by the claim RPC's own
 * `wanted > 600`.
 */
export const VERBATIM_MAX_SECONDS = 600;

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
 * The shortest piece the word-boundary fallback will cut.
 *
 * Clause splitting is always preferred; this floor only governs the last
 * resort. Below it a "shot" would be two or three words, which is not a
 * narration, and atomising a short sentence to satisfy an arithmetic quota is
 * exactly the dishonesty the fit band exists to prevent. A piece this short
 * is left whole and some other piece is split instead.
 */
const MIN_SPLIT_WORDS = 8;

/**
 * One piece into two, at the most natural break available.
 *
 * Clause marks first — a comma, semicolon, colon or dash is where a narrator
 * would draw breath anyway, so the cut is inaudible. Failing that, the word
 * boundary nearest the middle: a shot may carry a fragment, because the audio
 * runs continuously across the cut and the listener hears the sentence whole.
 * Returns null when the piece is too short to divide honestly.
 *
 * EVERY WORD SURVIVES, IN ORDER. Only the shot boundary moves — the left half
 * keeps its punctuation, the right half starts at the next word, and joining
 * the two with a single space reproduces the original.
 */
function splitPiece(piece: string): [string, string] | null {
  const mid = piece.length / 2;
  let best = -1;
  let bestDist = Infinity;
  const re = /[,;:—–]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(piece)) !== null) {
    const cut = m.index + m[0].length;
    const d = Math.abs(cut - mid);
    if (d < bestDist) {
      bestDist = d;
      best = cut;
    }
  }
  if (best > 0 && best < piece.length) {
    const left = piece.slice(0, best).trimEnd();
    const right = piece.slice(best).trimStart();
    if (left && right) return [left, right];
  }
  const words = piece.split(/\s+/).filter(Boolean);
  if (words.length < MIN_SPLIT_WORDS) return null;
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/**
 * Divide pieces until there are at least `n` of them.
 *
 * WHY THIS EXISTS. The packer used to refuse outright when a story had fewer
 * sentences than the film had shots, and that rejected stories which fit the
 * purchased seconds perfectly: measured 2026-08-15, a 600-word story of 40
 * sentences reads as 240s of speech — comfortably inside the 300s band — and
 * was refused because that tier plans 43 shots. Needing 43 is an artifact of
 * the shot count, not a fact about the story. The longest piece is split
 * first, which both evens out the shot lengths and picks the piece most
 * likely to contain a clause mark.
 */
function divideToAtLeast(pieces: string[], n: number): string[] {
  const out = pieces.slice();
  while (out.length < n) {
    const byLongest = out.map((_, i) => i).sort((a, b) => out[b].length - out[a].length);
    let split = false;
    for (const i of byLongest) {
      const parts = splitPiece(out[i]);
      if (parts) {
        out.splice(i, 1, parts[0], parts[1]);
        split = true;
        break;
      }
    }
    // Nothing left that can be divided honestly — the caller refuses.
    if (!split) return out;
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
  let sentences = sentencesOf(text);
  if (sentences.length === 0) return null;
  // Fewer sentences than shots is not a reason to refuse a story that fits
  // the seconds bought — it is a reason to cut some sentences in two.
  if (sentences.length < shotCount) sentences = divideToAtLeast(sentences, shotCount);
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
