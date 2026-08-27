/**
 * Story DNA retrieval and blending.
 *
 * Owner directive 2026-08-27 (local story intelligence):
 *
 *   user idea -> requirements -> compatible DNA -> BLEND -> local LLM
 *
 * The rule this module exists to enforce is the library's own: recombine
 * structural DNA into an original story, never reproduce one entry. So
 * `blend` cannot return a single entry even when one scores far above the
 * rest — each creative axis is drawn from a DIFFERENT entry, and where
 * each axis came from is recorded, so a finished story can always be
 * traced back to the structures it recombined.
 *
 * Everything here is pure: same inputs, same brief. The caller supplies
 * the library and the tie-breaking seed, which is what makes the whole
 * layer testable offline against the real 1,000 entries.
 */

import { DNA_LIBRARY, DNA_POLICY, type DnaEntry } from "./storyDnaLibrary.ts";

export { DNA_LIBRARY, DNA_POLICY };
export type { DnaEntry };

/** Durations the catalogue actually sells, in seconds. */
export const DURATION_BUCKETS = [
  { key: "3_min", seconds: 180 },
  { key: "5_min", seconds: 300 },
  { key: "10_min", seconds: 600 },
  { key: "15_min", seconds: 900 },
  { key: "30_min", seconds: 1800 },
  { key: "short_film", seconds: 1200 },
  { key: "series_episode", seconds: 1500 },
  { key: "feature", seconds: 5400 },
] as const;

export type Requirements = {
  /** The user's own words, kept verbatim — never rewritten by a heuristic. */
  idea: string;
  seconds: number;
  /** Genres the idea names or implies. Empty means "no preference stated". */
  genres: string[];
  /** Structural preferences the idea states outright. */
  pacing: string | null;
  endingFamily: string | null;
  /** Nearest catalogue duration bucket, for DNA whose own duration matches. */
  durationKey: string;
};

/**
 * What the user asked for, read from their own words.
 *
 * DELIBERATELY CONSERVATIVE. This only recognises what the idea SAYS. It
 * never infers identity attributes — no ethnicity, gender, occupation,
 * nationality or location is ever derived here, per the library's own
 * setting engine, which says to use a culturally specific setting when
 * the user asks for one and never to infer attributes that were not
 * requested. An unstated axis stays null so the blend leaves it open.
 */
const GENRE_HINTS: Record<string, string[]> = {
  Horror: ["horror", "scary", "haunt", "terrify", "nightmare"],
  "Psychological Thriller": ["psychological", "paranoia", "unreliable", "gaslight"],
  "Mystery / Detective": ["mystery", "detective", "whodunit", "investigat", "clue"],
  "Crime / Gangster": ["crime", "heist", "gangster", "mafia", "robbery"],
  "Action / Survival": ["action", "survival", "chase", "escape", "stranded"],
  "Science Fiction": ["sci-fi", "science fiction", "space", "robot", "future", "alien"],
  "Fantasy / Epic Fantasy": ["fantasy", "magic", "dragon", "kingdom", "wizard"],
  "Dark Fantasy / Supernatural": ["supernatural", "ghost", "demon", "curse", "occult"],
  Romance: ["romance", "love story", "romantic"],
  Comedy: ["comedy", "funny", "comic", "humor", "humour"],
  Drama: ["drama", "dramatic"],
  "Family / Coming of Age": ["coming of age", "family", "childhood", "growing up"],
  Adventure: ["adventure", "quest", "journey", "expedition"],
  Historical: ["historical", "period", "century", "ancient"],
  War: ["war", "battle", "soldier", "front line"],
  Western: ["western", "cowboy", "frontier"],
  Sports: ["sport", "boxing", "football", "cricket", "race"],
  Musical: ["musical", "song", "band", "concert"],
  Documentary: ["documentary", "docu"],
  Anthology: ["anthology", "collection of stories"],
};

const PACING_HINTS: Record<string, string[]> = {
  fast: ["fast", "relentless", "breakneck", "non-stop", "nonstop"],
  slow_burn: ["slow burn", "slow-burn", "creeping", "gradual"],
  quiet_to_intense: ["quiet at first", "builds to", "starts quiet"],
  escalating: ["escalat", "spiral", "worse and worse"],
  steady: ["steady", "even pace", "measured"],
};

const ENDING_HINTS: Record<string, string[]> = {
  hopeful: ["happy ending", "hopeful", "uplifting"],
  tragic: ["tragic", "tragedy", "devastating"],
  bittersweet: ["bittersweet"],
  ambiguous: ["ambiguous", "open ending", "unresolved"],
  ironic: ["ironic", "twist ending"],
  cathartic: ["cathartic", "release"],
  revelatory: ["revelation", "revealing", "reveals everything"],
};

function matchHints(text: string, table: Record<string, string[]>): string[] {
  const found: string[] = [];
  for (const [key, needles] of Object.entries(table)) {
    if (needles.some((n) => text.includes(n))) found.push(key);
  }
  return found;
}

export function nearestDurationKey(seconds: number): string {
  let best: { key: string; seconds: number } = DURATION_BUCKETS[0];
  for (const b of DURATION_BUCKETS) {
    if (Math.abs(b.seconds - seconds) < Math.abs(best.seconds - seconds)) best = b;
  }
  return best.key;
}

