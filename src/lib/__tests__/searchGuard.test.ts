/**
 * The wiring, not the ledger.
 *
 * searchBudget.test.ts proves the ledger's SQL is shaped correctly and that the
 * estimator refuses to guess. This file proves the seam every billable call now
 * goes through actually behaves: that the provider callback cannot run without
 * an admitted reservation, that an ambiguous outcome settles rather than
 * releases, and that a release only ever happens when nothing left the box.
 *
 * The four invariants under test, in the owner's words:
 *   NO PROVIDER CALL WITHOUT A VALID SPEND RESERVATION
 *   NO UNKNOWN COST BECOMES ZERO
 *   NO MISSING CONFIGURATION BECOMES UNLIMITED SPEND
 *   NO SEARCH BECOMES VIDEO GENERATION
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchBudget } from "../../../supabase/functions/_shared/searchBudget.ts";
import {
  attachmentTokenCeiling,
  base64Bytes,
  classifyTermination,
  IMAGE_TOKEN_CEILING,
  PDF_TOKENS_PER_BYTE,
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withSearchSpendGuard,
} from "../../../supabase/functions/_shared/searchGuard.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const BUDGET: SearchBudget = {
  maxSearches: 4,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 20_000,
  maxOutputTokens: 1_000,
  maxWallClockMs: 60_000,
  maxEstimatedUsd: 0.5,
};

const SPEC = {
  requestId: "req-1",
  provider: "anthropic",
  model: "claude-opus-5",
  searchType: "test",
  budget: BUDGET,
};

/** An rpc double that records every call and answers admission as told. */
function fakeRpc(admit: Record<string, unknown> | Error) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "admit_search_spend") {
      if (admit instanceof Error) throw admit;
      return { data: admit, error: null };
    }
    return { data: { ok: true }, error: null };
  };
  return { rpc, calls };
}

const ADMITTED = { ok: true, reason: "admitted", remainingUsd: 9 };

afterEach(() => {
  delete (globalThis as { Deno?: unknown }).Deno;
  vi.restoreAllMocks();
});

