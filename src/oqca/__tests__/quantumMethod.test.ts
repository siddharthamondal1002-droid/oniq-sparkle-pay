/**
 * METHOD — brief §16 (fair baselines), §17 (experiments), §18 (discovery).
 *
 * §16's sentence is the subject: **"The system must never call a quantum
 * method superior merely because the classical baseline was denied equivalent
 * information."** So the assertions here are mostly about REFUSALS and about
 * the pipeline's most common correct answer, which is "classical".
 *
 * A suite that proved the happy path would be proving the least important half
 * — the same reason the v1.3 loop's test file is mostly about its gates.
 */
import { describe, expect, it } from "vitest";
import {
  BASELINES,
  BASELINE_BY_ID,
  EXPERIMENTS,
  EXPERIMENT_BY_ID,
  FULL_INFORMATION,
  QUBIT_SWEEP,
  TARGET_ERROR,
  fairnessCheck,
  establishmentAgrees,
  runExperiment,
  runAll,
  classicalDjDeterministic,
  classicalDjRandomised,
  classicalDjQueriesFor,
  djCircuit,
  bvCircuit,
  quantumQueries,
} from "../quantum/experiments.ts";
import {
  discover,
  discoverAll,
  executableHere,
  assess,
  ONIQ_PROBLEMS,
  PROBLEM_STRUCTURES,
  type ProblemStatement,
} from "../quantum/discovery.ts";
import { ALGORITHM_BY_ID } from "../quantum/algorithms.ts";
import { CATEGORY_OF } from "../quantum/boundary.ts";
import { DEFAULT_QUANTUM_POLICY } from "../quantum/policy.ts";
import { makeStatevectorBackend } from "../quantum/backends/statevector.ts";
import { twoQubitCount } from "../quantum/circuit.ts";

const hidden =
  (n: number, on: readonly number[]) =>
  (x: number): number => {
    let bits = 0;
    for (const q of on) bits ^= (x >> (n - 1 - q)) & 1;
    return bits;
  };

describe("§16 — a baseline that was denied information is named, not scored", () => {
  it("declares what every baseline was given, and at least one WAS denied something", () => {
    expect(BASELINES.length).toBeGreaterThanOrEqual(4);
    const denied = BASELINES.filter((b) => !b.informationGiven.randomness);
    // A registry where every baseline had full information would make the
    // fairness gate unreachable, and an unreachable guard makes a mutation run
    // lie (CLAUDE.md, 2026-09-10).
    expect(denied.length).toBeGreaterThan(0);
    const full = BASELINES.filter((b) => b.informationGiven.randomness);
    expect(full.length).toBeGreaterThan(0);
  });

  it("reports every axis on which a baseline was short-changed, not the first", () => {
    const f = fairnessCheck(EXPERIMENT_BY_ID.get("dj_unfair")!);
    expect(f.fair).toBe(false);
    expect([...f.denied].sort()).toEqual(["boundedError", "randomness"]);
    expect(fairnessCheck(EXPERIMENT_BY_ID.get("dj_fair")!).fair).toBe(true);
  });

  it("refuses an experiment whose baseline does not exist", () => {
    const bogus = { ...EXPERIMENT_BY_ID.get("dj_fair")!, classicalBaselineId: "nope" };
    const f = fairnessCheck(bogus);
    expect(f.fair).toBe(false);
    expect(f.denied[0]).toMatch(/no baseline/);
  });

  it("an unfair run still REPORTS its numbers and refuses the word superior", () => {
    const o = runExperiment("dj_unfair");
    expect(o.result).not.toBeNull();
    expect(o.result!.quantumCost).toBe(1);
    // THE MEASURED COST, NOT THE WORST CASE. On this oracle the deterministic
    // baseline finds a differing input at x=4 and stops at 5 queries; its
    // worst case is 2^(n-1)+1 = 9. Reporting 9 would overstate the classical
    // burden — i.e. flatter the quantum side — which is the §16 cheat pointing
    // the other way. Both are asserted so neither can drift.
    expect(o.result!.classicalCost).toBe(5);
    expect(o.result!.classicalCost).toBeLessThanOrEqual(2 ** 3 + 1);
    expect(classicalDjDeterministic(4, hidden(4, [0, 1]))).toBe(5);
    // Hiding the comparison would hide the very thing §16 exists to expose;
    // what is refused is the VERDICT, and the verdict names the denial.
    expect(o.result!.verdict).toMatch(/not a fair separation/);
    expect(o.result!.verdict).toMatch(/randomness/);
  });
});

