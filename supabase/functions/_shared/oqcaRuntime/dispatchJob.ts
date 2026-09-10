/**
 * THE FIRST REAL ONIQ JOB OQCA IS WIRED TO — brief sections 1, 2, 10 and 14.
 *
 * THE JOB: "which queued Story job should be dispatched next, and should one be
 * dispatched at all". It is `story-dispatch`'s decision, and it was chosen by
 * measuring the alternatives rather than by taste:
 *
 *   goal          real, and checkable: a queued film reaches a runner
 *   decision      DISCRETE — one job id out of N, or none — so section 8's
 *                 agreement/disagreement is an equality test, not a diff of
 *                 two pieces of prose
 *   observation   REAL and EXTERNAL: whether a runner actually claimed the job.
 *                 Section 10's "must originate from the actual workflow result"
 *                 is satisfied by reading the row back, not by the model's word
 *   shadow-safe   it is a SCHEDULED job with no user-visible result, so a
 *                 shadow run cannot change any user's outcome by construction
 *   cheap         free today; with the shipped budgets it stays free
 *   safe to act   the production action is a `repository_dispatch`, and
 *                 story-dispatch's own header records why it is safe: "it does
 *                 not claim the job... a dispatch that never lands on a runner
 *                 leaves the job available rather than stranding it"
 *
 * RUNNERS-UP, AND WHY NOT, because section 26 asks for the choice to be
 * recorded rather than asserted:
 *
 *   smart-scout   the richest shape — a goal, web_search as a real tool, real
 *                 external results — but it is a LIVE, PAID, user-facing path
 *                 whose decision is prose. Wrong first integration.
 *   story-sweep   discrete and shadow-safe, but its rule is `age > TTL &&
 *                 has_bytes`. There is nothing to reason about, so a model call
 *                 there would be theatre — and it DELETES, which is the wrong
 *                 direction to be wrong in.
 *   study-tutor   highest volume, lowest stakes, but its "observation" would be
 *                 the model's own answer. Section 10 rules it out.
 *
 * ASSISTED MODE CAN ONLY EVER NARROW. OQCA proposes a job id; `authorize` then
 * requires that the EXISTING rule — queued, and outside its dispatch backoff —
 * independently agrees. So the worst case of a wrong OQCA pick is a film
 * dispatched later than it would have been, never one dispatched that should
 * not have been. Section 9's "the existing authorization boundary remains
 * authoritative" is that intersection, and it is a property of the code rather
 * than a promise about it.
 */
import type { Goal } from "../oqca/knowledge/gaps.ts";
import type { Percept, WorldState } from "../oqca/loop/loopState.ts";
import type { SpendEstimate, ToolCall } from "../oqca/loop/seams.ts";
import type { ToolOutcome, ToolSpec } from "./toolRouter.ts";
import type { VerificationResult } from "./episode.ts";

/** One queued film, as the dispatcher already reads it. */
export type QueuedJob = {
  readonly id: string;
  readonly requestedSeconds: number;
  readonly grade: string | null;
  readonly createdAtMs: number;
  readonly dispatchedAtMs: number | null;
};

/** Mirrored from story-dispatch. `storyDispatchAgreement.test.ts` pins it. */
export const DISPATCH_BACKOFF_MS = 10 * 60 * 1000;

/** The literal the loop uses for "dispatch nothing this tick". */
export const HOLD_ACTION = "hold: dispatch nothing this tick";

export const DISPATCH_PREFIX = "dispatch story job ";

export function actionFor(jobId: string): string {
  return `${DISPATCH_PREFIX}${jobId}`;
}

export function jobIdFrom(action: string): string | null {
  return action.startsWith(DISPATCH_PREFIX) ? action.slice(DISPATCH_PREFIX.length) : null;
}

/**
 * IS THIS JOB DISPATCHABLE RIGHT NOW? The existing rule, and the ONLY authority
 * on the question.
 *
 * It is a pure function of the row and the clock precisely so the same
 * expression can be the production decision AND the authorization check — one
 * rule, asked twice, rather than two rules that must agree.
 */