describe("NO PROVIDER CALL WITHOUT A VALID SPEND RESERVATION", () => {
  it("runs the provider callback only after admission, and only once", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    const run = vi.fn(async () => ({ value: "ok", usage: { input_tokens: 10 } }));
    const r = await withSearchSpendGuard(rpc, SPEC, run);
    expect(r.admitted).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(calls[0].fn).toBe("admit_search_spend");
    expect(calls[1].fn).toBe("settle_search_spend");
  });

  it("NEVER runs the callback when the ledger refuses", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    for (const reason of [
      "daily-cap-reached",
      "over-request-cap",
      "duplicate-request",
      "no-budget-configured",
      "disabled",
    ]) {
      const { rpc } = fakeRpc({ ok: false, reason });
      const r = await withSearchSpendGuard(rpc, SPEC, run);
      expect(r.admitted, reason).toBe(false);
      if (!r.admitted) expect(r.reason).toBe(reason);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("NEVER runs the callback when the ledger itself is unreachable", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    const thrower = fakeRpc(new Error("db down"));
    const r1 = await withSearchSpendGuard(thrower.rpc, SPEC, run);
    expect(r1.admitted).toBe(false);
    if (!r1.admitted) expect(r1.reason).toBe("admission-unavailable");

    const erroring = async () => ({ data: null, error: { message: "connection reset" } });
    const r2 = await withSearchSpendGuard(erroring, SPEC, run);
    expect(r2.admitted).toBe(false);
    if (!r2.admitted) expect(r2.reason).toBe("admission-unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("reserves the worst case for the budget, not a token amount", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withSearchSpendGuard(rpc, SPEC, async () => ({ value: 1 }));
    const reserved = calls[0].args._estimated_usd as number;
    // 4 searches ($0.04) + 20k in ($0.10) + 1k out ($0.025).
    expect(reserved).toBeCloseTo(0.165, 6);
  });
});

describe("NO MISSING CONFIGURATION BECOMES UNLIMITED SPEND", () => {
  it("refuses outright when the service role is not configured", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    const r = await withSearchSpendGuard(null, SPEC, run);
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe("guard-unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("serviceRoleRpc returns null rather than an unauthenticated client", () => {
    // No Deno runtime at all (this is Node) — null, not a throw.
    expect(serviceRoleRpc()).toBeNull();
    (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } };
    expect(serviceRoleRpc()).toBeNull();
    (globalThis as { Deno?: unknown }).Deno = {
      env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : undefined) },
    };
    expect(serviceRoleRpc()).toBeNull();
  });

  it("refuses an unpriced model instead of reserving zero for it", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    const { rpc } = fakeRpc(ADMITTED);
    const r = await withSearchSpendGuard(rpc, { ...SPEC, model: "some-new-model" }, run);
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe("unpriced-model");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a zero reservation — an empty budget is not a free call", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    const { rpc } = fakeRpc(ADMITTED);
    const empty: SearchBudget = {
      ...BUDGET,
      maxSearches: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
    };
    const r = await withSearchSpendGuard(rpc, { ...SPEC, budget: empty }, run);
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe("zero-reservation");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("NO UNKNOWN COST BECOMES ZERO", () => {
  it("settles at the MEASURED cost when the provider reports usage", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    const r = await withSearchSpendGuard(rpc, SPEC, async () => ({
      value: "ok",
      usage: {
        input_tokens: 12_000,
        output_tokens: 800,
        cache_read_input_tokens: 1_300,
        cache_creation_input_tokens: 0,
        server_tool_use: { web_search_requests: 3 },
      },
      stopReason: "end_turn",
    }));
    expect(r.admitted).toBe(true);
    const settle = calls.find((c) => c.fn === "settle_search_spend")!;
    // 3 searches ($0.03) + 12k in ($0.06) + 800 out ($0.02) + 1.3k cache read ($0.00065)
    expect(settle.args._actual_usd as number).toBeCloseTo(0.11065, 6);
    expect(settle.args._search_count).toBe(3);
    expect(settle.args._cache_hits).toBe(1);
    expect(settle.args._termination_reason).toBe("COMPLETED");
  });

  it("leaves actual NULL when the provider reported nothing — the estimate stands", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withSearchSpendGuard(rpc, SPEC, async () => ({
      value: "failed",
      usage: null,
      terminationReason: "PROVIDER_ERROR" as const,
    }));
    const settle = calls.find((c) => c.fn === "settle_search_spend")!;
    expect(settle.args._actual_usd).toBeNull();
    expect(settle.args._termination_reason).toBe("PROVIDER_ERROR");
    expect(calls.some((c) => c.fn === "release_search_spend")).toBe(false);
  });

  it("charges the cache WRITE — the miss is not free", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withSearchSpendGuard(rpc, SPEC, async () => ({
      value: "ok",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 10_000 },
    }));
    const settle = calls.find((c) => c.fn === "settle_search_spend")!;
    // 10k written x $5/MTok x 1.25
    expect(settle.args._actual_usd as number).toBeCloseTo(0.0625, 6);
    expect(settle.args._cache_hits).toBe(0);
  });

  it("SETTLES, never releases, when the callback throws after admission", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await expect(
      withSearchSpendGuard(rpc, SPEC, async () => {
        throw new Error("socket hung up");
      }),
    ).rejects.toThrow(/socket hung up/);
    const settle = calls.find((c) => c.fn === "settle_search_spend")!;
    expect(settle.args._actual_usd).toBeNull();
    expect(settle.args._termination_reason).toBe("PROVIDER_ERROR");
    expect(calls.some((c) => c.fn === "release_search_spend")).toBe(false);
  });

  it("releases ONLY when the callback states nothing left the box", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withSearchSpendGuard(rpc, SPEC, async () => ({
      value: "not configured",
      neverCalled: true,
    }));
    expect(calls.some((c) => c.fn === "release_search_spend")).toBe(true);
    expect(calls.some((c) => c.fn === "settle_search_spend")).toBe(false);
  });

  it("never puts a credential in an rpc payload", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withSearchSpendGuard(rpc, { ...SPEC, userId: undefined }, async () => ({
      value: "ok",
      usage: { input_tokens: 1 },
    }));
    const blob = JSON.stringify(calls);
    expect(blob).not.toMatch(/sk-|api[_-]?key|authorization|bearer|service[_-]?role/i);
  });
});

describe("termination is classified from what the provider reported", () => {
  it("names the search ceiling when it was reached", () => {
    expect(classifyTermination(4, BUDGET, "end_turn")).toBe("BUDGET_SEARCHES");
  });
  it("names the token ceiling on a truncated answer", () => {
    expect(classifyTermination(1, BUDGET, "max_tokens")).toBe("BUDGET_TOKENS");
  });
  it("says COMPLETED when nothing was hit", () => {
    expect(classifyTermination(1, BUDGET, "end_turn")).toBe("COMPLETED");
  });
});

