/**
 * OQCA v1.7 — KNOWLEDGE THAT SURVIVES THE PROCESS THAT LEARNED IT.
 *
 * Owner directive 2026-09-11 §8: _"Fix the current v1.6 limitation. Implement
 * the smallest production-appropriate durable knowledge store compatible with
 * the existing Knowledge Substrate. Do NOT add a graph database merely because
 * this loop exists."_ And: _"The next process must be able to use knowledge
 * produced by the previous process."_
 *
 * THE SMALLEST STORE COMPATIBLE WITH THE SUBSTRATE IS A ROW, NOT A MODEL. The
 * substrate already carries every field §8 names — `SourceEvidence` has the
 * locator, the source version, the content hash and the retrieval time;
 * `KnowledgeRecord` has the confidence, the status and the supersession link;
 * `Provenance` has the activity chain. What it does not have is a shape that
 * can be written to a file, a column or a table and read back. So this file is
 * a SERIALISATION and a seam, and deliberately not a second knowledge model:
 * a parallel model is two vocabularies that drift, and the drift would land on
 * exactly the fields the promotion policy reads.
 *
 * LOSSLESS IS THE PROPERTY THAT MATTERS, and it is stronger than "the fields
 * survive". A round-trip that dropped one evidence field would produce a record
 * that LOOKS right and is a different record — `assertionId` would still match
 * (it hashes the triple), so the two would reconcile onto each other and the
 * one that never left memory would silently win or lose depending on write
 * order. That is a split-brain across a restart, which is the one failure mode
 * a durable store exists to prevent.
 *
 * So the test asserts `contentHash(fromDurable(toDurable(r))) === contentHash(r)`
 * over every status — a fingerprint over the WHOLE record rather than a
 * field-by-field comparison, because a field-by-field check has to be extended
 * by hand the day the record grows a field and a hash does not.
 *
 * NOTHING HERE TOUCHES A DISK. `DurableKnowledgeStore` is a seam with a
 * refusing default; the file, the table or the bucket is the host's. That is
 * what keeps this inside the tree `security.test.ts` walks.
 */
import { contentHash } from "../../math/hash.ts";
import type { Provenance } from "./provenance.ts";
import type { SourceEvidence } from "./evidence.ts";
import {
  type KnowledgeRecord,
  type KnowledgeStatus,
  type Validity,
  type Volatility,
  KNOWLEDGE_STATUSES,
} from "./record.ts";

export const DURABLE_SCHEMA_VERSION = 1;

/**
 * §8's row. Every name the directive lists is present under that name; the
 * remaining `KnowledgeRecord` fields are present under theirs, because a row
 * that carried only §8's fourteen could not rebuild the record it came from.
 */
export type DurableRecord = {
  readonly schema: number;
  readonly knowledge_id: string;
  /** §8 "concept" — the assertion's subject. */
  readonly concept: string;
  /** §8 "claim" — what is asserted of the concept. */
  readonly claim: { readonly predicate: string; readonly object: unknown };
  readonly evidence: readonly SourceEvidence[];
  readonly provenance: Provenance;
  /** §8 "source" — the registered source ids this rests on. */
  readonly source: readonly string[];
  /**
   * §8 "source_version" — the versions actually read, deduped and sorted. The
   * per-evidence versions stay in `evidence`; this is the row-level answer to
   * "which revision of the world is this claim about", and `null` when no
   * evidence carried one rather than a guess.
   */
  readonly source_version: readonly string[];
  readonly confidence: number;
  readonly verification_status: KnowledgeStatus;
  readonly created_at: string;
  readonly updated_at: string;
  /** When the underlying thing was last seen to be true. May be null. */
  readonly observed_at: string | null;
  /** The record this one replaced. §8's inverse of `superseded_by`. */
  readonly supersedes: string | null;
  readonly superseded_by: string | null;

  // --- the rest of the record, so the round trip is lossless ---------------
  readonly domain: readonly string[];
  readonly volatility: Volatility;
  readonly validity: Validity;
  readonly version: number;
  readonly derived_from: readonly string[];
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
};

export type DurableMeta = {
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set when this row replaced an earlier version of the same assertion. */
  readonly supersedes?: string | null;
};

