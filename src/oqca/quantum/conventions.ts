/**
 * CONVENTIONS SETTLED BY EXPERIMENT — v1.4-R item E, and the point of it is
 * that ONIQ has a SECOND route to knowledge.
 *
 * Every other rung of `Directness` describes a document somebody else wrote,
 * so a container that cannot reach the network is a container that cannot
 * learn. It can still MEASURE. A convention is exactly the kind of claim that
 * a measurement settles outright: two conventions predict two DIFFERENT
 * observable bitstrings from the same circuit, so running it decides which one
 * this implementation actually follows — no page, no snippet, no recall.
 *
 * WHAT MAKES THIS AN EXPERIMENT RATHER THAN A DESCRIPTION, and all three are
 * enforced below rather than described:
 *
 *   1. THE PREDICTIONS ARE PRE-REGISTERED. `predictions` is a literal in this
 *      file, written before any run, and `settle` only ever LOOKS UP the
 *      observed outcome in it. Nothing here can decide after the fact what the
 *      experiment was going to show — v1.1 measured what a fixture built to
 *      flatter its subject is worth.
 *   2. THERE IS A CONTROL, AND A RUN WITHOUT IT PROVES NOTHING. A backend that
 *      always answered "01" would "confirm" big-endian; the control flips the
 *      OTHER qubit and must come back DIFFERENT, or the outcome is void. The
 *      control's own expected value is pre-registered too.
 *   3. AN UNRECOGNISED OUTCOME IS A REFUSAL. If the observed bitstring matches
 *      no registered prediction, `convention` is null and nothing is recorded.
 *      Guessing which convention a surprise implies is how an experiment turns
 *      into a story.
 *
 * IT IS ALSO CHEAP ENOUGH TO RUN EVERY TIME. Two qubits, one gate, a few
 * hundred shots of a seeded sampler: microseconds, no network, no credential,
 * no money. `ingestQuantumKnowledge` runs it on every ingestion, so the record
 * is a measurement of THIS build rather than a number somebody copied forward.
 */
import { circuit, gate, measure, type Circuit } from "./circuit.ts";
import type { Counts, QuantumBackend } from "./backends/backend.ts";

/** Deterministic: the sampler is seeded, so a replay reproduces the counts. */
export const CONVENTION_SHOTS = 512;
export const CONVENTION_SEED = 7;

export type ConventionExperiment = {
  readonly id: string;
  /** The claim being settled, in the words a person would ask it in. */
  readonly question: string;
  /**
   * Convention name -> the bitstring it predicts. PRE-REGISTERED: an outcome
   * outside this map is a refusal, never a new entry.
   */
  readonly predictions: Readonly<Record<string, string>>;
  /**
   * The control's predicted outcome under the SAME convention the experiment
   * would confirm. It must differ from that convention's own prediction, or the
   * pair cannot distinguish a working backend from a constant one.
   */
  readonly controlPredictions: Readonly<Record<string, string>>;
  readonly build: () => Circuit;
  readonly buildControl: () => Circuit;
};

export type ConventionOutcome = {
  readonly id: string;
  readonly question: string;
  /** The convention the observation matched, or null when nothing did. */
  readonly convention: string | null;
  readonly observed: string | null;
  readonly controlObserved: string | null;
  /** True only when the control genuinely differed from the experiment. */
  readonly discriminated: boolean;
  readonly shots: number;
  readonly seed: number;
  /** Why this outcome, in words. Never a code. */
  readonly detail: string;
};

/**
 * THE QUBIT-ORDER DISCRIMINATOR.
 *
 * Flip qubit 1 of a two-qubit register and read both bits into a classical
 * register in index order. Big-endian (qubit 0 is the MOST significant
 * character, ONIQ's convention as `domains.ts` DIVERGENCES states it) predicts
 * "01"; little-endian (Qiskit's) predicts "10". The control flips qubit 0
 * instead and the predictions swap — which is what makes the pair sensitive to
 * WHICH qubit moved rather than to the backend having an opinion.
 */
