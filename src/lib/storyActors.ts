/**
 * THE ACTOR RESOLVER — registered characters become actors, not dead data.
 *
 * ONIQ has a 74-entry character catalogue (STORY_CHARACTER_REFS) that the owner
 * matched to owner-uploaded reference frames (STORY_STYLE_REFS) by `styleRefId`
 * — 67 of the 74 carry a picture. Until now nothing consumed either table: the
 * frames are `attachable: false` and were never supplied to generation, so a
 * registered character was description, not a performer. This module turns a
 * story's character mention into an AUDITABLE actor:
 *
 *   mention → STORY_CHARACTER_REFS → styleRefId → STORY_STYLE_REFS → reference asset
 *
 * PURE and deterministic — no network, no clock, no randomness. It resolves and
 * audits; it does not attach anything to generation (that adapter is a separate,
 * eligibility-gated step) and it never fabricates: a character with no matched
 * frame resolves to status REFERENCE_UNAVAILABLE with a null assetRef, never a
 * substituted face. The registry ids are the identity system — this invents no
 * parallel one.
 *
 * Existing identifiers, reused verbatim:
 *   characterRefId = STORY_CHARACTER_REFS[].externalAssetId
 *   styleRefId     = STORY_CHARACTER_REFS[].styleRefId → STORY_STYLE_REFS[].id
 *   assetRef       = STORY_STYLE_REFS[].url (the owner reference frame)
 */
import { STORY_CHARACTER_REFS, type StoryCharacterRef } from "@/data/storyCharacterRefs";
import { STORY_STYLE_REFS, type StoryStyleRef } from "@/data/storyStyleRefs";

export type ActorStatus = "RESOLVED" | "REFERENCE_UNAVAILABLE";

/** An auditable actor: the mapping story→registry→styleRef→asset, made explicit. */
export type Actor = {
  /** STORY_CHARACTER_REFS externalAssetId — the stable character identity. */
  characterRefId: string;
  /** The matched style-frame id, or null when the character has no picture. */
  styleRefId: string | null;
  /** The owner reference-image url to condition on, or null. */
  assetRef: string | null;
  /** A short human label derived from the registry description. */
  displayName: string;
  region: string;
  description: string;
  /** RESOLVED when a usable reference frame exists; else REFERENCE_UNAVAILABLE. */
  status: ActorStatus;
  referenceAvailable: boolean;
};

const STYLE_BY_ID: ReadonlyMap<string, StoryStyleRef> = new Map(
  STORY_STYLE_REFS.map((s) => [s.id, s]),
);

/** The style frame a character points at, or null (no link, or a dangling one). */
export function styleRefFor(ref: StoryCharacterRef): StoryStyleRef | null {
  if (!ref.styleRefId) return null;
  return STYLE_BY_ID.get(ref.styleRefId) ?? null;
}

/**
 * A short display label from a registry description — the subject before the
 * first comma, capped, so "Fishmonger woman arranging fresh fish, Port Antonio
 * coastal market" reads as "Fishmonger woman arranging fresh fish".
 */
export function displayNameOf(description: string): string {
  const head = description.split(",")[0]?.trim() ?? description.trim();
  return head.length > 60 ? `${head.slice(0, 57)}…` : head;
}

/** Build the auditable actor for one registry entry. Never fabricates an asset. */
export function toActor(ref: StoryCharacterRef): Actor {
  const style = styleRefFor(ref);
  const available = Boolean(style && typeof style.url === "string" && style.url.length > 0);
  return {
    characterRefId: ref.externalAssetId,
    styleRefId: style ? style.id : null,
    assetRef: available ? style!.url : null,
    displayName: displayNameOf(ref.description),
    region: ref.region,
    description: ref.description,
    status: available ? "RESOLVED" : "REFERENCE_UNAVAILABLE",
    referenceAvailable: available,
  };
}

/** Look a character up by its stable externalAssetId. */
export function characterRefById(id: string): StoryCharacterRef | null {
  return STORY_CHARACTER_REFS.find((c) => c.externalAssetId === id) ?? null;
}

// --- deterministic text matching --------------------------------------------

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

/** Lowercase, strip punctuation, drop stopwords and 1-char tokens. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * How well a query describes a registry entry: shared meaningful tokens over
 * the query's own token count (recall-weighted), against region + description.
 * Deterministic and symmetric-free — a short query fully contained in an entry
 * scores 1.
 */
export function matchScore(query: string, ref: StoryCharacterRef): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const hay = new Set(tokens(`${ref.region} ${ref.description}`));
  let hits = 0;
  for (const t of new Set(q)) if (hay.has(t)) hits += 1;
  return hits / new Set(q).size;
}

export type ActorMatch = { ref: StoryCharacterRef; score: number };

/**
 * The best registry entry for a free-text mention, or null when nothing clears
 * the bar. CONSERVATIVE by design: it requires both a real fraction of the
 * query to land AND at least two shared meaningful tokens, so "a woman" or a
 * bare region never latches onto an unrelated character. Ties break by registry
 * order (lowest index) so the result is reproducible.
 */
export function matchCharacter(
  query: string,
  opts: { minScore?: number; minHits?: number } = {},
): ActorMatch | null {
  const minScore = opts.minScore ?? 0.5;
  const minHits = opts.minHits ?? 2;
  const q = new Set(tokens(query));
  if (q.size === 0) return null;

  let best: ActorMatch | null = null;
  for (const ref of STORY_CHARACTER_REFS) {
    const hay = new Set(tokens(`${ref.region} ${ref.description}`));
    let hits = 0;
    for (const t of q) if (hay.has(t)) hits += 1;
    if (hits < minHits) continue;
    const score = hits / q.size;
    if (score < minScore) continue;
    if (!best || score > best.score) best = { ref, score };
  }
  return best;
}

/**
 * Resolve a set of story mentions to actors, auditable end to end. Each result
 * says whether a registry match was found at all, and the actor (when matched)
 * carries its own RESOLVED / REFERENCE_UNAVAILABLE status. Deduped by identity
 * so the same character mentioned twice is one actor.
 */
export type ResolvedMention = { query: string; matched: boolean; actor: Actor | null };

export function resolveActors(mentions: string[]): ResolvedMention[] {
  const seen = new Set<string>();
  const out: ResolvedMention[] = [];
  for (const query of mentions) {
    const m = matchCharacter(query);
    if (!m) {
      out.push({ query, matched: false, actor: null });
      continue;
    }
    const actor = toActor(m.ref);
    if (seen.has(actor.characterRefId)) continue;
    seen.add(actor.characterRefId);
    out.push({ query, matched: true, actor });
  }
  return out;
}

/** Every registered character as an actor — the full auditable roster. */
export function allActors(): Actor[] {
  return STORY_CHARACTER_REFS.map(toActor);
}
