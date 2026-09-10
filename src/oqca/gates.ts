/**
 * OQCA — the cognitive gates. Owner brief 2026-09-10, sections 6–9.
 *
 * THE SPEC'S `interfere` DRAINS EVERY HYPOTHESIS IT DOES NOT TOUCH, and this
 * is measured rather than argued. Its operation on the pair (i, j) is
 *
 *     a_i' = a_i + s*a_j        a_j' = a_j - s*a_i
 *
 * then a GLOBAL renormalize. The 2x2 matrix M = [[1, s], [-s, 1]] satisfies
 * M^T M = (1 + s^2) I, so it inflates the pair's norm by exactly sqrt(1+s^2)
 * while leaving every other amplitude alone. The global divide then takes that
 * inflation out of the untouched hypotheses. Three equal hypotheses, s = 0.5,
 * interfering only the first two:
 *
 *     start          H2 = 0.3333
 *     after 1        H2 = 0.2857
 *     after 2        H2 = 0.2424
 *     after 4        H2 = 0.1700
 *     after 8        H2 = 0.0774
 *
 * H2 loses 77% of its probability without one word of evidence about it. In a
 * loop that interferes hypotheses every iteration — which is what the brief's
 * section 18 does — any hypothesis outside the pair is driven to zero by
 * arithmetic. `interfere` below divides the PAIR by sqrt(1+s^2) instead, which
 * makes the 2x2 block orthogonal: H2 then holds 0.3333 through eight rounds
 * and the state stays normalized to 1 without any global rescue.
 *
 * AND THAT IS ALSO WHAT MAKES THE QPU ADAPTER POSSIBLE. Sections 23–24 propose
 * running these operations on quantum hardware. Hardware executes UNITARIES; a
 * linear map plus a renormalize is not one, so the specced operator could
 * never have been lifted. Every gate here is norm-preserving on its own, and
 * `assertUnitary2` is exported so a new one has to prove it.
 *
 * Zero dependencies, pure, no I/O. Each function returns a NEW state.
 */
import {
  type Amplitude,
  type CognitiveState,
  c,
  cAdd,
  cMul,
  cScale,
  fromAmplitudes,
  indexOf,
} from "./state";

/** What each gate MEANS, kept separate from the arithmetic (brief §7). */
export const COGNITIVE_GATES = {
  SUPERPOSE: "admit a new competing hypothesis",
  INTERFERE: "let two hypotheses reinforce or cancel",
  PHASE: "shift a hypothesis by context without changing its probability",
  REWEIGHT: "fold evidence in, by likelihood",
  DAMP: "let an unsupported hypothesis decay",
} as const;

export type CognitiveGate = keyof typeof COGNITIVE_GATES;

/**
 * A 2x2 complex matrix is unitary when M† M = I. Exported so that any gate
 * added later can be checked rather than asserted — the brief's QPU path
 * depends on it and nothing else in the module would notice a violation.
 */
export function assertUnitary2(
  m: readonly [Amplitude, Amplitude, Amplitude, Amplitude],
  tol = 1e-9,
) {
  const [a, b, cc, d] = m;
  const conj = (z: Amplitude): Amplitude => ({ re: z.re, im: -z.im });
  // (M† M)_00, _01, _11 — _10 is the conjugate of _01.
  const m00 = cAdd(cMul(conj(a), a), cMul(conj(cc), cc));
  const m01 = cAdd(cMul(conj(a), b), cMul(conj(cc), d));
  const m11 = cAdd(cMul(conj(b), b), cMul(conj(d), d));
  const ok =
    Math.abs(m00.re - 1) < tol &&
    Math.abs(m00.im) < tol &&
    Math.abs(m01.re) < tol &&
    Math.abs(m01.im) < tol &&
    Math.abs(m11.re - 1) < tol &&
    Math.abs(m11.im) < tol;
  if (!ok) throw new Error("OQCA: gate is not unitary");
}

/**
 * Admit a new hypothesis with a given SHARE of the probability mass.
 *
 * The brief appends a raw amplitude and renormalizes, which means the share
 * the caller actually gets depends on how many hypotheses already exist — the
 * same call has a different effect on the third round than the first. Here the
 * caller says what they mean: `share` is the probability the newcomer holds
 * afterwards, and the incumbents keep their relative proportions.
 */
