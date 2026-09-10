/**
 * OQCA v1.1 — the Mega Quantum Loop. Brief §13 and §18 "Loop".
 *
 * The four things the brief asks for, each tested by making it happen rather
 * than by reading the source: bounded execution, pause/resume, deterministic
 * replay, and failure recovery.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOUNDS,
  LOOP_PHASES,
  RECORD_ONLY_ACTUATOR,
  UNPERFORMABLE_PHASES,
  runMegaLoop,
  type Observation,
} from "@/oqca/loop/megaLoop";
import { CognitiveState } from "@/oqca/formalState";
import { quantumErrorCorrectionSeed } from "@/oqca/knowledge/model";
import type { Goal } from "@/oqca/knowledge/gaps";
import { angleFromStrength } from "@/oqca/math/unitary";

const start = () => CognitiveState.fromWeights(["A", "B", "C"], [1, 1, 1]);
const obs: Observation[] = [
  {
    likelihoods: [0.5, 0.5, 0.2],
    phases: [0, Math.PI, 0],
    interfere: [0, 1, angleFromStrength(0.9)],
  },
  { likelihoods: [0.6, 0.3, 0.1] },
  // FOUR likelihoods: SUPERPOSE runs before EVIDENCE_UPDATE, so the vector is
  // sized to the basis AFTER "D" is admitted. The loop refuses any other width
  // rather than padding one, and the test below proves that refusal.
  { likelihoods: [0.7, 0.2, 0.1, 0.4], admit: { label: "D", share: 0.1 } },
];
const goal: Goal = {
  id: "g",
  statement: "s",
  requires: [
    { conceptId: "syndrome", importance: 1 },
    { conceptId: "qubit", importance: 0.5 },
  ],
};

describe("bounded execution", () => {
  it("visits all eighteen phases per iteration, in order", () => {
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 1 } });
    expect(r.log.map((l) => l.phase)).toEqual([...LOOP_PHASES]);
  });

  it("stops at maxIterations and never runs unbounded", () => {
    const many = Array.from({ length: 50 }, () => ({ likelihoods: [0.5, 0.3, 0.2] }));
    const r = runMegaLoop({ initial: start(), observations: many, bounds: { maxIterations: 3 } });
    expect(r.iterations).toBe(3);
    expect(r.terminated).toBe("max_iterations");
  });

  it("stops at maxStateTransitions", () => {
    const many = Array.from({ length: 50 }, () => ({ likelihoods: [0.5, 0.3, 0.2] }));
    const r = runMegaLoop({
      initial: start(),
      observations: many,
      bounds: { maxIterations: 50, maxStateTransitions: 3 },
    });
    expect(r.terminated).toBe("max_state_transitions");
    expect(r.iterations).toBeLessThan(50);
  });

  it("stops at maxResearchOperations", () => {
    const many = Array.from({ length: 20 }, () => ({ likelihoods: [0.5, 0.3, 0.2] }));
    const r = runMegaLoop({
      initial: start(),
      observations: many,
      goal,
      knowledge: quantumErrorCorrectionSeed(),
      bounds: { maxIterations: 20, maxResearchOperations: 2, maxStateTransitions: 1000 },
    });
    expect(r.terminated).toBe("max_research_operations");
  });

  it("THE DEFAULT TOOL BUDGET IS ZERO: ACT records an intent and performs nothing", () => {
    expect(DEFAULT_BOUNDS.maxToolCalls).toBe(0);
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 1 } });
    expect(r.intents).toHaveLength(1);
    expect(r.intents[0].description).toMatch(/NOT performed|not performed/);
    const act = r.log.find((l) => l.phase === "ACT")!;
    expect(act.skipped).toBe("max_tool_calls");
  });

  it("an actuator runs only when the caller raises the budget, and it is pure", () => {
    const seen: string[] = [];
    const r = runMegaLoop({
      initial: start(),
      observations: obs,
      bounds: { maxIterations: 1, maxToolCalls: 1 },
      actuator: (i) => {
        seen.push(i.chosen ?? "none");
        return `described ${i.chosen}`;
      },
    });
    expect(seen).toHaveLength(1);
    expect(r.intents[0].description).toMatch(/^described /);
  });

  it("the default actuator describes and cannot act", () => {
    expect(
      RECORD_ONLY_ACTUATOR({
        iteration: 0,
        chosen: "A",
        probability: 0.5,
        margin: 0.1,
        description: "",
      }),
    ).toMatch(/recorded intent only/);
  });
});

describe("the two phases that cannot be performed", () => {
  it("ENTANGLE and CORRECT are VISITED, refused by name, and reported", () => {
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 1 } });
    expect(Object.keys(UNPERFORMABLE_PHASES).sort()).toEqual(["CORRECT", "ENTANGLE"]);
    expect(r.unperformed.map((u) => u.phase).sort()).toEqual(["CORRECT", "ENTANGLE"]);
    for (const u of r.unperformed) expect(u.reason).toMatch(/category C/);
    // They are in the LOG, not dropped from the sequence.
    expect(r.log.filter((l) => l.phase === "ENTANGLE")).toHaveLength(1);
    expect(r.log.find((l) => l.phase === "CORRECT")!.skipped).toMatch(/category C/);
  });

  it("nothing is silently substituted for them: no transition names them", () => {
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 2 } });
    const ops = r.state.history.map((h) => h.operation);
    expect(ops).not.toContain("ENTANGLE");
    expect(ops).not.toContain("CORRECT");
  });
});

describe("pause and resume", () => {
  it("resuming from a snapshot reaches the SAME state as running straight through", () => {
    const full = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 3 } });
    const paused = runMegaLoop({
      initial: start(),
      observations: obs,
      bounds: { maxIterations: 3 },
      stopAfterPhases: 25,
    });
    expect(paused.terminated).toBe("paused");
    const resumed = runMegaLoop({
      initial: start(),
      observations: obs,
      bounds: { maxIterations: 3 },
      resumeFrom: paused.snapshot,
    });
    expect(resumed.state.stateId).toBe(full.state.stateId);
    expect(resumed.state.probabilities()).toEqual(full.state.probabilities());
  });

  it("the snapshot survives a JSON round trip, which is what 'serialized' means", () => {
    const paused = runMegaLoop({
      initial: start(),
      observations: obs,
      bounds: { maxIterations: 3 },
      stopAfterPhases: 20,
    });
    const wire = JSON.parse(JSON.stringify(paused.snapshot));
    const resumed = runMegaLoop({
      initial: start(),
      observations: obs,
      bounds: { maxIterations: 3 },
      resumeFrom: wire,
    });
    const full = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 3 } });
    expect(resumed.state.stateId).toBe(full.state.stateId);
  });
});

describe("deterministic replay", () => {
  it("the same input produces the same state id and the same log, twice", () => {
    const a = runMegaLoop({
      initial: start(),
      observations: obs,
      goal,
      knowledge: quantumErrorCorrectionSeed(),
      bounds: { maxIterations: 3 },
    });
    const b = runMegaLoop({
      initial: start(),
      observations: obs,
      goal,
      knowledge: quantumErrorCorrectionSeed(),
      bounds: { maxIterations: 3 },
    });
    expect(a.state.stateId).toBe(b.state.stateId);
    expect(a.log.map((l) => `${l.iteration}:${l.phase}:${l.note}`)).toEqual(
      b.log.map((l) => `${l.iteration}:${l.phase}:${l.note}`),
    );
  });
});

describe("failure recovery", () => {
  it("the ERROR phase reports the state's own validity every iteration", () => {
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 2 } });
    const errors = r.log.filter((l) => l.phase === "ERROR");
    expect(errors).toHaveLength(2);
    for (const e of errors) expect(e.note).toBe("state valid");
  });

  it("an iteration with NO observation runs to completion rather than throwing", () => {
    const r = runMegaLoop({ initial: start(), observations: [], bounds: { maxIterations: 2 } });
    expect(r.terminated).toBe("completed");
    expect(r.state.validate().ok).toBe(true);
    expect(
      r.log
        .filter((l) => l.phase === "EVIDENCE_UPDATE")
        .every((l) => l.note.includes("no evidence")),
    ).toBe(true);
  });

  it("an observation sized to the PRE-admission basis is refused, by name", () => {
    expect(() =>
      runMegaLoop({
        initial: start(),
        observations: [{ likelihoods: [0.5, 0.3, 0.2], admit: { label: "D", share: 0.1 } }],
        bounds: { maxIterations: 1 },
      }),
    ).toThrow(/SUPERPOSE runs first|post-admission basis/);
  });

  it("evidence that rules everything out THROWS rather than producing a bad state", () => {
    expect(() =>
      runMegaLoop({
        initial: start(),
        observations: [{ likelihoods: [0, 0, 0] }],
        bounds: { maxIterations: 1 },
      }),
    ).toThrow();
  });

  it("with no goal supplied, the gap phase says so instead of inventing gaps", () => {
    const r = runMegaLoop({ initial: start(), observations: obs, bounds: { maxIterations: 1 } });
    expect(r.gaps).toHaveLength(0);
    expect(r.log.find((l) => l.phase === "IDENTIFY_GAPS")!.skipped).toBe("no goal supplied");
  });

  it("with a goal, it identifies gaps and plans without executing anything", () => {
    const r = runMegaLoop({
      initial: start(),
      observations: obs,
      goal,
      knowledge: quantumErrorCorrectionSeed(),
      bounds: { maxIterations: 1 },
    });
    expect(r.gaps.length).toBe(2);
    expect(r.plan!.next!.concept).toBe("syndrome");
  });
});