export function isDispatchable(job: QueuedJob, nowMs: number): boolean {
  return job.dispatchedAtMs === null || job.dispatchedAtMs < nowMs - DISPATCH_BACKOFF_MS;
}

/**
 * WHAT story-dispatch DOES TODAY, reproduced exactly: the oldest queued job
 * that is outside its backoff, or none.
 *
 * `&order=created_at.asc&limit=1` in PostgREST, and a tie broken by id so the
 * comparison in section 8 cannot disagree because two rows share a timestamp.
 */
export function productionChoice(queue: readonly QueuedJob[], nowMs: number): string | null {
  const eligible = queue.filter((j) => isDispatchable(j, nowMs));
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id))[0]
    .id;
}

export const DISPATCH_GOAL: Goal = {
  id: "story-dispatch",
  statement:
    "every queued Story film reaches a runner promptly, and no film is asked " +
    "for twice while a runner may still be starting on it",
  // WHAT THE GOAL CANNOT BE MET WITHOUT. `detectGaps` scores each of these by
  // importance x uncertainty x dependency x expected information gain, so an
  // importance here is a real weight on what RESEARCH would go after — not
  // decoration. Runner availability leads because it is the one thing this
  // function genuinely cannot see: story-dispatch's own header records a film
  // sitting `queued` for half an hour while the GPU sat warm and idle.
  requires: [
    { conceptId: "queue-eligibility", importance: 1 },
    { conceptId: "runner-availability", importance: 0.9 },
    { conceptId: "dispatch-backoff", importance: 0.7 },
  ],
};

/**
 * The world, as small as the goal needs it — section 7: "It models what matters
 * to the current goal."
 *
 * `availableActions` holds one action per DISPATCHABLE job plus the hold. A job
 * inside its backoff appears as an ENTITY (the loop can see it and reason about
 * it) and as an UNAVAILABLE action, which is section 7's second list: named
 * rather than merely absent.
 */
export function worldFrom(queue: readonly QueuedJob[], nowMs: number): WorldState {
  const dispatchable = queue.filter((j) => isDispatchable(j, nowMs));
  const held = queue.filter((j) => !isDispatchable(j, nowMs));
  return {
    entities: queue.map((j) => ({
      id: j.id,
      kind: "story_job",
      properties: {
        grade: j.grade ?? "classic",
        requestedSeconds: String(j.requestedSeconds),
        waitingMinutes: String(Math.max(0, Math.round((nowMs - j.createdAtMs) / 60000))),
        dispatched: j.dispatchedAtMs === null ? "never" : "recently",
      },
      // A queued row says what was ASKED for, never what a runner will do with
      // it, so nothing here is certain and pretending otherwise would make
      // IDENTIFY_GAPS find nothing to be uncertain about.
      uncertainty: 0.5,
    })),
    relations: [],
    availableActions: [...dispatchable.map((j) => actionFor(j.id)), HOLD_ACTION],
    unavailableActions: held.map((j) => `${actionFor(j.id)} (inside its dispatch backoff)`),
  };
}

export function perceptsFrom(queue: readonly QueuedJob[], nowMs: number): Percept[] {
  const dispatchable = queue.filter((j) => isDispatchable(j, nowMs));
  return [
    {
      id: "queue-depth",
      kind: "app_state",
      content: `${queue.length} job(s) queued, ${dispatchable.length} dispatchable now`,
      source: "story_jobs via PostgREST",
    },
    ...queue.map((j) => ({
      id: `job-${j.id}`,
      kind: "app_state" as const,
      content:
        `job ${j.id}: ${j.grade ?? "classic"} grade, ${j.requestedSeconds}s requested, ` +
        `waiting ${Math.max(0, Math.round((nowMs - j.createdAtMs) / 60000))} minute(s), ` +
        `${j.dispatchedAtMs === null ? "never dispatched" : "dispatched recently"}`,
      source: "story_jobs via PostgREST",
    })),
  ];
}

