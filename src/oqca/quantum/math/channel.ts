/**
 * QUANTUM CHANNELS AND NOISE — quantum brief §3 (channel, Kraus, CPTP) and §9.
 *
 * §9 asks every noise model to describe "channel, parameters, physical
 * interpretation, simulation method, effect on state, effect on measurement".
 * The first of those is a matrix set and the rest are prose — so the matrix set
 * is built here and CHECKED, and the prose hangs off it in `noise.ts` where it
 * can cite the operators rather than describe them from memory.
 *
 * THE COMPLETENESS RELATION IS THE WHOLE DEFINITION. A Kraus set that does not
 * satisfy sum K†K = I is not a channel: it does not preserve trace, so it maps
 * states to things that are not states. Every constructor here is verified
 * against `isCPTP` in the tests, and the parameter domains are enforced rather
 * than documented — `depolarizing(2)` throws instead of returning a matrix set
 * that quietly produces negative probabilities.
 */
import { type Amplitude, C_ZERO, c, cAdd, cMul, cConj } from "../../math/complex.ts";
import {
  type CMatrix,
  DEFAULT_TOL,
  add,
  approxEqual,
  dagger,
  identity,
  matrix,
  mul,
  scale,
  zeros,
} from "./linalg.ts";
import type { DensityMatrix } from "./state.ts";
import { X, Y, Z, I1 } from "../gates.ts";

/** A channel is its Kraus operators. Nothing else is stored. */
export type Channel = {
  readonly name: string;
  readonly qubits: number;
  readonly kraus: readonly CMatrix[];
  readonly params: Readonly<Record<string, number>>;
};

/** sum_k K_k† K_k = I. Trace preservation; the defining constraint. */
export function isTracePreserving(ch: Channel, tol = DEFAULT_TOL): boolean {
  const n = ch.kraus[0]?.rows ?? 0;
  if (n === 0) return false;
  let sum = zeros(n, n);
  for (const k of ch.kraus) sum = add(sum, mul(dagger(k), k));
  return approxEqual(sum, identity(n), tol);
}

/**
 * COMPLETE POSITIVITY comes free from the Kraus FORM — any operator-sum map is
 * completely positive by construction, which is Choi's theorem. So `isCPTP` is
 * really "is it trace preserving AND well-shaped", and saying so is more honest
 * than implying a positivity check is being performed that is not.
 */
export function isCPTP(ch: Channel, tol = DEFAULT_TOL): boolean {
  if (ch.kraus.length === 0) return false;
  const n = ch.kraus[0].rows;
  if (!ch.kraus.every((k) => k.rows === n && k.cols === n)) return false;
  return isTracePreserving(ch, tol);
}

/** rho -> sum_k K rho K†. */
export function applyChannel(ch: Channel, d: DensityMatrix): DensityMatrix {
  let out = zeros(d.rho.rows, d.rho.cols);
  for (const k of ch.kraus) out = add(out, mul(mul(k, d.rho), dagger(k)));
  return { qubits: d.qubits, rho: out };
}

function checkProb(p: number, name: string): void {
  if (!(p >= 0 && p <= 1)) throw new Error(`quantum channel: ${name} must be in [0,1], got ${p}`);
}

const sq = (p: number) => Math.sqrt(p);

/* ---------------- the §9 catalogue ---------------- */

/**
 * DEPOLARIZING. The convention matters and differs between ecosystems: here p
 * is the probability the state is replaced by the maximally mixed state, so the
 * three Paulis each carry p/4 and identity carries 1 - 3p/4. Some libraries
 * instead give each Pauli p/3. Both are called "depolarizing with probability
 * p" and they are NOT the same channel — §23's divergence case, recorded in
 * `knowledge.ts` rather than silently normalised.
 */
export function depolarizing(p: number): Channel {
  checkProb(p, "depolarizing p");
  return {
    name: "depolarizing",
    qubits: 1,
    params: { p },
    kraus: [
      scale(I1, sq(1 - (3 * p) / 4)),
      scale(X, sq(p / 4)),
      scale(Y, sq(p / 4)),
      scale(Z, sq(p / 4)),
    ],
  };
}

export function bitFlip(p: number): Channel {
  checkProb(p, "bit flip p");
  return {
    name: "bit_flip",
    qubits: 1,
    params: { p },
    kraus: [scale(I1, sq(1 - p)), scale(X, sq(p))],
  };
}

export function phaseFlip(p: number): Channel {
  checkProb(p, "phase flip p");
  return {
    name: "phase_flip",
    qubits: 1,
    params: { p },
    kraus: [scale(I1, sq(1 - p)), scale(Z, sq(p))],
  };
}

export function bitPhaseFlip(p: number): Channel {
  checkProb(p, "bit-phase flip p");
  return {
    name: "bit_phase_flip",
    qubits: 1,
    params: { p },
    kraus: [scale(I1, sq(1 - p)), scale(Y, sq(p))],
  };
}

/**
 * AMPLITUDE DAMPING — energy loss to a zero-temperature environment. It is the
 * only channel here that is NOT unital: it drives every state towards |0>, so
 * the maximally mixed state is not a fixed point. The tests assert that
 * asymmetry, because a symmetric implementation would be phase damping wearing
 * the wrong name.
 */
