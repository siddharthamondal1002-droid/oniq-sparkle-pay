/**
 * THE TEN §18 METRICS, COMPUTED.
 *
 * The spec's §18 is a table of ten names and meanings. A table is not a
 * measurement, and the failure this repo has the most receipts for is a check
 * that was described and never ran — so every row here is a function over a
 * real store, and `metrics.test.ts` drives each one to a value that is NOT its
 * trivial answer. A metric that has only ever read 0, or only ever read 1, has
 * never been tested (`untouched_drift`, v1.1, third time).
 *
 * FOUR OF THE TEN NEED A LABELLED SET AND THE OTHER SIX DO NOT, and conflating
 * them is how a dashboard comes to show ten green numbers of which four are
 * fabricated. Precision, recall, resolution accuracy and false-promotion rate
 * are all "against ground truth"; without a labelled benchmark they are
 * UNKNOWN, and this module returns `null` for them rather than a number. §21:
 * "Do not confuse confidence with truth."
 */
import type { KnowledgeRecord } from "./record.ts";
import type { KnowledgeStore } from "./store.ts";
import type { ConflictRecord } from "./conflict.ts";
import { hasCompleteProvenance } from "./record.ts";
import { stalenessRate as decayStalenessRate } from "./decay.ts";

/**
 * A labelled example. Supplying one is the ONLY way the ground-truth metrics
 * return a number, which is the point: they are unknown until someone labels
 * something.
 */
export type LabelledClaim = {
  readonly recordId: string;
  readonly correct: boolean;
};

export type LabelledConflict = {
  readonly conflictId: string;
  /** The record id a human says should win. */
  readonly canonical: string;
};

export type MetricSet = {
  /** null means UNMEASURED, and is never rendered as 0. */
  readonly knowledgePrecision: number | null;
  readonly knowledgeRecall: number | null;
  readonly contradictionRate: number;
  readonly resolutionAccuracy: number | null;
  readonly provenanceCoverage: number;
  readonly stalenessRate: number;
  readonly upgradeGain: number | null;
  readonly rollbackIntegrity: number;
  readonly retrievalGrounding: number;
  readonly falsePromotionRate: number | null;
};

const promoted = (rs: readonly KnowledgeRecord[]) =>
  rs.filter((r) => r.status === "VERIFIED" || r.status === "CONTESTED");

/** Fraction of promoted assertions a labeller judged correct. */
export function knowledgePrecision(
  store: KnowledgeStore,
  labels: readonly LabelledClaim[],
): number | null {
  const ids = new Set(promoted(store.all()).map((r) => r.id));
  const scored = labels.filter((l) => ids.has(l.recordId));
  if (scored.length === 0) return null;
  return scored.filter((l) => l.correct).length / scored.length;
}

/**
 * Of the claims a labeller says are true, how many did ONIQ actually promote.
 * The DENOMINATOR is every true label, including ones the store never held —
 * a recall that only counted records present would be a precision in disguise.
 */
export function knowledgeRecall(
  store: KnowledgeStore,
  labels: readonly LabelledClaim[],
): number | null {
  const trueLabels = labels.filter((l) => l.correct);
  if (trueLabels.length === 0) return null;
  const ids = new Set(promoted(store.all()).map((r) => r.id));
  return trueLabels.filter((l) => ids.has(l.recordId)).length / trueLabels.length;
}

/** Conflicting assertions per 1,000 promoted assertions. */
export function contradictionRate(
  store: KnowledgeStore,
  conflicts: readonly ConflictRecord[],
): number {
  const n = promoted(store.all()).length;
  if (n === 0) return 0;
  return (conflicts.length / n) * 1000;
}

/** Correct canonical selection on labelled conflicts. */
export function resolutionAccuracy(
  resolved: readonly ConflictRecord[],
  labels: readonly LabelledConflict[],
): number | null {
  const byId = new Map(resolved.map((c) => [c.id, c]));
  const scored = labels.filter((l) => byId.has(l.conflictId));
  if (scored.length === 0) return null;
  // AN ESCALATED CONFLICT IS NOT A WRONG ANSWER, it is a refusal to guess —
  // scoring it as wrong would push the resolver towards guessing, which is
  // exactly backwards. It is excluded from the denominator and counted
  // separately by `escalationRate`.
  const decided = scored.filter((l) => !byId.get(l.conflictId)?.escalated);
  if (decided.length === 0) return null;
  return (
    decided.filter((l) => byId.get(l.conflictId)?.canonical === l.canonical).length / decided.length
  );
}

/** Conflicts sent to a human rather than decided. Reported beside accuracy. */
export function escalationRate(resolved: readonly ConflictRecord[]): number {
  if (resolved.length === 0) return 0;
  return resolved.filter((c) => c.escalated).length / resolved.length;
}

/** Percent (as a fraction) of records with a complete §9 chain. */
export function provenanceCoverage(store: KnowledgeStore): number {
  const all = store.all();
  if (all.length === 0) return 1;
  return all.filter(hasCompleteProvenance).length / all.length;
}

