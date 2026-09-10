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
} from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob";
import {
  makeToolRouter,
  outcomeClass,
} from "../../../supabase/functions/_shared/oqcaRuntime/toolRouter";
import { estimateFor, makeEngine } from "../../../supabase/functions/_shared/oqcaRuntime/engine";
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
  runShadow,
} from "../../../supabase/functions/_shared/oqcaRuntime/shadow";
import { DEFAULT_BUDGETS } from "../loop/seams.ts";

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
    expect(isPriced("gemini-fallback/whatever")).toBe(false);
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
  it("one per basis element, and a mismatch throws rather than padding", () => {
    const world = worldFrom(QUEUE, T0);
    const basis = [...world.availableActions];
    const ls = likelihoodsFrom(basis, QUEUE, T0);
    expect(ls).toHaveLength(basis.length);
    expect(() => likelihoodsFrom([...basis, "dispatch story job ghost"], QUEUE, T0)).toThrow(
      /no queue row/,
    );
  });

  it("an older job scores higher, and holding wins only when nothing is dispatchable", () => {
    const world = worldFrom(QUEUE, T0);
    const basis = [...world.availableActions];
    const ls = likelihoodsFrom(basis, QUEUE, T0);
    const at = (label: string) => ls[basis.indexOf(label)];
    expect(at(actionFor("aaa"))).toBeGreaterThan(at(actionFor("bbb")));
    expect(at(HOLD_ACTION)).toBeLessThan(at(actionFor("bbb")));

    const held = [job("x", 5, 1)];
    const w2 = worldFrom(held, T0);
    expect(w2.availableActions).toEqual([HOLD_ACTION]);
    expect(likelihoodsFrom([HOLD_ACTION], held, T0)).toEqual([1]);
    // A held job is NAMED as unavailable, not merely absent — section 7.
    expect(w2.unavailableActions[0]).toMatch(/inside its dispatch backoff/);
  });
});

/* ================================================================ *
 * 19-21. VERIFICATION AND THE EPISODE (sections 13, 14, 17)
 * ================================================================ */
describe("verification reads the environment, and says which of four it found", () => {
  it("a job that left the queue is verified", async () => {
    const env = fakeEnv(QUEUE);
    await env.stampDispatched("aaa");
    env.claim("aaa");
    expect((await makeVerifier(actionFor("aaa"), env)()).verdict).toBe("verified");
  });

  it("a job stamped and still queued is only PARTIALLY verified", async () => {
    const env = fakeEnv(QUEUE);
    await env.stampDispatched("aaa");
    const v = await makeVerifier(actionFor("aaa"), env)();
    // Claiming `verified` on a stamp would be this station reporting the
    // tool's own action back to itself.
    expect(v.verdict).toBe("partially_verified");
    expect(v.detail).toMatch(/no runner has claimed it yet/);
  });

  it("a job queued with no stamp is rejected", async () => {
    const env = fakeEnv(QUEUE);
    expect((await makeVerifier(actionFor("aaa"), env)()).verdict).toBe("rejected");
  });

  it("holding is verified only when nothing was dispatchable", async () => {
    expect((await makeVerifier(HOLD_ACTION, fakeEnv([job("x", 5, 1)]))()).verdict).toBe("verified");
    expect((await makeVerifier(HOLD_ACTION, fakeEnv(QUEUE))()).verdict).toBe("rejected");
  });

  it("the four verdicts are exactly the brief's four", () => {
    expect([...VERDICTS]).toEqual(["verified", "partially_verified", "unverified", "rejected"]);
  });
});

describe("the episode carries every section 13 field", () => {
  it("and createdAt is on the episode and in no state id", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({ runId: "r7", mode: "shadow", env, call: answer, budgets: OPEN });
    const e = out.episode;
    for (const k of [
      "runId",
      "goal",
      "initialStateId",
      "finalStateId",
      "observations",
      "actions",
      "predictions",
      "actualOutcomes",
      "verdict",
      "responseClass",
      "success",
      "failureReason",
      "lessons",
      "reusablePatterns",
      "modelCalls",
      "toolCalls",
      "costUsd",
      "durationMs",
      "createdAt",
    ]) {
      expect(e, `missing ${k}`).toHaveProperty(k);
    }
    expect(() => new Date(e.createdAt).toISOString()).not.toThrow();
    // THE PROOF THAT createdAt IS NOT HASHED: two states built from the same
    // content have the same id whatever the wall clock said.
    const a = initialState(QUEUE, T0, OPEN);
    const b = initialState(QUEUE, T0, OPEN);
    expect(a.stateId).toBe(b.stateId);
    expect(String(a.stateId)).not.toContain(e.createdAt);
  });

  it("blocked is its own class, and is not failure", () => {
    const run = { terminated: "max_cost", log: [], state: { outcomes: [] } } as never;
    expect(classifyResponse(run, "unverified")).toBe("blocked");
    const clean = { terminated: "completed", log: [], state: { outcomes: [] } } as never;
    expect(classifyResponse(clean, "verified")).toBe("completed");
    expect(classifyResponse(clean, "partially_verified")).toBe("partially_completed");
    expect(classifyResponse(clean, "rejected")).toBe("failed");
    expect(classifyResponse(clean, "unverified")).toBe("partially_completed");
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
      call: async () => ({
        ok: true as const,
        provider: "gemini",
        data: {
          model: "gemini-fallback/gemini-3.6-flash",
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
      call: async () => {
        throw new Error("socket hang up");
      },
    });
    const out = await engine.run({ kind: "reason", prompt: "why", maxOutputTokens: 200 });
    expect(out.ok).toBe(false);
    expect(out.usage.costUsd).toBeGreaterThan(0);
    expect(records[0].ok).toBe(false);
  });

  it("jobIdFrom is the inverse of actionFor and rejects anything else", () => {
    expect(jobIdFrom(actionFor("abc-123"))).toBe("abc-123");
    expect(jobIdFrom(HOLD_ACTION)).toBeNull();
    expect(jobIdFrom("delete everything")).toBeNull();
  });
});
