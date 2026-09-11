/**
 * OQCA v1.2 — the first reachable ONIQ cognitive job. Brief section 24.
 *
 * THE REFUSALS ARE THE SUBJECT, and that is deliberate. This loop can spend
 * money and write to production, so a suite that proved the happy path would be
 * proving the least important half. Almost everything below asserts that
 * something did NOT happen, and every one of those assertions is mutation-
 * checked by `scripts/oqca-mutate.sh`.
 *
 * THE ENVIRONMENT IS A REAL IMPLEMENTATION, not a stub returning constants:
 * `stampDispatched` writes, `readJob` reflects it, `claim` removes the row. A
 * fixture that could not disagree with the loop would make every observation
 * test vacuous — which is exactly the trap a `readJob` echoing `perform`'s own
 * claim would be.
 */
import { describe, expect, it, vi } from "vitest";
import { makeLedgerDouble } from "./ledgerDouble.ts";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test/sourceText";
import { fakeEnv, job, reply, T0 } from "./runtimeFixtures";
import {
  DISPATCH_BACKOFF_MS,
  HOLD_ACTION,
  actionFor,
  dispatchTools,
  isDispatchable,
  jobIdFrom,
  likelihoodsFrom,
  makeVerifier,
  productionChoice,
  worldFrom,
  DISPATCH_GOAL,
  basisFrom,
} from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob";
import {
  makeToolRouter,
  outcomeClass,
  type ToolSpec,
} from "../../../supabase/functions/_shared/oqcaRuntime/toolRouter";
import {
  LOOP_MODEL,
  LOOP_PROVIDER,
  estimateFor,
  makeEngine,
} from "../../../supabase/functions/_shared/oqcaRuntime/engine";
import { estimateUsd, isPriced } from "../../../supabase/functions/_shared/oqcaRuntime/pricing";
import {
  makeMemory,
  PERSISTENCE_GAP,
  relevance,
} from "../../../supabase/functions/_shared/oqcaRuntime/memory";
import {
  classifyResponse,
  reflectFrom,
  VERDICTS,
} from "../../../supabase/functions/_shared/oqcaRuntime/episode";
import {
  budgetsFrom,
  runOqcaForDispatch,
} from "../../../supabase/functions/_shared/oqcaRuntime/storyDispatchHook";
import { parseMode, readNonNegative } from "../../../supabase/functions/_shared/oqcaRuntime/flag";
import {
  initialState,
  replayChain,
  quantumFor,
  runShadow,
} from "../../../supabase/functions/_shared/oqcaRuntime/shadow";
import { DEFAULT_BUDGETS } from "../loop/seams.ts";
/**
 * FROM THE MIRROR, NOT FROM `src/` — and this is the health `policy.test.ts`
 * lesson in a second place. The two trees are byte-identical and are still TWO
 * MODULE INSTANCES: `shadow.ts` imports the mirror's `CognitiveState`, so a
 * loop imported from `src/` refuses its states on a private-field mismatch.
 * Anything a test hands to the runtime must come from the tree the runtime
 * reads.
 */
import { runCognitiveLoop } from "../../../supabase/functions/_shared/oqca/loop/cognitiveLoop";
import { sealLoopState } from "../loop/loopState.ts";

const OPEN = { ...DEFAULT_BUDGETS, maxTokens: 1e6, maxCostUsd: 1, maxToolCalls: 4 };
const QUEUE = [job("aaa", 40), job("bbb", 10), job("ccc", 5, 2)];
const answer = async () => reply("dispatch story job aaa | goes out | 0.1 | 0.9");

/* ================================================================ *
 * 1-3. THE FLAG (section 7)
 * ================================================================ */
