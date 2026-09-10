/**
 * ONIQ AGI Mega Quantum Loop — the 23 stations, and what they refuse.
 *
 * THE REFUSALS ARE THE SUBJECT. A loop that can call a model and write to
 * production is only safe to the extent that its gates hold, so the assertions
 * that matter here are the ones where nothing happens: an unconfigured engine,
 * a zero budget, an irreversible plan with no rollback, an action the world
 * model never offered. A test suite for this that only proved the happy path
 * would be proving the least important half.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CognitiveState } from "@/oqca/formalState";
import { STATIONS, runCognitiveLoop, type LoopInput } from "@/oqca/loop/cognitiveLoop";
import {
  type Budgets,
  type Engine,
  type ToolRouter,
  DEFAULT_BUDGETS,
  RECORD_ONLY_ROUTER,
  breach,
  deterministicClock,
  wouldBreach,
  NO_SPEND,
} from "@/oqca/loop/seams";
import {
  EMPTY_WORLD,
  advance,
  sealLoopState,
  validateLoopState,
  type LoopState,
} from "@/oqca/loop/loopState";
import type { Goal } from "@/oqca/knowledge/gaps";

/**
 * A fixture engine/router that costs nothing. Pricing has its OWN tests below;
 * everywhere else a stub that priced itself would make every assertion depend
 * on a number the test does not care about.
 */
const FREE = () => ({ tokens: 0, costUsd: 0 });
/** A fixture tool that is reversible and touches nothing. */
const SAFE_TOOL = () => ({
  reversible: true,
  touchesProduction: false,
  idempotency: "IDEMPOTENT_WRITE" as const,
});

const GOAL: Goal = {
  id: "g1",
  statement: "publish the weekly digest",
  requires: [{ conceptId: "A", importance: 1 }],
};

function quantum() {
  return CognitiveState.fromWeights(["A", "B"], [1, 1], { contextId: "test", tags: {} });
}

function baseState(over: Partial<Omit<LoopState, "stateId">> = {}): LoopState {
  return sealLoopState({
    parentStateId: null,
    goal: GOAL,
    percepts: [],
    failures: [],
    activeHypotheses: [],
    worldState: EMPTY_WORLD,
    evidenceIds: [],
    knowledgeGaps: [],
    candidatePlans: [],
    selectedPlan: null,
    futures: [],
    predictions: [],
    outcomes: [],
    verification: null,
    memoryRefs: [],
    quantumState: quantum().snapshot(),
    iteration: 0,
    budgets: DEFAULT_BUDGETS,
    spent: NO_SPEND,
    status: "running",
    createdAt: 0,
    ...over,
  });
}

/** Budgets that permit work, so a refusal in a test is the gate under test. */
const OPEN: Budgets = {
  maxIterations: 1,
  maxStateTransitions: 128,
  maxResearchOperations: 8,
  maxToolCalls: 4,
  maxTokens: 100_000,
  maxExecutionTimeMs: 60_000,
  maxCostUsd: 1,
};

function input(over: Partial<LoopInput> = {}): LoopInput {
  return {
    initial: baseState(),
    quantum: quantum(),
    budgets: OPEN,
    clock: deterministicClock(1),
    ...over,
  };
}

describe("the 23 stations", () => {
  it("are the brief's diagram, in order", () => {
    expect(STATIONS).toEqual([
      "PERCEIVE",
      "UNDERSTAND",
      "LOAD_MEMORY",
      "BUILD_WORLD_STATE",
      "REPRESENT",
      "SUPERPOSE",
      "RELATE",
      "REASON",
      "IDENTIFY_GAPS",
      "RESEARCH",
      "VERIFY",
      "UPDATE_STATE",
      "IMAGINE",
      "PLAN",
      "EVALUATE",
      "ACT",
      "OBSERVE",
      "MEASURE",
      "LEARN_OR_CORRECT",
      "CONSOLIDATE",
      "REFLECT",
      "CHECK_GOAL",
      "RESPOND",
    ]);
  });

  it("every one of them runs, and the log names each", async () => {
    const run = await runCognitiveLoop(input());
    expect(run.log.map((r) => r.station)).toEqual([...STATIONS]);
  });
});

