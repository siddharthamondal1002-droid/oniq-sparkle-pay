/**
 * THE EPISODE, THE VERDICT AND THE RESPONSE CLASS — brief sections 13, 14, 16
 * and 17.
 *
 * `createdAt` IS ON THE EPISODE AND IN NOTHING THAT IS HASHED. Section 13 says
 * so by name, and `transition.ts` already explains the failure it prevents: a
 * wall-clock reading inside a hashed record makes every replay produce a
 * different state id. The episode is a REPORT about a run, not part of the
 * run's state, so a timestamp is safe here and only here.
 */
import { ESCALATION_REQUIRED } from "../oqca/loop/cognitiveLoop.ts";
import type { LoopRun, StationRecord } from "../oqca/loop/cognitiveLoop.ts";
import type { Outcome, Prediction } from "../oqca/loop/loopState.ts";
import type { ModelCallRecord } from "./engine.ts";
import type { ToolCallRecord } from "./toolRouter.ts";

/* ---------------------------------------------------------------- *
 * SECTION 14 — verification.
 * ---------------------------------------------------------------- */

export type Verdict = "verified" | "partially_verified" | "unverified" | "rejected";

export const VERDICTS: readonly Verdict[] = [
  "verified",
  "partially_verified",
  "unverified",
  "rejected",
];

export type VerificationResult = {
  readonly verdict: Verdict;
  /** Why, in words a person reads. Never a code. */
  readonly detail: string;
};

/**
 * SECTION 14 SAYS "DO NOT INVENT A UNIVERSAL VERIFIER", so there isn't one.
 * A verifier belongs to the JOB — only the job knows what its own goal being
 * met looks like — and this is the shape one must have.
 *
 * It takes what the environment says, never what the loop believes: a verifier
 * handed the loop's own claims would confirm them every time, which is the
 * failure mode this station exists to catch.
 */
export type Verifier = () => Promise<VerificationResult>;

/**
 * The verdict when nothing could be checked.
 *
 * `unverified` and not `rejected`: the difference is real and collapsing it
 * would poison LEARN. `rejected` means the goal was checked and NOT met;
 * `unverified` means it could not be checked. A run that records "could not
 * check" as "failed" teaches the loop to avoid actions that may have worked.
 */
export const NOT_CHECKED: VerificationResult = {
  verdict: "unverified",
  detail: "nothing was checked: no verifier could read the environment back",
};

/* ---------------------------------------------------------------- *
 * SECTION 17 — how the run ended, for a person.
 * ---------------------------------------------------------------- */

export type ResponseClass = "completed" | "partially_completed" | "blocked" | "failed";

/**
 * FOUR OUTCOMES AND THEY ARE NOT A SEVERITY SCALE. `blocked` is the one that
 * earns its own name: it says the loop was PREVENTED — a budget, a permission,
 * a mode — rather than that it tried and could not. Reading a refusal as a
 * failure is what makes an operator go looking for a bug instead of raising a
 * bound, and this repo has spent whole days on exactly that mistake.
 */
export function classifyResponse(run: LoopRun, verdict: Verdict): ResponseClass {
  const BLOCKING = new Set([
    "max_tokens",
    "max_cost",
    "max_tool_calls",
    "max_research_operations",
    "max_execution_time",
    "max_state_transitions",
    "max_iterations",
    "unpriced",
    "budget_exhausted",
    // Level 7 asked for a person and a scheduled tick has none. PREVENTED,
    // not failed — which is the distinction this set exists to draw.
    ESCALATION_REQUIRED,
  ]);
  if (BLOCKING.has(run.terminated)) return "blocked";
  if (verdict === "verified") return "completed";
  if (verdict === "partially_verified") return "partially_completed";
  if (verdict === "rejected") return "failed";
  // `unverified` with a clean termination: the loop ran and nothing could be
  // checked. Not a failure, and emphatically not a completion.
  return "partially_completed";
}

/* ---------------------------------------------------------------- *
 * SECTION 16 — reflection, as an EPISODE ATTRIBUTE and nothing more.
 * ---------------------------------------------------------------- */

export type Reflection = {
  readonly lessons: readonly string[];
  readonly reusablePatterns: readonly string[];
  /** What the loop would want changed. A SUGGESTION; nothing applies it. */
  readonly candidateImprovements: readonly string[];
};