export function amplitudeDamping(gamma: number): Channel {
  checkProb(gamma, "amplitude damping gamma");
  const k0 = matrix(2, 2, [c(1, 0), C_ZERO, C_ZERO, c(Math.sqrt(1 - gamma), 0)]);
  const k1 = matrix(2, 2, [C_ZERO, c(Math.sqrt(gamma), 0), C_ZERO, C_ZERO]);
  return { name: "amplitude_damping", qubits: 1, params: { gamma }, kraus: [k0, k1] };
}

/** PHASE DAMPING — coherence loss with NO energy loss. Unital; T2 without T1. */
export function phaseDamping(lambda: number): Channel {
  checkProb(lambda, "phase damping lambda");
  const k0 = matrix(2, 2, [c(1, 0), C_ZERO, C_ZERO, c(Math.sqrt(1 - lambda), 0)]);
  const k1 = matrix(2, 2, [C_ZERO, C_ZERO, C_ZERO, c(Math.sqrt(lambda), 0)]);
  return { name: "phase_damping", qubits: 1, params: { lambda }, kraus: [k0, k1] };
}

/**
 * GENERALISED AMPLITUDE DAMPING — the finite-temperature version. `nBar` is the
 * environment's excitation probability; at nBar = 0 it reduces exactly to
 * `amplitudeDamping`, which the tests check rather than assert.
 */
export function thermalDamping(gamma: number, nBar: number): Channel {
  checkProb(gamma, "gamma");
  checkProb(nBar, "nBar");
  const p = 1 - nBar;
  const k0 = scale(matrix(2, 2, [c(1, 0), C_ZERO, C_ZERO, c(Math.sqrt(1 - gamma), 0)]), sq(p));
  const k1 = scale(matrix(2, 2, [C_ZERO, c(Math.sqrt(gamma), 0), C_ZERO, C_ZERO]), sq(p));
  const k2 = scale(matrix(2, 2, [c(Math.sqrt(1 - gamma), 0), C_ZERO, C_ZERO, c(1, 0)]), sq(1 - p));
  const k3 = scale(matrix(2, 2, [C_ZERO, C_ZERO, c(Math.sqrt(gamma), 0), C_ZERO]), sq(1 - p));
  return { name: "thermal", qubits: 1, params: { gamma, nBar }, kraus: [k0, k1, k2, k3] };
}

/**
 * A COHERENT ERROR IS NOT A KRAUS MIXTURE — it is a single unitary that is
 * slightly wrong, and that distinction is the whole reason it is dangerous: it
 * ADDS across repetitions instead of averaging, so a small over-rotation
 * repeated a thousand times is a large error rather than a slightly noisier one.
 * Representing it as one Kraus operator keeps that property exactly.
 */
export function coherentError(unitary: CMatrix): Channel {
  return { name: "coherent", qubits: Math.log2(unitary.rows), params: {}, kraus: [unitary] };
}

/**
 * READOUT NOISE is a CLASSICAL confusion matrix applied to the OUTCOME, not a
 * channel on the state — the qubit was fine and the apparatus misreported it.
 * Modelling it as a bit flip before measurement gives the same marginals for a
 * single shot and the WRONG answer for anything conditioned on the state
 * afterwards, so it is kept as its own type rather than folded in.
 */
export type ReadoutNoise = {
  readonly name: "readout";
  /** P(read 1 | state 0). */
  readonly p01: number;
  /** P(read 0 | state 1). */
  readonly p10: number;
};

export function readoutNoise(p01: number, p10: number): ReadoutNoise {
  checkProb(p01, "p01");
  checkProb(p10, "p10");
  return { name: "readout", p01, p10 };
}

export function applyReadout(probs: readonly number[], r: ReadoutNoise): number[] {
  if (probs.length !== 2) throw new Error("quantum channel: readout noise is single-qubit here");
  const [p0, p1] = probs;
  return [p0 * (1 - r.p01) + p1 * r.p10, p0 * r.p01 + p1 * (1 - r.p10)];
}

/** Compose two channels: the Kraus set of the composite is the product set. */
export function composeChannels(first: Channel, second: Channel): Channel {
  const kraus: CMatrix[] = [];
  for (const b of second.kraus) for (const a of first.kraus) kraus.push(mul(b, a));
  return {
    name: `${first.name}+${second.name}`,
    qubits: first.qubits,
    params: { ...first.params, ...second.params },
    kraus,
  };
}

/** Lift a single-qubit channel to act on one qubit of an n-qubit register. */
export function onQubitChannel(ch: Channel, target: number, n: number): Channel {
  if (ch.kraus[0].rows !== 2) throw new Error("quantum channel: expected a single-qubit channel");
  const lift = (k: CMatrix): CMatrix => {
    let m = identity(1);
    for (let i = 0; i < n; i++) {
      const block = i === target ? k : I1;
      const rows = m.rows * block.rows;
      const cols = m.cols * block.cols;
      const d: Amplitude[] = new Array(rows * cols).fill(C_ZERO);
      for (let ar = 0; ar < m.rows; ar++)
        for (let ac = 0; ac < m.cols; ac++)
          for (let br = 0; br < block.rows; br++)
            for (let bc = 0; bc < block.cols; bc++)
              d[(ar * block.rows + br) * cols + (ac * block.cols + bc)] = cMul(
                m.data[ar * m.cols + ac],
                block.data[br * block.cols + bc],
              );
      m = matrix(rows, cols, d);
    }
    return m;
  };
  return { ...ch, qubits: n, kraus: ch.kraus.map(lift) };
}

export { cAdd, cConj };
