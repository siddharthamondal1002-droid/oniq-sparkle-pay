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
import { contentHash } from "../math/hash.ts";
import type { StateSnapshot } from "../formalState.ts";
import type { Gap, Goal } from "../knowledge/gaps.ts";
import type { Budgets, MemoryRecord, Spent, ToolCall, Verification } from "./seams.ts";
import type { Failure } from "../recovery/failure.ts";

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

/**
 * v1.3 sections 6 and 30. THE FUNDAMENTAL INVARIANT IS
 * `PERCEPTION != INFERENCE != PREDICTION != ACTION != OBSERVATION != LEARNING`,
 * and a world model that cannot say which of those a fact came from cannot
 * hold it: "Never represent an inference as an observation."
 *
 * It is REQUIRED wherever it appears, never defaulted. A default would be a
 * value nobody chose, and the only safe default — UNKNOWN — would quietly
 * demote every genuine observation the day a construction site forgot it.
 */
export type Provenance = "OBSERVED" | "INFERRED" | "PREDICTED" | "UNKNOWN";

export const PROVENANCES: readonly Provenance[] = ["OBSERVED", "INFERRED", "PREDICTED", "UNKNOWN"];

/** Section 30: only a thing the environment actually said may act as evidence. */
export function isEvidential(p: Provenance): boolean {
  return p === "OBSERVED";
}

export type Percept = {
  readonly id: string;
  readonly kind: PerceptKind;
  readonly content: string;
  /** Where it came from. Section 13: no source becomes truth by being generated. */
  readonly source: string;
  /** v1.3 section 3. How much this is trusted, 0..1. */
  readonly confidence: number;
  /** v1.3 sections 3 and 30. */
  readonly provenance: Provenance;
  /**
   * v1.3 section 3, verbatim: "A timestamp may exist in an audit record. It
   * must never enter the deterministic cognitive `stateId`." So it is optional
   * here and STRIPPED in `hashPayload` — see the note there, which is where the
   * rule is actually enforced rather than merely stated.
   */
  readonly observedAt?: number;
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
  /**
   * v1.3 section 6. Required, so a station cannot add a thing it INFERRED to
   * the world model without saying so — which is the one mistake section 30
   * names as fundamental.
   */
  readonly provenance: Provenance;
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
  /** Independent of `reversible` — see ToolProperties in seams.ts. */
  readonly touchesProduction: boolean;
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

/**
 * Section 26, and v1.3 section 1: the loop "terminates only on an explicit
 * terminal state". These six are that list.
 *
 * THE COMMENT HERE USED TO SAY "only these three" OVER A LIST OF SIX, and
 * `isTerminal` was `status !== "running"` — which never read this array at all.
 * Both were harmless today and wrong tomorrow: the day a second non-terminal
 * status is added (a `paused`, a `waiting_for_user`), the old predicate calls
 * it terminal and the loop stops on it silently.
 */
export const TERMINAL_STATUSES: readonly LoopStatus[] = [
  "success",
  "failure",
  "blocked",
  "user_stop",
  "budget_exhausted",
  "safety_stop",
];

export function isTerminal(status: LoopStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
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
  /**
   * Section 14's verdict, ON THE STATE rather than beside it. It is a
   * conclusion the run reached from the environment, so it belongs in the
   * hashed record: a replay that produced a different verdict from the same
   * observations would be a replay that did not reproduce the run.
   */
  readonly verification: Verification | null;
  /**
   * RECOVERY BRIEF SECTION 20 AND 31, and it is why they are HASHED rather than
   * logged beside the state: "Never mutate history to hide a failure" and "A
   * failure must therefore never disappear merely because a retry succeeded."
   * A replay that reproduced the successful attempt and not the two that failed
   * before it would be a replay of a different run.
   */
  readonly failures: readonly Failure[];
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
    /**
     * v1.3 SECTION 3 IS ENFORCED HERE, NOT MERELY DECLARED ON THE TYPE:
     * "A timestamp may exist in an audit record. It must never enter the
     * deterministic cognitive `stateId`." `Percept.observedAt` is a real wall
     * reading, so the percept is REBUILT field by field rather than spread —
     * a spread would carry it in and every replay of the same run would
     * produce a different id, which is the `Date.now()` fault v1.1 already
     * recorded in `transition.ts`.
     */
    percepts: s.percepts.map((p) => ({
      id: p.id,
      kind: p.kind,
      content: p.content,
      source: p.source,
      confidence: p.confidence,
      provenance: p.provenance,
    })),
    failures: s.failures,
    activeHypotheses: s.activeHypotheses,
    worldState: s.worldState,
    evidenceIds: s.evidenceIds,
    knowledgeGaps: s.knowledgeGaps,
    candidatePlans: s.candidatePlans,
    selectedPlan: s.selectedPlan,
    futures: s.futures,
    predictions: s.predictions,
    outcomes: s.outcomes,
    verification: s.verification,
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
