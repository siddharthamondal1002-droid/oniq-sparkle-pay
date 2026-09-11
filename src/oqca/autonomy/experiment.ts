/**
 * OQCA v1.7 — AN IMPROVEMENT IS A MEASURED DELTA OR IT IS NOT AN IMPROVEMENT.
 *
 * Owner directive 2026-09-11, §13: _"An improvement is not 'the new
 * implementation looks better'. It is: baseline metric → intervention →
 * post-change metric → measured delta… If no reliable measurement exists:
 * IMPROVEMENT_UNVERIFIED. Do not promote the change as proven."_ And §11:
 * _"Never convert inconclusive evidence into success."_
 *
 * THE ONE THING THIS FILE EXISTS TO MAKE IMPOSSIBLE is a self-improving system
 * that reports improvements it never measured. That failure has a shape, and
 * this repository has met it twice already in other clothes: the health
 * extractor whose `count 0, dropped 0` read identically for "nothing proposed"
 * and "everything discarded", and v1.5's `learned` field reporting facts ONIQ
 * already knew. Both were a metric that read as progress while being a
 * restatement of the starting position. An autonomous improvement loop that
 * made the same mistake would not merely mislead a reader — it would feed its
 * own fabricated success back into the next objective's priority.
 *
 * So: `verdict` is computed from two measurements, a null measurement is
 * INCONCLUSIVE and never IMPROVED, `improvementVerified` is a separate boolean
 * from `verdict === "IMPROVED"`, and BLOCKED cannot be reached by comparison at
 * all — only by a capability refusing before anything ran.
 *
 * Pure. No clock, no disk, no network: every timestamp is passed in.
 */
import { contentHash } from "../math/hash.ts";
import type { ObservationProvenance } from "./observation.ts";

/**
 * §11's seven, and each is reachable from a different place:
 *
 *   IMPROVED / REGRESSED / NO_DIFFERENCE   two real measurements compared
 *   INCONCLUSIVE                            a measurement is missing or thin
 *   CLASSICAL_BETTER / QUANTUM_INSPIRED_    a METHOD comparison, which asks a
 *     BETTER                                different question from "is this
 *                                           better than before"
 *   BLOCKED                                 nothing ran; a capability refused
 */
export type Verdict =
  | "IMPROVED"
  | "REGRESSED"
  | "NO_DIFFERENCE"
  | "INCONCLUSIVE"
  | "CLASSICAL_BETTER"
  | "QUANTUM_INSPIRED_BETTER"
  | "BLOCKED";

export const VERDICTS: readonly Verdict[] = [
  "IMPROVED",
  "REGRESSED",
  "NO_DIFFERENCE",
  "INCONCLUSIVE",
  "CLASSICAL_BETTER",
  "QUANTUM_INSPIRED_BETTER",
  "BLOCKED",
];

/**
 * The sentence §13 asks for by name. It is a CONSTANT rather than prose at the
 * call site so that a reader grepping for it finds every place ONIQ declined to
 * claim a win — and so that a future edit softening it goes red.
 */
export const IMPROVEMENT_UNVERIFIED = "IMPROVEMENT_UNVERIFIED";

export type MetricDirection = "higher_is_better" | "lower_is_better";

export type Measurement = {
  readonly metric: string;
  /**
   * NULL MEANS NOT MEASURED, AND IT IS NOT ZERO. A loop that read a missing
   * latency as 0 ms would report the fastest system it had ever seen, and a
   * missing score as 0 would report the worst — both are inventions, and the
   * second is the one that looks like caution.
   */
  readonly value: number | null;
  readonly unit: string;
  /** How many independent readings. One reading is a reading, not a result. */
  readonly samples: number;
  readonly direction: MetricDirection;
  readonly provenance: ObservationProvenance | null;
};

export function measurement(
  metric: string,
  value: number | null,
  opts: {
    readonly unit: string;
    readonly samples: number;
    readonly direction: MetricDirection;
    readonly provenance?: ObservationProvenance | null;
  },
): Measurement {
  return {
    metric,
    value,
    unit: opts.unit,
    samples: Math.max(0, Math.floor(opts.samples)),
    direction: opts.direction,
    provenance: opts.provenance ?? null,
  };
}

