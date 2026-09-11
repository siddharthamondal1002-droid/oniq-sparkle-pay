/**
 * OQCA v1.6 — CAPABILITY STATE. Owner directive 2026-09-10:
 * "COGNITIVE AUTONOMY != RESOURCE AVAILABILITY... 'budget = 0' must NOT mean
 * 'autonomous runtime = stopped'. It should mean only that a particular
 * resource-consuming action cannot currently execute."
 *
 * WHAT WAS WRONG BEFORE THIS FILE EXISTED, named exactly so the correction can
 * be checked rather than believed. `cognitiveLoop.ts` carried a run-level
 * `starvedBy: BoundBreach | null`. Any refused model call set it — including
 * the very first one, because `DEFAULT_BUDGETS.maxTokens` is 0 — and CHECK_GOAL
 * turned it into the TERMINAL status `budget_exhausted`. Three more sites did
 * worse and `break outer`'d: RESEARCH on `max_research_operations`, EVALUATE on
 * an unaffordable plan, ACT on `max_tool_calls` or an unaffordable step. So a
 * capability being unavailable ended the whole run, and every station after the
 * refusal — MEASURE, LEARN_OR_CORRECT, CONSOLIDATE, REFLECT, CHECK_GOAL — never
 * ran. A missing resource was being reported as the end of thinking.
 *
 * THE DISTINCTION THIS FILE DRAWS, and it is the whole of the fix:
 *
 *   a RUN bound      transitions, elapsed time, iterations — this run has no
 *                    room left. Fatal, and it always was. `breachRun` names
 *                    exactly these three and nothing else.
 *   a CAPABILITY     tokens, money, tool calls, research operations, an absent
 *                    credential, a refusing provider, a rate limit — a
 *                    particular ACTION cannot execute right now. Recorded, and
 *                    the loop carries on with every station that does not need
 *                    it.
 *
 * `insufficient_allowance` IS NOT `unauthorized`, AND COLLAPSING THEM WOULD BE
 * THE BYPASS THE DIRECTIVE FORBIDS. A zero allowance is ONIQ's own bound, set
 * by the owner and enforced by the gate; an authorization refusal is somebody
 * else's decision about who ONIQ is. Raising a budget must never be able to
 * turn the second into the first, so they are different values and the mapping
 * from a `BoundBreach` can only ever produce the allowance ones.
 */
import type { BoundBreach } from "./seams.ts";
import type { FailureClass } from "../recovery/failure.ts";

/**
 * The CONSEQUENTIAL capabilities — the ones that spend, act, or reach outside
 * ONIQ. Reading the world model, detecting a knowledge gap, ranking what to
 * learn and generating an objective are NOT here, and their absence is the
 * point: none of them consumes anything, so none of them can be unavailable,
 * so none of them may ever be gated on a resource.
 */
export type Capability = "model" | "tool" | "research" | "verification";

export const CAPABILITIES: readonly Capability[] = ["model", "tool", "research", "verification"];

/**
 * WHY A CAPABILITY CANNOT EXECUTE. Every member except `available` is the
 * directive's own list, and each is a statement about a RESOURCE rather than
 * about ONIQ's ability to think.
 */
export type CapabilityAvailability =
  | "available"
  | "unauthorized"
  | "no_credentials"
  | "provider_unavailable"
  | "rate_limited"
  | "resource_unavailable"
  | "insufficient_allowance";

export const AVAILABILITIES: readonly CapabilityAvailability[] = [
  "available",
  "unauthorized",
  "no_credentials",
  "provider_unavailable",
  "rate_limited",
  "resource_unavailable",
  "insufficient_allowance",
];

export type CapabilityState = {
  readonly capability: Capability;
  readonly availability: CapabilityAvailability;
  /** Why, in the words a person reads. Never a code on its own. */
  readonly detail: string;
  /**
   * WHICH allowance, when the reason is one. Null for every other reason —
   * an authorization refusal has no bound to name, and naming one would send
   * whoever reads the log to raise a number that would not help.
   */
  readonly bound: BoundBreach | null;
  /** Where it was discovered. A station name, or null. */
  readonly station: string | null;
};

/** The one state that permits execution. Everything else refuses. */
export function isExecutable(a: CapabilityAvailability): boolean {
  return a === "available";
}

