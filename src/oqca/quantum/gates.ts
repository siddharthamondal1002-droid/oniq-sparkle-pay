/**
 * THE GATE LIBRARY — quantum brief §4.
 *
 * **THIS FILE IS `PHYSICAL_QUANTUM`. `src/oqca/gates.ts` IS `QUANTUM_INSPIRED`.**
 * Both are called "gates" and they are not the same kind of object: this one
 * holds 2^n x 2^n unitaries acting on a Hilbert space; that one holds the
 * two-level rotations OQCA applies to a HYPOTHESIS amplitude vector, which is a
 * cognitive model and not a physical claim. §20 of the brief forbids silently
 * converting one category into the other, so they live in different trees, carry
 * different types, and `boundary.ts` refuses to coerce between them.
 *
 * EVERY ENTRY'S UNITARITY IS COMPUTED, NEVER DECLARED. `unitary: true` written
 * by hand is a claim about a matrix nobody checked; `isUnitary(g.matrix)` is the
 * matrix answering for itself. `gates.test.ts` runs it over the whole registry,
 * which is §4's "Add automated invariant tests" taken literally.
 *
 * THE QUBIT ORDER IS BIG-ENDIAN — see `linalg.ts`'s `QUBIT_ORDER`. Qiskit's
 * textbook convention is the opposite, and that divergence is recorded as
 * knowledge rather than normalised away (§23).
 */
import { type Amplitude, c } from "../math/complex.ts";
import {
  type CMatrix,
  identity,
  isHermitian,
  isUnitary,
  kron,
  matrix,
  mul,
  dagger,
} from "./math/linalg.ts";

const S2 = Math.SQRT1_2;
const z = c(0, 0);
const one = c(1, 0);

/** How a gate is described when it takes no parameters. */
export type GateSpec = {
  readonly name: string;
  readonly qubits: number;
  /** Number of control qubits, of the `qubits` total. */
  readonly controls: number;
  readonly matrix: CMatrix;
  /** Its inverse, as a matrix. For every unitary this is the dagger. */
  readonly inverse: CMatrix;
  /** Computed, not declared. */
  readonly unitary: boolean;
  readonly hermitian: boolean;
  /** Whether G² = I — the involutions, which is why they are self-inverse. */
  readonly involutory: boolean;
  /** A decomposition into simpler gates, when a standard one exists. */
  readonly decomposition: readonly string[];
  /** Hardware families that implement this natively, per vendor documentation. */
  readonly native: readonly string[];
  readonly notes: string;
};

function fromRows(rows: readonly (readonly Amplitude[])[]): CMatrix {
  const n = rows.length;
  return matrix(n, n, rows.flat());
}

function spec(
  name: string,
  m: CMatrix,
  o: {
    qubits: number;
    controls?: number;
    decomposition?: readonly string[];
    native?: readonly string[];
    notes?: string;
  },
): GateSpec {
  const inv = dagger(m);
  return {
    name,
    qubits: o.qubits,
    controls: o.controls ?? 0,
    matrix: m,
    inverse: inv,
    // COMPUTED. See the header — a hand-written `true` here is not evidence.
    unitary: isUnitary(m),
    hermitian: isHermitian(m),
    involutory: isUnitary(m) && approxIdentity(mul(m, m)),
    decomposition: o.decomposition ?? [],
    native: o.native ?? [],
    notes: o.notes ?? "",
  };
}

function approxIdentity(m: CMatrix): boolean {
  const id = identity(m.rows);
  return m.data.every(
    (x, i) => Math.abs(x.re - id.data[i].re) < 1e-10 && Math.abs(x.im - id.data[i].im) < 1e-10,
  );
}

/* ---------------- single-qubit, fixed ---------------- */

