/**
 * THE CANONICAL KNOWLEDGE RECORD — spec §6 and §7.
 *
 * The core principle, in the spec's own words: **"ONIQ must distinguish
 * information it has encountered from knowledge it has verified. New evidence
 * must be able to strengthen, qualify, contradict, supersede, or invalidate
 * older knowledge."**
 *
 * That sentence is the difference between this and a document store. A
 * retrieved passage is EVIDENCE. A `KnowledgeRecord` is an ASSERTION with a
 * status, and the status is the only thing entitled to say ONIQ believes it.
 *
 * THE ID HASHES THE ASSERTION, NOT THE BELIEF — v1.1's `transition.ts` lesson,
 * applied here. `subject|predicate|object|domain` is what the record IS; the
 * status, confidence, version and evidence are what ONIQ currently thinks about
 * it, and they move. If they entered the id, a promotion would create a new
 * record rather than advancing one, and nothing could be superseded because
 * nothing would have a stable identity to supersede.
 */
import { type SourceEvidence } from "./evidence.ts";
import { type Provenance, EMPTY_PROVENANCE, isTraceable } from "./provenance.ts";
import { contentHash } from "../../math/hash.ts";

/** §7's five states, in the spec's own order and with its own meanings. */
export type KnowledgeStatus = "CANDIDATE" | "VERIFIED" | "CONTESTED" | "SUPERSEDED" | "REJECTED";

export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  "CANDIDATE",
  "VERIFIED",
  "CONTESTED",
  "SUPERSEDED",
  "REJECTED",
];

/**
 * §7's "Can affect decisions?" column, as code rather than a table in a
 * document. The loop asks THIS, never the status directly — a caller comparing
 * `status === "VERIFIED"` by hand is a caller that will forget CONTESTED
 * exists, and CONTESTED is the interesting one.
 */
export function mayInformDecision(status: KnowledgeStatus): boolean {
  return status === "VERIFIED";
}

/**
 * CONTESTED is usable, but only by a reader that KNOWS it is contested — §7:
 * "Only with conflict-aware reasoning". So it is a separate predicate, and a
 * caller has to opt in by name.
 */
export function mayInformConflictAwareDecision(status: KnowledgeStatus): boolean {
  return status === "VERIFIED" || status === "CONTESTED";
}

/**
 * §10. Volatility is a property of the CLAIM's subject matter, not of its
 * source: a theorem does not go stale because a blog said it.
 *
 * `unknown` is not a hedge — the spec is explicit that "Unknown freshness:
 * treat as stale until verified", so it carries the SHORTEST interval of all,
 * which is what makes it safe rather than convenient.
 */
export type Volatility = "stable" | "slow" | "fast" | "event_driven" | "unknown";

export const VOLATILITY: readonly Volatility[] = [
  "stable",
  "slow",
  "fast",
  "event_driven",
  "unknown",
];

export type Validity = {
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly lastVerifiedAt: string | null;
};

export const UNBOUNDED_VALIDITY: Validity = {
  validFrom: null,
  validUntil: null,
  lastVerifiedAt: null,
};

export type KnowledgeRecord = {
  readonly id: string;
  /** The triple. `object` is unknown by design — a value, not always a string. */
  readonly subject: string;
  readonly predicate: string;
  readonly object: unknown;
  readonly domain: readonly string[];

  readonly sourceIds: readonly string[];
  readonly evidence: readonly SourceEvidence[];

  /**
   * A DECISION SIGNAL, NOT A TRUTH VALUE — §21: "Do not confuse confidence with
   * truth." It is computed from evidence by `scoreConfidence`, never assigned
   * by whoever wrote the claim.
   */
  readonly confidence: number;
  readonly status: KnowledgeStatus;
  readonly volatility: Volatility;
  readonly validity: Validity;

  /** Monotonic per assertion id. A supersession increments it. */
  readonly version: number;

  readonly derivedFrom: readonly string[];
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  /** Set when this record was replaced; names the record that replaced it. */
  readonly supersededBy: string | null;

  readonly provenance: Provenance;
};