describe("an unconfigured loop reasons and acts on nothing, and says which seam was missing", () => {
  it("refuses at every model station with the seam named", async () => {
    // DEFAULT_BUDGETS carries maxTokens 0, so the gate refuses before the
    // engine is even reached — which is the correct order and is why the reason
    // is a bound rather than "no engine configured".
    const run = await runCognitiveLoop({
      initial: baseState(),
      quantum: quantum(),
      clock: deterministicClock(1),
    });
    const understand = run.log.find((r) => r.station === "UNDERSTAND")!;
    expect(understand.refused).toBe("max_tokens");
    // Starved, not halted: every station still ran, and the loop ended with an
    // honest status rather than stopping at PERCEIVE.
    expect(run.log.map((r) => r.station)).toEqual([...STATIONS]);
    expect(run.state.status).toBe("budget_exhausted");
    expect(run.terminated).toBe("max_tokens");
  });

  it("with tokens allowed but no engine, the refusal names the engine", async () => {
    const run = await runCognitiveLoop(input());
    expect(run.log.find((r) => r.station === "UNDERSTAND")!.refused).toMatch(
      /no engine configured/,
    );
  });

  it("and the default router performs nothing", async () => {
    const run = await runCognitiveLoop(input());
    expect(run.spent.costUsd).toBe(0);
    expect(run.state.outcomes.every((o) => !o.matched)).toBe(true);
  });
});

describe("the spending bounds refuse BEFORE the spend, never after", () => {
  const engine: Engine = {
    estimate: FREE,
    run: vi.fn(async () => ({
      ok: true,
      text: "an answer",
      usage: { inputTokens: 100, outputTokens: 100, costUsd: 0.01 },
      model: "test",
    })),
  };

  it("maxTokens 0 means the engine is never called at all", async () => {
    const spy = vi.fn(engine.run);
    await runCognitiveLoop(
      input({ engine: { estimate: FREE, run: spy }, budgets: { ...OPEN, maxTokens: 0 } }),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("maxCostUsd 0 means the engine is never called at all", async () => {
    // The engine PRICES this call, so maxCostUsd 0 refuses it at the cost gate
    // rather than letting a free-priced stub through to the provider.
    const spy = vi.fn(engine.run);
    const priced = { estimate: () => ({ tokens: 100, costUsd: 0.01 }), run: spy };
    await runCognitiveLoop(input({ engine: priced, budgets: { ...OPEN, maxCostUsd: 0 } }));
    expect(spy).not.toHaveBeenCalled();
  });

  it("maxToolCalls 0 means the router is never called at all", async () => {
    const router = vi.fn(RECORD_ONLY_ROUTER.execute);
    await runCognitiveLoop(
      input({
        engine,
        router: { properties: SAFE_TOOL, estimate: FREE, execute: router },
        budgets: { ...OPEN, maxToolCalls: 0 },
        initial: baseState({ worldState: { ...EMPTY_WORLD, availableActions: ["send digest"] } }),
      }),
    );
    expect(router).not.toHaveBeenCalled();
  });

  it("a run that exhausts its cost stops and names max_cost", async () => {
    const greedy: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "x",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.5 },
        model: "t",
      }),
    };
    const run = await runCognitiveLoop(
      input({ engine: greedy, budgets: { ...OPEN, maxCostUsd: 0.6 } }),
    );
    expect(run.terminated).toBe("max_cost");
    expect(run.state.status).toBe("budget_exhausted");
  });

  it("breach checks every bound, not the one the caller expects", () => {
    expect(breach({ ...NO_SPEND, elapsedMs: 99 }, { ...OPEN, maxExecutionTimeMs: 50 })).toBe(
      "max_execution_time",
    );
    expect(breach({ ...NO_SPEND, tokens: 10 }, { ...OPEN, maxTokens: 5 })).toBe("max_tokens");
    expect(wouldBreach(NO_SPEND, OPEN, { tokens: 0, costUsd: 99 })).toBe("max_cost");
    expect(wouldBreach(NO_SPEND, OPEN, { tokens: 0, costUsd: 0.001 })).toBeNull();
  });
});

