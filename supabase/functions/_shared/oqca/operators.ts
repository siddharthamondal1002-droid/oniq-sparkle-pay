/**
 * OQCA v1.1 — the PHYSICAL layer. Brief section 3.
 *
 *     QuantumOperator   <- this file: valid state transformations, nothing else
 *          |
 *     CognitiveGate     <- cognitive.ts: what a transformation MEANS
 *
 * THE SEPARATION IS ENFORCED, NOT DOCUMENTED. This module may not import from
 * `cognitive.ts`, `formalState.ts`, `knowledge/` or `bench/`; it knows about
 * INDICES into an amplitude vector and never about hypotheses, evidence,
 * confidence or context. `security.test.ts` reads the import graph and fails if
 * that inverts — a layer boundary nothing checks is a comment.
 *
 * EVERY OPERATOR IS NORM-PRESERVING, and the two that are not unitary say so in
 * their own `kind`. A "quantum operator" that is a channel rather than a gate
 * (`project`, `prepare`) is still a legitimate physical operation; calling it a
 * gate is what would be wrong, so the discriminant carries the difference and
 * `isUnitaryOperator` reads it.
 */
import { type Amplitude, cNorm2, cScale, C_ZERO } from "./math/complex.ts";
import {
  type Unitary2,
  applyPair,
  assertUnitary2,
  inverse,
  unitarityResidual,
} from "./math/unitary.ts";

/** A transformation of an amplitude vector, tagged by what kind of map it is. */
export type QuantumOperator =
  /** A two-level unitary on basis indices (i, j). Reversible. */
  | { readonly kind: "pair"; readonly i: number; readonly j: number; readonly u: Unitary2 }
  /** A diagonal unitary: one phase per basis index. Reversible. */
  | { readonly kind: "diagonal"; readonly phases: readonly number[] }
  /** Projection onto a subset, renormalized. A CHANNEL, not a gate: irreversible. */
  | { readonly kind: "project"; readonly keep: readonly number[] }
  /** Prepare a fixed amplitude vector. A CHANNEL: it forgets what came before. */
  | { readonly kind: "prepare"; readonly amplitudes: readonly Amplitude[] }
  /** Dimension-changing isometry: embed into a larger basis. Norm-preserving. */
  | { readonly kind: "embed"; readonly size: number };

export type OperatorKind = QuantumOperator["kind"];

/** True only for the operators that have an inverse. Read, never assumed. */
export function isUnitaryOperator(op: QuantumOperator): boolean {
  return op.kind === "pair" || op.kind === "diagonal" || op.kind === "embed";
}

export class OperatorError extends Error {
  constructor(message: string) {
    super(`OQCA operator: ${message}`);
    this.name = "OperatorError";
  }
}

/** The residual of the underlying unitary, or 0 for the channels. */
export function operatorUnitarityResidual(op: QuantumOperator): number {
  if (op.kind === "pair") return unitarityResidual(op.u);
  return 0;
}

function checkIndex(i: number, n: number, what: string) {
  if (!Number.isInteger(i) || i < 0 || i >= n) {
    throw new OperatorError(`${what} index ${i} is outside 0..${n - 1}`);
  }
}

/**
 * Apply an operator to an amplitude vector. Returns a NEW array; the input is
 * never edited, because replay that shares structure with the run it replays
 * is not replay.
 *
 * NOTHING IS RENORMALIZED HERE except where the map's definition requires it
 * (`project` divides by the surviving norm, which is the Born rule and not a
 * repair). A unitary that needed rescuing would be a bug, and hiding it under a
 * blanket normalize is exactly the v1.0 failure this layer exists to end.
 */
