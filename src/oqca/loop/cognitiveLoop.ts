/**
 * ONIQ AGI MEGA QUANTUM LOOP — the 23 stations. Owner brief sections 1–2, 32.
 *
 * TWO OF THE BRIEF'S STATIONS SHARE A NAME WITH A CATEGORY-C QUANTUM OPERATION
 * AND ARE NOT IT. This is the first thing to get right, because v1.1 refuses
 * `ENTANGLE` and `CORRECT` by name and the obvious reading is that stations 07
 * and 19 inherit that refusal. They do not:
 *
 *   07 RELATIONAL BINDING  "represent dependencies between concepts" — a graph
 *                          over `WorldState.relations`. Performable. It is NOT
 *                          `cognitive.entangle`, which is category C because
 *                          nothing here factors a basis into subsystems.
 *   19 CORRECT             "determine why prediction != reality and correct the
 *                          appropriate layer" — a diagnosis over the outcome
 *                          record. Performable. It is NOT quantum error
 *                          correction, which is category C because there is no
 *                          code space and no syndrome.
 *
 * Blurring those would either cripple two working stations or claim two
 * physical operations ONIQ does not have. Both names are therefore distinct
 * from the quantum ones in `cognitive.ts`, and `cognitiveLoop.test.ts` asserts
 * the loop never calls the category-C functions.
 *
 * WHAT SPENDS, AND WHERE. Six stations can reach the model and one can reach
 * the world. Every one of them is bounded BEFORE the call, never after — the
 * health gateway's rule, which exists because a receipt written after the
 * provider ran cannot refuse anything. `breach` is checked at the top of every
 * station and `wouldBreach` again immediately before each spend.
 *
 * NOTHING IN THIS FILE CAN REACH A NETWORK. The engine, the router, the clock
 * and the memory store are arguments with refusing defaults; `security.test.ts`
 * still walks this directory and still finds no fetch, no credential and no
 * clock. That is what makes "the loop may write to production" and "the kernel
 * provably cannot" both true at once.
 */
import { CognitiveState } from "../formalState.ts";
import { evidence, interfere, phase, superpose } from "../cognitive.ts";
import { detectGaps, openGaps, type Gap } from "../knowledge/gaps.ts";
import { planResearch, type ResearchPlan } from "../knowledge/planner.ts";
import type { KnowledgeState } from "../knowledge/model.ts";
import {
  type Budgets,
  type Clock,
  type Engine,
  type EngineKind,
  type MemoryStore,
  type Spent,
  type ToolResult,
  type ToolRouter,
  NO_SPEND,
  addUsage,
  type BoundBreach,
  breachRun,
  wouldBreach,
  type SpendEstimate,
  type Verifier,
  UNKNOWN_TOOL_PROPERTIES,
  type ResearchAdapter,
} from "./seams.ts";
import {
  type ImaginedFuture,
  type LoopState,
  type Outcome,
  type Percept,
  type Plan,
  type Prediction,
  advance,
  isTerminal,
  isEvidential,
  PROVENANCES,
} from "./loopState.ts";
import { type CognitiveRun, makeRun } from "./cognitiveRun.ts";
import {
  type Capability,
  type CapabilityState,
  CAPABILITY_UNAVAILABLE,
  availabilityForBound,
  availabilityForFailureClass,
  capabilityList,
  recordCapability,
  unavailable,
} from "./capability.ts";
import type { Failure, IdempotencyClass } from "../recovery/failure.ts";
import { fromBudget, fromStation, fromThrown } from "../recovery/classify.ts";
import { type RecoveryDecision, type RecoveryContext, decideRecovery } from "../recovery/decide.ts";
import { type RetryLedger, EMPTY_RETRY_LEDGER } from "../recovery/retry.ts";

/** The brief's diagram, in order. 19 is a branch and records which arm ran. */
export const STATIONS = [
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
] as const;

export type Station = (typeof STATIONS)[number];

/**
 * The termination token for "level 7 wanted a person and none is attached".
 * Exported so `classifyResponse` can list it rather than matching a string
 * literal in two files that would drift the first time either was reworded.
 */
export const ESCALATION_REQUIRED = "escalation_required";

/** The six stations permitted to call the model, and nothing else may. */
export const ENGINE_STATIONS: Readonly<Record<string, EngineKind>> = {
  UNDERSTAND: "understand",
  REASON: "reason",
  VERIFY: "verify",
  IMAGINE: "imagine",
  EVALUATE: "evaluate",
  REFLECT: "reflect",
  RESPOND: "respond",
};

export type StationRecord = {
  readonly iteration: number;
  readonly station: Station;
  readonly note: string;
  /** Non-null when the station could not do its job, naming why. */
  readonly refused: string | null;
  readonly stateId: string;
  readonly spent: Spent;
};

/**
 * The evidence and the contextual fact for ONE iteration, supplied by the
 * CALLER. Nothing in this loop derives a likelihood vector or a phase from
 * prose: v1.1 measured that `interfere(a, b, theta)` returns the opposite label
 * at the identical confidence when the pair is named the other way round, so a
 * phase invented here would be the loop asserting a fact about evidence that is
 * really a fact about its own argument order. An iteration with no entry folds
 * in no evidence and says so.
 */
export type IterationEvidence = {
  /** One likelihood per basis element, or null for an iteration with no news. */
  readonly likelihoods?: readonly number[] | null;
  /**
   * The same evidence keyed by HYPOTHESIS — the shape a caller can actually get
   * right, because SUPERPOSE may widen the basis before this station runs. Every
   * basis element must be present or the station refuses; a missing key is never
   * padded.
   */
  readonly likelihoodsByHypothesis?: Readonly<Record<string, number>>;
  /** Section 15's "update phase/context" — radians per hypothesis. */
  readonly phases?: readonly number[];
  /** [i, j, theta] — the interference that reads a phase back out. */
  readonly interfere?: readonly [number, number, number];
  readonly evidenceIds?: readonly string[];
};

export type LoopInput = {
  readonly initial: LoopState;
  readonly quantum: CognitiveState;
  readonly percepts?: readonly (readonly Percept[])[];
  readonly evidence?: readonly IterationEvidence[];
  readonly knowledge?: KnowledgeState;
  readonly budgets?: Budgets;
  readonly engine?: Engine;
  readonly router?: ToolRouter;
  readonly clock?: Clock;
  readonly memory?: MemoryStore;
  /** Section 14. Defaults to NO_VERIFIER, which answers `unverified`. */
  readonly verifier?: Verifier;
  /**
   * v1.7 §9. Defaults to `NO_RESEARCH`, which REFUSES rather than answering
   * "no findings".
   *
   * IT IS HERE SO THE RUN CANNOT CONTRADICT ITS OWN CALLER. Before this, an
   * episode that had a retrieval capability and used it still handed the loop a
   * refusing adapter, so one run reported research as BOTH available (from the
   * episode) and unavailable (from station 10) — and `unavailable()` reads the
   * refusal, so the episode's own successful retrieval was invisible and every
   * experiment came back BLOCKED. Measured on the first live four-process run,
   * not reasoned: three records were retrieved, verified and persisted while
   * the verdict said nothing had been intervened.
   */
  readonly research?: ResearchAdapter;
  /**
   * v1.3 SECTION 2. When supplied, this IS the run — every seam is read from
   * it and the individual fields above are ignored. When absent, one is
   * assembled from them, so there is still exactly one run object internally
   * and no call site had to change.
   */
  readonly run?: CognitiveRun;
  /** Pause after N stations, for a resumable run. */
  readonly stopAfterStations?: number;
};