export function extractRequirements(idea: string, seconds: number): Requirements {
  const text = idea.toLowerCase();
  const pacing = matchHints(text, PACING_HINTS);
  const ending = matchHints(text, ENDING_HINTS);
  return {
    idea,
    seconds,
    genres: matchHints(text, GENRE_HINTS),
    pacing: pacing.length === 1 ? pacing[0] : null,
    endingFamily: ending.length === 1 ? ending[0] : null,
    durationKey: nearestDurationKey(seconds),
  };
}

/**
 * How well one entry answers the requirements. Higher is better; every
 * entry stays eligible, because a library that only ever surfaced exact
 * genre matches would make one genre's fifty entries the whole engine.
 */
export function scoreEntry(entry: DnaEntry, req: Requirements): number {
  let score = 1;
  if (req.genres.length && req.genres.includes(entry.genre)) score += 6;
  if (req.pacing && entry.pacing === req.pacing) score += 3;
  if (req.endingFamily && entry.endingFamily === req.endingFamily) score += 3;
  if (entry.defaultDuration === req.durationKey) score += 2;
  return score;
}

/** Deterministic, seed-driven shuffle — no Math.random in a paid path. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Retrieved = { entry: DnaEntry; score: number };

/**
 * The compatible-DNA shortlist: the best-scoring entries, with ties broken
 * by the seed so two identical ideas do not always draw the same five.
 */
export function retrieve(
  req: Requirements,
  opts: { seed: string; limit?: number; library?: readonly DnaEntry[] } = { seed: "" },
): Retrieved[] {
  const library = opts.library ?? DNA_LIBRARY;
  const limit = opts.limit ?? 12;
  const rand = seeded(opts.seed + "|" + req.idea);
  const jittered = library.map((entry) => ({
    entry,
    score: scoreEntry(entry, req),
    jitter: rand(),
  }));
  jittered.sort((a, b) => b.score - a.score || a.jitter - b.jitter);
  return jittered.slice(0, limit).map(({ entry, score }) => ({ entry, score }));
}

/** Which entry each creative axis came from. */
export type BlendProvenance = {
  coreEngine: string;
  protagonistNeed: string;
  centralTwist: string;
  endingFamily: string;
  structure: string;
  pacing: string;
};

export type StoryBrief = {
  idea: string;
  seconds: number;
  genre: string;
  coreEngine: string;
  protagonistNeed: string;
  centralTwist: string;
  endingFamily: string;
  structure: string;
  pacing: string;
  /** The library's constant house rules, carried to the model verbatim. */
  policy: typeof DNA_POLICY;
  /** Entry ids, so a finished story can be traced to what it recombined. */
  sources: string[];
  provenance: BlendProvenance;
};

export class BlendRefused extends Error {}

/** The axes a blend must draw from different entries. */
const AXES = [
  "coreEngine",
  "protagonistNeed",
  "centralTwist",
  "endingFamily",
  "structure",
  "pacing",
] as const;

/** How many distinct entries a blend must recombine, at minimum. */
export const MIN_BLEND_SOURCES = 3;

/**
 * Recombine a shortlist into ONE brief.
 *
 * Each axis is taken from a different entry, walking the shortlist in
 * score order so the best match still shapes the story most. The result
 * is refused outright if it drew on fewer than MIN_BLEND_SOURCES entries
 * — "blended" one plot is the exact failure the library forbids, and a
 * silent single-source brief would be indistinguishable downstream from
 * a real blend.
 */
export function blend(shortlist: Retrieved[], req: Requirements): StoryBrief {
  if (shortlist.length < MIN_BLEND_SOURCES) {
    throw new BlendRefused(
      `a blend needs at least ${MIN_BLEND_SOURCES} entries; got ${shortlist.length}`,
    );
  }
  const picked: Record<string, DnaEntry> = {};
  shortlist.forEach((r, i) => {
    picked[AXES[i % AXES.length]] ??= r.entry;
  });
  for (const [i, axis] of AXES.entries()) {
    picked[axis] ??= shortlist[i % shortlist.length].entry;
  }

  const brief: StoryBrief = {
    idea: req.idea,
    seconds: req.seconds,
    // Genre follows the strongest match, which is the one axis a viewer
    // would notice being blended: a horror-comedy nobody asked for.
    genre: shortlist[0].entry.genre,
    coreEngine: picked.coreEngine.coreEngine,
    protagonistNeed: picked.protagonistNeed.protagonistNeed,
    centralTwist: picked.centralTwist.centralTwist,
    endingFamily: req.endingFamily ?? picked.endingFamily.endingFamily,
    structure: picked.structure.structure,
    pacing: req.pacing ?? picked.pacing.pacing,
    policy: DNA_POLICY,
    sources: [],
    provenance: {
      coreEngine: picked.coreEngine.id,
      protagonistNeed: picked.protagonistNeed.id,
      centralTwist: picked.centralTwist.id,
      endingFamily: picked.endingFamily.id,
      structure: picked.structure.id,
      pacing: picked.pacing.id,
    },
  };
  brief.sources = [...new Set(Object.values(brief.provenance))].sort();
  if (brief.sources.length < MIN_BLEND_SOURCES) {
    throw new BlendRefused(
      `blend drew on ${brief.sources.length} entries; the library requires recombination`,
    );
  }
  return brief;
}

/** The whole retrieval stage, one call: idea -> brief. */
export function briefFor(
  idea: string,
  seconds: number,
  seed: string,
  library?: readonly DnaEntry[],
): StoryBrief {
  const req = extractRequirements(idea, seconds);
  return blend(retrieve(req, { seed, library }), req);
}
