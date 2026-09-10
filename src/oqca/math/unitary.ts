/**
 * OQCA v1.1 — two-level unitaries, correct BY CONSTRUCTION.
 *
 * WHAT CHANGED FROM v1.0, STATED PRECISELY, BECAUSE THE HEADLINE IS EASY TO
 * OVERSTATE. v1.0's `interfere` was ALREADY unitary and `assertUnitary2`
 * checked it on every call — the v1.0 correction was exactly that. What it was
 * NOT is unitary by construction: it built the spec's non-unitary
 *
 *     M = [[1, s], [-s, 1]]        M-dagger M = (1 + s^2) I
 *
 * and then rescued it with a factor k = 1/sqrt(1+s^2). The result is a valid
 * rotation, but the OPERATOR a reader sees is an invalid matrix plus a repair,
 * and the brief is right that this is the wrong object to hand a circuit
 * compiler. So v1.1 parameterises by the ANGLE instead:
 *
 *     R(theta) = [[cos t, -sin t], [sin t, cos t]]
 *
 * and there is nothing to normalize. MEASURED, so the swap is not taken on
 * faith: cos(atan s) equals 1/sqrt(1+s^2) and sin(atan s) equals s/sqrt(1+s^2)
 * to within 1 ulp for every strength the benchmark uses (max |diff| 1.11e-16),
 * which is why the v1.0 result reproduces through the change.
 *
 * THE COMPLEX CASE IS NOT A ROTATION, and pretending otherwise would be the
 * same class of error. A general two-level unitary carries a relative phase:
 *
 *     U(theta, phi) = [[ cos t          , -e^{-i.phi} sin t ],
 *                      [ e^{i.phi} sin t,  cos t            ]]
 *
 * U-dagger U = I EXACTLY for every real theta and phi — verified numerically to
 * 15 decimals at three (theta, phi) pairs before this file was written, and
 * asserted over a swept grid in `unitary.test.ts`. phi = 0 recovers R(theta).
 *
 * A NOTE ON SCOPE, so nobody reads more into this than it says: these are
 * 2x2 blocks embedded in a real-vector-space simulation. They are the shape a
 * circuit compiler could accept (see `backends/`), and that is a NECESSARY
 * condition for the brief's QPU path, not a sufficient one. Nothing here has
 * been near a circuit.
 */
import { type Amplitude, C_ONE, C_ZERO, cAdd, cConj, cExpI, cMul, cScale } from "./complex";

/** A 2x2 complex matrix in row-major order: [m00, m01, m10, m11]. */
export type Unitary2 = readonly [Amplitude, Amplitude, Amplitude, Amplitude];

/** How far from unitary a matrix may be and still be accepted. */
export const UNITARY_TOLERANCE = 1e-9;

/** U-dagger: conjugate transpose. */
export function dagger(u: Unitary2): Unitary2 {
  return [cConj(u[0]), cConj(u[2]), cConj(u[1]), cConj(u[3])];
}

export function matMul2(a: Unitary2, b: Unitary2): Unitary2 {
  return [
    cAdd(cMul(a[0], b[0]), cMul(a[1], b[2])),
    cAdd(cMul(a[0], b[1]), cMul(a[1], b[3])),
    cAdd(cMul(a[2], b[0]), cMul(a[3], b[2])),
    cAdd(cMul(a[2], b[1]), cMul(a[3], b[3])),
  ];
}

/**
 * How far U-dagger U is from the identity, as a single number (max element
 * deviation). Returned rather than thrown so a caller can RECORD the residual
 * — `TransitionRecord.normError` carries it, which is how a drift becomes
 * visible in a log instead of only at the moment it crosses a threshold.
 */
export function unitarityResidual(u: Unitary2): number {
  const p = matMul2(dagger(u), u);
  const target: Unitary2 = [C_ONE, C_ZERO, C_ZERO, C_ONE];
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.abs(p[i].re - target[i].re), Math.abs(p[i].im - target[i].im));
  }
  return worst;
}

export function isUnitary2(u: Unitary2, tol = UNITARY_TOLERANCE): boolean {
  return unitarityResidual(u) <= tol;
}