describe("attachment input is reserved for, not ignored", () => {
  it("counts base64 bytes without decoding, padding included", () => {
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QUJD")).toBe(3);
    expect(base64Bytes("")).toBe(0);
  });

  it("bounds an image by the resize ceiling, not by upload size", () => {
    const small = attachmentTokenCeiling("image", "A".repeat(1_000));
    const huge = attachmentTokenCeiling("image", "A".repeat(8_000_000));
    expect(small).toBe(IMAGE_TOKEN_CEILING);
    expect(huge).toBe(IMAGE_TOKEN_CEILING);
  });

  it("scales a PDF with its size, so a big upload cannot be reserved as a small one", () => {
    const small = attachmentTokenCeiling("pdf", "A".repeat(4_000));
    const big = attachmentTokenCeiling("pdf", "A".repeat(4_000_000));
    expect(big).toBeGreaterThan(small * 900);
    expect(PDF_TOKENS_PER_BYTE).toBeGreaterThan(0);
  });

  it("a pathological upload is refused by the request cap rather than run", async () => {
    // 4 MB of base64 PDF -> ~750k tokens -> far past any per-request ceiling.
    const budget: SearchBudget = {
      ...BUDGET,
      maxInputTokens: attachmentTokenCeiling("pdf", "A".repeat(4_000_000)),
    };
    const run = vi.fn(async () => ({ value: "ok" }));
    // The ledger is what enforces the cap; here we prove the ESTIMATE reaches
    // it as a huge number rather than being quietly clamped.
    const { rpc, calls } = fakeRpc({ ok: false, reason: "over-request-cap" });
    const r = await withSearchSpendGuard(rpc, { ...SPEC, budget }, run);
    expect(calls[0].args._estimated_usd as number).toBeGreaterThan(3);
    expect(r.admitted).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("no attachment reserves nothing extra", () => {
    expect(attachmentTokenCeiling(null, null)).toBe(0);
    expect(attachmentTokenCeiling("pdf", "")).toBe(0);
  });
});

describe("request ids", () => {
  it("honours a client id — reusing one is refused, which fails safe", () => {
    expect(requestIdFrom("abc12345")).toBe("abc12345");
  });
  it("rejects junk and mints a uuid instead", () => {
    expect(requestIdFrom("../../etc/passwd")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom("x")).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("mints distinct ids", () => {
    expect(requestIdFrom(null)).not.toBe(requestIdFrom(null));
  });
});

describe("refusals are legible and never leak the ceiling", () => {
  it("maps every reason the guard can emit", () => {
    for (const reason of [
      "daily-cap-reached",
      "over-request-cap",
      "duplicate-request",
      "no-budget-configured",
      "disabled",
      "guard-unavailable",
      "unpriced-model",
      "zero-reservation",
      "admission-unavailable",
      "something-new",
    ]) {
      const msg = refusalMessage(reason);
      expect(msg.length, reason).toBeGreaterThan(0);
      expect(msg).not.toMatch(/\$|usd|cap of|budget_config/i);
    }
  });
});

describe("NO SEARCH BECOMES VIDEO GENERATION", () => {
  const SEARCH_FNS = [
    "supabase/functions/smart-scout/index.ts",
    "supabase/functions/hotel-scout/index.ts",
    "supabase/functions/ting/index.ts",
    "supabase/functions/health-scan/index.ts",
  ];

  it("no search function can reach a video model, endpoint, or function", () => {
    for (const f of SEARCH_FNS) {
      const src = read(f);
      expect(src, f).not.toMatch(/veo-|predictLongRunning|story-clip|runwayml|generateVideo/i);
    }
  });

  it("every search function declares web_search and nothing else billable", () => {
    for (const f of SEARCH_FNS) {
      const src = read(f);
      const toolTypes = [...src.matchAll(/type:\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
      for (const t of toolTypes) {
        expect(
          ["web_search_20250305", "image", "document", "text", "base64", "ephemeral"],
          `${f} declares tool/content type ${t}`,
        ).toContain(t);
      }
    }
  });

  it("story-clip is reached from the story worker, never from a search path", () => {
    // The one edge function that spends video money takes its own, separate
    // seconds-claim guard; nothing in the search fleet references it.
    const clip = read("supabase/functions/story-clip/index.ts");
    expect(clip).toMatch(/veo-3\.1-fast-generate-preview/);
    for (const f of SEARCH_FNS) {
      expect(read(f)).not.toMatch(/functions\/v1\/story-clip|invoke\("story-clip"/);
    }
  });
});
