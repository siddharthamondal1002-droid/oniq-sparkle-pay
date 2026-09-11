/**
 * OQCA v1.7 — WHAT ONIQ CAN SEE OF ITSELF, and the three answers it may give.
 *
 * Owner directive 2026-09-11, §3: _"Do not treat 'no observation' as
 * 'healthy.' Use OBSERVED / UNOBSERVED / UNKNOWN as distinct states."_
 *
 * THAT SENTENCE IS THE WHOLE FILE, AND IT IS THE SAME RULE THIS REPOSITORY HAS
 * ALREADY PAID FOR THREE TIMES. `ResearchResult` is a union so that "I looked
 * and found nothing" cannot be spelled the same way as "I could not look";
 * `SurveyResult` copies it; v1.5's `idle` / `blind` / `stalled` split exists
 * because an all-blocked backlog reported "nothing left to learn". An observer
 * that returned an array would collapse all three again — and here the
 * collapse is worse than anywhere else, because an empty array of FAILURES
 * reads as a system in perfect health. A runtime that concludes "no problems
 * observed, therefore nothing to improve" has stopped being an improvement
 * loop and become a reassurance machine.
 *
 *   OBSERVED    ONIQ looked, and this is what it read. Carries a locator.
 *   UNOBSERVED  ONIQ did not look. No capability, not wired, not run.
 *   UNKNOWN     ONIQ looked and could not tell. The probe ran and refused.
 *
 * The difference between the last two is not pedantic: UNOBSERVED names a
 * capability somebody can go and connect, and UNKNOWN names a measurement that
 * needs designing. They earn different objectives, so they are different values.
 *
 * NOTHING HERE READS A CLOCK, A DISK OR A SOCKET. The observer is an argument
 * with a refusing default — the shape `Engine`, `ToolRouter` and `Survey`
 * already have — so `security.test.ts` still walks this tree and still finds no
 * way out of it. The implementations live in the runtime and the host.
 */
import { contentHash } from "../math/hash.ts";

/**
 * THE THREE ANSWERS. `healthy` is deliberately not among them: a system state
 * is a conclusion drawn FROM observations, never one of them, and offering it
 * here is how an observer starts asserting the thing it is supposed to measure.
 */
export type ObservationState = "OBSERVED" | "UNOBSERVED" | "UNKNOWN";

export const OBSERVATION_STATES: readonly ObservationState[] = [
  "OBSERVED",
  "UNOBSERVED",
  "UNKNOWN",
];

/**
 * WHAT ONIQ TRIES TO SEE ABOUT ITSELF — the directive's §3 list, closed.
 *
 * A CLOSED LIST IS WHAT MAKES "UNOBSERVED" COMPUTABLE. With an open set of
 * kinds, an observer that reported two things would look complete, because
 * there would be nothing to say the other fifteen were never attempted. The
 * list is the denominator; `completeObservations` is the division.
 */
export type ObservationKind =
  | "test_health"
  | "mutation_coverage"
  | "runtime_failure"
  | "unreachable_path"
  | "blocked_capability"
  | "knowledge_gap"
  | "stale_knowledge"
  | "provider_failure"
  | "latency"
  | "error_rate"
  | "generation_failure"
  | "motion_failure"
  | "story_continuity"
  | "unused_capability"
  | "dead_branch"
  | "configuration_mismatch"
  | "missing_validation"
  | "missing_telemetry"
  | "resource_availability";

export const OBSERVATION_KINDS: readonly ObservationKind[] = [
  "test_health",
  "mutation_coverage",
  "runtime_failure",
  "unreachable_path",
  "blocked_capability",
  "knowledge_gap",
  "stale_knowledge",
  "provider_failure",
  "latency",
  "error_rate",
  "generation_failure",
  "motion_failure",
  "story_continuity",
  "unused_capability",
  "dead_branch",
  "configuration_mismatch",
  "missing_validation",
  "missing_telemetry",
  "resource_availability",
];

/**
 * WHERE AN OBSERVATION CAME FROM. §4: _"Every important claim must carry
 * provenance."_
 *
 * The field names are `SourceEvidence`'s on purpose — an observation that is
 * promoted into durable knowledge has to carry a locator, a source version and
 * a content hash into `makeEvidence`, and a second vocabulary here would mean a
 * translation layer where a field can be quietly dropped.
 */
