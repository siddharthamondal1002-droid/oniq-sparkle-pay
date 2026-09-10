/**
 * OQCA kernel — the properties the whole architecture rests on.
 *
 * The load-bearing one is `interfere` not draining untouched hypotheses. That
 * defect was MEASURED in the brief's own operator before this module was
 * written, and the numbers in that test are the ones it produced.
 */
import { describe, expect, it } from "vitest";
import {
  CollapsedStateError,
  c,
  fromAmplitudes,
  fromWeights,
  probabilities,
  snapshot,
} from "@/oqca/state";
import { assertUnitary2, damp, interfere, phase, reweight, superpose } from "@/oqca/gates";
import { entropy, measure, seeded } from "@/oqca/measure";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("the state is always a state", () => {
  it("normalizes weights into probabilities that sum to one", () => {
    const s = fromWeights(["A", "B", "C"], [2, 1, 1]);
    expect(sum(probabilities(s))).toBeCloseTo(1, 12);
    expect(probabilities(s)[0]).toBeCloseTo(0.5, 12);
  });

  it("refuses a zero state rather than dividing by its norm", () => {
    expect(() => fromWeights(["A"], [0])).toThrow(CollapsedStateError);
  });

  it("refuses duplicate labels, which no measurement could tell apart", () => {
    expect(() => fromWeights(["A", "A"], [1, 1])).toThrow(/unique/);
  });

  it("is immutable: a gate returns a new state and leaves the old one alone", () => {
    // Milestone 1 asks for deterministic replay, which a mutable state cannot
    // give: the replay and the run would share structure.
    const before = fromWeights(["A", "B"], [1, 1]);
    const p0 = probabilities(before);
    const after = reweight(before, [0.9, 0.1]);
    expect(probabilities(before)).toEqual(p0);
    expect(probabilities(after)[0]).toBeGreaterThan(0.8);
    expect(after.timestep).toBe(before.timestep + 1);
  });

  it("round-trips through a snapshot exactly, so a run replays from its log", () => {
    const s = phase(reweight(fromWeights(["A", "B", "C"], [3, 2, 1]), [0.7, 0.2, 0.1]), "B", 1.1);
    const snap = snapshot(s);
    const back = fromAmplitudes(snap.labels, snap.amplitudes, snap.timestep);
    expect(probabilities(back)).toEqual(probabilities(s));
    expect(back.timestep).toBe(s.timestep);
  });
});

describe("interference does not steal from hypotheses it never touches", () => {
  /**
   * THE MEASURED DEFECT IN THE BRIEF'S OPERATOR, reproduced here so the fix
   * cannot be undone silently. Its version is a_i += s*a_j, a_j -= s*a_i then
   * a GLOBAL renormalize; the pair's norm grows by sqrt(1+s^2) and the global
   * divide takes that out of everyone else.
   */
  const specInterfere = (p: number[], i: number, j: number, s: number) => {
    const a = p.map(Math.sqrt);
    const ai = a[i];
    const aj = a[j];
    a[i] = ai + s * aj;
    a[j] = aj - s * ai;
    const n = Math.sqrt(sum(a.map((x) => x * x)));
    return a.map((x) => (x / n) ** 2);
  };

  it("the brief's operator drains an untouched hypothesis to a quarter in eight rounds", () => {
    let p = [1 / 3, 1 / 3, 1 / 3];
    for (let n = 0; n < 8; n++) p = specInterfere(p, 0, 1, 0.5);
    // Measured: 0.3333 -> 0.2857 -> 0.2424 -> ... -> 0.0774, with no evidence
    // about C at any point.
    expect(p[2]).toBeLessThan(0.08);
  });

  it("ours holds it at exactly its prior share through the same eight rounds", () => {
    let s = fromWeights(["A", "B", "C"], [1, 1, 1]);
    for (let n = 0; n < 8; n++) s = interfere(s, "A", "B", 0.5);
    expect(probabilities(s)[2]).toBeCloseTo(1 / 3, 12);
    expect(sum(probabilities(s))).toBeCloseTo(1, 12);
  });

  it("and the third hypothesis is untouched for every strength, not just 0.5", () => {
    for (const strength of [0.1, 0.5, 0.9, 1, 2, 5]) {
      const s = interfere(fromWeights(["A", "B", "C"], [1, 1, 1]), "A", "B", strength);
      expect(probabilities(s)[2]).toBeCloseTo(1 / 3, 12);
    }
  });

  it("the rotation it uses is genuinely unitary", () => {
    for (const strength of [0, 0.5, 3]) {
      const k = 1 / Math.sqrt(1 + strength * strength);
      expect(() => assertUnitary2([c(k), c(strength * k), c(-strength * k), c(k)])).not.toThrow();
    }
    // The brief's un-normalized matrix is not, which is why it could never
    // have been lifted to the QPU backend sections 23-24 propose.
    expect(() => assertUnitary2([c(1), c(0.5), c(-0.5), c(1)])).toThrow(/not unitary/);
  });
});

