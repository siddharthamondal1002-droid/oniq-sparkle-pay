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
    // The PROPERTY is that the top is a strict maximum; the NUMBER is pinned
    // beside it so a drift is visible rather than absorbed by a loose bound.
    //
    // v1.4-R MOVED IT, from 0.5859 to 0.4189, and the cause is knowledge rather
    // than reasoning: with a real `KnowledgeState` supplied, SUPERPOSE admits a
    // hypothesis only for the gaps still OPEN, so the basis narrows from six
    // labels to four — and the run reaches its terminal state in two iterations
    // instead of four, which is two fewer foldings of the same evidence. Lower
    // and still decisive is the honest reading; a threshold quietly relaxed to
    // 0.25 would have hidden which of those two things changed.
    expect(out.comparison.oqcaMargin).toBeGreaterThan(0);
    expect(out.comparison.oqcaMargin).toBeCloseTo(0.4189, 3);
    expect(out.comparison.oqcaConfidence).toBeGreaterThan(0.5);
  });

  it("and agrees with what story-dispatch would have picked", async () => {
    const { out } = await execute();
    expect(out.comparison.productionDecision).toBe(productionChoice(QUEUE, T0));
    expect(out.comparison.agreed).toBe(true);
  });

  it("ranks the ACTIONS, not the goal's prerequisites", async () => {
    // SUPERPOSE admits a hypothesis per OPEN gap, so by MEASURE the basis holds
    // actions AND unresolved prerequisites. Ranking all of them together asks
    // "which of these is most likely" where some are things to do and some are
    // things the goal needs — a category error that ties forever.
    //
    // v1.4-R NARROWED THE BASIS, and this assertion had to follow it — but NOT
    // for the reason the first rewrite assumed, and the difference is a finding
    // rather than a detail.
    //
    // SUPERPOSE ADMITS ONE PREREQUISITE PER ITERATION, IN `goal.requires`
    // DECLARATION ORDER, AND NEVER CONSULTS THE GAP DETECTOR (station 06 runs
    // before station 09). So WHICH prerequisites become hypotheses is a fact
    // about how many iterations ran, not about what is still unknown. Before
    // v1.4-R no `KnowledgeState` was ever supplied, IDENTIFY_GAPS refused every
    // run, the loop ran four iterations and all three were admitted. Now it
    // reaches its terminal state in two, so two are.
    //
    // THAT MISMATCH IS REAL AND IS DELIBERATELY NOT FIXED HERE: with knowledge
    // finally supplied, the loop can tell which prerequisites are OPEN, and the
    // station that decides what to wonder about does not ask. `queue-eligibility`
    // is VERIFIED at 0.85 from ONIQ's own probe of `isDispatchable` and is
    // still admitted as a hypothesis on iteration 1. Changing SUPERPOSE to
    // prefer the highest-priority open gap is three lines and a different
    // change; it is recorded in the v1.4-R report rather than smuggled in here.
    const { out } = await execute();
    const basis = out.run.quantum.basis;
    const iterations = out.run.log.filter((r) => r.station === "SUPERPOSE").length;
    const admitted = DISPATCH_GOAL.requires.slice(0, iterations).map((r) => r.conceptId);
    expect(
      basis.filter((b) => !b.startsWith("dispatch story job ") && !b.startsWith("hold:")),
    ).toEqual(admitted);
    // The gap detector, meanwhile, DOES know: two settled by the substrate and
    // one genuinely unseeable. That is the half v1.4-R made true.
    const open = out.run.state.knowledgeGaps.filter((g) => g.status !== "VERIFIED");
    expect(open.map((g) => g.conceptId)).toEqual(["runner-availability"]);

    // Whatever is in the basis, the ANSWER is never a prerequisite.
    for (const req of DISPATCH_GOAL.requires) {
      expect(out.comparison.oqcaDecision).not.toBe(req.conceptId);
    }
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

  it("withdraws a shadow-refused dispatch and replans onto another action", async () => {
    /* ------------------------------------------------------------------ *
     * THIS ASSERTION REPLACES `toolAttempts === 0`, AND THE CHANGE IS THE
     * RECOVERY LOOP WORKING RATHER THAN A REGRESSION.
     *
     * Before the failure brief was implemented, a shadow-mode refusal ended
     * the plan: the dispatch was refused, nothing else was tried, and nothing
     * was withdrawn. Now the refusal is classified TOOL, `decideRecovery`
     * returns `replan` (no alternate is registered for a plan step), the
     * refused action is WITHDRAWN, and PLAN picks the next candidate.
     *
     * WHICH candidate is NOT the assertion, and v1.4-R is why. It used to be
     * the hold — the one action shadow mode permits — and that outcome
     * depended on the prerequisites sitting in the basis and diluting the
     * action probabilities, which is the category error the entry above
     * describes. With the basis narrowed to the actions plus the one open gap,
     * PLAN reaches the second DISPATCH first and shadow mode refuses that too.
     * Both orderings are correct; only the REPLAN is the property, so only the
     * replan is pinned.
     * ------------------------------------------------------------------ */
    const { env, out } = await execute();
    expect(out.comparison.toolsRefused).toBeGreaterThan(0);
    // The withdrawal is what a replan IS, and PLAN records it by name.
    const withdrawn = out.run.log.filter((r) => /withdrawn by an earlier recovery/.test(r.note));
    expect(withdrawn.length).toBeGreaterThan(0);

    // AND A WITHDRAWN ACTION IS NEVER SELECTED AGAIN. This is the property, and
    // it took a mutation to find the right shape for it: an earlier draft
    // asserted only that TWO DISTINCT actions were selected across the run, and
    // a mutation removing the `blockedActions` filter passed it — the loop
    // re-tried the refused dispatch and then moved on, so two distinct
    // selections happened anyway. Retrying an action a recovery has withdrawn
    // is the failure; "some variety in the selections" is not the same claim.
    const refused = out.run.log
      .filter((r) => r.station === "ACT" && r.refused !== null)
      .map((r) => /(dispatch story job \w+)/.exec(r.refused!)?.[1])
      .filter((x): x is string => x !== undefined);
    expect(refused.length).toBeGreaterThan(0);
    const selectedAfter = out.run.log
      .filter((r) => r.station === "PLAN" && /selected /.test(r.note))
      .map((r) => r.note);
    for (const tool of refused) {
      const firstRefusalAt = out.run.log.findIndex(
        (r) => r.station === "ACT" && r.refused !== null && r.refused.includes(tool),
      );
      const laterPlans = out.run.log
        .slice(firstRefusalAt + 1)
        .filter((r) => r.station === "PLAN" && /selected /.test(r.note));
      for (const p of laterPlans) {
        expect(p.note, `${tool} was re-selected after being withdrawn`).not.toContain(tool);
      }
    }
    expect(selectedAfter.length).toBeGreaterThan(0);
    // And through all of it, the world is untouched. This is the one that
    // matters: a replan may never turn a refusal into a production write.
    expect(env.sent).toEqual([]);
    expect(env.stamped).toEqual([]);
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