describe("nothing is fabricated", () => {
  it("no evidence is folded in when the caller supplied none", async () => {
    const run = await runCognitiveLoop(
      input({
        percepts: [
          [
            {
              id: "p1",
              kind: "text",
              content: "hello",
              source: "user",
              confidence: 1,
              provenance: "OBSERVED",
            },
          ],
        ],
      }),
    );
    expect(run.log.find((r) => r.station === "UPDATE_STATE")!.note).toBe(
      "no evidence this iteration",
    );
    run.quantum.probabilities().forEach((v) => expect(v).toBeCloseTo(0.5, 12));
  });

  it("a likelihood vector of the wrong width is refused by name, never padded", async () => {
    const run = await runCognitiveLoop(input({ evidence: [{ likelihoods: [0.9] }] }));
    const r = run.log.find((x) => x.station === "UPDATE_STATE")!;
    expect(r.refused).toBe("likelihood_width_mismatch");
    run.quantum.probabilities().forEach((v) => expect(v).toBeCloseTo(0.5, 12));
  });

  it("caller-supplied evidence IS folded in, exactly as Bayes", async () => {
    const run = await runCognitiveLoop(input({ evidence: [{ likelihoods: [0.8, 0.2] }] }));
    expect(run.quantum.probabilities()[0]).toBeCloseTo(0.8, 12);
  });

  it("IMAGINE cannot invent an action the world model never offered", async () => {
    const liar: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "drop the production database | catastrophic | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    const run = await runCognitiveLoop(
      input({
        engine: liar,
        initial: baseState({ worldState: { ...EMPTY_WORLD, availableActions: ["send digest"] } }),
      }),
    );
    expect(run.state.futures.map((f) => f.action)).toEqual(["send digest"]);
  });
});

describe("EVALUATE is the gate above ACT", () => {
  it("refuses an irreversible step with no rollback, and clears the plan", async () => {
    const engine: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "delete every row | gone | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    const router = vi.fn(RECORD_ONLY_ROUTER.execute);
    const run = await runCognitiveLoop(
      input({
        engine,
        // THE ROUTER SAYS IT IS IRREVERSIBLE, NOT THE ACTION'S NAME. This used
        // to be carried by a regex matching /delete/, which meant a production
        // write called anything else declared itself safe.
        router: {
          properties: () => ({
            reversible: false,
            touchesProduction: true,
            idempotency: "NON_IDEMPOTENT_WRITE" as const,
          }),
          estimate: FREE,
          execute: router,
        },
        initial: baseState({
          worldState: { ...EMPTY_WORLD, availableActions: ["send the digest"] },
        }),
      }),
    );
    const e = run.log.find((r) => r.station === "EVALUATE")!;
    expect(e.refused).toBe("irreversible_no_rollback");
    expect(router).not.toHaveBeenCalled();
    expect(run.log.find((r) => r.station === "ACT")!.refused).toBe("no_plan");
  });

  it("and the action's NAME decides nothing either way", async () => {
    // The mirror of the case above: "delete every row" reaches the router
    // because the router registered it as reversible. Both directions are
    // asserted, because a guard narrowed in one direction only is a weaker
    // guard wearing a test.
    const engine: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "delete every row | gone | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    const router = vi.fn(RECORD_ONLY_ROUTER.execute);
    const run = await runCognitiveLoop(
      input({
        engine,
        router: { properties: SAFE_TOOL, estimate: FREE, execute: router },
        initial: baseState({
          worldState: { ...EMPTY_WORLD, availableActions: ["delete every row"] },
        }),
      }),
    );
    expect(run.log.find((r) => r.station === "EVALUATE")!.refused).toBeNull();
    expect(router).toHaveBeenCalledTimes(1);
  });

  it("a reversible action reaches the router", async () => {
    const engine: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "send digest | delivered | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    const router = vi.fn(RECORD_ONLY_ROUTER.execute);
    await runCognitiveLoop(
      input({
        engine,
        router: { properties: SAFE_TOOL, estimate: FREE, execute: router },
        initial: baseState({ worldState: { ...EMPTY_WORLD, availableActions: ["send digest"] } }),
      }),
    );
    expect(router).toHaveBeenCalledTimes(1);
    expect(router.mock.calls[0][0].touchesProduction).toBe(false);
  });
});

