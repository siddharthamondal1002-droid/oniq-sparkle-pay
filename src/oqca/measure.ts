/**
 * OQCA — measurement. Owner brief 2026-09-10, section 10.
 *
 * THE DEFAULT IS NOT SAMPLING, AND THAT IS DELIBERATE. The brief's `measure`
 * draws an index with probability |a_i|^2, which is what physics does. An
 * AGENT choosing an action is not doing physics: sampling proportional to
 * belief means that a hypothesis the state has just decided is 20% likely gets
 * acted on one time in five, forever, with no upside. The brief itself notes
 * in passing that argmax and threshold policies should also exist; this module
 * makes MAXIMUM the default and sampling the option, because a default is a
 * decision and the wrong one here is expensive at the point it becomes an
 * action (CLAUDE.md, 2026-09-05: "a default is not a decision").
 *
 * Sampling still belongs here for exactly one job: exploration, when the loop
 * deliberately wants to test a hypothesis it does not currently favour.
 *
 * DETERMINISM IS A REQUIREMENT, NOT A CONVENIENCE. Milestone 1 asks for
 * replay, so the sampler takes a seeded generator and never touches
 * Math.random. Given the same seed and the same state it returns the same
 * answer on every machine.
 */
import { type CognitiveState, probabilities } from "./state.ts";

export type MeasurementPolicy =
  { kind: "maximum" } | { kind: "sample"; seed: number } | { kind: "threshold"; minimum: number };

export type Measurement = {
  /** The hypothesis chosen, or null when a threshold policy refused. */
  label: string | null;
  probability: number;
  /** The gap to the runner-up. Small means the state has not really decided. */
  margin: number;
  policy: MeasurementPolicy["kind"];
};

/**
 * mulberry32 — a small, well-known, seedable PRNG. Chosen over Math.random
 * because replay needs the sequence to be a function of the seed alone, and
 * over crypto because reproducibility is the requirement here, not secrecy.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ranked(state: CognitiveState) {
  const p = probabilities(state);
  const order = p.map((v, i) => ({ i, v })).sort((x, y) => y.v - x.v);
  return { p, order };
}

export function measure(
  state: CognitiveState,
  policy: MeasurementPolicy = { kind: "maximum" },
): Measurement {
  const { p, order } = ranked(state);
  const top = order[0];
  // With one hypothesis there is no runner-up, and the margin is the whole
  // mass rather than zero: nothing competes with it.
  const margin = order.length > 1 ? top.v - order[1].v : top.v;

  if (policy.kind === "maximum") {
    return { label: state.labels[top.i], probability: top.v, margin, policy: "maximum" };
  }

  if (policy.kind === "threshold") {
    // REFUSING IS A RESULT. A loop that must always name a winner will name
    // one from a state that is 34/33/33, and the caller cannot tell that from
    // a state that is 99/1. Null is how "not decided" reaches the caller.
    if (top.v < policy.minimum) {
      return { label: null, probability: top.v, margin, policy: "threshold" };
    }
    return { label: state.labels[top.i], probability: top.v, margin, policy: "threshold" };
  }

  const rng = seeded(policy.seed);
  const roll = rng();
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    acc += p[i];
    if (roll < acc) {
      return { label: state.labels[i], probability: p[i], margin, policy: "sample" };
    }
  }
  // Only reachable through floating-point shortfall in the accumulation.
  const last = p.length - 1;
  return { label: state.labels[last], probability: p[last], margin, policy: "sample" };
}

/**
 * Shannon entropy in bits — how undecided the state is, independent of which
 * hypothesis leads. The loop uses this to decide whether more evidence is
 * worth acquiring: a state at maximum entropy has learned nothing yet.
 */
export function entropy(state: CognitiveState): number {
  let h = 0;
  for (const v of probabilities(state)) if (v > 0) h -= v * Math.log2(v);
  return h;
}
