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
import { type RegisteredSource, evidenceWeight } from "./evidence.ts";
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
/**
 * EACH EVIDENCE ITEM CARRIES ITS OWN WEIGHT, NOT THE RECORD'S AGGREGATE — and
 * the first version got this wrong in a way nothing in this module could see.
 *
 * It wrote `conf(r.confidence, …)` onto EVERY item of the record. `model.ts`'s
 * `Confidence` belongs to one `Evidence`, so that was a category error twice
 * over. A record holding a fetched registry field and a recalled guess gave
 * both the SAME belief; and `detectGaps` takes the max over supporting and the
 * max over opposing, so a CONTESTED record's weak side arrived at the strong
 * side's strength and every dispute read as symmetric.
 *
 * It also made the two systems fail to compose. The substrate's `confidence`
 * SATURATES at 0.5 for a single source by design (`w / (w + 1)`, promotion.ts),
 * while `detectGaps` calls a concept VERIFIED at 0.85 — so no substrate record
 * could ever settle a gap, RESEARCH would plan a question about a fact ONIQ had
 * read straight out of its own module, and the research adapter would refuse
 * it, once per run, forever.
 *
 * `evidenceWeight` is the right quantity and is already in [0,1] by
 * construction: an experiment or a fetched structured field is 1 and settles a
 * stable gap; a `spec_cited` reading is 0.36 and leaves it UNCERTAIN, which is
 * exactly what a second-hand citation should do. The record's own aggregate is
 * unchanged and still travels on the RELATION, where a record-level number
 * belongs.
 *
 * Found by wiring the substrate to the gap detector, not by reading either.
 */
export function toKnowledgeState(
  records: readonly KnowledgeRecord[],
  nowMs: number,
  /**
   * REQUIRED, and deliberately not defaulted to an empty map.
   * `evidenceWeight(e, null)` silently halves an unknown source, which is the
   * right answer for ONE unregistered source and the wrong answer for a caller
   * who forgot the registry entirely — every belief in the graph would come out
   * at half strength and nothing would say so.
   */
  sources: ReadonlyMap<string, RegisteredSource>,
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
        confidence: conf(
          evidenceWeight(e, sources.get(e.sourceId) ?? null),
          VOLATILITY_TO_BELIEF[r.volatility],
        ),
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
