/**
 * OQCA v1.1 — knowledge, gaps and planning. Brief §10-§12 and §18 "Knowledge".
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_KNOWLEDGE,
  conf,
  quantumErrorCorrectionSeed,
  withConcept,
  withEvidence,
  withRelation,
} from "@/oqca/knowledge/model";
import { DISPUTE_THRESHOLD, detectGaps, openGaps, type Goal } from "@/oqca/knowledge/gaps";
import { UNIFORM_COST, planResearch } from "@/oqca/knowledge/planner";

const goal: Goal = {
  id: "understand_qec",
  statement: "Understand quantum error correction well enough to say whether OQCA has any",
  requires: [
    { conceptId: "quantum_error_correction", importance: 1 },
    { conceptId: "logical_qubit", importance: 0.8 },
    { conceptId: "syndrome", importance: 0.7 },
    { conceptId: "qubit", importance: 0.5 },
    { conceptId: "topological_code", importance: 0.9 },
  ],
};

describe("gap detection is deterministic and four-way", () => {
  it("returns the identical result on repeated calls", () => {
    const k = quantumErrorCorrectionSeed();
    expect(detectGaps(goal, k)).toEqual(detectGaps(goal, k));
  });

  it("UNKNOWN for a concept that is not in the state at all", () => {
    const g = detectGaps(goal, quantumErrorCorrectionSeed()).find(
      (x) => x.conceptId === "topological_code",
    )!;
    expect(g.status).toBe("UNKNOWN");
    expect(g.uncertainty).toBe(1);
    expect(g.reason).toMatch(/not in the knowledge state/);
  });

  it("UNKNOWN for a concept present with no evidence bearing on it", () => {
    const g = detectGaps(goal, quantumErrorCorrectionSeed()).find(
      (x) => x.conceptId === "syndrome",
    )!;
    expect(g.status).toBe("UNKNOWN");
    expect(g.reason).toMatch(/no evidence bears on it/);
  });

  it("VERIFIED needs strong, one-sided, LOW-VOLATILITY evidence", () => {
    let k = withConcept(EMPTY_KNOWLEDGE, { id: "x", label: "X", dependsOn: [], contextIds: [] });
    k = withEvidence(k, {
      id: "e1",
      source: "measured",
      statement: "s",
      provenance: "p",
      supports: true,
      confidence: conf(0.99, 0.05),
    });
    k = withRelation(k, {
      id: "r1",
      from: "x",
      to: "x",
      kind: "self",
      confidence: conf(0.99, 0.05),
      evidenceIds: ["e1"],
      contextId: "c",
      provenance: "p",
    });
    const g = detectGaps(
      { id: "g", statement: "", requires: [{ conceptId: "x", importance: 1 }] },
      k,
    )[0];
    expect(g.status).toBe("VERIFIED");
    expect(g.expectedInformationGain).toBeLessThan(0.1);
  });

  it("high volatility keeps strong evidence at UNCERTAIN rather than VERIFIED", () => {
    let k = withConcept(EMPTY_KNOWLEDGE, { id: "x", label: "X", dependsOn: [], contextIds: [] });
    k = withEvidence(k, {
      id: "e1",
      source: "asserted",
      statement: "s",
      provenance: "p",
      supports: true,
      confidence: conf(0.99, 0.9),
    });
    k = withRelation(k, {
      id: "r1",
      from: "x",
      to: "x",
      kind: "self",
      confidence: conf(0.99, 0.9),
      evidenceIds: ["e1"],
      contextId: "c",
      provenance: "p",
    });
    const g = detectGaps(
      { id: "g", statement: "", requires: [{ conceptId: "x", importance: 1 }] },
      k,
    )[0];
    expect(g.status).toBe("UNCERTAIN");
  });

  it("CONTRADICTED is its own status, NOT 'very uncertain'", () => {
    let k = withConcept(EMPTY_KNOWLEDGE, { id: "x", label: "X", dependsOn: [], contextIds: [] });
    k = withEvidence(k, {
      id: "yes",
      source: "measured",
      statement: "it holds",
      provenance: "run A",
      supports: true,
      confidence: conf(0.9, 0.1),
    });
    k = withEvidence(k, {
      id: "no",
      source: "measured",
      statement: "it does not",
      provenance: "run B",
      supports: false,
      confidence: conf(0.88, 0.1),
    });
    k = withRelation(k, {
      id: "r",
      from: "x",
      to: "x",
      kind: "self",
      confidence: conf(0.5, 0.5),
      evidenceIds: ["yes", "no"],
      contextId: "c",
      provenance: "p",
    });
    const g = detectGaps(
      { id: "g", statement: "", requires: [{ conceptId: "x", importance: 1 }] },
      k,
    )[0];
    expect(g.status).toBe("CONTRADICTED");
    expect(g.supportingEvidence).toBe(1);
    expect(g.opposingEvidence).toBe(1);
    // It carries the HIGHEST expected gain — adjudication resolves it — which
    // an "uncertainty score" alone could never express.
    expect(g.expectedInformationGain).toBeGreaterThan(0.8);
    expect(g.uncertainty).toBeGreaterThanOrEqual(0.75);
    expect(DISPUTE_THRESHOLD).toBe(0.5);
  });

  it("PROVENANCE is required: a relation naming unknown evidence is refused", () => {
    expect(() =>
      withRelation(EMPTY_KNOWLEDGE, {
        id: "r",
        from: "a",
        to: "b",
        kind: "k",
        confidence: conf(0.5),
        evidenceIds: ["nope"],
        contextId: "c",
        provenance: "p",
      }),
    ).toThrow(/unknown evidence/);
  });

  it("a foundation outranks a leaf of equal importance, through `dependency`", () => {
    const gaps = detectGaps(goal, quantumErrorCorrectionSeed());
    const qubit = gaps.find((g) => g.conceptId === "qubit")!;
    const topo = gaps.find((g) => g.conceptId === "topological_code")!;
    // `qubit` is depended on by syndrome and logical_qubit; `topological_code`
    // by nothing in the goal.
    expect(qubit.dependency).toBeGreaterThan(topo.dependency);
  });

  it("openGaps drops VERIFIED and keeps the other three", () => {
    const gaps = detectGaps(goal, quantumErrorCorrectionSeed());
    expect(openGaps(gaps).every((g) => g.status !== "VERIFIED")).toBe(true);
  });

  it("confidence is validated at the boundary", () => {
    expect(() => conf(1.1)).toThrow();
    expect(() => conf(0.5, -0.1)).toThrow();
  });
});

describe("the planner ranks by gain PER COST, not by gain", () => {
  const gaps = detectGaps(goal, quantumErrorCorrectionSeed());

  it("is deterministic and never returns a VERIFIED concept", () => {
    const a = planResearch(goal.id, gaps);
    expect(a).toEqual(planResearch(goal.id, gaps));
    expect(a.candidates.every((c) => !c.reason.startsWith("VERIFIED"))).toBe(true);
  });

  it("an expensive high-gap loses to a cheap lower one — the whole point of §12", () => {
    const top = planResearch(goal.id, gaps, UNIFORM_COST).next!;
    const costly = planResearch(goal.id, gaps, (g) =>
      g.conceptId === top.concept ? 100 : 1,
    ).next!;
    expect(costly.concept).not.toBe(top.concept);
  });

  it("a budget TRUNCATES the plan and says what was dropped", () => {
    // MEASURED FIRST: the seed graph leaves exactly two open gaps (syndrome and
    // topological_code are UNKNOWN; the other three reach VERIFIED on
    // high-confidence, low-volatility evidence). The first draft of this test
    // set a budget of 2 and expected a truncation — with two candidates,
    // nothing was dropped and the assertion was testing the message rather
    // than the behaviour.
    const open = planResearch(goal.id, gaps, UNIFORM_COST);
    expect(open.candidates.length).toBe(2);
    expect(open.rationale).not.toMatch(/dropped as unaffordable/);

    const tight = planResearch(goal.id, gaps, UNIFORM_COST, 1);
    expect(tight.candidates.length).toBe(1);
    expect(tight.totalCost).toBe(1);
    expect(tight.rationale).toMatch(/1 dropped as unaffordable/);
    // The one kept is the one with the higher value per cost, not the first.
    expect(tight.next!.concept).toBe(open.candidates[0].concept);
  });

  it("refuses a non-positive cost rather than dividing by it", () => {
    expect(() => planResearch(goal.id, gaps, () => 0)).toThrow(/cost must be positive/);
  });

  it("with nothing left to ask, `next` is null and it says so", () => {
    const p = planResearch("g", []);
    expect(p.next).toBeNull();
    expect(p.rationale).toMatch(/nothing to research/);
  });
});