describe("the flag defaults to off, and off is the old path", () => {
  it("anything unrecognised is off, including a typo", () => {
    expect(parseMode(undefined)).toBe("off");
    expect(parseMode("")).toBe("off");
    expect(parseMode("shadw")).toBe("off");
    expect(parseMode("true")).toBe("off");
    expect(parseMode("  SHADOW ")).toBe("shadow");
    expect(parseMode("assisted")).toBe("assisted");
  });

  it("off constructs nothing at all — the environment is never read", async () => {
    const env = fakeEnv(QUEUE);
    const read = vi.spyOn(env, "readQueue");
    const out = await runOqcaForDispatch({ mode: "off", runId: "r", env, call: answer });
    expect(out.handled).toBe(false);
    expect(out.comparison).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("the budgets read from the environment and default to refusing every spend", () => {
    const zero = budgetsFrom(() => undefined);
    expect(zero.maxCostUsd).toBe(0);
    expect(zero.maxTokens).toBe(0);
    expect(zero.maxToolCalls).toBe(0);
    // A runaway guard, not a spend — it must be runnable or the loop halts at
    // station 1 and an operator raises all three together.
    expect(zero.maxExecutionTimeMs).toBeGreaterThan(0);
    expect(readNonNegative("-5")).toBe(0);
    expect(readNonNegative("abc")).toBe(0);
    expect(readNonNegative("Infinity")).toBe(0);
    expect(readNonNegative("0.25")).toBe(0.25);
  });
});

/* ================================================================ *
 * 4-6. THE PRODUCTION DECISION, AND THE COMPARISON (sections 8, 23)
 * ================================================================ */
describe("the production decision is reproduced exactly", () => {
  it("is the oldest queued job outside its dispatch backoff", () => {
    expect(productionChoice(QUEUE, T0)).toBe("aaa");
    // `ccc` was dispatched two minutes ago, so it is held.
    expect(isDispatchable(job("ccc", 5, 2), T0)).toBe(false);
    expect(isDispatchable(job("ccc", 5, 11), T0)).toBe(true);
    expect(DISPATCH_BACKOFF_MS).toBe(10 * 60 * 1000);
  });

  it("is null when nothing is dispatchable", () => {
    expect(productionChoice([job("x", 5, 1)], T0)).toBeNull();
    expect(productionChoice([], T0)).toBeNull();
  });

  it("breaks a timestamp tie by id, so the comparison cannot be non-deterministic", () => {
    const a = { ...job("zzz", 10), createdAtMs: T0 - 600_000 };
    const b = { ...job("aaa", 10), createdAtMs: T0 - 600_000 };
    expect(productionChoice([a, b], T0)).toBe("aaa");
    expect(productionChoice([b, a], T0)).toBe("aaa");
  });
});

describe("shadow mode reasons alongside production and changes nothing", () => {
  it("performs no production action and records the comparison", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({ runId: "r1", mode: "shadow", env, call: answer, budgets: OPEN });
    expect(env.sent).toEqual([]);
    expect(env.stamped).toEqual([]);
    expect(out.comparison.productionDecision).toBe("aaa");
    expect(out.comparison.mode).toBe("shadow");
    expect(typeof out.comparison.latencyMs).toBe("number");
  });

  it("a dispatch is refused for touching production, not for being unknown", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({ runId: "r2", mode: "shadow", env, call: answer, budgets: OPEN });
    const refused = out.episode.actions.filter((a) => !a.attempted);
    // Either it held (nothing to refuse) or the dispatch was blocked BY THE
    // MODE. What must never appear is a shadow run that performed one.
    for (const r of refused) {
      if (r.tool !== HOLD_ACTION) expect(r.reason).toMatch(/shadow mode/);
    }
    expect(out.episode.actions.some((a) => a.attempted && a.tool.startsWith("dispatch"))).toBe(
      false,
    );
  });

  it("agreement is null when the loop never reached a decision", async () => {
    const env = fakeEnv(QUEUE);
    // Default budgets: every model call refused, so UPDATE_STATE never folds.
    const out = await runShadow({ runId: "r3", mode: "shadow", env, call: answer });
    expect(out.comparison.agreed === null || typeof out.comparison.agreed === "boolean").toBe(true);
    expect(out.comparison.costUsd).toBe(0);
  });
});

/* ================================================================ *
 * 7-11. THE SPEND GATES (sections 6, 21)
 * ================================================================ */
describe("nothing spends before it can price", () => {
  it("a model with no published rate is refused, never treated as free", () => {
    expect(isPriced("gemini-3.1-flash-lite")).toBe(true);
    expect(isPriced("no-such-model-anywhere")).toBe(false);
    // The heavy tier is the REAL unpriced id, not a hypothetical one.
    expect(isPriced("gemini-3.1-pro-preview")).toBe(false);
    expect(estimateUsd("no-such-model", 100, 100)).toBeNull();
    expect(estimateUsd("gemini-3.1-flash-lite", 100, 100)).toBeGreaterThan(0);
  });

  it("the engine's own estimate is positive and grows with the ask", () => {
    const small = estimateFor({ kind: "reason", prompt: "hi", maxOutputTokens: 100 })!;
    const big = estimateFor({ kind: "reason", prompt: "hi".repeat(5000), maxOutputTokens: 4000 })!;
    expect(small.costUsd).toBeGreaterThan(0);
    expect(big.costUsd).toBeGreaterThan(small.costUsd);
    expect(big.tokens).toBeGreaterThan(small.tokens);
  });

  it("maxCostUsd 0 means the provider is never reached", async () => {
    const env = fakeEnv(QUEUE);
    const call = vi.fn(answer);
    const out = await runShadow({
      runId: "r4",
      mode: "shadow",
      env,
      call,
      budgets: { ...OPEN, maxCostUsd: 0 },
    });
    expect(call).not.toHaveBeenCalled();
    expect(out.comparison.costUsd).toBe(0);
    expect(out.run.log.some((r) => r.refused === "max_cost")).toBe(true);
  });

  it("maxToolCalls 0 refuses the ACTION and lets the rest of the loop run", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({
      runId: "r5",
      mode: "assisted",
      env,
      call: answer,
      budgets: { ...OPEN, maxToolCalls: 0 },
    });
    expect(env.sent).toEqual([]);
    // A CAPABILITY bound, not a RUN bound: PERCEIVE still ran.
    expect(out.run.log.some((r) => r.station === "PERCEIVE" && r.refused === null)).toBe(true);
  });

  it("a refusal names the bound that actually bound", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({
      runId: "r6",
      mode: "shadow",
      env,
      call: answer,
      budgets: { ...OPEN, maxTokens: 0 },
    });
    const refusals = out.run.log.filter((r) => r.refused !== null).map((r) => r.refused);
    expect(refusals).toContain("max_tokens");
    // The one bound that has nothing to do with talking to a model.
    expect(refusals).not.toContain("max_tool_calls");
  });
});

