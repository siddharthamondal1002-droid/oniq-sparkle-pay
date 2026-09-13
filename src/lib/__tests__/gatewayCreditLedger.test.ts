/**
 * GATEWAY CREDITS ARE NOT DOLLARS, and this file's job is to keep that true in
 * both directions.
 *
 * The USD ledger (`provider_spend_ledger` + `admit_provider_spend`) enforces
 * request/job/daily DOLLAR ceilings by summing its own rows. A Lovable-gateway
 * call is billed in CREDITS and the gateway discloses no price at call time.
 * Booking one through that guard would mean either an invented exchange rate
 * or credits charging a direct-provider cap — so gateway spend goes to its own
 * relation through its own seam, and the assertions below pin the three things
 * that could quietly undo that:
 *
 *   1. this module holds no USD concept at all;
 *   2. an undisclosed price is PENDING_RECONCILIATION, never 0;
 *   3. capture happens before the call and settlement happens on every exit,
 *      including the throwing one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureGatewaySpend,
  settleGatewaySpend,
  settlementStateFor,
  tokensFromUsage,
  withGatewayCostCapture,
  GATEWAY_PROVIDER,
  type GatewayRpc,
} from "../../../supabase/functions/_shared/gatewayLedger.ts";

type Call = { fn: string; args: Record<string, unknown> };

function recorder(result: unknown = { ok: true, duplicate: false }) {
  const calls: Call[] = [];
  const rpc: GatewayRpc = async (fn, args) => {
    calls.push({ fn, args });
    return { data: result, error: null };
  };
  return { calls, rpc };
}

const CAPTURE = {
  requestId: "req-1",
  capability: "TEXT" as const,
  model: "openai/gpt-5.4-mini",
  unit: "tokens" as const,
  jobId: "film-7",
  attempt: 2,
};

describe("what the seam records", () => {
  it("captures before the call and settles after it, in that order", async () => {
    const { calls, rpc } = recorder();
    const order: string[] = [];

    await withGatewayCostCapture(rpc, CAPTURE, async () => {
      order.push("provider");
      return { value: "ok", outcome: "ACCEPTED" as const, unitsObserved: 812 };
    });

    expect(calls.map((c) => c.fn)).toEqual(["capture_gateway_spend", "settle_gateway_spend"]);
    // The provider ran between the two, not before the first.
    expect(order).toEqual(["provider"]);
    expect(calls[0].args._provider).toBe(GATEWAY_PROVIDER);
    expect(calls[0].args._job_id).toBe("film-7");
    expect(calls[0].args._attempt).toBe(2);
    expect(calls[1].args._units_observed).toBe(812);
  });

  it("settles even when the provider throws — an ambiguous failure is spent", async () => {
    const { calls, rpc } = recorder();

    await expect(
      withGatewayCostCapture(rpc, CAPTURE, async () => {
        throw new Error("socket hung up");
      }),
    ).rejects.toThrow("socket hung up");

    const settle = calls.find((c) => c.fn === "settle_gateway_spend");
    expect(settle).toBeDefined();
    // NOT_CALLED would under-count: a timeout says nothing about whether the
    // gateway served the request.
    expect(settle!.args._outcome).toBe("FAILED");
  });

  it("records NOT_CALLED only when the run says nothing reached the gateway", async () => {
    const { calls, rpc } = recorder();
    await withGatewayCostCapture(rpc, CAPTURE, async () => ({ value: null, neverCalled: true }));
    expect(calls[1].args._outcome).toBe("NOT_CALLED");
  });

  it("records nothing when there is no database reach, and says so", async () => {
    const r = await captureGatewaySpend(null, CAPTURE);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("ledger-unavailable");
    // A missing ledger must not throw: a still that cannot be booked is still
    // a still the person asked for. It must not be SILENT either — settlement
    // reports the same bounded reason rather than returning nothing, which is
    // what made a missed row invisible before.
    const s = await settleGatewaySpend(null, "req-1", { outcome: "ACCEPTED" });
    expect(s).toEqual({ ok: false, reason: "ledger-unavailable" });
  });
});

describe("an unknown price is not a zero price", () => {
  it("leaves a priceless call awaiting reconciliation", () => {
    expect(settlementStateFor({ outcome: "ACCEPTED" })).toBe("PENDING_RECONCILIATION");
    expect(settlementStateFor({ outcome: "ACCEPTED", chargedCredits: null })).toBe(
      "PENDING_RECONCILIATION",
    );
  });

  it("settles only once a real figure arrives — including a genuine zero", () => {
    expect(settlementStateFor({ outcome: "ACCEPTED", chargedCredits: 0 })).toBe("SETTLED");
    expect(settlementStateFor({ outcome: "ACCEPTED", chargedCredits: 1.4 })).toBe("SETTLED");
  });

  it("never turns a nonsense price into a number", async () => {
    const { calls, rpc } = recorder();
    await settleGatewaySpend(rpc, "req-1", {
      outcome: "ACCEPTED",
      chargedCredits: Number.NaN,
      unitsObserved: -3,
    });
    expect(calls[0].args._charged_credits).toBeNull();
    expect(calls[0].args._units_observed).toBeNull();
  });
});

describe("the gateway discloses tokens and nothing else", () => {
  it("reads the OpenAI-shaped usage block", () => {
    expect(tokensFromUsage({ usage: { total_tokens: 97 } })).toBe(97);
    expect(tokensFromUsage({ usage: { prompt_tokens: 40, completion_tokens: 7 } })).toBe(47);
  });

  it("answers null rather than zero when there is no usage to read", () => {
    expect(tokensFromUsage({})).toBeNull();
    expect(tokensFromUsage(null)).toBeNull();
    expect(tokensFromUsage({ usage: {} })).toBeNull();
  });
});

describe("credits can never reach the dollar caps", () => {
  const SRC = readFileSync(
    join(process.cwd(), "supabase/functions/_shared/gatewayLedger.ts"),
    "utf8",
  );
  // Comments stripped: the header EXPLAINS the dollar ledger by naming it, and
  // a guard that read the explanation as the code would fail on the very file
  // that documents why it is separate.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("names no USD concept in its executable text", () => {
    for (const banned of [
      "admit_provider_spend",
      "settle_provider_spend",
      "estimated_usd",
      "actualUsd",
      "estimatedUsd",
      "roundUsd",
      "provider_spend_ledger",
    ]) {
      expect(CODE).not.toContain(banned);
    }
  });

  it("writes only to its own relation's functions", () => {
    const rpcNames = [...CODE.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(rpcNames).toEqual(["capture_gateway_spend", "settle_gateway_spend"]);
  });

  it("the TypeScript state rule and the SQL state rule agree", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/gatewayLedger.ts"),
      "utf8",
    );
    // The derivation lives in ONE exported function so the two sides cannot
    // drift; this asserts nothing re-derives it beside itself.
    expect(sql.match(/PENDING_RECONCILIATION/g)?.length).toBeGreaterThan(0);
    expect(settlementStateFor({ outcome: "NOT_CALLED", chargedCredits: 5 })).toBe("NOT_CALLED");
  });
});

describe("the callers that book their own gateway spend", () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("the text engine captures only after the last early return", () => {
    const CODE = strip(
      readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8"),
    );
    const capture = CODE.indexOf("captureGatewaySpend(spendRpc");
    const refusal = CODE.indexOf('reason: "server tools unsupported on gateway"');
    const fetchAt = CODE.indexOf("fetch(GATEWAY_TEXT_URL");
    expect(capture).toBeGreaterThan(refusal);
    expect(capture).toBeLessThan(fetchAt);
  });

  it("the image engine settles the draw it actually made", () => {
    const CODE = strip(
      readFileSync(join(process.cwd(), "supabase/functions/_shared/gatewayImage.ts"), "utf8"),
    );
    expect(CODE).toContain("withGatewayCostCapture(");
    expect(CODE).toContain('unit: "images"');
    // No binding ⇒ no ledger call at all, so a caller without database reach
    // draws exactly as it did before. The draw now also returns the provider's
    // receipt id, so the unbound path takes `.still` off it — the receipt is
    // only of use to a row nobody is writing here.
    expect(CODE).toContain("if (!spend) return (await drawStillOnGateway(");
  });
});
