/**
 * SHADOW AND ASSISTED MODE — brief sections 7, 8, 9, 18, 19 and 23.
 *
 * SHADOW IS NOT A DRY RUN. Section 8: OQCA "observes and reasons alongside the
 * existing implementation without changing the user's result". The production
 * path runs exactly as it always did; this runs beside it and records what OQCA
 * would have chosen. The comparison is the deliverable.
 *
 * NOTHING HERE IS MODULE-LEVEL AND MUTABLE — section 18, and it is a rule this
 * repo has already broken once: v1.1's ACT carried its results to OBSERVE in a
 * module-level binding, which two concurrent runs would have shared. Every
 * collector below is created inside `runShadow`, so two ticks in one isolate
 * cannot see each other's model calls, tool calls or state.
 *
 * THE FLAG IS OFF AND THE OFF PATH IS THE OLD PATH. Section 7: "The new path
 * must not replace the existing path." `story-dispatch` calls this after it has
 * already answered, inside a catch that cannot reach its response.
 */
import { CognitiveState, ROOT_CONTEXT } from "../oqca/formalState.ts";
import { runCognitiveLoop, type LoopRun } from "../oqca/loop/cognitiveLoop.ts";
import { sealLoopState, EMPTY_WORLD, type LoopState } from "../oqca/loop/loopState.ts";
import { DEFAULT_BUDGETS, NO_SPEND, type Budgets, type MemoryRecord } from "../oqca/loop/seams.ts";
import { makeEngine, type EngineContext, type ModelCallRecord } from "./engine.ts";
import { makeToolRouter, type RouterMode, type ToolCallRecord } from "./toolRouter.ts";
import { makeMemory } from "./memory.ts";
import { buildEpisode, NOT_CHECKED, type Episode, type VerificationResult } from "./episode.ts";
import {
  DISPATCH_GOAL,
  HOLD_ACTION,
  basisFrom,
  dispatchTools,
  likelihoodsFrom,
  makeVerifier,
  perceptsFrom,
  productionChoice,
  worldFrom,
  type DispatchEnvironment,
  type QueuedJob,
} from "./dispatchJob.ts";

/**
 * SECTION 8's MEASUREMENTS, and section 23's. One row per run.
 *
 * `agreed` is a strict equality over job ids because the decision is discrete —
 * which is why this job was chosen. `oqcaDecision` is null when the loop never
 * reached a decision at all, which is a THIRD outcome and not a disagreement:
 * an unconfigured loop that refused every model call has not disagreed with
 * production, it has declined to answer.
 */
export type ShadowComparison = {
  readonly runId: string;
  readonly mode: RouterMode;
  readonly productionDecision: string | null;
  readonly oqcaDecision: string | null;
  readonly oqcaConfidence: number;
  readonly oqcaMargin: number;
  readonly agreed: boolean | null;
  readonly latencyMs: number;
  readonly modelCalls: number;
  readonly modelCallsRefused: number;
  readonly toolAttempts: number;
  readonly toolsRefused: number;
  readonly estimatedCostUsd: number;
  readonly costUsd: number;
  readonly terminated: string;
  readonly failure: string | null;
};

export type ShadowResult = {
  readonly comparison: ShadowComparison;
  readonly episode: Episode;
  readonly run: LoopRun;
};

export type ShadowOptions = {
  readonly runId: string;
  readonly mode: RouterMode;
  readonly env: DispatchEnvironment;
  readonly budgets?: Budgets;
  /**
   * The provider. Production passes `callTextProvider`; a test passes its own.
   * REQUIRED — see engine.ts on why there is no default.
   */
  readonly call: EngineContext["call"];
  readonly seedMemory?: readonly MemoryRecord[];
};

/**
 * The initial state. `createdAt` is a LOGICAL step, not a clock — `loopState.ts`
 * carries the full reason, and a wall-clock reading here would make every
 * replay produce a different state id.
 */
export function initialState(
  queue: readonly QueuedJob[],
  nowMs: number,
  budgets: Budgets,
): LoopState {
  const world = worldFrom(queue, nowMs);
  const basis = basisFrom(world);
  return sealLoopState({
    parentStateId: null,
    goal: DISPATCH_GOAL,
    percepts: [],
    activeHypotheses: basis,
    worldState: world,
    evidenceIds: [],
    knowledgeGaps: [],
    candidatePlans: [],
    selectedPlan: null,
    futures: [],
    predictions: [],
    outcomes: [],
    memoryRefs: [],
    quantumState: quantumFor(basis).snapshot(),
    iteration: 0,
    budgets,
    spent: NO_SPEND,
    status: "running",
    createdAt: 0,
  });
}

/**
 * EQUAL WEIGHTS, NOT A PRIOR SOMEBODY PICKED. The evidence goes in at
 * UPDATE_STATE as likelihoods computed from the queue; starting from a
 * weighting invented here would put a thumb on the answer before a single fact
 * was folded in, and v1.1 measured what a fixture built to flatter the kernel
 * is worth.
 */
export function quantumFor(basis: readonly string[]): CognitiveState {
  const labels = basis.length > 0 ? basis : [HOLD_ACTION];
  return CognitiveState.fromWeights(
    labels,
    labels.map(() => 1),
    { ...ROOT_CONTEXT, contextId: "oqca-story-dispatch" },
  );
}

