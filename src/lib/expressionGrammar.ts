/**
 * The scene's emotional register, read off its own words — rung 5 of the
 * in-house cinematography ladder (movie grade, 2026-08-14).
 *
 * Several cast sheets carry expression heads the artist already drew:
 * Ali Baba smiles, startles and wonders; the mother warms and grieves; the
 * jar jinni rages, ponders and sighs; the lamp jinni allows himself a slow
 * quiet smile. This module decides WHICH of those a shot has earned — the
 * head swap itself is composition work (expressionHeads.ts), and which
 * heads exist per character is that file's data.
 *
 * THE SCENE CHOOSES THE FACE, or nothing — the vfxKindFor honesty gate,
 * applied to feelings. A scene that names no emotion keeps the character's
 * painted base face; absence is the correct default, because the wrong
 * expression is worse than none (a character smiling through a funeral is
 * the face-version of fireflies in a rainstorm).
 *
 * PRECEDENCE runs strong-and-specific before mild-and-generic: rage beats
 * tears beats a gasp beats a smile beats wonder beats weariness. A scene
 * with an enraged jinni and a nervous laugh is an anger scene.
 *
 * SELF-CONTAINED ON PURPOSE — no imports at all, for the same Node
 * type-stripping reason as particleField.ts: the story worker imports this
 * file directly, and one relative import here breaks it.
 */

export type Emotion = "anger" | "sorrow" | "surprise" | "joy" | "wonder" | "weary";

/**
 * Which emotion a shot's words earn. Checked in precedence order; null for
 * a scene that names nothing. The vocabularies are thesaurus-wide (the
 * owner's vfx directive, applied here too) but every stem is
 * boundary-anchored and the traps are guarded individually, because prose
 * is adversarial: a "crystal" is not a cry, "wonderful" is praise rather
 * than awe, a "shockwave" is physics, tears OF JOY are joy, and a fire
 * that "roared" is furniture, not fury — roar is deliberately absent.
 */
export function emotionFor(text: string): Emotion | null {
  const t = text.toLowerCase();
  // seeth: seethe/seething. No "roar", no "storm", no "glare" — fires roar,
  // weather storms and the sun glares, and all three already cost the vfx
  // classifier a guard each.
  if (
    /\b(?:rage(?:s|d)?\b|raging|fury|furious|wrath|anger|angry|enraged|seeth|snarl|scowl|livid|indignant|bellow|incensed|apoplectic)/.test(
      t,
    )
  ) {
    return "anger";
  }
  // cry(?!stal): a crystal is not a cry. tears is a homograph — the noun
  // weeps, the verb destroys — so "tears" followed by an object or a
  // direction ("tears the letter", "tears it apart", "tears down the
  // wall") is excluded, and tears OF JOY belong to joy below. The
  // singular "tear" stays out entirely for the same reason.
  if (
    /\b(?:weep|wept|tears\b(?!\s+of\s+joy\b)(?!\s+(?:the|a|an|his|her|their|its|it|at|into|apart|open|down|through|off|up)\b)|tearful|cry(?!stal)\w*|cried|sob(?:s|bed|bing)?\b|grief|griev|mourn|sorrow|lament|heartbroken|anguish|woe\b|woeful|despair|forlorn)/.test(
      t,
    )
  ) {
    return "sorrow";
  }
  // shock(?!wave): the physics kind carries no face, and a "shock of white
  // hair" is a hairstyle.
  if (
    /\b(?:gasp|astonish|startl|amaze(?:d|ment)\b|shock(?!wave)(?!\s+of\s+(?:\w+\s+)?hair\b)\w*|stunned|aghast|surpris|wide-eyed|dumbfounded|flabbergasted|taken aback)/.test(
      t,
    )
  ) {
    return "surprise";
  }
  // beam(?:ed|ing) only as the verb people do — a "beam of light" is a
  // noun and stays out on the word boundary. grin(?!d): lamps get ground,
  // faces grin. cheer(?!less): cheerless is the opposite of this bucket.
  if (
    /\b(?:smil|laugh|grin(?!d)|joy(?:ful|ous)?\b|delight|beam(?:ed|ing)\b|merri|merry\b|cheer(?!less)|glad(?:ness|ly)?\b|rejoic|chuckl|happy|happi|elated|jubilant|overjoyed)/.test(
      t,
    )
  ) {
    return "joy";
  }
  // wonder(?!ful): "wonderful" is praise. wondrous stays out for the same
  // reason — it describes the THING, not the face looking at it.
  if (
    /\b(?:wonder(?:s|ed|ing)?\b(?!ful)|marvel(?:s|led|ling|ed)?\b|awe\b|awestruck|curious|curiosity|intrigu|fascinat|spellbound|transfixed)/.test(
      t,
    )
  ) {
    return "wonder";
  }
  // sigh as a verb or the noun someone heaves; "drained the cup" is
  // drinking, not exhaustion.
  if (
    /\b(?:weary|wearily|weariness|exhaust|tired|fatigue|sigh(?:s|ed|ing)?\b|drained\b(?!\s+the\b)|slump|listless|haggard)/.test(
      t,
    )
  ) {
    return "weary";
  }
  return null;
}
