/**
 * AI DIRECTOR — deterministic shot-variation pass (owner brick, 2026-08-22).
 *
 * Both 300s/43-shot proof runs (b20e5ce1, 5871421e) rendered visually
 * monotone films: the plan locks the film-wide setting into every still (a
 * deliberate consistency rule), so every generated frame shared the same
 * atmosphere words and near-identical framing — vfx:rain on ~40/43 shots in
 * one run, vfx:snow with air:surf on 43/43 in the other. The plan prompt
 * ASKS the model to vary shot sizes; nothing enforces it.
 *
 * This module is the enforcement: one pure pass over the whole plan, in the
 * same architectural slot as the eyeline pass (a per-shot rule cannot see
 * the sequence). It decorates each still with a shot SIZE (only when the
 * plan's own still does not already lead with one) and a LIGHTING note
 * drawn from a bounded palette, on a seeded cadence that never repeats a
 * lighting on adjacent shots.
 *
 * WHAT IT MUST NEVER DO: change a shot's weather. The one-authoritative-
 * weather rule (owner, 2026-08-21) derives both the image prompt and the
 * particle overlay from the shot's own text, so every phrase this module
 * may append is chosen to be INVISIBLE to vfxKindFor — no lantern, candle,
 * torch, moonlit, starlit, sunbeam, haze, mist or smoke, however natural
 * those would read as lighting. The regression test pins every palette
 * entry to vfxKindFor === null and proves decoration preserves the
 * classification of wet, snowy and fiery stills verbatim.
 *
 * SELF-CONTAINED ON PURPOSE — no imports, for the same Node type-stripping
 * reason as particleField.ts: the story worker imports this file directly.
 * Everything is a pure function of (stills, seed); same inputs, same film.
 */

/** Sizes the director may assign. Adjacent entries differ on purpose. */
export const SHOT_SIZES: readonly string[] = [
  "wide",
  "medium",
  "close-up",
  "medium close-up",
  "detail",
];

/**
 * Lighting notes the director may append. Every entry MUST be invisible to
 * BOTH scene classifiers (pinned by test): vfxKindFor === null (lighting
 * varies the image, never the weather) AND ambienceFor === null (never the
 * audio bed). The second constraint is defence in depth — today the worker
 * feeds ambienceFor the UNDECORATED still (also pinned), but "twilight" or
 * "dusk", however natural as lighting, would turn into night crickets the
 * day someone reroutes that call. Amber/golden wording likewise stays clear
 * of ember vocabulary.
 */
export const LIGHTING_PALETTE: readonly string[] = [
  "soft golden side-light",
  "cool overcast light",
  "warm window light",
  "backlit with a gentle rim light",
  "gentle dawn glow",
  "low amber late-afternoon light",
  "silver-blue evening light",
  "bright midday clarity",
];

/**
 * A still that already opens with a size keeps it — the plan prompt asks
 * the model to lead with one, and when it obeyed, the director defers.
 * Checked against the first few words only; "a wide bazaar" later in a
 * sentence is scenery, not grammar.
 */
const LEADING_SIZE =
  /^\W*(?:an?\s+|the\s+)?(?:extreme\s+|medium\s+)?(?:establishing|wide|close[- ]?up|close|detail|two[- ]shot|over[- ]the[- ]shoulder)\b/i;

export function hasLeadingSize(still: string): boolean {
  return LEADING_SIZE.test((still ?? "").slice(0, 48));
}