/**
 * WHAT THE LOOP BELIEVES, AS AMPLITUDES: one hypothesis per dispatchable job
 * plus the hold. The basis IS the decision, so `measure` picking the leading
 * hypothesis is the loop's answer and section 8's comparison is `===`.
 */
export function basisFrom(world: WorldState): string[] {
  return [...world.availableActions];
}

/**
 * THE LIKELIHOODS ARE FACTS ABOUT THE QUEUE, NEVER A MODEL'S OPINION — section
 * 11: "Do not fabricate likelihoods. Never silently pad missing likelihoods."
 *
 * One per basis element, computed from the same rows the world was built from,
 * and this function throws rather than padding if the two ever disagree. A
 * padded likelihood is a claim the evidence never made.
 */
export function likelihoodsFrom(
  basis: readonly string[],
  queue: readonly QueuedJob[],
  nowMs: number,
): number[] {
  const byId = new Map(queue.map((j) => [j.id, j]));
  const out = basis.map((label) => {
    if (label === HOLD_ACTION) {
      // Holding is right exactly when nothing is dispatchable. It is kept as a
      // real hypothesis with a real likelihood rather than a special case,
      // because "do nothing" competing on the same terms is what makes the
      // measurement meaningful when the queue is empty.
      const anyDispatchable = queue.some((j) => isDispatchable(j, nowMs));
      return anyDispatchable ? 0.05 : 1;
    }
    const id = jobIdFrom(label);
    const job = id ? byId.get(id) : undefined;
    if (!job) throw new Error(`OQCA dispatch: no queue row for basis element ${label}`);
    // Older is more urgent. A bounded, monotone function of the wait, so a job
    // that has waited an hour outranks one that arrived a minute ago without a
    // long wait ever making the number meaningless.
    const waitMs = Math.max(0, nowMs - job.createdAtMs);
    return 0.1 + 0.9 * (waitMs / (waitMs + DISPATCH_BACKOFF_MS));
  });
  if (out.length !== basis.length) throw new Error("OQCA dispatch: likelihood width mismatch");
  return out;
}

/* ---------------------------------------------------------------- *
 * THE TOOL, AND THE AUTHORIZATION BOUNDARY IT MUST PASS.
 * ---------------------------------------------------------------- */

export type DispatchEnvironment = {
  readonly nowMs: () => number;
  /** The queue, as story-dispatch reads it. */
  readonly readQueue: () => Promise<readonly QueuedJob[]>;
  /** `dispatched_at = now()`, BEFORE the GitHub call — story-dispatch's order. */
  readonly stampDispatched: (jobId: string) => Promise<void>;
  /** The `repository_dispatch`. Returns null on success, else the reason. */
  readonly sendDispatch: (jobId: string) => Promise<string | null>;
  /**
   * READ THE ROW BACK. This is section 10's observation and section 14's
   * verification, and it is the environment's word rather than the tool's.
   */
  readonly readJob: (jobId: string) => Promise<QueuedJob | null>;
};

/**
 * A dispatch costs NOTHING in provider money — it is a PostgREST PATCH and a
 * GitHub API call, both already paid for. Zero is the true price here, not an
 * unpriced call rounded down, and the difference matters: `null` would refuse
 * the action, and refusing a free action for being unpriceable is wrong.
 */
export const DISPATCH_COST: SpendEstimate = { tokens: 0, costUsd: 0 };

