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
import { type KnowledgeState, EMPTY_KNOWLEDGE } from "../knowledge/model.ts";
import { type Clock, deterministicClock } from "../loop/seams.ts";
import {
  type Observation,
  type ObservationProvenance,
  type SystemObserver,
  NO_OBSERVER,
  completeObservations,
} from "./observation.ts";
import {
  type KnowledgeCensus,
  type SystemIdentity,
  type SystemWorldState,
  EMPTY_CENSUS,
  UNIDENTIFIED,
  buildWorldState,
} from "./world.ts";
import type { ExperimentRecord, Verdict } from "./experiment.ts";
import { type PlannedConcern, planImprovements } from "./improve.ts";
import { type SelfEvaluation, selfEvaluate } from "./selfEval.ts";
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
      /**
       * v1.7 — WHAT THE SURVEY COUNTED, including how much of it came back from
       * a DURABLE store rather than from this tick's rebuild. The world state
       * reports it and `selfEvaluate` reads it; the survey is the only thing
       * that can know, because it is the only thing that touched the substrate.
       */
      readonly census?: KnowledgeCensus;
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
  /**
   * v1.7 — THE DURABLE ROW IDS THIS EPISODE ACTUALLY WROTE, read from the
   * store's own answer and never from the number it tried to write. §8's
   * durability claim is only checkable if a claim is made, and `learned` cannot
   * carry it: a concept can move in memory and fail to persist, which is the
   * exact state a restart would then silently discard.
   *
   * REQUIRED, NOT OPTIONAL, and v1.6 has the receipt for why: a fixture ending
   * `} as EpisodeOutcome` hid a whole new field and every test ran with it
   * `undefined` until the runtime threw. An episode that persisted nothing says
   * `[]` out loud.
   */
  readonly persisted: readonly string[];
  /**
   * v1.7 §11 — THE EXPERIMENT THIS EPISODE RAN, or null because it ran none.
   * Null is not a failure and is not `INCONCLUSIVE`: it is the absence of a
   * comparison, which `selfEvaluate` answers `unestablished` rather than `no`.
   */
  readonly experiment: ExperimentRecord | null;
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
  persisted: [],
  experiment: null,
});

/**
 * BUMPED FOR v1.7, AND THE COST IS STATED RATHER THAN HIDDEN. The snapshot grew
 * three fields — baselines, the failure log and the experiment ledger — and
 * `validateSnapshot` refuses a version it does not know rather than migrating
 * it, by its own rule: "a migration nobody wrote is a guess about what the
 * other version meant". So a v1 checkpoint left by a v1.6 runtime is REFUSED
 * and that runtime starts from empty. That is the honest outcome — reading a v1
 * snapshot as v2 would hand every later reader a baseline map that is
 * `undefined`, and a baseline nobody has is exactly the thing §13 says must
 * report IMPROVEMENT_UNVERIFIED rather than be invented.
 */
export const SNAPSHOT_VERSION = 2;

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
  /** v1.7 §8 — durable row ids written. `[]` means nothing survived this episode. */
  readonly persisted: readonly string[];
  /** v1.7 §11 — the verdict, or null because no experiment ran. Never inferred. */
  readonly experimentVerdict: Verdict | null;
  /** v1.7 §19 — the eight questions, answered from THIS episode's evidence. */
  readonly selfEvaluation: SelfEvaluation | null;
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
  /**
   * v1.7 §13 — THE BEST READING ONIQ HAS EVER RECORDED FOR EACH METRIC, as
   * PAIRS rather than a Map because a snapshot is written to a file, a column
   * or another process and `JSON.stringify(new Map())` is `{}`. A baseline that
   * serialised to nothing would make every restored process measure against an
   * empty set and call every first reading an improvement.
   */
  readonly baselines: readonly (readonly [string, number])[];
  /** v1.7 §15 — what failed, oldest first, so a REPEAT is visible as a repeat. */
  readonly failureLog: readonly string[];
  /** v1.7 §11 — every experiment this lifetime has completed, with its verdict. */
  readonly experiments: readonly ExperimentRecord[];
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

/**
 * How many failure lines the snapshot carries. BOUNDED because the snapshot is
 * written on every episode and an unbounded log would grow a checkpoint file
 * without limit — the same reason the backlog is trimmed. The OLDEST are
 * dropped, so a repeat that is still happening stays visible and one that
 * stopped a hundred episodes ago falls off.
 */
