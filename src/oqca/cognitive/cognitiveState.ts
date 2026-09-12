/**
 * THE COGNITIVE STATE — §3, and the serialization §18 resumes from.
 *
 * EVERY TRANSITION IS A PURE FUNCTION OF (state, event). The reviewer's
 * correction is taken literally and matters: a model's REPLY is not
 * deterministic and never can be, so what is required here is that the
 * ORCHESTRATION is — given the same recorded model replies and the same tool
 * results, the same states come out. That is what `ReplayModelAdapter` exists
 * to make testable, and what `transitions` records so an auditor can re-run it.
 */
import { type WorldModel, EMPTY_WORLD } from "./worldModel.ts";
import { type Standing } from "./provenance.ts";

export type Hypothesis = {
  readonly id: string;
  readonly claim: string;
  readonly prior: number;
  readonly confidence: number;
  readonly status: "OPEN" | "SUPPORTED" | "REFUTED" | "CONFIRMED";
  readonly supporting: readonly string[];
  readonly contradicting: readonly string[];
  readonly predictions: readonly string[];
  readonly discriminatingTests: readonly string[];
};

export type Conclusion = {
  readonly claim: string;
  readonly standing: Standing;
  readonly evidence: readonly string[];
};

/** One recorded step. The audit trail §3 demands. */
export type Transition = {
  readonly seq: number;
  readonly station: string;
  readonly detail: string;
  readonly at: string;
};

export type ToolCallRecord = {
  readonly tool: string;
  readonly args: Readonly<Record<string, string>>;
  readonly outcome: "EXECUTED" | "DRY_RUN" | "REFUSED";
  readonly detail: string;
  readonly at: string;
};

export type CognitiveState = {
  readonly goal: string;
  readonly world: WorldModel;
  readonly hypotheses: readonly Hypothesis[];
  readonly conclusions: readonly Conclusion[];
  readonly observations: readonly string[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly transitions: readonly Transition[];
  readonly uncertainty: number;
  readonly iteration: number;
  readonly timestamp: string;
};

export function initialState(goal: string, at: string): CognitiveState {
  return {
    goal,
    world: EMPTY_WORLD,
    hypotheses: [],
    conclusions: [],
    observations: [],
    toolCalls: [],
    transitions: [],
    uncertainty: 1,
    iteration: 0,
    timestamp: at,
  };
}

/** Append one audited transition. The ONLY way a station records itself. */
export function record(
  s: CognitiveState,
  station: string,
  detail: string,
  at: string,
): CognitiveState {
  return {
    ...s,
    transitions: [...s.transitions, { seq: s.transitions.length, station, detail, at }],
    timestamp: at,
  };
}

/**
 * HOW UNCERTAIN THE KERNEL IS, from the hypotheses rather than from a feeling.
 * One confident survivor is near 0; several equally-live candidates is near 1.
 * With no hypotheses at all it is 1 — ignorance, not confidence.
 */
export function uncertaintyOf(hypotheses: readonly Hypothesis[]): number {
  const live = hypotheses.filter((h) => h.status !== "REFUTED");
  if (live.length === 0) return 1;
  const total = live.reduce((a, h) => a + h.confidence, 0);
  if (total <= 0) return 1;
  const top = Math.max(...live.map((h) => h.confidence));
  return Math.max(0, Math.min(1, 1 - top / total));
}
