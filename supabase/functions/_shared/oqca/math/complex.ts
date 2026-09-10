/**
 * OQCA v1.1 — the complex field, extracted so the physical layer has a floor
 * that knows nothing about hypotheses, evidence or cognition.
 *
 * v1.0 kept these in `state.ts` beside the belief vector. The separation the
 * v1.1 brief asks for (QuantumOperator -> CognitiveGate) only means anything if
 * the bottom layer cannot see the top: nothing in this file may import from
 * outside `math/`, and `unitary.test.ts` asserts that.
 */

/** A complex number. A plain pair so the module needs no dependency. */
export type Amplitude = { readonly re: number; readonly im: number };

export const c = (re: number, im = 0): Amplitude => ({ re, im });

export const cAdd = (a: Amplitude, b: Amplitude): Amplitude => ({
  re: a.re + b.re,
  im: a.im + b.im,
});

export const cSub = (a: Amplitude, b: Amplitude): Amplitude => ({
  re: a.re - b.re,
  im: a.im - b.im,
});

export const cMul = (a: Amplitude, b: Amplitude): Amplitude => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const cScale = (a: Amplitude, k: number): Amplitude => ({ re: a.re * k, im: a.im * k });

/** Complex conjugate — the operation that makes U-dagger a dagger. */
export const cConj = (a: Amplitude): Amplitude => ({ re: a.re, im: -a.im });

/** |a|^2 — the Born probability of one basis state. */
export const cNorm2 = (a: Amplitude): number => a.re * a.re + a.im * a.im;

export const cAbs = (a: Amplitude): number => Math.hypot(a.re, a.im);

/** e^{i.theta}. The only place a phase is turned into a number pair. */
export const cExpI = (theta: number): Amplitude => ({
  re: Math.cos(theta),
  im: Math.sin(theta),
});

/** arg(a) in (-pi, pi]. Undefined for the zero amplitude; returns 0 there. */
export const cArg = (a: Amplitude): number =>
  a.re === 0 && a.im === 0 ? 0 : Math.atan2(a.im, a.re);

export const cIsFinite = (a: Amplitude): boolean => Number.isFinite(a.re) && Number.isFinite(a.im);

export const cEq = (a: Amplitude, b: Amplitude, tol = 1e-12): boolean =>
  Math.abs(a.re - b.re) <= tol && Math.abs(a.im - b.im) <= tol;

export const C_ZERO: Amplitude = { re: 0, im: 0 };
export const C_ONE: Amplitude = { re: 1, im: 0 };