export type ObservationProvenance = {
  /** A file path, a command, a table. Never invented, never a description. */
  readonly locator: string;
  /** The commit, the package version, the config revision. Null when unknown. */
  readonly sourceVersion: string | null;
  /** An integrity handle over what was read. Null rather than fabricated. */
  readonly contentHash: string | null;
  /** What produced this reading — a function name, a capability id. */
  readonly agent: string;
  /** ISO 8601. AUDIT ONLY: never enters an id, so a replay is stable. */
  readonly at: string;
};

export type Observation = {
  /** Deterministic from (kind, subject, state, value, detail). */
  readonly id: string;
  readonly kind: ObservationKind;
  /** What this is about — a module path, a capability id, a metric name. */
  readonly subject: string;
  readonly state: ObservationState;
  /**
   * The measured quantity when there is one. NULL is not zero: a latency of
   * `null` means nothing was timed, and a loop that read it as 0 ms would
   * report the fastest system it has ever seen.
   */
  readonly value: number | null;
  /** What was read, in the words a person would want. Never a code alone. */
  readonly detail: string;
  /**
   * 0 = nothing to do about it, 1 = the worst thing ONIQ can currently see.
   * DERIVED BY THE OBSERVER FROM WHAT IT READ, never a constant per kind —
   * a severity table indexed by kind would make every objective's rank a fact
   * about this file rather than about the system.
   */
  readonly severity: number;
  readonly provenance: ObservationProvenance | null;
  /**
   * WHICH REGISTERED CAPABILITIES ACTING ON THIS WOULD CALL. Declared by the
   * OBSERVER, because only the side that knows how a fault is investigated
   * knows what investigating it costs — and a lookup table in the planner would
   * be one more place for "what this needs" to drift from what it actually
   * calls. Empty means the work is pure reasoning over what is already held.
   */
  readonly requires: readonly string[];
};

export type ObservationResult =
  | { readonly ok: true; readonly observations: readonly Observation[] }
  | { readonly ok: false; readonly reason: string };

/**
 * NO CLOCK IS PASSED IN, and that is why the observer closes over the host's.
 * An `at` field here would put a timestamp in the kernel's hands one argument
 * away from a hashed record — `transition.ts` records what that costs — and the
 * observer already needs the host's clock to stamp its own provenance.
 */
export type ObservationContext = {
  readonly episode: number;
  readonly step: number;
};

export type SystemObserver = (ctx: ObservationContext) => Promise<ObservationResult>;

/**
 * Refuses, and says why. It does NOT answer "nothing is wrong".
 *
 * The refusal is the honest default for a runtime nobody has connected to a
 * system yet, and it is what `completeObservations` turns into nineteen
 * UNOBSERVED rows rather than into silence.
 */
export const NO_OBSERVER: SystemObserver = async () => ({
  ok: false,
  reason: "no system observer is wired to this runtime",
});

export function observationId(
  kind: ObservationKind,
  subject: string,
  state: ObservationState,
  value: number | null,
  detail: string,
): string {
  return contentHash({ kind, subject, state, value, detail });
}

/** Clamp into [0, 1] without pretending a NaN is a number. */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function observed(
  kind: ObservationKind,
  subject: string,
  opts: {
    readonly value?: number | null;
    readonly detail: string;
    readonly severity: number;
    readonly provenance: ObservationProvenance;
    readonly requires?: readonly string[];
  },
): Observation {
  const value = opts.value ?? null;
  return {
    id: observationId(kind, subject, "OBSERVED", value, opts.detail),
    kind,
    subject,
    state: "OBSERVED",
    value,
    detail: opts.detail,
    severity: clamp01(opts.severity),
    provenance: opts.provenance,
    requires: opts.requires ?? [],
  };
}

/**
 * ONIQ DID NOT LOOK. Carries no provenance because there is nothing to cite,
 * and no value because there is nothing to report — a zero here is the exact
 * fabrication §3 forbids.
 *
 * SEVERITY IS NOT ZERO. An unobserved kind is a hole in ONIQ's self-knowledge,
 * and a hole ranks: `UNOBSERVED_SEVERITY` is what makes "connect an observer
 * for X" a generatable objective rather than a thing only a person could think
 * of. It sits BELOW a real observed failure, because a measured fault is worth
 * more than an unmeasured one, and above nothing.
 */