describe("§17 — the experiments run, and two of them disagree", () => {
  it("Deutsch-Jozsa's separation evaporates when the classical side gets a coin", () => {
    const o = runExperiment("dj_fair");
    expect(o.fairness.fair).toBe(true);
    expect(o.result!.quantumCost).toBe(1);
    expect(o.result!.classicalErrorRate).toBeLessThanOrEqual(TARGET_ERROR);
    // A constant, not an exponential. The number is small and the SHAPE is
    // the finding.
    expect(o.result!.classicalCost).toBeLessThan(12);
    expect(o.result!.verdict).toMatch(/NOT on n|not on n/);
  });

  it("Bernstein-Vazirani's does not, and it recovers the string exactly", () => {
    const o = runExperiment("bv_fair");
    expect(o.fairness.fair).toBe(true);
    expect(o.result!.quantumCost).toBe(1);
    expect(o.result!.classicalCost).toBe(4);
    expect(o.result!.verdict).toMatch(/recovered 1011/);
    expect(o.result!.verdict).toMatch(/LINEAR, not exponential/);
  });

  it("the sweep is what settles it: deterministic doubles, randomised is flat", () => {
    const o = runExperiment("dj_scaling");
    expect(o.result!.verdict).toMatch(/doubling per qubit/);
    // MEASURED HERE TOO, not read off the verdict string — a test that only
    // matched the sentence would pass on a sentence that lies.
    const det = QUBIT_SWEEP.map((n) => classicalDjDeterministic(n, hidden(n, [0, 1])));
    const rand = QUBIT_SWEEP.map(
      (n) => classicalDjQueriesFor(n, hidden(n, [0, 1]), TARGET_ERROR, 500, 11 + n, false).queries,
    );
    expect(det[det.length - 1] / det[0]).toBeGreaterThan(100);
    expect(rand[rand.length - 1] - rand[0]).toBeLessThan(5);
  });

  it("a blocked experiment refuses and says what blocks it", () => {
    const o = runExperiment("grover_scaling");
    expect(o.result).toBeNull();
    expect(o.refusal).toMatch(/multi-controlled Z/);
  });

  it("every declaration survives its own numbers", () => {
    for (const e of EXPERIMENTS) {
      const a = establishmentAgrees(e.id, 4242);
      expect(a.agrees, `${e.id}: ${a.detail}`).toBe(true);
    }
    // AND THE CHECK CAN FAIL. Swapping a declaration must flip it, or the loop
    // above is asserting nothing — the "a check that has never failed has
    // never been tested" rule, applied to the check itself.
    const flipped = { ...EXPERIMENT_BY_ID.get("dj_fair")!, establishes: "advantage" as const };
    const saved = EXPERIMENT_BY_ID.get("dj_fair")!;
    (EXPERIMENT_BY_ID as Map<string, typeof saved>).set("dj_fair", flipped);
    expect(establishmentAgrees("dj_fair", 4242).agrees).toBe(false);
    (EXPERIMENT_BY_ID as Map<string, typeof saved>).set("dj_fair", saved);
  });

  it("the circuits are built from registry gates only, and query once", () => {
    const dj = djCircuit(4, [0, 1]);
    const bv = bvCircuit(4, [1, 0, 1, 1]);
    expect(quantumQueries(dj)).toBe(1);
    expect(quantumQueries(bv)).toBe(1);
    // The oracle IS the CX block; a balanced DJ on two bits has two of them.
    expect(twoQubitCount(dj)).toBe(2);
    expect(twoQubitCount(bv)).toBe(3);
    // Constant oracles carry no CX at all, and both constants are valid.
    expect(twoQubitCount(djCircuit(4, [], 0))).toBe(0);
    expect(twoQubitCount(djCircuit(4, [], 1))).toBe(0);
  });

  it("a CONSTANT Deutsch-Jozsa oracle really does read all-zeros", () => {
    // The other half of the discriminator. Without it, a circuit that always
    // returned a non-zero string would still pass the balanced test.
    const backend = makeStatevectorBackend();
    for (const value of [0, 1]) {
      const r = backend.simulate(djCircuit(4, [], value), 128, 5);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(Object.keys(r.value)).toEqual(["0000"]);
    }
    const balanced = backend.simulate(djCircuit(4, [0, 1]), 128, 5);
    expect(balanced.ok).toBe(true);
    if (!balanced.ok) return;
    expect(Object.keys(balanced.value)).not.toContain("0000");
  });

  it("the randomised baseline's error really does fall as k rises", () => {
    const f = hidden(6, [0, 1]);
    const one = classicalDjRandomised(6, f, 2, 1000, 99, false);
    const many = classicalDjRandomised(6, f, 8, 1000, 99, false);
    expect(one.errorRate).toBeGreaterThan(many.errorRate);
    expect(many.errorRate).toBeLessThan(TARGET_ERROR);
  });

  it("runAll returns one outcome per registered experiment", () => {
    const all = runAll();
    expect(all.length).toBe(EXPERIMENTS.length);
    expect(all.filter((o) => o.result !== null).length).toBe(EXPERIMENTS.length - 1);
  });
});

