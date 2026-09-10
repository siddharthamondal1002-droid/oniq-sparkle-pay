/**
 * OQCA v1.6 — COGNITIVE AUTONOMY != RESOURCE AVAILABILITY.
 *
 * Owner directive 2026-09-10: _"The autonomous runtime must NOT become
 * cognitively inert because an execution budget is zero... 'budget = 0' must
 * NOT mean 'autonomous runtime = stopped'. It should mean only that a
 * particular resource-consuming action cannot currently execute."_
 *
 * WHAT THIS FILE IS FOR, AND WHY IT IS SEPARATE FROM `autonomy.test.ts`. That
 * file's subject is the runtime's bounds; this one's is a single claim made ten
 * ways — that at a ZERO external allowance ONIQ still generates objectives,
 * still plans, still identifies gaps, still selects, still records, still
 * refuses what it must refuse, and comes back to the blocked work when the
 * resource returns. Every test here is one of the ten the directive named, and
 * each says which.
 *
 * THE ONE THING NONE OF THEM DOES IS RELAX A CONTROL. `wouldBreach`, `breach`
 * and `breachRun` are untouched by v1.6 and every gate still refuses BEFORE the
 * call it guards; what changed is only what a refusal MEANS to the stations
 * after it. Tests 9 and 10 are the ones that pin that: the spend accounting is
 * still exact, and a number ONIQ sets for itself can never become somebody
 * else's decision about who ONIQ is.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CognitiveState } from "@/oqca/formalState";
import { STATIONS, runCognitiveLoop, type LoopInput } from "@/oqca/loop/cognitiveLoop";
import {
  AVAILABILITIES,
  CAPABILITIES,
  CAPABILITY_UNAVAILABLE,
  availabilityForBound,
  availabilityForFailureClass,
  capabilityList,
  isExecutable,
  recordCapability,
  unavailable,
  type Capability,
  type CapabilityState,
} from "@/oqca/loop/capability";
import {
  DEFAULT_BUDGETS,
  NO_SPEND,
  deterministicClock,
  type Budgets,
  type BoundBreach,
  type Engine,
} from "@/oqca/loop/seams";
import { EMPTY_WORLD, sealLoopState, type LoopState } from "@/oqca/loop/loopState";
import type { Goal } from "@/oqca/knowledge/gaps";
import {
  EMPTY_KNOWLEDGE,
  conf,
  withConcept,
  withEvidence,
  type KnowledgeState,
} from "@/oqca/knowledge/model";
import { detectGaps, openGaps } from "@/oqca/knowledge/gaps";
import { rankLearningTargets } from "@/oqca/autonomy/select";
import { generateObjectives, userObjective, type Objective } from "@/oqca/autonomy/objective";
import {
  DEFAULT_RUNTIME_BOUNDS,
  emptySnapshot,
  observeCapabilities,
  reconsider,
  runAutonomousRuntime,
  validateSnapshot,
  type EpisodeOutcome,
  type RunEpisode,
  type RuntimeSnapshot,
  type Survey,
} from "@/oqca/autonomy/runtime";
import { stripComments } from "@/test/sourceText";

/* ---------------------------------------------------------------- *
 * FIXTURES
 * ---------------------------------------------------------------- */

const SEAMS_FOR_UNION = "src/oqca/loop/seams.ts";

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

/** The shipped defaults: every external allowance is ZERO. */
function starved(over: Partial<LoopInput> = {}): LoopInput {
  return {
    initial: baseState(),
    quantum: quantum(),
    budgets: DEFAULT_BUDGETS,
    clock: deterministicClock(1),
    ...over,
  };
}

function cap(over: Partial<CapabilityState> = {}): CapabilityState {
  return {
    capability: "model",
    availability: "insufficient_allowance",
    detail: "no allowance",
    bound: "max_tokens",
    station: "UNDERSTAND",
    ...over,
  };
}

function outcome(over: Partial<EpisodeOutcome> = {}): EpisodeOutcome {
  return {
    status: "success",
    note: "fixture",
    blockedOn: [],
    blockedReason: null,
    capabilities: [],
    settled: [],
    learned: [],
    ...over,
  };
}

/** A knowledge state with one supported concept and one with no evidence. */
function knowledgeWithGap(): KnowledgeState {
  let k = EMPTY_KNOWLEDGE;
  k = withConcept(k, {
    id: "runner-availability",
    label: "runner availability",
    dependsOn: [],
    contextIds: ["t"],
  });
  k = withConcept(k, {
    id: "queue-depth",
    label: "queue depth",
    dependsOn: ["runner-availability"],
    contextIds: ["t"],
  });
  k = withEvidence(k, {
    id: "e1",
    source: "document",
    statement: "queue-depth",
    provenance: "fixture",
    supports: true,
    confidence: conf(0.9, 0),
  });
  return k;
}

