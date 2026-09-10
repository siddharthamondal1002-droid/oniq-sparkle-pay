/**
 * OQCA v1.1 — state, serialisation, replay and audit. Brief section 18, "State".
 */
import { describe, expect, it } from "vitest";
import { CognitiveState, NORM_TOLERANCE, StateError, ROOT_CONTEXT } from "@/oqca/formalState";
import { evidence, interfere, phase, superpose } from "@/oqca/cognitive";
import { historyProblems, toWireRecord } from "@/oqca/transition";
import { canonicalJson, contentHash } from "@/oqca/math/hash";
import { rotation } from "@/oqca/math/unitary";

const build = () =>
  interfere(
    phase(
      evidence(CognitiveState.fromWeights(["A", "B", "C"], [1, 1, 1]), [0.5, 0.5, 0.2]),
      "B",
      Math.PI,
    ),
    "A",
    "B",
    0.73,
  );

describe("deterministic replay", () => {
  it("the same operations produce the same state id, twice", () => {
    expect(build().stateId).toBe(build().stateId);
  });

  it("the id is a function of CONTENT, so a different context is a different state", () => {
    const a = CognitiveState.fromWeights(["A", "B"], [1, 1], ROOT_CONTEXT);
    const b = CognitiveState.fromWeights(["A", "B"], [1, 1], { contextId: "other", tags: {} });
    expect(a.stateId).not.toBe(b.stateId);
  });

  it("no clock is read: a state built now equals one built from the same inputs", () => {
    // If a wall clock ever entered `hashPayload`, this is the assertion that
    // would go red — and it is the whole reason `timestamp` is logical.
    const one = build();
    const two = build();
    expect(one.snapshot().history.map(toWireRecord)).toEqual(
      two.snapshot().history.map(toWireRecord),
    );
  });

  it("canonical serialisation is key-order independent and -0 safe", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(contentHash({ re: -0 })).toBe(contentHash({ re: 0 }));
    expect(contentHash({ re: 1e-17 })).not.toBe(contentHash({ re: 0 }));
  });
});

describe("snapshot and restore", () => {
  it("round-trips exactly, id and all", () => {
    const s = build();
    const back = CognitiveState.restore(s.snapshot());
    expect(back.stateId).toBe(s.stateId);
    expect(back.validate().ok).toBe(true);
    expect(back.probabilities()).toEqual(s.probabilities());
    expect(back.history.length).toBe(s.history.length);
  });

  it("REFUSES a snapshot whose content was edited under its own id", () => {
    const snap = build().snapshot();
    const tampered = {
      ...snap,
      amplitudes: snap.amplitudes.map((a, i) => (i === 0 ? { re: a.re + 0.1, im: a.im } : a)),
    };
    expect(() => CognitiveState.restore(tampered)).toThrow(StateError);
  });

  it("the snapshot carries phases, which a probability vector has nowhere to put", () => {
    const s = build();
    expect(s.snapshot().phases.length).toBe(3);
    expect(s.snapshot().probabilities.length).toBe(3);
  });
});

describe("the transition record", () => {
  it("every transition leaves exactly one record, and the chain links", () => {
    const s = build();
    expect(s.history.length).toBe(3);
    expect(historyProblems(s.history)).toEqual([]);
    expect(s.history[s.history.length - 1].toState).toBe(s.stateId);
    expect(s.history[0].fromState).not.toBe(s.history[0].toState);
  });

  it("the wire shape is the brief's snake_case contract", () => {
    const w = toWireRecord(build().history[0]);
    expect(Object.keys(w).sort()).toEqual([
      "context_id",
      "evidence_ids",
      "from_state",
      "implementation",
      "norm_after",
      "norm_before",
      "operation",
      "parameters",
      "seed",
      "timestamp",
      "to_state",
      "unitarity_residual",
    ]);
    expect(w.implementation).toBe("classical_simulator");
  });

  it("a wallClock is kept for a human and EXCLUDED from the wire record", () => {
    const s = CognitiveState.fromWeights(["A", "B"], [1, 1]).transition(
      { kind: "pair", i: 0, j: 1, u: rotation(0.3) },
      { operation: "INTERFERE", wallClock: 1_700_000_000_000 },
    );
    expect(s.history[0].wallClock).toBe(1_700_000_000_000);
    expect(Object.keys(toWireRecord(s.history[0]))).not.toContain("wallClock");
    // ...and the state built WITHOUT it hashes the same, which is the property.
    const without = CognitiveState.fromWeights(["A", "B"], [1, 1]).transition(
      { kind: "pair", i: 0, j: 1, u: rotation(0.3) },
      { operation: "INTERFERE" },
    );
    expect(s.stateId).toBe(without.stateId);
  });

  it("records the operator's unitarity residual, so drift is visible in the LOG", () => {
    expect(build().history[2].unitarityResidual).toBeLessThan(1e-15);
  });

  it("a broken chain is detected", () => {
    const s = build();
    const broken = [...s.history];
    broken[1] = { ...broken[1], fromState: "not-the-previous-state" };
    expect(historyProblems(broken).some((p) => p.problem.includes("broken chain"))).toBe(true);
  });
});