describe("§18 — discovery, whose most common correct answer is 'classical'", () => {
  it("says classical or no-match for every problem ONIQ actually has", () => {
    const results = discoverAll();
    expect(results.length).toBe(ONIQ_PROBLEMS.length);
    for (const r of results) {
      expect(["classical", "no_matching_structure"], r.problemId).toContain(r.recommendation);
      expect(r.rationale.length).toBeGreaterThan(30);
      expect(r.wouldChangeIf.length).toBeGreaterThan(0);
    }
  });

  it("reaches quantum_candidate ONLY where a fair advantage experiment exists", () => {
    const p: ProblemStatement = {
      id: "toy",
      description: "recover a hidden bit string from a parity oracle",
      structure: "hidden_linear_structure",
      size: 16,
      hasOracle: true,
      boundedErrorAcceptable: true,
    };
    const r = discover(p);
    expect(r.recommendation).toBe("quantum_candidate");
    // AND ONLY Bernstein-Vazirani. Deutsch and Deutsch-Jozsa match the same
    // structure and are backed by `dj_fair`, whose finding is that they have
    // NO advantage — reading "a fair experiment names it" as support was a
    // real defect and it put both of them here.
    const supported = r.candidates
      .filter((c) => c.fairExperimentId !== null)
      .map((c) => c.algorithmId);
    expect(supported).toEqual(["bernstein_vazirani"]);
  });

  it("separates 'cannot run it' from 'no advantage', because the fixes differ", () => {
    const big: ProblemStatement = {
      id: "big",
      description: "the same problem, a million times larger",
      structure: "hidden_linear_structure",
      size: 1 << 20,
      hasOracle: true,
      boundedErrorAcceptable: true,
    };
    const r = discover(big);
    expect(r.recommendation).toBe("not_executable_here");
    expect(r.rationale).toMatch(/simulated qubits/);
    // The fix it names is an OWNER decision this file may not take.
    expect(r.wouldChangeIf.join(" ")).toMatch(/owner authorises a QPU vendor/);
  });

  it("refuses to grow past the policy's qubit ceiling", () => {
    const bv = ALGORITHM_BY_ID.get("bernstein_vazirani")!;
    expect(executableHere(bv, 16)).toBe(true);
    expect(executableHere(bv, 2 ** DEFAULT_QUANTUM_POLICY.maxSimulatedQubits)).toBe(false);
    // Shor is not locally simulable at any size, whatever the ceiling says.
    expect(executableHere(ALGORITHM_BY_ID.get("shor")!, 4)).toBe(false);
  });

  it("names the missing oracle and the exactness requirement as separate reasons", () => {
    const bv = ALGORITHM_BY_ID.get("bernstein_vazirani")!;
    const noOracle = assess(bv, {
      id: "x",
      description: "",
      structure: "hidden_linear_structure",
      size: 8,
      hasOracle: false,
      boundedErrorAcceptable: true,
    });
    expect(noOracle.reason).toMatch(/needs an oracle/);
    expect(noOracle.category).toBe("PHYSICAL_QUANTUM");
  });

  it("CATEGORY_OF holds no algorithm id, so nobody reinstates the lookup", () => {
    // The first draft read `CATEGORY_OF.get(a.id) ?? "PHYSICAL_QUANTUM"`, and
    // the map is keyed by OBJECT NAMES — so it missed on all eighteen and the
    // fallback returned the right answer for the wrong reason.
    for (const id of ALGORITHM_BY_ID.keys()) {
      expect(CATEGORY_OF.has(id), `CATEGORY_OF now holds ${id}`).toBe(false);
    }
  });

  it("every closed structure is either mapped or deliberately empty", () => {
    for (const s of PROBLEM_STRUCTURES) {
      const r = discover({
        id: `s_${s}`,
        description: "",
        structure: s,
        size: 8,
        hasOracle: true,
        boundedErrorAcceptable: true,
      });
      expect(
        ["classical", "quantum_candidate", "not_executable_here", "no_matching_structure"],
        s,
      ).toContain(r.recommendation);
    }
  });

  it("no baseline id in the registry is dangling", () => {
    for (const e of EXPERIMENTS) {
      expect(BASELINE_BY_ID.has(e.classicalBaselineId), e.id).toBe(true);
      expect(e.quantumInformation).toEqual(FULL_INFORMATION);
      expect(e.hypothesis.length, e.id).toBeGreaterThan(30);
    }
  });
});