function surveyOver(k: KnowledgeState): Survey {
  return async () => ({
    ok: true,
    gaps: openGaps(detectGaps(GOAL_LEARN, k)),
    knowledge: k,
    stale: [],
  });
}

const GOAL_LEARN: Goal = {
  id: "learn",
  statement: "know the queue",
  requires: [
    { conceptId: "runner-availability", importance: 1 },
    { conceptId: "queue-depth", importance: 0.6 },
  ],
};

function blockedByModel(over: Partial<Objective> = {}): Objective {
  const base = userObjective(GOAL_LEARN, 0);
  return {
    ...base,
    status: "blocked",
    blockedReason: "model: no allowance",
    blockedOn: [],
    blockedCapabilities: [cap()],
    attempts: 1,
    ...over,
  };
}

/* ================================================================ *
 * THE VOCABULARY — a bound is not an authorization decision.
 * ================================================================ */

describe("v1.6 vocabulary — a capability state is not a cognitive verdict", () => {
  it("classifies every bound as CAPABILITY or RUN, and never invents a third kind", () => {
    // The CAPABILITY bounds refuse ONE action. The RUN bounds end the run and
    // return null here, which is what stops a caller from filing "this run has
    // no transitions left" as though somebody could go and grant it.
    const capabilityBounds: BoundBreach[] = [
      "max_tokens",
      "max_cost",
      "max_tool_calls",
      "max_research_operations",
      "unpriced",
    ];
    const runBounds: BoundBreach[] = [
      "max_iterations",
      "max_state_transitions",
      "max_execution_time",
    ];
    for (const b of capabilityBounds) expect(availabilityForBound(b)).not.toBeNull();
    for (const b of runBounds) expect(availabilityForBound(b)).toBeNull();
    /**
     * EVERY MEMBER OF THE UNION IS CLASSIFIED, read from `seams.ts` rather than
     * from a list this file keeps. `BoundBreach` is a type, so it evaporates at
     * runtime and there is nothing to enumerate; a hand-kept copy here would
     * agree with itself forever while a ninth bound went unclassified. The
     * exhaustiveness `throw` in `availabilityForBound` covers a replayed value;
     * this covers a value the compiler knows about and nobody classified.
     */
    const union = stripComments(readFileSync(SEAMS_FOR_UNION, "utf8"))
      .split("export type BoundBreach =")[1]
      .split(";")[0];
    const declared = new Set([...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    expect(declared).toEqual(new Set([...capabilityBounds, ...runBounds]));
  });

  it("TEST 10 — a bound ONIQ set for itself can never become a permission refusal", () => {
    /**
     * REQUIREMENT 10, AND IT IS AN INVARIANT RATHER THAN A CONVENTION. A zero
     * allowance is ONIQ's own number; `unauthorized`, `no_credentials` and
     * `rate_limited` are somebody ELSE's decision about who ONIQ is. If raising
     * a budget could produce one of those, a person reading the log would go
     * and raise a number to fix a credential — and, worse, a review of "was
     * this authorized" would be answerable by editing a budget.
     */
    const forbidden = new Set(["unauthorized", "no_credentials", "rate_limited"]);
    const ALL: BoundBreach[] = [
      "max_iterations",
      "max_state_transitions",
      "max_tool_calls",
      "max_research_operations",
      "max_tokens",
      "max_execution_time",
      "max_cost",
      "unpriced",
    ];
    for (const b of ALL) {
      const a = availabilityForBound(b);
      if (a !== null) expect(forbidden.has(a)).toBe(false);
    }
    // The only route to those three is a PROVIDER saying so, through the
    // recovery layer's own classification.
    expect(availabilityForFailureClass("AUTHORIZATION")).toBe("unauthorized");
    expect(availabilityForFailureClass("RATE_LIMIT")).toBe("rate_limited");
    expect(availabilityForFailureClass("BUDGET")).toBe("insufficient_allowance");
  });

  it("`unpriced` is a missing PRICE, not a missing budget", () => {
    // Raising every ceiling would not admit an unpriced call, so filing it as
    // an allowance would send whoever reads it to the wrong control.
    expect(availabilityForBound("unpriced")).toBe("resource_unavailable");
  });

  it("a refusal outranks a success WITHIN one run, and the first refusal is kept", () => {
    // A run refused once did less than a run that was not, and the receipt has
    // to say so or the accounting requirement 6 asks for quietly loses the half
    // that matters.
    let ledger = new Map<Capability, CapabilityState>();
    ledger = recordCapability(ledger, cap({ availability: "available", detail: "fine" }));
    ledger = recordCapability(ledger, cap({ detail: "first refusal" }));
    ledger = recordCapability(ledger, cap({ availability: "rate_limited", detail: "second" }));
    ledger = recordCapability(ledger, cap({ availability: "available", detail: "later ok" }));
    expect(ledger.get("model")).toMatchObject({
      availability: "insufficient_allowance",
      detail: "first refusal",
    });
    expect(unavailable(capabilityList(ledger))).toHaveLength(1);
    expect(isExecutable("available")).toBe(true);
    for (const a of AVAILABILITIES.filter((x) => x !== "available")) {
      expect(isExecutable(a)).toBe(false);
    }
  });

  it("ACROSS cycles the latest observation wins, which is the opposite rule and is why", () => {
    /**
     * Requirement 8 is unreachable under the within-run rule: a ledger that
     * preserved a refusal forever could never see a credential come back. The
     * two rules are opposite ON PURPOSE and both are asserted, so a future
     * simplification that unified them goes red rather than silently removing
     * recovery.
     */
    let ledger = new Map<Capability, CapabilityState>();
    ledger = observeCapabilities(ledger, [cap()]);
    ledger = observeCapabilities(ledger, [cap({ availability: "available", detail: "back" })]);
    expect(ledger.get("model")?.availability).toBe("available");
    // Silence is NOT an observation: a capability the episode never touched is
    // left alone rather than cleared.
    ledger = observeCapabilities(ledger, [
      cap({ capability: "tool", availability: "no_credentials" }),
    ]);
    expect(ledger.get("model")?.availability).toBe("available");
    expect(ledger.get("tool")?.availability).toBe("no_credentials");
    expect(capabilityList(ledger).map((c) => c.capability)).toEqual(
      CAPABILITIES.filter((c) => c === "model" || c === "tool"),
    );
  });
});

/* ================================================================ *
 * THE LOOP AT ZERO — it thinks, it just cannot spend.
 * ================================================================ */

describe("v1.6 — a zero execution allowance does not stop cognition", () => {
  it("TESTS 1-3 — every station still runs, every iteration, at a zero allowance", async () => {
    /**
     * THE EXACT DEFECT THIS VERSION REMOVES. Before v1.6 the first refused model
     * call set a run-level `starvedBy`, CHECK_GOAL turned it into the terminal
     * status `budget_exhausted`, and the run ended on iteration 1 — so
     * IDENTIFY_GAPS, IMAGINE, PLAN, MEASURE, LEARN_OR_CORRECT, CONSOLIDATE and
     * REFLECT never ran again. A missing resource was reported as the end of
     * thinking.
     */
    const run = await runCognitiveLoop(starved());
    expect(run.log.map((r) => r.station).slice(0, STATIONS.length)).toEqual([...STATIONS]);
    expect(run.log.length).toBe(STATIONS.length * DEFAULT_BUDGETS.maxIterations);
    // It is BLOCKED, which names a resource, and NOT `budget_exhausted`, which
    // names ONIQ's own wallet and reads as "this run is over".
    expect(run.state.status).toBe("blocked");
    expect(run.terminated).toBe(CAPABILITY_UNAVAILABLE);
  });

  it("TEST 3 — knowledge-gap identification still happens with no allowance at all", async () => {
    // Gap detection reads the knowledge state and spends nothing, so it may
    // never be gated on a resource — and a real gap has to be THERE for the
    // assertion to mean anything, which is what the knowledge seam supplies.
    const run = await runCognitiveLoop(
      starved({
        initial: baseState({ goal: GOAL_LEARN }),
        knowledge: knowledgeWithGap(),
      }),
    );
    expect(run.log.filter((r) => r.station === "IDENTIFY_GAPS").length).toBe(
      DEFAULT_BUDGETS.maxIterations,
    );
    expect(run.gaps.length).toBeGreaterThan(0);
    expect(run.gaps.map((g) => g.conceptId)).toContain("runner-availability");
  });

  it("TEST 2 — planning still happens, and the plan is simply not executed", async () => {
    const run = await runCognitiveLoop(starved());
    expect(run.log.filter((r) => r.station === "IMAGINE").length).toBe(
      DEFAULT_BUDGETS.maxIterations,
    );
    expect(run.log.filter((r) => r.station === "PLAN").length).toBe(DEFAULT_BUDGETS.maxIterations);
    expect(run.log.filter((r) => r.station === "EVALUATE").length).toBe(
      DEFAULT_BUDGETS.maxIterations,
    );
    // EVALUATE clears the plan rather than ending the run: the thinking stands
    // and only the execution is refused.
    expect(run.state.selectedPlan).toBeNull();
  });

  it("TEST 9 — the refusal is recorded per capability, with the bound that caused it", async () => {
    const run = await runCognitiveLoop(starved());
    const model = run.capabilities.find((c) => c.capability === "model");
    expect(model).toMatchObject({
      availability: "insufficient_allowance",
      bound: "max_tokens",
    });
    expect(model?.station).toBeTruthy();
    expect(model?.detail).toMatch(/max_tokens/);
    /**
     * REQUIREMENT 7 — NOTHING WAS FABRICATED IN PLACE OF THE REFUSED CALL, and
     * the honest form of that assertion is about the SPEND and the CONTENT, not
     * about `answer` being null. RESPOND composes ONIQ's own one-line status
     * from the state it can see; that is a report, not an invention. What would
     * be a fabrication is a model answer nobody paid for, so what is asserted is
     * that the line REPORTS the block and that not one token was spent.
     */
    expect(run.answer).toMatch(/blocked/);
    expect(run.spent.tokens).toBe(0);
    expect(run.spent.costUsd).toBe(0);
    expect(run.spent.toolCalls).toBe(0);
  });

  it("TEST 9 — a RUN bound still ends the run, and is NOT filed as a capability", async () => {
    /**
     * The other half of the fix, and the half that would be easy to lose. Time
     * and transitions are runaway guards: they mean this run has no room left,
     * and carrying on would be the loop ignoring its own stop. So they still
     * terminate — with their own name, never `capability_unavailable`.
     */
    /**
     * TIME rather than transitions, and the reason is worth the line: at a zero
     * allowance the loop makes NO state transitions — they are counted at
     * IMAGINE and ACT, which are exactly the stations a refused capability
     * skips — so `maxStateTransitions` is unreachable here and a test written
     * against it would have passed for the wrong reason. Measured, not assumed:
     * with `maxStateTransitions: 3` the run went all four iterations.
     */
    const budgets: Budgets = { ...DEFAULT_BUDGETS, maxExecutionTimeMs: 5 };
    const run = await runCognitiveLoop(starved({ budgets, initial: baseState({ budgets }) }));
    expect(run.terminated).toBe("max_execution_time");
    expect(run.log.length).toBeLessThan(STATIONS.length);
    expect(run.capabilities.every((c) => c.bound !== "max_execution_time")).toBe(true);
  });

  it("TEST 5 — an unavailable model does not stop the run; a working one is recorded as working", async () => {
    // The positive observation matters as much as the refusal: without it the
    // runtime could never tell a capability that came back from one it never
    // touched. Requirement 8 rests on this row existing.
    const engine: Engine = {
      estimate: () => ({ tokens: 5, costUsd: 0 }),
      run: async () => ({
        ok: true,
        text: "an answer",
        usage: { tokens: 5, inputTokens: 3, outputTokens: 2, costUsd: 0 },
        model: "fixture",
      }),
    };
    const budgets: Budgets = { ...DEFAULT_BUDGETS, maxTokens: 1000, maxCostUsd: 1 };
    const run = await runCognitiveLoop(
      starved({ budgets, initial: baseState({ budgets }), engine }),
    );
    expect(run.capabilities.find((c) => c.capability === "model")?.availability).toBe("available");
  });
});

/* ================================================================ *
 * THE LIFECYCLE — blocked on a resource, and still autonomous.
 * ================================================================ */

describe("v1.6 — resource unavailability is a capability state, never cognitive death", () => {
  const oneGap = knowledgeWithGap();

  it("TEST 1 — a zero allowance does not stop objective generation", async () => {
    /**
     * The generator reads a knowledge state and ranks gaps. Nothing in it can
     * spend anything, which is exactly why `Capability` names four consequential
     * things and generation is not one of them: a capability that cannot be
     * consumed cannot be unavailable, so it can never be gated on a resource.
     */
    const report = await runAutonomousRuntime({
      survey: surveyOver(oneGap),
      runEpisode: async () =>
        outcome({
          status: "blocked",
          note: "no allowance",
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        }),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 2 },
    });
    expect(report.generated).toBeGreaterThan(0);
    expect(report.episodes).toBeGreaterThan(0);
    // And the objectives are real work, not placeholders.
    const targets = rankLearningTargets({
      gaps: openGaps(detectGaps(GOAL_LEARN, oneGap)),
      knowledge: oneGap,
    });
    expect(
      generateObjectives({ targets, knowledge: oneGap, stale: [], at: 0 }).length,
    ).toBeGreaterThan(0);
  });

  it("TEST 4/5 — an unavailable capability stops the ACTION, not the runtime", async () => {
    /**
     * The behaviour the directive's diagram asks for: capability available? NO
     * -> record the dependency, select another useful objective, continue. Two
     * objectives; the first blocks on research, the second runs and succeeds,
     * and the runtime never stops on the first.
     */
    const seen: string[] = [];
    const runEpisode: RunEpisode = async (o) => {
      seen.push(o.goal.id);
      if (o.goal.id === "blocked-goal") {
        return outcome({
          status: "blocked",
          note: "research is not wired",
          blockedReason: "research: no adapter",
          capabilities: [
            cap({ capability: "research", availability: "provider_unavailable", bound: null }),
          ],
        });
      }
      return outcome({ status: "success", settled: ["done"], learned: ["done"] });
    };
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey in this test" }),
      runEpisode,
      seed: [
        userObjective(
          {
            id: "blocked-goal",
            statement: "needs research",
            requires: [{ conceptId: "r", importance: 1 }],
          },
          0,
          2,
        ),
        userObjective(
          {
            id: "runnable-goal",
            statement: "needs nothing",
            requires: [{ conceptId: "s", importance: 1 }],
          },
          0,
          1,
        ),
      ],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    // TEST 7 — another executable objective WAS selected, after the block.
    expect(seen).toEqual(["blocked-goal", "runnable-goal"]);
    expect(report.learned).toContain("done");
    // TEST 6 — the blocked objective is still there, with its dependency.
    const kept = report.snapshot.backlog.find((o) => o.goal.id === "blocked-goal");
    expect(kept?.status).toBe("blocked");
    expect(kept?.blockedCapabilities.map((c) => c.capability)).toEqual(["research"]);
    // TEST 9 — the resource accounting is on the report and on the record.
    expect(report.capabilityBlocks).toBe(1);
    expect(report.capabilities.find((c) => c.capability === "research")?.availability).toBe(
      "provider_unavailable",
    );
    expect(report.history[0].capabilities).toHaveLength(1);
  });

  it("TEST 6 — a capability-blocked objective spawns NO follow-up, because none could help", async () => {
    /**
     * A follow-up objective says "go and learn the thing that blocks this". A
     * missing credential has nothing to learn, so the follow-up would block the
     * same way forever — a runtime that looks busy and learns nothing, which is
     * the regress `MAX_FOLLOW_UP_DEPTH` exists to bound. The refusal is
     * STRUCTURAL: `followUpFor` reads `blockedOn`, and a resource block names no
     * concept.
     */
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({
          status: "blocked",
          note: "no allowance",
          blockedOn: [],
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        }),
      seed: [userObjective(GOAL_LEARN, 0)],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    expect(report.history.every((h) => h.followUpId === null)).toBe(true);
    expect(report.snapshot.backlog).toHaveLength(1);
  });

  it("TEST 4 — the stop NAMES the resource, and it is not `stalled`", async () => {
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({
          status: "blocked",
          note: "no key",
          blockedReason: "tool: no credentials",
          capabilities: [
            cap({
              capability: "tool",
              availability: "no_credentials",
              bound: null,
              detail: "no key",
            }),
          ],
        }),
      seed: [userObjective(GOAL_LEARN, 0)],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    expect(report.stop).toBe("capability_blocked");
    expect(report.stopDetail).toMatch(/tool:no_credentials/);
  });

  it("a RUN of resource blocks stops this invocation by NAME, with work still pending", async () => {
    /**
     * THE CONSECUTIVE-BLOCK GUARD, AND IT NEEDED ITS OWN TEST BECAUSE A
     * MUTATION SAID SO. Disabling it reported GREEN: with only one objective
     * the backlog empties and the SELECTION branch reports
     * `capability_blocked` anyway, so the two paths overlapped and the guard
     * was never the thing under test. Four objectives and a bound of three
     * separate them — the run stops with one never attempted, and with the
     * guard disabled the same four episodes end as `stalled`.
     *
     * It is still a runaway guard rather than a verdict: the backlog is intact
     * and the next invocation reconsiders it the moment the resource returns.
     */
    const seen: string[] = [];
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async (o) => {
        seen.push(o.goal.id);
        return outcome({
          status: "blocked",
          note: "no allowance",
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        });
      },
      seed: [1, 2, 3, 4].map((n) =>
        userObjective(
          { id: `o${n}`, statement: `job ${n}`, requires: [{ conceptId: `c${n}`, importance: 1 }] },
          0,
          5 - n,
        ),
      ),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 8, maxConsecutiveBlocked: 3 },
    });
    expect(report.stop).toBe("capability_blocked");
    expect(report.stopDetail).toMatch(/in a row/);
    expect(seen).toHaveLength(3);
    // The fourth was never attempted and is STILL PENDING — the runtime stopped
    // this invocation, it did not decide the work was impossible.
    expect(report.snapshot.backlog.filter((o) => o.status === "pending")).toHaveLength(1);
  });

  it("a block that names NO capability is still `stalled` — both arms stay live", async () => {
    // The distinction only means something if the other arm is reachable. A
    // cognitive block with no resource refused reports the cognitive stop.
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({ status: "blocked", note: "stuck", blockedReason: "stuck", capabilities: [] }),
      seed: [userObjective(GOAL_LEARN, 0)],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    expect(report.stop).toBe("stalled");
  });

  it("TEST 8 — the blocked objective is reconsidered when the capability comes back", async () => {
    /**
     * THE WHOLE POINT OF PRESERVING THE DEPENDENCY. Episode 1 blocks on the
     * model; episode 2 observes the model working; the blocked objective goes
     * back to `pending` in the same cycle and runs. Without the ledger this is
     * unreachable — a refusal kept forever can never be seen to clear.
     */
    let call = 0;
    const runEpisode: RunEpisode = async () => {
      call += 1;
      if (call === 1) {
        return outcome({
          status: "blocked",
          note: "no allowance",
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        });
      }
      return outcome({
        status: "success",
        settled: ["A"],
        learned: ["A"],
        capabilities: [cap({ availability: "available", detail: "budget raised" })],
      });
    };
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode,
      seed: [
        userObjective(GOAL_LEARN, 0, 2),
        userObjective(
          {
            id: "other",
            statement: "something else",
            requires: [{ conceptId: "z", importance: 1 }],
          },
          0,
          1,
        ),
      ],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    const reconsideredIds = report.history.flatMap((h) => h.reconsidered);
    expect(reconsideredIds.length).toBeGreaterThan(0);
    // It did not merely go back to pending — it RAN, three episodes for two
    // seeded objectives.
    expect(report.episodes).toBe(3);
    expect(report.snapshot.backlog.filter((o) => o.status === "done")).toHaveLength(2);
  });

  it("TEST 8 — reconsideration needs a POSITIVE observation; silence is not availability", () => {
    // A ledger that has never observed the capability leaves the objective
    // blocked. Reawakening on unknown would spin the runtime every cycle.
    const waiting = [blockedByModel()];
    expect(reconsider(waiting, new Map())[0].status).toBe("blocked");
    const stillRefused = observeCapabilities(new Map(), [cap({ availability: "rate_limited" })]);
    expect(reconsider(waiting, stillRefused)[0].status).toBe("blocked");
    const back = observeCapabilities(new Map(), [cap({ availability: "available" })]);
    const woken = reconsider(waiting, back)[0];
    expect(woken.status).toBe("pending");
    expect(woken.blockedCapabilities).toEqual([]);
  });

  it("TEST 8 — reconsideration is bounded by MAX_ATTEMPTS, so a flapping resource cannot spin it", () => {
    const spent = blockedByModel({ attempts: 3 });
    const back = observeCapabilities(new Map(), [cap({ availability: "available" })]);
    expect(reconsider([spent], back)[0]).toMatchObject({
      status: "abandoned",
      blockedReason: "attempts exhausted",
    });
  });

  it("TEST 8 — an objective waiting on TWO capabilities waits for BOTH", () => {
    const waiting = [
      blockedByModel({
        blockedCapabilities: [cap(), cap({ capability: "tool", availability: "no_credentials" })],
      }),
    ];
    const half = observeCapabilities(new Map(), [cap({ availability: "available" })]);
    expect(reconsider(waiting, half)[0].status).toBe("blocked");
    const both = observeCapabilities(half, [
      cap({ capability: "tool", availability: "available" }),
    ]);
    expect(reconsider(waiting, both)[0].status).toBe("pending");
  });

  it("TEST 6 — the dependency survives a process boundary, which is what 'later' means", async () => {
    /**
     * A snapshot that dropped the ledger or the objective's dependency would
     * make recovery a within-invocation nicety. The runtime restores both, so a
     * cron tick that starts after somebody raised an allowance reconsiders on
     * its FIRST pass rather than after a wasted cycle.
     */
    let held: RuntimeSnapshot | null = null;
    const store = {
      checkpoint: async (s: RuntimeSnapshot) => {
        held = JSON.parse(JSON.stringify(s)) as RuntimeSnapshot;
        return true;
      },
      restore: async () => held,
    };
    await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({
          status: "blocked",
          note: "no allowance",
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        }),
      seed: [userObjective(GOAL_LEARN, 0)],
      store,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 2 },
    });
    const persisted = held as RuntimeSnapshot | null;
    expect(persisted).not.toBeNull();
    expect(persisted!.capabilities.map((c) => c.capability)).toContain("model");
    expect(persisted!.backlog[0].blockedCapabilities).toHaveLength(1);
    expect(validateSnapshot(persisted!)).toEqual([]);

    // A SECOND invocation, sharing nothing but the snapshot, with the capability
    // back: the blocked objective runs on the first pass.
    const second = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({
          status: "success",
          settled: ["A"],
          capabilities: [cap({ availability: "available", detail: "back" })],
        }),
      store: {
        checkpoint: async () => true,
        restore: async () => ({
          ...persisted!,
          capabilities: [cap({ availability: "available", detail: "back" })],
        }),
      },
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 2 },
    });
    expect(second.restored).toBe(true);
    expect(second.episodes).toBe(1);
    expect(second.snapshot.backlog[0].status).toBe("done");
  });

  it("a snapshot carrying a capability name this build does not know is REFUSED, not migrated", () => {
    // It decides whether a blocked objective is reconsidered, so an unreadable
    // row is a behaviour change rather than a cosmetic one: an unknown
    // availability never equals "available" and the objective would wait for
    // ever with nothing saying why.
    const s: RuntimeSnapshot = {
      ...emptySnapshot(),
      capabilities: [cap({ capability: "telepathy" as Capability })],
    };
    expect(validateSnapshot(s).map((p) => p.code)).toContain("unknown_capability");
    const t: RuntimeSnapshot = {
      ...emptySnapshot(),
      capabilities: [cap({ availability: "vibes" as CapabilityState["availability"] })],
    };
    expect(validateSnapshot(t).map((p) => p.code)).toContain("unknown_availability");
  });

  it("TEST 7 — nothing is fabricated in place of the refused work", async () => {
    /**
     * REQUIREMENT 7, and it is the one that would be easiest to violate while
     * making every other test pass: a runtime that "continues" by inventing a
     * result would satisfy the letter of "not cognitively dead" and be worse
     * than stopping. A blocked episode contributes nothing to `learned` or
     * `settled`, and its objective is not marked done.
     */
    const report = await runAutonomousRuntime({
      survey: async () => ({ ok: false, reason: "no survey" }),
      runEpisode: async () =>
        outcome({
          status: "blocked",
          note: "no allowance",
          blockedReason: "model: no allowance",
          capabilities: [cap()],
        }),
      seed: [userObjective(GOAL_LEARN, 0)],
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 4 },
    });
    expect(report.learned).toEqual([]);
    expect(report.settled).toEqual([]);
    expect(report.snapshot.backlog.every((o) => o.status !== "done")).toBe(true);
  });

  it("TEST 8 — success alone does not reawaken a capability-blocked objective", () => {
    /**
     * `reawaken` fires when a FOLLOW-UP completes — a thing ONIQ did. A resource
     * block has no follow-up, so if the two were one mechanism a capability
     * blocker would clear on unrelated progress and the objective would retry
     * into the same refusal. They are separate functions with separate
     * triggers, and this is the assertion that keeps them separate.
     */
    const waiting = [blockedByModel()];
    // No child completed and the ledger is empty: nothing moves.
    expect(reconsider(waiting, new Map())[0].status).toBe("blocked");
  });
});

