/**
 * OQCA — the cognitive state. Owner brief 2026-09-10, "OQCA v1.0".
 *
 * A normalized vector of complex amplitudes over named hypotheses:
 *
 *     |Psi> = sum_i a_i |H_i>        sum_i |a_i|^2 = 1        P(H_i) = |a_i|^2
 *
 * WHAT THIS IS AND IS NOT. It is a quantum-INSPIRED representation: complex
 * amplitudes that can cancel, running classically. Nothing here is a physical
 * quantum system and no advantage is claimed. Whether it beats an ordinary
 * probability vector is the question `benchmark.ts` exists to answer, and the
 * honest answer may be "no" — see `docs/oqca/README.md`.
 *
 * IMMUTABLE, AND THAT IS THE MILESTONE-1 REQUIREMENT RATHER THAN A TASTE.
 * The brief asks for deterministic replay. The specced `CognitiveState` is a
 * mutable dataclass whose gates edit in place, so a replay shares structure
 * with the run it is replaying and the two drift the first time anything holds
 * a reference. Every operation here returns a NEW state; nothing is edited.
 *
 * ENGINEERING DECISION, 2026-09-10, recorded as one. The owner was asked where
 * OQCA should live and answered "no preference", which under CLAUDE.md's first
 * rule is NOT authorization to start a monthly bill — so the Python/FastAPI
 * service in the brief, which has nowhere to run in ONIQ (the deployable
 * surfaces are a TypeScript bundle and 64 Deno edge functions), was not built.
 * This module is pure, has zero dependencies, ships in no bundle, calls no
 * model and costs nothing.
 */

/**
 * THE COMPLEX FIELD MOVED IN v1.1 and is re-exported here rather than
 * duplicated. Two implementations of `cMul` is one more than can be kept in
 * agreement, and the v1.1 layering (math/ knows nothing about hypotheses) needs
 * the arithmetic to sit below this file, not inside it. Every v1.0 import site
 * keeps working unchanged.
 */
export { type Amplitude, c, cAdd, cMul, cScale, cNorm2 } from "./math/complex";
import { type Amplitude, c, cNorm2, cScale } from "./math/complex";

/**
 * The smallest norm a state may have before it is treated as collapsed.
 * Below this the direction is numerical noise rather than a belief, and
 * dividing by it manufactures confidence out of rounding error.
 */
export const MIN_NORM = 1e-12;

export type CognitiveState = {
  /** Hypothesis labels, positionally aligned with `amplitudes`. */
  readonly labels: readonly string[];
  readonly amplitudes: readonly Amplitude[];
  /** How many operations have been applied. Replay compares this. */
  readonly timestep: number;
};

export class CollapsedStateError extends Error {
  constructor(where: string) {
    super(`OQCA: ${where} produced a zero-norm state`);
    this.name = "CollapsedStateError";
  }
}

function normalized(labels: readonly string[], raw: Amplitude[], timestep: number, where: string) {
  let sum = 0;
  for (const a of raw) sum += cNorm2(a);
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm < MIN_NORM) throw new CollapsedStateError(where);
  return {
    labels,
    amplitudes: raw.map((a) => cScale(a, 1 / norm)),
    timestep,
  } satisfies CognitiveState;
}

/**
 * A state from non-negative WEIGHTS (not amplitudes): each weight becomes
 * sqrt(w) so that the resulting probability is proportional to w. This is the
 * shape a caller thinks in — "these three read about equally likely" — and it
 * is the one place a square root belongs.
 */
export function fromWeights(labels: readonly string[], weights: readonly number[]): CognitiveState {
  if (labels.length === 0) throw new Error("OQCA: a state needs at least one hypothesis");
  if (labels.length !== weights.length) {
    throw new Error("OQCA: labels and weights must be the same length");
  }
  if (new Set(labels).size !== labels.length) {
    // Two hypotheses with one name cannot be told apart by a measurement, and
    // every later index lookup would silently take the first.
    throw new Error("OQCA: hypothesis labels must be unique");
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new Error("OQCA: weights must be finite and >= 0");
  }
  return normalized(
    [...labels],
    weights.map((w) => c(Math.sqrt(w))),
    0,
    "fromWeights",
  );
}

/** A state directly from amplitudes, normalized. For gates and for replay. */
export function fromAmplitudes(
  labels: readonly string[],
  amplitudes: readonly Amplitude[],
  timestep = 0,
): CognitiveState {
  if (labels.length !== amplitudes.length) {
    throw new Error("OQCA: labels and amplitudes must be the same length");
  }
  return normalized(
    [...labels],
    amplitudes.map((a) => ({ ...a })),
    timestep,
    "fromAmplitudes",
  );
}

/** P(H_i) for every i. Always sums to 1 for a state this module produced. */
export function probabilities(state: CognitiveState): number[] {
  return state.amplitudes.map(cNorm2);
}

export function indexOf(state: CognitiveState, label: string): number {
  const i = state.labels.indexOf(label);
  if (i < 0) throw new Error(`OQCA: no hypothesis named ${JSON.stringify(label)}`);
  return i;
}

/**
 * A serialisable snapshot. Round-trips through `fromAmplitudes` exactly, which
 * is what makes a run replayable from a log rather than only re-runnable.
 */
export function snapshot(state: CognitiveState) {
  return {
    labels: [...state.labels],
    amplitudes: state.amplitudes.map((a) => ({ re: a.re, im: a.im })),
    probabilities: probabilities(state),
    timestep: state.timestep,
  };
}