export function dispatchTools(queue: readonly QueuedJob[], env: DispatchEnvironment): ToolSpec[] {
  const specs: ToolSpec[] = queue
    .filter((j) => isDispatchable(j, env.nowMs()))
    .map((job) => ({
      name: actionFor(job.id),
      // Reversible: story-dispatch does NOT claim the job. The row stays
      // `queued`, and a dispatch that lands on no runner leaves it available.
      reversible: true,
      // AND IT STILL TOUCHES PRODUCTION. Both are true at once, which is
      // exactly the pair the kernel used to derive one from the other.
      touchesProduction: true,
      estimate: () => DISPATCH_COST,
      authorize: async (call: ToolCall) => {
        const id = jobIdFrom(call.tool);
        if (id === null) return `${call.tool} is not a dispatch action`;
        // RE-READ. The queue OQCA reasoned over is a snapshot, and a snapshot
        // is not authorization: another tick may have dispatched this job
        // while the loop was thinking. The authority is the row now.
        const now = env.nowMs();
        const fresh = await env.readJob(id);
        if (!fresh) return `job ${id} is no longer queued`;
        if (!isDispatchable(fresh, now)) return `job ${id} is inside its dispatch backoff`;
        return null;
      },
      perform: async (call: ToolCall): Promise<ToolOutcome> => {
        const id = jobIdFrom(call.tool)!;
        // Stamped BEFORE the send, exactly as story-dispatch does it: an
        // un-stamped row is re-dispatched a minute later, which is the storm
        // the backoff exists to prevent. Ten minutes late is the safe
        // direction to be wrong in.
        await env.stampDispatched(id);
        const failure = await env.sendDispatch(id);
        const after = await env.readJob(id);
        const observed =
          after === null
            ? `job ${id} is no longer in the queue`
            : after.dispatchedAtMs === null
              ? `job ${id} is still queued with no dispatch stamp`
              : `job ${id} is queued and stamped dispatched`;
        return failure === null
          ? { ok: true, output: `dispatched ${id}`, observed, costUsd: 0 }
          : { ok: false, output: "", observed, costUsd: 0, reason: failure };
      },
    }));
  specs.push({
    name: HOLD_ACTION,
    reversible: true,
    touchesProduction: false,
    estimate: () => DISPATCH_COST,
    authorize: async () => null,
    perform: async () => ({
      ok: true,
      output: "held",
      // A HOLD IS A REAL OUTCOME, NOT A NON-EVENT, so it says what it observed
      // rather than borrowing the router's "not performed" wording — which
      // OBSERVE reads as an unmatched prediction.
      observed: "nothing was dispatched this tick, which is what was chosen",
      costUsd: 0,
    }),
  });
  return specs;
}

/**
 * SECTION 14 — the verifier for THIS goal, and there is no universal one.
 *
 * The goal is that a queued film reaches a runner. What can be checked from
 * here, immediately after a dispatch, is narrower than that and says so:
 *
 *   verified            the job left the queue — a runner claimed it
 *   partially_verified  the job is stamped and still queued: the dispatch went
 *                       out and the runner has not started yet, which is the
 *                       ordinary case within the first ~90 seconds
 *   rejected            the job is queued with NO stamp: the dispatch did not
 *                       happen
 *   unverified          nothing could be read back
 *
 * `partially_verified` is not a hedge. Claiming `verified` on a stamp would
 * make this station report the tool's own action back to itself, which is the
 * exact failure section 14 exists to prevent.
 */
export function makeVerifier(
  chosen: string | null,
  env: DispatchEnvironment,
): () => Promise<VerificationResult> {
  return async () => {
    if (chosen === null || chosen === HOLD_ACTION) {
      const queue = await env.readQueue();
      const now = env.nowMs();
      const dispatchable = queue.filter((j) => isDispatchable(j, now));
      return dispatchable.length === 0
        ? { verdict: "verified", detail: "nothing was dispatchable, and nothing was dispatched" }
        : {
            verdict: "rejected",
            detail: `${dispatchable.length} job(s) were dispatchable and none was dispatched`,
          };
    }
    const id = jobIdFrom(chosen);
    if (id === null) return { verdict: "unverified", detail: `${chosen} is not a dispatch action` };
    const after = await env.readJob(id);
    if (after === null) {
      return { verdict: "verified", detail: `job ${id} left the queue: a runner claimed it` };
    }
    if (after.dispatchedAtMs !== null) {
      return {
        verdict: "partially_verified",
        detail: `job ${id} is stamped dispatched and still queued: no runner has claimed it yet`,
      };
    }
    return { verdict: "rejected", detail: `job ${id} is queued with no dispatch stamp` };
  };
}
