/**
 * CASTING — which registered owner actor (if any) belongs in a shot.
 *
 * The Actor Resolver (storyActors.ts) is the app-side authority, but it imports
 * the bundler-land registry ("@/" alias), so the Node story worker cannot use
 * it. This module does the same conservative matching against the ALIAS-FREE
 * worker map (storyActorAssets.ts), so the worker can decide casting itself and
 * fetch the owner reference. It fabricates nothing: no match → no actor → the
 * existing text-only path.
 *
 * Kept deliberately identical in spirit to storyActors.matchCharacter — a real
 * fraction of the query must land AND at least two shared meaningful tokens — so
 * a bare subject or a lone region never latches onto an unrelated actor and
 * makes a character wear the wrong face.
 */
// Explicit ".ts", so the Node story worker (strip-types, no bundler alias) can
// import this module the same way it imports storyPlan.ts. Resolves in vitest
// too (allowImportingTsExtensions).
import {
  ACTOR_ASSETS,
  assetUrl,
  referenceEligible,
  type ActorAsset,
} from "../data/storyActorAssets.ts";

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "with",
  "by",
  "for",
  "from",
  "near",
  "into",
  "over",
  "under",
  "his",
  "her",
  "their",
  "its",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "this",
  "that",
  "who",
  "walks",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export type ActorCast = {
  actor: ActorAsset;
  /** Full, fetchable ONIQ reference URL. */
  referenceUrl: string;
  score: number;
  /**
   * Whether this actor's frame may be attached DIRECTLY to generation. A sheet
   * frame matches an actor (identity is right) but is NOT eligible — the worker
   * must record SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE and use the text-only
   * fallback rather than substitute a different actor.
   */
  eligible: boolean;
};

/**
 * The best registered owner actor for a free-text mention, or null when nothing
 * clears the bar. Conservative and deterministic (ties break by map order).
 */
export function matchActor(
  query: string,
  opts: { minScore?: number; minHits?: number } = {},
): ActorCast | null {
  const minScore = opts.minScore ?? 0.5;
  const minHits = opts.minHits ?? 2;
  const q = new Set(tokens(query));
  if (q.size === 0) return null;

  let best: ActorCast | null = null;
  for (const actor of ACTOR_ASSETS) {
    const hay = new Set(tokens(`${actor.region} ${actor.description}`));
    let hits = 0;
    for (const t of q) if (hay.has(t)) hits += 1;
    if (hits < minHits) continue;
    const score = hits / q.size;
    if (score < minScore) continue;
    if (!best || score > best.score) {
      // The best match by identity, kept even if it is a sheet frame — the
      // worker records the ineligibility and degrades to text-only rather than
      // substitute a different actor's face.
      best = {
        actor,
        referenceUrl: assetUrl(actor),
        score,
        eligible: referenceEligible(actor),
      };
    }
  }
  return best;
}

/**
 * Cast the actors present in ONE shot, from its narration plus any film-level
 * cast hints (the plan's cast names/locks, the title/setting). Returns at most
 * `max` distinct actors, best first — never all 67, never an actor the text
 * does not support. Each carries an auditable reference URL.
 */
export function castShot(
  texts: string[],
  opts: { max?: number; minScore?: number; minHits?: number } = {},
): ActorCast[] {
  const max = opts.max ?? 2;
  const seen = new Set<string>();
  const out: ActorCast[] = [];
  for (const text of texts) {
    const m = matchActor(text, opts);
    if (!m) continue;
    if (seen.has(m.actor.characterRefId)) continue;
    seen.add(m.actor.characterRefId);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}