export const UNOBSERVED_SEVERITY = 0.3;
export const UNKNOWN_SEVERITY = 0.45;

export function unobserved(
  kind: ObservationKind,
  subject: string,
  why: string,
  requires: readonly string[] = [],
): Observation {
  return {
    id: observationId(kind, subject, "UNOBSERVED", null, why),
    kind,
    subject,
    state: "UNOBSERVED",
    value: null,
    detail: why,
    severity: UNOBSERVED_SEVERITY,
    provenance: null,
    requires,
  };
}

/**
 * ONIQ LOOKED AND COULD NOT TELL. It ranks ABOVE `UNOBSERVED` because a probe
 * that ran and refused has already cost something and still answered nothing —
 * that is a measurement design problem, which is a harder thing to be left
 * with than an unconnected capability.
 */
export function unknown(
  kind: ObservationKind,
  subject: string,
  why: string,
  provenance: ObservationProvenance | null = null,
  requires: readonly string[] = [],
): Observation {
  return {
    id: observationId(kind, subject, "UNKNOWN", null, why),
    kind,
    subject,
    state: "UNKNOWN",
    value: null,
    detail: why,
    severity: UNKNOWN_SEVERITY,
    provenance,
    requires,
  };
}

/**
 * EVERY KIND GETS A ROW, WHETHER OR NOT THE OBSERVER MENTIONED IT.
 *
 * This is the function that makes §3 enforceable rather than aspirational. An
 * observer reporting three findings hands back three rows; without this, the
 * other sixteen kinds are absent, and absent reads as fine. After it, they are
 * UNOBSERVED with a reason, they carry `UNOBSERVED_SEVERITY`, and the objective
 * generator can propose closing them.
 *
 * A REFUSED OBSERVER PRODUCES NINETEEN UNOBSERVED ROWS, not zero and not an
 * error. The runtime is still autonomous when it cannot see — it simply knows
 * that it cannot, which is a different and much more useful state than silence.
 */
export function completeObservations(
  result: ObservationResult,
  kinds: readonly ObservationKind[] = OBSERVATION_KINDS,
): readonly Observation[] {
  const reported = result.ok ? result.observations : [];
  const seen = new Set(reported.map((o) => o.kind));
  const why = result.ok
    ? "the observer ran and reported nothing for this kind"
    : `the observer refused: ${result.reason}`;
  const filled = kinds.filter((k) => !seen.has(k)).map((k) => unobserved(k, k, why));
  return [...reported, ...filled];
}

/**
 * WHETHER ONIQ MAY CALL ITSELF HEALTHY, and the answer is usually "it may not".
 *
 * A tri-state, for the same reason the observations are: a system with one
 * unobserved kind is NOT healthy and is not unhealthy either — it is a system
 * nobody has finished looking at, and saying either would be a claim the
 * evidence does not carry. `degraded` is the only conclusion this function ever
 * asserts, and it asserts it only from a row that was actually OBSERVED.
 */
export type SystemHealth = "degraded" | "insufficient_evidence" | "no_fault_observed";

/** At or above this, an observed reading is a fault rather than a reading. */
export const FAULT_SEVERITY = 0.5;

export function systemHealth(observations: readonly Observation[]): SystemHealth {
  const faults = observations.filter((o) => o.state === "OBSERVED" && o.severity >= FAULT_SEVERITY);
  if (faults.length > 0) return "degraded";
  const blind = observations.filter((o) => o.state !== "OBSERVED");
  if (blind.length > 0) return "insufficient_evidence";
  return "no_fault_observed";
}

/** Observations that name something worth doing, most severe first. */
export function actionable(observations: readonly Observation[]): Observation[] {
  return [...observations]
    .filter((o) => o.severity > 0)
    .sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
}

/** How much of ONIQ's own instrument panel is actually connected, in [0, 1]. */
export function observationCoverage(observations: readonly Observation[]): number {
  if (observations.length === 0) return 0;
  const kinds = new Map<ObservationKind, boolean>();
  for (const o of observations) {
    kinds.set(o.kind, (kinds.get(o.kind) ?? false) || o.state === "OBSERVED");
  }
  const looked = [...kinds.values()].filter(Boolean).length;
  return kinds.size === 0 ? 0 : looked / kinds.size;
}