export const I1 = fromRows([
  [one, z],
  [z, one],
]);
export const X = fromRows([
  [z, one],
  [one, z],
]);
export const Y = fromRows([
  [z, c(0, -1)],
  [c(0, 1), z],
]);
export const Z = fromRows([
  [one, z],
  [z, c(-1, 0)],
]);
export const H = fromRows([
  [c(S2, 0), c(S2, 0)],
  [c(S2, 0), c(-S2, 0)],
]);
export const S = fromRows([
  [one, z],
  [z, c(0, 1)],
]);
export const SDG = fromRows([
  [one, z],
  [z, c(0, -1)],
]);
export const T = fromRows([
  [one, z],
  [z, c(S2, S2)],
]);
export const TDG = fromRows([
  [one, z],
  [z, c(S2, -S2)],
]);
/** √X. Its square is X, which the tests check rather than assume. */
export const SX = fromRows([
  [c(0.5, 0.5), c(0.5, -0.5)],
  [c(0.5, -0.5), c(0.5, 0.5)],
]);
export const SXDG = dagger(SX);

/* ---------------- single-qubit, parameterised ---------------- */

/** Rx(θ) = exp(-iθX/2). The domain is all of R; 4π is the period, not 2π. */
export function rx(theta: number): CMatrix {
  const ct = Math.cos(theta / 2);
  const st = Math.sin(theta / 2);
  return fromRows([
    [c(ct, 0), c(0, -st)],
    [c(0, -st), c(ct, 0)],
  ]);
}

export function ry(theta: number): CMatrix {
  const ct = Math.cos(theta / 2);
  const st = Math.sin(theta / 2);
  return fromRows([
    [c(ct, 0), c(-st, 0)],
    [c(st, 0), c(ct, 0)],
  ]);
}

export function rz(theta: number): CMatrix {
  return fromRows([
    [c(Math.cos(theta / 2), -Math.sin(theta / 2)), z],
    [z, c(Math.cos(theta / 2), Math.sin(theta / 2))],
  ]);
}

/**
 * The general single-qubit gate, in the (θ, φ, λ) convention.
 *
 * **THIS IS A DOCUMENTED POINT OF ECOSYSTEM DIVERGENCE.** Different libraries
 * differ by a global phase in their "U" — a global phase is unobservable on its
 * own and NOT unobservable once the gate is controlled. So the convention is
 * named, and `knowledge.ts` records the divergence rather than asserting that
 * one library is right.
 */
export function u(theta: number, phi: number, lambda: number): CMatrix {
  const ct = Math.cos(theta / 2);
  const st = Math.sin(theta / 2);
  const e = (a: number, k: number): Amplitude => c(k * Math.cos(a), k * Math.sin(a));
  return fromRows([
    [c(ct, 0), e(lambda, -st)],
    [e(phi, st), e(phi + lambda, ct)],
  ]);
}

/** Phase gate. `p(π) = Z`, `p(π/2) = S`, `p(π/4) = T` — asserted in the tests. */
export function phase(lambda: number): CMatrix {
  return fromRows([
    [one, z],
    [z, c(Math.cos(lambda), Math.sin(lambda))],
  ]);
}

/* ---------------- multi-qubit ---------------- */

/**
 * CONTROL IS BUILT, NOT TYPED OUT. `controlled(U)` embeds any single-qubit U as
 * the lower-right block — so CX, CZ and every controlled rotation come from ONE
 * construction, and a typo in a hand-written 4x4 cannot make one of them
 * silently non-unitary. It also gives §4's "controlled rotations" and
 * "multi-controlled gates" for free rather than as more literals.
 */
export function controlled(target: CMatrix, controls = 1): CMatrix {
  if (target.rows !== target.cols) throw new Error("quantum gates: control needs a square target");
  let m = target;
  for (let i = 0; i < controls; i++) {
    const n = m.rows;
    const dim = 2 * n;
    const d: Amplitude[] = new Array(dim * dim).fill(z);
    for (let r = 0; r < n; r++) d[r * dim + r] = one; // |0><0| (x) I
    for (let r = 0; r < n; r++) {
      for (let k = 0; k < n; k++) d[(n + r) * dim + (n + k)] = m.data[r * n + k];
    }
    m = matrix(dim, dim, d);
  }
  return m;
}

export const CX = controlled(X);
export const CZ = controlled(Z);
export const CY = controlled(Y);
export const CH = controlled(H);
export const CCX = controlled(X, 2);
export const CRX = (t: number) => controlled(rx(t));
export const CRY = (t: number) => controlled(ry(t));
export const CRZ = (t: number) => controlled(rz(t));
export const CPHASE = (l: number) => controlled(phase(l));
/** n controls on X. §4's "multi-controlled gates", from the same builder. */
export const MCX = (controls: number) => controlled(X, controls);

