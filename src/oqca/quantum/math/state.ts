/**
 * STATE VECTORS AND DENSITY MATRICES — quantum brief §3.
 *
 * Every object here carries its CONSTRAINT as a function, because §3 asks for
 * "constraints, invariants, examples, counterexamples" and the only version of
 * that which cannot rot is an executable one.
 *
 * THE BASIS ORDER IS BIG-ENDIAN, matching `linalg.ts`'s `QUBIT_ORDER`: index i
 * of an n-qubit vector is the bit string of i with qubit 0 as the MOST
 * significant bit. Stated once here so `partialTrace` and `measure` cannot
 * disagree about which half of the index a qubit lives in — a disagreement that
 * produces plausible-looking numbers and is nearly impossible to spot.
 */
import {
  type Amplitude,
  C_ZERO,
  c,
  cAbs,
  cAdd,
  cConj,
  cMul,
  cNorm2,
  cScale,
} from "../../math/complex.ts";
import {
  type CMatrix,
  DEFAULT_TOL,
  at,
  dagger,
  eigenvaluesHermitian,
  isHermitian,
  isPositiveSemidefinite,
  matrix,
  mul,
  trace,
} from "./linalg.ts";

export type StateVector = {
  readonly qubits: number;
  readonly amps: readonly Amplitude[];
};

export function stateVector(amps: readonly Amplitude[]): StateVector {
  const n = Math.log2(amps.length);
  if (!Number.isInteger(n)) throw new Error("quantum state: length must be a power of two");
  return { qubits: n, amps };
}

/** |0...0>. The computational ground state. */
export function zeroState(qubits: number): StateVector {
  const amps = new Array<Amplitude>(2 ** qubits).fill(C_ZERO);
  amps[0] = c(1, 0);
  return { qubits, amps };
}

export function norm(s: StateVector): number {
  return Math.sqrt(s.amps.reduce((t, a) => t + cNorm2(a), 0));
}

/** §3's constraint on a pure state: <psi|psi> = 1. */
export function isNormalized(s: StateVector, tol = DEFAULT_TOL): boolean {
  return Math.abs(norm(s) - 1) < tol;
}

export function normalize(s: StateVector): StateVector {
  const n = norm(s);
  if (n === 0) throw new Error("quantum state: the zero vector is not a state");
  return { ...s, amps: s.amps.map((a) => cScale(a, 1 / n)) };
}

/** Born rule. Probabilities sum to 1 exactly when the state is normalised. */
export function probabilities(s: StateVector): number[] {
  return s.amps.map(cNorm2);
}

export function applyMatrix(m: CMatrix, s: StateVector): StateVector {
  if (m.cols !== s.amps.length) {
    throw new Error(`quantum state: ${m.rows}x${m.cols} cannot act on ${s.amps.length} amplitudes`);
  }
  const out: Amplitude[] = [];
  for (let r = 0; r < m.rows; r++) {
    let sum = C_ZERO;
    for (let k = 0; k < m.cols; k++) sum = cAdd(sum, cMul(at(m, r, k), s.amps[k]));
    out.push(sum);
  }
  return { qubits: Math.log2(m.rows), amps: out };
}

/** <psi|M|psi>. Real for a Hermitian M — the tests assert exactly that. */
export function expectation(m: CMatrix, s: StateVector): Amplitude {
  const ms = applyMatrix(m, s);
  let sum = C_ZERO;
  for (let i = 0; i < s.amps.length; i++) sum = cAdd(sum, cMul(cConj(s.amps[i]), ms.amps[i]));
  return sum;
}

export function tensorState(a: StateVector, b: StateVector): StateVector {
  const amps: Amplitude[] = [];
  for (const x of a.amps) for (const y of b.amps) amps.push(cMul(x, y));
  return { qubits: a.qubits + b.qubits, amps };
}

/* ---------------- density matrices ---------------- */

export type DensityMatrix = { readonly qubits: number; readonly rho: CMatrix };

/** |psi><psi|. The pure-state density matrix. */
export function densityFromState(s: StateVector): DensityMatrix {
  const n = s.amps.length;
  const d: Amplitude[] = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) d.push(cMul(s.amps[r], cConj(s.amps[k])));
  return { qubits: s.qubits, rho: matrix(n, n, d) };
}