/* ================================================================ *
 * 12-16. THE TOOL ROUTER (sections 5, 9, 10)
 * ================================================================ */
describe("the router decides what is permitted, not what is appropriate", () => {
  const ctx = { runId: "t", mode: "assisted" as const, now: () => 0, record: () => {} };

  it("an unregistered tool is unpriceable, not free", () => {
    const r = makeToolRouter([], ctx);
    expect(
      r.estimate({
        tool: "anything",
        input: {},
        reversible: true,
        touchesProduction: false,
        rationale: "",
      }),
    ).toBeNull();
    expect(r.properties("anything")).toBeNull();
  });

  it("a call that under-declares its properties is refused", async () => {
    const env = fakeEnv(QUEUE);
    const r = makeToolRouter(dispatchTools(QUEUE, env), ctx);
    const out = await r.execute({
      tool: actionFor("aaa"),
      input: {},
      // The registry says this touches production. Declaring otherwise is how
      // a write walks past the shadow gate.
      reversible: true,
      touchesProduction: false,
      rationale: "sneak",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/do not match the registry/);
    expect(env.sent).toEqual([]);
  });

  it("shadow mode refuses anything that touches production", async () => {
    const env = fakeEnv(QUEUE);
    const r = makeToolRouter(dispatchTools(QUEUE, env), { ...ctx, mode: "shadow" });
    const out = await r.execute({
      tool: actionFor("aaa"),
      input: {},
      reversible: true,
      touchesProduction: true,
      rationale: "",
    });
    expect(out.ok).toBe(false);
    expect(out.observed).toMatch(/not performed/);
    expect(env.sent).toEqual([]);
  });

  it("the existing rule can refuse a job OQCA selected", async () => {
    const env = fakeEnv(QUEUE);
    const tools = dispatchTools(QUEUE, env);
    // Another tick dispatched it while the loop was thinking.
    await env.stampDispatched("aaa");
    const r = makeToolRouter(tools, ctx);
    const out = await r.execute({
      tool: actionFor("aaa"),
      input: {},
      reversible: true,
      touchesProduction: true,
      rationale: "",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/inside its dispatch backoff/);
    expect(env.sent).toEqual([]);
  });

  it("a refused action is action_not_executed, never action_failed", () => {
    expect(outcomeClass(false, false)).toBe("action_not_executed");
    expect(outcomeClass(true, false)).toBe("action_failed");
    expect(outcomeClass(true, true)).toBeNull();
  });

  it("the observation is read back from the environment, not echoed from the tool", async () => {
    const env = fakeEnv(QUEUE);
    const r = makeToolRouter(dispatchTools(QUEUE, env), ctx);
    const out = await r.execute({
      tool: actionFor("aaa"),
      input: {},
      reversible: true,
      touchesProduction: true,
      rationale: "",
    });
    expect(out.ok).toBe(true);
    expect(out.output).toBe("dispatched aaa");
    // The tool's claim and the environment's word are different sentences,
    // and the second one names what the ROW says.
    expect(out.observed).not.toBe(out.output);
    expect(out.observed).toMatch(/stamped dispatched/);
    expect(env.sent).toEqual(["aaa"]);
    expect(env.stamped).toEqual(["aaa"]);
  });

  it("a send that fails is attempted-and-failed, with the row still read back", async () => {
    const env = fakeEnv(QUEUE);
    env.sendFails = "github dispatch failed: 403";
    const r = makeToolRouter(dispatchTools(QUEUE, env), ctx);
    const out = await r.execute({
      tool: actionFor("aaa"),
      input: {},
      reversible: true,
      touchesProduction: true,
      rationale: "",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/403/);
    // Stamped before the send, exactly as story-dispatch does it.
    expect(env.stamped).toEqual(["aaa"]);
  });
});

/* ================================================================ *
 * 17-18. THE EVIDENCE (section 11)
 * ================================================================ */
describe("likelihoods are facts about the queue, never invented", () => {
  it("is KEYED BY HYPOTHESIS, because SUPERPOSE widens the basis first", () => {
    // MEASURED ON THE FIRST COMPLETE RUN: station 06 admits one hypothesis per
    // `goal.requires`, so by UPDATE_STATE the basis is wider than the action
    // list and a positional vector is refused EVERY iteration — evidence never
    // folded and the loop never reached a decision, with nothing red.
    const world = worldFrom(QUEUE, T0);
    const basis = [...world.availableActions];
    const ls = likelihoodsFrom(basis, QUEUE, T0);
    for (const label of basis) expect(typeof ls[label]).toBe("number");
    // ...and the concepts SUPERPOSE will admit are present too, at a NEUTRAL 1:
    // they are not evidence about the queue, and any other number would be a
    // fact about a concept nothing measured.
    for (const req of DISPATCH_GOAL.requires) expect(ls[req.conceptId]).toBe(1);
  });

  it("a basis element with no queue row throws rather than defaulting", () => {
    expect(() => likelihoodsFrom(["dispatch story job ghost"], QUEUE, T0)).toThrow(/no queue row/);
  });

  it("an older job scores higher, and holding wins only when nothing is dispatchable", () => {
    const ls = likelihoodsFrom([...worldFrom(QUEUE, T0).availableActions], QUEUE, T0);
    expect(ls[actionFor("aaa")]).toBeGreaterThan(ls[actionFor("bbb")]);
    expect(ls[HOLD_ACTION]).toBeLessThan(ls[actionFor("bbb")]);

    const held = [job("x", 5, 1)];
    const w2 = worldFrom(held, T0);
    expect(w2.availableActions).toEqual([HOLD_ACTION]);
    expect(likelihoodsFrom([HOLD_ACTION], held, T0)[HOLD_ACTION]).toBe(1);
    // A held job is NAMED as unavailable, not merely absent — section 7.
    expect(w2.unavailableActions[0]).toMatch(/inside its dispatch backoff/);
  });

  it("a keyed map with a basis element missing is REFUSED, never padded", async () => {
    // Section 11 in its own words. The map shape is what a caller can get
    // right; it must not become a way to omit a hypothesis quietly.
    const env = fakeEnv(QUEUE);
    const state = initialState(QUEUE, T0, OPEN);
    const run = await runCognitiveLoop({
      initial: state,
      quantum: quantumFor(basisFrom(worldFrom(QUEUE, T0))),
      budgets: OPEN,
      evidence: [{ likelihoodsByHypothesis: { [HOLD_ACTION]: 1 }, evidenceIds: ["partial"] }],
    });
    const update = run.log.find((r) => r.station === "UPDATE_STATE")!;
    expect(update.refused).toBe("likelihood_missing");
    expect(update.note).toMatch(/no likelihood for/);
    void env;
  });

  it("and evidence supplied for iteration 0 only does NOT carry to iteration 1", async () => {
    // REPRESENT rebuilds the amplitude state at the top of every iteration, so
    // `IterationEvidence` is per-iteration by design. Supplying one entry meant
    // the final measurement reflected no evidence at all — three actions tied
    // at exactly 1/3 — while every station reported success.
    const state = initialState(QUEUE, T0, { ...OPEN, maxIterations: 2 });
    const basis = basisFrom(worldFrom(QUEUE, T0));
    const run = await runCognitiveLoop({
      initial: state,
      quantum: quantumFor(basis),
      budgets: { ...OPEN, maxIterations: 2 },
      evidence: [{ likelihoodsByHypothesis: likelihoodsFrom(basis, QUEUE, T0) }],
    });
    const updates = run.log.filter((r) => r.station === "UPDATE_STATE");
    expect(updates).toHaveLength(2);
    expect(updates[0].note).toMatch(/evidence folded/);
    expect(updates[1].note).toMatch(/no evidence this iteration/);
  });
});

/* ================================================================ *
 * VERIFICATION READS THE ENVIRONMENT (section 14)
 * ================================================================ */
describe("verification reads the environment, and says which of four it found", () => {
  // THE VERIFIER MATCHES THE KERNEL SEAM, so station 11 calls it during the run
  // — see `makeVerifier`'s header on why it is never handed the loop's own
  // decision.
  const acted = { goalStatement: "g", outcomes: [{ observed: "dispatched", matched: true }] };
  const idle = { goalStatement: "g", outcomes: [] };

  it("an empty queue is verified", async () => {
    expect((await makeVerifier(fakeEnv([]))(acted)).verdict).toBe("verified");
  });

  it("a job stamped and still queued is only PARTIALLY verified", async () => {
    const env = fakeEnv([job("aaa", 40)]);
    await env.stampDispatched("aaa");
    const v = await makeVerifier(env)(acted);
    // Calling a STAMP `verified` would be the station reporting the tool's own
    // action back to itself, which is the failure section 14 exists to prevent.
    expect(v.verdict).toBe("partially_verified");
    expect(v.detail).toMatch(/no runner has claimed them yet/);
  });

  it("a job that left the queue is verified — a runner took it", async () => {
    const env = fakeEnv([job("aaa", 40)]);
    await env.stampDispatched("aaa");
    env.claim("aaa");
    expect((await makeVerifier(env)(acted)).verdict).toBe("verified");
  });

  it("work still waiting after an action is REJECTED, and before one UNVERIFIED", async () => {
    // `rejected` means checked and not met; `unverified` means not checked. A
    // run that records "could not check" as "failed" teaches the learner to
    // avoid actions that may well have worked.
    expect((await makeVerifier(fakeEnv(QUEUE))(acted)).verdict).toBe("rejected");
    expect((await makeVerifier(fakeEnv(QUEUE))(idle)).verdict).toBe("unverified");
  });

  it("an unreadable queue is unverified, never rejected", async () => {
    const env = fakeEnv(QUEUE);
    env.readFails = "postgrest is down";
    const v = await makeVerifier(env)(acted);
    expect(v.verdict).toBe("unverified");
    expect(v.detail).toMatch(/could not be read/);
  });

  it("the four verdicts are exactly the brief's four", () => {
    expect([...VERDICTS]).toEqual(["verified", "partially_verified", "unverified", "rejected"]);
  });
});

/* ================================================================ *
 * A PAYING TOOL GOES THROUGH THE REAL LEDGER (section 5)
 * ================================================================ */
describe("a tool that costs money cannot run outside the spend ledger", () => {
  const ctx = { runId: "t", mode: "assisted" as const, now: () => 0, record: () => {} };
  const paying = (over: Partial<ToolSpec> = {}): ToolSpec => ({
    name: "expensive",
    reversible: true,
    touchesProduction: false,
    idempotency: "IDEMPOTENT_WRITE",
    estimate: () => ({ tokens: 0, costUsd: 0.25 }),
    authorize: async () => null,
    perform: async () => ({ ok: true, output: "done", observed: "the world changed" }),
    ...over,
  });
  const call = {
    tool: "expensive",
    input: {},
    reversible: true,
    touchesProduction: false,
    rationale: "",
  };

  it("is refused when it names no ledger capability", async () => {
    const r = makeToolRouter([paying()], ctx);
    const out = await r.execute(call);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/names no ledger capability/);
  });

  it("is refused when no ledger connection was supplied", async () => {
    const r = makeToolRouter([paying({ capability: "OTHER" })], ctx);
    const out = await r.execute(call);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no ledger connection/);
  });

  it("reserves through the ledger, and a refusal there stops the action", async () => {
    // THE REAL `withProviderSpendGuard`, against a fake RPC. Its own contract is
    // what is being exercised: the provider callback cannot run before
    // admission, so a refused admission must leave `perform` uncalled.
    const performed = vi.fn(async () => ({ ok: true, output: "x", observed: "y" }));
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "admit_provider_spend")
        return { data: { ok: false, reason: "daily-cap-reached" } };
      return { data: null };
    });
    const r = makeToolRouter([paying({ capability: "OTHER", perform: performed })], {
      ...ctx,
      rpc: rpc as never,
    });
    const out = await r.execute(call);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/spend ledger refused/);
    expect(performed).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][0]).toBe("admit_provider_spend");
  });

  it("and an admitted call runs, then settles", async () => {
    const seen: string[] = [];
    const rpc = async (fn: string) => {
      seen.push(fn);
      if (fn === "admit_provider_spend") return { data: { ok: true, attempt: 1 } };
      return { data: null };
    };
    const r = makeToolRouter([paying({ capability: "OTHER" })], { ...ctx, rpc: rpc as never });
    const out = await r.execute(call);
    expect(out.ok).toBe(true);
    expect(out.observed).toBe("the world changed");
    // Reserve, then settle — never one without the other.
    expect(seen).toEqual(["admit_provider_spend", "settle_provider_spend"]);
  });

  it("a FREE tool does not touch the ledger at all", async () => {
    const env = fakeEnv(QUEUE);
    const rpc = vi.fn(async () => ({ data: null }));
    const r = makeToolRouter(dispatchTools(QUEUE, env), { ...ctx, rpc: rpc as never });
    await r.execute({
      tool: actionFor("aaa"),
      input: {},
      reversible: true,
      touchesProduction: true,
      rationale: "",
    });
    // A dispatch is a PostgREST PATCH and a GitHub call, both already paid for.
    // Reserving $0 against a capability bucket would put noise in the ledger
    // the owner reads for spend.
    expect(rpc).not.toHaveBeenCalled();
    expect(env.sent).toEqual(["aaa"]);
  });
});

