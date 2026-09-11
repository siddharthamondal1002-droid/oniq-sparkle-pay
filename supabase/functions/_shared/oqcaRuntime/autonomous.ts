/**
 * OQCA v1.5 — THE RUNTIME SIDE OF THE AUTONOMOUS LIFECYCLE.
 *
 * The kernel in `src/oqca/autonomy/` cannot see, act, persist or read a clock:
 * every one of those is a seam with a refusing default, and `security.test.ts`
 * walks that tree and the mirror to prove it. This file is where those seams
 * are filled from things ONIQ actually has — the knowledge substrate, the 23
 * stations, and a caller-supplied sink — and it is on the side of the boundary
 * that is allowed to hold a clock.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD: a network call, a credential, a database
 * client and a deploy. The survey is a PURE rebuild of the tick's substrate;
 * the episode is the real cognitive loop at the shipped budgets, which are
 * zero; the checkpoint store is whatever sink the caller hands in, and an edge
 * function hands in nothing. `runtimeWiring.test.ts` asserts the whole runtime
 * tree names exactly one host in exactly one file, and this is not that file.
 *
 * WHAT ONIQ CAN AND CANNOT LEARN THIS WAY, said here rather than discovered:
 * the substrate closes `queue-eligibility` and the qubit-order convention by
 * MEASURING them — a probe of `isDispatchable` and a two-qubit circuit on the
 * local simulator, both free and both first-hand. It cannot close
 * `runner-availability`, because nothing in this container can see whether a
 * GPU runner is alive, and the research adapter refuses rather than inventing
 * an answer. So an autonomous run that reaches `runner-availability` BLOCKS,
 * and that is the honest outcome rather than a defect to design around.
 */
import { type Gap, type Goal, detectGaps, openGaps } from "../oqca/knowledge/gaps.ts";
import { freshness } from "../oqca/knowledge/substrate/decay.ts";
import type { KnowledgeRecord } from "../oqca/knowledge/substrate/record.ts";
import { stalenessByConcept } from "../oqca/autonomy/select.ts";
import type { Objective, StaleSubject } from "../oqca/autonomy/objective.ts";
import {
  type CheckpointStore,
  type CycleContext,
  type EpisodeOutcome,
  type RunEpisode,
  type RuntimeSnapshot,
  type Survey,
  SNAPSHOT_VERSION,
  validateSnapshot,
} from "../oqca/autonomy/runtime.ts";
import { CognitiveState, ROOT_CONTEXT } from "../oqca/formalState.ts";
import { unavailable } from "../oqca/loop/capability.ts";
import { runCognitiveLoop } from "../oqca/loop/cognitiveLoop.ts";
import { EMPTY_WORLD, sealLoopState, type LoopState } from "../oqca/loop/loopState.ts";
import { type Budgets, DEFAULT_BUDGETS, NO_SPEND } from "../oqca/loop/seams.ts";
import { DISPATCH_GOAL } from "./dispatchJob.ts";
import { buildSubstrate, type SubstrateBuild } from "./substrate.ts";

/**
 * WHAT ONIQ IS FOR WHEN NOBODY HAS ASKED IT ANYTHING. The domain's own goal is
 * the standing one, so "what should I do next?" has an answer on the very first
 * cycle with no user request in sight — which is the whole point of v1.5. It is
 * the SAME goal the shadow dispatcher runs, deliberately: a second standing
 * goal invented here would be a second answer to what ONIQ is trying to do.
 */
export const STANDING_GOAL: Goal = DISPATCH_GOAL;

export type SubstrateContext = {
  /** ISO instant stamped onto records. A STRING the caller supplies. */
  readonly at: () => string;
  readonly nowMs: () => number;
  readonly resolved?: (name: string) => boolean;
  readonly elapsedMs?: () => number;
};

/** Highest priority per concept, so one concept is one candidate. */
function mergeGaps(a: readonly Gap[], b: readonly Gap[]): Gap[] {
  const byConcept = new Map<string, Gap>();
  for (const g of [...a, ...b]) {
    const prior = byConcept.get(g.conceptId);
    if (!prior || g.priority > prior.priority) byConcept.set(g.conceptId, g);
  }
  return [...byConcept.values()];
}