export function superpose(state: CognitiveState, label: string, share: number): CognitiveState {
  if (state.labels.includes(label)) throw new Error(`OQCA: ${label} is already a hypothesis`);
  if (!(share > 0 && share < 1)) throw new Error("OQCA: share must be strictly between 0 and 1");
  const keep = Math.sqrt(1 - share);
  return fromAmplitudes(
    [...state.labels, label],
    [...state.amplitudes.map((a) => cScale(a, keep)), c(Math.sqrt(share))],
    state.timestep + 1,
  );
}

/**
 * Let two hypotheses interfere. `strength` is the mixing angle's tangent: 0
 * does nothing, larger values rotate more of one into the other. The rotation
 * is norm-preserving on the pair, so no third hypothesis moves — which is the
 * whole correction described in this file's header.
 */
export function interfere(
  state: CognitiveState,
  a: string,
  b: string,
  strength: number,
): CognitiveState {
  if (!Number.isFinite(strength)) throw new Error("OQCA: strength must be finite");
  const i = indexOf(state, a);
  const j = indexOf(state, b);
  if (i === j) throw new Error("OQCA: a hypothesis cannot interfere with itself");

  const k = 1 / Math.sqrt(1 + strength * strength);
  assertUnitary2([c(k), c(strength * k), c(-strength * k), c(k)]);

  const next = state.amplitudes.map((x) => ({ ...x }));
  const ai = state.amplitudes[i];
  const aj = state.amplitudes[j];
  next[i] = cScale(cAdd(ai, cScale(aj, strength)), k);
  next[j] = cScale(cAdd(aj, cScale(ai, -strength)), k);
  return fromAmplitudes(state.labels, next, state.timestep + 1);
}

/**
 * Rotate one hypothesis in the complex plane. This changes NOTHING a
 * measurement can see on its own — |e^{i0} a| = |a| — and that is the point:
 * it is the only operation whose effect appears solely through a later
 * interference. It is where "context" lives, and why the order evidence
 * arrives in can matter here and cannot in a Bayesian update.
 */
export function phase(state: CognitiveState, label: string, theta: number): CognitiveState {
  if (!Number.isFinite(theta)) throw new Error("OQCA: theta must be finite");
  const i = indexOf(state, label);
  const rot = c(Math.cos(theta), Math.sin(theta));
  const next = state.amplitudes.map((x) => ({ ...x }));
  next[i] = cMul(next[i], rot);
  return fromAmplitudes(state.labels, next, state.timestep + 1);
}

/**
 * Fold evidence in by multiplying each amplitude by sqrt(likelihood), so that
 * the probabilities update by Bayes' rule exactly. This is the bridge: with
 * only `reweight`, OQCA IS the Bayesian baseline. Any difference the benchmark
 * finds therefore comes from `phase` and `interfere` and from nothing else —
 * which is what makes the comparison mean something.
 */
export function reweight(state: CognitiveState, likelihoods: readonly number[]): CognitiveState {
  if (likelihoods.length !== state.labels.length) {
    throw new Error("OQCA: one likelihood per hypothesis");
  }
  for (const l of likelihoods) {
    if (!Number.isFinite(l) || l < 0) throw new Error("OQCA: likelihoods must be finite and >= 0");
  }
  return fromAmplitudes(
    state.labels,
    state.amplitudes.map((a, i) => cScale(a, Math.sqrt(likelihoods[i]))),
    state.timestep + 1,
  );
}

/**
 * Decay one hypothesis toward zero — the brief's section 30, corrected.
 *
 * Its formula A(t) = A_0 e^{-lambda t} (1 + beta I) is applied per amplitude
 * with independent lambda, which does not preserve the norm, so the result is
 * no longer a state at all. Here the decay is applied and the state is then
 * renormalized, which is the only way the operation can mean "this hypothesis
 * loses ground TO THE OTHERS" rather than "probability quietly leaks away".
 */
export function damp(state: CognitiveState, label: string, factor: number): CognitiveState {
  if (!(factor >= 0 && factor <= 1)) throw new Error("OQCA: damp factor must be in [0, 1]");
  if (state.labels.length === 1) throw new Error("OQCA: cannot damp the only hypothesis");
  const i = indexOf(state, label);
  const next = state.amplitudes.map((x) => ({ ...x }));
  next[i] = cScale(next[i], factor);
  return fromAmplitudes(state.labels, next, state.timestep + 1);
}