export const SWAP = fromRows([
  [one, z, z, z],
  [z, z, one, z],
  [z, one, z, z],
  [z, z, z, one],
]);

export const ISWAP = fromRows([
  [one, z, z, z],
  [z, z, c(0, 1), z],
  [z, c(0, 1), z, z],
  [z, z, z, one],
]);

/** Controlled-SWAP (Fredkin), built rather than written out. */
export const CSWAP = controlled(SWAP);

/* ---------------- the registry ---------------- */

/**
 * §4's table. Every fixed gate appears; the parameterised ones are checked over
 * a swept domain in the tests, because a registry entry can only hold one
 * instantiation and the CLAIM is about all of them.
 */
export const GATES: Readonly<Record<string, GateSpec>> = Object.freeze({
  I: spec("I", I1, {
    qubits: 1,
    notes: "identity; the only gate that is both trivial and essential",
  }),
  X: spec("X", X, {
    qubits: 1,
    decomposition: ["H", "Z", "H"],
    native: ["superconducting", "trapped-ion", "neutral-atom"],
    notes: "Pauli-X, a bit flip; Hermitian and involutory",
  }),
  Y: spec("Y", Y, {
    qubits: 1,
    decomposition: ["S", "X", "SDG"],
    native: ["superconducting", "trapped-ion"],
  }),
  Z: spec("Z", Z, { qubits: 1, decomposition: ["H", "X", "H"], native: ["superconducting"] }),
  H: spec("H", H, {
    qubits: 1,
    decomposition: ["RY(pi/2)", "X"],
    notes: "maps computational basis to the X basis; Hermitian and involutory",
  }),
  S: spec("S", S, { qubits: 1, decomposition: ["T", "T"], notes: "phase pi/2; S^2 = Z" }),
  SDG: spec("SDG", SDG, { qubits: 1, notes: "inverse of S" }),
  T: spec("T", T, {
    qubits: 1,
    notes: "phase pi/4; NOT Clifford — the gate whose count drives fault-tolerant cost",
  }),
  TDG: spec("TDG", TDG, { qubits: 1, notes: "inverse of T" }),
  SX: spec("SX", SX, { qubits: 1, native: ["superconducting"], notes: "sqrt(X); SX^2 = X" }),
  SXDG: spec("SXDG", SXDG, { qubits: 1 }),
  CX: spec("CX", CX, {
    qubits: 2,
    controls: 1,
    decomposition: ["H(t)", "CZ", "H(t)"],
    native: ["superconducting", "trapped-ion"],
    notes: "entangling; with single-qubit rotations it is universal",
  }),
  CY: spec("CY", CY, { qubits: 2, controls: 1 }),
  CZ: spec("CZ", CZ, { qubits: 2, controls: 1, native: ["superconducting", "neutral-atom"] }),
  CH: spec("CH", CH, { qubits: 2, controls: 1 }),
  SWAP: spec("SWAP", SWAP, {
    qubits: 2,
    decomposition: ["CX(0,1)", "CX(1,0)", "CX(0,1)"],
    notes: "three CX; the cost that routing tries to avoid",
  }),
  ISWAP: spec("ISWAP", ISWAP, { qubits: 2, native: ["superconducting"] }),
  CCX: spec("CCX", CCX, {
    qubits: 3,
    controls: 2,
    decomposition: ["6 CX + 7 T/TDG + 2 H"],
    notes: "Toffoli; classically universal, and its T-count is why QEC cares",
  }),
  CSWAP: spec("CSWAP", CSWAP, { qubits: 3, controls: 1, notes: "Fredkin" }),
});

export const GATE_NAMES: readonly string[] = Object.keys(GATES).sort();

/** Embed a 1-qubit gate on `target` within an `n`-qubit register. */
export function onQubit(g: CMatrix, target: number, n: number): CMatrix {
  if (g.rows !== 2) throw new Error("quantum gates: onQubit takes a single-qubit gate");
  if (target < 0 || target >= n)
    throw new Error(`quantum gates: qubit ${target} outside 0..${n - 1}`);
  let m = identity(1);
  for (let i = 0; i < n; i++) m = kron(m, i === target ? g : I1);
  return m;
}