/**
 * MAINTENANCE IS SCOPED TO WHAT THE CURRENT GOALS DEPEND ON, and that bound is
 * a design decision rather than a performance one. The substrate holds ~123
 * records, most of them quantum knowledge with `event_driven` volatility, which
 * `decay.ts` treats as stale from the moment it is written. Re-verifying all of
 * them would put a hundred objectives in the backlog on the first cycle and
 * leave `maxBacklog` doing the policy work — a bound silently deciding what
 * ONIQ cares about. So only subjects the standing goal or the current focus
 * actually name earn a maintenance objective; the rest stay stale and visible
 * in the metrics rather than queued.
 */
export function staleSubjectsFor(
  records: readonly KnowledgeRecord[],
  nowMs: number,
  goals: readonly Goal[],
): StaleSubject[] {
  const wanted = new Map<string, number>();
  for (const g of goals) {
    for (const r of g.requires) {
      wanted.set(r.conceptId, Math.max(wanted.get(r.conceptId) ?? 0, r.importance));
    }
  }
  const worst = new Map<string, { demand: number; reason: string }>();
  for (const r of records) {
    if (!wanted.has(r.subject)) continue;
    const f = freshness(r, nowMs);
    if (!f.stale) continue;
    const demand = f.ageMs === null || f.intervalMs === 0 ? 1 : Math.min(1, f.ageMs / f.intervalMs);
    const prior = worst.get(r.subject);
    if (!prior || demand > prior.demand) worst.set(r.subject, { demand, reason: f.reason });
  }
  return [...worst.entries()]
    .map(([conceptId, w]) => ({
      conceptId,
      importance: wanted.get(conceptId)!,
      demand: w.demand,
      reason: w.reason,
    }))
    .sort((a, b) => a.conceptId.localeCompare(b.conceptId));
}

/**
 * The survey: rebuild the tick's knowledge and report what is open.
 *
 * IT SURVEYS THE STANDING GOAL **AND** THE FOCUS, not one or the other. Only
 * the focus and the runtime narrows onto whatever it happened to pick and
 * forgets the domain; only the standing goal and it can never pursue a
 * sub-question it raised itself. Relevance-to-focus is what re-ranks them, and
 * that is the learning selector's job rather than the survey's.
 *
 * IT NEVER REFUSES, and that is worth stating because `SurveyResult` is a union
 * precisely so a refusal is sayable: this survey reads a store it builds
 * itself, so there is no outage it could be reporting. A survey over something
 * ONIQ does not own — a live queue, a runner health endpoint — is the one that
 * will need the other arm, and the type is ready for it.
 */
export function makeSubstrateSurvey(ctx: SubstrateContext): Survey {
  return async (cycle: CycleContext) => {
    const nowMs = ctx.nowMs();
    const build = buildSubstrate({
      at: ctx.at(),
      nowMs,
      resolved: ctx.resolved,
      elapsedMs: ctx.elapsedMs,
    });
    const goals = cycle.focus ? [STANDING_GOAL, cycle.focus] : [STANDING_GOAL];
    const gaps = openGaps(
      mergeGaps(
        detectGaps(STANDING_GOAL, build.state),
        cycle.focus ? detectGaps(cycle.focus, build.state) : [],
      ),
    );
    return {
      ok: true as const,
      gaps,
      knowledge: build.state,
      stale: staleSubjectsFor(build.store.all(), nowMs, goals),
      staleness: stalenessByConcept(build.store.all(), nowMs),
    };
  };
}

/**
 * The initial state for an objective that is not the dispatch job.
 *
 * THE WORLD NAMES THE ACTIONS THAT WOULD HELP AS **UNAVAILABLE** RATHER THAN
 * OFFERING THEM. `WorldState` asks for both lists and section 7 means it: a
 * world that offered `research runner-availability` as an available action
 * would have the loop plan it, call a router that has no such tool, and report
 * a tool failure — which reads as a broken integration. What is true is that
 * ONIQ has no research capability at all, and the world model is the right
 * place to say so.
 *
 * The basis is the goal's own required concepts — hypotheses about WHICH thing
 * to establish. All one category, which is what v1.4-R found matters: ranking
 * prerequisites against actions is a category error that ties forever.
 */