/**
 * WHO CAN CLEAR A SHORTFALL, which is the question a PLANNER needs and
 * `isExecutable` does not answer. Both say "cannot run now"; only this one says
 * whether waiting will ever help.
 *
 * `unauthorized` and `no_credentials` are the two members this file already
 * singles out as somebody else's decision about who ONIQ is — the invariant
 * above is that no BOUND can ever produce them, precisely so that "was this
 * authorized" stays unanswerable by editing a number. Their mirror is that ONIQ
 * cannot clear them either: no budget, no retry and no amount of thinking turns
 * one into `available`. A person must act, so the only work ONIQ can do on such
 * an objective is to REPORT it — and reporting is work it can always do.
 *
 * Everything else clears without a person: an allowance is ONIQ's own number, a
 * rate limit expires, and an unavailable provider or resource comes back. Those
 * are worth deferring. These are worth saying out loud.
 */
export const PERSON_CLEARED: readonly CapabilityAvailability[] = ["unauthorized", "no_credentials"];

export function needsAPerson(a: CapabilityAvailability): boolean {
  return PERSON_CLEARED.includes(a);
}

export function unavailable(states: readonly CapabilityState[]): CapabilityState[] {
  return states.filter((s) => !isExecutable(s.availability));
}

/**
 * A BOUND CAN ONLY EVER PRODUCE AN ALLOWANCE OR A RESOURCE STATE. It cannot
 * produce `unauthorized`, `no_credentials` or `rate_limited`, and that is
 * asserted rather than assumed: those three are somebody else's refusal, and a
 * number ONIQ sets must not be able to speak for them.
 *
 * `unpriced` is `resource_unavailable` rather than an allowance: the adapter
 * could not say what the call would cost, which is a missing PRICE, not a
 * missing budget. Raising every ceiling would not admit it.
 *
 * The three RUN bounds return null: they are not capability states at all, and
 * a caller that reaches here with one has confused the two kinds.
 */
export function availabilityForBound(bound: BoundBreach): CapabilityAvailability | null {
  switch (bound) {
    case "max_tokens":
    case "max_cost":
    case "max_tool_calls":
    case "max_research_operations":
      return "insufficient_allowance";
    case "unpriced":
      return "resource_unavailable";
    case "max_iterations":
    case "max_state_transitions":
    case "max_execution_time":
      return null;
    default: {
      // A NEW BOUND MUST DECLARE WHICH KIND IT IS. The switch is exhaustive
      // over the union, so `tsc` proves no typed caller reaches here — and a
      // bound name replayed from JSON is not a typed caller. v1.1 recorded the
      // same lesson on `applyOperator`: a type that nothing runs is not a guard.
      const never: never = bound;
      throw new Error(`OQCA capability: unclassified bound ${String(never)}`);
    }
  }
}

/**
 * The recovery layer's own vocabulary, mapped once. `AUTHORIZATION` becomes
 * `unauthorized` and `RATE_LIMIT` becomes `rate_limited` — the two places where
 * the loop learns a resource state from a PROVIDER rather than from its own
 * gate, and the reason this mapping exists instead of a second classification.
 */
export function availabilityForFailureClass(cls: FailureClass): CapabilityAvailability {
  switch (cls) {
    case "AUTHORIZATION":
      return "unauthorized";
    case "RATE_LIMIT":
      return "rate_limited";
    case "BUDGET":
      return "insufficient_allowance";
    default:
      return "provider_unavailable";
  }
}

/**
 * A LEDGER, ONE ROW PER CAPABILITY, AND A REFUSAL OUTRANKS A SUCCESS.
 *
 * A run that called the model twice — refused once, answered once — has a model
 * capability that is NOT simply "available": something was refused and the
 * record has to say so, or the accounting the directive asks to stay auditable
 * would quietly drop the half that matters. So an unavailable state replaces an
 * available one and never the other way round, and the FIRST refusal wins over
 * a later one because it is the one that changed what the run could do.
 */
export function recordCapability(
  ledger: ReadonlyMap<Capability, CapabilityState>,
  next: CapabilityState,
): Map<Capability, CapabilityState> {
  const out = new Map(ledger);
  const prior = out.get(next.capability);
  if (prior && !isExecutable(prior.availability)) return out;
  out.set(next.capability, next);
  return out;
}

/** Deterministic order, so two runs over the same events report identically. */
export function capabilityList(
  ledger: ReadonlyMap<Capability, CapabilityState>,
): CapabilityState[] {
  return CAPABILITIES.filter((c) => ledger.has(c)).map((c) => ledger.get(c)!);
}

/**
 * The token a run stops on when the only thing standing between it and its goal
 * is a capability. It is deliberately NOT `budget_exhausted`: that word is the
 * run's OWN allowance running out, and a reader who sees it reaches for a
 * budget. This one names the thing to go and fix, which may be a credential, a
 * provider, a rate limit or an allowance — and the ledger says which.
 */
export const CAPABILITY_UNAVAILABLE = "capability_unavailable";
