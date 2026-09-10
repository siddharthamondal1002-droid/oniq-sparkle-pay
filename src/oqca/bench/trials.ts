/**
 * OQCA v1.1 — trial generators. Brief section 6: a benchmark FAMILY, not one
 * hand-written task.
 *
 * THE ONE THING EVERY GENERATOR HERE MUST DO, and the reason v1.0's single task
 * could not support a claim: RANDOMISE THE ANSWER. v1.0's tie task was solvable
 * by "always pick the first-named hypothesis", because the operator rotates mass
 * from the second into the first and the fixture never varied. So a generator
 * picks BOTH which hypothesis is true AND the argument order from the seed, and
 * an index-order strategy then scores at chance — which `adversarial.ts`
 * measures rather than assumes.
 *
 * AND EVERY TRIAL CARRIES ITS OWN MATCHED CONTROL. `matchedEvidence` is the
 * same contextual fact the OQCA arm gets as a phase, written as an ordinary
 * likelihood vector; `contextFeature` is the same fact as a real-valued
 * feature. Brief section 14 exists so a result cannot confuse "more
 * information" with "better representation", and the only way to keep that
 * honest is for the fact to travel with the trial in all three forms.
 *
 * THE CIRCULARITY IS STATED, NOT HIDDEN. In `phase_tie_break` the phase is
 * DERIVED FROM THE TRUTH — it is the fact "hypothesis X is the reliable one",
 * and that fact is the answer. So OQCA scoring 100% there measures a CHANNEL
 * (can the representation carry a supplied fact) and never an inference. The
 * informed-Bayes baseline gets the identical fact and is expected to match; if
 * it does, the honest conclusion is that the representation added nothing.
 */
import { seeded } from "../measure";
import { phasesFavouring } from "../cognitive";

export type TrialStep = {
  readonly likelihoods: readonly number[];
  /** OQCA-only. Radians per hypothesis; a probability vector has nowhere to put it. */
  readonly phases?: readonly number[];
  /** OQCA-only. [indexA, indexB, theta] — theta is the ANGLE, not a strength. */
  readonly interfere?: readonly [number, number, number];
};

export type Trial = {
  readonly id: string;
  readonly seed: number;
  readonly labels: readonly string[];
  readonly prior: readonly number[];
  readonly steps: readonly TrialStep[];
  readonly truth: string;
  /** The contextual fact as an ordinary likelihood vector, or null when none. */
  readonly matchedEvidence: readonly number[] | null;
  /** The same fact as a real-valued feature, one per hypothesis. */
  readonly contextFeature: readonly number[] | null;
  /** Indices the interference touches. Used by the `untouched_drift` metric. */
  readonly interferingPair: readonly [number, number] | null;
};

export type TrialGenerator = (seed: number, params: Readonly<Record<string, number>>) => Trial;

const LABELS = ["A", "B", "C", "D", "E", "F"] as const;

function labelsFor(n: number): string[] {
  if (n < 2 || n > LABELS.length)
    throw new Error(`OQCA trials: hypotheses must be 2..${LABELS.length}`);
  return LABELS.slice(0, n) as unknown as string[];
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
}

/**
 * CONTEXTUALITY. Two hypotheses are tied by the likelihoods; a third fact says
 * which one is reliable. The OQCA arm receives it as a half-turn of phase; the
 * informed baseline receives the same fact as a likelihood.
 *
 * The truth and the argument order are BOTH drawn from the seed, so:
 *   - "always the first-named" scores ~50%
 *   - "always index 0" scores ~50%
 *   - an uninformed probability vector ties and must break by index: ~50%
 *   - OQCA, and informed Bayes, should both score ~100%
 */
export const phaseTieBreak: TrialGenerator = (seed, params) => {
  const rng = seeded(seed);
  const n = Math.round(params.hypotheses ?? 3);
  const labels = labelsFor(n);
  const theta = params.theta ?? Math.atan(0.9);
  const tiedLikelihood = params.tiedLikelihood ?? 0.5;
  const otherLikelihood = params.otherLikelihood ?? 0.2;
  const steps = Math.max(1, Math.round(params.steps ?? 2));

  // The tied pair, in a seed-chosen ORDER, so argument position carries nothing.
  const idx = labels.map((_, i) => i);
  const first = pick(rng, idx);
  const rest = idx.filter((i) => i !== first);
  const second = pick(rng, rest);

  // The truth is one of the tied pair, drawn independently of the order.
  const truthIndex = rng() < 0.5 ? first : second;

  const likelihoods = labels.map((_, i) =>
    i === first || i === second ? tiedLikelihood : otherLikelihood,
  );

  // THE PHASE IS ASKED FOR, NOT ASSUMED. `phasesFavouring` is the kernel's own
  // answer to "which amplitude must carry a half-turn for X to win this pair",
  // and it is exported precisely so a fixture cannot guess it. The first draft
  // of this line DID guess, got the orientation backwards, and the suite
  // returned 0% where chance is 50% — a systematic inversion that a single
  // hand-written task would have shown as a plausible-looking loss.
  const phases = phasesFavouring(labels.length, [first, second], truthIndex);

  const trialSteps: TrialStep[] = [];
  for (let s = 0; s < steps; s++) {
    const last = s === steps - 1;
    trialSteps.push(
      last
        ? { likelihoods, phases, interfere: [first, second, theta] as const }
        : { likelihoods, phases: labels.map(() => 0) },
    );
  }

  // The SAME fact, as evidence a probability vector can take: the reliable one
  // is favoured, its rival discounted, everything else untouched.
  const favour = params.matchedFavour ?? 0.95;
  const discount = params.matchedDiscount ?? 0.05;
  const other = truthIndex === first ? second : first;
  const matchedEvidence = labels.map((_, i) =>
    i === truthIndex ? favour : i === other ? discount : 1,
  );
  const contextFeature = labels.map((_, i) => (i === truthIndex ? 1 : i === other ? -1 : 0));

  return {
    id: `phase_tie_break/${seed}`,
    seed,
    labels,
    prior: labels.map(() => 1),
    steps: trialSteps,
    truth: labels[truthIndex],
    matchedEvidence,
    contextFeature,
    interferingPair: [first, second],
  };
};