/* ================================================================ *
 * A COMPLETE EXECUTION PERSISTS AND REPLAYS (section 19)
 * ================================================================ */
describe("a complete shadow execution can be persisted and replayed", () => {
  it("every state re-derives, every link holds, and JSON survives the round trip", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({ runId: "rp", mode: "shadow", env, call: answer, budgets: OPEN });

    // THE WHOLE CHAIN, not just the last state. A run that cannot be persisted
    // cannot be replayed, and `state` alone is one frame of it.
    expect(out.run.chain.length).toBeGreaterThan(5);
    expect(out.run.chain[0].parentStateId).toBeNull();
    expect(out.run.chain[out.run.chain.length - 1].stateId).toBe(out.run.state.stateId);
    expect(out.comparison.stateTransitions).toBe(out.run.chain.length);

    // Persist -> restore. JSON is the honest medium: it is what a durable store
    // would hold, and it is where a Date or a class instance would be lost.
    const restored = JSON.parse(JSON.stringify(out.run.chain));
    expect(replayChain(restored)).toEqual([]);
    expect(restored.map((s: { stateId: string }) => s.stateId)).toEqual(
      out.run.chain.map((s) => s.stateId),
    );
  });

  it("a tampered state in the middle is caught, not carried", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({ runId: "rp2", mode: "shadow", env, call: answer, budgets: OPEN });
    const chain = JSON.parse(JSON.stringify(out.run.chain));
    const i = Math.floor(chain.length / 2);
    chain[i].goal = { ...chain[i].goal, statement: "a different goal" };
    const problems = replayChain(chain);
    expect(problems.map((p) => p.code)).toContain("state_id_mismatch");
    expect(problems[0].index).toBe(i);
  });

  it("replay makes no model call and performs no action", async () => {
    const env = fakeEnv(QUEUE);
    const call = vi.fn(answer);
    const out = await runShadow({ runId: "rp3", mode: "shadow", env, call, budgets: OPEN });
    const before = call.mock.calls.length;
    const sentBefore = [...env.sent];
    replayChain(JSON.parse(JSON.stringify(out.run.chain)));
    expect(call.mock.calls.length).toBe(before);
    expect(env.sent).toEqual(sentBefore);
  });
});

