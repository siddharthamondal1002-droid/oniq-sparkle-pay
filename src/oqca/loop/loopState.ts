/**
 * ONIQ AGI Mega Quantum Loop — the cognitive-OS state. Owner brief section 3.
 *
 * THE BRIEF CALLS THIS `CognitiveState`, AND THAT NAME IS ALREADY TAKEN BY ONE
 * OF ITS OWN FIELDS. `formalState.ts`'s `CognitiveState` is the amplitude state
 * — basis, amplitudes, phases, history — which the brief lists here as
 * `quantumState`. So this record is `LoopState`, and the layering it encodes is
 * the brief's own section 33: OQCA is ONE box beside memory and the world
 * model, underneath the cognitive OS. Collapsing the two would have made the
 * quantum state carry a goal and a plan, which is precisely the blurring
 * section 3 of the v1.1 brief forbade between layers.
 *
 * `stateId` IS CONTENT-DERIVED AND NEVER READS A CLOCK — the brief says so, and
 * v1.1 already learned the sharper half of it: the id hashes the STATE and not
 * the history, because the last record's `toState` names the id and hashing
 * both makes the id depend on a record that depends on the id. Same rule here,
 * same reason, and `createdAt` is a LOGICAL step with the wall-clock reading
 * carried beside it and excluded from the hash.
 */
import { contentHash } from "../math/hash";
import type { StateSnapshot } from "../formalState";
import type { Gap, Goal } from "../knowledge/gaps";
import type { Budgets, MemoryRecord, Spent, ToolCall } from "./seams";

/**
 * Section 4 PERCEIVE. Named `Percept` rather than `Observation` because
 * `megaLoop`'s `Observation` is a likelihood vector — quantum evidence — and
 * two different things under one name in one subsystem is how a caller passes
 * the wrong one and finds out in production.
 */
export type PerceptKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "app_state"
  | "api_response"
  | "tool_result"
  | "memory"
  | "environment"
  | "user_feedback";

export type Percept = {
  readonly id: string;
  readonly kind: PerceptKind;
  readonly content: string;
  /** Where it came from. Section 13: no source becomes truth by being generated. */
  readonly source: string;
};

/**
 * Section 7. Deliberately SMALL: "The world model is task-specific. ONIQ does
 * not attempt to model everything. It models what matters to the current goal."
 * A world state that grew without bound would be the whole-history dump
 * section 6 bans, arriving through a different door.
 */
export type WorldEntity = {
  readonly id: string;
  readonly kind: string;
  readonly properties: Readonly<Record<string, string>>;
  /** 0 = certain, 1 = nothing is known about this entity's state. */
  readonly uncertainty: number;
};

export type WorldRelation = {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
};

export type WorldState = {
  readonly entities: readonly WorldEntity[];
  readonly relations: readonly WorldRelation[];
  readonly availableActions: readonly string[];
  /** Named rather than merely absent — section 7 asks for both lists. */
  readonly unavailableActions: readonly string[];
};

export const EMPTY_WORLD: WorldState = {
  entities: [],
  relations: [],
  availableActions: [],
  unavailableActions: [],
};

/** Section 16 IMAGINE — one candidate future, scored before anything runs. */
export type ImaginedFuture = {
  readonly action: string;
  readonly expectedResult: string;
  /** Each in [0, 1]. */
  readonly risk: number;
  readonly cost: number;
  readonly uncertainty: number;
  readonly reversible: boolean;
  readonly goalProgress: number;
  /** goalProgress discounted by risk and cost. The ordering, made explicit. */
  readonly expectedValue: number;
};

/** Section 17 PLAN. */
export type PlanStep = {
  readonly id: string;
  readonly describes: string;
  readonly dependsOn: readonly string[];
  readonly call: ToolCall | null;
};

export type Plan = {
  readonly id: string;
  readonly objective: string;
  readonly steps: readonly PlanStep[];
  readonly requiredTools: readonly string[];
  readonly risks: readonly string[];
  /** Section 17 marks this optional; section 18 asks "is it reversible?". */
  readonly rollback: string | null;
  readonly successCriteria: readonly string[];
};

/** Section 20/21 — what was expected against what the environment said. */
export type Prediction = {
  readonly stepId: string;
  readonly expected: string;
};

export type Outcome = {
  readonly stepId: string;
  readonly observed: string;
  readonly matched: boolean;
  /** 0 when prediction and observation agree, 1 when they share nothing. */
  readonly predictionError: number;
};

/** Section 26's own list, plus the state a running loop is in. */
export type LoopStatus =
  "running" | "success" | "failure" | "blocked" | "user_stop" | "budget_exhausted" | "safety_stop";

/** Section 26: only these three mean the loop may not continue on its own. */
export const TERMINAL_STATUSES: readonly LoopStatus[] = [
  "success",
  "failure",
  "blocked",
  "user_stop",
  "budget_exhausted",
  "safety_stop",
];

export function isTerminal(status: LoopStatus): boolean {
  return status !== "running";
}

