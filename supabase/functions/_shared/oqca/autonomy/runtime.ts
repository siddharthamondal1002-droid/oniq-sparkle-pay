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
  type Capability,
  type CapabilityState,
  AVAILABILITIES,
  CAPABILITIES,
  capabilityList,
  isExecutable,
  unavailable,
} from "../loop/capability.ts";
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
   * v1.6 — EVERY CAPABILITY THIS EPISODE OBSERVED, refused AND working, and the
   * distinction between "absent" and "available" is the whole reason it is the
   * full list rather than the refused subset.
   *
   * `blockedOn` names CONCEPTS the episode could not settle: a knowledge gap,
   * and a follow-up objective can go and close it. This names CAPABILITIES —
   * a credential, a provider, a rate limit, an allowance. No follow-up can
   * close one of those (there is nothing to research about a missing key), so
   * the two never share a field; what a capability blocker earns instead is a
   * dependency the backlog remembers and a RECONSIDERATION when the capability
   * is next observed working.
   *
   * That reconsideration needs a POSITIVE observation, which is why reporting
   * only the refusals would not do. An episode that never called the model has
   * observed nothing about the model, and reading its silence as "available"
   * would reawaken every objective on every cycle. Absent means not observed —
   * the same union-not-an-array rule `SurveyResult` and `ResearchResult` both
   * carry, in a third place.
   */
  readonly capabilities: readonly CapabilityState[];
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
  capabilities: [],
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
  /** What this episode could and could not use. Resource accounting, audited. */
  readonly capabilities: readonly CapabilityState[];
  /** Objectives this episode returned to `pending` because a capability came back. */
  readonly reconsidered: readonly string[];
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
  /**
   * THE LAST OBSERVED STATE OF EVERY CONSEQUENTIAL CAPABILITY, and it is what
   * makes a blocked objective recoverable across a process boundary rather than
   * only within one invocation. Persisted, so a runtime that comes back after a
   * credential is restored can tell that something changed.
   */
  readonly capabilities: readonly CapabilityState[];
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

export type RuntimeStop =
  | "idle"
  | "blind"
  | "stalled"
  /**
   * v1.6 — A FOURTH WAY TO HAVE NOTHING RUNNABLE, AND IT IS THE ONE THE OWNER
   * ASKED FOR BY NAME. The work exists, the reasoning is sound, and every
   * remaining objective is waiting on a resource: a credential, a provider, a
   * rate limit, an allowance. It is NOT `stalled` — a stall is cognitive and
   * nothing outside can fix it, while this names a thing somebody can go and
   * turn on, and the backlog is preserved so it resumes when they do.
   */
  | "capability_blocked"
  | "max_episodes"
  | "max_wall_ms"
  | "halted";

export const RUNTIME_STOPS: readonly RuntimeStop[] = [
  "idle",
  "blind",
  "stalled",
  "capability_blocked",
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
  /** The runtime's view of every capability at the end. Observable, auditable. */
  readonly capabilities: readonly CapabilityState[];
  /** How many episodes ended waiting on a resource rather than on knowledge. */
  readonly capabilityBlocks: number;
};