/** Nothing was measured. Distinct from a measurement of zero. */
export function unmeasured(metric: string, direction: MetricDirection, why: string): Measurement {
  return { metric, value: null, unit: why, samples: 0, direction, provenance: null };
}

/**
 * "Is the candidate better than the baseline" and "which of two methods wins"
 * are different questions, and the verdict vocabulary for each is different.
 * Conflating them is how `QUANTUM_INSPIRED_BETTER` would end up meaning
 * "the second run was faster".
 */
export type ExperimentKind = "improvement" | "method_comparison";

export type SuccessCriterion = {
  /**
   * The smallest delta worth calling a change. BELOW IT THE ANSWER IS
   * `NO_DIFFERENCE`, not a small win — a loop that promoted every positive
   * float would ratchet on noise and then prioritise its own noise.
   */
  readonly minDelta: number;
  /** Below this, the answer is INCONCLUSIVE however large the delta. */
  readonly minSamples: number;
};

export type ExperimentDesign = {
  readonly id: string;
  readonly objectiveId: string;
  readonly kind: ExperimentKind;
  /** What ONIQ believes, stated so it can be wrong. */
  readonly hypothesis: string;
  readonly baselineArm: string;
  readonly candidateArm: string;
  /** What differs between the arms. Exactly the intervention. */
  readonly variables: readonly string[];
  /** What is held equal. An empty list is a design with no controls — say so. */
  readonly controls: readonly string[];
  readonly metric: string;
  readonly direction: MetricDirection;
  readonly criterion: SuccessCriterion;
  /** Deterministic replay. A design nobody can re-run is an anecdote. */
  readonly seed: number;
  readonly configuration: Readonly<Record<string, unknown>>;
};

export function designId(d: Omit<ExperimentDesign, "id">): string {
  return contentHash({
    objectiveId: d.objectiveId,
    kind: d.kind,
    hypothesis: d.hypothesis,
    baselineArm: d.baselineArm,
    candidateArm: d.candidateArm,
    metric: d.metric,
    seed: d.seed,
    configuration: d.configuration,
  });
}

export function design(d: Omit<ExperimentDesign, "id">): ExperimentDesign {
  if (!d.hypothesis) throw new Error("OQCA experiment: a hypothesis is required");
  if (!d.metric) throw new Error("OQCA experiment: a metric is required");
  return { ...d, id: designId(d) };
}

export type ExperimentRecord = {
  readonly design: ExperimentDesign;
  readonly baseline: Measurement | null;
  readonly candidate: Measurement | null;
  /** Signed in the metric's own units. Null when either side is unmeasured. */
  readonly delta: number | null;
  readonly verdict: Verdict;
  /** Why this verdict, from the numbers. Never a restatement of the verdict. */
  readonly rationale: string;
  /**
   * SEPARATE FROM `verdict === "IMPROVED"` ON PURPOSE. The verdict answers what
   * the comparison said; this answers whether the comparison is entitled to be
   * quoted as a proven improvement. They come apart exactly where §13 says they
   * must: a positive delta from one sample is IMPROVED-shaped and unverified.
   */
  readonly improvementVerified: boolean;
  readonly at: string;
};

/**
 * NOTHING RAN. Reachable only from a capability refusal, which is why it is a
 * constructor rather than an arm of `compare` — a comparison that could return
 * BLOCKED would let a missing resource look like a measured outcome.
 */
export function blocked(d: ExperimentDesign, reason: string, at: string): ExperimentRecord {
  return {
    design: d,
    baseline: null,
    candidate: null,
    delta: null,
    verdict: "BLOCKED",
    rationale: `${IMPROVEMENT_UNVERIFIED}: ${reason}`,
    improvementVerified: false,
    at,
  };
}

function better(delta: number, direction: MetricDirection): number {
  // A signed "how much better", so one comparison serves both directions.
  return direction === "higher_is_better" ? delta : -delta;
}

/**
 * THE COMPARISON, AND EVERY EARLY RETURN IS A REFUSAL TO CLAIM SOMETHING.
 *
 * Order matters and is asserted: missing measurement, then thin samples, then
 * the threshold, and only then a direction. Checking the delta first would let
 * a single-sample 10x "win" reach IMPROVED before anything asked how many
 * readings it rested on.
 */
