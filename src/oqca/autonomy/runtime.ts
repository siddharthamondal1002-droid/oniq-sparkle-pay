/**
 * OQCA v1.5 — THE CONTINUOUS COGNITIVE LIFECYCLE. Owner directive 2026-09-10,
 * called "the biggest reachability test": server starts -> restore cognitive
 * state -> start autonomous runtime -> run episode -> checkpoint -> select the
 * next objective -> continue. "No user request should be required to initiate
 * the next cognitive episode."
 *
 * A BLOCKED EPISODE ENDS AN OBJECTIVE, NEVER THE RUNTIME, and that is the
 * owner's own sentence made executable: "Blocked on one objective != cognitively
 * dead. It should recover, reprioritize, and continue learning elsewhere." So
 * `blocked` marks the objective, spawns a follow-up when the blocker was named,
 * and falls through to the next selection. The only thing that stops on
 * blocking is a RUN of them — `maxConsecutiveBlocked` — because every objective
 * blocking in a row is a stall and pretending otherwise would produce a runtime
 * that looks busy and learns nothing.
 *
 * THREE WAYS TO HAVE NOTHING TO DO, AND THEY ARE NOT THE SAME THING:
 *
 *   idle      the backlog is empty and the survey found nothing open
 *   blind     the survey REFUSED — the runtime cannot see, so it cannot choose
 *   stalled   there was work and every attempt at it blocked
 *
 * Collapsing them is the failure this file is most careful about. "Nothing to
 * learn" and "I cannot look" are opposite states that an empty list reports
 * identically, which is exactly why `ResearchAdapter` returns a union rather
 * than an array and why `SurveyResult` copies that shape. A blind runtime that
 * reported `idle` would be a system announcing that it knows everything.
 *
 * BLINDNESS STOPS GENERATION, NOT EXECUTION. A refused survey means no NEW
 * objectives this cycle; it does not mean the backlog is unrunnable. Stopping
 * outright on the first refusal would throw away work already queued — the same
 * mistake in miniature as ending the runtime on one blocked objective.
 *
 * THE BOUNDS HERE ARE RUNAWAY GUARDS AND ARE NOT ZERO. Read that carefully
 * against `DEFAULT_BUDGETS`, whose `maxToolCalls`, `maxTokens` and `maxCostUsd`
 * all ship at 0 because what a run may SPEND is the owner's decision. These
 * bound how long a lifecycle may go round, which is the `maxExecutionTimeMs`
 * case: a zero there does not fail closed, it fails DEAD, and a default nobody
 * can run is a default somebody raises wholesale, taking the money bounds with
 * it. Nothing in this file can spend anything — the episode seam does, and it
 * carries the budgets.
 *
 * NOTHING HERE READS A CLOCK OF ITS OWN, opens a socket, or touches a disk. The
 * survey, the episode, the checkpoint store and the clock are all arguments
 * with refusing defaults, and `security.test.ts` walks this directory.
 */
import type { Gap, Goal } from "../knowledge/gaps.ts";
import type { KnowledgeState } from "../knowledge/model.ts";
import { type Clock, deterministicClock } from "../loop/seams.ts";
import {
  type Objective,
  type ObjectiveSource,
  type StaleSubject,
  MAX_ATTEMPTS,
  followUpFor,
  generateObjectives,
  mergeBacklog,
  selectObjective,
} from "./objective.ts";
import { type LearningTarget, rankLearningTargets } from "./select.ts";

/**
 * What the runtime can see this cycle, or why it cannot. A UNION and not an
 * array — see the header, and `ResearchResult`, which refuses for exactly this
 * reason rather than answering "no findings".
 */
export type SurveyResult =
  | {
      readonly ok: true;
      readonly gaps: readonly Gap[];
      readonly knowledge: KnowledgeState;
      readonly stale: readonly StaleSubject[];
      readonly staleness?: ReadonlyMap<string, number>;
    }
  | { readonly ok: false; readonly reason: string };

export type CycleContext = {
  readonly episode: number;
  readonly step: number;
  readonly focus: Goal | null;
};

export type Survey = (ctx: CycleContext) => Promise<SurveyResult>;

