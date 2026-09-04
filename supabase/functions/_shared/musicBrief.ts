/**
 * A REFERENCE SONG, TURNED INTO A DESCRIPTION — never into a copy.
 *
 * OWNER DIRECTIVE, 2026-09-04c, and it is a better architecture than the one
 * it replaces:
 *
 *   reference audio -> Gemini audio understanding -> structured music brief
 *                   -> Lyria
 *
 * THE REFERENCE NEVER REACHES LYRIA. That is the load-bearing part. Sending
 * audio to Lyria directly is measured closed (400 "Unsupported input mime
 * type for this model: audio/s16le", identical for wav and mp3, on every
 * lyria id, with a text-only control returning 200) — but the point is not
 * the workaround. Deriving a brief and generating fresh from it is what a
 * person actually wants when they say "something like this", and it keeps
 * ONIQ generating original music rather than transforming a recording it does
 * not own.
 *
 * WHICH IS ALSO THE RIGHTS ANSWER. The brief describes CHARACTERISTICS —
 * genre, tempo, instrumentation, mood, arrangement, production — and the
 * prompt below explicitly forbids reproducing melody or lyrics. A pipeline
 * that copied the tune would put ONIQ in the business of laundering somebody
 * else's song, which is not a feature and would not survive contact with a
 * rights holder.
 *
 * This module is PURE: the shape, the ask, and the compilation to a Lyria
 * prompt. No network, so it can be unit-tested exhaustively.
 */

/**
 * What Gemini is asked to return. Every field optional on purpose — a model
 * asked for JSON will occasionally omit one, and a brief missing its `vocals`
 * is still a usable brief. Nothing here is trusted to exist.
 */
export type MusicBrief = {
  genre?: string;
  /** Free text: "118 BPM", "around 90", "slow". Not parsed into a number. */
  tempo?: string;
  mood?: string[];
  instruments?: string[];
  arrangement?: string;
  vocals?: string;
  production?: string;
};

/** The keys, in the order the compiled prompt reads them. */
export const BRIEF_KEYS = [
  "genre",
  "tempo",
  "mood",
  "instruments",
  "arrangement",
  "vocals",
  "production",
] as const;

/**
 * The instruction sent with the reference audio.
 *
 * BUILT HERE, NEVER FROM THE CLIENT. A caller who could supply their own
 * instruction alongside an audio file would have an open prompt surface on a
 * paid model, and the no-copying rule below would be theirs to delete.
 *
 * The refusal is stated twice — once as a rule, once as what to do instead —
 * because a single negative instruction is the kind a model drops when the
 * rest of the ask is long.
 */
export const BRIEF_ASK = [
  "Listen to this audio and describe its MUSICAL CHARACTERISTICS so that a",
  "new, original piece can be written in a similar style.",
  "",
  "Do NOT transcribe or reproduce the melody, the lyrics, or any distinctive",
  "hook. Do not name the song or the artist. Describe the STYLE only — the",
  "qualities another musician would need in order to write something new that",
  "feels related.",
  "",
  "Reply with JSON only, no prose around it, using exactly these keys:",
  '{"genre": string, "tempo": string, "mood": string[], "instruments": string[],',
  ' "arrangement": string, "vocals": string, "production": string}',
].join("\n");

/** Trim, drop empties, cap the length — for one string field. */
function str(v: unknown, max = 200): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : undefined;
}

/** The same, for a list. Bounded in BOTH directions: item length and count. */
function list(v: unknown, maxItems = 8): string[] | undefined {
  if (!Array.isArray(v)) {
    // A model asked for an array sometimes sends "piano, synth, drums".
    // Splitting it is kinder than dropping the whole field.
    const one = str(v);
    return one
      ? one
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, maxItems)
      : undefined;
  }
  const out = v
    .map((x) => str(x, 60))
    .filter((x): x is string => Boolean(x))
    .slice(0, maxItems);
  return out.length > 0 ? out : undefined;
}

/**
 * A model's reply, turned into a brief — or null when there is nothing usable.
 *
 * TOLERANT BY DESIGN, because the reply is a language model's and will not
 * always be clean JSON. It survives a ```json fence, prose before the object,
 * a single object inside an array, and a field that came back as a string
 * where a list was asked for. What it will NOT do is invent a field that is
 * absent: a brief with two keys generates a shorter prompt, which is correct,
 * where a padded one would put words in the model's mouth.
 */
export function parseMusicBrief(raw: string): MusicBrief | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  // Strip a fence, then take the outermost {...} — prose either side is
  // common and is not an error worth failing the whole generation over.
  const fenced = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
  if (Array.isArray(obj)) obj = obj[0];
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const brief: MusicBrief = {
    genre: str(o.genre, 80),
    tempo: str(o.tempo, 40),
    mood: list(o.mood),
    instruments: list(o.instruments),
    arrangement: str(o.arrangement),
    vocals: str(o.vocals),
    production: str(o.production),
  };
  // A brief with nothing in it is not a brief. Returning it would produce a
  // prompt that says only "Create an original piece", which is what the
  // person would have got by attaching nothing at all — and they would be
  // told it worked.
  return BRIEF_KEYS.some((k) => brief[k] !== undefined) ? brief : null;
}

/**
 * The brief, compiled into the sentence Lyria is given.
 *
 * ONE SENTENCE PLUS CLAUSES, not a JSON dump: Lyria takes a text prompt, and
 * a serialized object in that slot reads as noise rather than as a
 * description. `extra` is the person's own words, which lead — what they
 * typed is the brief, and the reference is the adjective.
 */
export function compileMusicPrompt(brief: MusicBrief, extra?: string): string {
  const parts: string[] = [];
  const own = str(extra, 400);
  parts.push(own ? `Create an original piece: ${own}.` : "Create an original piece of music.");
  if (brief.genre) parts.push(`Style: ${brief.genre}.`);
  if (brief.tempo) parts.push(`Tempo: ${brief.tempo}.`);
  if (brief.mood?.length) parts.push(`Mood: ${brief.mood.join(", ")}.`);
  if (brief.instruments?.length) parts.push(`Instrumentation: ${brief.instruments.join(", ")}.`);
  if (brief.arrangement) parts.push(`Arrangement: ${brief.arrangement}.`);
  if (brief.vocals) parts.push(`Vocals: ${brief.vocals}.`);
  if (brief.production) parts.push(`Production: ${brief.production}.`);
  // Said to LYRIA as well, not only to the analysing model. The brief has
  // been through a language model by this point and could carry a phrase
  // closer to the original than intended.
  parts.push("Write something new — do not reproduce any existing melody or lyrics.");
  return parts.join(" ");
}

/**
 * A one-line summary for the person, so the screen can say what it heard.
 *
 * The UI has to make clear that the reference was used to DERIVE
 * characteristics for a new original piece, not to transform the recording —
 * the owner asked for that explicitly, and showing the brief back is the
 * plainest way to demonstrate it.
 */
export function describeBrief(brief: MusicBrief): string {
  const bits = [brief.genre, brief.tempo, brief.mood?.join("/"), brief.instruments?.join(", ")];
  return bits.filter(Boolean).join(" · ");
}