export function toDurable(r: KnowledgeRecord, meta: DurableMeta): DurableRecord {
  const versions = [
    ...new Set(
      r.evidence
        .map((e) => e.sourceVersion)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  ].sort();
  return {
    schema: DURABLE_SCHEMA_VERSION,
    knowledge_id: r.id,
    concept: r.subject,
    claim: { predicate: r.predicate, object: r.object },
    evidence: r.evidence,
    provenance: r.provenance,
    source: r.sourceIds,
    source_version: versions,
    confidence: r.confidence,
    verification_status: r.status,
    created_at: meta.createdAt,
    updated_at: meta.updatedAt,
    observed_at: r.validity.lastVerifiedAt,
    supersedes: meta.supersedes ?? null,
    superseded_by: r.supersededBy,
    domain: r.domain,
    volatility: r.volatility,
    validity: r.validity,
    version: r.version,
    derived_from: r.derivedFrom,
    supports: r.supports,
    contradicts: r.contradicts,
  };
}

export function fromDurable(row: DurableRecord): KnowledgeRecord {
  return {
    id: row.knowledge_id,
    subject: row.concept,
    predicate: row.claim.predicate,
    object: row.claim.object,
    domain: row.domain,
    sourceIds: row.source,
    evidence: row.evidence,
    confidence: row.confidence,
    status: row.verification_status,
    volatility: row.volatility,
    validity: row.validity,
    version: row.version,
    derivedFrom: row.derived_from,
    supports: row.supports,
    contradicts: row.contradicts,
    supersededBy: row.superseded_by,
    provenance: row.provenance,
  };
}

/**
 * A REFUSED ROW IS NOT AN EMPTY STORE, which is the same union this repository
 * now uses in four places. A store that could only hand back an array would
 * express "nothing has been learned yet" and "the file is unreadable" the same
 * way — and the second, read as the first, is a runtime that silently starts
 * from nothing every morning and never says so.
 */
export type DurableLoad =
  | { readonly ok: true; readonly rows: readonly DurableRecord[] }
  | { readonly ok: false; readonly reason: string };

export type DurableSave =
  { readonly ok: true; readonly written: number } | { readonly ok: false; readonly reason: string };

export type DurableKnowledgeStore = {
  readonly load: () => Promise<DurableLoad>;
  /** Upsert by `knowledge_id` + `version`. Returns what it DURABLY wrote. */
  readonly save: (rows: readonly DurableRecord[]) => Promise<DurableSave>;
};

/**
 * Stores nothing and SAYS SO — `NO_CHECKPOINTS` and `consolidate` carry the
 * same rule. A no-op that resolved `{ok: true, written: n}` would let every
 * later reader believe ONIQ remembers something it does not, which is the
 * precise claim v1.5 had to report as false.
 */
export const NO_DURABLE_STORE: DurableKnowledgeStore = {
  load: async () => ({ ok: false, reason: "no durable knowledge store is wired to this runtime" }),
  save: async () => ({
    ok: false,
    reason: "no durable knowledge store is wired to this runtime",
  }),
};

/** Reject a row this build cannot read rather than migrating it by guess. */
export type DurableProblem = { readonly code: string; readonly detail: string };

export function validateDurable(row: DurableRecord): readonly DurableProblem[] {
  const problems: DurableProblem[] = [];
  if (row.schema !== DURABLE_SCHEMA_VERSION) {
    problems.push({
      code: "schema_mismatch",
      detail: `${row.schema} != ${DURABLE_SCHEMA_VERSION}`,
    });
  }
  if (!row.knowledge_id) problems.push({ code: "missing_id", detail: "knowledge_id is empty" });
  if (!KNOWLEDGE_STATUSES.includes(row.verification_status)) {
    problems.push({ code: "unknown_status", detail: String(row.verification_status) });
  }
  // §9's rule, enforced at the boundary rather than trusted: a claim with no
  // evidence is not a claim ONIQ may later read back as knowledge.
  if (row.evidence.length === 0 && row.verification_status === "VERIFIED") {
    problems.push({ code: "verified_without_evidence", detail: row.knowledge_id });
  }
  for (const e of row.evidence) {
    if (!e.locator) problems.push({ code: "evidence_without_locator", detail: e.id });
  }
  return problems;
}

/**
 * A CONTENT FINGERPRINT OVER WHAT WAS PERSISTED, used to answer "did this row
 * change" without diffing two objects by hand. Deliberately excludes
 * `created_at` / `updated_at`: those move on every write, and a fingerprint
 * that moved with them could never say a re-persisted row was unchanged.
 */
export function durableFingerprint(row: DurableRecord): string {
  const { created_at: _c, updated_at: _u, ...rest } = row;
  return contentHash(rest);
}

/**
 * WHAT A LOAD ACTUALLY GAVE ONIQ, counted honestly. `rejected` is separate from
 * `rows` because a store that dropped unreadable rows silently would shrink
 * across a version change with nothing anywhere saying it had.
 */
export type Hydration = {
  readonly records: readonly KnowledgeRecord[];
  readonly rejected: readonly {
    readonly id: string;
    readonly problems: readonly DurableProblem[];
  }[];
  readonly loaded: number;
  readonly reason: string | null;
};

export function hydrate(load: DurableLoad): Hydration {
  if (!load.ok) return { records: [], rejected: [], loaded: 0, reason: load.reason };
  const records: KnowledgeRecord[] = [];
  const rejected: { id: string; problems: readonly DurableProblem[] }[] = [];
  for (const row of load.rows) {
    const problems = validateDurable(row);
    if (problems.length > 0) rejected.push({ id: row.knowledge_id, problems });
    else records.push(fromDurable(row));
  }
  return { records, rejected, loaded: load.rows.length, reason: null };
}