/** Refuses, and says why. It does NOT answer "nothing is open". */
export const NO_SURVEY: Survey = async () => ({
  ok: false,
  reason: "no survey capability is wired to this runtime",
});

export type EpisodeStatus = "success" | "blocked" | "failure";

export type EpisodeOutcome = {
  readonly status: EpisodeStatus;
  readonly note: string;
  /** The concept ids the episode could not resolve. A follow-up needs these. */
  readonly blockedOn: readonly string[];
  readonly blockedReason: string | null;
  /**
   * TWO DIFFERENT CLAIMS, AND COLLAPSING THEM WAS A REAL OVER-CLAIM CAUGHT BY
   * RUNNING THIS. `settled` is what the objective asked for and now holds;
   * `learned` is what THIS EPISODE moved. The first version reported the
   * objective's verified concepts as `learned`, so a run that confirmed two
   * things ONIQ already knew announced that it had learned them — which is the
   * `documents.extract` shape from the other side: a count that reads as
   * progress and is really a restatement of the starting position.
   */
  readonly settled: readonly string[];
  /** Concept ids this episode MOVED. Reported, never inferred from `status`. */
  readonly learned: readonly string[];
};

export type RunEpisode = (objective: Objective, ctx: CycleContext) => Promise<EpisodeOutcome>;

/**
 * BLOCKS RATHER THAN THROWS, and names nothing.
 *
 * A throw would abort the lifecycle, which is precisely the behaviour this
 * version exists to remove; and blocking with an EMPTY `blockedOn` is
 * self-consistent — there is no blocker to name, so no follow-up is spawned and
 * the runtime stalls honestly after `maxConsecutiveBlocked` rather than
 * generating objectives about a fault it invented.
 */
export const REFUSING_EPISODE: RunEpisode = async () => ({
  status: "blocked",
  note: "no episode runner is wired to this runtime",
  blockedOn: [],
  blockedReason: "no episode runner",
  settled: [],
  learned: [],
});

export const SNAPSHOT_VERSION = 1;

export type EpisodeRecord = {
  readonly episode: number;
  readonly objectiveId: string;
  readonly goalId: string;
  readonly source: ObjectiveSource;
  readonly status: EpisodeStatus;
  readonly note: string;
  readonly followUpId: string | null;
  readonly reawakened: readonly string[];
  readonly settled: readonly string[];
  readonly learned: readonly string[];
};

export type RuntimeSnapshot = {
  readonly version: number;
  readonly episode: number;
  /** The LOGICAL step objectives are stamped with. Never a wall clock. */
  readonly step: number;
  readonly backlog: readonly Objective[];
  readonly history: readonly EpisodeRecord[];
  /** What the last episode worked on — the relevance signal for the next one. */
  readonly focus: Goal | null;
  readonly stop: RuntimeStop | null;
};

export type CheckpointStore = {
  readonly checkpoint: (snapshot: RuntimeSnapshot) => Promise<boolean>;
  readonly restore: () => Promise<RuntimeSnapshot | null>;
};

/**
 * Stores nothing and SAYS SO. `checkpoint` returns false because a no-op that
 * resolves is indistinguishable from a write — `persist` and `consolidate`
 * carry the same rule, and this repo has the receipt for what believing a
 * silent no-op costs.
 */
export const NO_CHECKPOINTS: CheckpointStore = {
  checkpoint: async () => false,
  restore: async () => null,
};

export type RuntimeStop = "idle" | "blind" | "stalled" | "max_episodes" | "max_wall_ms" | "halted";

export const RUNTIME_STOPS: readonly RuntimeStop[] = [
  "idle",
  "blind",
  "stalled",
  "max_episodes",
  "max_wall_ms",
  "halted",
];

export type RuntimeBounds = {
  readonly maxEpisodes: number;
  readonly maxConsecutiveBlocked: number;
  readonly maxBacklog: number;
  readonly maxWallMs: number;
};

/** Runaway guards, not spend. See the header. */
export const DEFAULT_RUNTIME_BOUNDS: RuntimeBounds = {
  maxEpisodes: 8,
  maxConsecutiveBlocked: 3,
  maxBacklog: 64,
  maxWallMs: 60_000,
};

