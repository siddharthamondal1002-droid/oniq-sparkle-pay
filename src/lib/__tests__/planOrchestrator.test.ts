import { describe, expect, it } from "vitest";
import {
  classifyFailure,
  orchestratePlan,
  type CallOutcome,
} from "../../../supabase/functions/_shared/planOrchestrator.ts";

// A scriptable mock harness: a fake advancing clock, and spine/batch stages
// driven by queued outcomes per engine, recording every call so we can assert
// bounds (no duplicate work, no whole-film call, no retry-of-permanent).
type Outcome = CallOutcome<unknown> & { advanceMs?: number };
function harness(opts: {
  engines: string[];
  spineByEngine: Record<string, Outcome[]>;
  batchByEngine?: Record<string, Outcome[]>;
  totalMs?: number;
  spineBudgetMs?: number;
  batchBudgetMs?: number;
  fallbackReserveMs?: number;
}) {
  let elapsed = 0;
  const total = opts.totalMs ?? 115_000;
  const clock = { now: () => elapsed, remaining: () => total - elapsed };
  const spineCalls: { engine: string; budget: number }[] = [];
  const batchCalls: { engine: string; budget: number }[] = [];
  const spineQ: Record<string, Outcome[]> = structuredCloneish(opts.spineByEngine);
  const batchQ: Record<string, Outcome[]> = structuredCloneish(opts.batchByEngine ?? {});
  const sleeps: number[] = [];

  const deps = {
    engines: opts.engines,
    clock,
    spineBudgetMs: opts.spineBudgetMs ?? 22_000,
    batchBudgetMs: opts.batchBudgetMs ?? 60_000,
    fallbackReserveMs: opts.fallbackReserveMs ?? 45_000,
    minAttemptMs: 10_000,
    maxTransientRetriesPerEngine: 1,
    backoffMs: (a: number) => 500 * a,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    spine: (engine: string, budget: number) => {
      spineCalls.push({ engine, budget });
      const next = (spineQ[engine] ?? []).shift() ?? { ok: false as const, reason: "empty queue" };
      if (next.advanceMs) elapsed += next.advanceMs;
      return Promise.resolve(next as CallOutcome<unknown>);
    },
    batches: (engine: string, _spine: unknown, budget: number) => {
      batchCalls.push({ engine, budget });
      const next = (batchQ[engine] ?? []).shift() ?? {
        ok: true as const,
        value: { shots: 43 },
      };
      if (next.advanceMs) elapsed += next.advanceMs;
      return Promise.resolve(next as CallOutcome<unknown>);
    },
  };
  return { deps, spineCalls, batchCalls, sleeps };
}
function structuredCloneish<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

describe("classifyFailure — transient vs permanent", () => {
  it("timeouts, network and retryable 5xx/429 are transient", () => {
    for (const r of ["timeout", "timed out after 22s", "fetch failed", "socket hang up", "aborted", "http 502", "http 503", "http 504", "http 429", "500", "529"]) {
      expect(classifyFailure(r)).toBe("transient");
    }
  });
  it("auth, bad request, parse, and credit/quota are permanent", () => {
    for (const r of ["http 400", "http 401", "unauthorized", "invalid request", "bad json", "could not parse the spine", "credit balance too low", "quota exceeded", "not configured"]) {
      expect(classifyFailure(r)).toBe("permanent");
    }
  });
  it("a credit refusal that arrives as http 400 stays permanent (permanent wins)", () => {
    expect(classifyFailure("http 400 invalid_request credit balance")).toBe("permanent");
  });
  it("the unknown defaults to permanent (never spend a retry on it)", () => {
    expect(classifyFailure("something weird happened")).toBe("permanent");
  });
});

