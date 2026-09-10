/**
 * OQCA v1.1 — the falsification suite. Brief section 7.
 *
 * "The objective is to discover where OQCA fails, not manufacture wins."
 *
 * THREE OF THESE EIGHT ARE EXPECTED TO FAIL, and that expectation is written
 * into `expectation` on each control BEFORE the run so it cannot be revised
 * afterwards. A suite whose every control passes has not been adversarial; it
 * has been decorative. What each control means when it fails is stated in its
 * own `ifFailed`, in the sentence a reader should take away — not "OQCA is
 * broken" but the specific claim that stops being available.
 *
 * `survives` is ALWAYS "the interesting claim is still standing after this
 * attack", never "the code worked". A control that ran perfectly and showed the
 * treatment adds nothing is a control that did its job and returns
 * `survives: false`.
 */
import { comparePaired, type ComparisonStats } from "./stats.ts";
import { runArm, runOqca, runVector } from "./arms.ts";
import type { Trial } from "./trials.ts";
import { seeded } from "../measure.ts";

export type ControlOutcome = {
  readonly id: string;
  readonly question: string;
  /** What was expected before the run. Pinned so a surprise stays a surprise. */
  readonly expectation: "expected_to_survive" | "expected_to_fail" | "informational";
  /** True when the interesting claim SURVIVES this attack. */
  readonly survives: boolean;
  readonly detail: string;
  /** What stops being claimable if this control fails. */
  readonly ifFailed: string;
  readonly stats?: ComparisonStats;
};

export type ControlId =
  | "phase_provides_no_benefit"
  | "classical_vector_can_encode_it"
  | "bayes_with_equivalent_information"
  | "random_phase_produces_gains"
  | "basis_permutation_changes_the_answer"
  | "step_order_changes_the_answer"
  | "index_order_artifact"
  | "information_not_representation";

export const CONTROL_IDS: readonly ControlId[] = [
  "phase_provides_no_benefit",
  "classical_vector_can_encode_it",
  "bayes_with_equivalent_information",
  "random_phase_produces_gains",
  "basis_permutation_changes_the_answer",
  "step_order_changes_the_answer",
  "index_order_artifact",
  "information_not_representation",
];

const correct = (t: Trial, arm: Parameters<typeof runArm>[1]) =>
  runArm(t, arm).argmaxLabel === t.truth;

/** 1. Does the phase do anything at all? If not, the treatment is inert. */
function phaseBenefit(trials: readonly Trial[]): ControlOutcome {
  const stats = comparePaired(
    trials.map((t) => ({ oqca: correct(t, "oqca_phase"), control: correct(t, "oqca_no_phase") })),
  );
  return {
    id: "phase_provides_no_benefit",
    question: "Does supplying the fact as a phase change the answer at all?",
    expectation: "expected_to_survive",
    survives: stats.pValue <= 0.05 && stats.difference > 0,
    detail: `with phase ${(stats.oqcaAccuracy * 100).toFixed(1)}% vs without ${(stats.controlAccuracy * 100).toFixed(1)}% — ${stats.verdict}`,
    ifFailed:
      "the phase channel is inert on this family; nothing about amplitudes is being demonstrated",
    stats,
  };
}

/** 2. Can a plain real-valued vector with one extra channel do the same? */
function classicalVector(trials: readonly Trial[]): ControlOutcome {
  const stats = comparePaired(
    trials.map((t) => ({
      oqca: correct(t, "oqca_phase"),
      control: runVector(t, true).argmaxLabel === t.truth,
    })),
  );
  return {
    id: "classical_vector_can_encode_it",
    question: "Can a real-valued vector with a context channel carry the same fact?",
    expectation: "expected_to_fail",
    survives: stats.pValue <= 0.05 && stats.difference > 0,
    detail: `OQCA ${(stats.oqcaAccuracy * 100).toFixed(1)}% vs vector+context ${(stats.controlAccuracy * 100).toFixed(1)}% — ${stats.verdict}`,
    ifFailed:
      "a second real number carries the fact as well as a phase does, so the amplitude representation is not what the result is about",
    stats,
  };
}

