/**
 * OQCA v1.1 — the three arms. Brief section 6 (three representations) and
 * section 14 (a matched classical control for every experiment).
 *
 *   BASELINE A  bayes_uninformed   a probability vector, likelihoods only
 *   BASELINE A' bayes_informed     the SAME vector, ALSO given the contextual
 *                                  fact as an ordinary likelihood
 *   BASELINE B  vector_context     a real-valued score vector with an explicit
 *                                  CONTEXT CHANNEL carrying the same fact
 *   TREATMENT   oqca_phase         complex amplitudes; the fact is a phase
 *               oqca_no_phase      the same, with the phase suppressed
 *
 * BASELINE B IS THE ONE THAT CAN FALSIFY THE INTERESTING CLAIM, and it is here
 * for that reason rather than for completeness. If a plain real-valued vector
 * with one extra channel carries the same fact and reaches the same answer,
 * then "the amplitude representation has somewhere to put this" is TRUE and
 * UNINTERESTING — a second real number would have done. Brief section 7.2 asks
 * exactly this, and the suite is built so the answer can be yes.
 *
 * The OQCA arm runs on the v1.1 `CognitiveState`, so every benchmark trial also
 * exercises the transition record, the hash and `validate()` — the audit trail
 * is not a separate code path that only its own tests reach.
 */
import { CognitiveState } from "../formalState.ts";
import { evidence, interfere, phase } from "../cognitive.ts";
import type { Trial } from "./trials.ts";
import type { BaselineId, TreatmentId } from "./manifest.ts";

export type ArmResult = {
  readonly labels: readonly string[];
  readonly probabilities: readonly number[];
  readonly argmaxIndex: number;
  readonly argmaxLabel: string;
  readonly topProbability: number;
  /** Populated by the OQCA arm only; the audit trail for this trial. */
  readonly stateId?: string;
  readonly transitions?: number;
};

function argmaxOf(labels: readonly string[], p: readonly number[]): ArmResult {
  let best = 0;
  // STRICT `>`, so ties fall to the LOWEST index. That is the index-order
  // artifact the adversarial suite measures — made explicit here rather than
  // left to whatever `sort` happens to do, because a benchmark whose control
  // breaks ties unpredictably cannot be reproduced.
  for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
  return {
    labels,
    probabilities: p,
    argmaxIndex: best,
    argmaxLabel: labels[best],
    topProbability: p[best],
  };
}

function normalise(xs: readonly number[]): number[] {
  const sum = xs.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error("OQCA arm: evidence ruled out every hypothesis");
  return xs.map((x) => x / sum);
}

/** BASELINE A. Exact Bayes; `informed` adds the trial's matched evidence. */
export function runBayes(trial: Trial, informed: boolean): ArmResult {
  let p = normalise([...trial.prior]);
  for (const step of trial.steps) {
    p = normalise(p.map((x, i) => x * step.likelihoods[i]));
  }
  if (informed && trial.matchedEvidence) {
    p = normalise(p.map((x, i) => x * trial.matchedEvidence![i]));
  }
  return argmaxOf(trial.labels, p);
}

/**
 * BASELINE B. A real-valued score vector: accumulated log-likelihood plus a
 * weighted CONTEXT channel. With no context feature the scores are the log
 * posterior, so it agrees with Baseline A exactly; with one it carries the same
 * fact a phase carries. Softmax only to make the output comparable — the
 * argmax is unaffected by it.
 */
export function runVector(trial: Trial, useContext: boolean, contextWeight = 4): ArmResult {
  const scores = trial.labels.map((_, i) => {
    let s = Math.log(Math.max(1e-300, trial.prior[i]));
    for (const step of trial.steps) s += Math.log(Math.max(1e-300, step.likelihoods[i]));
    if (useContext && trial.contextFeature) s += contextWeight * trial.contextFeature[i];
    return s;
  });
  const max = Math.max(...scores);
  return argmaxOf(trial.labels, normalise(scores.map((s) => Math.exp(s - max))));
}

/**
 * TREATMENT. Complex amplitudes; the contextual fact arrives as a phase and is
 * read out by a later interference. `usePhase` false suppresses the phase and
 * nothing else, which is the null condition brief section 7.1 asks for.
 */
export function runOqca(trial: Trial, usePhase: boolean): ArmResult {
  let s = CognitiveState.fromWeights(trial.labels, trial.prior, {
    contextId: trial.id,
    tags: { generator: trial.id.split("/")[0] },
  });
  for (const step of trial.steps) {
    s = evidence(s, step.likelihoods);
    if (usePhase && step.phases) {
      step.phases.forEach((theta, i) => {
        if (theta !== 0) s = phase(s, trial.labels[i], theta);
      });
    }
    if (step.interfere) {
      const [i, j, theta] = step.interfere;
      s = interfere(s, trial.labels[i], trial.labels[j], theta);
    }
  }
  const base = argmaxOf(trial.labels, s.probabilities());
  return { ...base, stateId: s.stateId, transitions: s.history.length };
}

export function runArm(trial: Trial, arm: BaselineId | TreatmentId): ArmResult {
  switch (arm) {
    case "bayes_uninformed":
      return runBayes(trial, false);
    case "bayes_informed":
      return runBayes(trial, true);
    case "vector_context":
      return runVector(trial, true);
    case "oqca_phase":
      return runOqca(trial, true);
    case "oqca_no_phase":
      return runOqca(trial, false);
  }
}

/**
 * `untouched_drift` — how much probability the hypotheses OUTSIDE the
 * interfering pair moved, against the same trial run with NO interference.
 * A norm-preserving pair operator leaves them at 0; the spec's rescued matrix
 * drains them, which is what this metric was written to score.
 */
export function untouchedDrift(trial: Trial, arm: BaselineId | TreatmentId): number {
  if (!trial.interferingPair) return 0;
  const withOp = runArm(trial, arm).probabilities;
  const stripped: Trial = {
    ...trial,
    steps: trial.steps.map(({ interfere: _drop, ...rest }) => rest),
  };
  const withoutOp = runArm(stripped, arm).probabilities;
  const [a, b] = trial.interferingPair;
  let worst = 0;
  for (let i = 0; i < withOp.length; i++) {
    if (i === a || i === b) continue;
    worst = Math.max(worst, Math.abs(withOp[i] - withoutOp[i]));
  }
  return worst;
}