export class NonUnitaryOperatorError extends Error {
  constructor(readonly residual: number) {
    super(`OQCA: operator is not unitary (U-dagger U differs from I by ${residual})`);
    this.name = "NonUnitaryOperatorError";
  }
}

export function assertUnitary2(u: Unitary2, tol = UNITARY_TOLERANCE): Unitary2 {
  const r = unitarityResidual(u);
  if (!(r <= tol)) throw new NonUnitaryOperatorError(r);
  return u;
}

/**
 * WHICH WAY A POSITIVE ANGLE MOVES AMPLITUDE. Stated once, here, because two
 * functions in this repo were briefly named `interfere` with OPPOSITE
 * orientations and the benchmark caught it by scoring 0% where chance is 50% —
 * a systematic inversion rather than noise.
 *
 * MEASURED with equal in-phase amplitudes and theta = atan(0.9):
 *
 *     applyPair(rotation(+theta), m, m)  ->  (0.074329 m, 1.412259 m)
 *
 * so a POSITIVE angle transfers amplitude from the FIRST index toward the
 * SECOND. `interfere(state, a, b, +theta)` therefore favours `b`, and v1.0's
 * `strength` convention — which favours the first-named — is the MIRROR, which
 * is why `gates.ts` passes a negated angle. Both are pinned by
 * `orientation.test.ts`; neither may drift without that test going red.
 */
export const ROTATION_TRANSFERS_TOWARD = "second" as const;

/**
 * A real rotation by `theta`. Unitary for every finite theta with nothing to
 * normalize — the whole point of the v1.1 change. See
 * `ROTATION_TRANSFERS_TOWARD` above for which way a positive angle moves mass.
 */
export function rotation(theta: number): Unitary2 {
  if (!Number.isFinite(theta)) throw new Error("OQCA: rotation angle must be finite");
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [c2(ct), c2(-st), c2(st), c2(ct)];
}

/**
 * The general two-level unitary: a rotation by `theta` with the off-diagonal
 * carrying relative phase `phi`. phi = 0 is exactly `rotation(theta)`.
 */
export function mixing(theta: number, phi: number): Unitary2 {
  if (!Number.isFinite(theta) || !Number.isFinite(phi)) {
    throw new Error("OQCA: mixing angles must be finite");
  }
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [c2(ct), cScale(cExpI(-phi), -st), cScale(cExpI(phi), st), c2(ct)];
}

/** diag(1, e^{i.theta}) — a relative phase on the second member of the pair. */
export function relativePhase(theta: number): Unitary2 {
  if (!Number.isFinite(theta)) throw new Error("OQCA: phase angle must be finite");
  return [C_ONE, C_ZERO, C_ZERO, cExpI(theta)];
}

/** The two-level identity. Useful as a no-op branch that is still an operator. */
export function identity2(): Unitary2 {
  return [C_ONE, C_ZERO, C_ZERO, C_ONE];
}

/**
 * The inverse of a unitary IS its dagger — no solve, no division. Exposed so
 * reversibility is expressible as an operation rather than as a special case:
 * `apply(inverse(u), apply(u, x))` returns x.
 */
export function inverse(u: Unitary2): Unitary2 {
  return dagger(u);
}

/**
 * Apply `u` to the pair (x, y) and return the new pair. This is the ONLY place
 * amplitudes move, which is what lets every gate above it be a choice of
 * matrix rather than a hand-written arithmetic edit.
 */
export function applyPair(
  u: Unitary2,
  x: Amplitude,
  y: Amplitude,
): readonly [Amplitude, Amplitude] {
  return [cAdd(cMul(u[0], x), cMul(u[1], y)), cAdd(cMul(u[2], x), cMul(u[3], y))];
}

/**
 * The v1.0 `strength` parameterisation, kept as an explicit CONVERSION rather
 * than as a second code path. `strength` was tan(theta): a caller who says 0.9
 * means 42 degrees. Converting here means the legacy benchmark tasks keep
 * their numbers and the operator underneath them is a rotation by
 * construction, and `benchmark.test.ts`'s pinned figures prove the equality.
 */
export function angleFromStrength(strength: number): number {
  if (!Number.isFinite(strength)) throw new Error("OQCA: strength must be finite");
  return Math.atan(strength);
}

function c2(re: number): Amplitude {
  return { re, im: 0 };
}