export function applyOperator(amplitudes: readonly Amplitude[], op: QuantumOperator): Amplitude[] {
  const n = amplitudes.length;
  switch (op.kind) {
    case "pair": {
      checkIndex(op.i, n, "pair");
      checkIndex(op.j, n, "pair");
      if (op.i === op.j) throw new OperatorError("a pair operator needs two distinct indices");
      assertUnitary2(op.u);
      const next = amplitudes.map((a) => ({ ...a }));
      const [x, y] = applyPair(op.u, amplitudes[op.i], amplitudes[op.j]);
      next[op.i] = { ...x };
      next[op.j] = { ...y };
      return next;
    }
    case "diagonal": {
      if (op.phases.length !== n) throw new OperatorError("one phase per basis element");
      return amplitudes.map((a, k) => {
        const t = op.phases[k];
        if (!Number.isFinite(t)) throw new OperatorError("phases must be finite");
        const ct = Math.cos(t);
        const st = Math.sin(t);
        return { re: a.re * ct - a.im * st, im: a.re * st + a.im * ct };
      });
    }
    case "project": {
      const keep = new Set(op.keep);
      for (const k of op.keep) checkIndex(k, n, "project");
      if (keep.size === 0) throw new OperatorError("a projection must keep something");
      const kept = amplitudes.map((a, k) => (keep.has(k) ? a : C_ZERO));
      let sum = 0;
      for (const a of kept) sum += cNorm2(a);
      if (!(sum > 0)) throw new OperatorError("projection removed all amplitude");
      const inv = 1 / Math.sqrt(sum);
      return kept.map((a) => cScale(a, inv));
    }
    case "prepare": {
      let sum = 0;
      for (const a of op.amplitudes) sum += cNorm2(a);
      if (!(sum > 0)) throw new OperatorError("cannot prepare a zero state");
      const inv = 1 / Math.sqrt(sum);
      return op.amplitudes.map((a) => cScale(a, inv));
    }
    case "embed": {
      if (!Number.isInteger(op.size) || op.size < n) {
        throw new OperatorError("embed must not shrink the basis");
      }
      const next = amplitudes.map((a) => ({ ...a }));
      while (next.length < op.size) next.push({ ...C_ZERO });
      return next;
    }
    default:
      // NOT UNREACHABLE, WHICH IS THE WHOLE REASON IT IS HERE. The switch is
      // exhaustive over `QuantumOperator`, so `tsc` proves no TYPED caller can
      // land here — and a transition record replayed from JSON is not a typed
      // caller. Without this the function returned `undefined` for an unknown
      // kind and the caller went on to treat it as an amplitude vector. A type
      // that nothing runs is not a guard (CLAUDE.md, 2026-09-10).
      throw new OperatorError(
        `unknown operator kind ${JSON.stringify((op as { kind?: unknown }).kind)}`,
      );
  }
}

/**
 * The inverse operator, where one exists. `project` and `prepare` return null
 * rather than an approximate inverse: a channel that has forgotten which branch
 * it came from cannot be undone, and returning something plausible would let a
 * reversibility test pass on an irreversible map.
 */
export function inverseOperator(op: QuantumOperator): QuantumOperator | null {
  switch (op.kind) {
    case "pair":
      return { kind: "pair", i: op.i, j: op.j, u: inverse(op.u) };
    case "diagonal":
      return { kind: "diagonal", phases: op.phases.map((t) => -t) };
    case "embed":
    case "project":
    case "prepare":
      return null;
    default:
      // Same reasoning as `applyOperator`'s default. Returning null here would
      // be worse than throwing: null is this function's word for "a channel
      // that cannot be undone", so an unknown kind would be reported as a
      // legitimate irreversible operator rather than as the corruption it is.
      throw new OperatorError(
        `unknown operator kind ${JSON.stringify((op as { kind?: unknown }).kind)}`,
      );
  }
}

/** Total probability. 1 for any state this module produced from a valid one. */
export function vectorNorm(amplitudes: readonly Amplitude[]): number {
  let sum = 0;
  for (const a of amplitudes) sum += cNorm2(a);
  return Math.sqrt(sum);
}