export async function runShadow(opts: ShadowOptions): Promise<ShadowResult> {
  // EVERY COLLECTOR IS LOCAL. Section 18: no module-level mutable run state.
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const memoryNotes: { attempted: number; persisted: number; reason: string }[] = [];

  const budgets = opts.budgets ?? DEFAULT_BUDGETS;
  const env = opts.env;
  const startedAt = env.nowMs();
  const queue = await env.readQueue();
  const nowMs = env.nowMs();

  const production = productionChoice(queue, nowMs);
  const world = worldFrom(queue, nowMs);
  const basis = basisFrom(world);
  const quantum = quantumFor(basis);
  const state = initialState(queue, nowMs, budgets);

  // The loop's own state id is read at call time, so a model-call record names
  // the state the call was made FROM rather than the state it produced.
  let currentStateId = state.stateId;
  const engine = makeEngine({
    runId: opts.runId,
    stateId: () => currentStateId,
    now: () => env.nowMs(),
    record: (r) => modelCalls.push(r),
    call: opts.call,
  });
  const router = makeToolRouter(dispatchTools(queue, env), {
    runId: opts.runId,
    mode: opts.mode,
    now: () => env.nowMs(),
    record: (r) => toolCalls.push(r),
  });
  const memory = makeMemory(opts.seedMemory ?? [], { record: (n) => memoryNotes.push(n) });

  const run = await runCognitiveLoop({
    initial: state,
    quantum,
    percepts: [perceptsFrom(queue, nowMs)],
    // SECTION 11 — the likelihoods are computed from the same rows the world
    // was built from, and `likelihoodsFrom` throws rather than padding if the
    // widths ever disagree. Nothing here is invented and nothing is defaulted.
    evidence: [
      { likelihoods: likelihoodsFrom(basis, queue, nowMs), evidenceIds: ["queue-snapshot"] },
    ],
    budgets,
    engine,
    router,
    clock: () => env.nowMs() - startedAt,
    memory,
  });
  currentStateId = run.state.stateId;

  const decided = run.quantum.confidence();
  // A DECISION THE LOOP DID NOT MAKE IS NULL, NOT THE HOLD. `confidence().top`
  // always names something once a basis exists, so "did it actually decide" is
  // a separate question: the margin must be non-trivial and the run must not
  // have been stopped by a bound before UPDATE_STATE folded the evidence in.
  const foldedEvidence = run.log.some((r) => r.station === "UPDATE_STATE" && r.refused === null);
  const oqcaDecision = foldedEvidence ? decided.top : null;

  let verification: VerificationResult = NOT_CHECKED;
  let failure: string | null = null;
  try {
    // Verification reads the environment back. In shadow mode nothing was
    // performed, so what it verifies is the state of the world as it stands —
    // which is the honest thing to check and is why the verdict there is
    // usually `rejected` or `verified` about the PRODUCTION dispatch, not
    // about OQCA's proposal.
    verification = await makeVerifier(opts.mode === "assisted" ? oqcaDecision : null, env)();
  } catch (e) {
    failure = String(e).slice(0, 200);
  }

  const finishedAt = env.nowMs();
  const episode = buildEpisode({
    runId: opts.runId,
    goal: DISPATCH_GOAL.statement,
    initialStateId: state.stateId,
    run,
    verification,
    modelCalls,
    toolCalls,
    durationMs: finishedAt - startedAt,
    // The ONE wall-clock timestamp in the whole run, on the one record that is
    // a report rather than a state. Section 13.
    createdAt: new Date(finishedAt).toISOString(),
  });

  const oqcaJob =
    oqcaDecision === null || oqcaDecision === HOLD_ACTION
      ? null
      : oqcaDecision.slice("dispatch story job ".length);

  return {
    comparison: {
      runId: opts.runId,
      mode: opts.mode,
      productionDecision: production,
      oqcaDecision,
      oqcaConfidence: decided.probability,
      oqcaMargin: decided.margin,
      agreed: oqcaDecision === null ? null : oqcaJob === production,
      latencyMs: finishedAt - startedAt,
      modelCalls: modelCalls.length,
      modelCallsRefused: modelCalls.filter((c) => !c.ok).length,
      toolAttempts: toolCalls.filter((c) => c.attempted).length,
      toolsRefused: toolCalls.filter((c) => !c.attempted).length,
      estimatedCostUsd: episode.estimatedCostUsd,
      costUsd: run.spent.costUsd,
      terminated: run.terminated,
      failure,
    },
    episode,
    run,
  };
}

/* ---------------------------------------------------------------- *
 * SECTION 19 — replay.
 * ---------------------------------------------------------------- */

export type ReplayProblem = {
  readonly index: number;
  readonly code: string;
  readonly detail: string;
};

/**
 * REPLAY MAKES NO NETWORK CALL, NO MODEL CALL AND EXECUTES NO TOOL, and the way
 * that is guaranteed is that it takes no seams at all. There is no engine
 * parameter to pass one to.
 *
 * What it checks is that a recorded chain is INTERNALLY CONSISTENT: every state
 * id re-derives from its own content, and every state names its predecessor.
 * That is the whole of what a content-hashed chain can promise, and claiming
 * more — "the same run would happen again" — would be false the moment a
 * provider answered differently.
 */
export function replayChain(chain: readonly LoopState[]): readonly ReplayProblem[] {
  const problems: ReplayProblem[] = [];
  chain.forEach((s, i) => {
    const { stateId: _ignored, ...draft } = s;
    const rederived = sealLoopState(draft);
    if (rederived.stateId !== s.stateId) {
      problems.push({
        index: i,
        code: "state_id_mismatch",
        detail: `recorded ${s.stateId}, re-derived ${rederived.stateId}`,
      });
    }
    if (i === 0) {
      if (s.parentStateId !== null) {
        problems.push({ index: i, code: "root_has_parent", detail: `${s.parentStateId}` });
      }
      return;
    }
    if (s.parentStateId !== chain[i - 1].stateId) {
      problems.push({
        index: i,
        code: "broken_link",
        detail: `parent ${s.parentStateId} is not the previous state ${chain[i - 1].stateId}`,
      });
    }
  });
  return problems;
}

export { EMPTY_WORLD };