export type RuntimeInput = {
  readonly survey?: Survey;
  readonly runEpisode?: RunEpisode;
  readonly store?: CheckpointStore;
  readonly clock?: Clock;
  readonly bounds?: RuntimeBounds;
  /** User requests. The generator provably cannot produce these. */
  readonly seed?: readonly Objective[];
  /** Used only when the store restored nothing. */
  readonly initial?: RuntimeSnapshot;
};

export type RuntimeReport = {
  readonly episodes: number;
  readonly stop: RuntimeStop;
  readonly stopDetail: string;
  readonly snapshot: RuntimeSnapshot;
  readonly history: readonly EpisodeRecord[];
  /**
   * How many checkpoints the store DURABLY took, read from its own answer and
   * never from the number of attempts — a store that writes nothing reports 0
   * and cannot be mistaken for one that works.
   */
  readonly checkpoints: number;
  readonly checkpointAttempts: number;
  readonly restored: boolean;
  readonly generated: number;
  readonly surveyRefusals: number;
  readonly settled: readonly string[];
  readonly learned: readonly string[];
};

export function emptySnapshot(): RuntimeSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    episode: 0,
    step: 0,
    backlog: [],
    history: [],
    focus: null,
    stop: null,
  };
}

export type SnapshotProblem = { readonly code: string; readonly detail: string };

/**
 * A RESTORED SNAPSHOT IS NOT TRUSTED. It came off a disk, a table or another
 * process, and a shape from a future version read as this one would lose fields
 * silently — the backlog would come back missing its attempt counts and every
 * bound that rests on them would be off. So the version is checked rather than
 * assumed, and a mismatch is refused rather than migrated: a migration nobody
 * wrote is a guess about what the other version meant.
 */
export function validateSnapshot(s: RuntimeSnapshot): readonly SnapshotProblem[] {
  const problems: SnapshotProblem[] = [];
  if (s.version !== SNAPSHOT_VERSION) {
    problems.push({ code: "version_mismatch", detail: `${s.version} != ${SNAPSHOT_VERSION}` });
  }
  if (!Number.isInteger(s.episode) || s.episode < 0) {
    problems.push({ code: "bad_episode", detail: String(s.episode) });
  }
  if (!Number.isInteger(s.step) || s.step < 0) {
    problems.push({ code: "bad_step", detail: String(s.step) });
  }
  const ids = new Set<string>();
  for (const o of s.backlog) {
    if (ids.has(o.id)) problems.push({ code: "duplicate_objective", detail: o.id });
    ids.add(o.id);
  }
  for (const o of s.backlog) {
    if (o.parentId !== null && !ids.has(o.parentId)) {
      problems.push({ code: "orphan_follow_up", detail: `${o.id} -> ${o.parentId}` });
    }
  }
  return problems;
}

/** Keep the backlog bounded by dropping the least promising PENDING work. */
function trimBacklog(backlog: readonly Objective[], max: number): Objective[] {
  if (backlog.length <= max) return [...backlog];
  // Anything not pending carries history — an attempt count, a blocker, a
  // completion — and dropping it would make the runtime forget what it already
  // tried. Only pending objectives, which carry nothing yet, are droppable.
  const keep = backlog.filter((o) => o.status !== "pending");
  const droppable = backlog
    .filter((o) => o.status === "pending")
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return [...keep, ...droppable.slice(0, Math.max(0, max - keep.length))];
}

/**
 * A completed objective releases whatever was waiting on it.
 *
 * This is the half that makes `blocked` a recoverable state rather than a
 * graveyard: the follow-up finishes, its parent goes back to `pending`, and the
 * thing that could not be done becomes doable. `MAX_ATTEMPTS` is what stops
 * that from being a loop — a parent that has already spent its attempts is
 * ABANDONED here rather than reawakened, so a blocker that clears repeatedly
 * cannot revive the same objective forever.
 */
