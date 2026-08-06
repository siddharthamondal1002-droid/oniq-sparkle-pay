// Anti-memorisation screen.
//
// Language models reproduce training data. A generator told to write "an
// original question in the style of CBSE class 10" will sometimes emit a
// question it memorised, and the prompt instruction not to is not a control —
// it is a hope. Rule 1 forbids reproducing a past paper or textbook item, and
// this is the part of that rule that is actually enforced.
//
// WHAT IS BEING MEASURED
//
// Two signals, because they fail in different directions.
//
//   1. Word 5-gram Jaccard. Catches an item that is broadly the same text with
//      light edits. Independent questions on the same topic share topic words
//      but almost never share five-word sequences, so this stays near zero for
//      genuinely distinct items and climbs fast for a paraphrase.
//
//   2. Longest shared run of consecutive words. Catches the case Jaccard
//      misses: one memorised sentence embedded in otherwise fresh text. A
//      twelve-word run in common is not coincidence.
//
// A DIGIT-BLIND PASS, DELIBERATELY
//
// Changing the numbers in a copied question is the oldest way to launder one,
// and a numerically altered copy is a derivative work, not a new item. So the
// comparison runs twice: once on the literal text, once with every number
// replaced by a placeholder. The higher score wins.
//
// WHAT THIS IS NOT
//
// It cannot detect copying from a corpus it has never seen. ONIQ holds no
// licensed past-paper corpus and must not acquire one — ingesting the material
// to check against it would be the very copying the rule prohibits. So the
// screen runs against what is legitimately available: items ONIQ has already
// generated, and any text a reviewer supplies as a known match. The score and
// its provenance are stored per item as good-faith evidence of the check
// having been made, which is the honest claim.

/** Words, lowercased, punctuation stripped. Digits preserved. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Same, with every run of digits collapsed to a single placeholder token. */
export function wordsDigitBlind(text: string): string[] {
  return words(text).map((w) => (/^\p{N}+$/u.test(w) ? "#" : w.replace(/\p{N}+/gu, "#")));
}

/** Overlapping word n-grams. */
export function shingles(tokens: string[], n = 5): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) {
    if (tokens.length) out.add(tokens.join(" "));
    return out;
  }
  for (let i = 0; i + n <= tokens.length; i++) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Length, in words, of the longest run of consecutive words present in both. */
export function longestSharedRun(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  // Rolling single-row DP — the full matrix is unnecessary and these strings
  // can be long once case-study passages arrive.
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export type SimilarityVerdict = {
  /** 0–1. The highest similarity found against any corpus entry. */
  score: number;
  /** Longest shared consecutive-word run against that entry. */
  longestRun: number;
  /** A label for whatever it matched, or null when the corpus is empty. */
  matchedAgainst: string | null;
  /** True when the item must be quarantined rather than published. */
  quarantine: boolean;
  reason: string | null;
};

export type CorpusEntry = { label: string; text: string };

/**
 * Jaccard at which two texts stop being plausibly independent.
 *
 * Independent questions on the same syllabus point measure around 0.02–0.05 on
 * word 5-grams. 0.25 is far above that and well below a paraphrase, which
 * lands 0.4 and up.
 */
export const QUARANTINE_JACCARD = 0.25;

/**
 * A shared run this long is not coincidence. Twelve words is roughly a full
 * clause; independent writing does not produce one by chance.
 */
export const QUARANTINE_RUN = 12;

export function screenItem(candidate: string, corpus: CorpusEntry[]): SimilarityVerdict {
  const litTokens = words(candidate);
  const blindTokens = wordsDigitBlind(candidate);
  const litShingles = shingles(litTokens);
  const blindShingles = shingles(blindTokens);

  let best: SimilarityVerdict = {
    score: 0,
    longestRun: 0,
    matchedAgainst: null,
    quarantine: false,
    reason: null,
  };

  for (const entry of corpus) {
    const eLit = words(entry.text);
    const eBlind = wordsDigitBlind(entry.text);
    const score = Math.max(
      jaccard(litShingles, shingles(eLit)),
      jaccard(blindShingles, shingles(eBlind)),
    );
    const run = Math.max(longestSharedRun(litTokens, eLit), longestSharedRun(blindTokens, eBlind));
    if (score > best.score || run > best.longestRun) {
      best = {
        score: Math.max(score, best.score),
        longestRun: Math.max(run, best.longestRun),
        matchedAgainst: entry.label,
        quarantine: false,
        reason: null,
      };
    }
  }

  if (best.score >= QUARANTINE_JACCARD) {
    best.quarantine = true;
    best.reason = `Similarity ${best.score.toFixed(3)} against "${best.matchedAgainst}" — at or above the ${QUARANTINE_JACCARD} threshold.`;
  } else if (best.longestRun >= QUARANTINE_RUN) {
    best.quarantine = true;
    best.reason = `Shares a ${best.longestRun}-word run with "${best.matchedAgainst}" — a run that long is not coincidence.`;
  }

  // Rounded to the numeric(4,3) the item table stores, so the value written to
  // the database is the value that was judged.
  best.score = Math.round(best.score * 1000) / 1000;
  return best;
}