/** FNV-1a, the same stable non-crypto hash particleField uses for seeds. */
function fnv1a(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One uniform draw in [0,1) from a (seed, lane) pair. Stateless. */
function draw(seed: number, lane: number): number {
  let h = (seed ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/**
 * The sizes at which a face is legible on this canvas.
 *
 * MEASURED, not stylistic. The generation canvas is 704x1248. In a "wide"
 * shot a standing figure occupies perhaps a fifth of the frame height, so the
 * head is around 40px tall and the face maybe 25px — below what the VAE
 * resolves as features at all, which is why the audit's complaint is
 * "characters' faces are not reliably visible" rather than "faces look bad".
 * At medium and closer the face is hundreds of pixels and the model has
 * something to work with.
 *
 * Order matters: these are walked in the same round-robin the full palette is,
 * so a film whose beats are all face beats still cuts between three different
 * framings rather than becoming five identical close-ups.
 */
export const FACE_LEGIBLE_SIZES: readonly string[] = [
  "medium",
  "medium close-up",
  "close-up",
];

/**
 * Does THIS shot's beat need a face?
 *
 * Deliberately narrow. The directive is explicit that not every shot should
 * become a close-up and that a shot which deliberately puts someone off-screen
 * must stay that way — coverage is the character-consistency strategy, and a
 * film of faces reads as a glitch. So this answers yes only for the two cases
 * where the beat is CARRIED by the face:
 *
 *   - the shot has a spoken line (a mouth the audience must see move), or
 *   - the shot's own text names an expression or a look.
 *
 * A shot that merely contains a person does not qualify. Neither does one
 * whose text says nobody is there.
 */
export function faceCarriesTheBeat(shot: {
  still?: string | null;
  narration?: string | null;
  dialogue?: { line?: string | null } | null;
}): boolean {
  if (shot.dialogue && String(shot.dialogue.line ?? "").trim()) return true;
  const hay = `${shot.still ?? ""} ${shot.narration ?? ""}`.toLowerCase();
  if (!hay.trim()) return false;
  // An explicit denial wins, for the same reason it does in faceQuality:
  // "no people" contains "people".
  if (/\b(no people|no one|nobody|deserted|uninhabited|empty)\b/.test(hay)) return false;
  return /\b(face|eyes?|expression|smiles?|smiling|frowns?|weeps?|weeping|stares?|staring|glares?|looks? up|looks? down|looks? at|meets? (?:his|her|their) (?:eye|gaze)|whispers?|shouts?|says?|speaks?|asks?|replies)\b/.test(
    hay,
  );
}

export type DirectedShot = {
  /** The decorated still the image prompt should use. */
  still: string;
  /** Size the director assigned, or null when the plan's own size stood. */
  size: string | null;
  /** Lighting note appended (always present). */
  lighting: string;
  /** True when the size pool was narrowed because the beat needs a face. */
  faceFramed: boolean;
};

/**
 * The whole-plan director pass. First shot establishes, the last pulls
 * wide to close the film; between them the sizes walk the arc from a
 * seeded offset so two films with the same shot count do not share a
 * cutting rhythm. Lighting is a seeded pick that never repeats on
 * adjacent shots. A very long still (the 1900-char prompt budget is
 * sliced downstream) is left undecorated rather than half-decorated.
 */
export function directShots(
  stills: readonly string[],
  seedId: string,
  /**
   * The shots' own grammar, when the caller has it. Optional so every existing
   * call site keeps working unchanged: with no beats supplied the director
   * behaves exactly as it did, and only a caller that knows which beats are
   * carried by a face gets the narrowed pool.
   */
  beats: readonly {
    still?: string | null;
    narration?: string | null;
    dialogue?: { line?: string | null } | null;
  }[] = [],
): DirectedShot[] {
  const seed = fnv1a(String(seedId ?? ""));
  const n = stills.length;
  const offset = Math.floor(draw(seed, 0) * SHOT_SIZES.length);
  let prevLight = -1;
  return stills.map((raw, i) => {
    const still = raw ?? "";
    // Lighting: seeded, and re-drawn one lane over if it would repeat the
    // previous shot's pick — adjacent shots always read differently.
    let li = Math.floor(draw(seed, 100 + i) * LIGHTING_PALETTE.length);
    if (li === prevLight) li = (li + 1) % LIGHTING_PALETTE.length;
    prevLight = li;
    const lighting = LIGHTING_PALETTE[li];

    const keepSize = hasLeadingSize(still);

    // SIZE USED TO BE CHOSEN BY POSITION ALONE, and that was the defect.
    //
    // MEASURED 2026-08-31, reading this function against the complaint
    // "characters' faces are not reliably visible". The size came from
    // `SHOT_SIZES[(i + offset) % SHOT_SIZES.length]` — a round-robin over the
    // whole palette from a seeded offset — with the first shot forced to
    // `establishing` and the LAST forced to `wide`. The shot's own content was
    // never consulted. So a line of dialogue could land on `wide`, the still
    // prompt would faithfully say "wide shot", and the face would be drawn at
    // perhaps 25 pixels on a 704-wide canvas. Nobody chose that; it fell out
    // of a cutting rhythm meeting a beat it could not see.
    //
    // The rhythm is worth keeping — it is why two films with the same shot
    // count do not cut identically — so it is NARROWED rather than replaced.
    // A beat the face carries walks the same round-robin over the
    // face-legible sizes; every other beat is untouched, including the
    // establishing open. The last shot keeps its `wide` close unless the film
    // ends on someone's face, which is exactly the shot a forced wide was
    // worst for.
    const beat = beats[i];
    const needsFace = beat ? faceCarriesTheBeat(beat) : false;
    const pool = needsFace ? FACE_LEGIBLE_SIZES : SHOT_SIZES;
    const size = needsFace
      ? pool[(i + offset) % pool.length]
      : i === 0
        ? "establishing"
        : i === n - 1
          ? "wide"
          : SHOT_SIZES[(i + offset) % SHOT_SIZES.length];

    if (still.length > 1700) {
      // Decoration appended past the downstream slice would be cut mid-word;
      // an undecorated shot beats a mangled prompt (same trade the slice
      // itself makes).
      return { still, size: null, lighting, faceFramed: false };
    }
    const sizeNote = keepSize ? "" : `${size} shot, `;
    return {
      still: `${still} — ${sizeNote}${lighting}.`,
      size: keepSize ? null : size,
      lighting,
      faceFramed: needsFace && !keepSize,
    };
  });
}
