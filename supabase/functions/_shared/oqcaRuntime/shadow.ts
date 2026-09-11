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
import { makeRun } from "../oqca/loop/cognitiveRun.ts";
import { sealLoopState, EMPTY_WORLD, type LoopState } from "../oqca/loop/loopState.ts";
import { DEFAULT_BUDGETS, NO_SPEND, type Budgets, type MemoryRecord } from "../oqca/loop/seams.ts";
import { makeEngine, type EngineContext, type ModelCallRecord } from "./engine.ts";
import { makeToolRouter, type RouterMode, type ToolCallRecord } from "./toolRouter.ts";
import { type ServiceRpc } from "../financialLedger.ts";
import { makeMemory } from "./memory.ts";
import { recordingKnowledge } from "./knowledge.ts";
import { openGaps } from "../oqca/knowledge/gaps.ts";
import { QUANTUM_DOMAIN } from "../oqca/quantum/knowledge.ts";
import {
  ENFORCED_BACKOFF_BELIEF,
  buildSubstrate,
  substrateGap,
  type SubstrateBuild,
} from "./substrate.ts";
import { makeResearch } from "./research.ts";
import { makeMemoryPersistence } from "./persistence.ts";
import { buildEpisode, NOT_CHECKED, type Episode, type VerificationResult } from "./episode.ts";
import {
  DISPATCH_BACKOFF_MS,
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
  /** Why no decision was reported, when none was. Null when one was. */
  readonly undecidedReason: string | null;
  readonly failure: string | null;
  /** Section 12: how many episodes the adapter DURABLY stored. Currently 0. */
  readonly persistedEpisodes: number;
  /** v1.3 section 19: how many states the persistence adapter actually stored. */
  readonly persistedStates: number;
  /** v1.3 section 5: how many knowledge lookups the run made. */
  readonly knowledgeLookups: number;
  /**
   * v1.3 section 12: how many times research was ASKED FOR and REFUSED. A
   * non-zero value here is the honest shape of "ONIQ cannot research yet" —
   * it is not the same as never having wanted to.
   */
  readonly researchRefusals: number;
  /** Section 19: how many states the run produced, all of them replayable. */
  readonly stateTransitions: number;

  /* -------- v1.4-R: what the run actually KNEW, measured per tick -------- */
  /** Records in the tick's store, of which VERIFIED. */
  readonly knowledgeRecords: number;
  readonly knowledgeVerified: number;
  /** How many retrieved facts came from the QUANTUM domain — item C's chain. */
  readonly quantumFactsUsed: number;
  /**
   * `detectGaps` over the goal's required concepts. Before v1.4-R the station
   * was refused `no_knowledge_state` on every run, so these two were not
   * merely zero — they did not exist.
   */
  readonly knowledgeGapsOpen: number;
  readonly knowledgeGapsTotal: number;
  /** Milliseconds to ingest and project. Reported so a regression is visible. */
  readonly substrateBuildMs: number;
  /**
   * WHAT THE LOOP BELIEVED THE BACKOFF WAS, beside what the code enforces. When
   * these differ, a disagreement with production is a KNOWLEDGE difference and
   * not a reasoning one — and the row says which without anyone guessing.
   */
  readonly believedBackoffMs: number;
  readonly enforcedBackoffMs: number;
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
  /**
   * The service-role RPC the spend ledger admits and settles through, handed to
   * BOTH the engine and the tool router so one run has one financial boundary.
   * Absent means every model call and every paying tool is REFUSED — not run
   * unguarded — which is what a test with no ledger should get.
   */
  readonly rpc?: ServiceRpc | null;
  readonly seedMemory?: readonly MemoryRecord[];
  /**
   * v1.4-R item D. What ONIQ BELIEVES the dispatch backoff to be, normally read
   * from the knowledge substrate the tick just built. Supplied here so a
   * knowledge upgrade can be driven from outside and the loop's decision
   * observed changing — the belief reaches `worldFrom` and `likelihoodsFrom`
   * and reaches NO authorization site.
   */
  readonly believedBackoffMs?: number;
  /** Overrides the tick's substrate. Item D hands in K0, then K1. */
  readonly substrate?: SubstrateBuild;
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
  /** What ONIQ believes the backoff is. See `dispatchJob.ts:isDispatchable`. */
  backoffMs?: number,
): LoopState {
  const world = worldFrom(queue, nowMs, backoffMs);
  const basis = basisFrom(world);
  return sealLoopState({
    parentStateId: null,
    goal: DISPATCH_GOAL,
    percepts: [],
    failures: [],
    activeHypotheses: basis,
    worldState: world,
    evidenceIds: [],
    knowledgeGaps: [],
    candidatePlans: [],
    selectedPlan: null,
    futures: [],
    predictions: [],
    outcomes: [],
    verification: null,
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

/**
 * WHAT THE LOOP BELIEVES THE BACKOFF IS, read from the store rather than from
 * the constant.
 *
 * An explicit override wins — that is how item D drives K0 and K1 in. Failing
 * that, the `dispatch-backoff windowMs` record is consulted, and it must be
 * VERIFIED and a finite non-negative number to be believed: a CANDIDATE record
 * has not passed the promotion policy and a malformed object is not a duration.
 * Anything else falls back to the enforced constant, which is the safe answer
 * and never a guess.
 */
export function believedBackoff(substrate: SubstrateBuild, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  const rec = substrate.store
    .bySubject("dispatch-backoff")
    .find((r) => r.predicate === "windowMs" && r.status === "VERIFIED");
  const v = rec?.object;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DISPATCH_BACKOFF_MS;
}

export async function runShadow(opts: ShadowOptions): Promise<ShadowResult> {
  // EVERY COLLECTOR IS LOCAL. Section 18: no module-level mutable run state.
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const memoryNotes: { attempted: number; persisted: number; reason: string }[] = [];
  const knowledgeNotes: { query: string; returned: number; gap: string }[] = [];
  const researchNotes: { question: string; reason: string }[] = [];
  const persistenceNotes: { stateId: string; persisted: boolean; gap: string }[] = [];

  const budgets = opts.budgets ?? DEFAULT_BUDGETS;
  const env = opts.env;
  const startedAt = env.nowMs();
  const queue = await env.readQueue();
  const nowMs = env.nowMs();

  /* -------------------------------------------------------------------- *
   * v1.4-R ITEMS B AND C — THE TICK'S KNOWLEDGE, BUILT BEFORE ANYTHING ELSE.
   *
   * `buildSubstrate` ingests the quantum domain and the dispatch rules through
   * `evaluatePromotion` and projects the VERIFIED ones into the working graph.
   * It reaches no network, holds no credential and calls no model: every record
   * is derived from a checked-in module or computed by a two-qubit circuit that
   * runs here. A tick costs milliseconds of CPU and $0.
   *
   * THE BELIEVED BACKOFF COMES OUT OF THE STORE, not out of the constant. What
   * the code ENFORCES is `DISPATCH_BACKOFF_MS` and always will be; what the
   * loop REASONS with is whatever `dispatch-backoff windowMs` currently says,
   * which is a record that can be superseded. Normally they agree, because the
   * record is re-derived from the constant on every tick — and the machinery
   * that makes them able to disagree is what makes a knowledge upgrade
   * observable end to end.
   * -------------------------------------------------------------------- */
  const substrate =
    opts.substrate ??
    buildSubstrate({
      at: new Date(nowMs).toISOString(),
      nowMs,
      belief:
        opts.believedBackoffMs === undefined
          ? undefined
          : { ...ENFORCED_BACKOFF_BELIEF, windowMs: opts.believedBackoffMs },
      elapsedMs: () => env.nowMs() - startedAt,
    });
  const believedBackoffMs = believedBackoff(substrate, opts.believedBackoffMs);

  const production = productionChoice(queue, nowMs);
  const world = worldFrom(queue, nowMs, believedBackoffMs);
  const basis = basisFrom(world);
  const quantum = quantumFor(basis);
  const state = initialState(queue, nowMs, budgets, believedBackoffMs);

  // The loop's own state id is read at call time, so a model-call record names
  // the state the call was made FROM rather than the state it produced.
  let currentStateId = state.stateId;
  const engine = makeEngine({
    runId: opts.runId,
    stateId: () => currentStateId,
    now: () => env.nowMs(),
    record: (r) => modelCalls.push(r),
    call: opts.call,
    rpc: opts.rpc ?? null,
    /**
     * NO JOB ID, AND THAT IS MEASURED RATHER THAN AN OMISSION.
     *
     * `admit_provider_spend` increments `provider_spend_job.attempts` on EVERY
     * admission under a job id and refuses at `max_attempts_per_job`, which the
     * table's own CHECK caps at 10. One cognitive run makes up to twenty model
     * calls — five stations over four iterations — so binding them to one job
     * would refuse call eleven with `job-attempts-exhausted`, and the loop would
     * report it as a model that had nothing to say.
     *
     * The ceiling is not the wrong SIZE, it is the wrong SHAPE: a job ceiling
     * bounds a RETRY LADDER — one film regenerating one shot — and a cognitive
     * run is twenty distinct questions, not twenty attempts at one. What bounds
     * a single run is `Budgets.maxCostUsd`, and what bounds the total is the
     * ledger's DAILY cap.
     */
  });
  const router = makeToolRouter(dispatchTools(queue, env), {
    runId: opts.runId,
    mode: opts.mode,
    now: () => env.nowMs(),
    record: (r) => toolCalls.push(r),
    rpc: opts.rpc ?? null,
  });
  const memory = makeMemory(opts.seedMemory ?? [], { record: (n) => memoryNotes.push(n) });
  /* -------------------------------------------------------------------- *
   * v1.3'S THREE NEW ADAPTERS, and two of them refuse.
   *
   * knowledge  REAL: the dispatch rules as written in code, each carrying the
   *            module it came from. Nothing generated, nothing summarised.
   * research   REFUSES, and says why. ONIQ's only search-capable path is paid
   *            and user-facing, so pointing a scheduled tick at it is a spend
   *            decision the owner has not made.
   * persist    REAL for the life of the process; durable storage needs a table
   *            and a migration, which a shadow run may not make.
   * -------------------------------------------------------------------- */
  const knowledge = recordingKnowledge(substrate.knowledge, {
    record: (n) => knowledgeNotes.push(n),
    gap: substrateGap(),
  });
  const research = makeResearch({ record: (n) => researchNotes.push(n) });
  const persistence = makeMemoryPersistence({ record: (n) => persistenceNotes.push(n) });

  const run = await runCognitiveLoop({
    initial: state,
    quantum,
    // v1.4-R ITEM B: THE STATION THAT WAS REFUSED ON EVERY RUN.
    //
    // `IDENTIFY_GAPS` reads `input.knowledge`, and nothing ever supplied one —
    // so it noted `no_knowledge_state` and returned, on every tick since it was
    // written. `project.ts` advertised this projection as one of the
    // substrate's "exactly two exits", and `toKnowledgeState` had no caller
    // anywhere in the repository, not even a test. This line is the caller.
    knowledge: substrate.state,
    percepts: [perceptsFrom(queue, nowMs)],
    // SECTION 11 — the likelihoods are computed from the same rows the world
    // was built from, and `likelihoodsFrom` throws rather than padding if a
    // basis element has no row. Nothing here is invented and nothing defaulted.
    //
    // ONE ENTRY PER ITERATION, and supplying only the first was a real defect
    // measured on the first complete run: `IterationEvidence` is indexed by
    // iteration, REPRESENT rebuilds the amplitude state at the top of each one,
    // and so evidence folded on iteration 0 was DISCARDED on iteration 1. Four
    // iterations later the final measurement reflected no evidence at all —
    // three actions tied at exactly 1/3 — while every station reported success
    // and nothing was refused.
    //
    // The same snapshot for every iteration is the honest value here: the queue
    // is read ONCE per run, so the evidence genuinely has not changed. A run
    // that re-read the queue per iteration would supply a different entry each
    // time, which is exactly what the per-iteration shape is for.
    evidence: Array.from({ length: budgets.maxIterations }, () => ({
      likelihoodsByHypothesis: likelihoodsFrom(basis, queue, nowMs, believedBackoffMs),
      evidenceIds: ["queue-snapshot"],
    })),
    budgets,
    engine,
    router,
    clock: () => env.nowMs() - startedAt,
    memory,
    // Section 14: the job's own verifier, called BY station 11.
    verifier: makeVerifier(env),
    run: makeRun({
      runId: opts.runId,
      // SHADOW OR ASSISTED, NEVER `controlled_autonomy`. The router's mode is
      // a two-value type and `parseMode` cannot produce the third, so the
      // unattended mode is unreachable from configuration — which is where the
      // recovery brief's closing sentence puts it until a person says
      // otherwise.
      mode: opts.mode,
      model: engine,
      tools: router,
      memory,
      knowledge,
      research,
      persistence,
      verifier: makeVerifier(env),
      budgets,
      clock: () => env.nowMs() - startedAt,
    }),
  });
  currentStateId = run.state.stateId;

  // A DECISION THE LOOP DID NOT MAKE IS NULL, NOT THE HOLD. `confidence().top`
  // always names something once a basis exists, so "did it actually decide" is
  // a separate question: the margin must be non-trivial and the run must not
  // have been stopped by a bound before UPDATE_STATE folded the evidence in.
  const foldedEvidence = run.log.some((r) => r.station === "UPDATE_STATE" && r.refused === null);

  // THE DECISION IS RANKED OVER THE ACTIONS ONLY, and the first complete run is
  // what showed why. SUPERPOSE admits one hypothesis per `goal.requires`, so by
  // MEASURE the basis held three ACTIONS and three PREREQUISITES — and
  // `confidence()` ranked all six together. That asks "which of these six is
  // most likely" where three are things to do and three are things the goal
  // needs, which is a category error: the prerequisites carry a neutral 1 and
  // therefore sit at the top, tied with each other, forever.
  //
  // The wider basis is CORRECT — the loop genuinely reasons about both — so the
  // fix belongs here, in the caller that knows which labels are actions. The
  // loop is not narrowed; the question asked of it is.
  const probs = run.quantum.probabilities();
  const ranked = run.quantum.basis
    .map((label, i) => ({ label, p: probs[i] }))
    .filter((x) => basis.includes(x.label))
    .sort((a, b) => b.p - a.p);
  const total = ranked.reduce((sum, x) => sum + x.p, 0);
  const oqcaConfidence = total > 0 && ranked.length > 0 ? ranked[0].p / total : 0;
  const oqcaMargin =
    total > 0 && ranked.length > 1 ? (ranked[0].p - ranked[1].p) / total : oqcaConfidence;

  // A TIE IS NOT A DECISION — v1.1's sharpest finding, applied. `top` always
  // names something once a basis exists, and on a dead tie it names whichever
  // label sits first, so a decision reported at margin 0 is a fact about basis
  // ORDER rather than about the evidence.
  const oqcaDecision = foldedEvidence && oqcaMargin > 0 ? (ranked[0]?.label ?? null) : null;
  const undecidedReason = !foldedEvidence
    ? "no evidence was folded"
    : oqcaMargin > 0
      ? null
      : `tie at the top of the action ranking (margin ${oqcaMargin.toFixed(6)})`;

  // SECTION 14: THE VERDICT COMES FROM THE LOOP'S OWN STATION, not from a
  // second check run beside it. The first draft called the verifier AFTER
  // `runCognitiveLoop` returned, which meant station 11 was still asking a
  // model to label its own claims while the real check happened somewhere the
  // loop could not see — so REFLECT, the episode and CHECK_GOAL all reasoned
  // from a verdict that was not theirs.
  const verification: VerificationResult = run.state.verification ?? NOT_CHECKED;
  // A run whose VERIFY station could not read the environment is a run whose
  // verdict means nothing, and that is worth surfacing rather than burying in
  // a detail string a comparison row never shows.
  const failure: string | null =
    verification.verdict === "unverified" && /could not be read/.test(verification.detail)
      ? verification.detail
      : null;

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

  // SECTION 12: THE EPISODE CROSSES THE ADAPTER, and the adapter says honestly
  // that it stored nothing. Building an episode and returning it would have
  // left the seam untested and the gap invisible; sending it through is what
  // makes `persistedEpisodes: 0` a MEASUREMENT rather than a note in a file.
  const persistedEpisodes = await memory.consolidate([
    {
      id: `episode:${opts.runId}`,
      layer: "episodic",
      text:
        `${episode.goal} -> ${episode.responseClass} (${episode.verdict}): ` +
        episode.lessons.join("; "),
      // The run's own verdict is what this record is worth, and an unverified
      // run is not a confident memory. A fixed 1 would make every episode
      // equally trustworthy, including the ones nothing checked.
      confidence:
        episode.verdict === "verified" ? 1 : episode.verdict === "partially_verified" ? 0.5 : 0,
    },
  ]);

  // Which record ids belong to the quantum domain. Read from the STORE's own
  // domain tags rather than from a prefix on the id: an id is a hash and says
  // nothing about where a record came from.
  const quantumIds = new Set(substrate.store.byDomain(QUANTUM_DOMAIN).map((r) => r.id));

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
      oqcaConfidence,
      oqcaMargin,
      agreed: oqcaDecision === null ? null : oqcaJob === production,
      latencyMs: finishedAt - startedAt,
      modelCalls: modelCalls.length,
      modelCallsRefused: modelCalls.filter((c) => !c.ok).length,
      toolAttempts: toolCalls.filter((c) => c.attempted).length,
      toolsRefused: toolCalls.filter((c) => !c.attempted).length,
      estimatedCostUsd: episode.estimatedCostUsd,
      costUsd: run.spent.costUsd,
      terminated: run.terminated,
      undecidedReason,
      failure,
      persistedEpisodes,
      // The adapter's own count, not `chain.length` — see `flushChain`.
      persistedStates: run.persistedStates,
      knowledgeLookups: knowledgeNotes.length,
      researchRefusals: researchNotes.length,
      stateTransitions: run.chain.length,
      knowledgeRecords: substrate.store.all().length,
      knowledgeVerified: substrate.store.byStatus("VERIFIED").length,
      // ITEM C's MEASUREMENT. Counted from the percepts the loop actually took
      // in, not from what the store holds: a fact the store carries and nobody
      // retrieved has not reached the decision, which is the whole distinction
      // this repo's chunk-grep lesson is about.
      quantumFactsUsed: run.state.percepts.filter(
        (pc) => pc.id.startsWith("knowledge-") && quantumIds.has(pc.id.slice("knowledge-".length)),
      ).length,
      knowledgeGapsOpen: openGaps(run.state.knowledgeGaps).length,
      knowledgeGapsTotal: run.state.knowledgeGaps.length,
      substrateBuildMs: substrate.buildMs,
      believedBackoffMs,
      enforcedBackoffMs: DISPATCH_BACKOFF_MS,
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