/** 3. Give the probability vector the SAME fact as an ordinary likelihood. */
function informedBayes(trials: readonly Trial[]): ControlOutcome {
  const stats = comparePaired(
    trials.map((t) => ({
      oqca: correct(t, "oqca_phase"),
      control: correct(t, "bayes_informed"),
    })),
  );
  return {
    id: "bayes_with_equivalent_information",
    question: "Does Bayes match OQCA once it is given the same contextual fact?",
    expectation: "expected_to_fail",
    survives: stats.pValue <= 0.05 && stats.difference > 0,
    detail: `OQCA ${(stats.oqcaAccuracy * 100).toFixed(1)}% vs informed Bayes ${(stats.controlAccuracy * 100).toFixed(1)}% — ${stats.verdict}`,
    ifFailed:
      "the gap against uninformed Bayes is the INFORMATION, not the representation — the central falsification",
    stats,
  };
}

/**
 * 4. Replace the truth-derived phase with a seed-random one. If OQCA still
 * scores above chance, the benchmark is leaking the answer somewhere else.
 */
function randomPhase(trials: readonly Trial[], seed: number): ControlOutcome {
  const rng = seeded(seed ^ 0x5eed);
  let hits = 0;
  for (const t of trials) {
    const flip = rng() < 0.5;
    const scrambled: Trial = {
      ...t,
      steps: t.steps.map((s) =>
        s.phases
          ? {
              ...s,
              phases: s.phases.map((_, i) =>
                flip && t.interferingPair && i === t.interferingPair[1] ? Math.PI : 0,
              ),
            }
          : s,
      ),
    };
    if (runOqca(scrambled, true).argmaxLabel === t.truth) hits++;
  }
  const acc = trials.length ? hits / trials.length : 0;
  // Chance on a two-way tie is 0.5. A random phase landing far above that would
  // mean the trial leaks its answer through something other than the phase.
  const survives = acc <= 0.72;
  return {
    id: "random_phase_produces_gains",
    question: "Does a RANDOM phase score above chance? (it must not)",
    expectation: "expected_to_survive",
    survives,
    detail: `random-phase accuracy ${(acc * 100).toFixed(1)}% over ${trials.length} trials (chance on a two-way tie is 50%)`,
    ifFailed:
      "the trials leak their answer through something other than the supplied fact, so every OQCA number here is an artifact",
  };
}

/** 5. Relabel the basis. The chosen LABEL must not move. */
function basisPermutation(trials: readonly Trial[], seed: number): ControlOutcome {
  const rng = seeded(seed ^ 0xba515);
  let changed = 0;
  for (const t of trials) {
    const order = t.labels.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const inverse = new Array<number>(order.length);
    order.forEach((from, to) => (inverse[from] = to));
    const permuted: Trial = {
      ...t,
      labels: order.map((i) => t.labels[i]),
      prior: order.map((i) => t.prior[i]),
      steps: t.steps.map((s) => ({
        likelihoods: order.map((i) => s.likelihoods[i]),
        phases: s.phases ? order.map((i) => s.phases![i]) : undefined,
        interfere: s.interfere
          ? ([inverse[s.interfere[0]], inverse[s.interfere[1]], s.interfere[2]] as const)
          : undefined,
      })),
      interferingPair: t.interferingPair
        ? ([inverse[t.interferingPair[0]], inverse[t.interferingPair[1]]] as const)
        : null,
      matchedEvidence: t.matchedEvidence ? order.map((i) => t.matchedEvidence![i]) : null,
      contextFeature: t.contextFeature ? order.map((i) => t.contextFeature![i]) : null,
    };
    if (runOqca(permuted, true).argmaxLabel !== runOqca(t, true).argmaxLabel) changed++;
  }
  return {
    id: "basis_permutation_changes_the_answer",
    question: "Does renaming/reordering the basis change which hypothesis wins?",
    expectation: "expected_to_survive",
    survives: changed === 0,
    detail: `${changed} of ${trials.length} trials changed their answer under a basis permutation`,
    ifFailed:
      "the result depends on the order hypotheses were written down, which is a property of the fixture and not of the model",
  };
}

