/**
 * ONIQ AGI Mega Quantum Loop — the SEAMS. Owner brief sections 16, 19, 30, 31, 32.
 *
 * THE KERNEL NEVER IMPORTS A NETWORK, AND THAT SURVIVES THE MODEL BEING WIRED
 * IN. Everything that can spend money, change the world or read a clock arrives
 * as an ARGUMENT with a fail-closed default, the way `actuator` already did in
 * v1.1. So `src/oqca/**` keeps the guarantee `security.test.ts` asserts over the
 * whole tree — no fetch, no credential, no shell, no clock — while the loop
 * above it drives a real model and takes real actions, because the real
 * implementations live OUTSIDE this directory and are handed in.
 *
 * That is not a technicality. It is the only arrangement in which "the loop can
 * make production writes" and "the kernel provably cannot reach anything" are
 * both true, and it means the 25 banned shapes stay banned in the place where a
 * mistake would be invisible.
 *
 * EVERY DEFAULT REFUSES. Brief section 19: "Every action requires
 * authorization, tool permission, budget, audit record." A default that
 * performed the action would make three of those four optional, and CLAUDE.md's
 * standing rule is that a default is not a decision (2026-09-05). So an
 * unconfigured loop is a loop that reasons and acts on nothing, and says which
 * seam was missing.
 */

/** What a caller must be able to say about a spend before it happens. */
export type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** What this call cost, in USD. Zero for a seam that cannot spend. */
  readonly costUsd: number;
};

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/* ------------------------------------------------------------------ *
 * THE MODEL LAYER — brief section 30.
 * ------------------------------------------------------------------ */

/**
 * Which station is asking. The router upstream may pick a different model per
 * kind (section 30: "reasoning / vision / coding"), and the loop records which
 * station spent what, so a bill can be read back to a phase rather than to a
 * total — the failure the September story-plot bill had (CLAUDE.md 2026-09-05).
 */
export type EngineKind =
  "understand" | "reason" | "verify" | "imagine" | "evaluate" | "reflect" | "respond";

export type EngineRequest = {
  readonly kind: EngineKind;
  readonly prompt: string;
  /** A hard ceiling for THIS call, already reduced by what the run has spent. */
  readonly maxOutputTokens: number;
};

export type EngineReply = {
  readonly ok: boolean;
  readonly text: string;
  readonly usage: Usage;
  /** The id that actually answered. Never assumed — read from the reply. */
  readonly model: string;
  /** Present when ok is false. The provider's own words, never a status code. */
  readonly reason?: string;
};

export type Engine = (req: EngineRequest) => Promise<EngineReply>;

/**
 * The default, and the reason it is a refusal rather than a stub that returns
 * plausible text: a loop whose REASON station silently invents its own answer
 * is indistinguishable from one that is working, and every downstream station
 * would treat the invention as evidence.
 */
export const REFUSING_ENGINE: Engine = async (req) => ({
  ok: false,
  text: "",
  usage: NO_USAGE,
  model: "none",
  reason: `no engine configured: ${req.kind} cannot run`,
});

/* ------------------------------------------------------------------ *
 * THE TOOL LAYER — brief sections 16, 19, 31.
 * ------------------------------------------------------------------ */

/**
 * An intended action, declared BEFORE it runs so section 15 (EVALUATE) can
 * refuse it. `reversible` and `touchesProduction` are the two properties
 * section 18 asks about by name, and they are on the REQUEST rather than
 * discovered from the result, because "is this reversible" is not a question
 * you may answer after the fact.
 */
export type ToolCall = {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly reversible: boolean;
  readonly touchesProduction: boolean;
  /** Why the loop believes this action serves the goal. Audited verbatim. */
  readonly rationale: string;
};

export type ToolResult = {
  readonly ok: boolean;
  /** What the tool returned. NOT evidence that the world changed. */
  readonly output: string;
  /**
   * What the ENVIRONMENT says afterwards — section 20: "Never assume the action
   * succeeded... The environment is the authority." A router that echoes its
   * own `output` here is lying to station 17, so the field is separate and the
   * loop compares them.
   */
  readonly observed: string;
  readonly usage: Usage;
  readonly reason?: string;
};

export type ToolRouter = (call: ToolCall) => Promise<ToolResult>;

export const REFUSING_ROUTER: ToolRouter = async (call) => ({
  ok: false,
  output: "",
  observed: "nothing was attempted",
  usage: NO_USAGE,
  reason: `no tool router configured: ${call.tool} cannot run`,
});

/**
 * RECORD-ONLY. v1.1's default, kept under its own name because it is the right
 * choice for any run that is exercising the reasoning and not the acting: it
 * completes the station, spends nothing, and reports honestly that the world
 * was not touched.
 */
