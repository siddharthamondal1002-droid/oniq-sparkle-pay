/**
 * OQCA v1.5 — AUTONOMOUS OBJECTIVE GENERATION. Owner directive 2026-09-10:
 * "ONIQ should be able to create an objective without a user request... That
 * prevents one blocked task from killing autonomous cognition."
 *
 * THE RUNTIME MAY NEVER MINT A `user_request`, AND THAT IS THE ONE SAFETY
 * PROPERTY OF THIS FILE. Three of the four sources are autonomous; the fourth
 * is a person speaking and can only be handed IN. A generator that could emit
 * `user_request` would let the loop attribute its own goal to somebody who
 * never asked for it — the same class of fault as `health-scan` sending a
 * report to a provider under a consent nobody gave, and the same class as
 * `measured` being claimed for a document in `project.ts`. `generateObjectives`
 * is typed to `AutonomousSource` for that reason rather than being told not to.
 *
 * THE ID HASHES WHAT THE OBJECTIVE IS FOR, NOT WHAT IS BELIEVED ABOUT IT.
 * Status, attempts, priority and the blocker all move as the runtime learns;
 * the source and the concepts it is about do not. So re-generating the same
 * objective on a later cycle produces the SAME id and the backlog dedupes it,
 * instead of growing one copy per cycle forever. This is the substrate's own
 * rule — `assertionId` hashes subject|predicate|object and never the belief —
 * and the reason it matters here is stronger: without it, an unresolved gap
 * would mint a fresh objective every single cycle and the backlog bound would
 * be the only thing standing between the runtime and unbounded growth.
 *
 * IMPORTANCE IS DELIBERATELY OUTSIDE THE ID. The same thing to learn at a
 * different weight is the same thing to learn, and importance moves with the
 * evidence: including it would make dedupe fail on a drift of 0.01 and quietly
 * restore the per-cycle duplication the id exists to prevent.
 *
 * GENERATED GOALS ARE NARROW ON PURPOSE, AND THE REASON IS AN OPEN QUESTION
 * RATHER THAN A PREFERENCE. v1.4-R measured that SUPERPOSE admits ONE
 * prerequisite per iteration in `goal.requires` declaration order and never
 * consults the gap detector, so which prerequisites become hypotheses is a fact
 * about how many iterations ran. The owner's instruction is that the mismatch
 * "deserves a measured experiment rather than a convenient implementation", so
 * nothing here works around it: generation simply does not produce goals wide
 * enough to depend on the answer. `MAX_GENERATED_REQUIREMENTS` is 2, and if the
 * experiment later changes SUPERPOSE this constant is the one line to revisit.
 */
import { contentHash } from "../math/hash.ts";
import type { Goal } from "../knowledge/gaps.ts";
import type { KnowledgeState } from "../knowledge/model.ts";
import type { CapabilityState } from "../loop/capability.ts";
import type { LearningTarget } from "./select.ts";

/**
 * v1.7 adds `improvement`: an objective that came from ONIQ OBSERVING ITSELF
 * rather than from a gap in what it knows. The distinction is load-bearing —
 * a knowledge gap is closed by learning something, an improvement objective is
 * closed by a MEASURED delta, and collapsing them would let "I now understand
 * the fault" count as "I fixed it".
 */
export type ObjectiveSource =
  "user_request" | "knowledge_gap" | "maintenance" | "follow_up" | "improvement";

export const OBJECTIVE_SOURCES: readonly ObjectiveSource[] = [
  "user_request",
  "knowledge_gap",
  "maintenance",
  "follow_up",
  "improvement",
];

/**
 * The three the runtime may create by itself. `user_request` is absent, and the
 * absence is load-bearing — see the header.
 */
export type AutonomousSource = Exclude<ObjectiveSource, "user_request">;

export const AUTONOMOUS_SOURCES: readonly AutonomousSource[] = [
  "knowledge_gap",
  "maintenance",
  "follow_up",
  "improvement",
];

export function isAutonomous(source: ObjectiveSource): source is AutonomousSource {
  return (AUTONOMOUS_SOURCES as readonly ObjectiveSource[]).includes(source);
}

/**
 * `blocked` IS NOT `abandoned`, AND THAT DISTINCTION IS THE OWNER'S POINT:
 * "Blocked on one objective != cognitively dead." A blocked objective is
 * waiting on something nameable and returns to `pending` when that thing is
 * done; an abandoned one has spent its attempts and will not be tried again.
 * Collapsing them would either spin forever on the first or give up on the
 * second the moment anything went wrong.
 */
export type ObjectiveStatus = "pending" | "active" | "blocked" | "done" | "abandoned";

export const OBJECTIVE_STATUSES: readonly ObjectiveStatus[] = [
  "pending",
  "active",
  "blocked",
  "done",
  "abandoned",
];