export const MAX_FAILURE_LOG = 64;

/** Runaway guards, not spend. See the header. */
export const DEFAULT_RUNTIME_BOUNDS: RuntimeBounds = {
  maxEpisodes: 8,
  maxConsecutiveBlocked: 3,
  maxBacklog: 64,
  maxWallMs: 60_000,
};

export type RuntimeInput = {
  readonly survey?: Survey;
  /**
   * v1.7 §3 — ONIQ LOOKING AT ONIQ. A seam with a REFUSING default, like every
   * other: a runtime with no observer reports every kind UNOBSERVED and
   * generates "connect an observer" objectives, which is the correct behaviour
   * and is not the same as reporting a healthy system.
   */
  readonly observe?: SystemObserver;
  readonly runEpisode?: RunEpisode;
  readonly store?: CheckpointStore;
  readonly clock?: Clock;
  readonly bounds?: RuntimeBounds;
  /** What ONIQ says it is. The host establishes it; `commit` may be null. */
  readonly identity?: SystemIdentity;
  /** Where the host READ that identity. Absent means the claim carries no receipt. */
  readonly identityProvenance?: ObservationProvenance | null;
  /**
   * Which RESOURCE kinds acting on a given concern would consume. The host owns
   * the §12 registry, so the host answers; the default says "nothing", which
   * keeps the capability factor neutral rather than inventing a dependency.
   */
  readonly needs?: (o: Observation) => readonly Capability[];
  /**
   * What the host knows about a resource WITHOUT observing an episode use it —
   * authorization, which is a table rather than a discovery. Merged UNDER the
   * restored snapshot and under everything an episode reports, so it can never
   * overwrite a measurement. Omit it and the runtime behaves exactly as before.
   */
  readonly knownCapabilities?: readonly CapabilityState[];
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
  /** v1.7 §4 — the last world state built, or null if no cycle got that far. */
  readonly world: SystemWorldState | null;
  /** Every observation the last cycle held, completed to the full kind list. */
  readonly observations: readonly Observation[];
  /** v1.7 §5 — the ranked concerns the last cycle produced, best first. */
  readonly concerns: readonly PlannedConcern[];
  readonly experiments: readonly ExperimentRecord[];
  /** Durable row ids written across this invocation. `[]` means nothing stuck. */
  readonly persisted: readonly string[];
  readonly selfEvaluations: readonly SelfEvaluation[];
  /**
   * How many experiments this invocation VERIFIED as improvements. Counted from
   * `improvementVerified`, which `compare` sets only for an `improvement`
   * design that actually beat its criterion — never from a verdict string, so
   * an INCONCLUSIVE can never be summed in as progress.
   */
  readonly improvementsVerified: number;
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
    baselines: [],
    failureLog: [],
    experiments: [],
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
  /**
   * A BASELINE RESTORED FROM A FILE DECIDES WHETHER A CHANGE COUNTS AS AN
   * IMPROVEMENT, so a corrupted one is not cosmetic. `JSON.parse` of a Map
   * yields `{}` and of a missing field `undefined`; either would arrive here as
   * a non-array and then be spread into a Map that silently holds nothing, and
   * §13's "if no reliable measurement exists, IMPROVEMENT_UNVERIFIED" would be
   * replaced by "every first reading is a win".
   */
  if (!Array.isArray(s.baselines)) {
    problems.push({ code: "bad_baselines", detail: typeof s.baselines });
  } else {
    for (const b of s.baselines) {
      if (!Array.isArray(b) || b.length !== 2 || typeof b[0] !== "string") {
        problems.push({ code: "bad_baseline_entry", detail: JSON.stringify(b) });
      } else if (typeof b[1] !== "number" || !Number.isFinite(b[1])) {
        problems.push({ code: "bad_baseline_value", detail: `${b[0]}=${String(b[1])}` });
      }
    }
  }
  if (!Array.isArray(s.failureLog)) {
    problems.push({ code: "bad_failure_log", detail: typeof s.failureLog });
  }
  if (!Array.isArray(s.experiments)) {
    problems.push({ code: "bad_experiments", detail: typeof s.experiments });
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
  const observe = input.observe ?? NO_OBSERVER;
  const runEpisode = input.runEpisode ?? REFUSING_EPISODE;
  const store = input.store ?? NO_CHECKPOINTS;
  const clock = input.clock ?? deterministicClock();
  const bounds = input.bounds ?? DEFAULT_RUNTIME_BOUNDS;
  const identity: SystemIdentity = input.identity ?? UNIDENTIFIED;
  const needsOf = input.needs ?? (() => []);

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
  /**
   * THE HOST'S STATIC TABLE GOES IN FIRST AND THE SNAPSHOT OVERWRITES IT.
   *
   * `knownCapabilities` is what the host can say without attempting anything —
   * in practice, which resource kinds no registered capability is authorized to
   * use. An OBSERVATION always wins, so the snapshot's rows are applied second
   * and the derivation is only ever a floor under silence. Without it an
   * unauthorized kind is unobservable by construction (nothing may attempt it,
   * so nothing reports it) and `planningFor` scores every objective needing one
   * at the modifier floor forever — the closed loop measured on the 2026-09-11
   * dispatch outage.
   */
  let capabilities: ReadonlyMap<Capability, CapabilityState> = new Map([
    ...(input.knownCapabilities ?? []).map((c) => [c.capability, c] as const),
    ...snapshot.capabilities.map((c) => [c.capability, c] as const),
  ]);
  let ranHere = 0;
  const learned: string[] = [];
  const settled: string[] = [];
  const persisted: string[] = [];
  const selfEvaluations: SelfEvaluation[] = [];
  const history: EpisodeRecord[] = [...snapshot.history];
  /**
   * CARRIED ACROSS PROCESSES, WHICH IS THE WHOLE POINT OF §18. The baselines
   * and the failure log come off the restored snapshot and go back onto it, so
   * the fourth process compares against a reading the second process took.
   */
  let baselines = new Map<string, number>(snapshot.baselines.map(([k, v]) => [k, v] as const));
  let failureLog: readonly string[] = snapshot.failureLog;
  let experiments: readonly ExperimentRecord[] = snapshot.experiments;
  let world: SystemWorldState | null = null;
  let observations: readonly Observation[] = [];
  let concerns: readonly PlannedConcern[] = [];
  let improvementsVerified = 0;
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
    if (!seen.ok) {
      surveyRefusals += 1;
      blindReason = seen.reason;
    }

    // ---- OBSERVE ONIQ ---------------------------------------------------
    /**
     * §3, AND IT RUNS WHETHER OR NOT THE SURVEY ANSWERED. Those are two
     * different instruments looking at two different things: the survey reads
     * the KNOWLEDGE substrate, the observer reads the SYSTEM. A substrate ONIQ
     * cannot query says nothing about whether its tests are failing, so gating
     * observation on the survey would make one refusal blind ONIQ to both — and
     * `blind` would then be reported for a runtime that could see its own
     * faults perfectly well.
     */
    const reported = await observe({ episode: snapshot.episode, step: snapshot.step });
    observations = completeObservations(reported);
    const knowledge = seen.ok ? seen.knowledge : EMPTY_KNOWLEDGE;
    world = buildWorldState({
      identity,
      // COVERAGE FOLLOWS THE RECEIPT, NOT THE VALUE. `buildWorldState` scores
      // the identity claim 1 only when a provenance came with it, so a host
      // that names a branch without saying where it read it gets coverage 0 —
      // and `UNIDENTIFIED` gets 0 for free, which is the answer.
      identityProvenance: input.identityProvenance ?? null,
      observations,
      capabilities: capabilityList(capabilities),
      knowledge: seen.ok ? (seen.census ?? EMPTY_CENSUS) : EMPTY_CENSUS,
      backlog,
      experiments,
      baselines,
      failureLog,
    });

    // ---- GENERATE / UPDATE OBJECTIVES -----------------------------------
    /**
     * NINETEEN UNOBSERVED ROWS FROM A REFUSED OBSERVER ARE ONE FACT, NOT
     * NINETEEN OBJECTIVES — and the first run of this file generated all
     * nineteen. A runtime with no observer wired filled its backlog with
     * "establish how to observe X" for every kind, from the single fact that
     * nothing is wired, and `maxBacklog` was left doing the policy work: a
     * bound silently deciding what ONIQ cares about, which is the shape
     * `staleSubjectsFor` already guards against.
     *
     * So the world state still reports all nineteen — §3 lives there, and a
     * dark instrument panel must be visible as dark — while the PLANNER runs
     * only when an observer actually answered. The distinction is real: a kind
     * a working observer did not mention is a genuine hole worth closing, and a
     * kind nobody looked at because nobody is looking is the same hole as the
     * other eighteen.
     */
    concerns = reported.ok
      ? planImprovements({
          world,
          knowledge,
          staleness: seen.ok ? seen.staleness : undefined,
          focus: snapshot.focus,
          capabilities: capabilityList(capabilities),
          needs: needsOf,
        })
      : [];
    const targets: LearningTarget[] = seen.ok
      ? rankLearningTargets({
          gaps: seen.gaps,
          knowledge: seen.knowledge,
          staleness: seen.staleness,
          focus: snapshot.focus,
        })
      : [];
    const fresh = generateObjectives({
      targets,
      knowledge,
      stale: seen.ok ? seen.stale : [],
      improvements: concerns.map((c) => ({
        goal: c.goal,
        score: c.score,
        reason: c.target.reason,
      })),
      at: snapshot.step,
    });
    const before = backlog.length;
    backlog = trimBacklog(mergeBacklog(backlog, fresh), bounds.maxBacklog);
    generated += Math.max(0, backlog.length - before);

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
      snapshot = {
        ...snapshot,
        backlog,
        history,
        capabilities: capabilityList(capabilities),
        baselines: [...baselines.entries()].map(([k, v]) => [k, v] as const),
        failureLog,
        experiments,
      };
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
    persisted.push(...outcome.persisted);
    ranHere += 1;

    // ---- MEASURE / COMPARE AGAINST BASELINE -----------------------------
    /**
     * THE LEDGER TAKES A NEW BEST READING AND NOTHING ELSE, which is what makes
     * `regression` in the world state mean something on the next cycle. Taking
     * the LATEST reading instead would let a regression quietly become the new
     * baseline and then compare clean — a metric that can never report getting
     * worse. `direction` decides which way "better" runs, so the rule is one
     * comparison rather than a per-metric table.
     */
    if (outcome.experiment) {
      const x = outcome.experiment;
      experiments = [...experiments, x];
      if (x.improvementVerified) improvementsVerified += 1;
      const m = x.candidate;
      if (m && m.value !== null) {
        const prior = baselines.get(m.metric);
        const better =
          prior === undefined ||
          (m.direction === "higher_is_better" ? m.value > prior : m.value < prior);
        if (better) {
          baselines = new Map(baselines);
          baselines.set(m.metric, m.value);
        }
      }
    }

    /**
     * §15 — A FAILURE BECOMES KNOWLEDGE, AND THE SCOPE IS STORED WITH IT. The
     * directive's own rider is "do not generalize beyond the evidence", so what
     * is written is the goal that failed and the note it failed with, never a
     * lesson about the class of goal it belongs to. `failureCensus` then reads a
     * REPEAT of the identical line as `recurring`, which is a fact about two
     * observations rather than an inference from one.
     */
    if (outcome.status === "failure" || outcome.status === "blocked") {
      failureLog = [...failureLog, `${chosen.goal.id}: ${outcome.note}`].slice(-MAX_FAILURE_LOG);
    }

    // ---- SELF-EVALUATE --------------------------------------------------
    /**
     * The eight questions, answered from THIS episode's record. `nextConcern` is
     * the best-ranked concern that is not the one just worked on — read off the
     * planner's own ordering rather than re-derived here, so the report cannot
     * disagree with what the next cycle will choose.
     */
    const evaluation = selfEvaluate({
      objectiveId: chosen.id,
      goalId: chosen.goal.id,
      status: outcome.status,
      settled: outcome.settled,
      learned: outcome.learned,
      persisted: outcome.persisted,
      experiment: outcome.experiment,
      blockedOn: outcome.blockedOn,
      blockedCapabilities: refused.map((c) => c.capability),
      world,
      nextConcern: concerns.find((c) => c.goal.id !== chosen.goal.id)?.goal.id ?? null,
    });
    selfEvaluations.push(evaluation);

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
      persisted: outcome.persisted,
      experimentVerdict: outcome.experiment?.verdict ?? null,
      selfEvaluation: evaluation,
    });

    snapshot = {
      version: SNAPSHOT_VERSION,
      episode: snapshot.episode + 1,
      step,
      backlog,
      history,
      focus: chosen.goal,
      capabilities: capabilityList(capabilities),
      baselines: [...baselines.entries()].map(([k, v]) => [k, v] as const),
      failureLog,
      experiments,
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
    world,
    observations,
    concerns,
    experiments,
    persisted,
    selfEvaluations,
    improvementsVerified,
  };
}