/**
 * §3's three constraints on a density matrix, ALL of them. A check that only
 * tested the trace would accept a matrix with negative eigenvalues, which is
 * not a state at all — it is the counterexample the brief asks each object to
 * carry, and the one an incomplete validator lets through.
 */
export function isValidDensity(d: DensityMatrix, tol = DEFAULT_TOL): boolean {
  const t = trace(d.rho);
  if (Math.abs(t.re - 1) > tol || Math.abs(t.im) > tol) return false;
  if (!isHermitian(d.rho, tol)) return false;
  return isPositiveSemidefinite(d.rho, tol);
}

/** Tr(rho²). 1 for a pure state, 1/d for the maximally mixed one. */
export function purity(d: DensityMatrix): number {
  return trace(mul(d.rho, d.rho)).re;
}

export function isPure(d: DensityMatrix, tol = 1e-8): boolean {
  return Math.abs(purity(d) - 1) < tol;
}

/** I/d — the maximally mixed state on `qubits` qubits. */
export function maximallyMixed(qubits: number): DensityMatrix {
  const n = 2 ** qubits;
  const d: Amplitude[] = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) d.push(r === k ? c(1 / n, 0) : C_ZERO);
  return { qubits, rho: matrix(n, n, d) };
}

/**
 * PARTIAL TRACE — §3, and the operation everything about entanglement depends on.
 *
 * Traces out the qubits in `out`, keeping the rest in their original order.
 * The index arithmetic is the part that goes wrong silently: with qubit 0 as
 * the MOST significant bit, qubit q of an n-qubit index contributes the bit at
 * shift `n - 1 - q`. Getting that backwards still produces a valid density
 * matrix with plausible entropy — it is simply the wrong subsystem's.
 */
export function partialTrace(d: DensityMatrix, out: readonly number[]): DensityMatrix {
  const n = d.qubits;
  const traced = [...new Set(out)].sort((a, b) => a - b);
  for (const q of traced) if (q < 0 || q >= n) throw new Error(`quantum state: no qubit ${q}`);
  const kept = Array.from({ length: n }, (_, i) => i).filter((i) => !traced.includes(i));
  const kd = 2 ** kept.length;
  const td = 2 ** traced.length;

  const bitsOf = (idx: number, qubits: readonly number[]): number => {
    let v = 0;
    for (const q of qubits) v = (v << 1) | ((idx >> (n - 1 - q)) & 1);
    return v;
  };
  const indexFrom = (keptBits: number, tracedBits: number): number => {
    let idx = 0;
    kept.forEach((q, i) => {
      const bit = (keptBits >> (kept.length - 1 - i)) & 1;
      idx |= bit << (n - 1 - q);
    });
    traced.forEach((q, i) => {
      const bit = (tracedBits >> (traced.length - 1 - i)) & 1;
      idx |= bit << (n - 1 - q);
    });
    return idx;
  };
  void bitsOf;

  const outData: Amplitude[] = new Array(kd * kd).fill(C_ZERO);
  for (let r = 0; r < kd; r++) {
    for (let k = 0; k < kd; k++) {
      let sum = C_ZERO;
      for (let t = 0; t < td; t++) {
        sum = cAdd(sum, at(d.rho, indexFrom(r, t), indexFrom(k, t)));
      }
      outData[r * kd + k] = sum;
    }
  }
  return { qubits: kept.length, rho: matrix(kd, kd, outData) };
}

/** Eigenvalues of rho, clamped to [0,1] and renormalised for the entropies. */
export function spectrum(d: DensityMatrix): number[] {
  const raw = eigenvaluesHermitian(d.rho);
  // Numerically tiny negatives are rounding, not physics. Clamping is honest
  // ONLY because `isValidDensity` is available to reject a genuinely invalid
  // matrix first — the tests do exactly that rather than relying on this.
  const clamped = raw.map((v) => (v < 0 ? 0 : v));
  const s = clamped.reduce((a, b) => a + b, 0);
  return s > 0 ? clamped.map((v) => v / s) : clamped;
}

export function densityDagger(d: DensityMatrix): CMatrix {
  return dagger(d.rho);
}

export { cAbs };