export type Objective = {
  readonly id: string;
  readonly source: ObjectiveSource;
  readonly goal: Goal;
  readonly status: ObjectiveStatus;
  /** Why this exists, in the words a person would want. Never a code. */
  readonly rationale: string;
  /** From the learning selector for a gap objective; inherited by a follow-up. */
  readonly priority: number;
  /** The objective this one was spawned to unblock, or null. */
  readonly parentId: string | null;
  /** 0 for a root objective. Bounded by `MAX_FOLLOW_UP_DEPTH`. */
  readonly depth: number;
  readonly attempts: number;
  readonly blockedReason: string | null;
  /** The concept ids an episode could not resolve. A follow-up needs these. */
  readonly blockedOn: readonly string[];
  /**
   * v1.6 — THE RESOURCE DEPENDENCY THIS OBJECTIVE IS WAITING ON, and it is a
   * SEPARATE field from `blockedOn` because nothing about it can be researched.
   * `blockedOn` names concepts, and a follow-up objective goes and settles
   * them; this names a credential, a provider, a rate limit or an allowance,
   * and the only thing that clears one is somebody turning it on. So an
   * objective blocked HERE spawns no follow-up (see `followUpFor`, which reads
   * `blockedOn` alone) and is instead RECONSIDERED by the runtime when the
   * capability is next observed available. Persisted on the snapshot, which is
   * what makes that survive a process boundary.
   */
  readonly blockedCapabilities: readonly CapabilityState[];
  /** A LOGICAL step, never a wall clock — the whole tree bans one. */
  readonly createdAt: number;
};

/**
 * How deep a chain of "unblock the thing that blocks the thing" may go, and how
 * many times one objective may be re-attempted after its blocker cleared.
 *
 * BOTH BOUNDS EXIST BECAUSE THE REGRESS IS THE OBVIOUS FAILURE OF THIS DESIGN:
 * a blocked objective spawns a follow-up, which blocks, which spawns another,
 * forever — an autonomous system that looks busy and learns nothing. The
 * content-derived id kills the exact-repeat case for free (the same follow-up
 * dedupes against itself), but a chain that names a NEW concept each time is
 * not a repeat, so it needs a depth bound as well. Neither bound alone is
 * enough and the tests drive both.
 */
export const MAX_FOLLOW_UP_DEPTH = 3;
export const MAX_ATTEMPTS = 3;

/** See the header: goals stay narrow while the SUPERPOSE question is open. */
export const MAX_GENERATED_REQUIREMENTS = 2;

/**
 * IDENTITY, NOT BELIEF. Source plus statement plus the sorted concept ids —
 * see the header for why importance and the goal's own id are both excluded.
 */
export function objectiveId(source: ObjectiveSource, goal: Goal): string {
  return contentHash({
    source,
    statement: goal.statement,
    concepts: [...goal.requires].map((r) => r.conceptId).sort(),
  });
}

function seal(draft: Omit<Objective, "id">): Objective {
  return { ...draft, id: objectiveId(draft.source, draft.goal) };
}

/**
 * A goal for one learning target: the concept itself, plus AT MOST one thing it
 * cannot be understood without, at reduced importance.
 *
 * The prerequisite is chosen by how many OTHER required-adjacent concepts name
 * it — the most-depended-on one — rather than by declaration order, because
 * declaration order is precisely the signal v1.4-R found SUPERPOSE already
 * keying on. Picking the same way twice would make the two decisions agree by
 * coincidence and hide the mismatch the owner asked to keep visible.
 */
export function goalForTarget(target: LearningTarget, knowledge: KnowledgeState): Goal {
  const concept = knowledge.concepts.get(target.conceptId);
  const prerequisites = concept?.dependsOn ?? [];
  const dependentCount = (id: string) =>
    [...knowledge.concepts.values()].filter((c) => c.id !== id && c.dependsOn.includes(id)).length;
  const chosen = [...prerequisites].sort(
    (a, b) => dependentCount(b) - dependentCount(a) || a.localeCompare(b),
  )[0];

  const requires: { conceptId: string; importance: number }[] = [
    { conceptId: target.conceptId, importance: target.factors.importance },
  ];
  if (chosen !== undefined && requires.length < MAX_GENERATED_REQUIREMENTS) {
    // Half weight: a prerequisite is on the path to the target, not the target.
    requires.push({ conceptId: chosen, importance: target.factors.importance / 2 });
  }
  return {
    id: `learn:${target.conceptId}`,
    statement: `establish what is true about ${target.conceptId}`,
    requires,
  };
}

/**
 * One objective per open learning target, ordered by the six-factor score.
 * `at` is the LOGICAL step the runtime is on, not a clock reading.
 */
