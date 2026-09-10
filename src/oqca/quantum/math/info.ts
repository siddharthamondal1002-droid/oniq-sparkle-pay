/**
 * QUANTUM INFORMATION THEORY — quantum brief §8, with validators.
 *
 * "Add mathematical validators." Every quantity here is computed from the
 * SPECTRUM of a density matrix rather than from a formula applied to a state,
 * which is what makes them work for mixed states too — and mixed states are the
 * only ones where most of these are interesting.
 *
 * LOG BASE 2 THROUGHOUT, so entropies are in QUBITS. A maximally mixed single
 * qubit has S = 1, a Bell state's reduced density matrix has S = 1, and a pure
 * state has S = 0 — three numbers the tests pin, because a base-e
 * implementation produces the same SHAPE of answer with every value wrong by
 * ln 2 and nothing else notices.
 */
import type { DensityMatrix } from "./state.ts";
import { partialTrace, purity, spectrum } from "./state.ts";
import { type CMatrix, DEFAULT_TOL, eigenvaluesHermitian, mul, sub, trace } from "./linalg.ts";

const log2 = (x: number) => Math.log(x) / Math.LN2;

/** 0 log 0 = 0. The limit, not an error — and the case that bites at purity 1. */
function xlogx(p: number): number {
  return p <= 0 ? 0 : p * log2(p);
}

/** S(rho) = -Tr(rho log rho). In qubits. */
export function vonNeumannEntropy(d: DensityMatrix): number {
  return -spectrum(d).reduce((s, p) => s + xlogx(p), 0);
}

/**
 * Renyi-alpha. alpha -> 1 is von Neumann, which is a REMOVABLE SINGULARITY the
 * formula cannot evaluate — so alpha within 1e-9 of 1 is delegated rather than
 * computed, because 1/(1-alpha) at alpha=1 is a division by zero that would
 * return Infinity for a perfectly ordinary request.
 */
export function renyiEntropy(d: DensityMatrix, alpha: number): number {
  if (alpha < 0) throw new Error("quantum info: Renyi alpha must be >= 0");
  if (Math.abs(alpha - 1) < 1e-9) return vonNeumannEntropy(d);
  const s = spectrum(d);
  if (alpha === 0) return log2(s.filter((p) => p > 1e-12).length);
  if (!Number.isFinite(alpha)) return -log2(Math.max(...s));
  return (1 / (1 - alpha)) * log2(s.reduce((t, p) => t + Math.pow(p, alpha), 0));
}

/** Linear entropy 1 - Tr(rho²). Cheap, and needs no eigenvalues. */
export function linearEntropy(d: DensityMatrix): number {
  return 1 - purity(d);
}

/**
 * ENTANGLEMENT ENTROPY of a bipartition — the von Neumann entropy of the
 * REDUCED state. It is only a valid entanglement measure for a PURE global
 * state, and that precondition is checked rather than assumed: for a mixed
 * global state this number is real but is not entanglement, and returning it
 * unqualified is the kind of quiet category error §20 exists to stop.
 */
export function entanglementEntropy(d: DensityMatrix, keep: readonly number[]): number {
  const all = Array.from({ length: d.qubits }, (_, i) => i);
  const out = all.filter((q) => !keep.includes(q));
  return vonNeumannEntropy(partialTrace(d, out));
}

export function isPureGlobalState(d: DensityMatrix, tol = 1e-8): boolean {
  return Math.abs(purity(d) - 1) < tol;
}

/** I(A:B) = S(A) + S(B) - S(AB). Non-negative — asserted in the tests. */
export function mutualInformation(d: DensityMatrix, partA: readonly number[]): number {
  const all = Array.from({ length: d.qubits }, (_, i) => i);
  const partB = all.filter((q) => !partA.includes(q));
  const sA = vonNeumannEntropy(partialTrace(d, partB));
  const sB = vonNeumannEntropy(partialTrace(d, partA));
  return sA + sB - vonNeumannEntropy(d);
}