export const RECORD_ONLY_ROUTER: ToolRouter = async (call) => ({
  ok: true,
  output: `recorded intent: ${call.tool}`,
  observed: "not performed — record-only router",
  usage: NO_USAGE,
});

/* ------------------------------------------------------------------ *
 * TIME — brief section 32 (maxExecutionTime).
 * ------------------------------------------------------------------ */

/**
 * A clock is a SEAM because the kernel may not read one. `transition.ts` says
 * why in full: a wall-clock reading inside a hashed record makes every replay
 * produce a different state id, which destroys the property section 3 asks for.
 *
 * So the default advances a counter by a fixed step — deterministic, replayable,
 * and honest about what it is — and a real runtime passes a real clock whose
 * readings are RECORDED in the log, so a replay can be driven from the
 * recording rather than from a second, different, real clock.
 */
export type Clock = () => number;

export const DETERMINISTIC_CLOCK_STEP_MS = 100;

export function deterministicClock(stepMs = DETERMINISTIC_CLOCK_STEP_MS): Clock {
  let t = 0;
  return () => (t += stepMs);
}

/* ------------------------------------------------------------------ *
 * MEMORY — brief sections 6 and 24.
 * ------------------------------------------------------------------ */

export type MemoryLayer = "working" | "episodic" | "semantic" | "procedural";

export type MemoryRecord = {
  readonly id: string;
  readonly layer: MemoryLayer;
  readonly text: string;
  /** How much this is trusted. Section 24: only validated information durables. */
  readonly confidence: number;
};

/**
 * Retrieval is RELEVANCE-BASED by contract, not by convention — section 6:
 * "Memory retrieval must be relevance-based rather than dumping the entire
 * history into the model." `limit` is therefore required rather than optional,
 * so a store cannot satisfy the interface by returning everything.
 */
export type MemoryStore = {
  readonly recall: (query: string, limit: number) => Promise<readonly MemoryRecord[]>;
  readonly consolidate: (records: readonly MemoryRecord[]) => Promise<number>;
};

/** Remembers nothing and says so. A loop with no memory is not a broken loop. */
export const EMPTY_MEMORY: MemoryStore = {
  recall: async () => [],
  consolidate: async () => 0,
};

/* ------------------------------------------------------------------ *
 * BUDGETS — brief section 32, all seven.
 * ------------------------------------------------------------------ */

export type Budgets = {
  readonly maxIterations: number;
  readonly maxStateTransitions: number;
  readonly maxToolCalls: number;
  readonly maxResearchOperations: number;
  readonly maxTokens: number;
  readonly maxExecutionTimeMs: number;
  /** In USD. */
  readonly maxCostUsd: number;
};

/**
 * THE SPENDING BOUNDS DEFAULT TO ZERO. THE RUNAWAY GUARD DOES NOT, AND THE
 * DIFFERENCE IS THE POINT.
 *
 * v1.1 carried four bounds; the brief asks for seven. Three of the additions
 * were called "money bounds" in the first draft of this file and that was
 * wrong: `maxTokens` and `maxCostUsd` are money, `maxExecutionTimeMs` is a
 * runaway guard. What a run may COST is a spend decision and therefore the
 * owner's under CLAUDE.md's first rule, so it is not a number an agent picks —
 * `health_config.ai_daily_cap_house` shipped as 0 for exactly this reason.
 *
 * A zero TIME bound is different, and a test caught it: it does not fail
 * closed, it fails DEAD — the run halts at station 1 before it has perceived
 * anything. A default nobody can run is a default somebody raises wholesale,
 * and they will take the two money bounds with it. So time carries a real,
 * modest ceiling and only the things that spend start at refuse.
 *
 * The consequence is stated rather than discovered: with these defaults the
 * loop runs all 23 stations, reasons about nothing, acts on nothing, and ends
 * `budget_exhausted` naming the bound. That is the correct behaviour for an
 * unconfigured system that can spend.
 */
export const DEFAULT_BUDGETS: Budgets = {
  maxIterations: 4,
  maxStateTransitions: 128,
  maxResearchOperations: 8,
  /** Money and world-change. Zero = refuse; the owner sets these. */
  maxToolCalls: 0,
  maxTokens: 0,
  maxCostUsd: 0,
  /** A runaway guard, not a spend. Non-zero so the loop is runnable. */
  maxExecutionTimeMs: 60_000,
};

export type Spent = {
  readonly iterations: number;
  readonly transitions: number;
  readonly toolCalls: number;
  readonly researchOperations: number;
  readonly tokens: number;
  readonly elapsedMs: number;
  readonly costUsd: number;
};