/* ================================================================ *
 * THE GUARD — the controls were replaced, not deleted.
 * ================================================================ */

describe("v1.6 — the resource controls are intact", () => {
  const LOOP = "src/oqca/loop/cognitiveLoop.ts";
  const SEAMS = "src/oqca/loop/seams.ts";

  it("no capability refusal terminates the run by jumping out of the station walk", () => {
    /**
     * THE EXACT CODE PATH THIS VERSION REMOVED. Four sites used to `break outer`
     * on a capability bound — RESEARCH, EVALUATE and ACT twice — and one more
     * set a run-level flag that CHECK_GOAL turned terminal. A grep is the guard
     * because the fault is structural: each of those refusals still exists and
     * still refuses; what may not come back is the jump.
     *
     * Comments stripped, because the comments beside those sites explain the
     * jump they no longer make and would match the ban that names it — the
     * prose-match this repository has now hit a dozen times.
     */
    const text = stripComments(readFileSync(LOOP, "utf8"));
    const jumps = [...text.matchAll(/break outer;/g)].length;
    // The survivors are the legitimate ones: a caller-requested pause, a RUN
    // bound, the recovery ladder's own terminal decision, and RESPOND on a
    // terminal state. A fifth means a capability learned to end a run again.
    expect(jumps).toBe(4);
    // And the run-level starvation flag is gone by name.
    expect(text).not.toMatch(/starvedBy/);
    expect(text).not.toMatch(/budget_exhausted/);
  });

  it("every gate still refuses BEFORE the call it guards — nothing was relaxed", () => {
    // v1.6 changed what a refusal MEANS, never whether one happens. The three
    // bound checkers are untouched and still exported from the seam.
    const seams = stripComments(readFileSync(SEAMS, "utf8"));
    expect(seams).toMatch(/export function breach\b/);
    expect(seams).toMatch(/export function wouldBreach\b/);
    expect(seams).toMatch(/export function breachRun\b/);
    // And the shipped defaults still ship at zero: v1.6 must not have quietly
    // bought itself a budget to make the tests pass (requirements 8 and 9).
    expect(DEFAULT_BUDGETS.maxTokens).toBe(0);
    expect(DEFAULT_BUDGETS.maxCostUsd).toBe(0);
    expect(DEFAULT_BUDGETS.maxToolCalls).toBe(0);
    // Time is a runaway guard, not a spend: a zero there fails DEAD, not closed.
    expect(DEFAULT_BUDGETS.maxExecutionTimeMs).toBeGreaterThan(0);
  });

  it("the episode hands the runtime the WHOLE ledger, not just its refusals", () => {
    /**
     * A STRUCTURAL GUARD, AND THE LIMIT IS STATED RATHER THAN GLOSSED. Filtering
     * `run.capabilities` down to `unavailable(...)` in `makeLoopEpisode` leaves
     * every refusal row byte-identical, so no assertion over a run's OUTPUT can
     * see it — and yet it makes requirement 8 unreachable, because a capability
     * that came back is never observed working. A behavioural test is not
     * available today: with the shipped seams no capability is ever `available`
     * inside `makeLoopEpisode` (there is no engine, no router and no research
     * adapter), so both versions produce the same list. The day one of those
     * seams is wired, this can become behavioural — and until then a source read
     * bound to the assignment is the honest guard.
     */
    const text = stripComments(
      readFileSync("supabase/functions/_shared/oqcaRuntime/autonomous.ts", "utf8"),
    );
    expect(text).toMatch(/const capabilities = run\.capabilities;/);
    // `unavailable(...)` is still used — for the NOTE and the reason, which is
    // where a refusal belongs. What it may not do is stand in for the ledger.
    expect(text).not.toMatch(/const capabilities = unavailable\(/);
  });

  it("the capability vocabulary is not a place to put a permission bypass", () => {
    // `capability.ts` decides what a refusal is CALLED. It must never decide
    // whether something is permitted, so it reaches no seam that could.
    const text = stripComments(readFileSync("src/oqca/loop/capability.ts", "utf8"));
    expect(text).not.toMatch(/\bfetch\b/);
    /**
     * NARROWED FOR A GENUINE COLLISION, AND THE NARROWING IS PROVEN HERE. A
     * bare `/authorize/` matches the SUBSTRING inside `unauthorized`, which is
     * this module's own vocabulary — so the first version of this guard flagged
     * the file for containing the word it exists to define. That is the
     * `health-scan` collision, not the prose match: stripping comments cannot
     * help when the identifier itself collides. The ban is on the CALL now, and
     * both directions are asserted in the same commit so this is a narrowing
     * rather than a weaker guard.
     */
    const CALLS_AUTHORIZE = /\bauthorize\s*\(/;
    expect(text).not.toMatch(CALLS_AUTHORIZE);
    expect("const a = unauthorized;").not.toMatch(CALLS_AUTHORIZE);
    expect("if (await authorize(req)) {}").toMatch(CALLS_AUTHORIZE);
    expect("router.authorize (step)").toMatch(CALLS_AUTHORIZE);
    // And it imports nothing but the two type-only vocabularies it maps.
    const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../recovery/failure.ts", "./seams.ts"]);
  });
});