export function reawaken(backlog: readonly Objective[], completedId: string): Objective[] {
  return backlog.map((o) => {
    if (o.status !== "blocked") return o;
    const child = backlog.find((c) => c.parentId === o.id && c.id === completedId);
    if (!child) return o;
    if (o.attempts >= MAX_ATTEMPTS) {
      return { ...o, status: "abandoned" as const, blockedReason: "attempts exhausted" };
    }
    return { ...o, status: "pending" as const };
  });
}

function replace(backlog: readonly Objective[], next: Objective): Objective[] {
  return backlog.map((o) => (o.id === next.id ? next : o));
}

export async function runAutonomousRuntime(input: RuntimeInput): Promise<RuntimeReport> {
  const survey = input.survey ?? NO_SURVEY;
  const runEpisode = input.runEpisode ?? REFUSING_EPISODE;
  const store = input.store ?? NO_CHECKPOINTS;
  const clock = input.clock ?? deterministicClock();
  const bounds = input.bounds ?? DEFAULT_RUNTIME_BOUNDS;

  const loaded = await store.restore();
  const restored = loaded !== null && validateSnapshot(loaded).length === 0;
  let snapshot: RuntimeSnapshot = restored ? loaded! : (input.initial ?? emptySnapshot());
  if (input.seed?.length) {
    snapshot = { ...snapshot, backlog: mergeBacklog(snapshot.backlog, input.seed) };
  }

  const started = clock();
  let checkpoints = 0;
  let checkpointAttempts = 0;
  let generated = 0;
  let surveyRefusals = 0;
  let consecutiveBlocked = 0;
  let ranHere = 0;
  const learned: string[] = [];
  const settled: string[] = [];
  const history: EpisodeRecord[] = [...snapshot.history];
  let stop: RuntimeStop | null = null;
  let stopDetail = "";

  while (stop === null) {
    /**
     * THE BOUND IS ON THIS INVOCATION; THE COUNTER IS ON THE LIFETIME. Reading
     * `snapshot.episode` here instead would make a restored runtime DEAD ON
     * ARRIVAL — the counter persists across processes, so the second process to
     * open a checkpoint that already reached the bound would stop before its
     * first episode, forever, and report `max_episodes` as though it had done
     * work. Found by running the lifecycle across two processes rather than by
     * reading it; a single-process test cannot tell the two apart.
     */
    if (ranHere >= bounds.maxEpisodes) {
      stop = "max_episodes";
      stopDetail =
        `ran ${ranHere} of ${bounds.maxEpisodes} permitted this invocation ` +
        `(${snapshot.episode} over the lifetime)`;
      break;
    }
    if (clock() - started >= bounds.maxWallMs) {
      stop = "max_wall_ms";
      stopDetail = `the lifecycle bound of ${bounds.maxWallMs}ms elapsed`;
      break;
    }

    const ctx: CycleContext = {
      episode: snapshot.episode,
      step: snapshot.step,
      focus: snapshot.focus,
    };

    // ---- SEE ------------------------------------------------------------
    const seen = await survey(ctx);
    let blindReason: string | null = null;
    let backlog = snapshot.backlog;
    if (seen.ok) {
      const targets: LearningTarget[] = rankLearningTargets({
        gaps: seen.gaps,
        knowledge: seen.knowledge,
        staleness: seen.staleness,
        focus: snapshot.focus,
      });
      const fresh = generateObjectives({
        targets,
        knowledge: seen.knowledge,
        stale: seen.stale,
        at: snapshot.step,
      });
      const before = backlog.length;
      backlog = trimBacklog(mergeBacklog(backlog, fresh), bounds.maxBacklog);
      generated += Math.max(0, backlog.length - before);
    } else {
      surveyRefusals += 1;
      blindReason = seen.reason;
    }

    // ---- CHOOSE ---------------------------------------------------------
    const chosen = selectObjective(backlog);
    if (chosen === null) {
      /**
       * THREE EMPTIES, AND THE FIRST RUN OF THIS RUNTIME REPORTED THE WRONG
       * ONE. `idle` means there is nothing to do. A backlog whose every
       * remaining objective is BLOCKED is not that — it is a stall, and it was
       * being announced as "the survey found nothing open" while an
       * unresolvable objective sat in the backlog. A system that reports having
       * nothing left to learn when it is actually stuck is the exact failure
       * the three-way split exists to prevent, and no amount of reading caught
       * it: the first live run did.
       */
      const stuck = backlog.filter((o) => o.status === "blocked");
      if (stuck.length > 0) {
        stop = "stalled";
        stopDetail =
          `nothing is pending: ${stuck.length} objective(s) remain blocked — ` +
          stuck.map((o) => `${o.goal.id} (${o.blockedReason ?? "no reason given"})`).join("; ");
      } else if (blindReason !== null) {
        // Blindness only decides WHICH empty this is. It never stops a runtime
        // that still has queued work — see the header.
        stop = "blind";
        stopDetail = `nothing is pending and the survey refused: ${blindReason}`;
      } else {
        stop = "idle";
        stopDetail = "nothing is pending and the survey found nothing open";
      }
      snapshot = { ...snapshot, backlog, history };
      break;
    }

    // ---- RUN ------------------------------------------------------------
    backlog = replace(backlog, { ...chosen, status: "active" });
    const outcome = await runEpisode(chosen, ctx);
    let followUpId: string | null = null;
    let reawakened: readonly string[] = [];
    const step = snapshot.step + 1;

    if (outcome.status === "success") {
      const done: Objective = { ...chosen, status: "done", attempts: chosen.attempts + 1 };
      backlog = replace(backlog, done);
      const wasBlocked = new Set(backlog.filter((o) => o.status === "blocked").map((o) => o.id));
      backlog = reawaken(backlog, done.id);
      reawakened = backlog
        .filter((o) => wasBlocked.has(o.id) && o.status !== "blocked")
        .map((o) => o.id);
      consecutiveBlocked = 0;
    } else if (outcome.status === "blocked") {
      const blocked: Objective = {
        ...chosen,
        status: "blocked",
        attempts: chosen.attempts + 1,
        blockedReason: outcome.blockedReason,
        blockedOn: outcome.blockedOn,
      };
      backlog = replace(backlog, blocked);
      const follow = followUpFor(blocked, step);
      if (follow) {
        backlog = trimBacklog(mergeBacklog(backlog, [follow]), bounds.maxBacklog);
        followUpId = follow.id;
      }
      consecutiveBlocked += 1;
    } else {
      const attempts = chosen.attempts + 1;
      backlog = replace(backlog, {
        ...chosen,
        attempts,
        status: attempts >= MAX_ATTEMPTS ? "abandoned" : "pending",
        blockedReason: outcome.note,
      });
      // A failure is not a block. Resetting the counter keeps `stalled` a
      // statement about blocking specifically; `maxEpisodes` bounds the rest.
      consecutiveBlocked = 0;
    }

    learned.push(...outcome.learned);
    settled.push(...outcome.settled);
    ranHere += 1;
    history.push({
      episode: snapshot.episode,
      objectiveId: chosen.id,
      goalId: chosen.goal.id,
      source: chosen.source,
      status: outcome.status,
      note: outcome.note,
      followUpId,
      reawakened,
      settled: outcome.settled,
      learned: outcome.learned,
    });

    snapshot = {
      version: SNAPSHOT_VERSION,
      episode: snapshot.episode + 1,
      step,
      backlog,
      history,
      focus: chosen.goal,
      stop: null,
    };

    // ---- CHECKPOINT -----------------------------------------------------
    checkpointAttempts += 1;
    if (await store.checkpoint(snapshot)) checkpoints += 1;

    if (consecutiveBlocked >= bounds.maxConsecutiveBlocked) {
      stop = "stalled";
      stopDetail = `${consecutiveBlocked} objectives blocked in a row`;
    }
  }

  const final: RuntimeSnapshot = { ...snapshot, history, stop };
  checkpointAttempts += 1;
  if (await store.checkpoint(final)) checkpoints += 1;

  return {
    episodes: ranHere,
    stop: stop ?? "halted",
    stopDetail: stopDetail || "the runtime was halted",
    snapshot: final,
    history,
    checkpoints,
    checkpointAttempts,
    restored,
    generated,
    surveyRefusals,
    settled,
    learned,
  };
}
