/**
 * OQCA v1.1 — the cognitive layer and its A/B/C classification. Brief §3, §18.
 *
 * THE CATEGORIES ARE THE DELIVERABLE, so most of this file tests the CATALOGUE
 * rather than the arithmetic: that the two category-C operations refuse by name,
 * that nothing quietly substitutes for them, and that the count of each category
 * is pinned so a future rename cannot promote an operation without a test.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORY_OF,
  COGNITIVE_OPERATIONS,
  NotPhysicallyRepresented,
  OPERATION_CATALOGUE,
  collapseOnto,
  control,
  correct,
  entangle,
  evidence,
  interfere,
  phase,
  projectOnto,
  renormalize,
  reset,
  superpose,
} from "@/oqca/cognitive";
import { CognitiveState } from "@/oqca/formalState";
import { bayesUpdate, beliefFromWeights } from "@/oqca/baseline";
import { readFileSync } from "node:fs";

const flat = () => CognitiveState.fromWeights(["A", "B", "C"], [1, 1, 1]);

describe("the catalogue is complete and honestly categorised", () => {
  it("every declared operation has exactly one catalogue entry", () => {
    expect(OPERATION_CATALOGUE.map((s) => s.operation).sort()).toEqual(
      [...COGNITIVE_OPERATIONS].sort(),
    );
    expect(new Set(OPERATION_CATALOGUE.map((s) => s.operation)).size).toBe(
      COGNITIVE_OPERATIONS.length,
    );
  });

  it("the category counts are pinned: five A, two B, two C", () => {
    const count = (k: string) => OPERATION_CATALOGUE.filter((s) => s.category === k).length;
    expect(count("A")).toBe(5);
    expect(count("B")).toBe(2);
    expect(count("C")).toBe(2);
  });

  it("ENTANGLE and CORRECT are the two C entries, and nothing else is", () => {
    expect(
      OPERATION_CATALOGUE.filter((s) => s.category === "C")
        .map((s) => s.operation)
        .sort(),
    ).toEqual(["CORRECT", "ENTANGLE"]);
  });

  it("every B and C entry states its caveat; no A entry needs one", () => {
    for (const s of OPERATION_CATALOGUE) {
      if (s.category === "B" || s.category === "C") {
        expect(s.caveat.length, s.operation).toBeGreaterThan(20);
      }
    }
  });

  it("EVIDENCE is declared as an ADDITION to the brief's eight", () => {
    const e = OPERATION_CATALOGUE.find((s) => s.operation === "EVIDENCE")!;
    expect(e.category).toBe("A");
    expect(e.caveat).toMatch(/ADDED to the brief's list of eight/);
  });
});

describe("category C refuses by name rather than substituting", () => {
  it("ENTANGLE throws, naming the missing tensor factorisation", () => {
    expect(() => entangle()).toThrow(NotPhysicallyRepresented);
    expect(() => entangle()).toThrow(/factored register/);
    expect(CATEGORY_OF.ENTANGLE).toBe("C");
  });

  it("CORRECT throws, naming the missing code space", () => {
    expect(() => correct()).toThrow(NotPhysicallyRepresented);
    expect(() => correct()).toThrow(/no code space|stabilizers|syndrome/);
  });

  it("renormalize is NOT called CORRECT, and does not claim to be", () => {
    const s = renormalize(flat());
    expect(s.history[0].operation).toBe("RESET");
    expect(s.history[0].operation).not.toBe("CORRECT");
    // The source says so in as many words, and the guard reads the source
    // because the naming is the whole point of keeping them apart.
    const src = readFileSync("src/oqca/cognitive.ts", "utf8");
    expect(src).toMatch(/This is NOT error correction/);
  });
});

describe("EVIDENCE is Bayes exactly — the bridge the benchmark rests on", () => {
  it("agrees with the probability vector to twelve decimals over many updates", () => {
    let s = CognitiveState.fromWeights(["A", "B", "C"], [3, 1, 2]);
    let b = beliefFromWeights(["A", "B", "C"], [3, 1, 2]);
    for (const L of [
      [0.8, 0.1, 0.1],
      [0.3, 0.7, 0.5],
      [0.05, 0.9, 0.2],
      [0.5, 0.5, 0.5],
    ]) {
      s = evidence(s, L);
      b = bayesUpdate(b, L);
      s.probabilities().forEach((p, i) => expect(p).toBeCloseTo(b.p[i], 12));
    }
  });

  it("refuses a negative or mismatched likelihood", () => {
    expect(() => evidence(flat(), [1, -1, 1])).toThrow(/>= 0/);
    expect(() => evidence(flat(), [1, 1])).toThrow(/one likelihood/);
  });
});

describe("the gates that carry context", () => {
  it("PHASE moves no probability by itself", () => {
    const before = flat().probabilities();
    const after = phase(flat(), "B", 1.234).probabilities();
    after.forEach((p, i) => expect(p).toBeCloseTo(before[i], 14));
  });

  it("INTERFERE with a relative phase is still unitary and still norm-preserving", () => {
    const s = interfere(flat(), "A", "B", 0.6, 1.1);
    expect(s.norm()).toBeCloseTo(1, 14);
    expect(s.history[0].unitarityResidual).toBeLessThan(1e-15);
    expect(s.probabilities()[2]).toBeCloseTo(1 / 3, 14);
  });

  it("a hypothesis cannot interfere with itself", () => {
    expect(() => interfere(flat(), "A", "A", 0.5)).toThrow(/itself/);
  });
});

describe("CONTROL is a classical conditional and reports whether it fired", () => {
  it("does not fire below the threshold, and the state is untouched", () => {
    const r = control(flat(), "C", "A", "B", 0.5, 0.9);
    expect(r.fired).toBe(false);
    expect(r.state.history.length).toBe(0);
  });

  it("fires above it, and records the control probability it read", () => {
    const r = control(flat(), "C", "A", "B", 0.5, 0.2);
    expect(r.fired).toBe(true);
    expect(r.state.history[0].operation).toBe("CONTROL");
    expect(r.state.history[0].parameters.controlP).toBeCloseTo(1 / 3, 12);
  });
});

describe("measurement and contradiction", () => {
  it("collapseOnto projects and renormalises", () => {
    const s = collapseOnto(flat(), "B");
    expect(s.probabilities()).toEqual([0, 1, 0]);
    expect(s.history[0].operation).toBe("MEASURE");
  });

  it("projectOnto keeps a subset and narrows the active hypotheses", () => {
    const s = projectOnto(flat(), ["A", "C"]);
    expect(s.probabilities()[1]).toBe(0);
    expect(s.activeHypotheses).toEqual(["A", "C"]);
    expect(s.validate().ok).toBe(true);
  });

  it("CONTRADICTION: evidence that rules everything out REFUSES rather than dividing by zero", () => {
    expect(() => evidence(flat(), [0, 0, 0])).toThrow();
  });

  it("RESET prepares a known state and is irreversible by design", () => {
    const s = reset(collapseOnto(flat(), "B"), [1, 1, 1]);
    s.probabilities().forEach((p) => expect(p).toBeCloseTo(1 / 3, 12));
    expect(s.history[1].operation).toBe("RESET");
  });
});

describe("superposition", () => {
  it("share is what the newcomer HOLDS, on the first call and the third", () => {
    let s = CognitiveState.fromWeights(["A"], [1]);
    s = superpose(s, "B", 0.2);
    expect(s.probabilities()[1]).toBeCloseTo(0.2, 12);
    s = superpose(s, "C", 0.2);
    expect(s.probabilities()[2]).toBeCloseTo(0.2, 12);
    s = superpose(s, "D", 0.2);
    expect(s.probabilities()[3]).toBeCloseTo(0.2, 12);
  });

  it("refuses a duplicate label and an out-of-range share", () => {
    expect(() => superpose(flat(), "A", 0.2)).toThrow(/already/);
    expect(() => superpose(flat(), "D", 0)).toThrow(/strictly between/);
    expect(() => superpose(flat(), "D", 1)).toThrow(/strictly between/);
  });
});