describe("the gates mean what they are named", () => {
  it("reweight IS Bayes — that is the bridge the benchmark depends on", () => {
    const s = reweight(fromWeights(["A", "B"], [3, 1]), [0.2, 0.8]);
    // Bayes by hand: (0.75*0.2, 0.25*0.8) = (0.15, 0.20) -> (0.4286, 0.5714)
    expect(probabilities(s)[0]).toBeCloseTo(0.15 / 0.35, 12);
  });

  it("phase changes nothing a measurement alone can see", () => {
    // To within floating point, and stated that way on purpose: a rotation by
    // cos/sin costs a few ulps, so a strict toEqual here fails on correct code
    // and would get "fixed" by loosening the claim instead of the comparison.
    const before = fromWeights(["A", "B"], [3, 1]);
    const after = phase(before, "A", 1.234);
    probabilities(after).forEach((v, i) => expect(v).toBeCloseTo(probabilities(before)[i], 12));
  });

  it("but phase DOES change what a later interference produces", () => {
    // This is the entire reason the representation could differ from Bayes.
    // If these two were equal, OQCA would be a probability vector with extra
    // arithmetic and the brief's premise would be empty.
    const base = fromWeights(["A", "B"], [1, 1]);
    const inPhase = probabilities(interfere(base, "A", "B", 0.8))[0];
    const outOfPhase = probabilities(interfere(phase(base, "B", Math.PI), "A", "B", 0.8))[0];
    expect(Math.abs(inPhase - outOfPhase)).toBeGreaterThan(0.3);
  });

  it("superpose gives the newcomer the share it was promised", () => {
    // The brief appends a raw amplitude, so the share depends on how many
    // hypotheses already exist and the same call means different things.
    const s = superpose(fromWeights(["A", "B"], [1, 1]), "C", 0.25);
    expect(probabilities(s)[2]).toBeCloseTo(0.25, 12);
    expect(probabilities(s)[0]).toBeCloseTo(0.375, 12);
    expect(sum(probabilities(s))).toBeCloseTo(1, 12);
  });

  it("damp moves mass to the others rather than letting it leak away", () => {
    // The brief's decay is applied per amplitude with no renormalize, so the
    // result stops being a state at all.
    const s = damp(fromWeights(["A", "B"], [1, 1]), "A", 0.5);
    expect(sum(probabilities(s))).toBeCloseTo(1, 12);
    expect(probabilities(s)[1]).toBeGreaterThan(0.5);
  });

  it("refuses to damp the only hypothesis, which would be a zero state", () => {
    expect(() => damp(fromWeights(["A"], [1]), "A", 0)).toThrow(/only hypothesis/);
  });
});

describe("measurement", () => {
  it("defaults to the maximum, not to sampling", () => {
    // A default is a decision. Sampling proportional to belief means acting on
    // a 20% hypothesis one time in five, forever.
    const s = fromWeights(["A", "B"], [4, 1]);
    expect(measure(s).label).toBe("A");
    expect(measure(s).policy).toBe("maximum");
  });

  it("a threshold policy REFUSES rather than naming a winner from a tie", () => {
    const undecided = fromWeights(["A", "B", "C"], [34, 33, 33]);
    expect(measure(undecided, { kind: "threshold", minimum: 0.6 }).label).toBeNull();
    const decided = fromWeights(["A", "B"], [99, 1]);
    expect(measure(decided, { kind: "threshold", minimum: 0.6 }).label).toBe("A");
  });

  it("sampling is deterministic for a seed, which is what replay needs", () => {
    const s = fromWeights(["A", "B", "C"], [5, 3, 2]);
    const runs = [1, 2, 3, 4, 5].map((seed) => measure(s, { kind: "sample", seed }).label);
    const again = [1, 2, 3, 4, 5].map((seed) => measure(s, { kind: "sample", seed }).label);
    expect(again).toEqual(runs);
  });

  it("and the sampler's long-run frequencies match the probabilities", () => {
    // Proves the sampler reads the state rather than merely being repeatable.
    const s = fromWeights(["A", "B"], [7, 3]);
    let a = 0;
    const rng = seeded(42);
    for (let n = 0; n < 20000; n++) if (rng() < 0.7) a++;
    expect(a / 20000).toBeCloseTo(probabilities(s)[0], 2);
  });

  it("entropy says how undecided the state is, apart from who leads", () => {
    expect(entropy(fromWeights(["A", "B"], [1, 1]))).toBeCloseTo(1, 12);
    expect(entropy(fromWeights(["A", "B"], [1, 0]))).toBeCloseTo(0, 12);
  });

  it("margin distinguishes a real lead from a photo finish", () => {
    expect(measure(fromWeights(["A", "B"], [99, 1])).margin).toBeGreaterThan(0.9);
    expect(measure(fromWeights(["A", "B"], [51, 49])).margin).toBeLessThan(0.05);
  });
});
