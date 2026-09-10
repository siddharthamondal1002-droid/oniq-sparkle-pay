/**
 * COMPLEX LINEAR ALGEBRA — the executable half of the Quantum Knowledge
 * Substrate, and the reason the rest of it is knowledge rather than prose.
 *
 * The quantum brief §3 asks every mathematical object to carry "definition,
 * notation, constraints, invariants, examples, counterexamples". An INVARIANT
 * that nothing can check is a sentence; §4's "Add automated invariant tests" is
 * only satisfiable if unitarity, Hermiticity and CPTP are FUNCTIONS. So they
 * are, and the gate library's every entry is checked against them.
 *
 * DENSE, ROW-MAJOR, ZERO DEPENDENCIES. `package.json` is Lovable's — every
 * dependency is a paid round trip — and a dense complex matrix is a hundred
 * lines. Nothing here is fast; everything here is checkable, which is the trade
 * the brief's §25 asks for ("keeps the production dependency graph small").
 */
import {
  type Amplitude,
  C_ONE,
  C_ZERO,
  cAdd,
  cConj,
  cMul,
  cNorm2,
  cScale,
  cSub,
} from "../../math/complex.ts";

/** Row-major. `rows * cols` entries; `at(m, r, k)` is the only accessor. */
export type CMatrix = {
  readonly rows: number;
  readonly cols: number;
  readonly data: readonly Amplitude[];
};

export function matrix(rows: number, cols: number, data: readonly Amplitude[]): CMatrix {
  if (data.length !== rows * cols) {
    throw new Error(
      `quantum linalg: ${rows}x${cols} needs ${rows * cols} entries, got ${data.length}`,
    );
  }
  return { rows, cols, data };
}

export const at = (m: CMatrix, r: number, k: number): Amplitude => m.data[r * m.cols + k];

export function identity(n: number): CMatrix {
  const d: Amplitude[] = [];
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) d.push(r === k ? C_ONE : C_ZERO);
  return matrix(n, n, d);
}

export function zeros(rows: number, cols: number): CMatrix {
  return matrix(
    rows,
    cols,
    Array.from({ length: rows * cols }, () => C_ZERO),
  );
}

export function mul(a: CMatrix, b: CMatrix): CMatrix {
  if (a.cols !== b.rows) {
    throw new Error(`quantum linalg: cannot multiply ${a.rows}x${a.cols} by ${b.rows}x${b.cols}`);
  }
  const d: Amplitude[] = [];
  for (let r = 0; r < a.rows; r++) {
    for (let k = 0; k < b.cols; k++) {
      let sum = C_ZERO;
      for (let i = 0; i < a.cols; i++) sum = cAdd(sum, cMul(at(a, r, i), at(b, i, k)));
      d.push(sum);
    }
  }
  return matrix(a.rows, b.cols, d);
}

export function add(a: CMatrix, b: CMatrix): CMatrix {
  if (a.rows !== b.rows || a.cols !== b.cols) throw new Error("quantum linalg: shape mismatch");
  return matrix(
    a.rows,
    a.cols,
    a.data.map((x, i) => cAdd(x, b.data[i])),
  );
}

export function sub(a: CMatrix, b: CMatrix): CMatrix {
  if (a.rows !== b.rows || a.cols !== b.cols) throw new Error("quantum linalg: shape mismatch");
  return matrix(
    a.rows,
    a.cols,
    a.data.map((x, i) => cSub(x, b.data[i])),
  );
}

export function scale(a: CMatrix, k: number): CMatrix {
  return matrix(
    a.rows,
    a.cols,
    a.data.map((x) => cScale(x, k)),
  );
}

/** Conjugate transpose. `dagger` rather than `adjoint` — the physics name. */
export function dagger(m: CMatrix): CMatrix {
  const d: Amplitude[] = [];
  for (let r = 0; r < m.cols; r++) {
    for (let k = 0; k < m.rows; k++) d.push(cConj(at(m, k, r)));
  }
  return matrix(m.cols, m.rows, d);
}

export function trace(m: CMatrix): Amplitude {
  if (m.rows !== m.cols) throw new Error("quantum linalg: trace needs a square matrix");
  let t = C_ZERO;
  for (let i = 0; i < m.rows; i++) t = cAdd(t, at(m, i, i));
  return t;
}

/**
 * THE KRONECKER PRODUCT, and the ORDER CONVENTION IS LOAD-BEARING.
 *
 * `kron(A, B)` puts A on the MORE SIGNIFICANT qubit — index = a*dimB + b — so a
 * two-qubit basis reads |q0 q1> with q0 leftmost, and `CX` below has control on
 * qubit 0. Qiskit's textbook ordering is the opposite (little-endian, q0 on the
 * RIGHT), which is a genuine, documented divergence between ecosystems.
 *
 * That is exactly the case §23 of the brief covers: "Where two libraries
 * disagree, preserve both implementations and explicitly record the difference.
 * Never silently normalize conflicting semantics." So the convention is NAMED
 * here, asserted in the tests, and recorded as a `divergent_by_design` conflict
 * in the knowledge graph rather than quietly picked.
 */