/**
 * Active knowledge past its verification interval.
 *
 * DELEGATES TO `decay.ts` RATHER THAN RE-DERIVING IT. The first version
 * recomputed "promoted, then stale" here, which is the same rule written
 * twice — and the health work has the receipt for what that costs
 * (`status.aiAvailable` re-deriving half a gate and telling people a feature
 * was available that every call refused). One rule, one place; this function
 * exists only to take a store where `decay.ts` takes rows.
 */
export function stalenessRate(store: KnowledgeStore, nowMs: number): number {
  return decayStalenessRate(store.all(), nowMs);
}

/**
 * §17's knowledge-upgrade benchmark: "initial answer -> new evidence ->
 * corrected answer, with measurable improvement". The CALLER supplies both
 * scores, because only a task knows what its own score means — a module that
 * invented a scoring function here would be measuring itself.
 */
export function upgradeGain(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return after - before;
}

/**
 * "Percent of historical states reproducibly restored." Replays the journal
 * prefix by prefix and checks each one reproduces on a second call.
 *
 * THIS IS THE ONE THAT WOULD BE EASY TO FAKE by returning 1, so it compares
 * two INDEPENDENT replays of each prefix rather than a replay against the live
 * map — a store that ignored its journal and returned the current state every
 * time would score 1 on the lazy version and fail on this one, because the
 * prefix lengths differ.
 */
export function rollbackIntegrity(store: KnowledgeStore): number {
  const journal = store.journal();
  const n = journal.length;
  if (n === 0) return 1;
  let ok = 0;
  for (let i = 1; i <= n; i++) {
    const a = store.replayTo(i);
    const b = store.replayTo(i);
    const reproducible =
      a.length === b.length && a.every((r, j) => r.id === b[j].id && r.status === b[j].status);
    // THE EXPECTED CONTENT COMES FROM THE JOURNAL, NOT FROM ANOTHER REPLAY.
    // The first version compared the prefix against `replayTo(n)` and asked
    // only that it be no longer — which a stub returning the current state on
    // every call satisfies at every prefix, so the metric could not detect a
    // store that ignored its journal at all. Measured: such a stub scored 1.
    //
    // The journal is data the store hands over rather than a computation it
    // performs, so deriving the expected id set from it is the one check a
    // dishonest replay cannot pass.
    const expected = new Set(journal.slice(0, i).map((op) => op.record.id));
    const got = new Set(a.map((r) => r.id));
    const matches = expected.size === got.size && [...expected].every((id) => got.has(id));
    if (reproducible && matches) ok += 1;
  }
  return ok / n;
}

/**
 * "Answer claims supported by retrieved verified evidence." Each answer names
 * the record ids it leaned on; an id that is not VERIFIED (or not present) is
 * ungrounded.
 */
export function retrievalGrounding(store: KnowledgeStore, citedIds: readonly string[]): number {
  if (citedIds.length === 0) return 1;
  const verified = new Set(store.byStatus("VERIFIED").map((r) => r.id));
  return citedIds.filter((id) => verified.has(id)).length / citedIds.length;
}

/** Promoted claims a labeller says are wrong. The inverse of precision. */
export function falsePromotionRate(
  store: KnowledgeStore,
  labels: readonly LabelledClaim[],
): number | null {
  const p = knowledgePrecision(store, labels);
  return p === null ? null : 1 - p;
}

export type MetricInputs = {
  readonly nowMs: number;
  readonly conflicts?: readonly ConflictRecord[];
  readonly labels?: readonly LabelledClaim[];
  readonly conflictLabels?: readonly LabelledConflict[];
  readonly citedIds?: readonly string[];
  readonly taskScoreBefore?: number | null;
  readonly taskScoreAfter?: number | null;
};

export function computeMetrics(store: KnowledgeStore, i: MetricInputs): MetricSet {
  const conflicts = i.conflicts ?? [];
  const labels = i.labels ?? [];
  return {
    knowledgePrecision: knowledgePrecision(store, labels),
    knowledgeRecall: knowledgeRecall(store, labels),
    contradictionRate: contradictionRate(store, conflicts),
    resolutionAccuracy: resolutionAccuracy(conflicts, i.conflictLabels ?? []),
    provenanceCoverage: provenanceCoverage(store),
    stalenessRate: stalenessRate(store, i.nowMs),
    upgradeGain: upgradeGain(i.taskScoreBefore ?? null, i.taskScoreAfter ?? null),
    rollbackIntegrity: rollbackIntegrity(store),
    retrievalGrounding: retrievalGrounding(store, i.citedIds ?? []),
    falsePromotionRate: falsePromotionRate(store, labels),
  };
}

/** Which metrics are UNKNOWN in this run, so a report cannot quietly omit them. */
export function unmeasured(m: MetricSet): readonly string[] {
  return (Object.keys(m) as (keyof MetricSet)[]).filter((k) => m[k] === null);
}
