/**
 * OQCA — the honest head-to-head. Owner brief 2026-09-10, sections 25–27.
 *
 * The brief's hypothesis, stated so it can lose: does a superpositional state
 * with phase and interference generalize better than a probability vector?
 *
 * THIS HARNESS IS BUILT TO BE ABLE TO SAY NO. Both models see the SAME tasks
 * and the SAME likelihoods, and OQCA's `reweight` is exactly Bayes, so on any
 * task where OQCA uses only reweight the two MUST tie. A tie is therefore the
 * expected result, not a failure — and a suite where OQCA wins everything
 * would mean the tasks were built to flatter it, which is the UPI-fixture
 * lesson in CLAUDE.md ("every test that proved them ran against a fixture
 * invented here").
 *
 * WHAT THE ONE ASYMMETRY IS. A Bayesian update is commutative: P(H|A,B) does
 * not depend on whether A or B arrived first. `phase` + `interfere` are not.
 * So the only place OQCA CAN differ is where the ORDER or the CONTEXT of
 * evidence genuinely carries information the likelihoods do not. That is a
 * narrow claim, and it is the one worth testing.
 */
import { fromWeights, type CognitiveState } from "./state.ts";
import { interfere, phase, reweight } from "./gates.ts";
import { measure } from "./measure.ts";
import { bayesUpdate, beliefArgmax, beliefFromWeights } from "./baseline.ts";

/** One piece of evidence: a likelihood per hypothesis, plus optional context. */
export type Step = {
  likelihoods: readonly number[];
  /** Radians per hypothesis. Only OQCA sees this; Bayes has nowhere to put it. */
  readonly phases?: readonly number[];
  /** Two hypothesis indices and a strength, applied after the reweight. */
  readonly interfere?: readonly [number, number, number];
};

export type Task = {
  name: string;
  labels: readonly string[];
  prior: readonly number[];
  steps: readonly Step[];
  /** The label a correct model should end on. */
  truth: string;
  /** Why this task is here, and what it would mean if OQCA lost it. */
  rationale: string;
};

export type TaskResult = {
  task: string;
  oqca: string | null;
  bayes: string;
  truth: string;
  oqcaCorrect: boolean;
  bayesCorrect: boolean;
  oqcaConfidence: number;
  bayesConfidence: number;
};

export function runOqca(task: Task): CognitiveState {
  let s = fromWeights(task.labels, task.prior);
  for (const step of task.steps) {
    s = reweight(s, step.likelihoods);
    if (step.phases) {
      step.phases.forEach((theta, i) => {
        if (theta !== 0) s = phase(s, task.labels[i], theta);
      });
    }
    if (step.interfere) {
      const [i, j, strength] = step.interfere;
      s = interfere(s, task.labels[i], task.labels[j], strength);
    }
  }
  return s;
}

export function runBayes(task: Task) {
  let b = beliefFromWeights(task.labels, task.prior);
  for (const step of task.steps) b = bayesUpdate(b, step.likelihoods);
  return b;
}

export function scoreTask(task: Task): TaskResult {
  const s = runOqca(task);
  const m = measure(s);
  const b = runBayes(task);
  const ba = beliefArgmax(b);
  return {
    task: task.name,
    oqca: m.label,
    bayes: ba.label,
    truth: task.truth,
    oqcaCorrect: m.label === task.truth,
    bayesCorrect: ba.label === task.truth,
    oqcaConfidence: m.probability,
    bayesConfidence: ba.probability,
  };
}

export type Verdict = {
  results: TaskResult[];
  oqcaScore: number;
  bayesScore: number;
  total: number;
  /** Tasks where exactly one model was right. The only informative rows. */
  divergent: TaskResult[];
  summary: string;
};

export function runSuite(tasks: readonly Task[]): Verdict {
  const results = tasks.map(scoreTask);
  const oqcaScore = results.filter((r) => r.oqcaCorrect).length;
  const bayesScore = results.filter((r) => r.bayesCorrect).length;
  const divergent = results.filter((r) => r.oqcaCorrect !== r.bayesCorrect);
  const summary =
    oqcaScore === bayesScore
      ? `TIE ${oqcaScore}/${results.length} — no measured advantage either way`
      : oqcaScore > bayesScore
        ? `OQCA ${oqcaScore} vs Bayes ${bayesScore} of ${results.length}`
        : `BAYES ${bayesScore} vs OQCA ${oqcaScore} of ${results.length} — the control wins`;
  return { results, oqcaScore, bayesScore, total: results.length, divergent, summary };
}