export function emptySnapshot(): RuntimeSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    episode: 0,
    step: 0,
    backlog: [],
    history: [],
    focus: null,
    capabilities: [],
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
  // A capability row restored from disk decides whether a blocked objective is
  // reconsidered, so an unrecognised name in it is a silent behaviour change
  // rather than a cosmetic one: an availability this build does not know would
  // never equal "available" and the objective would wait forever.
  for (const c of [...s.capabilities, ...s.backlog.flatMap((o) => o.blockedCapabilities)]) {
    if (!CAPABILITIES.includes(c.capability)) {
      problems.push({ code: "unknown_capability", detail: String(c.capability) });
    }
    if (!AVAILABILITIES.includes(c.availability)) {
      problems.push({ code: "unknown_availability", detail: String(c.availability) });
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

/**
 * THE RUNTIME'S LEDGER TAKES THE LATEST OBSERVATION, WHICH IS THE OPPOSITE OF
 * THE RULE INSIDE ONE RUN — and the two are opposite on purpose.
 *
 * `recordCapability` keeps the FIRST refusal for the length of a run, because a
 * run that was refused once did less than a run that was not, and the receipt
 * has to say so. Across CYCLES the question is different: is this capability
 * usable NOW? A ledger that preserved a refusal forever could never observe a
 * credential coming back, so requirement 8 — "when the capability later becomes
 * available, the blocked objective can be reconsidered" — would be unreachable
 * by construction. Hence `set`, not `recordCapability`, and this comment rather
 * than a reader assuming one of the two is a mistake.
 *
 * A capability the episode did not observe is left ALONE rather than cleared:
 * silence is not evidence, and clearing on silence would reawaken everything
 * every cycle.
 */
export function observeCapabilities(
  ledger: ReadonlyMap<Capability, CapabilityState>,
  observed: readonly CapabilityState[],
): Map<Capability, CapabilityState> {
  const out = new Map(ledger);
  for (const c of observed) out.set(c.capability, c);
  return out;
}

/**
 * Return capability-blocked objectives to `pending` once every capability they
 * named is observed working again. The runtime's half of requirement 5.
 *
 * IT IS THE MIRROR OF `reawaken`, AND IT IS A SEPARATE FUNCTION BECAUSE THE
 * TRIGGER IS DIFFERENT. `reawaken` fires when a follow-up objective completes —
 * a thing ONIQ did. This fires when the world changed underneath it, which no
 * objective completing can signal. `MAX_ATTEMPTS` bounds both identically, so a
 * capability that flaps cannot revive the same objective forever.
 *
 * An objective naming a capability the ledger has NEVER observed stays blocked.
 * That is the same "absent is not available" rule as the outcome field: an
 * unobserved capability is unknown, and reawakening on unknown would spin.
 */
export function reconsider(
  backlog: readonly Objective[],
  ledger: ReadonlyMap<Capability, CapabilityState>,
): Objective[] {
  return backlog.map((o) => {
    if (o.status !== "blocked" || o.blockedCapabilities.length === 0) return o;
    const back = o.blockedCapabilities.every((c) => {
      const now = ledger.get(c.capability);
      return now !== undefined && isExecutable(now.availability);
    });
    if (!back) return o;
    if (o.attempts >= MAX_ATTEMPTS) {
      return { ...o, status: "abandoned" as const, blockedReason: "attempts exhausted" };
    }
    return { ...o, status: "pending" as const, blockedCapabilities: [] };
  });
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
  /**
   * COUNTED APART FROM `consecutiveBlocked`, because the two mean different
   * things to whoever reads the stop. A cognitive stall is ONIQ having run out
   * of ways to make progress; a run of capability blocks is a resource nobody
   * turned on, and it names a thing a person can go and fix. Collapsing them
   * would report "stalled" for a missing credential — the exact "resource
   * unavailability read as cognitive death" this version exists to remove.
   */
  let consecutiveCapabilityBlocked = 0;
  let capabilityBlocks = 0;
  let capabilities: ReadonlyMap<Capability, CapabilityState> = new Map(
    snapshot.capabilities.map((c) => [c.capability, c] as const),
  );
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
    /**
     * RECONSIDER BEFORE SELECTING, EVERY CYCLE, INCLUDING THE FIRST. The ledger
     * is restored from the snapshot, so a runtime that comes back after somebody
     * raised an allowance finds its blocked work runnable on its very first
     * pass — which is the only shape in which "return to it later" survives the
     * process ending. Doing it after selection would leave a reconsidered
     * objective waiting a whole extra cycle for no reason.
     */
    let backlog = reconsider(snapshot.backlog, capabilities);
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
      const waiting = stuck.filter((o) => o.blockedCapabilities.length > 0);
      if (stuck.length > 0 && waiting.length === stuck.length) {
        /**
         * v1.6 — EVERY REMAINING OBJECTIVE IS WAITING ON A RESOURCE, which is
         * not a stall. The reasoning is sound and the backlog is intact; what
         * is missing is a credential, a provider, a quota or an allowance, and
         * naming it is what tells a person there is something to go and turn
         * on. The objectives and their dependencies are preserved in the
         * snapshot, so the next invocation reconsiders them for free.
         */
        stop = "capability_blocked";
        stopDetail =
          `nothing is pending: ${stuck.length} objective(s) are waiting on a capability — ` +
          waiting
            .map(
              (o) =>
                `${o.goal.id} (${o.blockedCapabilities
                  .map((c) => `${c.capability}:${c.availability}`)
                  .join(", ")})`,
            )
            .join("; ");
      } else if (stuck.length > 0) {
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
      snapshot = { ...snapshot, backlog, history, capabilities: capabilityList(capabilities) };
      break;
    }

    // ---- RUN ------------------------------------------------------------
    backlog = replace(backlog, { ...chosen, status: "active" });
    const outcome = await runEpisode(chosen, ctx);
    let followUpId: string | null = null;
    let reawakened: readonly string[] = [];
    const step = snapshot.step + 1;

    // Resource accounting, before anything is decided about the outcome: what
    // the episode could and could not use is a fact about the run either way,
    // and requirement 6 asks for it to stay observable whatever happened next.
    capabilities = observeCapabilities(capabilities, outcome.capabilities);
    const refused = unavailable(outcome.capabilities);
    if (refused.length > 0) capabilityBlocks += 1;

    /**
     * A CAPABILITY THAT CAME BACK RELEASES ITS WAITERS IN THE SAME CYCLE IT WAS
     * OBSERVED. Waiting until the next pass would be correct and slower, and
     * would make a single-episode invocation — which is what a cron tick is —
     * never reconsider anything at all.
     */
    const beforeReconsider = new Set(
      backlog.filter((o) => o.status === "blocked").map((o) => o.id),
    );
    backlog = reconsider(backlog, capabilities);
    const reconsidered = backlog
      .filter((o) => beforeReconsider.has(o.id) && o.status !== "blocked")
      .map((o) => o.id);

    if (outcome.status === "success") {
      const done: Objective = { ...chosen, status: "done", attempts: chosen.attempts + 1 };
      backlog = replace(backlog, done);
      const wasBlocked = new Set(backlog.filter((o) => o.status === "blocked").map((o) => o.id));
      backlog = reawaken(backlog, done.id);
      reawakened = backlog
        .filter((o) => wasBlocked.has(o.id) && o.status !== "blocked")
        .map((o) => o.id);
      consecutiveBlocked = 0;
      consecutiveCapabilityBlocked = 0;
    } else if (outcome.status === "blocked") {
      const blocked: Objective = {
        ...chosen,
        status: "blocked",
        attempts: chosen.attempts + 1,
        blockedReason: outcome.blockedReason,
        blockedOn: outcome.blockedOn,
        /**
         * THE DEPENDENCY IS PRESERVED ON THE OBJECTIVE, not merely counted.
         * `reconsider` reads exactly this list, and the snapshot carries it, so
         * "return to it later" holds across a process boundary rather than only
         * within one invocation — requirement 5.
         */
        blockedCapabilities: refused,
      };
      backlog = replace(backlog, blocked);
      // A capability blocker earns NO follow-up: `followUpFor` reads `blockedOn`
      // and a resource block names no concept, so the refusal is structural
      // rather than a special case here. See its header.
      const follow = followUpFor(blocked, step);
      if (follow) {
        backlog = trimBacklog(mergeBacklog(backlog, [follow]), bounds.maxBacklog);
        followUpId = follow.id;
      }
      consecutiveBlocked += 1;
      consecutiveCapabilityBlocked = refused.length > 0 ? consecutiveCapabilityBlocked + 1 : 0;
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
      consecutiveCapabilityBlocked = 0;
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
      capabilities: outcome.capabilities,
      reconsidered,
    });

    snapshot = {
      version: SNAPSHOT_VERSION,
      episode: snapshot.episode + 1,
      step,
      backlog,
      history,
      focus: chosen.goal,
      capabilities: capabilityList(capabilities),
      stop: null,
    };

    // ---- CHECKPOINT -----------------------------------------------------
    checkpointAttempts += 1;
    if (await store.checkpoint(snapshot)) checkpoints += 1;

    if (consecutiveCapabilityBlocked >= bounds.maxConsecutiveBlocked) {
      /**
       * CHECKED BEFORE THE STALL, AND IT IS NOT THE SAME STOP. Every one of
       * those blocks named a resource, so the runtime is not out of ideas — it
       * is waiting on something outside itself, the backlog is intact, and the
       * next invocation reconsiders it the moment the resource returns. Calling
       * that a stall is what "budget = 0 means the runtime stopped" looked like
       * from the outside.
       */
      stop = "capability_blocked";
      stopDetail =
        `${consecutiveCapabilityBlocked} objectives in a row are waiting on a capability: ` +
        unavailable(capabilityList(capabilities))
          .map((c) => `${c.capability}:${c.availability} (${c.detail})`)
          .join("; ");
    } else if (consecutiveBlocked >= bounds.maxConsecutiveBlocked) {
      stop = "stalled";
      stopDetail = `${consecutiveBlocked} objectives blocked in a row`;
    }
  }

  const final: RuntimeSnapshot = {
    ...snapshot,
    history,
    capabilities: capabilityList(capabilities),
    stop,
  };
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
    capabilities: capabilityList(capabilities),
    capabilityBlocks,
  };
}
