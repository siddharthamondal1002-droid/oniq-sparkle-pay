/**
 * OQCA — the CONTROL. A plain Bayesian belief vector with the same interface.
 *
 * This exists so the benchmark can answer the only question that matters:
 * does the amplitude representation beat an ordinary probability vector on
 * anything? Without a control, any OQCA number reads as a success — which is
 * the trap CLAUDE.md records for the Vertex voice probe, where the experiment
 * and the control failed identically and only the control revealed it.
 *
 * It is deliberately the STRONGEST simple baseline, not a strawman: exact
 * Bayes with the same likelihoods the OQCA path is given. Beating a weak
 * control proves nothing.
 */

export type Belief = { readonly labels: readonly string[]; readonly p: readonly number[] };

export function beliefFromWeights(labels: readonly string[], weights: readonly number[]): Belief {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new Error("OQCA baseline: weights must sum above zero");
  return { labels: [...labels], p: weights.map((w) => w / sum) };
}

/** Exact Bayes. Note it is COMMUTATIVE: the order of updates cannot matter. */
export function bayesUpdate(b: Belief, likelihoods: readonly number[]): Belief {
  if (likelihoods.length !== b.p.length) throw new Error("OQCA baseline: one likelihood each");
  const raw = b.p.map((p, i) => p * likelihoods[i]);
  const sum = raw.reduce((a, x) => a + x, 0);
  if (!(sum > 0)) throw new Error("OQCA baseline: evidence ruled out every hypothesis");
  return { labels: b.labels, p: raw.map((x) => x / sum) };
}

export function beliefArgmax(b: Belief): { label: string; probability: number } {
  let best = 0;
  for (let i = 1; i < b.p.length; i++) if (b.p[i] > b.p[best]) best = i;
  return { label: b.labels[best], probability: b.p[best] };
}
