/**
 * ONE COMPLETE EXECUTION, ASSERTED — brief sections 8, 19 and 23.
 *
 * `scripts/oqca-shadow-run.ts` is the same run as a command, and it writes its
 * artifacts to `docs/oqca/shadow-run/`. This is the same traversal held to its
 * measured properties, so the five defects that run surfaced cannot come back
 * quietly. Every one of them shipped GREEN: tsc passed, the suite passed, no
 * station refused, and the loop was silently wrong.
 *
 * The queue is a fixture and the provider is a recorded reply — this container
 * cannot reach production and a live model call is a spend nobody authorised
 * for a test. What is REAL here is everything else: the loop, the engine
 * adapter, the router, the job, the verifier, the pricing, the chain and the
 * replay.
 */
import { describe, expect, it } from "vitest";
import {
  initialState,
  quantumFor,
  replayChain,
  runShadow,
} from "../../../supabase/functions/_shared/oqcaRuntime/shadow";
import {
  DISPATCH_GOAL,
  basisFrom,
  productionChoice,
  worldFrom,
} from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob";
import { DEFAULT_BUDGETS } from "../loop/seams.ts";
import { fakeEnv, job, reply, T0 } from "./runtimeFixtures";

/** Three shapes on purpose: long-waiting, fresh, and inside its backoff. */
const QUEUE = [job("8f2c1a", 41), job("b71e04", 9), job("c0d933", 6, 2)];

const BUDGETS = {
  ...DEFAULT_BUDGETS,
  // EXPLICIT FINITE VALUES — section 21. None is a production ceiling and none
  // is written into the kernel.
  maxTokens: 200_000,
  maxCostUsd: 0.05,
  maxToolCalls: 4,
  maxExecutionTimeMs: 20_000,
};

const RECORDED =
  "dispatch story job 8f2c1a | a runner claims it | 0.1 | 0.9\n" +
  "dispatch story job b71e04 | a runner claims it | 0.1 | 0.4\n" +
  "hold: dispatch nothing this tick | nothing moves | 0.0 | 0.1";

const provider = async () => reply(RECORDED, 220, 60);

async function execute(mode: "shadow" | "assisted" = "shadow") {
  const env = fakeEnv(QUEUE);
  const out = await runShadow({ runId: "run-1", mode, env, call: provider, budgets: BUDGETS });
  return { env, out };
}