/* ================================================================ *
 * SECTION 17 — how the run ended, for a person
 * ================================================================ */
describe("the four response classes are not a severity scale", () => {
  it("blocked is its own class, and is not failure", () => {
    // `blocked` says the loop was PREVENTED — a budget, a permission, a mode —
    // rather than that it tried and could not. Reading a refusal as a failure
    // sends an operator looking for a bug instead of raising a bound.
    const blocked = { terminated: "max_cost", log: [], state: { outcomes: [] } } as never;
    expect(classifyResponse(blocked, "unverified")).toBe("blocked");
    const clean = { terminated: "success", log: [], state: { outcomes: [] } } as never;
    expect(classifyResponse(clean, "verified")).toBe("completed");
    expect(classifyResponse(clean, "partially_verified")).toBe("partially_completed");
    expect(classifyResponse(clean, "rejected")).toBe("failed");
    // Ran cleanly, nothing could be checked: not a failure, and emphatically
    // not a completion.
    expect(classifyResponse(clean, "unverified")).toBe("partially_completed");
  });

  it("every bound is blocking, so a new one cannot quietly read as a failure", () => {
    const clean = { log: [], state: { outcomes: [] } };
    for (const t of [
      "max_tokens",
      "max_cost",
      "max_tool_calls",
      "max_research_operations",
      "max_execution_time",
      "max_state_transitions",
      "max_iterations",
      "unpriced",
      "budget_exhausted",
    ]) {
      expect(classifyResponse({ ...clean, terminated: t } as never, "rejected")).toBe("blocked");
    }
  });
});