export const QUBIT_ORDER_EXPERIMENT: ConventionExperiment = {
  id: "qubit_order",
  question: "does this backend index the tensor product big-endian or little-endian?",
  predictions: { big_endian: "01", little_endian: "10" },
  controlPredictions: { big_endian: "10", little_endian: "01" },
  build: () => {
    let c = circuit("qubit-order-discriminator", 2, 2);
    c = gate(c, "X", [1]);
    c = measure(c, 0, 0);
    c = measure(c, 1, 1);
    return c;
  },
  buildControl: () => {
    let c = circuit("qubit-order-control", 2, 2);
    c = gate(c, "X", [0]);
    c = measure(c, 0, 0);
    c = measure(c, 1, 1);
    return c;
  },
};

export const CONVENTION_EXPERIMENTS: readonly ConventionExperiment[] = [QUBIT_ORDER_EXPERIMENT];

/**
 * The single outcome of a run, or null when the counts are not unanimous.
 *
 * UNANIMITY IS REQUIRED because these circuits are deterministic by
 * construction: one X gate on a computational basis state has exactly one
 * outcome. A spread of bitstrings means the backend is not doing what the
 * experiment assumes, and reading the mode would paper over precisely that.
 */
export function soleOutcome(counts: Counts): string | null {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  return keys.length === 1 ? keys[0] : null;
}

/**
 * Run the pair and settle the convention. Pure with respect to the world: the
 * only thing it touches is the backend it was handed.
 */
export function runConventionExperiment(
  exp: ConventionExperiment,
  backend: QuantumBackend,
  shots = CONVENTION_SHOTS,
  seed = CONVENTION_SEED,
): ConventionOutcome {
  const base = {
    id: exp.id,
    question: exp.question,
    shots,
    seed,
  } as const;
  const void_ = (detail: string): ConventionOutcome => ({
    ...base,
    convention: null,
    observed: null,
    controlObserved: null,
    discriminated: false,
    detail,
  });

  const main = backend.simulate(exp.build(), shots, seed);
  if (!main.ok) return void_(`the backend refused the experiment: ${main.reason}`);
  const control = backend.simulate(exp.buildControl(), shots, seed);
  if (!control.ok) return void_(`the backend refused the control: ${control.reason}`);

  const observed = soleOutcome(main.value);
  const controlObserved = soleOutcome(control.value);
  if (observed === null || controlObserved === null) {
    return {
      ...base,
      convention: null,
      observed,
      controlObserved,
      discriminated: false,
      detail:
        "a deterministic circuit returned more than one bitstring; the backend is not doing " +
        "what this experiment assumes and the outcome says nothing about the convention",
    };
  }

  // THE CONTROL IS CHECKED BEFORE THE MATCH, and that order is the guard. A
  // constant backend matches a prediction perfectly and discriminates nothing.
  if (observed === controlObserved) {
    return {
      ...base,
      convention: null,
      observed,
      controlObserved,
      discriminated: false,
      detail:
        `the control returned the same bitstring as the experiment (${observed}); a backend ` +
        "that answers identically whichever qubit moved cannot settle an ordering",
    };
  }

  const matched = Object.keys(exp.predictions).filter((k) => exp.predictions[k] === observed);
  if (matched.length !== 1) {
    return {
      ...base,
      convention: null,
      observed,
      controlObserved,
      discriminated: true,
      detail:
        `observed ${observed}, which matches ${matched.length} of the pre-registered ` +
        "predictions; an outcome no registered convention predicts is a refusal, not a new one",
    };
  }
  const convention = matched[0];

  // The control must ALSO land where that convention says it should. Anything
  // else means the pair disagrees with itself, and half an experiment is none.
  const expectedControl = exp.controlPredictions[convention];
  if (controlObserved !== expectedControl) {
    return {
      ...base,
      convention: null,
      observed,
      controlObserved,
      discriminated: true,
      detail:
        `the experiment says ${convention} (${observed}) but its control returned ` +
        `${controlObserved} where ${convention} predicts ${expectedControl}`,
    };
  }

  return {
    ...base,
    convention,
    observed,
    controlObserved,
    discriminated: true,
    detail:
      `${shots} shots at seed ${seed}: the experiment returned ${observed} and the control ` +
      `${controlObserved}, which only ${convention} predicts`,
  };
}