export const QUBIT_ORDER = "big-endian: kron(A,B) places A on the lower qubit index" as const;

export function kron(a: CMatrix, b: CMatrix): CMatrix {
  const rows = a.rows * b.rows;
  const cols = a.cols * b.cols;
  const d: Amplitude[] = new Array(rows * cols);
  for (let ar = 0; ar < a.rows; ar++) {
    for (let ac = 0; ac < a.cols; ac++) {
      const av = at(a, ar, ac);
      for (let br = 0; br < b.rows; br++) {
        for (let bc = 0; bc < b.cols; bc++) {
          d[(ar * b.rows + br) * cols + (ac * b.cols + bc)] = cMul(av, at(b, br, bc));
        }
      }
    }
  }
  return matrix(rows, cols, d);
}

export function kronAll(ms: readonly CMatrix[]): CMatrix {
  if (ms.length === 0) return identity(1);
  return ms.reduce((acc, m) => kron(acc, m));
}

export const DEFAULT_TOL = 1e-10;

export function approxEqual(a: CMatrix, b: CMatrix, tol = DEFAULT_TOL): boolean {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  return a.data.every(
    (x, i) => Math.abs(x.re - b.data[i].re) < tol && Math.abs(x.im - b.data[i].im) < tol,
  );
}

/* ------------------------------------------------------------------ *
 * THE INVARIANTS. Each is the brief's own word, made checkable.
 * ------------------------------------------------------------------ */

/** U†U = I. The defining property of a gate; §4 records it per entry. */
export function isUnitary(m: CMatrix, tol = DEFAULT_TOL): boolean {
  if (m.rows !== m.cols) return false;
  return approxEqual(mul(dagger(m), m), identity(m.rows), tol);
}

/** H† = H. Observables are Hermitian; §3's "observable" depends on this. */
export function isHermitian(m: CMatrix, tol = DEFAULT_TOL): boolean {
  if (m.rows !== m.cols) return false;
  return approxEqual(dagger(m), m, tol);
}

/** P² = P. A projector. Used by measurement and by the QEC stabilisers. */
export function isProjector(m: CMatrix, tol = DEFAULT_TOL): boolean {
  return isHermitian(m, tol) && approxEqual(mul(m, m), m, tol);
}

/**
 * x†Mx >= 0 for all x — checked on the EIGENVALUES, not sampled. A density
 * matrix that merely "looked positive on some vectors" is the counterexample
 * §3 asks every object to carry, so the test must be exact rather than
 * probabilistic.
 */
export function isPositiveSemidefinite(m: CMatrix, tol = DEFAULT_TOL): boolean {
  if (!isHermitian(m, tol)) return false;
  return eigenvaluesHermitian(m, tol).every((v) => v > -Math.max(tol, 1e-9));
}

/**
 * EIGENVALUES OF A HERMITIAN MATRIX by cyclic Jacobi rotations on the real
 * symmetric embedding.
 *
 * A complex Hermitian H = A + iB with A symmetric and B antisymmetric embeds as
 * the 2n x 2n real symmetric [[A, -B], [B, A]], whose eigenvalues are exactly
 * those of H, EACH TWICE. So the doubling is halved at the end — and that
 * halving is the step a naive implementation forgets, which shows up as an
 * entropy of exactly 2x the right answer.
 *
 * Jacobi rather than QR because it is short, has no pivoting to get wrong, and
 * is accurate for the small dense matrices this substrate deals in — a 5-qubit
 * density matrix is 32x32.
 */
export function eigenvaluesHermitian(m: CMatrix, tol = DEFAULT_TOL): number[] {
  if (m.rows !== m.cols) throw new Error("quantum linalg: eigenvalues need a square matrix");
  const n = m.rows;
  const N = 2 * n;
  const a: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      const v = at(m, r, k);
      a[r][k] = v.re;
      a[r + n][k + n] = v.re;
      a[r][k + n] = -v.im;
      a[r + n][k] = v.im;
    }
  }
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < N; p++) for (let q = p + 1; q < N; q++) off += a[p][q] * a[p][q];
    if (Math.sqrt(off) < tol * 1e-2) break;
    for (let p = 0; p < N; p++) {
      for (let q = p + 1; q < N; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cth = 1 / Math.sqrt(t * t + 1);
        const s = t * cth;
        for (let i = 0; i < N; i++) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = cth * aip - s * aiq;
          a[i][q] = s * aip + cth * aiq;
        }
        for (let i = 0; i < N; i++) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = cth * api - s * aqi;
          a[q][i] = s * api + cth * aqi;
        }
      }
    }
  }
  const doubled = Array.from({ length: N }, (_, i) => a[i][i]).sort((x, y) => x - y);
  // Every eigenvalue appears twice in the real embedding — take every second.
  return doubled.filter((_, i) => i % 2 === 0);
}

/** Frobenius norm, for a distance that does not need eigenvalues. */
export function frobenius(m: CMatrix): number {
  return Math.sqrt(m.data.reduce((s, x) => s + cNorm2(x), 0));
}