export type LoopRun = {
  readonly state: LoopState;
  readonly quantum: CognitiveState;
  readonly log: readonly StationRecord[];
  /**
   * EVERY STATE THE RUN PRODUCED, oldest first — section 19's "persist event/
   * state sequence -> restore -> replay". `state` is only the last one, and a
   * chain that cannot be persisted cannot be replayed; `replayChain` re-derives
   * every id from its own content and checks each link.
   */
  readonly chain: readonly LoopState[];
  readonly research: ResearchPlan | null;
  readonly gaps: readonly Gap[];
  readonly answer: string | null;
  readonly spent: Spent;
  /**
   * v1.3 SECTION 19: how many of `chain` the persistence adapter DURABLY
   * stored. A count rather than a boolean, and read from the adapter's own
   * answer rather than from `chain.length`, so an adapter that stores nothing
   * reports 0 and cannot be mistaken for one that works.
   */
  readonly persistedStates: number;
  /** Why it stopped. "completed" only when CHECK_GOAL said so. */
  readonly terminated: string;
  /**
   * v1.6 — WHAT COULD AND COULD NOT EXECUTE, one row per capability.
   *
   * This is the resource accounting the 2026-09-10 directive requires to stay
   * observable: `spent` says what was used, and this says what was refused and
   * in which of the directive's own terms. It is NOT on the hashed `LoopState`
   * deliberately — a capability state is an observation about the world at a
   * moment, and the chain exists to replay COGNITION. `spent` is hashed, the
   * station log carries each refusal at its own station, and the runtime
   * persists this ledger in its checkpoint, so the trail is complete without
   * making every state id depend on whether a provider was up.
   */
  readonly capabilities: readonly CapabilityState[];
};

/**
 * The engine's reply is TEXT and this loop never pretends otherwise. A station
 * that needs structure asks for one line and takes the first; a station that
 * needs prose keeps the prose. Nothing here parses JSON out of a model reply
 * and treats a parse failure as an empty answer — that is how a refusal becomes
 * a fact with no evidence behind it.
 */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  );
}