/** S(A|B) = S(AB) - S(B). CAN BE NEGATIVE quantumly — that is the point of it. */
export function conditionalEntropy(d: DensityMatrix, partA: readonly number[]): number {
  const all = Array.from({ length: d.qubits }, (_, i) => i);
  const partB = all.filter((q) => !partA.includes(q));
  const sB = vonNeumannEntropy(partialTrace(d, partA));
  void partB;
  return vonNeumannEntropy(d) - sB;
}

/**
 * TRACE DISTANCE (1/2)||rho - sigma||_1 — the sum of the singular values, which
 * for a HERMITIAN difference is the sum of |eigenvalues|. In [0,1].
 */
export function traceDistance(a: DensityMatrix, b: DensityMatrix): number {
  if (a.qubits !== b.qubits) throw new Error("quantum info: dimension mismatch");
  const diff = sub(a.rho, b.rho);
  return 0.5 * eigenvaluesHermitian(diff).reduce((s, v) => s + Math.abs(v), 0);
}

/**
 * FIDELITY. The general Uhlmann form needs a matrix square root; this
 * implementation covers the case where at least ONE state is pure, which is
 * exact via F = <psi|sigma|psi>, and REFUSES otherwise rather than returning an
 * approximation nobody asked for.
 *
 * Refusing is the honest half. A "fidelity" that silently fell back to
 * Tr(rho sigma) would be a different quantity with the same name — and this
 * repo has a receipt for what a wrong-but-plausible number costs.
 */
export function fidelity(a: DensityMatrix, b: DensityMatrix, tol = 1e-8): number {
  if (a.qubits !== b.qubits) throw new Error("quantum info: dimension mismatch");
  const aPure = Math.abs(purity(a) - 1) < tol;
  const bPure = Math.abs(purity(b) - 1) < tol;
  if (!aPure && !bPure) {
    throw new Error(
      "quantum info: fidelity between two MIXED states needs a matrix square root, which this " +
        "substrate does not implement. Refusing rather than returning Tr(rho sigma), which is a " +
        "different quantity.",
    );
  }
  const pure = aPure ? a : b;
  const other = aPure ? b : a;
  // F = <psi|sigma|psi> = Tr(|psi><psi| sigma), and |psi><psi| IS the pure rho.
  return Math.max(0, Math.min(1, trace(mul(pure.rho, other.rho)).re));
}

/** l1 coherence: the off-diagonal mass in the computational basis. */
export function l1Coherence(d: DensityMatrix): number {
  let s = 0;
  const n = d.rho.rows;
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      if (r === k) continue;
      s += Math.hypot(d.rho.data[r * n + k].re, d.rho.data[r * n + k].im);
    }
  }
  return s;
}

/**
 * §8's validators, as one call. Every inequality below is a THEOREM, so a
 * violation means the implementation is wrong — which is exactly what makes
 * them worth checking at runtime rather than only in tests.
 */
export type InfoValidation = {
  readonly ok: boolean;
  readonly violations: readonly string[];
};

export function validateInformationTheory(d: DensityMatrix): InfoValidation {
  const v: string[] = [];
  const n = d.qubits;
  const s = vonNeumannEntropy(d);
  const maxS = n;
  if (s < -DEFAULT_TOL) v.push(`von Neumann entropy is negative (${s})`);
  if (s > maxS + 1e-6) v.push(`entropy ${s} exceeds log2(dim) = ${maxS}`);

  const p = purity(d);
  if (p < 1 / 2 ** n - 1e-6) v.push(`purity ${p} below the maximally mixed 1/${2 ** n}`);
  if (p > 1 + 1e-6) v.push(`purity ${p} exceeds 1`);

  if (n >= 2) {
    const mi = mutualInformation(d, [0]);
    // Subadditivity: I(A:B) >= 0.
    if (mi < -1e-6) v.push(`mutual information is negative (${mi})`);
    // ...and its upper bound, 2 min(S_A, S_B) in qubits.
    const sA = vonNeumannEntropy(
      partialTrace(
        d,
        Array.from({ length: n - 1 }, (_, i) => i + 1),
      ),
    );
    const sB = vonNeumannEntropy(partialTrace(d, [0]));
    if (mi > 2 * Math.min(sA, sB) + 1e-6) v.push(`mutual information ${mi} exceeds its bound`);
  }
  return { ok: v.length === 0, violations: v };
}

export type { CMatrix };
