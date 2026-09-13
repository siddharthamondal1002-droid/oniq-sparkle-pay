/**
 * THE REAL CALLERS, EXECUTED — not read as source.
 *
 * `gatewayRealCallers.test.ts` greps the call sites, which catches a binding
 * that was never passed and nothing else. It cannot see whether the row is
 * actually written, whether a retry mints a second id, or whether a failure
 * settles at all — and those are the properties the ledger exists for.
 *
 * So this file RUNS the three production paths against a mocked network:
 *
 *   image   `drawStillViaGateway`      — plain module, imported directly
 *   text    `makeGatewayStoryInvoke`   — the story-IR rescue's transport
 *   voice   story-voice's own handler  — captured out of `Deno.serve`
 *
 * HOW A DENO EDGE FUNCTION IS RUN HERE, and why this is not a security
 * bypass. Nothing is stubbed out of the functions themselves: `globalThis.Deno`
 * is given an `env.get` reading a fixture map and a `serve` that keeps the
 * handler instead of listening, and `fetch` is replaced. Every line of auth,
 * validation, capture and settlement is the deployed code, executed. The
 * specifiers are resolved through VARIABLES so `tsc` does not pull three
 * `Deno.` references into the browser program — the same reason
 * `geminiReplyModel.test.ts` does it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  drawStillViaGateway,
  GatewayError,
} from "../../../supabase/functions/_shared/gatewayImage";
import type { GatewayRpc } from "../../../supabase/functions/_shared/gatewayLedger";

/**
 * SPECIFIERS THROUGH VARIABLES, deliberately. A literal `import("…")` — even a
 * dynamic one — puts the target in the TypeScript program, and these three
 * modules name `Deno`, which the browser program has no types for. Measured:
 * five `Cannot find name 'Deno'` errors the moment the literal is inlined.
 */
const LEDGER_MOD = "../../../supabase/functions/_shared/financialLedger.ts";
const RESCUE_MOD = "../../../supabase/functions/_shared/storyIrRescue.ts";
const VOICE_MOD = "../../../supabase/functions/story-voice/index.ts";


type RpcCall = { fn: string; args: Record<string, unknown> };

const ENV: Record<string, string> = {
  LOVABLE_API_KEY: "test-key",
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

/** Every RPC the run made, in order, decoded from the wire. */
let rpcCalls: RpcCall[] = [];
let handlers: ((req: Request) => Promise<Response>)[] = [];
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Answers the RPC endpoint the way PostgREST does; delegates the rest. */
function router(provider: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      rpcCalls.push({ fn: rpc[1], args: JSON.parse(String(init?.body ?? "{}")) });
      return jsonResponse(
        rpc[1] === "capture_gateway_spend"
          ? { ok: true, duplicate: false, settlementState: "PENDING_RECONCILIATION" }
          : { ok: true, settlementState: "PENDING_RECONCILIATION" },
      );
    }
    if (url.includes("/auth/v1/user")) return jsonResponse({ id: "user-1" });
    return provider(url, init);
  };
}

const calls = (fn: string) => rpcCalls.filter((c) => c.fn === fn);

beforeEach(() => {
  rpcCalls = [];
  handlers = [];
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => ENV[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handlers.push(h);
      return { finished: Promise.resolve() };
    },
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { Deno?: unknown }).Deno;
  vi.resetModules();
});

/** The rpc the production code builds for itself, exercised through fetch. */
async function serviceRpc(): Promise<GatewayRpc | null> {
  const mod = await import(/* @vite-ignore */ LEDGER_MOD);
  return mod.serviceRoleRpc() as GatewayRpc | null;
}