export async function runCognitiveLoop(input: LoopInput): Promise<LoopRun> {
  /**
   * v1.3 SECTION 2: "One `CognitiveRun` object per run... No module-level
   * mutable execution state." Assembled here when the caller did not supply
   * one, so the seams are read from exactly one place whichever way the loop
   * was called — and every default inside `makeRun` refuses rather than
   * approximating.
   */
  const run: CognitiveRun =
    input.run ??
    makeRun({
      runId: input.initial.stateId,
      model: input.engine,
      memory: input.memory,
      tools: input.router,
      verifier: input.verifier,
      research: input.research,
      clock: input.clock,
      budgets: input.budgets,
    });
  const budgets = run.budgets;
  const engine = run.model;
  const router = run.tools;
  const clock = run.clock;
  const memory = run.memory;
  const verifier = run.verifier;

  let state = input.initial;
  const chain: LoopState[] = [state];
  let quantum = input.quantum;
  let spent: Spent = { ...NO_SPEND };
  let gaps: Gap[] = [];
  let research: ResearchPlan | null = null;
  let answer: string | null = null;
  let terminated = "completed";
  let stationsRun = 0;
  const log: StationRecord[] = [];
  // Carried from ACT to OBSERVE within one iteration and never hashed: the
  // environment's answer is not part of the committed record until OBSERVE
  // has judged it against the prediction. LOCAL, not module-level — a
  // module-level binding would be shared by two concurrent runs, which is a
  // cross-run data leak that no test with one run could ever see.
  let lastResults: { step: string; result: ToolResult }[] = [];
  /**
   * v1.6 — THE CAPABILITY LEDGER, AND IT REPLACES A RUN-LEVEL STARVATION FLAG.
   *
   * What stood here was `starvedBy: BoundBreach | null`. Any refused model call
   * set it — the first one, since `DEFAULT_BUDGETS.maxTokens` is 0 — and
   * CHECK_GOAL turned it into the TERMINAL status `budget_exhausted`. A missing
   * resource was being reported as the end of thinking, which is precisely the
   * contradiction the 2026-09-10 directive names: cognitive autonomy is not
   * resource availability.
   *
   * A ledger instead: one row per capability, saying what could not execute and
   * WHY, in the directive's own vocabulary. Nothing here ends a run. LOCAL, not
   * module-level, for the reason `lastResults` is: a ledger shared by two
   * concurrent runs is a cross-run data leak no single-run test could see.
   */
  let capabilities: ReadonlyMap<Capability, CapabilityState> = new Map();
  const noteCapability = (
    capability: Capability,
    availability: CapabilityState["availability"],
    detail: string,
    bound: BoundBreach | null,
    station: string | null,
  ) => {
    capabilities = recordCapability(capabilities, {
      capability,
      availability,
      detail,
      bound,
      station,
    });
  };
  /**
   * THE RECOVERY LEDGER, and it is LOCAL for the reason `lastResults` is: two
   * concurrent runs sharing a retry count is a cross-run data leak no
   * single-run test could see. Recovery brief section 5 — every budget finite,
   * none unlimited.
   */
  let ledger: RetryLedger = EMPTY_RETRY_LEDGER;
  /**
   * Set by a recovery decision that the CURRENT station cannot act on alone —
   * a replan, a research hop, an escalation. Read by the stations that can.
   * Never a retry: a retry is performed where it failed, by the loop that
   * failed, or it is not a retry.
   */
  let pendingRecovery: RecoveryDecision | null = null;
  /**
   * Actions a recovery decision has taken off the table for the rest of this
   * run. THIS IS WHAT MAKES `replan` MEAN SOMETHING: without it, PLAN would
   * re-select the highest-value future — which is the action that just failed —
   * and the "replan" would be a retry with a different name, which is exactly
   * what failure brief section 25 forbids.
   */
  const blockedActions = new Set<string>();
  /** How much of `chain` the persistence adapter has been offered so far. */
  let persistedUpTo = 0;
  let persistedStates = 0;

  const note = (station: Station, text: string, refused: string | null = null) => {
    log.push({
      iteration: spent.iterations,
      station,
      note: text,
      refused,
      stateId: state.stateId,
      spent: { ...spent },
    });
  };

  /** Every model call goes through here, so no station can skip the gate. */
  /**
   * THE ONLY WAY A STATE CHANGES IN THIS FILE, so the chain cannot miss one.
   *
   * `advance` is still the pure transition; this wraps it to append. Calling
   * `advance` directly here would produce a state the chain never saw, and a
   * replay of that chain would then be a replay of a different run —
   * `runtimeWiring.test.ts` fails if any `advance(` outside this helper appears
   * in the loop body.
   */
  const step = (changes: Parameters<typeof advance>[1]): LoopState => {
    const next = advance(state, changes);
    chain.push(next);
    return next;
  };

  /* ---------------------------------------------------------------- *
   * RECOVERY — the failure brief, sections 1, 19, 20, 23, 24 and 31.
   *
   * "ONIQ must never respond to failure with an unconditional retry."
   * FAILURE -> CLASSIFY -> DIAGNOSE -> RECOVER -> RETRY/REPLAN/RESEARCH/
   * ESCALATE/STOP, and the middle three are `decideRecovery`'s job, not any
   * station's. A station raises what it knows; it does not choose what happens
   * next, because a station choosing its own recovery is how a planning failure
   * becomes three retries.
   * ---------------------------------------------------------------- */

  const site = (station: Station, attempt: number, idempotency: IdempotencyClass) => ({
    runId: run.runId,
    stateId: state.stateId,
    station,
    attempt,
    maxAttempts: run.retryBudgets.maxAttemptsPerOperation,
    idempotency,
  });

  /** Which budget a level just spent. Every action lands in exactly one. */
  const bumpLedger = (l: RetryLedger, d: RecoveryDecision, station: string): RetryLedger => {
    const perStation = { ...l.perStation, [station]: (l.perStation[station] ?? 0) + 1 };
    switch (d.action) {
      case "retry":
      case "retry_adjusted":
        return { ...l, totalRetries: l.totalRetries + 1, perStation };
      case "repair":
        return { ...l, repairs: l.repairs + 1, perStation };
      case "replan":
        return { ...l, replans: l.replans + 1, perStation };
      case "research":
        return { ...l, researchRecoveries: l.researchRecoveries + 1, perStation };
      case "escalate":
        return { ...l, escalations: l.escalations + 1, perStation };
      default:
        return { ...l, perStation };
    }
  };

  /**
   * THE FAILURE IS RECORDED ON THE STATE BEFORE THE DECISION IS ACTED ON, and
   * it is recorded whether or not the recovery then succeeds — sections 20 and
   * 31: "Never mutate history to hide a failure", and "A failure must never
   * disappear merely because a retry succeeded." A run that failed twice and
   * then worked has three states, not one.
   */
  const recover = (raw: Failure, over: Partial<RecoveryContext> = {}): RecoveryDecision => {
    const ctx: RecoveryContext = {
      budgets: run.retryBudgets,
      ledger,
      backoff: run.backoff,
      // What is LEFT on the run's wall-clock bound. Section 6: a backoff may
      // never outlast it, because a run that ends asleep is not a recovery.
      remainingRunMs: Math.max(0, budgets.maxExecutionTimeMs - spent.elapsedMs),
      retryAfterMs: null,
      jitterFraction: run.jitter(),
      alternateAvailable: false,
      repairAvailable: false,
      ...over,
    };
    const decision = decideRecovery(raw, ctx);
    const recorded: Failure = { ...raw, recoveryAction: decision.action };
    state = step({ failures: [...state.failures, recorded], spent });
    ledger = bumpLedger(ledger, decision, raw.station);
    note(
      raw.station as Station,
      `${raw.class}/${raw.code} -> ${decision.action} (level ${decision.level}): ${decision.reason}`,
      raw.code,
    );
    if (decision.terminal) {
      state = step({ status: decision.terminalStatus ?? "failure", spent });
      /* -------------------------------------------------------------- *
       * SECTION 23: BUDGET_EXHAUSTED is a distinct outcome from FAILED and
       * "must name which budget". Both halves already had homes — `status`
       * carries the outcome, `terminated` carries the bound — so this assigns
       * the BOUND NAME and nothing else.
       *
       * `terminated` IS A STABLE TOKEN, NEVER PROSE, and that is load-bearing
       * rather than stylistic: `classifyResponse` in the runtime does exact set
       * membership on it to tell a refusal from a failure. A first draft here
       * wrote `budget_exhausted: max_cost` — strictly more words, and it would
       * have silently reclassified every budget refusal as
       * `partially_completed`, which is the exact mistake the comment above
       * that set warns about. `terminatedIsAToken` pins it.
       * -------------------------------------------------------------- */
      terminated = decision.budgetName ?? decision.terminalStatus ?? "failure";
    }
    return decision;
  };

  /**
   * v1.3 SECTION 19, AND THE GRANULARITY IS A DELIBERATE TRADE.
   *
   * States are offered to the adapter at the END OF EACH ITERATION and once
   * more when the run stops, rather than inside `step`. Persisting inside
   * `step` would make every one of the fourteen transition sites `await` — a
   * change that turns a synchronous, obviously-total helper into an async one
   * and buys durability of a partial iteration nobody replays.
   *
   * WHAT IS GIVEN UP, STATED: a crash mid-iteration loses that iteration's
   * states. What is kept: the chain a replay actually needs, and the property
   * that `step` stays the one synchronous way a state changes.
   */
  const flushChain = async (): Promise<number> => {
    let stored = 0;
    for (; persistedUpTo < chain.length; persistedUpTo++) {
      // The adapter's OWN answer, never `chain.length`. An adapter that stores
      // nothing must report 0, or every later reader believes a chain was
      // saved that was not.
      if (await run.persistence.persist(chain[persistedUpTo])) stored++;
    }
    return stored;
  };

  const ask = async (station: Station, prompt: string, maxOutputTokens: number) => {
    const kind = ENGINE_STATIONS[station];
    if (!kind) return { ok: false as const, text: "", reason: `${station} may not call the model` };
    const req = { kind, prompt, maxOutputTokens };
    // PRICE FIRST, THEN GATE, THEN CALL — and never in any other order. Brief
    // section 21: `estimatedCost <= remainingCostBudget`, and "if price is
    // unknown: REFUSE". `estimate` returning null is that refusal; it becomes
    // the `unpriced` bound so it is reported, audited and tested like any other.
    // THE ADAPTER MAY NOT UNDER-REPORT A BOUND THE KERNEL CAN COMPUTE ITSELF.
    // `maxOutputTokens` is what this call is about to ASK the provider for, and
    // the kernel knows it without asking anyone — so an estimate below it is
    // raised to it. An adapter's estimate can make a call look MORE expensive,
    // never less. Found by a test: a stub estimating zero tokens walked
    // straight through a `maxTokens: 0` budget.
    const quote = engine.estimate(req);
    const b = wouldBreach(
      spent,
      budgets,
      quote === null
        ? null
        : { tokens: Math.max(quote.tokens, maxOutputTokens), costUsd: quote.costUsd },
    );
    if (b) {
      /* ---------------------------------------------------------------- *
       * A REFUSED MODEL CALL IS A CAPABILITY STATE, NOT A VERDICT ON THE RUN.
       *
       * `availabilityForBound` returns null for the three RUN bounds, and that
       * null is load-bearing: a run bound is genuinely fatal and the check at
       * the top of the next station ends the run through `breachRun`. Recording
       * one here as a capability would say the model is unavailable when what
       * actually happened is that this run ran out of time.
       * ---------------------------------------------------------------- */
      const availability = availabilityForBound(b);
      if (availability)
        noteCapability("model", availability, `model call refused: ${b}`, b, station);
      return { ok: false as const, text: "", reason: b };
    }
    const reply = await engine.run(req);
    spent = addUsage(spent, reply.usage);
    if (!reply.ok) {
      // The engine itself refused. With no provider verdict to read, the honest
      // classification is that the provider could not serve it — never
      // `unauthorized`, which is a claim about who ONIQ is and needs evidence.
      noteCapability(
        "model",
        "provider_unavailable",
        reply.reason ?? "engine refused",
        null,
        station,
      );
      return { ok: false as const, text: "", reason: reply.reason ?? "engine refused" };
    }
    noteCapability("model", "available", `answered by ${reply.model}`, null, station);
    return { ok: true as const, text: reply.text, reason: undefined };
  };

  outer: while (spent.iterations < budgets.maxIterations) {
    const percepts = input.percepts?.[spent.iterations] ?? [];

    for (const station of STATIONS) {
      if (input.stopAfterStations !== undefined && stationsRun >= input.stopAfterStations) {
        terminated = "paused";
        break outer;
      }
      stationsRun++;

      // The elapsed reading is taken once per station, from the seam, and
      // recorded — so a replay is driven by the recording rather than by a
      // second real clock that will not agree with the first.
      spent = { ...spent, elapsedMs: clock() };
      const bound = breachRun(spent, budgets);
      if (bound) {
        // A RUN BOUND IS FATAL AND STILL GETS A FAILURE RECORD, because
        // section 23 wants BUDGET_EXHAUSTED to name its budget and section 20
        // wants it to survive replay. `recover` sets the terminal status and
        // `terminated` from the decision, so the naming happens in one place.
        recover(fromBudget(site(station, 1, "READ"), bound), { exhaustedBudget: bound });
        break outer;
      }

      switch (station) {
        case "PERCEIVE":
          state = step({ percepts: [...state.percepts, ...percepts], spent });
          note(
            station,
            `${percepts.length} percepts this iteration, ${state.percepts.length} held`,
          );
          break;

        case "UNDERSTAND": {
          // The goal is SUPPLIED, and the model's job is to say what is
          // ambiguous about it — not to replace it. A station that let a model
          // rewrite the objective would make every later success criterion the
          // model's own, which is not a goal, it is a mark it set itself.
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nPercepts:\n${state.percepts.map((p) => `- [${p.kind}] ${p.content}`).join("\n") || "- none"}\n\nName in one line what is AMBIGUOUS about this goal, or say NOTHING AMBIGUOUS.`,
            120,
          );
          note(station, r.ok ? firstLine(r.text) : "goal taken as given", r.ok ? null : r.reason!);
          break;
        }

        case "LOAD_MEMORY": {
          const recalled = await memory.recall(state.goal.statement, 8);
          /* ------------------------------------------------------------ *
           * v1.3 SECTIONS 5 AND 11. Memory is what this RUN has seen;
           * knowledge is what ONIQ holds. They are separate adapters because
           * they have separate lifetimes and separate deletion stories, and
           * merging them would make "forget what I told you" unimplementable.
           *
           * BOTH ARE LIMITED, AND THE LIMIT IS AN ARGUMENT RATHER THAN A
           * DEFAULT: section 5's "Do not dump the entire memory store into the
           * model" is a property of the CALL, and a store that decided its own
           * bound could satisfy the interface while breaking the rule.
           * ------------------------------------------------------------ */
          const known = await run.knowledge.lookup(state.goal.statement, 8);
          const facts: Percept[] = known.map((f) => ({
            id: `knowledge-${f.id}`,
            kind: "memory" as const,
            content: f.statement,
            source: f.sourceRef,
            confidence: f.confidence,
            provenance: "OBSERVED" as const,
          }));
          state = step({
            memoryRefs: recalled,
            percepts: [...state.percepts, ...facts],
            spent,
          });
          note(
            station,
            `${recalled.length} record(s) recalled and ${facts.length} fact(s) looked up, both bounded at 8`,
          );
          break;
        }

        case "BUILD_WORLD_STATE": {
          // v1.3 SECTIONS 6 AND 30. The census is reported rather than
          // summarised, because "3 entities" cannot answer the question the
          // section actually asks — how many of them did anyone actually SEE.
          const census: Record<string, number> = {};
          for (const e of state.worldState.entities) {
            census[e.provenance] = (census[e.provenance] ?? 0) + 1;
          }
          const breakdown =
            PROVENANCES.filter((p) => census[p])
              .map((p) => `${census[p]} ${p}`)
              .join(", ") || "no entities";
          note(
            station,
            `${state.worldState.entities.length} entities (${breakdown}), ${state.worldState.relations.length} relations, ` +
              `${state.worldState.availableActions.length} actions available and ${state.worldState.unavailableActions.length} not`,
          );
          break;
        }

        case "REPRESENT":
          note(station, `basis ${quantum.basis.length}, norm ${quantum.norm().toFixed(12)}`);
          break;

        case "SUPERPOSE": {
          const admit = state.goal.requires.find((r) => !quantum.basis.includes(r.conceptId));
          if (admit) {
            quantum = superpose(quantum, admit.conceptId, 1 / (quantum.basis.length + 1));
            spent = { ...spent, transitions: spent.transitions + 1 };
            note(station, `admitted ${admit.conceptId}`);
          } else {
            note(station, "no new hypothesis admitted");
          }
          break;
        }

        case "RELATE":
          // Performable — see the header. A graph over the world model, not
          // `cognitive.entangle`, which is category C and is never called here.
          note(station, `${state.worldState.relations.length} dependencies bound`);
          break;

        case "REASON": {
          const c = quantum.confidence();
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nLeading hypothesis: ${c.top} at ${c.probability.toFixed(4)} (entropy ${c.entropy.toFixed(4)} bits)\nWhat single step most advances the goal? One line.`,
            200,
          );
          note(
            station,
            r.ok
              ? `${firstLine(r.text)} [leading ${c.top} p=${c.probability.toFixed(4)}]`
              : `leading ${c.top} at ${c.probability.toFixed(4)}, margin ${c.margin.toFixed(4)}`,
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "IDENTIFY_GAPS":
          if (input.knowledge) {
            gaps = detectGaps(state.goal, input.knowledge);
            state = step({ knowledgeGaps: gaps, spent });
            note(station, `${openGaps(gaps).length} open of ${gaps.length}`);
          } else {
            note(station, "no knowledge state supplied", "no_knowledge_state");
          }
          break;

        case "RESEARCH":
          if (gaps.length === 0) {
            note(station, "no gaps to research");
          } else if (spent.researchOperations >= budgets.maxResearchOperations) {
            // v1.6: this used to set `terminated` and `break outer`, ending the
            // run at station 10 of 23. An exhausted research allowance means
            // ONIQ cannot ACQUIRE knowledge right now; it does not mean ONIQ
            // cannot imagine, plan, evaluate, reflect or check its goal.
            noteCapability(
              "research",
              "insufficient_allowance",
              "the research allowance for this run is spent",
              "max_research_operations",
              station,
            );
            note(station, "research bound reached", "max_research_operations");
          } else {
            spent = { ...spent, researchOperations: spent.researchOperations + 1 };
            research = planResearch(state.goal.id, gaps);
            const question = research.next?.concept ?? null;
            if (question === null) {
              note(station, "nothing worth asking");
            } else {
              /* -------------------------------------------------------- *
               * v1.3 SECTION 12: "Never fabricate research."
               *
               * This station used to PLAN a question and stop. The adapter is
               * what turns the plan into an acquisition — and its result is a
               * UNION rather than an array precisely so that "I researched and
               * found nothing" and "I cannot research" are different answers.
               * The second is a KNOWLEDGE failure and goes to the recovery
               * ladder; treating it as an empty finding set would be a
               * fabricated negative result, which is what the section forbids.
               * -------------------------------------------------------- */
              const found = await run.research.investigate(question);
              if (found.ok) {
                // A FINDING BECOMES A PERCEPT AT `OBSERVED`, AND THAT IS NOT A
                // CLAIM THAT IT IS TRUE. What was observed is that a named
                // source says this — `sourceRef` is required by the type, so
                // there is always one. How much it is believed travels in
                // `confidence`, which is the field for that; collapsing the two
                // would be section 30's "represent an inference as an
                // observation" in the subtlest available form.
                const learned: Percept[] = found.findings.map((f) => ({
                  id: `research-${f.id}`,
                  kind: "document" as const,
                  content: `${f.question} -> ${f.answer}`,
                  source: f.sourceRef,
                  confidence: f.confidence,
                  provenance: "OBSERVED" as const,
                }));
                state = step({ percepts: [...state.percepts, ...learned], spent });
                note(station, `${question}: ${learned.length} finding(s)`);
              } else {
                const refusal = fromStation(
                  site(station, 1, "READ"),
                  "KNOWLEDGE",
                  "research_unavailable",
                  found.reason,
                );
                // The recovery ladder still runs — a refused acquisition is a
                // real failure and section 12 wants it recorded. What is NEW is
                // that the same refusal also lands in the capability ledger, so
                // the runtime above can tell "ONIQ cannot research" from "ONIQ
                // researched and found nothing" without reading prose.
                noteCapability(
                  "research",
                  availabilityForFailureClass(refusal.class),
                  found.reason,
                  null,
                  station,
                );
                recover(refusal, { researchAvailable: false });
              }
            }
          }
          break;

        case "VERIFY": {
          // SECTION 14, AND THE FIRST DRAFT HAD THIS EXACTLY BACKWARDS. It asked
          // the MODEL to label its own research claims SUPPORTED / CONTRADICTED
          // / UNVERIFIED — a model marking its own homework, over the loop's
          // BELIEFS rather than over real output. The station now asks the
          // caller's verifier, which reads the ENVIRONMENT.
          //
          // It runs on the outcomes OBSERVE recorded, so the first iteration of
          // a run that has not acted yet is honestly `unverified` rather than
          // silently skipped: "nothing was checked" is a verdict, and section 14
          // asks for it by name.
          const verification = await verifier({
            goalStatement: state.goal.statement,
            outcomes: state.outcomes.map((o) => ({ observed: o.observed, matched: o.matched })),
          });
          state = step({ verification, spent });
          note(
            station,
            `${verification.verdict}: ${verification.detail}`,
            // A REJECTION IS NOT A REFUSAL. `refused` means the station could
            // not run; a verdict of `rejected` means it ran and the goal was
            // not met. Only the absence of any check is recorded as a refusal.
            verification.verdict === "unverified" ? "unverified" : null,
          );
          break;
        }

        case "UPDATE_STATE": {
          // Section 15, in its own order: evidence, then probabilities, then
          // phase/context. All three come from the CALLER — see IterationEvidence.
          const ev = input.evidence?.[spent.iterations];
          const parts: string[] = [];
          // BOTH SHAPES OPEN THIS BLOCK. Adding the keyed map without widening
          // this condition meant a caller could supply perfectly good evidence,
          // typecheck, run, and have the station report "no evidence this
          // iteration" — which is what the first complete run did, four times,
          // with nothing red and nothing refused.
          if (ev?.likelihoods || ev?.likelihoodsByHypothesis) {
            // SECTION 11: "if a new hypothesis is admitted, the likelihood
            // vector must be explicitly sized for the POST-ADMISSION basis."
            //
            // A caller cannot pass a positional vector and be right, because
            // SUPERPOSE runs FIRST and admits from `goal.requires` — measured on
            // the first real run: 3 likelihoods against a basis of 4, every
            // iteration, so evidence never folded and the loop never reached a
            // decision at all. Nothing was red there either; the refusal was
            // correct and the caller could not satisfy it.
            //
            // A MAP KEYED BY HYPOTHESIS is the shape that survives, and it does
            // not weaken the rule: every basis element must be named, so an
            // admitted hypothesis nobody has evidence about is still a refusal
            // rather than a padded 1.
            const byLabel = ev.likelihoodsByHypothesis;
            const vector = byLabel
              ? quantum.basis.map((label) => byLabel[label])
              : (ev.likelihoods ?? []);
            if (byLabel && vector.some((v) => typeof v !== "number")) {
              const missing = quantum.basis.filter((l) => typeof byLabel[l] !== "number");
              note(station, `no likelihood for ${missing.join(", ")}`, "likelihood_missing");
              break;
            }
            if (vector.length !== quantum.basis.length) {
              // Refused by name rather than padded. Padding would invent a
              // likelihood for a hypothesis nobody has evidence about, which is
              // the v1.1 lesson from SUPERPOSE running before EVIDENCE_UPDATE.
              note(
                station,
                `${vector.length} likelihoods against a basis of ${quantum.basis.length}`,
                "likelihood_width_mismatch",
              );
              break;
            }
            quantum = evidence(quantum, vector as readonly number[], {
              evidenceIds: ev.evidenceIds,
            });
            spent = { ...spent, transitions: spent.transitions + 1 };
            parts.push("evidence folded in (Bayes-exact)");
          }
          if (ev?.phases) {
            ev.phases.forEach((theta, i) => {
              if (theta !== 0 && i < quantum.basis.length) {
                quantum = phase(quantum, quantum.basis[i], theta);
                spent = { ...spent, transitions: spent.transitions + 1 };
              }
            });
            if (ev.phases.some((t) => t !== 0)) parts.push("context applied as phase");
          }
          if (ev?.interfere) {
            const [i, j, theta] = ev.interfere;
            if (i < quantum.basis.length && j < quantum.basis.length && i !== j) {
              quantum = interfere(quantum, quantum.basis[i], quantum.basis[j], theta);
              spent = { ...spent, transitions: spent.transitions + 1 };
              parts.push(`interfered (${quantum.basis[i]}, ${quantum.basis[j]})`);
            }
          }
          note(station, parts.join("; ") || "no evidence this iteration");
          break;
        }

        case "IMAGINE": {
          const actions = state.worldState.availableActions;
          if (actions.length === 0) {
            note(station, "no available actions to imagine", "no_available_actions");
            break;
          }
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nAvailable actions:\n${actions.map((a) => `- ${a}`).join("\n")}\nFor each, one line: ACTION | expected result | risk 0-1 | goal progress 0-1.`,
            400,
          );
          // The futures are built from the ACTION LIST, not from the reply, so a
          // model cannot invent an action that is not available. Its text only
          // supplies the expectation; an unparsed reply leaves the honest
          // default rather than dropping the action.
          const lines = r.ok ? r.text.split("\n") : [];
          const futures: ImaginedFuture[] = actions.map((action, i) => {
            const said = lines.find((l) => l.includes(action)) ?? "";
            // THE ACTION'S OWN NAME IS REMOVED BEFORE ANY NUMBER IS READ, and
            // this was a real defect found by running a real job. Every ONIQ
            // story job id is hex — `dispatch story job 8f2c1a` — so the digit
            // scan matched the "1" inside the ID and scored the action's risk
            // at 1.0 from its own name. Expected value is progress x (1 - risk),
            // so EVERY dispatch priced out at zero and the loop chose to hold,
            // every time, on a queue it had correctly understood.
            //
            // Nothing was red. The futures were built, PLAN selected, ACT ran —
            // it simply always picked the do-nothing option, which reads as a
            // cautious loop rather than a broken parser.
            const scored = said.slice(said.indexOf(action) + action.length);
            const nums = scored.match(/0?\.\d+|[01](?!\d)/g)?.map(Number) ?? [];
            const risk = nums[0] ?? 0.5;
            const goalProgress = nums[1] ?? 0.5;
            return {
              action,
              expectedResult: said.split("|")[1]?.trim() || "unknown",
              risk: Math.min(1, Math.max(0, risk)),
              cost: 0,
              uncertainty: r.ok ? 0.5 : 1,
              // ASKED, NOT GUESSED. This used to be a regex over the action's
              // NAME — which cannot know that "dispatch story job X" writes to
              // production, and would have called it safe because the word
              // "delete" is absent. The router registered the tool; the router
              // is the only thing that knows what it does.
              ...(router.properties(action) ?? UNKNOWN_TOOL_PROPERTIES),
              goalProgress: Math.min(1, Math.max(0, goalProgress)),
              expectedValue:
                Math.min(1, Math.max(0, goalProgress)) * (1 - Math.min(1, Math.max(0, risk))),
            } satisfies ImaginedFuture;
          });
          state = step({ futures, spent });
          note(
            station,
            `${futures.length} futures scored${r.ok ? "" : " (engine refused; defaults used)"}`,
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "PLAN": {
          // A REPLAN MUST NOT RE-SELECT WHAT JUST FAILED. Sorting the same
          // futures again would return the same winner, and the recovery ladder
          // would have spent a level to arrive back where it was.
          const open = state.futures.filter((f) => !blockedActions.has(f.action));
          if (blockedActions.size > 0) {
            note(
              station,
              `${blockedActions.size} action(s) withdrawn by an earlier recovery; ${open.length} candidate(s) remain`,
            );
          }
          const best = [...open].sort((a, b) => b.expectedValue - a.expectedValue)[0];
          if (!best) {
            note(
              station,
              blockedActions.size > 0
                ? "every candidate action has been withdrawn"
                : "nothing to plan",
              blockedActions.size > 0 ? "no_candidates_left" : "no_futures",
            );
            break;
          }
          // Consumed HERE rather than at the top of the station list, because
          // PLAN is the station that can act on it. A decision nobody consumed
          // would silently persist into the next iteration.
          pendingRecovery = null;
          const plan: Plan = {
            id: `plan-${state.iteration}-${best.action}`,
            objective: state.goal.statement,
            steps: [
              {
                id: "s1",
                describes: best.action,
                dependsOn: [],
                call: {
                  tool: best.action,
                  input: {},
                  reversible: best.reversible,
                  // FROM THE FUTURE, WHICH GOT IT FROM THE ROUTER. Deriving it
                  // from `reversible` is the defect described in seams.ts.
                  touchesProduction: best.touchesProduction,
                  rationale: best.expectedResult,
                },
              },
            ],
            requiredTools: [best.action],
            risks: best.risk > 0.5 ? [`risk ${best.risk.toFixed(2)}`] : [],
            rollback: best.reversible ? "action is reversible" : null,
            successCriteria: [state.goal.statement],
          };
          state = step({ candidatePlans: [plan], selectedPlan: plan, spent });
          note(station, `selected ${plan.id} (EV ${best.expectedValue.toFixed(3)})`);
          break;
        }

        case "EVALUATE": {
          const plan = state.selectedPlan;
          if (!plan) {
            note(station, "no plan to evaluate", "no_plan");
            break;
          }
          // Section 18's questions, answered in code rather than by the model,
          // because "is this reversible" and "is there budget" are facts the
          // runtime holds and a model would be guessing at.
          const irreversible = plan.steps.filter((s) => s.call && !s.call.reversible);
          // THE PLAN IS PRICED AS A WHOLE, not one step at a time, because that
          // is the question EVALUATE asks: can this plan be afforded? Pricing
          // step by step admits a plan whose first action fits and whose second
          // does not, and discovers that halfway through acting on production.
          // One unpriceable step makes the whole plan unpriceable — section 21's
          // "if price is unknown: REFUSE" does not become "refuse the cheap
          // half".
          let planCost: SpendEstimate | null = { tokens: 0, costUsd: 0 };
          for (const step of plan.steps) {
            if (!step.call || planCost === null) continue;
            const q = router.estimate(step.call);
            planCost =
              q === null
                ? null
                : { tokens: planCost.tokens + q.tokens, costUsd: planCost.costUsd + q.costUsd };
          }
          const wouldSpend = wouldBreach(spent, budgets, planCost);
          if (wouldSpend) {
            /* -------------------------------------------------------------- *
             * v1.6 — THE PLAN IS REFUSED; THE RUN IS NOT.
             *
             * This block used to call `recover(fromBudget(...))`, whose BUDGET
             * class the ladder turns TERMINAL, and then `break outer`. With
             * `maxToolCalls: 0` — the shipped default — every plan holding a
             * call is unaffordable, so EVALUATE ended the run before MEASURE,
             * LEARN_OR_CORRECT, CONSOLIDATE, REFLECT or CHECK_GOAL had run.
             * Self-evaluation was the station that stopped self-evaluation.
             *
             * A capability shortfall is not a failure, so it does not go
             * through the recovery ladder at all: a ladder answers retry /
             * replan / escalate, and retrying an action whose resource is
             * absent is spend chasing a wall. The plan is cleared, the state is
             * recorded, and the loop carries on.
             *
             * A RUN bound reaching here is different and stays fatal — it is
             * caught at the top of the next station by `breachRun`.
             * -------------------------------------------------------------- */
            state = step({ selectedPlan: null, spent });
            const availability = availabilityForBound(wouldSpend);
            if (availability) {
              noteCapability(
                "tool",
                availability,
                `the plan cannot be afforded: ${wouldSpend}`,
                wouldSpend,
                station,
              );
            }
            note(station, `plan refused: ${wouldSpend}`, wouldSpend);
            break;
          }

          /* -------------------------------------------------------------- *
           * v1.3 SECTIONS 6, 30 AND 31 — AND THIS IS THE GATE THAT MAKES
           * PROVENANCE MORE THAN A LABEL.
           *
           * §31: "If any required information is unavailable, the operation
           * should fail closed where safety, spending or production mutation is
           * involved." A plan step that touches production is exactly that
           * case, and the required information is whether the world it is about
           * to change was ever actually SEEN.
           *
           * So a production step is refused when every entity backing it is
           * INFERRED, PREDICTED or UNKNOWN. It is deliberately NOT refused for
           * a read, a shadow run, or a plan over an empty world model — the
           * gate is the mutation, not the tidiness of the model.
           * -------------------------------------------------------------- */
          const productionSteps = plan.steps.filter((st) => st.call?.touchesProduction);
          const observedEntities = state.worldState.entities.filter((e) =>
            isEvidential(e.provenance),
          );
          if (
            productionSteps.length > 0 &&
            state.worldState.entities.length > 0 &&
            observedEntities.length === 0
          ) {
            state = step({ selectedPlan: null, spent });
            recover(
              fromStation(
                site(station, 1, "READ"),
                "PREDICTION",
                "production_on_unobserved_world",
                `${productionSteps.length} production step(s) rest on ${state.worldState.entities.length} entities, none of them OBSERVED`,
              ),
            );
            break;
          }

          if (irreversible.length > 0 && !plan.rollback) {
            state = step({ selectedPlan: null, spent });
            note(
              station,
              `refused: ${irreversible.length} irreversible step(s) with no rollback`,
              "irreversible_no_rollback",
            );
            break;
          }
          note(station, "plan valid, budget available, rollback present or unneeded");
          break;
        }

        case "ACT": {
          const plan = state.selectedPlan;
          if (!plan) {
            note(station, "nothing to act on", "no_plan");
            break;
          }
          const predictions: Prediction[] = [];
          const results: { step: string; result: ToolResult }[] = [];
          /* ---------------------------------------------------------------- *
           * v1.6 — THE LABEL IS THE FIX, AND IT IS A SMALL ONE WITH A LARGE
           * CONSEQUENCE. Both refusals below used to `break outer`, which threw
           * away every remaining station AND every remaining iteration. They
           * break `steps` now: no further action is attempted — nothing is
           * fabricated, nothing is retried against an absent resource — and
           * OBSERVE, MEASURE, LEARN_OR_CORRECT, REFLECT and CHECK_GOAL still
           * run on what did happen.
           * ---------------------------------------------------------------- */
          steps: for (const step of plan.steps) {
            if (!step.call) continue;
            if (spent.toolCalls >= budgets.maxToolCalls) {
              noteCapability(
                "tool",
                "insufficient_allowance",
                "the tool-call allowance for this run is spent",
                "max_tool_calls",
                station,
              );
              note(station, "tool-call bound reached", "max_tool_calls");
              break steps;
            }
            // A TOOL CAN SPEND MONEY TOO, so it is priced on the same rule as a
            // model call. The count bound above and the cost bound here are
            // INDEPENDENT (section 6): `maxToolCalls` says how many actions may
            // be taken, `maxCostUsd` says what they may cost, and a refusal
            // names whichever one actually bound.
            const priced = wouldBreach(spent, budgets, router.estimate(step.call));
            if (priced) {
              const availability = availabilityForBound(priced);
              if (availability) {
                noteCapability("tool", availability, `action refused: ${priced}`, priced, station);
              }
              note(station, `action refused: ${priced}`, priced);
              break steps;
            }
            predictions.push({ stepId: step.id, expected: step.describes });

            /* ---------------------------------------------------------- *
             * THE RECOVERY LOOP, and this is the one place in ONIQ it is
             * mandatory: failure brief section 32 — "mandatory for every
             * consequential ONIQ action". A tool call is the only thing this
             * loop does that changes the world.
             *
             * EVERY ATTEMPT COSTS A TOOL CALL, counted before the call and not
             * after, so a retry spends the same budget an action does. A retry
             * ladder that did not charge itself would be an unbounded action
             * budget wearing a bounded one's name.
             * ---------------------------------------------------------- */
            const props = router.properties(step.call.tool) ?? UNKNOWN_TOOL_PROPERTIES;
            let attempt = 1;
            let result: ToolResult | null = null;
            for (;;) {
              spent = { ...spent, toolCalls: spent.toolCalls + 1 };
              let thrown: unknown = null;
              try {
                result = await router.execute(step.call);
              } catch (e) {
                thrown = e;
                result = null;
              }
              if (result) spent = addUsage(spent, result.usage);
              if (result && result.ok) break;

              const at = site(station, attempt, props.idempotency);
              const failure =
                thrown !== null
                  ? fromThrown(at, thrown)
                  : fromStation(
                      at,
                      "TOOL",
                      result?.reason ?? "tool_refused",
                      // The tool's own words. `observed` is the ENVIRONMENT's,
                      // and a failed call has no environment answer to trust.
                      result?.output || result?.reason || "the tool did not say why",
                    );
              const decision = recover(failure, {
                // No alternate is offered here: a plan step names ONE tool, and
                // choosing a different one is a REPLAN, which is what the
                // decision returns when it wants that. Claiming an alternate
                // exists when none has been registered would send the ladder to
                // a level that cannot act.
                alternateAvailable: false,
              });
              if (decision.terminal) break outer;
              if (decision.action !== "retry" && decision.action !== "retry_adjusted") {
                // Anything above a retry is a decision the NEXT station or the
                // next iteration acts on — PLAN reads a cleared plan, RESEARCH
                // reads a pending research decision. ACT does not act on it,
                // because ACT is where the failure was.
                pendingRecovery = decision;
                if (decision.action === "replan" || decision.action === "alternate") {
                  blockedActions.add(step.call.tool);
                }
                break;
              }
              attempt++;
              if (spent.toolCalls >= budgets.maxToolCalls) {
                // The retry ladder ran out of ACTIONS, not out of reasons. It
                // stops attempting; it does not end the run. `recover` is not
                // called here any more: its BUDGET class is terminal by design,
                // and an allowance is not a fault to recover from.
                noteCapability(
                  "tool",
                  "insufficient_allowance",
                  "the tool-call allowance ran out mid-retry",
                  "max_tool_calls",
                  station,
                );
                note(station, "tool-call allowance spent mid-retry", "max_tool_calls");
                break steps;
              }
            }
            // A RESULT IS RECORDED WHETHER OR NOT IT SUCCEEDED. OBSERVE judges
            // it against the prediction; dropping a failed attempt here would
            // make the run look like it never acted, which is section 31's
            // "a failure must never disappear" in the other direction.
            if (result) results.push({ step: step.id, result });
          }
          state = step({ predictions, spent });
          note(station, `${results.length} action(s) attempted`);
          // OBSERVE reads these; carrying them on the state would make the
          // environment's answer part of the hashed record before it is judged.
          lastResults = results;
          break;
        }

        case "OBSERVE": {
          // Section 20: the environment is the authority. `observed` is the
          // environment's word and `output` is the tool's; a router that echoes
          // one into the other is caught by them being separate fields.
          const outcomes: Outcome[] = lastResults.map(({ step, result }) => {
            const expected = state.predictions.find((p) => p.stepId === step)?.expected ?? "";
            const matched =
              result.ok &&
              result.observed.length > 0 &&
              !/not performed|nothing was attempted/i.test(result.observed);
            return {
              stepId: step,
              observed: result.observed,
              matched,
              predictionError: matched ? 0 : 1,
            } satisfies Outcome;
          });
          state = step({ outcomes, spent });
          note(
            station,
            outcomes.length
              ? `${outcomes.filter((o) => o.matched).length}/${outcomes.length} matched prediction`
              : "nothing to observe",
          );
          break;
        }

        case "MEASURE": {
          // `measure()` in `../measure` takes the v1.0 `state.ts` CognitiveState,
          // which is a DIFFERENT type with the same name as the v1.1 one this
          // loop carries — `labels` against `basis`. Converting between them to
          // reach that function would be work in service of a name; the v1.1
          // state answers the same question itself.
          const c = quantum.confidence();
          const errors = state.outcomes.filter((o) => !o.matched).length;
          note(
            station,
            `${c.top ?? "undecided"} p=${c.probability.toFixed(4)} margin ${c.margin.toFixed(4)}, ` +
              `${errors} prediction error(s), $${spent.costUsd.toFixed(6)} spent`,
          );
          break;
        }

        case "LEARN_OR_CORRECT": {
          const failed = state.outcomes.filter((o) => !o.matched);
          if (failed.length === 0) {
            note(station, `LEARN: ${state.outcomes.length} outcome(s) matched prediction`);
          } else {
            // Section 22: correct the LAYER, do not regenerate the answer. The
            // layer is named from what the runtime can see, and "unknown" is a
            // permitted answer — guessing a cause is what regenerating is.
            const layer =
              state.selectedPlan === null
                ? "plan"
                : failed.every((f) => /not performed/i.test(f.observed))
                  ? "tool"
                  : "unknown";
            note(station, `CORRECT: ${failed.length} mismatch(es), layer=${layer}`);
          }
          break;
        }

        case "CONSOLIDATE": {
          // Section 24: only validated information becomes durable. The filter
          // is the outcome record, not the model's confidence in itself.
          const durable =
            state.outcomes.filter((o) => o.matched).length > 0 && state.memoryRefs.length >= 0;
          const written = durable
            ? await memory.consolidate(
                state.outcomes
                  .filter((o) => o.matched)
                  .map((o) => ({
                    id: `${state.stateId}:${o.stepId}`,
                    layer: "episodic" as const,
                    text: o.observed,
                    confidence: 1 - o.predictionError,
                  })),
              )
            : 0;
          note(station, `${written} record(s) consolidated`);
          break;
        }

        case "REFLECT": {
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nOutcomes: ${state.outcomes.map((o) => `${o.stepId}=${o.matched ? "matched" : "MISMATCH"}`).join(", ") || "none"}\nWhat assumption was wrong? One line, or NONE.`,
            160,
          );
          note(
            station,
            r.ok ? firstLine(r.text) : "no reflection available",
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "CHECK_GOAL": {
          const open = openGaps(gaps).length;
          const acted = state.outcomes.length > 0 && state.outcomes.every((o) => o.matched);
          if (acted && open === 0) {
            state = step({ status: "success", spent });
            note(station, "success criteria satisfied");
          } else if (
            unavailable(capabilityList(capabilities)).length > 0 &&
            spent.iterations + 1 >= budgets.maxIterations
          ) {
            /* ---------------------------------------------------------- *
             * v1.6 — `blocked`, NOT `budget_exhausted`, AND THE WORD IS THE
             * WHOLE POINT.
             *
             * This arm read `else if (starvedBy)` and set the terminal status
             * `budget_exhausted`. With `maxTokens: 0` the first model call set
             * that flag, so EVERY run ended announcing that a budget was
             * exhausted — which reads to anyone above as "this cognition is
             * over" and which the autonomy layer had no way to tell apart from
             * a run that genuinely had nowhere left to go.
             *
             * `blocked` is section 26's status for a run that stopped rather
             * than failed and needs something from outside — which is exactly
             * what an unavailable capability is. The ledger travels beside it
             * naming WHICH capability and WHY, so the runtime can preserve the
             * dependency, choose another objective, and come back when the
             * capability returns. `budget_exhausted` now belongs to the RUN
             * bounds alone, where it means what it says.
             *
             * AND IT IS TERMINAL ONLY ON THE LAST ITERATION, which is the half
             * that took a measurement to get right. The first draft ended the
             * run the moment any capability was refused — and the shadow run's
             * chain fell from 33 states to 12, its evidence folded once instead
             * of four times, and the replan that withdraws a refused dispatch
             * never happened. That is the same disease in a new place: a loop
             * with a working model and no tool allowance has three more
             * iterations of real reasoning to do, and stopping it after the
             * first is the resource deciding how much thinking is allowed.
             * ---------------------------------------------------------- */
            const blockers = unavailable(capabilityList(capabilities));
            state = step({ status: "blocked", spent });
            terminated = CAPABILITY_UNAVAILABLE;
            note(
              station,
              `waiting on ${blockers.map((c) => `${c.capability}:${c.availability}`).join(", ")}`,
              CAPABILITY_UNAVAILABLE,
            );
          } else if (pendingRecovery?.action === "escalate") {
            /* ---------------------------------------------------------- *
             * AN ESCALATION IN A HEADLESS RUN IS A BLOCK, AND SAYING SO IS
             * THE HONEST ANSWER. Section 19's level 7 escalates to a person;
             * a scheduled tick has no person attached to it, so a loop that
             * treated "escalate" as "carry on" would be inventing an approval
             * nobody gave. `blocked` is section 26's state for exactly this —
             * the run stopped, it did not fail, and it needs someone.
             * ---------------------------------------------------------- */
            state = step({ status: "blocked", spent });
            terminated = ESCALATION_REQUIRED;
            note(
              station,
              `escalation required and nobody is attached: ${pendingRecovery.reason}`,
              "escalation_required",
            );
          } else {
            note(
              station,
              `incomplete: ${open} open gap(s), ${state.outcomes.filter((o) => !o.matched).length} mismatch(es)`,
            );
          }
          break;
        }

        case "RESPOND": {
          if (!isTerminal(state.status)) {
            note(station, "loop continues; no answer yet");
            break;
          }
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nStatus: ${state.status}\nSummarise in one line what was done and what remains.`,
            200,
          );
          answer = r.ok
            ? firstLine(r.text)
            : `${state.status}: ${state.outcomes.length} action(s), ${openGaps(gaps).length} open gap(s)`;
          note(station, answer, r.ok ? null : r.reason!);
          break;
        }
      }

      if (station === "RESPOND" && isTerminal(state.status)) {
        // `terminated` may already name the bound that starved the run, which is
        // more informative than the status it produced.
        if (terminated === "completed") terminated = state.status;
        break outer;
      }
    }

    spent = { ...spent, iterations: spent.iterations + 1 };
    state = step({ iteration: state.iteration + 1, spent });
    persistedStates += await flushChain();
  }

  if (spent.iterations >= budgets.maxIterations && terminated === "completed") {
    terminated = "max_iterations";
  }
  // The last stretch, including whatever a `break outer` left unflushed.
  persistedStates += await flushChain();

  return {
    state,
    quantum,
    log,
    chain,
    research,
    gaps,
    answer,
    spent,
    persistedStates,
    terminated,
    capabilities: capabilityList(capabilities),
  };
}