export function objectiveState(goal: Goal, budgets: Budgets): LoopState {
  const basis = goal.requires.map((r) => r.conceptId);
  return sealLoopState({
    parentStateId: null,
    goal,
    percepts: [],
    failures: [],
    activeHypotheses: basis,
    worldState: {
      ...EMPTY_WORLD,
      unavailableActions: basis.map((c) => `research ${c}`),
    },
    evidenceIds: [],
    knowledgeGaps: [],
    candidatePlans: [],
    selectedPlan: null,
    futures: [],
    predictions: [],
    outcomes: [],
    verification: null,
    memoryRefs: [],
    quantumState: CognitiveState.fromWeights(
      basis.length > 0 ? basis : ["nothing-required"],
      (basis.length > 0 ? basis : ["nothing-required"]).map(() => 1),
      { ...ROOT_CONTEXT, contextId: "oqca-autonomy" },
    ).snapshot(),
    iteration: 0,
    budgets,
    spent: NO_SPEND,
    status: "running",
    createdAt: 0,
  });
}

/**
 * An episode: run the REAL 23 stations over the objective's own goal against
 * the substrate the tick just built, and report what it could and could not
 * settle.
 *
 * SUCCESS IS MEASURED FROM THE KNOWLEDGE, NOT FROM THE LOOP'S TERMINAL STATUS.
 * A loop can end `budget_exhausted` having established everything the objective
 * wanted, and it can end `success` having established nothing — the status is
 * about the RUN, and the objective is about the WORLD. So the verdict is
 * `openGaps(detectGaps(goal, state))`: empty means the objective's own concepts
 * are VERIFIED, which is what the objective asked for, and anything else names
 * the concepts that are still open and becomes `blockedOn`.
 *
 * AND THIS EPISODE LEARNS NOTHING, WHICH IS REPORTED RATHER THAN HIDDEN.
 * `buildSubstrate` re-ingests every record deterministically on every tick, so
 * the store an episode sees at its end is the store it saw at its start: there
 * is no write-back, and there cannot be one until ONIQ has a durable knowledge
 * table — `substrateGap()` in its own words. So `learned` is EMPTY, always, and
 * `settled` carries what the objective asked for and now holds. The first
 * version reported `settled` AS `learned`, which made a run that confirmed two
 * already-known facts announce that it had learned them. A metric that reads as
 * progress and is really a restatement of the starting position is worse than
 * no metric, and only running the thing showed it.
 */