describe("the image engine books what it draws", () => {
  it("captures before the draw and settles the accepted frame with its receipt", async () => {
    globalThis.fetch = router(() =>
      new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0KGgoAAA" }] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "gw-image-1" },
      }),
    ) as typeof fetch;

    const still = await drawStillViaGateway(
      "a lantern",
      { key: "k" },
      { fetchImpl: globalThis.fetch },
      {
        spend: {
          rpc: await serviceRpc(),
          requestId: "story-still:aaa",
          jobId: "job-1",
          attempt: 1,
          userId: "user-1",
        },
      },
    );

    expect(still.mime).toBe("image/png");
    const cap = calls("capture_gateway_spend");
    expect(cap).toHaveLength(1);
    expect(cap[0].args._capability).toBe("IMAGE");
    expect(cap[0].args._unit).toBe("images");
    expect(cap[0].args._request_id).toBe("story-still:aaa");
    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(1);
    expect(set[0].args._outcome).toBe("ACCEPTED");
    expect(set[0].args._units_observed).toBe(1);
    expect(set[0].args._provider_receipt_id).toBe("gw-image-1");
    // No price is disclosed, so the row stays open rather than claiming free.
    expect(set[0].args._charged_credits).toBeNull();
  });

  it("settles a refused draw as FAILED and KEEPS the receipt the gateway named", async () => {
    globalThis.fetch = router(() =>
      new Response("rate limited", {
        status: 429,
        headers: { "x-request-id": "gw-image-429" },
      }),
    ) as typeof fetch;

    await expect(
      drawStillViaGateway("a lantern", { key: "k" }, { fetchImpl: globalThis.fetch }, {
        spend: { rpc: await serviceRpc(), requestId: "story-still:bbb", attempt: 1 },
      }),
    ).rejects.toBeInstanceOf(GatewayError);

    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(1);
    expect(set[0].args._outcome).toBe("FAILED");
    // The charge may well have happened; this id is the only handle on it.
    expect(set[0].args._provider_receipt_id).toBe("gw-image-429");
    expect(set[0].args._detail).toMatchObject({ phase: "provider-call", status: 429 });
  });

  it("writes NO row for a refusal this side made before calling out", async () => {
    globalThis.fetch = router(() => {
      throw new Error("the gateway must not be reached");
    }) as typeof fetch;

    await expect(
      drawStillViaGateway("a lantern", { key: "k" }, { fetchImpl: globalThis.fetch }, {
        referenceDataUrl: "https://example.test/not-inlined.png",
        spend: { rpc: await serviceRpc(), requestId: "story-still:ccc" },
      }),
    ).rejects.toBeInstanceOf(GatewayError);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("the story-IR rescue books every model call separately", () => {
  it("mints a fresh request id and a rising attempt per invocation", async () => {
    globalThis.fetch = router(() =>
      jsonResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { total_tokens: 42 },
      }),
    ) as typeof fetch;

    const mod = await import(/* @vite-ignore */ RESCUE_MOD);

    const invoke = mod.makeGatewayStoryInvoke(mod.GATEWAY_STORY_MODEL, {
      rpc: await serviceRpc(),
      jobId: "job-9",
      userId: "user-1",
    });
    expect(invoke).not.toBeNull();

    await invoke!("first pass", { maxTokens: 500 });
    await invoke!("repair pass", { maxTokens: 500 });

    const cap = calls("capture_gateway_spend");
    expect(cap).toHaveLength(2);
    // A shared id would record one charge for two billable calls.
    expect(cap[0].args._request_id).not.toBe(cap[1].args._request_id);
    expect(cap.map((c) => c.args._attempt)).toEqual([1, 2]);
    expect(cap[0].args._capability).toBe("TEXT");
    expect(cap[0].args._unit).toBe("tokens");
    expect(cap[0].args._job_id).toBe("job-9");

    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(2);
    expect(set.every((s) => s.args._outcome === "ACCEPTED")).toBe(true);
    expect(set[0].args._units_observed).toBe(42);
  });

  it("settles a credit refusal as REJECTED rather than swallowing it", async () => {
    globalThis.fetch = router(() => new Response("no credits", { status: 402 })) as typeof fetch;

    const mod = await import(/* @vite-ignore */ RESCUE_MOD);

    const invoke = mod.makeGatewayStoryInvoke(mod.GATEWAY_STORY_MODEL, {
      rpc: await serviceRpc(),
      jobId: null,
      userId: null,
    });
    await expect(invoke!("x", { maxTokens: 100 })).rejects.toThrow();

    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(1);
    expect(set[0].args._outcome).toBe("REJECTED");
    expect(set[0].args._charged_credits).toBeNull();
  });
});

describe("story-voice books the narration it asked for", () => {
  async function voiceHandler(): Promise<(req: Request) => Promise<Response>> {
    await import(/* @vite-ignore */ "../../../supabase/functions/story-voice/index.ts");
    expect(handlers).toHaveLength(1);
    return handlers[0];
  }

  const request = (text = "hello there") =>
    new Request("https://fn.test/story-voice", {
      method: "POST",
      headers: { Authorization: "Bearer user-jwt", "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });

  it("captures in characters and settles the audio it received", async () => {
    globalThis.fetch = router(() =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: "AAAA" } }] } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "gw-tts-1" } },
      ),
    ) as typeof fetch;

    const res = await (await voiceHandler())(request("hello there"));
    expect(res.status).toBe(200);

    const cap = calls("capture_gateway_spend");
    expect(cap).toHaveLength(1);
    expect(cap[0].args._capability).toBe("TTS");
    expect(cap[0].args._unit).toBe("characters");
    const set = calls("settle_gateway_spend");
    expect(set[0].args._outcome).toBe("ACCEPTED");
    expect(set[0].args._units_observed).toBe("hello there".length);
    expect(set[0].args._provider_receipt_id).toBe("gw-tts-1");
  });

  it("keeps the receipt when the gateway refuses", async () => {
    globalThis.fetch = router(() =>
      new Response("throttled", { status: 429, headers: { "x-request-id": "gw-tts-429" } }),
    ) as typeof fetch;

    const res = await (await voiceHandler())(request());
    expect(res.status).toBe(502);
    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(1);
    expect(set[0].args._outcome).toBe("REJECTED");
    expect(set[0].args._provider_receipt_id).toBe("gw-tts-429");
  });

  it("settles FAILED when the body read throws after a 200", async () => {
    globalThis.fetch = router(() => {
      const res = new Response(null, {
        status: 200,
        headers: { "content-type": "audio/wav", "x-request-id": "gw-tts-trunc" },
      });
      // A truncated stream: the status arrived, the bytes did not.
      Object.defineProperty(res, "arrayBuffer", {
        value: () => Promise.reject(new Error("stream closed")),
      });
      return res;
    }) as typeof fetch;

    const res = await (await voiceHandler())(request());
    expect(res.status).toBe(500);
    const set = calls("settle_gateway_spend");
    expect(set).toHaveLength(1);
    // Without the wrap this row stayed PENDING for ever with no outcome.
    expect(set[0].args._outcome).toBe("FAILED");
    expect(set[0].args._detail).toMatchObject({ phase: "body-read" });
    expect(set[0].args._provider_receipt_id).toBe("gw-tts-trunc");
  });

  it("writes NO row when validation refuses before the gateway", async () => {
    globalThis.fetch = router(() => {
      throw new Error("the gateway must not be reached");
    }) as typeof fetch;

    const res = await (await voiceHandler())(request("   "));
    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });
});