/**
 * THE NULL CONDITION. The identical likelihoods with NO contextual fact at all:
 * no phase, no matched evidence, no feature. Nothing can do better than chance
 * on the tied pair, so any arm that does is reading something it should not
 * have — which is what makes this the sharpest control in the suite.
 */
export const tieNoFact: TrialGenerator = (seed, params) => {
  const t = phaseTieBreak(seed, params);
  return {
    ...t,
    id: `tie_no_fact/${seed}`,
    steps: t.steps.map((s) => ({ ...s, phases: s.phases?.map(() => 0) })),
    matchedEvidence: null,
    contextFeature: null,
  };
};

/**
 * INTERFERENCE. Evidence accumulates normally while a pair is interfered every
 * step. The question is not who wins but whether the hypotheses OUTSIDE the
 * pair are left alone — the drain defect v1.0 measured in the spec's operator,
 * turned into a scored benchmark rather than a one-off probe.
 *
 * The truth is a hypothesis NOT in the pair, and the evidence favours it, so a
 * model that drains untouched hypotheses loses the trial outright.
 */
export const untouchedHypothesis: TrialGenerator = (seed, params) => {
  const rng = seeded(seed);
  const n = Math.max(3, Math.round(params.hypotheses ?? 4));
  const labels = labelsFor(n);
  const theta = params.theta ?? Math.atan(0.5);
  const rounds = Math.max(2, Math.round(params.rounds ?? 6));

  const idx = labels.map((_, i) => i);
  const a = pick(rng, idx);
  const b = pick(
    rng,
    idx.filter((i) => i !== a),
  );
  const truthIndex = pick(
    rng,
    idx.filter((i) => i !== a && i !== b),
  );

  // Mild evidence for the truth, repeated. Enough to lead on any model that
  // does not quietly drain it, and not enough to survive being drained.
  const lead = params.lead ?? 0.55;
  const rival = params.rival ?? 0.45;
  const likelihoods = labels.map((_, i) => (i === truthIndex ? lead : rival));

  const steps: TrialStep[] = [];
  for (let r = 0; r < rounds; r++) {
    steps.push({ likelihoods, phases: labels.map(() => 0), interfere: [a, b, theta] as const });
  }

  return {
    id: `untouched_hypothesis/${seed}`,
    seed,
    labels,
    prior: labels.map(() => 1),
    steps,
    truth: labels[truthIndex],
    // No contextual fact is involved, so the baselines see exactly what OQCA
    // sees. Any divergence here is the OPERATOR, which is the point.
    matchedEvidence: null,
    contextFeature: null,
    interferingPair: [a, b],
  };
};

/**
 * HYPOTHESIS ADMISSION. Evidence arrives, then a new hypothesis is admitted
 * mid-stream holding a share of the mass, and more evidence follows favouring
 * the newcomer. Both representations can do this; the trial exists to check
 * that neither is broken by a mid-stream dimension change, and it is expected
 * to TIE.
 */
export const lateHypothesis: TrialGenerator = (seed, params) => {
  const rng = seeded(seed);
  const n = Math.max(3, Math.round(params.hypotheses ?? 3));
  const labels = labelsFor(n);
  const truthIndex = Math.min(n - 1, Math.floor(rng() * n));
  const strong = params.strong ?? 0.9;
  const weak = params.weak ?? 0.1;
  const likelihoods = labels.map((_, i) => (i === truthIndex ? strong : weak));
  return {
    id: `late_hypothesis/${seed}`,
    seed,
    labels,
    prior: labels.map((_, i) => (i === truthIndex ? 1 : 3)),
    steps: [{ likelihoods }, { likelihoods }],
    truth: labels[truthIndex],
    matchedEvidence: null,
    contextFeature: null,
    interferingPair: null,
  };
};

export const TRIAL_GENERATORS: Readonly<Record<string, TrialGenerator>> = {
  phase_tie_break: phaseTieBreak,
  tie_no_fact: tieNoFact,
  untouched_hypothesis: untouchedHypothesis,
  late_hypothesis: lateHypothesis,
};

export function generatorFor(name: string): TrialGenerator {
  const g = TRIAL_GENERATORS[name];
  if (!g) throw new Error(`OQCA: no trial generator named ${JSON.stringify(name)}`);
  return g;
}