export function makeLoopEpisode(
  ctx: SubstrateContext,
  budgets: Budgets = DEFAULT_BUDGETS,
): RunEpisode {
  return async (objective: Objective, _cycle: CycleContext): Promise<EpisodeOutcome> => {
    const nowMs = ctx.nowMs();
    const build: SubstrateBuild = buildSubstrate({
      at: ctx.at(),
      nowMs,
      resolved: ctx.resolved,
      elapsedMs: ctx.elapsedMs,
    });
    const goal = objective.goal;
    const initial = objectiveState(goal, budgets);

    const run = await runCognitiveLoop({
      initial,
      quantum: CognitiveState.restore(initial.quantumState),
      knowledge: build.state,
      budgets,
    });

    const still = openGaps(detectGaps(goal, build.state));
    const settled = goal.requires
      .map((r) => r.conceptId)
      .filter((c) => !still.some((g) => g.conceptId === c));

    /**
     * v1.6 — THE LOOP'S OWN CAPABILITY LEDGER, PASSED THROUGH UNCHANGED. The
     * episode does not re-derive who was refused: `runCognitiveLoop` recorded
     * it at each station's own gate, and re-deriving a policy beside the policy
     * is a mistake this repo has a receipt for. Every state in it, refused AND
     * working, so the runtime can tell "not observed" from "available".
     */
    const capabilities = run.capabilities;
    const blockedByCapability = unavailable(capabilities);

    if (still.length === 0) {
      return {
        status: "success",
        note:
          `every concept ${goal.id} requires was ALREADY VERIFIED in the substrate ` +
          `(loop ${run.terminated}); nothing was written back, so nothing was learned`,
        blockedOn: [],
        blockedReason: null,
        capabilities,
        settled,
        learned: [],
        /**
         * v1.7 — NOTHING WAS WRITTEN AND NOTHING WAS COMPARED, said out loud.
         * This episode has no durable store and runs no experiment; reporting
         * `[]` and `null` is the same discipline as `learned: []` above, and it
         * is what keeps `selfEvaluate` answering "did my knowledge change" with
         * a measured `no` rather than an `unestablished` it had to guess.
         * `makeImprovementEpisode` in `improvement.ts` is the one that does.
         */
        persisted: [],
        experiment: null,
      };
    }
    /**
     * WHICH BLOCKER IS NAMED DEPENDS ON WHY THE LOOP STOPPED, and getting this
     * backwards is the whole bug this version removes. A loop that ran out of
     * MODEL — the zero-token default — did not fail to understand the concepts;
     * it never got to try. Reporting that as a knowledge gap would spawn a
     * follow-up objective to research a concept whose only problem is that
     * nobody could afford to think about it, and the follow-up would block the
     * same way, forever. So when a capability was refused, the concepts are
     * reported as still-open (which they are) and the BLOCKER is the resource.
     */
    const note =
      blockedByCapability.length > 0
        ? `${still.length} of ${goal.requires.length} concepts still open: the loop could not use ` +
          blockedByCapability.map((c) => `${c.capability} (${c.availability})`).join(", ")
        : `${still.length} of ${goal.requires.length} concepts still open after the loop (${run.terminated})`;
    return {
      status: "blocked",
      note,
      blockedOn: still.map((g) => g.conceptId),
      blockedReason:
        blockedByCapability.length > 0
          ? blockedByCapability.map((c) => `${c.capability}: ${c.detail}`).join("; ")
          : still.map((g) => `${g.conceptId}: ${g.reason}`).join("; "),
      capabilities,
      settled,
      learned: [],
      persisted: [],
      experiment: null,
    };
  };
}

/**
 * A checkpoint store over a caller-supplied sink — a directory for a script, a
 * table for a server, nothing at all for an edge function.
 *
 * A RESTORED SNAPSHOT IS RE-VALIDATED HERE AS WELL AS IN THE KERNEL, and the
 * duplication is deliberate: this side can tell the difference between "the
 * sink held nothing" and "the sink held something this version cannot read",
 * and silently starting fresh on the second would lose an entire backlog with
 * no line anywhere saying it happened.
 */
export type SnapshotSink = {
  readonly write: (json: string) => Promise<boolean>;
  readonly read: () => Promise<string | null>;
  readonly note?: (message: string) => void;
};

export function makeSinkCheckpointStore(sink: SnapshotSink): CheckpointStore {
  return {
    checkpoint: async (snapshot: RuntimeSnapshot) => sink.write(JSON.stringify(snapshot)),
    restore: async () => {
      const raw = await sink.read();
      if (raw === null) return null;
      let parsed: RuntimeSnapshot;
      try {
        parsed = JSON.parse(raw) as RuntimeSnapshot;
      } catch {
        sink.note?.("checkpoint could not be parsed; starting from an empty runtime");
        return null;
      }
      const problems = validateSnapshot(parsed);
      if (problems.length > 0) {
        sink.note?.(
          `checkpoint refused (expected version ${SNAPSHOT_VERSION}): ` +
            problems.map((p) => `${p.code} ${p.detail}`).join(", "),
        );
        return null;
      }
      return parsed;
    },
  };
}

/** What a durable, cross-process autonomous runtime still lacks. */
export function autonomyGap(): string {
  return (
    "the runtime has no server: nothing hosts the lifecycle, and its checkpoints " +
    "live wherever the caller's sink puts them rather than in a table"
  );
}
