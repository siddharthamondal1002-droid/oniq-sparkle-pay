/**
 * OQCA v1.1 — statistics. Brief section 8: "Do not rely on one 7-6 run."
 *
 * THE TEST IS PAIRED, AND THAT IS THE ONE DESIGN DECISION THAT MATTERS HERE.
 * Both models see the SAME trial, so their outcomes are not independent
 * samples; comparing two independent proportions would throw away the pairing
 * and inflate the interval. Exact McNemar is the right test for paired binary
 * outcomes, and it is EXACT rather than the chi-square approximation because
 * these runs have tens of trials, not thousands, and the approximation is poor
 * exactly there.
 *
 * Only the DISCORDANT pairs carry information: b = OQCA right where the control
 * was wrong, c = the reverse. Trials both got right, or both wrong, say nothing
 * about which is better and are excluded by construction. When b + c = 0 the
 * honest answer is "no evidence either way", and `pValue` is 1 — not a small
 * number produced by dividing by zero.
 *
 * NO DEPENDENCY. Everything here is closed-form or a bounded loop, so the
 * numbers are reproducible on any runtime and there is no version to pin.
 */

export type PairedOutcome = { readonly oqca: boolean; readonly control: boolean };

export type ComparisonStats = {
  readonly trials: number;
  readonly oqcaCorrect: number;
  readonly controlCorrect: number;
  readonly oqcaAccuracy: number;
  readonly controlAccuracy: number;
  readonly difference: number;
  /** 95% Wilson interval on each accuracy — asymmetric, and correct near 0/1. */
  readonly oqcaInterval: readonly [number, number];
  readonly controlInterval: readonly [number, number];
  /** Discordant counts. b + c = 0 means the two models never disagreed. */
  readonly discordantOqcaOnly: number;
  readonly discordantControlOnly: number;
  /** Cohen's h. |h| < 0.2 small, < 0.5 medium, >= 0.8 large (Cohen's own bands). */
  readonly effectSize: number;
  /** Exact two-sided McNemar. 1 when there are no discordant pairs. */
  readonly pValue: number;
  /** The sentence a reader gets. Never says "advantage" without the numbers. */
  readonly verdict: string;
};

/** log(n!) by direct summation — exact for the sizes a benchmark run reaches. */
function logFactorial(n: number): number {
  let s = 0;
  for (let k = 2; k <= n; k++) s += Math.log(k);
  return s;
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** P(X <= k) for X ~ Binomial(n, 1/2). Exact. */
export function binomialCdfHalf(k: number, n: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, sum);
}

/**
 * Exact two-sided McNemar on the discordant counts. Under the null, each
 * discordant pair is a fair coin, so the two-sided p is twice the lower tail.
 */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const lower = Math.min(b, c);
  return Math.min(1, 2 * binomialCdfHalf(lower, n));
}

/** 95% Wilson score interval. Correct at 0 and 1, where the normal one is not. */
export function wilsonInterval(successes: number, n: number, z = 1.959963985): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Cohen's h for two proportions — the standard effect size for this shape. */
export function cohensH(p1: number, p2: number): number {
  const phi = (p: number) => 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, p))));
  return phi(p1) - phi(p2);
}

/** The significance level every verdict in this subsystem is written against. */
export const ALPHA = 0.05;

export function comparePaired(outcomes: readonly PairedOutcome[]): ComparisonStats {
  const trials = outcomes.length;
  const oqcaCorrect = outcomes.filter((o) => o.oqca).length;
  const controlCorrect = outcomes.filter((o) => o.control).length;
  const b = outcomes.filter((o) => o.oqca && !o.control).length;
  const c = outcomes.filter((o) => !o.oqca && o.control).length;
  const pa = trials === 0 ? 0 : oqcaCorrect / trials;
  const pc = trials === 0 ? 0 : controlCorrect / trials;
  const p = mcnemarExact(b, c);

  // The verdict names the direction ONLY when the test supports one, and says
  // "no measured difference" otherwise. A difference of 1 row with p = 0.5 is
  // exactly the v1.0 headline this brief exists to stop being repeated.
  let verdict: string;
  if (trials === 0) {
    verdict = "NO TRIALS";
  } else if (b + c === 0) {
    verdict = `IDENTICAL on all ${trials} trials — the two models never disagreed`;
  } else if (p > ALPHA) {
    verdict =
      `NO MEASURED DIFFERENCE (${(pa * 100).toFixed(1)}% vs ${(pc * 100).toFixed(1)}%, ` +
      `n=${trials}, discordant ${b}/${c}, p=${p.toFixed(4)} > ${ALPHA})`;
  } else if (pa > pc) {
    verdict =
      `OQCA HIGHER (${(pa * 100).toFixed(1)}% vs ${(pc * 100).toFixed(1)}%, n=${trials}, ` +
      `p=${p.toFixed(4)}, h=${cohensH(pa, pc).toFixed(2)}) — read what information each had`;
  } else {
    verdict =
      `CONTROL HIGHER (${(pc * 100).toFixed(1)}% vs ${(pa * 100).toFixed(1)}%, n=${trials}, ` +
      `p=${p.toFixed(4)}, h=${cohensH(pc, pa).toFixed(2)})`;
  }

  return {
    trials,
    oqcaCorrect,
    controlCorrect,
    oqcaAccuracy: pa,
    controlAccuracy: pc,
    difference: pa - pc,
    oqcaInterval: wilsonInterval(oqcaCorrect, trials),
    controlInterval: wilsonInterval(controlCorrect, trials),
    discordantOqcaOnly: b,
    discordantControlOnly: c,
    effectSize: cohensH(pa, pc),
    pValue: p,
    verdict,
  };
}