export function objectivesFromTargets(
  targets: readonly LearningTarget[],
  knowledge: KnowledgeState,
  at: number,
): Objective[] {
  return targets.map((t) =>
    seal({
      source: "knowledge_gap",
      goal: goalForTarget(t, knowledge),
      status: "pending",
      rationale: `${t.status.toLowerCase()}: ${t.reason}`,
      priority: t.score,
      parentId: null,
      depth: 0,
      attempts: 0,
      blockedReason: null,
      blockedOn: [],
      blockedCapabilities: [],
      createdAt: at,
    }),
  );
}

/**
 * v1.7 — ONE RANKED CONCERN, IN THE SHAPE THIS FILE CAN READ WITHOUT IMPORTING
 * THE PLANNER.
 *
 * A STRUCTURAL PARAMETER, AND THE REASON IS A CYCLE RATHER THAN A PREFERENCE.
 * `improve.ts` imports `world.ts`, which imports THIS file for `Objective`; so
 * taking `PlannedConcern` here would close the ring `objective -> improve ->
 * world -> objective`. It is also the honest boundary: what this file needs of
 * a ranked concern is a goal, a number and a sentence, and nothing about how
 * the number was arrived at.
 */
export type ImprovementSeed = {
  readonly goal: Goal;
  /** The six-factor score after the clamped planning modifier. */
  readonly score: number;
  /** Why, in the observation's own words. Never a template. */
  readonly reason: string;
};

/**
 * Objectives ONIQ raised about ITSELF, from §5's "objectives must arise from
 * observed system state".
 *
 * `source` is `improvement`, which is a member of `AutonomousSource` — so the
 * runtime still provably cannot mint a `user_request`, and a person's request
 * still outranks every one of these in `selectObjective` unconditionally.
 */
export function objectivesFromImprovements(
  seeds: readonly ImprovementSeed[],
  at: number,
): Objective[] {
  return seeds.map((s) =>
    seal({
      source: "improvement",
      goal: s.goal,
      status: "pending",
      rationale: s.reason,
      priority: s.score,
      parentId: null,
      depth: 0,
      attempts: 0,
      blockedReason: null,
      blockedOn: [],
      blockedCapabilities: [],
      createdAt: at,
    }),
  );
}

/**
 * A record that has gone past its verification interval. `demand` is the same
 * 0..1 scale the learning selector uses, so a maintenance objective and a gap
 * objective are comparable rather than living on two invented scales.
 */
export type StaleSubject = {
  readonly conceptId: string;
  readonly importance: number;
  readonly demand: number;
  readonly reason: string;
};

/**
 * Maintenance objectives: re-verify what has gone stale.
 *
 * These are the reason a runtime with no open gaps is still not idle. Priority
 * is `importance * demand` and nothing else — no invented weight makes
 * maintenance out- or under-rank learning, because the two are already on the
 * same scale by construction.
 */
export function objectivesFromStale(stale: readonly StaleSubject[], at: number): Objective[] {
  return stale.map((s) =>
    seal({
      source: "maintenance",
      goal: {
        id: `reverify:${s.conceptId}`,
        statement: `re-verify what is believed about ${s.conceptId}`,
        requires: [{ conceptId: s.conceptId, importance: s.importance }],
      },
      status: "pending",
      rationale: `stale: ${s.reason}`,
      priority: s.importance * s.demand,
      parentId: null,
      depth: 0,
      attempts: 0,
      blockedReason: null,
      blockedOn: [],
      blockedCapabilities: [],
      createdAt: at,
    }),
  );
}

/**
 * The follow-up an objective's blocker earns, or `null` when it earns none.
 *
 * FOUR REFUSALS, EACH OF WHICH IS A REAL WAY THIS GOES WRONG:
 *
 *   not blocked            nothing to follow up
 *   nothing named          `blockedOn` empty. An episode that cannot say WHAT
 *                          stopped it has given the runtime nothing to work on,
 *                          and inventing a target here would be fabricating the
 *                          blocker — `NO_RESEARCH` refuses for the same reason
 *                          rather than answering "no findings". v1.6 makes this
 *                          refusal load-bearing rather than defensive: an
 *                          objective blocked purely on a CAPABILITY has an empty
 *                          `blockedOn` by construction, and a follow-up saying
 *                          "go and research the missing credential" would be a
 *                          cognitive answer to a resource fact. The runtime
 *                          reconsiders it instead.
 *   depth exhausted        the chain bound; see MAX_FOLLOW_UP_DEPTH
 *   same requirement set   the follow-up IS the parent. This is the regress in
 *                          its purest form and the content-derived id would
 *                          hide it: the child would dedupe onto its parent and
 *                          silently reset that objective's own status.
 *
 * It does NOT get a priority boost over its parent. A boost would be a number
 * nobody chose, and it is unnecessary: the parent is `blocked` and therefore
 * unselectable, so the follow-up is reached on its own merits.
 */