export type LoopState = {
  readonly stateId: string;
  readonly parentStateId: string | null;
  readonly goal: Goal;
  readonly percepts: readonly Percept[];
  readonly activeHypotheses: readonly string[];
  readonly worldState: WorldState;
  readonly evidenceIds: readonly string[];
  readonly knowledgeGaps: readonly Gap[];
  readonly candidatePlans: readonly Plan[];
  readonly selectedPlan: Plan | null;
  readonly futures: readonly ImaginedFuture[];
  readonly predictions: readonly Prediction[];
  readonly outcomes: readonly Outcome[];
  readonly memoryRefs: readonly MemoryRecord[];
  /** The OQCA amplitude state, serialized. Section 3's `quantumState`. */
  readonly quantumState: StateSnapshot;
  readonly iteration: number;
  readonly budgets: Budgets;
  readonly spent: Spent;
  readonly status: LoopStatus;
  /** Logical step. NOT a clock — see the header. */
  readonly createdAt: number;
  /** A real reading when a real clock was supplied. Never hashed. */
  readonly wallClock?: number;
};

/**
 * The fields the id commits to. `wallClock` is absent BY CONSTRUCTION rather
 * than by being filtered out later, so a future field cannot be added to the
 * record and silently reach the hash — the payload is written, not derived.
 */
function hashPayload(s: Omit<LoopState, "stateId" | "wallClock">) {
  return {
    parentStateId: s.parentStateId,
    goal: s.goal,
    percepts: s.percepts,
    activeHypotheses: s.activeHypotheses,
    worldState: s.worldState,
    evidenceIds: s.evidenceIds,
    knowledgeGaps: s.knowledgeGaps,
    candidatePlans: s.candidatePlans,
    selectedPlan: s.selectedPlan,
    futures: s.futures,
    predictions: s.predictions,
    outcomes: s.outcomes,
    memoryRefs: s.memoryRefs,
    quantumState: s.quantumState,
    iteration: s.iteration,
    budgets: s.budgets,
    spent: s.spent,
    status: s.status,
    createdAt: s.createdAt,
  };
}

export function sealLoopState(draft: Omit<LoopState, "stateId">): LoopState {
  return { ...draft, stateId: contentHash(hashPayload(draft)) };
}

/**
 * Every transition is a NEW state whose parent is named, so a run is a chain
 * that can be walked backwards. Nothing is edited in place: replay that shares
 * structure with the run it replays is not replay.
 */
export function advance(
  previous: LoopState,
  changes: Partial<Omit<LoopState, "stateId">>,
): LoopState {
  return sealLoopState({
    ...previous,
    ...changes,
    parentStateId: previous.stateId,
    createdAt: previous.createdAt + 1,
  });
}

export type LoopStateProblem = { readonly code: string; readonly detail: string };

/**
 * Section 3's replay guarantee is only worth having if a malformed state is
 * caught rather than propagated. Everything here is a shape a transition could
 * produce by accident; the id is re-derived rather than trusted, which is what
 * makes a hand-edited snapshot fail instead of silently becoming authoritative.
 */
export function validateLoopState(s: LoopState): readonly LoopStateProblem[] {
  const problems: LoopStateProblem[] = [];
  const { stateId: _drop, wallClock: _clock, ...rest } = s;
  const recomputed = contentHash(hashPayload(rest));
  if (recomputed !== s.stateId) {
    problems.push({ code: "state_id_mismatch", detail: `${s.stateId} != ${recomputed}` });
  }
  if (!Number.isInteger(s.iteration) || s.iteration < 0) {
    problems.push({ code: "bad_iteration", detail: String(s.iteration) });
  }
  if (!Number.isInteger(s.createdAt) || s.createdAt < 0) {
    problems.push({ code: "bad_created_at", detail: String(s.createdAt) });
  }
  const planIds = new Set(s.candidatePlans.map((p) => p.id));
  if (s.selectedPlan && !planIds.has(s.selectedPlan.id)) {
    // A plan may only be executed if it was one of the candidates EVALUATE saw.
    // Without this a station could substitute a plan after the evaluation that
    // was supposed to authorise it, which is the whole point of section 18.
    problems.push({ code: "selected_plan_not_a_candidate", detail: s.selectedPlan.id });
  }
  for (const step of s.selectedPlan?.steps ?? []) {
    for (const dep of step.dependsOn) {
      if (!s.selectedPlan!.steps.some((o) => o.id === dep)) {
        problems.push({ code: "dangling_step_dependency", detail: `${step.id} -> ${dep}` });
      }
    }
  }
  for (const o of s.outcomes) {
    if (o.predictionError < 0 || o.predictionError > 1) {
      problems.push({ code: "bad_prediction_error", detail: `${o.stepId}=${o.predictionError}` });
    }
  }
  for (const f of s.futures) {
    if ([f.risk, f.cost, f.uncertainty, f.goalProgress].some((v) => v < 0 || v > 1)) {
      problems.push({ code: "future_out_of_range", detail: f.action });
    }
  }
  return problems;
}
