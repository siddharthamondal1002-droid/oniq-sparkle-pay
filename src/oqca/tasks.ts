/**
 * OQCA — the benchmark suite. Owner brief 2026-09-10, section 26.
 *
 * FIVE OF THESE SEVEN ARE BUILT SO OQCA CANNOT WIN THEM, and that is the
 * design. On any task using only `reweight`, OQCA is Bayes exactly, so a tie is
 * the correct outcome and a win would mean the harness is broken. Only where a
 * caller supplies PHASE can the two representations differ at all.
 *
 * THE ONE DIVERGENT ROW IS NOT OQCA REASONING BETTER, and the suite is written
 * so that cannot be misread. On task 6 OQCA is handed a third fact — as a
 * half-turn of phase — that Bayes is never given, and Bayes therefore ends at a
 * dead tie it must break by index order. That is a CHANNEL, not an inference:
 * `benchmark.test.ts` proves an informed Bayes, given the same fact as an
 * ordinary likelihood, reaches the same answer at higher confidence. Read the
 * score as "the amplitude state has somewhere to put this fact", never as
 * "OQCA is more accurate".
 *
 * AND THE NAMES WERE WRONG BEFORE THEY WERE MEASURED. Tasks 5–7 were called
 * "ORDER MATTERS"; reversing their two steps returns a byte-identical posterior,
 * because a `reweight` that scales both members of the interfering pair by the
 * SAME likelihood is a scalar on that 2-D subspace and commutes with the
 * rotation. Genuine order-sensitivity needs the pair reweighted UNEQUALLY, which
 * `benchmark.test.ts` measures directly and no scored task here claims.
 *
 * WHAT THESE TASKS ARE NOT. They are synthetic, constructed here, and small.
 * They test the MECHANISM — does a phase change an answer, and in which
 * direction — and they say nothing about real reasoning. CLAUDE.md's standing
 * warning applies in full: "every test that proved them ran against a fixture
 * invented here". A real verdict needs real decisions, which is a replay corpus
 * and not this file.
 */
import type { Task } from "./benchmark.ts";

const L3 = ["A", "B", "C"] as const;

export const TASKS: readonly Task[] = [
  {
    name: "flat prior, one decisive observation",
    labels: L3,
    prior: [1, 1, 1],
    steps: [{ likelihoods: [0.8, 0.1, 0.1] }],
    truth: "A",
    rationale:
      "The control case. Reweight is Bayes, so both must land on A. If they ever disagree here the harness is wrong, not the models.",
  },
  {
    name: "strong prior overturned by evidence",
    labels: L3,
    prior: [8, 1, 1],
    steps: [{ likelihoods: [0.02, 0.9, 0.05] }, { likelihoods: [0.05, 0.9, 0.05] }],
    truth: "B",
    rationale: "Both should overturn the prior. A tie is the expected result.",
  },
  {
    name: "weak evidence must not overturn a strong prior",
    labels: L3,
    prior: [20, 1, 1],
    steps: [{ likelihoods: [0.4, 0.6, 0.5] }],
    truth: "A",
    rationale:
      "The failure mode in the other direction — a model that lurches on one weak signal. Both should hold A.",
  },
  {
    name: "accumulating weak evidence does overturn it",
    labels: L3,
    prior: [10, 1, 1],
    steps: [
      { likelihoods: [0.3, 0.7, 0.5] },
      { likelihoods: [0.3, 0.7, 0.5] },
      { likelihoods: [0.3, 0.7, 0.5] },
      { likelihoods: [0.3, 0.7, 0.5] },
      { likelihoods: [0.2, 0.8, 0.5] },
    ],
    truth: "B",
    rationale: "Enough weak evidence should move both. Still a tie.",
  },
  {
    name: "CONTEXT: corroboration sharpens an answer both models already have",
    labels: L3,
    prior: [1, 1, 1],
    steps: [
      { likelihoods: [0.6, 0.4, 0.2], phases: [0, 0, 0] },
      // Two readings arrive IN PHASE — the caller is saying they agree. Bayes
      // has nowhere to record "these corroborated"; it only multiplies.
      { likelihoods: [0.6, 0.4, 0.2], phases: [0, 0, 0], interfere: [0, 1, 0.35] },
    ],
    truth: "A",
    rationale:
      "MEASURED: Bayes ends at A 0.6429, OQCA at A 0.8711 — same answer, more confidence. Both are correct, so this row is a TIE and scores nothing. It is here to catch a mis-signed constructive interference: if OQCA ever LOSES this one, `interfere` is rotating the wrong way.",
  },
  {
    name: "CONTEXT: a tie the likelihoods cannot break, and a fact that breaks it",
    labels: L3,
    prior: [1, 1, 1],
    steps: [
      { likelihoods: [0.5, 0.5, 0.2], phases: [0, 0, 0] },
      // Two instruments report the SAME numbers, so the likelihoods cannot
      // separate A from B at all. A third fact — which Bayes has no channel for
      // — enters as a half-turn on B, and the pair then interferes.
      { likelihoods: [0.5, 0.5, 0.2], phases: [0, Math.PI, 0], interfere: [0, 1, 0.9] },
    ],
    truth: "B",
    rationale:
      "The ONE divergent row, and the only one that scores. MEASURED: Bayes reaches a dead tie (A = B = 0.4630) and breaks it by index order, landing on A. OQCA reaches B at 0.9234. The truth label is B because the extra fact says so — which is exactly why this proves a CHANNEL and not an inference. Paired with task 7: the identical likelihoods with the fact ABSENT send OQCA to A instead, so the phase carries a bit rather than a bias.",
  },
  {
    name: "CONTEXT: the same tie, with the fact absent",
    labels: L3,
    prior: [1, 1, 1],
    steps: [
      { likelihoods: [0.5, 0.5, 0.2], phases: [0, 0, 0] },
      // Byte-identical likelihoods to the task above, and no phase at all.
      { likelihoods: [0.5, 0.5, 0.2], phases: [0, 0, 0], interfere: [0, 1, 0.9] },
    ],
    truth: "A",
    rationale:
      "The other half of the pair, and both models are correct so it scores nothing. MEASURED: OQCA A 0.9234, the mirror of task 6, on likelihoods that are byte-identical to it. That is the whole demonstrable claim — the phase changed the ANSWER, not merely the confidence. The confidence itself is NOT a result: on a genuine tie it comes from the operator's orientation, and `benchmark.test.ts` measures that naming the pair (B, A) instead of (A, B) hands back B at the same 0.9234 from identical evidence.",
  },
];
