/**
 * CONFLICT DETECTION AND RECONCILIATION — spec §8.
 *
 * **"never silently overwrite an assertion. Preserve the competing assertions,
 * create a ConflictRecord, select or escalate a canonical value, and record the
 * resolution rationale."**
 *
 * That sentence has four obligations and this module is built so that none of
 * them can be skipped by a caller in a hurry: `resolveConflict` RETURNS the
 * conflict record, it never deletes a side, the winner is `null` when no
 * strategy could choose, and the rationale is a required field rather than an
 * optional note.
 *
 * §23 of the quantum brief says the same thing from the other end: "Where two
 * libraries disagree, preserve both implementations and explicitly record the
 * difference. Never silently normalize conflicting semantics."
 */
import type { KnowledgeRecord } from "./record.ts";
import type { RegisteredSource } from "./evidence.ts";
import { evidenceWeight } from "./evidence.ts";

/**
 * WHAT MAKES TWO RECORDS RIVALS. Same subject and predicate, different object —
 * that is the only shape this module treats as a conflict, and the narrowness
 * is deliberate. Two records with the same id are a SUPERSESSION (`record.ts`);
 * two records about different subjects are simply two records.
 */
export function conflicts(a: KnowledgeRecord, b: KnowledgeRecord): boolean {
  if (a.id === b.id) return false;
  if (a.subject !== b.subject || a.predicate !== b.predicate) return false;
  return JSON.stringify(a.object) !== JSON.stringify(b.object);
}

/**
 * SEMANTIC DIVERGENCE IS NOT A CONFLICT TO RESOLVE — it is a fact to record.
 *
 * The quantum brief's §23 is the case that forced this distinction: when Qiskit
 * and Cirq genuinely define a gate convention differently, neither is wrong and
 * picking one would be the "silent normalisation" the brief bans. Such a pair
 * is marked `divergent_by_design` and BOTH stay VERIFIED, scoped by domain.
 */
export type ConflictKind =
  "value_disagreement" | "divergent_by_design" | "temporal_supersession" | "unit_mismatch";

export type ResolutionStrategy =
  | "experimental_precedence"
  | "measured_precedence"
  | "evidence_weight"
  | "most_recent"
  | "source_reliability"
  | "majority"
  | "escalate";

export const RESOLUTION_STRATEGIES: readonly ResolutionStrategy[] = [
  "experimental_precedence",
  "measured_precedence",
  "evidence_weight",
  "most_recent",
  "source_reliability",
  "majority",
  "escalate",
];

export type ConflictRecord = {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly kind: ConflictKind;
  /** EVERY competing record id. Nothing is dropped, ever. */
  readonly competing: readonly string[];
  /** The chosen record id, or null when no strategy could choose. */
  readonly canonical: string | null;
  readonly strategy: ResolutionStrategy;
  /** Required. A resolution with no stated reason is an overwrite. */
  readonly rationale: string;
  readonly escalated: boolean;
};

export type ResolutionContext = {
  readonly sources: ReadonlyMap<string, RegisteredSource>;
  /** Milliseconds. Injected — the kernel may not read a clock. */
  readonly nowMs: number;
  /**
   * How much better one side must be before it wins outright. Without a margin,
   * two effectively-equal records resolve on floating-point noise, and v1.1
   * already measured what that produces: a confident answer that is really a
   * fact about ordering.
   */
  readonly margin?: number;
};

export const DEFAULT_MARGIN = 0.15;

/**
 * Does this record rest on an experiment ONIQ actually ran? `evidence.ts`'s
 * `experimentally_verified` rung is defined by exactly this: a discriminating
 * procedure with a control, executed, and its outcome read.
 */
export function hasExperimentalSupport(r: KnowledgeRecord): boolean {
  return r.evidence.some((e) => e.supports && e.directness === "experimentally_verified");
}

/**
 * Did ONIQ observe the SUBJECT SYSTEM itself, rather than read a document about
 * it? `SOURCE_TYPES` keeps those apart: `measurement` is an observation, and
 * every other value names an artefact somebody else wrote.
 */
