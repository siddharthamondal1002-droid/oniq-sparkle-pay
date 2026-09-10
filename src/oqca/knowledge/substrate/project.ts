/**
 * THE BRIDGE — quantum brief §19, PDF §14, and it is what makes the substrate
 * REACHABLE rather than merely present.
 *
 * This repo's most-recorded mistake, in its own words: "built and unit-tested is
 * not reachable", four times over. A knowledge substrate nothing imports would
 * be the fifth, at larger scale. So there are exactly two exits and both are
 * here:
 *
 *   1. `toKnowledgeState` — VERIFIED records become the concept/relation graph
 *      `detectGaps` already reads, so IDENTIFY_GAPS sees substrate knowledge
 *      without a line of the gap detector changing.
 *   2. `makeSubstrateKnowledgeAdapter` — the v1.3 `KnowledgeAdapter` seam the
 *      LOAD_MEMORY station already calls.
 *
 * ONLY VERIFIED RECORDS CROSS. §7's table gives CANDIDATE "Only as explicitly
 * marked evidence" and CONTESTED "Only with conflict-aware reasoning" — and the
 * loop's `KnowledgeFact` has nowhere to carry either qualification. Projecting a
 * CONTESTED record into it would strip the one property that made it safe to
 * read, which is precisely the silent category change §20 of the quantum brief
 * forbids. Contested knowledge reaches the loop through `contestedFacts`, which
 * a caller must ask for by name.
 */
import type { KnowledgeAdapter, KnowledgeFact } from "../../loop/seams.ts";
import type { KnowledgeRecord } from "./record.ts";
import type { KnowledgeStore } from "./store.ts";
import { usableNow } from "./decay.ts";
import {
  type Concept,
  type Evidence,
  type KnowledgeState,
  type Relation,
  EMPTY_KNOWLEDGE,
  conf,
  withConcept,
  withEvidence,
  withRelation,
} from "../model.ts";

/** How a record reads as one sentence. Deterministic — no clock, no locale. */
export function statement(r: KnowledgeRecord): string {
  const obj =
    typeof r.object === "string"
      ? r.object
      : JSON.stringify(r.object, Object.keys(r.object ?? {}).sort());
  return `${r.subject} ${r.predicate} ${obj}`;
}

/**
 * VOLATILITY BECOMES THE WORKING GRAPH'S `volatility`, and that is not a pun on
 * the name — `model.ts`'s Confidence.volatility means "how much this belief
 * could still move", and a fast-changing fact is exactly a belief that could.
 * The mapping is stated rather than assumed because the two words came from
 * different documents.
 */
const VOLATILITY_TO_BELIEF: Readonly<Record<KnowledgeRecord["volatility"], number>> = {
  stable: 0.05,
  slow: 0.25,
  fast: 0.75,
  event_driven: 0.9,
  unknown: 1,
};

/**
 * Records -> the loop's working knowledge graph.
 *
 * Each record becomes a subject CONCEPT, an object CONCEPT, and a RELATION
 * between them carrying the record's confidence and its evidence. That shape is
 * what `detectGaps` reads to answer UNKNOWN / UNCERTAIN / CONTRADICTED /
 * VERIFIED, so substrate knowledge closes real gaps rather than sitting beside
 * them.
 */
export function toKnowledgeState(
  records: readonly KnowledgeRecord[],
  nowMs: number,
  contextId = "oks",
): KnowledgeState {
  let k = EMPTY_KNOWLEDGE;
  for (const r of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!usableNow(r, nowMs)) continue;

    const objectId = `${r.subject}:${r.predicate}`;
    const subject: Concept = {
      id: r.subject,
      label: r.subject,
      dependsOn: [],
      contextIds: [contextId],
    };
    const object: Concept = {
      id: objectId,
      label: statement(r),
      // The object of an assertion cannot be understood without its subject.
      dependsOn: [r.subject],
      contextIds: [contextId],
    };
    k = withConcept(withConcept(k, subject), object);

    const evidenceIds: string[] = [];
    for (const e of r.evidence) {
      const ev: Evidence = {
        id: e.id,
        // A SUBSTRATE MEASUREMENT IS `measured`; EVERYTHING ELSE IS `document`.
        // Mapping a fetched page to "measured" would claim ONIQ observed the
        // world when it observed a page about the world — v1.3 §30's
        // perception/inference boundary, in a second place.
        source: e.sourceType === "measurement" ? "measured" : "document",
        statement: e.excerpt,
        provenance: e.locator,
        supports: e.supports,
        confidence: conf(r.confidence, VOLATILITY_TO_BELIEF[r.volatility]),
      };
      k = withEvidence(k, ev);
      evidenceIds.push(e.id);
    }

    const rel: Relation = {
      id: r.id,
      from: r.subject,
      to: objectId,
      kind: r.predicate,
      confidence: conf(r.confidence, VOLATILITY_TO_BELIEF[r.volatility]),
      evidenceIds,
      contextId,
      provenance: r.sourceIds.join(","),
    };
    // `withRelation` throws on evidence the store does not hold, which is the
    // untraceable-claim guard `model.ts` was built with. Nothing here bypasses it.
    k = withRelation(k, rel);
  }
  return k;
}

/** A record as the loop's `KnowledgeFact`. `sourceRef` is REQUIRED there. */
export function toFact(r: KnowledgeRecord): KnowledgeFact {
  return {
    id: r.id,
    statement: statement(r),
    confidence: r.confidence,
    // The seam's anti-fabrication guard: a fact with no source cannot exist.
    // A record with no sources cannot be VERIFIED, so this is never empty on
    // the path that reaches the loop — and `substrateFacts` filters anyway.
    sourceRef: r.sourceIds.join(",") || "oks:unsourced",
  };
}

function relevance(query: string, text: string): number {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
  if (terms.size === 0) return 0;
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  let hit = 0;
  for (const t of terms) if (words.has(t)) hit++;
  return hit / terms.size;
}

/**
 * The v1.3 seam, served from the substrate.
 *
 * `limit` is honoured because the seam REQUIRES it — §5 of the v1.3 brief, "Do
 * not dump the entire memory store into the model". Relevance is word overlap,
 * deliberately the dullest thing that satisfies the contract: anything cleverer
 * is an embedding model, which is a provider and a bill, and PDF §12 is explicit
 * that a vector store is "never the authoritative source of truth".
 */
export function makeSubstrateKnowledgeAdapter(
  store: KnowledgeStore,
  nowMs: () => number,
): KnowledgeAdapter {
  return {
    lookup: async (query, limit) =>
      store
        .byStatus("VERIFIED")
        .filter((r) => usableNow(r, nowMs()))
        .map((r) => ({ r, score: relevance(query, statement(r)) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
        .slice(0, Math.max(0, limit))
        .map((x) => toFact(x.r)),
  };
}

/**
 * Contested knowledge, for a reader that asked for it BY NAME. §7: "Only with
 * conflict-aware reasoning" — so it cannot arrive through the ordinary lookup,
 * where nothing would mark it.
 */
export function contestedFacts(store: KnowledgeStore): readonly KnowledgeFact[] {
  return store.byStatus("CONTESTED").map((r) => ({
    ...toFact(r),
    statement: `[CONTESTED] ${statement(r)}`,
  }));
}
