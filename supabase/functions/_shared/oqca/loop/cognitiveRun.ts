/**
 * THE COGNITIVE RUN — v1.3 section 2.
 *
 * "One `CognitiveRun` object per run... No module-level mutable execution
 * state."
 *
 * WHAT THIS OBJECT DELIBERATELY DOES NOT CARRY, and why that is closer to
 * section 2 than literal compliance would be: `status` and `iteration`. The
 * section lists them, and they already exist on `LoopState` — which is the
 * HASHED, persisted, replayable record. Storing a second copy on a mutable run
 * object would create two answers to "what iteration is this", and the first
 * time they disagreed the hashed one would be right and the other would be the
 * bug. `runProgress()` below reads them from the state, so the brief's fields
 * are reachable without being duplicated. Section 2's actual instruction —
 * no module-level mutable execution state — is honoured exactly: this object
 * is per-run, constructed per call, and holds only immutable configuration.
 */
import type { LoopState } from "./loopState.ts";
import {
  type Budgets,
  type Clock,
  type Engine,
  type KnowledgeAdapter,
  type MemoryStore,
  type ModelEngine,
  type ResearchAdapter,
  type RunMode,
  type ToolRouter,
  type Verifier,
  DEFAULT_BUDGETS,
  EMPTY_KNOWLEDGE,
  EMPTY_MEMORY,
  NO_RESEARCH,
  NO_VERIFIER,
  REFUSING_ENGINE,
  REFUSING_ROUTER,
  deterministicClock,
} from "./seams.ts";
import {
  type BackoffPolicy,
  type RetryBudgets,
  DEFAULT_BACKOFF,
  DEFAULT_RETRY_BUDGETS,
} from "../recovery/retry.ts";
import type { ProviderVerdict } from "../recovery/classify.ts";

/**
 * v1.3 sections 2 and 19. `persist` RETURNS WHETHER IT PERSISTED rather than
 * `void`, for the reason `memory.consolidate` returns a count: a no-op that
 * resolves is indistinguishable from a write, and every later reader would
 * believe a chain was saved that was not.
 *
 * `load` is what makes section 19's "persist -> restore -> replay" a round
 * trip rather than a one-way write.
 */
export type CognitivePersistence = {
  readonly persist: (state: LoopState) => Promise<boolean>;
  readonly load: (stateId: string) => Promise<LoopState | null>;
};

/** Stores nothing, says so, and cannot be mistaken for a store that works. */
export const NO_PERSISTENCE: CognitivePersistence = {
  persist: async () => false,
  load: async () => null,
};

/**
 * The provider-error seam. `null` means the runtime has no provider verdict for
 * this failure — a thrown error rather than an HTTP response — and the caller
 * falls back to `fromThrown`, which classifies conservatively as UNKNOWN.
 */
export type ProviderClassifier = (input: {
  readonly status: number | null;
  readonly body: string;
  readonly retryAfterHeader: string | null;
}) => ProviderVerdict | null;

export const NO_PROVIDER_CLASSIFIER: ProviderClassifier = () => null;

export type CognitiveRun = {
  readonly runId: string;
  readonly mode: RunMode;
  readonly model: ModelEngine;
  readonly memory: MemoryStore;
  readonly knowledge: KnowledgeAdapter;
  readonly research: ResearchAdapter;
  readonly tools: ToolRouter;
  readonly verifier: Verifier;
  readonly persistence: CognitivePersistence;
  readonly classifier: ProviderClassifier;
  readonly clock: Clock;
  readonly budgets: Budgets;
  readonly retryBudgets: RetryBudgets;
  readonly backoff: BackoffPolicy;
  /**
   * Jitter in [0,1], as a SEAM. `Math.random` is banned in this tree because it
   * destroys replay, so the runtime supplies randomness and the default supplies
   * none. A run with no jitter is a run whose backoff is exactly reproducible,
   * which is the correct default for a kernel; spreading concurrent retries is
   * the runtime's job because only the runtime knows there are any.
   */
  readonly jitter: () => number;
};

export type RunDraft = Partial<Omit<CognitiveRun, "runId">> & { readonly runId: string };

/**
 * Every default here REFUSES rather than approximates — no engine, no router,
 * no research, no persistence, no provider classification. A run assembled with
 * none of them still traverses all 23 stations, reasons about nothing, acts on
 * nothing, and says so at every station that wanted something it did not get.
 */
export function makeRun(draft: RunDraft): CognitiveRun {
  return {
    runId: draft.runId,
    mode: draft.mode ?? "shadow",
    model: draft.model ?? (REFUSING_ENGINE as Engine),
    memory: draft.memory ?? EMPTY_MEMORY,
    knowledge: draft.knowledge ?? EMPTY_KNOWLEDGE,
    research: draft.research ?? NO_RESEARCH,
    tools: draft.tools ?? (REFUSING_ROUTER as ToolRouter),
    verifier: draft.verifier ?? NO_VERIFIER,
    persistence: draft.persistence ?? NO_PERSISTENCE,
    classifier: draft.classifier ?? NO_PROVIDER_CLASSIFIER,
    clock: draft.clock ?? deterministicClock(),
    budgets: draft.budgets ?? DEFAULT_BUDGETS,
    retryBudgets: draft.retryBudgets ?? DEFAULT_RETRY_BUDGETS,
    backoff: draft.backoff ?? DEFAULT_BACKOFF,
    jitter: draft.jitter ?? (() => 0),
  };
}

/** Section 2's `status` and `iteration`, read from where they actually live. */
export function runProgress(state: LoopState): {
  readonly status: LoopState["status"];
  readonly iteration: number;
} {
  return { status: state.status, iteration: state.iteration };
}