describe("orchestratePlan — the 7 P0 scenarios", () => {
  it("1. Claude success → plan, no fallback touched", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: { anthropic: [{ ok: true, value: { title: "F" } }] },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toEqual({ shots: 43 });
    expect(out.servedBy).toBe("anthropic:spine+batches");
    expect(h.spineCalls.map((c) => c.engine)).toEqual(["anthropic"]);
    expect(h.batchCalls.map((c) => c.engine)).toEqual(["anthropic"]);
  });

  it("2. Claude timeout → same-engine retry → success", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [
          { ok: false, reason: "timeout" },
          { ok: true, value: { title: "F" } },
        ],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.servedBy).toBe("anthropic:spine+batches");
    expect(h.spineCalls.length).toBe(2); // one retry
    expect(h.sleeps.length).toBe(1); // backed off once
    expect(h.batchCalls.map((c) => c.engine)).toEqual(["anthropic"]);
  });

  it("3. Claude 502 → same-engine retry → success", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [
          { ok: false, reason: "http 502" },
          { ok: true, value: { title: "F" } },
        ],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.servedBy).toBe("anthropic:spine+batches");
    expect(h.spineCalls.length).toBe(2);
  });

  it("4. Claude timeout (retry exhausted) → Gemini spine → success (SAME contract, no whole-film)", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [
          { ok: false, reason: "timeout" },
          { ok: false, reason: "timeout" },
        ],
        gemini: [{ ok: true, value: { title: "F" } }],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toEqual({ shots: 43 });
    expect(out.servedBy).toBe("gemini:spine+batches");
    // Gemini ran the SPINE (small contract), then batches — never a whole-film call.
    expect(h.spineCalls.map((c) => c.engine)).toEqual(["anthropic", "anthropic", "gemini"]);
    expect(h.batchCalls.map((c) => c.engine)).toEqual(["gemini"]);
  });

  it("5. Claude transient → Gemini transient → bounded deterministic failure", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [
          { ok: false, reason: "timeout" },
          { ok: false, reason: "timeout" },
        ],
        gemini: [
          { ok: false, reason: "http 503" },
          { ok: false, reason: "http 503" },
        ],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toBeNull();
    expect(h.batchCalls.length).toBe(0); // never expanded a film that has no spine
    // exactly (2 engines × 2 spine attempts) = 4, no more (bounded)
    expect(h.spineCalls.length).toBe(4);
    expect(out.tried.every((t) => t.class === "transient")).toBe(true);
  });

  it("6. permanent http 400 → no retry on that engine, falls to Gemini", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [{ ok: false, reason: "http 400 invalid_request" }],
        gemini: [{ ok: true, value: { title: "F" } }],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.servedBy).toBe("gemini:spine+batches");
    // Claude tried exactly ONCE (permanent → no same-engine retry), then Gemini.
    expect(h.spineCalls.filter((c) => c.engine === "anthropic").length).toBe(1);
    expect(h.sleeps.length).toBe(0); // no backoff for a permanent failure
  });

  it("7. permanent auth on both engines → bounded failure, one attempt each", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [{ ok: false, reason: "http 401 unauthorized" }],
        gemini: [{ ok: false, reason: "not configured" }],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toBeNull();
    expect(h.spineCalls.length).toBe(2); // one per engine, no retries
    expect(h.batchCalls.length).toBe(0);
    expect(out.tried.every((t) => t.class === "permanent")).toBe(true);
  });
});

describe("orchestratePlan — invariants (idempotency, bounds, budget)", () => {
  it("passes the batch stage exactly what the spine returned, once, and returns it verbatim", async () => {
    const spineVal = { title: "Voices", setting: "world", cast: [] };
    const planVal = { shots: 43, order: [1, 2, 3] };
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: { anthropic: [{ ok: true, value: spineVal }] },
      batchByEngine: { anthropic: [{ ok: true, value: planVal }] },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toEqual(planVal); // returned verbatim (pass-through), not reconstructed
    expect(h.batchCalls.length).toBe(1); // no duplicate expansion → no duplicate generation
  });

  it("a batch failure falls to the next engine's full spine+batches (no partial plan)", async () => {
    const h = harness({
      engines: ["anthropic", "gemini"],
      spineByEngine: {
        anthropic: [{ ok: true, value: { t: "a" } }],
        gemini: [{ ok: true, value: { t: "g" } }],
      },
      batchByEngine: {
        anthropic: [{ ok: false, reason: "batch 9: assembled 3 shots, wanted 8" }],
        gemini: [{ ok: true, value: { shots: 43 } }],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.servedBy).toBe("gemini:spine+batches");
    expect(h.batchCalls.map((c) => c.engine)).toEqual(["anthropic", "gemini"]);
  });

  it("respects the wall clock: skips an engine with no room and never overspends", async () => {
    // Anthropic spine burns almost the whole clock; Gemini must be skipped for
    // lack of room rather than started into a guaranteed timeout.
    const h = harness({
      engines: ["anthropic", "gemini"],
      totalMs: 30_000,
      fallbackReserveMs: 20_000,
      spineByEngine: {
        anthropic: [{ ok: false, reason: "timeout", advanceMs: 25_000 }],
      },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.plan).toBeNull();
    // Gemini spine has < minAttemptMs of room → recorded as "no wall-clock room".
    expect(out.tried.some((t) => t.engine === "gemini" && /no wall-clock room/.test(t.reason))).toBe(
      true,
    );
    expect(h.batchCalls.length).toBe(0);
  });

  it("the last engine gets no fallback reserve (uses all remaining room)", async () => {
    const h = harness({
      engines: ["gemini"], // single engine = last
      totalMs: 40_000,
      spineBudgetMs: 22_000,
      fallbackReserveMs: 45_000, // would zero the budget if wrongly applied
      spineByEngine: { gemini: [{ ok: true, value: { t: "g" } }] },
    });
    const out = await orchestratePlan(h.deps);
    expect(out.servedBy).toBe("gemini:spine+batches");
    expect(h.spineCalls[0].budget).toBe(22_000); // full spine budget, no reserve subtracted
  });
});