export function followUpFor(objective: Objective, at: number): Objective | null {
  if (objective.status !== "blocked") return null;
  if (objective.blockedOn.length === 0) return null;
  if (objective.depth >= MAX_FOLLOW_UP_DEPTH) return null;

  const concepts = [...new Set(objective.blockedOn)].sort();
  const parentConcepts = [...objective.goal.requires.map((r) => r.conceptId)].sort();
  if (
    concepts.length === parentConcepts.length &&
    concepts.every((c, i) => c === parentConcepts[i])
  ) {
    return null;
  }

  const requires = concepts
    .slice(0, MAX_GENERATED_REQUIREMENTS)
    .map((conceptId) => ({ conceptId, importance: 1 }));
  return seal({
    source: "follow_up",
    goal: {
      id: `unblock:${objective.goal.id}`,
      statement: `resolve ${concepts.join(", ")} so that ${objective.goal.statement}`,
      requires,
    },
    status: "pending",
    rationale: `${objective.goal.id} is blocked: ${objective.blockedReason ?? "no reason given"}`,
    priority: objective.priority,
    parentId: objective.id,
    depth: objective.depth + 1,
    attempts: 0,
    blockedReason: null,
    blockedOn: [],
    blockedCapabilities: [],
    createdAt: at,
  });
}

/**
 * Everything the generator needs to see, in one record so a caller cannot
 * supply half of it. `at` is logical.
 */
export type GenerationInput = {
  readonly targets: readonly LearningTarget[];
  readonly knowledge: KnowledgeState;
  readonly stale: readonly StaleSubject[];
  /** v1.7 — ranked concerns from what ONIQ observed about itself. */
  readonly improvements?: readonly ImprovementSeed[];
  readonly at: number;
};

/**
 * Every autonomous objective one cycle can justify. The return type is narrowed
 * to `AutonomousSource` so a `user_request` cannot leave here even by accident.
 */
export function generateObjectives(
  input: GenerationInput,
): readonly (Objective & { readonly source: AutonomousSource })[] {
  const out = [
    ...objectivesFromTargets(input.targets, input.knowledge, input.at),
    ...objectivesFromStale(input.stale, input.at),
    ...objectivesFromImprovements(input.improvements ?? [], input.at),
  ];
  return out as readonly (Objective & { readonly source: AutonomousSource })[];
}

/**
 * Fold new objectives into a backlog, keeping what is already known about an id.
 *
 * THE EXISTING ROW WINS, and that is the half that makes the content-derived id
 * useful rather than dangerous. A regenerated objective carries `pending`, zero
 * attempts and no blocker — merging it OVER an in-flight one would resurrect a
 * blocked objective as fresh every cycle and lose the attempt count that bounds
 * it. Only the priority is taken from the new copy, because the score is what
 * the current evidence says and the old one is stale by definition.
 */
export function mergeBacklog(
  existing: readonly Objective[],
  generated: readonly Objective[],
): Objective[] {
  const byId = new Map(existing.map((o) => [o.id, o]));
  for (const g of generated) {
    const prior = byId.get(g.id);
    byId.set(g.id, prior ? { ...prior, priority: g.priority } : g);
  }
  return [...byId.values()];
}

/**
 * What to do next.
 *
 * A PERSON'S REQUEST OUTRANKS THE RUNTIME'S OWN CHORES, unconditionally and not
 * by a weight. An autonomous system whose self-generated maintenance can
 * outscore a waiting person has inverted who it is for, and a numeric bonus
 * large enough to guarantee that is a number nobody chose. So the sort is
 * lexicographic: user requests first, then priority, then id for determinism.
 *
 * Only `pending` is selectable. `active` is in flight, `blocked` is waiting on
 * its follow-up, and `done`/`abandoned` are finished — selecting any of them is
 * how a runtime spins on one objective and calls it work.
 */
export function selectObjective(backlog: readonly Objective[]): Objective | null {
  const pending = backlog.filter((o) => o.status === "pending");
  if (pending.length === 0) return null;
  return [...pending].sort((a, b) => {
    const aUser = a.source === "user_request" ? 0 : 1;
    const bUser = b.source === "user_request" ? 0 : 1;
    return aUser - bUser || b.priority - a.priority || a.id.localeCompare(b.id);
  })[0];
}

/** A user's objective, built HERE because the generator provably cannot. */
export function userObjective(goal: Goal, at: number, priority = 1): Objective {
  return seal({
    source: "user_request",
    goal,
    status: "pending",
    rationale: "asked for",
    priority,
    parentId: null,
    depth: 0,
    attempts: 0,
    blockedReason: null,
    blockedOn: [],
    blockedCapabilities: [],
    createdAt: at,
  });
}