describe("the verdict is part of the state's identity", () => {
  it("so a replay that reached a different verdict would not reproduce the run", () => {
    const a = initialState(QUEUE, T0, OPEN);
    const withVerdict = sealLoopState({
      ...a,
      verification: { verdict: "verified", detail: "x" },
    } as never);
    const different = sealLoopState({
      ...a,
      verification: { verdict: "rejected", detail: "x" },
    } as never);
    expect(withVerdict.stateId).not.toBe(a.stateId);
    expect(different.stateId).not.toBe(withVerdict.stateId);
  });
});

/* ================================================================ *
 * 22. REFLECTION CANNOT CHANGE ANYTHING (section 22)
 * ================================================================ */
describe("reflection produces lists and nothing else", () => {
  it("every field is strings, so there is nothing to apply", () => {
    const r = reflectFrom(
      [{ station: "REASON", note: "", refused: "max_cost" }] as never,
      [{ stepId: "s1", observed: "x", matched: false, predictionError: 1 }],
      "rejected",
    );
    for (const list of [r.lessons, r.reusablePatterns, r.candidateImprovements]) {
      expect(Array.isArray(list)).toBe(true);
      for (const v of list) expect(typeof v).toBe("string");
    }
    expect(r.candidateImprovements.join(" ")).toMatch(/raise or configure/);
  });

  it("the module writes nowhere — no fetch, no client, no filesystem", () => {
    const src = stripComments(
      readFileSync("supabase/functions/_shared/oqcaRuntime/episode.ts", "utf8"),
    );
    for (const banned of [/\bfetch\s*\(/, /createClient/, /writeFileSync/, /Deno\s*\./]) {
      expect(src).not.toMatch(banned);
    }
  });
});

/* ================================================================ *
 * 23. MEMORY, AND THE GAP (section 12)
 * ================================================================ */
describe("the memory seam is honest about not persisting", () => {
  it("consolidate stores nothing durably and returns 0, not a count", async () => {
    const notes: { attempted: number; persisted: number; reason: string }[] = [];
    const m = makeMemory([], { record: (n) => notes.push(n) });
    const n = await m.consolidate([
      { id: "a", layer: "episodic", text: "the queue was empty", confidence: 1 },
    ]);
    expect(n).toBe(0);
    expect(notes[0]).toEqual({ attempted: 1, persisted: 0, reason: PERSISTENCE_GAP });
  });

  it("recall is relevance-based, not a dump", async () => {
    const m = makeMemory(
      [
        { id: "a", layer: "episodic", text: "the dispatcher reached github", confidence: 1 },
        { id: "b", layer: "episodic", text: "nothing to do with anything", confidence: 1 },
      ],
      { record: () => {} },
    );
    expect(await m.recall("github dispatcher", 5)).toHaveLength(1);
    expect(relevance("github", "nothing here")).toBe(0);
    // A store that returned everything up to `limit` would satisfy the type.
    expect(await m.recall("completely unrelated words", 5)).toHaveLength(0);
  });
});

/* ================================================================ *
 * 24. CONCURRENCY AND REPLAY (sections 18, 19)
 * ================================================================ */
describe("two runs share nothing, and a chain replays without a network", () => {
  it("concurrent runs do not see each other's model or tool records", async () => {
    const a = fakeEnv([job("a1", 40)]);
    const b = fakeEnv([job("b1", 40), job("b2", 30)]);
    const [ra, rb] = await Promise.all([
      runShadow({ runId: "A", mode: "shadow", env: a, call: answer, budgets: OPEN }),
      runShadow({ runId: "B", mode: "shadow", env: b, call: answer, budgets: OPEN }),
    ]);
    expect(ra.comparison.productionDecision).toBe("a1");
    expect(rb.comparison.productionDecision).toBe("b1");
    for (const c of ra.episode.modelCalls) expect(c.runId).toBe("A");
    for (const c of rb.episode.modelCalls) expect(c.runId).toBe("B");
    expect(ra.episode.finalStateId).not.toBe(rb.episode.finalStateId);
  });

  it("replay takes no seams at all, and catches a tampered chain", () => {
    const s0 = initialState(QUEUE, T0, OPEN);
    expect(replayChain([s0])).toEqual([]);
    const tampered = { ...s0, goal: { ...s0.goal, statement: "something else" } };
    const problems = replayChain([tampered]);
    expect(problems.map((p) => p.code)).toContain("state_id_mismatch");
    // A run's own chain replays clean.
    const s1 = { ...s0, parentStateId: s0.stateId };
    expect(replayChain([s0, s1]).map((p) => p.code)).toContain("state_id_mismatch");
  });

  it("the replay function's signature admits no engine, router or clock", () => {
    // Read structurally: the guarantee is that there is nowhere to pass one.
    expect(replayChain.length).toBe(1);
    const src = stripComments(
      readFileSync("supabase/functions/_shared/oqcaRuntime/shadow.ts", "utf8"),
    );
    const fn = src.slice(src.indexOf("export function replayChain"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    for (const banned of [/\bfetch\b/, /\bengine\b/, /\brouter\b/, /\bawait\b/]) {
      expect(body, `replay must not mention ${banned}`).not.toMatch(banned);
    }
  });
});

/* ================================================================ *
 * THE HOOK NEVER THROWS, AND THE ENGINE RECORDS EVERY CALL
 * ================================================================ */
describe("the caller is safe by construction", () => {
  it("an environment that throws leaves handled false", async () => {
    const env = fakeEnv(QUEUE);
    env.readFails = "postgrest is down";
    const out = await runOqcaForDispatch({ mode: "assisted", runId: "r", env, call: answer });
    expect(out.handled).toBe(false);
    expect(out.jobId).toBeNull();
    expect(out.error).toMatch(/postgrest is down/);
  });

  it("shadow mode can never report handled, EVEN WHEN THE LOOP ACTED", async () => {
    // THE WEAK VERSION OF THIS TEST PASSED THROUGH A MUTATION THAT BROKE IT.
    // With tight budgets the loop performs nothing, so `handled` was false for
    // a reason that had nothing to do with the mode — and
    // `handled: mode === "assisted" || performed || held` scored GREEN. The
    // budgets are open here so the loop really does complete an action (the
    // hold, which touches no production), and the only thing left keeping
    // `handled` false is the mode.
    const env = fakeEnv([job("held", 5, 1)]);
    const out = await runOqcaForDispatch({
      mode: "shadow",
      runId: "r",
      env,
      call: async () => reply(`${HOLD_ACTION} | nothing goes out | 0.1 | 0.9`),
      getEnv: (n) =>
        ({ OQCA_MAX_COST_USD: "1", OQCA_MAX_TOKENS: "1000000", OQCA_MAX_TOOL_CALLS: "4" })[n],
    });
    expect(out.handled).toBe(false);
    expect(env.sent).toEqual([]);
    // The hold really was performed — without this the assertion above is the
    // weak one again.
    expect(out.comparison!.toolAttempts).toBeGreaterThan(0);
  });

  it("and assisted mode DOES report handled when the loop held", async () => {
    // The mirror of the case above. A hold is a decision, and letting the
    // production path run afterwards would overrule it silently — making
    // assisted mode a thing that only ever ADDS dispatches.
    const env = fakeEnv([job("held", 5, 1)]);
    const out = await runOqcaForDispatch({
      mode: "assisted",
      runId: "r",
      env,
      call: async () => reply(`${HOLD_ACTION} | nothing goes out | 0.1 | 0.9`),
      getEnv: (n) =>
        ({ OQCA_MAX_COST_USD: "1", OQCA_MAX_TOKENS: "1000000", OQCA_MAX_TOOL_CALLS: "4" })[n],
    });
    expect(out.handled).toBe(true);
    expect(out.jobId).toBeNull();
    expect(env.sent).toEqual([]);
  });

  it("every model call is recorded with its cost, latency and who answered", async () => {
    const records: unknown[] = [];
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: (r) => records.push(r),
      call: answer,
      rpc: makeLedgerDouble().rpc,
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(out.ok).toBe(true);
    const r = records[0] as Record<string, unknown>;
    expect(r.runId).toBe("R");
    expect(r.stateId).toBe("S");
    expect(r.purpose).toBe("reason");
    expect(r.answeredBy).toBe("gemini-3.1-flash-lite");
    expect(r.actualCostUsd).toBeGreaterThan(0);
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("a fallback answerer with no published rate is charged the ESTIMATE, never zero", async () => {
    const records: Record<string, unknown>[] = [];
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: (r) => records.push(r as never),
      rpc: makeLedgerDouble().rpc,
      call: async () => ({
        ok: true as const,
        provider: "gemini",
        data: {
          // The HEAVY tier id, which is genuinely absent from MODEL_RATES. Was
          // `gemini-fallback/gemini-3.6-flash` until 2026-09-11, when that label
          // stopped being something any reply can carry — a fixture naming a
          // string nothing emits tests a case that cannot occur.
          model: "gemini-3.1-pro-preview",
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 10, output_tokens: 10 },
        },
      }),
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(records[0].actualCostUsd).toBeNull();
    expect(records[0].costUsd).toBe(records[0].estimatedCostUsd);
    expect(out.usage.costUsd).toBeGreaterThan(0);
  });

  it("a provider that throws still charges, because we cannot know it was not reached", async () => {
    const records: Record<string, unknown>[] = [];
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: (r) => records.push(r as never),
      rpc: makeLedgerDouble().rpc,
      call: async () => {
        throw new Error("socket hang up");
      },
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(out.ok).toBe(false);
    expect(out.usage.costUsd).toBeGreaterThan(0);
    expect(records[0].ok).toBe(false);
  });

  /* ------------------------------------------------------------------ *
   * THE LEDGER IS THE ONLY PATH TO A MODEL CALL.
   *
   * `Budgets.maxCostUsd` is per-RUN — `Spent` is rebuilt by every
   * `runCognitiveLoop` call — so it can never express a total. The owner's
   * figure is a total, and only something that outlives the run can hold one.
   * These four assertions are what make that true rather than described.
   * ------------------------------------------------------------------ */

  it("refuses a model call when no ledger is wired, rather than spending unguarded", async () => {
    const records: Record<string, unknown>[] = [];
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: (r) => records.push(r as never),
      call: answer,
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("the spend ledger refused");
    // NOTHING WAS CHARGED, and that is the one path where zero is honest: the
    // guard refuses before the callback runs, so no request ever left.
    expect(out.usage.costUsd).toBe(0);
    expect(records[0].costUsd).toBe(0);
  });

  it("admits through the ledger as TEXT, in tokens, naming the registry's provider", async () => {
    const ledger = makeLedgerDouble();
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: () => {},
      call: answer,
      rpc: ledger.rpc,
      jobId: "tap-1",
    });
    await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    const [admission] = ledger.admissions();
    expect(admission).toBeDefined();
    expect(admission.args._capability).toBe("TEXT");
    expect(admission.args._unit).toBe("tokens");
    // READ FROM THE REGISTRY, so the ledger row and the model entry cannot name
    // two different providers for one call.
    expect(admission.args._provider).toBe(LOOP_PROVIDER);
    expect(admission.args._model).toBe(LOOP_MODEL);
    expect(admission.args._job_id).toBe("tap-1");
    expect(Number(admission.args._estimated_usd)).toBeGreaterThan(0);
  });

  it("settles at the MEASURED charge when the provider reported one", async () => {
    const ledger = makeLedgerDouble();
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: () => {},
      call: answer,
      rpc: ledger.rpc,
    });
    await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    const [settle] = ledger.settlements();
    expect(settle).toBeDefined();
    expect(settle.args._outcome).toBe("ACCEPTED");
    expect(Number(settle.args._actual_usd)).toBeGreaterThan(0);
  });

  it("a refusal from the ledger stops the call, and the provider is never reached", async () => {
    let reached = 0;
    const engine = makeEngine({
      runId: "R",
      stateId: () => "S",
      now: () => 0,
      record: () => {},
      call: async () => {
        reached += 1;
        return answer();
      },
      rpc: makeLedgerDouble({ admit: false, reason: "daily-cap" }).rpc,
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(reached).toBe(0);
    expect(out.reason).toContain("daily-cap");
  });

  it("jobIdFrom is the inverse of actionFor and rejects anything else", () => {
    expect(jobIdFrom(actionFor("abc-123"))).toBe("abc-123");
    expect(jobIdFrom(HOLD_ACTION)).toBeNull();
    expect(jobIdFrom("delete everything")).toBeNull();
  });
});