export function compare(
  d: ExperimentDesign,
  baseline: Measurement | null,
  candidate: Measurement | null,
  at: string,
): ExperimentRecord {
  const base = { design: d, baseline, candidate, at } as const;

  if (!baseline || baseline.value === null || !candidate || candidate.value === null) {
    const which = !baseline || baseline.value === null ? "baseline" : "candidate";
    return {
      ...base,
      delta: null,
      verdict: "INCONCLUSIVE",
      rationale: `${IMPROVEMENT_UNVERIFIED}: the ${which} was not measured`,
      improvementVerified: false,
    };
  }

  const delta = candidate.value - baseline.value;
  const samples = Math.min(baseline.samples, candidate.samples);
  if (samples < d.criterion.minSamples) {
    return {
      ...base,
      delta,
      verdict: "INCONCLUSIVE",
      rationale:
        `${IMPROVEMENT_UNVERIFIED}: ${samples} sample(s) against a criterion of ` +
        `${d.criterion.minSamples}; the delta of ${delta} is not yet evidence`,
      improvementVerified: false,
    };
  }

  const gain = better(delta, d.direction);
  if (Math.abs(delta) < d.criterion.minDelta) {
    return {
      ...base,
      delta,
      verdict: "NO_DIFFERENCE",
      rationale:
        `|${delta}| is below the ${d.criterion.minDelta} the design calls a change; ` +
        `the arms are indistinguishable on ${d.metric}`,
      improvementVerified: false,
    };
  }

  const improved = gain > 0;
  const verdict: Verdict =
    d.kind === "method_comparison"
      ? improved
        ? "QUANTUM_INSPIRED_BETTER"
        : "CLASSICAL_BETTER"
      : improved
        ? "IMPROVED"
        : "REGRESSED";

  return {
    ...base,
    delta,
    verdict,
    rationale:
      `${d.metric} moved ${delta > 0 ? "+" : ""}${delta} ${candidate.unit} ` +
      `(${baseline.value} -> ${candidate.value}) over ${samples} sample(s), ` +
      `${d.direction.replace(/_/g, " ")}`,
    // ONLY AN IMPROVEMENT RUN CAN VERIFY AN IMPROVEMENT. A method comparison
    // says which arm won; it does not say ONIQ got better, and letting it set
    // this flag is how "quantum beat classical on a toy" becomes "ONIQ improved".
    improvementVerified: d.kind === "improvement" && improved,
  };
}

/**
 * §15 — WHAT A FAILURE TAUGHT ONIQ, WITH ITS SCOPE ATTACHED.
 *
 * _"Do not generalize beyond the evidence. Store the scope."_ So the lesson
 * names the arms, the metric, the configuration and the seed it was learned
 * under, and the claim is about THAT combination. "Strategy X has poor
 * continuity" is a claim about every use of X forever; "strategy X scored
 * worse than Y on metric M under configuration C, seed S" is what was measured.
 */
export type FailureLesson = {
  readonly subject: string;
  readonly predicate: string;
  readonly object: unknown;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly statement: string;
};

export function failureLesson(r: ExperimentRecord): FailureLesson | null {
  if (r.verdict === "IMPROVED" || r.verdict === "QUANTUM_INSPIRED_BETTER") return null;
  const scope = {
    baselineArm: r.design.baselineArm,
    candidateArm: r.design.candidateArm,
    metric: r.design.metric,
    configuration: r.design.configuration,
    seed: r.design.seed,
    controls: r.design.controls,
  };
  return {
    subject: r.design.candidateArm,
    predicate: `experiment_verdict:${r.design.metric}`,
    object: { verdict: r.verdict, delta: r.delta },
    scope,
    statement:
      `under ${r.design.candidateArm} against ${r.design.baselineArm} on ` +
      `${r.design.metric} (seed ${r.design.seed}), the verdict was ${r.verdict}: ` +
      r.rationale,
  };
}

/** Experiments whose verdict entitles ONIQ to say it improved. */
export function verifiedImprovements(
  records: readonly ExperimentRecord[],
): readonly ExperimentRecord[] {
  return records.filter((r) => r.improvementVerified);
}