export const NO_SPEND: Spent = {
  iterations: 0,
  transitions: 0,
  toolCalls: 0,
  researchOperations: 0,
  tokens: 0,
  elapsedMs: 0,
  costUsd: 0,
};

/** Which bound stopped a run, or null while every one of them still holds. */
export type BoundBreach =
  | "max_iterations"
  | "max_state_transitions"
  | "max_tool_calls"
  | "max_research_operations"
  | "max_tokens"
  | "max_execution_time"
  | "max_cost";

/**
 * THE BOUNDS ARE TWO KINDS AND CONFLATING THEM HALTS A LOOP THAT SHOULD RUN.
 * Found by a test: with `maxToolCalls: 0` — the correct default for a loop that
 * may not act — a single top-of-station `breach` check stopped the run at
 * station 1, so an unconfigured loop could not even PERCEIVE.
 *
 * A bound on the RUN (transitions, elapsed time, iterations) is fatal: the run
 * itself has no room left. A bound on a CAPABILITY (tools, research, tokens,
 * cost) refuses that capability at its own gate and lets every station that
 * does not need it carry on. A loop with no money can still read its percepts,
 * fold in evidence the caller supplied, and answer with what it has.
 */
export function breachRun(spent: Spent, budgets: Budgets): BoundBreach | null {
  if (spent.transitions >= budgets.maxStateTransitions) return "max_state_transitions";
  if (spent.elapsedMs >= budgets.maxExecutionTimeMs) return "max_execution_time";
  return null;
}

/**
 * Every bound, in a fixed order so the answer is deterministic when two break
 * at once. Used by the capability gates and by `wouldBreach`.
 */
export function breach(spent: Spent, budgets: Budgets): BoundBreach | null {
  if (spent.iterations >= budgets.maxIterations) return "max_iterations";
  if (spent.transitions >= budgets.maxStateTransitions) return "max_state_transitions";
  if (spent.researchOperations >= budgets.maxResearchOperations) return "max_research_operations";
  if (spent.toolCalls >= budgets.maxToolCalls) return "max_tool_calls";
  if (spent.tokens >= budgets.maxTokens) return "max_tokens";
  if (spent.elapsedMs >= budgets.maxExecutionTimeMs) return "max_execution_time";
  if (spent.costUsd >= budgets.maxCostUsd) return "max_cost";
  return null;
}

/**
 * Would THIS call cross a bound? The gate for a spend whose size is known in
 * advance — a model call's output ceiling, a tool's quoted cost. The health
 * gateway's lesson applies exactly: nothing may spend before it can price, so a
 * caller that cannot estimate passes 0 and is bounded only by what it has
 * already spent.
 *
 * IT CONSULTS THE RUN BOUNDS AND THE DIMENSIONS BEING SPENT, AND NOTHING ELSE.
 * The first draft called `breach` first, which checks every bound in a fixed
 * order — so a model call under a zero TOOL budget was refused with
 * `max_tool_calls`, naming a bound that has nothing to do with talking to a
 * model. A gate that reports the wrong bound sends whoever reads the log to
 * raise the wrong number, and the number they would have raised is the one that
 * governs writing to production.
 */
export function wouldBreach(
  spent: Spent,
  budgets: Budgets,
  add: { readonly tokens?: number; readonly costUsd?: number },
): BoundBreach | null {
  const run = breachRun(spent, budgets);
  if (run) return run;
  if (spent.tokens + (add.tokens ?? 0) > budgets.maxTokens) return "max_tokens";
  // NOTHING MAY SPEND BEFORE IT CAN PRICE, and a caller that cannot estimate
  // must not therefore be treated as free. The first draft compared
  // `spent + (add.costUsd ?? 0) > max`, so a call with no estimate passed a
  // budget of ZERO — the one number that unambiguously means "no money" — and
  // the engine was called. Any attempted spend now requires headroom to exist.
  if (spent.costUsd >= budgets.maxCostUsd) return "max_cost";
  if (spent.costUsd + (add.costUsd ?? 0) > budgets.maxCostUsd) return "max_cost";
  return null;
}

/**
 * THE STATED LIMIT, because it is real and bounded rather than fixed. A model
 * call's true cost is known only from its reply, so a caller with no price
 * table can cross the ceiling by at most ONE call before the next gate refuses.
 * The health gateway closes that with `PRICE_PER_1M` and an `unpriced_model`
 * refusal; this loop has no price table yet, so the overshoot is one call and
 * it is written down rather than discovered from a bill.
 */
export const COST_OVERSHOOT_CALLS = 1;

export function addUsage(spent: Spent, usage: Usage): Spent {
  return {
    ...spent,
    tokens: spent.tokens + usage.inputTokens + usage.outputTokens,
    costUsd: spent.costUsd + usage.costUsd,
  };
}