/** 6. Reverse the step order. Informational: the answer is reported either way. */
function stepOrder(trials: readonly Trial[]): ControlOutcome {
  let changed = 0;
  for (const t of trials) {
    const reversed: Trial = { ...t, steps: [...t.steps].reverse() };
    if (runOqca(reversed, true).argmaxLabel !== runOqca(t, true).argmaxLabel) changed++;
  }
  return {
    id: "step_order_changes_the_answer",
    question: "Does reversing the order evidence arrives in change the answer?",
    expectation: "informational",
    survives: true,
    detail: `${changed} of ${trials.length} trials changed their answer when the steps were reversed`,
    ifFailed:
      "not a failure either way — order-sensitivity is a PROPERTY of the representation, reported rather than scored",
  };
}

/**
 * 7. The dumbest possible strategy: always name the first hypothesis of the
 * interfering pair. On v1.0's single fixture this scored 100%.
 */
function indexOrderArtifact(trials: readonly Trial[]): ControlOutcome {
  let hits = 0;
  for (const t of trials) {
    const guess = t.interferingPair ? t.labels[t.interferingPair[0]] : t.labels[0];
    if (guess === t.truth) hits++;
  }
  const acc = trials.length ? hits / trials.length : 0;
  const survives = acc <= 0.72;
  return {
    id: "index_order_artifact",
    question: "Can 'always name the first hypothesis of the pair' solve the benchmark?",
    expectation: "expected_to_survive",
    survives,
    detail: `the index-order strategy scores ${(acc * 100).toFixed(1)}% over ${trials.length} trials`,
    ifFailed:
      "the benchmark is solvable without reading any evidence, which is what v1.0's single fixture allowed",
  };
}

/** 8. The summary falsification: is the gap information or representation? */
function informationNotRepresentation(trials: readonly Trial[]): ControlOutcome {
  const vsUninformed = comparePaired(
    trials.map((t) => ({
      oqca: correct(t, "oqca_phase"),
      control: correct(t, "bayes_uninformed"),
    })),
  );
  const vsInformed = comparePaired(
    trials.map((t) => ({ oqca: correct(t, "oqca_phase"), control: correct(t, "bayes_informed") })),
  );
  const gapIsInformation = vsUninformed.difference > 0 && vsInformed.pValue > 0.05;
  return {
    id: "information_not_representation",
    question:
      "Is the gap against uninformed Bayes explained by the extra information rather than by amplitudes?",
    expectation: "expected_to_fail",
    survives: !gapIsInformation && vsInformed.difference > 0 && vsInformed.pValue <= 0.05,
    detail:
      `vs uninformed: ${vsUninformed.verdict}. vs informed: ${vsInformed.verdict}. ` +
      (gapIsInformation
        ? "The gap closes entirely once the control is given the same fact — INFORMATION, not representation."
        : "The gap does NOT close when the control is given the same fact."),
    ifFailed:
      "no advantage may be claimed for the amplitude representation on this family; the honest statement is that it carries a fact a bare likelihood vector was not given",
    stats: vsInformed,
  };
}

export function runControl(id: string, trials: readonly Trial[], seed: number): ControlOutcome {
  switch (id) {
    case "phase_provides_no_benefit":
      return phaseBenefit(trials);
    case "classical_vector_can_encode_it":
      return classicalVector(trials);
    case "bayes_with_equivalent_information":
      return informedBayes(trials);
    case "random_phase_produces_gains":
      return randomPhase(trials, seed);
    case "basis_permutation_changes_the_answer":
      return basisPermutation(trials, seed);
    case "step_order_changes_the_answer":
      return stepOrder(trials);
    case "index_order_artifact":
      return indexOrderArtifact(trials);
    case "information_not_representation":
      return informationNotRepresentation(trials);
    default:
      throw new Error(`OQCA: no adversarial control named ${JSON.stringify(id)}`);
  }
}