/**
 * The assertion's identity. Deterministic, clock-free, and deliberately NOT a
 * function of status/confidence/version — see the header.
 *
 * `object` is JSON-serialised with its keys SORTED, because two records
 * asserting the same object written in a different key order are the same
 * assertion, and an id that disagreed would make them two rows that could never
 * be reconciled against each other.
 */
export function assertionId(
  subject: string,
  predicate: string,
  object: unknown,
  domain: readonly string[],
): string {
  // `contentHash` ALREADY SORTS OBJECT KEYS AND NORMALISES -0 — the kernel has
  // carried it since v1.1. A hand-rolled stable serialiser here was written and
  // then deleted: a second canonicalisation is a second thing to drift, and
  // this one would have disagreed with every other hashed record in OQCA.
  return `kr_${contentHash([subject, predicate, object, [...domain].sort()])}`;
}

export type RecordDraft = {
  readonly subject: string;
  readonly predicate: string;
  readonly object: unknown;
  readonly domain: readonly string[];
  readonly evidence: readonly SourceEvidence[];
  readonly volatility?: Volatility;
  readonly validity?: Validity;
  readonly derivedFrom?: readonly string[];
  readonly provenance?: Provenance;
};

/**
 * EVERY RECORD IS BORN `CANDIDATE`. There is no constructor that produces a
 * VERIFIED record, and that is the single most important property in this file:
 * §21's "Do not promote a claim without provenance" is unenforceable if a
 * caller can simply write `status: "VERIFIED"` at the point of creation.
 * Promotion is a separate module with its own policy, and it is the only way in.
 */
export function draftRecord(d: RecordDraft): KnowledgeRecord {
  if (!d.subject || !d.predicate) {
    throw new Error("OKS record: subject and predicate are required");
  }
  if (d.domain.length === 0) throw new Error("OKS record: at least one domain is required");
  return {
    id: assertionId(d.subject, d.predicate, d.object, d.domain),
    subject: d.subject,
    predicate: d.predicate,
    object: d.object,
    domain: [...d.domain],
    sourceIds: [...new Set(d.evidence.map((e) => e.sourceId))].sort(),
    evidence: d.evidence,
    confidence: 0,
    status: "CANDIDATE",
    volatility: d.volatility ?? "unknown",
    validity: d.validity ?? UNBOUNDED_VALIDITY,
    version: 1,
    derivedFrom: d.derivedFrom ?? [],
    supports: [],
    contradicts: [],
    supersededBy: null,
    provenance: d.provenance ?? EMPTY_PROVENANCE,
  };
}

/**
 * §21: "Do not erase historical knowledge. Supersede/version it so ONIQ can
 * replay previous world states."
 *
 * So supersession RETURNS BOTH RECORDS. The old one is not deleted, not
 * mutated in place, and keeps its own id — it becomes a SUPERSEDED row that
 * names its replacement. A function that returned only the winner would make
 * the caller responsible for keeping the loser, and callers do not.
 */
export function supersede(
  older: KnowledgeRecord,
  newer: KnowledgeRecord,
): { readonly retired: KnowledgeRecord; readonly current: KnowledgeRecord } {
  if (older.id !== newer.id) {
    // Two DIFFERENT assertions are a conflict, not a supersession. Conflicts
    // are `conflict.ts`'s job and have a completely different resolution.
    throw new Error("OKS record: supersede requires the same assertion id");
  }
  return {
    retired: { ...older, status: "SUPERSEDED", supersededBy: newer.id },
    current: { ...newer, version: older.version + 1 },
  };
}

/** §18's provenance-coverage metric, per record. */
export function hasCompleteProvenance(r: KnowledgeRecord): boolean {
  return isTraceable(r.provenance) && r.evidence.length > 0;
}