describe("OBSERVE reads the environment, not the tool's own claim", () => {
  it("a router that succeeded but performed nothing does NOT count as matched", async () => {
    const engine: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "send digest | delivered | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    // RECORD_ONLY_ROUTER returns ok:true with output "recorded intent" — the
    // shape a loop would happily read as success if it trusted `output`.
    const run = await runCognitiveLoop(
      input({
        engine,
        router: RECORD_ONLY_ROUTER,
        initial: baseState({ worldState: { ...EMPTY_WORLD, availableActions: ["send digest"] } }),
      }),
    );
    expect(run.state.outcomes).toHaveLength(1);
    expect(run.state.outcomes[0].matched).toBe(false);
    expect(run.state.outcomes[0].predictionError).toBe(1);
  });

  it("and a router the environment confirms DOES", async () => {
    const engine: Engine = {
      estimate: FREE,
      run: async () => ({
        ok: true,
        text: "send digest | delivered | 0.1 | 0.9",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "t",
      }),
    };
    const real: ToolRouter = {
      properties: SAFE_TOOL,
      estimate: FREE,
      execute: async () => ({
        ok: true,
        output: "queued",
        observed: "digest row present in outbox",
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      }),
    };
    const run = await runCognitiveLoop(
      input({
        engine,
        router: real,
        initial: baseState({ worldState: { ...EMPTY_WORLD, availableActions: ["send digest"] } }),
      }),
    );
    expect(run.state.outcomes[0].matched).toBe(true);
    expect(run.log.find((r) => r.station === "LEARN_OR_CORRECT")!.note).toMatch(/^LEARN/);
  });
});

describe("the state is replayable and validated", () => {
  it("the same input twice gives the same state id", async () => {
    const a = await runCognitiveLoop(input());
    const b = await runCognitiveLoop(input());
    expect(a.state.stateId).toBe(b.state.stateId);
    expect(a.log.map((r) => r.note)).toEqual(b.log.map((r) => r.note));
  });

  it("a hand-edited snapshot fails validation on its id", () => {
    const s = baseState();
    expect(validateLoopState(s)).toEqual([]);
    const tampered = { ...s, status: "success" } as LoopState;
    expect(validateLoopState(tampered).map((p) => p.code)).toContain("state_id_mismatch");
  });

  it("a plan that was never a candidate cannot be selected", () => {
    const plan = {
      id: "smuggled",
      objective: "x",
      steps: [],
      requiredTools: [],
      risks: [],
      rollback: null,
      successCriteria: [],
    };
    const s = advance(baseState(), { selectedPlan: plan });
    expect(validateLoopState(s).map((p) => p.code)).toContain("selected_plan_not_a_candidate");
  });

  it("the wall clock is never part of the id", () => {
    const a = sealLoopState({ ...baseState(), wallClock: 1 });
    const b = sealLoopState({ ...baseState(), wallClock: 999_999 });
    expect(a.stateId).toBe(b.stateId);
  });
});

describe("stations 07 and 19 are NOT the category-C quantum operations they share a name with", () => {
  const source = readFileSync("src/oqca/loop/cognitiveLoop.ts", "utf8");

  it("the loop never calls entangle() or correct()", () => {
    // Read structurally: the import list is what would have to change first.
    const imports = /import \{([^}]*)\} from "\.\.\/cognitive\.ts";/.exec(source)![1];
    expect(imports).not.toMatch(/\bentangle\b/);
    expect(imports).not.toMatch(/\bcorrect\b/);
  });

  it("RELATE and LEARN_OR_CORRECT still run rather than refusing", async () => {
    const run = await runCognitiveLoop(input());
    expect(run.log.find((r) => r.station === "RELATE")!.refused).toBeNull();
    expect(run.log.find((r) => r.station === "LEARN_OR_CORRECT")!.refused).toBeNull();
  });
});