/**
 * SECTION 22, ENFORCED BY THERE BEING NOWHERE TO PUT IT. Reflection produces
 * three lists of strings. It cannot modify source, prompts, model routing,
 * security policy, budgets, flags, or deploy anything — not because a branch
 * declines to, but because a string array has no such power and nothing in this
 * module writes anywhere. The report is the only consumer.
 */
export function reflectFrom(
  log: readonly StationRecord[],
  outcomes: readonly Outcome[],
  verdict: Verdict,
): Reflection {
  const refusals = log.filter((r) => r.refused !== null);
  const lessons: string[] = [];
  const patterns: string[] = [];
  const improvements: string[] = [];

  // Lessons are drawn from what HAPPENED, never from what a model said about
  // it. A model-authored lesson is an unverified claim that would be stored as
  // if it were an observation.
  const byReason = new Map<string, number>();
  for (const r of refusals) byReason.set(r.refused!, (byReason.get(r.refused!) ?? 0) + 1);
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lessons.push(`${n} station(s) refused with ${reason}`);
    if (reason.startsWith("max_") || reason === "unpriced") {
      improvements.push(`raise or configure the bound reported as ${reason}`);
    }
  }
  const unmatched = outcomes.filter((o) => !o.matched);
  if (outcomes.length > 0) {
    lessons.push(
      `${outcomes.length - unmatched.length}/${outcomes.length} action(s) matched their prediction`,
    );
    if (unmatched.length === 0)
      patterns.push("every predicted action was confirmed by the environment");
  }
  if (verdict === "rejected")
    improvements.push("the goal was checked and not met — the plan shape is wrong, not the bounds");
  if (lessons.length === 0)
    lessons.push("the run completed with no refusals and nothing to observe");
  return { lessons, reusablePatterns: patterns, candidateImprovements: improvements };
}

/* ---------------------------------------------------------------- *
 * SECTION 13 — the episode record.
 * ---------------------------------------------------------------- */

export type Episode = {
  readonly runId: string;
  readonly goal: string;
  readonly initialStateId: string;
  readonly finalStateId: string;
  readonly observations: readonly string[];
  readonly actions: readonly ToolCallRecord[];
  readonly predictions: readonly Prediction[];
  readonly actualOutcomes: readonly Outcome[];
  readonly verdict: Verdict;
  readonly verification: string;
  readonly responseClass: ResponseClass;
  readonly success: boolean;
  readonly failureReason: string | null;
  readonly lessons: readonly string[];
  readonly reusablePatterns: readonly string[];
  readonly candidateImprovements: readonly string[];
  readonly modelCalls: readonly ModelCallRecord[];
  readonly toolCalls: number;
  readonly estimatedCostUsd: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly terminated: string;
  /** NOT hashed, NOT part of any state id. Section 13, in its own words. */
  readonly createdAt: string;
};

export function buildEpisode(args: {
  runId: string;
  goal: string;
  initialStateId: string;
  run: LoopRun;
  verification: VerificationResult;
  modelCalls: readonly ModelCallRecord[];
  toolCalls: readonly ToolCallRecord[];
  durationMs: number;
  createdAt: string;
}): Episode {
  const { run, verification } = args;
  const responseClass = classifyResponse(run, verification.verdict);
  const reflection = reflectFrom(run.log, run.state.outcomes, verification.verdict);
  return {
    runId: args.runId,
    goal: args.goal,
    initialStateId: args.initialStateId,
    finalStateId: run.state.stateId,
    observations: run.state.percepts.map((p) => `${p.kind}: ${p.content}`),
    actions: args.toolCalls,
    predictions: run.state.predictions,
    actualOutcomes: run.state.outcomes,
    verdict: verification.verdict,
    verification: verification.detail,
    responseClass,
    success: responseClass === "completed",
    // FAILURE REASON IS THE TERMINATION, NOT A NARRATIVE. `terminated` is what
    // the loop actually reported; a sentence composed here would be a second,
    // softer account of the same event and the two would drift.
    failureReason: responseClass === "completed" ? null : run.terminated,
    lessons: reflection.lessons,
    reusablePatterns: reflection.reusablePatterns,
    candidateImprovements: reflection.candidateImprovements,
    modelCalls: args.modelCalls,
    toolCalls: args.toolCalls.length,
    estimatedCostUsd: args.modelCalls.reduce((s, c) => s + c.estimatedCostUsd, 0),
    costUsd: run.spent.costUsd,
    durationMs: args.durationMs,
    terminated: run.terminated,
    createdAt: args.createdAt,
  };
}