describe("validate() fails on each of the four conditions the brief names", () => {
  it("passes on a well-formed state", () => {
    expect(build().validate()).toEqual({ ok: true, problems: [] });
  });

  it("norm drift — STATED AS UNREACHABLE TODAY, and the property it protects", () => {
    // Honest about what this branch is. Every operator currently in the kernel
    // is norm-preserving or renormalises by definition, and `restore` refuses a
    // snapshot whose amplitudes were edited under its own id — so no reachable
    // path produces a state with normError above 1e-9. The guard exists for the
    // day a non-norm-preserving operator is added, which is exactly when nobody
    // would be looking.
    //
    // What CAN be measured is the property it protects: drift over a long run
    // stays orders of magnitude below the tolerance.
    let s = CognitiveState.fromWeights(["A", "B", "C", "D"], [1, 2, 3, 4]);
    for (let k = 0; k < 500; k++) {
      s = s.transition(
        { kind: "pair", i: k % 3, j: (k % 3) + 1, u: rotation(0.31) },
        { operation: "INTERFERE" },
      );
    }
    expect(s.normError).toBeLessThan(1e-14);
    expect(s.normError).toBeLessThan(NORM_TOLERANCE / 1e5);
    expect(s.validate().ok).toBe(true);
  });

  it("NaN / Infinity in an amplitude", () => {
    expect(() =>
      CognitiveState.fromAmplitudes(
        ["A", "B"],
        [
          { re: NaN, im: 0 },
          { re: 1, im: 0 },
        ],
      ),
    ).toThrow();
    expect(() => CognitiveState.fromWeights(["A"], [Infinity])).toThrow(StateError);
  });

  it("dimension mismatch", () => {
    expect(() => CognitiveState.fromWeights(["A", "B"], [1])).toThrow(StateError);
    expect(() => CognitiveState.fromWeights(["A", "A"], [1, 1])).toThrow(/unique/);
  });

  it("malformed history", () => {
    const s = build();
    const snap = s.snapshot();
    const bad = {
      ...snap,
      history: [{ ...snap.history[0], fromState: "" }, ...snap.history.slice(1)],
    };
    // The id does not hash history, so this restores; validate() is what catches it.
    const restored = CognitiveState.restore(bad);
    const v = restored.validate();
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.code === "malformed_history")).toBe(true);
    expect(() => restored.assertValid()).toThrow(StateError);
  });

  it("an active hypothesis that is not in the basis", () => {
    // REACHED THROUGH `transition`, NOT `restore`. The first draft of this test
    // edited a snapshot and expected validate() to catch it — and `restore`
    // threw first, because activeHypotheses IS in the hash payload. That is
    // restore doing its job, and it means this validate() branch guards the
    // TRANSITION path, where a caller supplies the list directly and nothing
    // checks it. Testing it through the door that cannot open it would have
    // been a guard asserted against the wrong failure.
    const bad = CognitiveState.fromWeights(["A", "B"], [1, 1]).transition(
      { kind: "diagonal", phases: [0, 0] },
      { operation: "PHASE", activeHypotheses: ["Z"] },
    );
    const v = bad.validate();
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.code === "unknown_active_hypothesis")).toBe(true);
  });

  it("and restore refuses an edited activeHypotheses outright", () => {
    const s = build();
    expect(() => CognitiveState.restore({ ...s.snapshot(), activeHypotheses: ["Z"] })).toThrow(
      StateError,
    );
  });
});

describe("dimension change", () => {
  it("SUPERPOSE grows the basis, keeps the norm, and records it", () => {
    const s = superpose(CognitiveState.fromWeights(["A", "B"], [1, 1]), "C", 0.25);
    expect(s.basis).toEqual(["A", "B", "C"]);
    expect(s.norm()).toBeCloseTo(1, 14);
    expect(s.probabilities()[2]).toBeCloseTo(0.25, 12);
    expect(s.probabilities()[0]).toBeCloseTo(0.375, 12);
    expect(s.validate().ok).toBe(true);
    expect(s.history[0].operation).toBe("SUPERPOSE");
  });
});