describe("a real ONIQ job traverses all 23 stations", () => {
  it("reaches a DECISION, and it is a strict maximum rather than a tie", async () => {
    const { out } = await execute();
    expect(out.comparison.oqcaDecision).toBe("dispatch story job 8f2c1a");
    expect(out.comparison.undecidedReason).toBeNull();
    // v1.1: a label at margin 0 is a fact about basis ORDER, not the evidence.
    expect(out.comparison.oqcaMargin).toBeGreaterThan(0.5);
    expect(out.comparison.oqcaConfidence).toBeGreaterThan(0.5);
  });

  it("and agrees with what story-dispatch would have picked", async () => {
    const { out } = await execute();
    expect(out.comparison.productionDecision).toBe(productionChoice(QUEUE, T0));
    expect(out.comparison.agreed).toBe(true);
  });

  it("ranks the ACTIONS, not the goal's prerequisites", async () => {
    // SUPERPOSE admits one hypothesis per `goal.requires`, so by MEASURE the
    // basis holds actions AND prerequisites. Ranking all of them together asks
    // "which of these six is most likely" where three are things to do and
    // three are things the goal needs — a category error that ties forever.
    const { out } = await execute();
    const basis = out.run.quantum.basis;
    for (const req of DISPATCH_GOAL.requires) expect(basis).toContain(req.conceptId);
    expect(out.comparison.oqcaDecision).not.toBe(DISPATCH_GOAL.requires[0].conceptId);
  });

  it("folds evidence on EVERY iteration, not just the first", async () => {
    const { out } = await execute();
    const updates = out.run.log.filter((r) => r.station === "UPDATE_STATE");
    expect(updates.length).toBeGreaterThan(1);
    for (const u of updates) expect(u.note).toMatch(/evidence folded in/);
  });

  it("writes NOTHING to production, and refuses by the mode", async () => {
    const { env, out } = await execute();
    // THE ONLY TWO ASSERTIONS THAT MATTER, and they are about the WORLD rather
    // than about the loop's bookkeeping: no dispatch was sent, no row stamped.
    expect(env.sent).toEqual([]);
    expect(env.stamped).toEqual([]);
    expect(out.comparison.toolsRefused).toBeGreaterThan(0);
  });

  it("replans a shadow-refused dispatch onto the hold, and the hold is what runs", async () => {
    /* ------------------------------------------------------------------ *
     * THIS ASSERTION REPLACES `toolAttempts === 0`, AND THE CHANGE IS THE
     * RECOVERY LOOP WORKING RATHER THAN A REGRESSION.
     *
     * Before the failure brief was implemented, a shadow-mode refusal ended
     * the plan: the dispatch was refused, nothing else was tried, and zero
     * tools were attempted. Now the refusal is classified TOOL, `decideRecovery`
     * returns `replan` (no alternate is registered for a plan step), the
     * refused action is WITHDRAWN, and PLAN picks the next candidate — which
     * is the hold, the one action shadow mode permits because it touches
     * nothing.
     *
     * So a tool IS attempted, and it is the one that writes nothing. Pinning
     * `toolAttempts === 0` would have pinned the pre-recovery behaviour and
     * made this improvement read as a break.
     * ------------------------------------------------------------------ */
    const { env, out } = await execute();
    // One action refused by the mode, one attempted after the replan.
    expect(out.comparison.toolsRefused).toBeGreaterThan(0);
    expect(out.comparison.toolAttempts).toBeGreaterThan(0);
    // And the one that ran is the HOLD, identified by the observation only it
    // produces — the loop's own record, not the router's bookkeeping.
    expect(
      out.run.state.outcomes.some((o) => /nothing was dispatched this tick/.test(o.observed)),
    ).toBe(true);
    // The refusal that caused the replan is on the hashed record, not
    // merely in the log — failure brief section 20.
    const failures = out.run.state.failures;
    expect(failures.some((f) => f.class === "TOOL")).toBe(true);
    expect(failures.some((f) => f.recoveryAction === "replan")).toBe(true);
    // The world is still untouched, which is the point of all of it.
    expect(env.sent).toEqual([]);
    expect(env.stamped).toEqual([]);
  });

  it("prices every model call, and the estimate bounds the charge", async () => {
    const { out } = await execute();
    expect(out.comparison.modelCalls).toBeGreaterThan(0);
    expect(out.comparison.modelCallsRefused).toBe(0);
    expect(out.comparison.costUsd).toBeGreaterThan(0);
    // The estimate prices the output CEILING and chars/3; the charge prices
    // what came back. Conservative in the safe direction, and stated.
    expect(out.comparison.estimatedCostUsd).toBeGreaterThan(out.comparison.costUsd);
    for (const c of out.episode.modelCalls) {
      expect(c.answeredBy).toBe("gemini-3.1-flash-lite");
      expect(c.estimatedCostUsd).toBeGreaterThan(0);
    }
  });

  it("produces an episode whose verdict is the station's, not a second check", async () => {
    const { out } = await execute();
    expect(out.episode.verdict).toBe(out.run.state.verification!.verdict);
    expect(out.episode.modelCalls.length).toBe(out.comparison.modelCalls);
    // Section 12: the episode crossed the adapter, and the adapter is honest.
    expect(out.comparison.persistedEpisodes).toBe(0);
  });

  it("persists a complete chain that replays with no engine, router or clock", async () => {
    const { env, out } = await execute();
    expect(out.run.chain.length).toBe(out.comparison.stateTransitions);
    expect(out.run.chain.length).toBeGreaterThan(20);
    const restored = JSON.parse(JSON.stringify(out.run.chain));
    expect(replayChain(restored)).toEqual([]);
    // Replay touched nothing.
    expect(env.sent).toEqual([]);
  });

  it("is deterministic: the same input produces the same chain", async () => {
    const a = await execute();
    const b = await execute();
    expect(b.out.run.chain.map((s) => s.stateId)).toEqual(a.out.run.chain.map((s) => s.stateId));
  });

  it("REFUSES to name a decision when the top is a genuine tie", async () => {
    // TWO JOBS, IDENTICAL AGE. Their likelihoods are equal by construction, so
    // the ranking has no strict maximum — and `confidence().top` would still
    // name one, because it names whichever sits first in the basis. That label
    // is a fact about basis ORDER, which is v1.1's sharpest measured finding.
    //
    // This fixture exists because a mutation that does not open the hole it
    // names is not a verdict: on the ordinary queue the margin is 0.714, so
    // deleting the tie check changed nothing and reported GREEN.
    const tied = [job("aaaaaa", 20), job("bbbbbb", 20)];
    const env = fakeEnv(tied);
    const out = await runShadow({
      runId: "tie",
      mode: "shadow",
      env,
      call: async () =>
        reply(
          "dispatch story job aaaaaa | claimed | 0.1 | 0.9\n" +
            "dispatch story job bbbbbb | claimed | 0.1 | 0.9\n" +
            "hold: dispatch nothing this tick | nothing | 0.0 | 0.1",
          220,
          60,
        ),
      budgets: BUDGETS,
    });
    expect(out.comparison.oqcaMargin).toBe(0);
    expect(out.comparison.oqcaDecision).toBeNull();
    expect(out.comparison.undecidedReason).toMatch(/tie at the top/);
    // ...and an undecided run is not a DISAGREEMENT with production either.
    expect(out.comparison.agreed).toBeNull();
  });

  it("and the initial state is a pure function of the queue", () => {
    expect(initialState(QUEUE, T0, BUDGETS).stateId).toBe(initialState(QUEUE, T0, BUDGETS).stateId);
    expect(quantumFor(basisFrom(worldFrom(QUEUE, T0))).basis).toHaveLength(3);
  });
});