export function hasMeasuredSupport(r: KnowledgeRecord): boolean {
  return r.evidence.some((e) => e.supports && e.sourceType === "measurement");
}

function totalWeight(r: KnowledgeRecord, ctx: ResolutionContext): number {
  return r.evidence
    .filter((e) => e.supports)
    .reduce((sum, e) => sum + evidenceWeight(e, ctx.sources.get(e.sourceId) ?? null), 0);
}

function newest(r: KnowledgeRecord): number {
  return r.evidence.reduce((max, e) => {
    const t = Date.parse(e.retrievedAt);
    return Number.isFinite(t) && t > max ? t : max;
  }, -Infinity);
}

/**
 * The strategies, tried in a FIXED order, and the order is the argument:
 * evidence first, recency last. Preferring recency would mean the newest source
 * always wins — which is how a single bad scrape overwrites a well-sourced
 * fact, and is precisely the failure §8 exists to prevent.
 *
 * A CONFLICT THAT CANNOT BE DECIDED IS ESCALATED, NOT GUESSED. `canonical: null`
 * with `escalated: true` is a legitimate, final outcome: both records then stay
 * CONTESTED, which §7 says may still inform conflict-aware reasoning.
 */
export function resolveConflict(
  competing: readonly KnowledgeRecord[],
  ctx: ResolutionContext,
  kind: ConflictKind = "value_disagreement",
): ConflictRecord {
  if (competing.length < 2) throw new Error("OKS conflict: needs at least two records");
  const subject = competing[0].subject;
  const predicate = competing[0].predicate;
  const id = `cf_${subject}|${predicate}`;
  const ids = [...competing].map((r) => r.id).sort();
  const margin = ctx.margin ?? DEFAULT_MARGIN;

  const base = { id, subject, predicate, kind, competing: ids } as const;

  // DIVERGENT BY DESIGN IS NOT RESOLVED AT ALL. Choosing between two correct
  // conventions would delete a true fact about one of them.
  if (kind === "divergent_by_design") {
    return {
      ...base,
      canonical: null,
      strategy: "escalate",
      rationale:
        "sources genuinely differ by design; both are kept and scoped by domain rather than reconciled",
      escalated: false,
    };
  }

  /* ------------------------------------------------------------------ *
   * v1.4-R: A MEASUREMENT OF A SYSTEM BEATS A DOCUMENT ABOUT THAT SYSTEM.
   *
   * This is what makes `experimentally_verified` a rung rather than a label.
   * On weight alone an experiment and a fetched page tie at 1.0, the default
   * margin is not met, and the tie falls through to RECENCY — so whichever was
   * retrieved last would win, and a stale page could overturn a measurement
   * ONIQ took this second. That is the wrong answer for the one case the rung
   * exists for.
   *
   * IT IS NARROW BY CONSTRUCTION, and the narrowness is what keeps it honest:
   *
   *   - `conflicts()` already requires the SAME SUBJECT, so an experiment on
   *     ONIQ's simulator can never overrule Qiskit's documentation about
   *     Qiskit. Different systems are different subjects and never rivals.
   *   - `divergent_by_design` is returned ABOVE this, so §23's "never silently
   *     normalize conflicting semantics" is untouched: two correct conventions
   *     are still both kept, experiment or no experiment.
   *   - EXACTLY ONE side may carry experimental support. Two experiments
   *     disagreeing about the same subject is a real finding and not something
   *     precedence should paper over; it falls through to weight and, failing
   *     that, to escalation, which is where a person belongs.
   * ------------------------------------------------------------------ */
  const experimental = competing.filter(hasExperimentalSupport);
  if (experimental.length === 1) {
    return {
      ...base,
      canonical: experimental[0].id,
      strategy: "experimental_precedence",
      rationale:
        "one side rests on a discriminating experiment ONIQ ran against this very subject; " +
        "a measurement of a system outranks a document about it",
      escalated: false,
    };
  }

  /* ------------------------------------------------------------------ *
   * AND AN OBSERVATION OF THE SYSTEM BEATS A VOTE OF DOCUMENTS ABOUT IT.
   *
   * FOUND BY RUNNING IT, not by reading it. `evidence_weight` is ADDITIVE, so
   * two agreeing release notes (2 x 0.8 = 1.600) out-weigh one reading of the
   * deployed constant (1 x 0.95 = 0.950) — and the substrate would have adopted
   * a stale document's number over the value it had just read out of the
   * running module, with a rationale that looked entirely reasonable. Nothing
   * in the substrate said so until a knowledge-upgrade fixture put the two side
   * by side.
   *
   * Corroboration genuinely counts, and for a claim about the WORLD more
   * sources is more evidence. For a claim about a system ONIQ can OBSERVE it is
   * the wrong question: the system is the authority on itself, and a document
   * describing it is second-hand however many copies exist. So the rule is
   * narrow in exactly that way — it fires only when one side rests on a
   * `measurement` and NO rival does.
   *
   * `experimental_precedence` is checked first and stays the stronger claim: an
   * experiment is a measurement with a control and pre-registered predictions,
   * which is a measurement that could have come out otherwise. Two measurements
   * disagreeing about the same subject fall through to weight and then to
   * escalation, where a person belongs.
   * ------------------------------------------------------------------ */
  const measured = competing.filter(hasMeasuredSupport);
  if (measured.length === 1) {
    return {
      ...base,
      canonical: measured[0].id,
      strategy: "measured_precedence",
      rationale:
        "one side rests on a direct observation of the subject system and every rival on " +
        "documents about it; an observation is not out-voted by descriptions",
      escalated: false,
    };
  }

  const scored = competing
    .map((r) => ({ r, w: totalWeight(r, ctx) }))
    .sort((a, b) => b.w - a.w || a.r.id.localeCompare(b.r.id));
  const [top, second] = scored;
  if (top.w > 0 && top.w - second.w >= margin) {
    return {
      ...base,
      canonical: top.r.id,
      strategy: "evidence_weight",
      rationale: `evidence weight ${top.w.toFixed(3)} vs ${second.w.toFixed(3)} (margin ${margin})`,
      escalated: false,
    };
  }

  // Only once evidence has genuinely tied does recency get a say — and only
  // when one side is strictly newer AND carries some real evidence.
  const byTime = [...competing]
    .map((r) => ({ r, t: newest(r) }))
    .sort((a, b) => b.t - a.t || a.r.id.localeCompare(b.r.id));
  if (
    Number.isFinite(byTime[0].t) &&
    byTime[0].t > byTime[1].t &&
    totalWeight(byTime[0].r, ctx) > 0
  ) {
    return {
      ...base,
      canonical: byTime[0].r.id,
      strategy: "most_recent",
      rationale:
        "evidence weights tied within margin; the more recently retrieved record was taken",
      escalated: false,
    };
  }

  return {
    ...base,
    canonical: null,
    strategy: "escalate",
    rationale: "no strategy could separate the records; both remain CONTESTED",
    escalated: true,
  };
}

/**
 * Applying a resolution NEVER DELETES A LOSER. The losing records become
 * CONTESTED and keep their evidence, their provenance and their id — so a later
 * reader can see what was rejected and why, and a replay can reproduce it.
 */
export function applyResolution(
  competing: readonly KnowledgeRecord[],
  c: ConflictRecord,
): KnowledgeRecord[] {
  return competing.map((r) => {
    if (c.canonical === null) return { ...r, status: "CONTESTED" as const };
    if (r.id === c.canonical) return { ...r, status: "VERIFIED" as const };
    return { ...r, status: "CONTESTED" as const };
  });
}

/** Every rival pair in a set. O(n²) on purpose — the set is a subject's rows. */
export function detectConflicts(
  rs: readonly KnowledgeRecord[],
): [KnowledgeRecord, KnowledgeRecord][] {
  const out: [KnowledgeRecord, KnowledgeRecord][] = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      if (conflicts(rs[i], rs[j])) out.push([rs[i], rs[j]]);
    }
  }
  return out;
}
