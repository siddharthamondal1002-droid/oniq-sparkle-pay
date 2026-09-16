/**
 * THE TWO CONFIRMATION HANDLERS, EXECUTED — not read as source.
 *
 * A source-pattern test can see that a captured check was written. It cannot
 * see whether a grant RPC is still reachable around it, which is the only
 * question that matters here: every assertion below is "did a grant RPC get
 * called", against a mocked network, with the real deployed handler bodies.
 *
 * HOW A DENO EDGE FUNCTION IS RUN HERE — the `gatewayRuntimeCallers.test.ts`
 * pattern. `globalThis.Deno` is given an `env.get` over a fixture map and a
 * `serve` that keeps the handler instead of listening, and `fetch` is replaced.
 * Nothing inside the functions is stubbed: signature verification, binding
 * resolution, evidence checking and the RPC call are the deployed code. The
 * module specifiers go through VARIABLES so `tsc` does not pull `Deno.` into
 * the browser program.
 *
 * No real credentials and no real network: the only key material is the
 * made-up secret below, and every provider response is a fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VERIFY_MOD = "../../../supabase/functions/razorpay-verify/index.ts";
const WEBHOOK_MOD = "../../../supabase/functions/razorpay-webhook/index.ts";

const ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "key-secret",
  RAZORPAY_WEBHOOK_SECRET: "hook-secret",
};

const ORDER = "order_ABCdef123456";
const PAY = "pay_ABCdef123456";
const USER = "11111111-1111-1111-1111-111111111111";

type RpcCall = { fn: string; args: Record<string, unknown> };
let rpcCalls: RpcCall[] = [];
let handlers: ((req: Request) => Promise<Response>)[] = [];
const realFetch = globalThis.fetch;

/** Rows returned per purchase table, keyed by table name. */
type Tables = Record<string, Record<string, unknown>[]>;

type Scenario = {
  tables: Tables;
  /** What GET /v1/payments/:id answers. */
  payment?: Record<string, unknown> | null;
  paymentStatus?: number;
  paymentThrows?: boolean;
  tableStatus?: number;
  rpcResult?: unknown;
  rpcStatus?: number;
  user?: string | null;
};

let scenario: Scenario;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function router(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/auth/v1/user")) {
      return scenario.user === null
        ? new Response("no", { status: 401 })
        : jsonResponse({ id: scenario.user ?? USER });
    }

    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (rpc) {
      rpcCalls.push({ fn: rpc[1], args: JSON.parse(String(init?.body ?? "{}")) });
      return jsonResponse(scenario.rpcResult ?? { ok: true }, scenario.rpcStatus ?? 200);
    }

    const table = url.match(/\/rest\/v1\/(\w+)\?/);
    if (table) {
      if (scenario.tableStatus && scenario.tableStatus !== 200) {
        return new Response("boom", { status: scenario.tableStatus });
      }
      return jsonResponse(scenario.tables[table[1]] ?? []);
    }

    if (url.startsWith("https://api.razorpay.com/v1/payments/")) {
      if (scenario.paymentThrows) throw new Error("socket");
      if (scenario.payment === null) return new Response("nope", { status: 404 });
      return jsonResponse(scenario.payment ?? {}, scenario.paymentStatus ?? 200);
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function storyRow(over: Record<string, unknown> = {}) {
  return {
    user_id: USER,
    currency: "INR",
    status: "created",
    provider_payment_id: null,
    price_paise: 4900,
    ...over,
  };
}

function capturedPayment(over: Record<string, unknown> = {}) {
  return {
    id: PAY,
    order_id: ORDER,
    amount: 4900,
    currency: "INR",
    status: "captured",
    captured: true,
    amount_refunded: 0,
    refund_status: null,
    ...over,
  };
}

async function loadHandler(mod: string): Promise<(req: Request) => Promise<Response>> {
  handlers = [];
  await import(/* @vite-ignore */ mod);
  return handlers[handlers.length - 1];
}

async function callVerify(
  body: Record<string, unknown>,
  opts: { auth?: boolean } = {},
): Promise<Response> {
  const handler = await loadHandler(VERIFY_MOD);
  return handler(
    new Request("https://fn.test/razorpay-verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.auth === false ? {} : { Authorization: "Bearer jwt" }),
      },
      body: JSON.stringify(body),
    }),
  );
}

async function signedVerifyBody(order = ORDER, payment = PAY) {
  return {
    razorpay_order_id: order,
    razorpay_payment_id: payment,
    razorpay_signature: await hmacHex(ENV.RAZORPAY_KEY_SECRET, `${order}|${payment}`),
  };
}

async function callWebhook(
  event: Record<string, unknown>,
  opts: { signature?: string } = {},
): Promise<Response> {
  const handler = await loadHandler(WEBHOOK_MOD);
  const raw = JSON.stringify(event);
  const sig = opts.signature ?? (await hmacHex(ENV.RAZORPAY_WEBHOOK_SECRET, raw));
  return handler(
    new Request("https://fn.test/razorpay-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": sig },
      body: raw,
    }),
  );
}

function capturedEvent(over: Record<string, unknown> = {}) {
  return {
    event: "payment.captured",
    payload: { payment: { entity: { id: PAY, order_id: ORDER, notes: { kind: "order" }, ...over } } },
  };
}

const grants = () =>
  rpcCalls.filter((c) => !c.fn.startsWith("fail_") && c.fn !== "mark_payment_failed");

beforeEach(() => {
  rpcCalls = [];
  handlers = [];
  scenario = { tables: { story_purchases: [storyRow()] }, payment: capturedPayment() };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => ENV[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handlers.push(h);
      return { finished: Promise.resolve() };
    },
  };
  globalThis.fetch = router();
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { Deno?: unknown }).Deno;
  vi.restoreAllMocks();
});

describe("razorpay-verify — the callback path", () => {
  it("grants when signature, our row and the captured payment all agree", async () => {
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, kind: "story_seconds" });
    expect(grants().map((c) => c.fn)).toEqual(["credit_story_purchase"]);
  });

  it.each([
    ["authorized, never captured", { status: "authorized", captured: false }],
    ["captured flag false", { captured: false }],
    ["failed", { status: "failed", captured: false }],
    ["refunded amount", { amount_refunded: 4900 }],
    ["refund status set", { refund_status: "full" }],
    ["amount mismatch", { amount: 100 }],
    ["currency mismatch", { currency: "USD" }],
    ["order mismatch", { order_id: "order_OTHERxxx123" }],
    ["payment id mismatch", { id: "pay_OTHERxxx123" }],
    ["non-integer amount", { amount: 49.5 }],
  ])("refuses and grants nothing: %s", async (_label, over) => {
    scenario.payment = capturedPayment(over);
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(400);
    expect(grants()).toEqual([]);
  });

  it("refuses when our row already names a different payment", async () => {
    scenario.tables.story_purchases = [storyRow({ provider_payment_id: "pay_OTHERxxx123" })];
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(400);
    expect(grants()).toEqual([]);
  });

  it("refuses a caller who does not own the purchase", async () => {
    scenario.user = "22222222-2222-2222-2222-222222222222";
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(404);
    expect(grants()).toEqual([]);
  });

  it("refuses an unauthenticated caller before anything else", async () => {
    const res = await callVerify(await signedVerifyBody(), { auth: false });
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a bad signature", async () => {
    const body = await signedVerifyBody();
    const res = await callVerify({ ...body, razorpay_signature: "a".repeat(64) });
    expect(res.status).toBe(400);
    expect(grants()).toEqual([]);
  });

  it.each([
    ["missing ids", {}],
    ["object as order id", { razorpay_order_id: { a: 1 }, razorpay_payment_id: PAY }],
    ["array as payment id", { razorpay_order_id: ORDER, razorpay_payment_id: [PAY] }],
    ["malformed prefix", { razorpay_order_id: "pay_ABCdef123456", razorpay_payment_id: PAY }],
  ])("refuses malformed input: %s", async (_label, body) => {
    const res = await callVerify({ ...body, razorpay_signature: "b".repeat(64) });
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("is retryable, and grants nothing, when our own database read fails", async () => {
    scenario.tableStatus = 503;
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
    expect(grants()).toEqual([]);
  });

  it("is retryable, and grants nothing, when the provider is unreachable", async () => {
    scenario.paymentThrows = true;
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
    expect(grants()).toEqual([]);
  });

  it("refuses an order that exists in no ledger", async () => {
    scenario.tables = {};
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(404);
    expect(grants()).toEqual([]);
  });

  it("refuses an order claimed by two ledgers", async () => {
    scenario.tables = { story_purchases: [storyRow()], video_purchases: [storyRow()] };
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(404);
    expect(grants()).toEqual([]);
  });

  it("does not report success when the grant RPC semantically refuses", async () => {
    scenario.rpcResult = { ok: false, reason: "unknown-order" };
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
  });

  it("reports the existing success shape on a duplicate (already paid) settlement", async () => {
    scenario.tables.story_purchases = [storyRow({ status: "paid", provider_payment_id: PAY })];
    scenario.rpcResult = { ok: true, alreadyPaid: true, seconds: 60 };
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyPaid: true });
  });

  it.each([
    ["payments", "mark_order_paid", "order", { amount_minor: 4900 }],
    ["story_purchases", "credit_story_purchase", "story_seconds", {}],
    ["watermark_purchases", "settle_watermark_purchase", "watermark_removal", {}],
    ["plan_purchases", "credit_plan_purchase", "plan_month", {}],
    ["video_purchases", "credit_video_purchase", "video_seconds", {}],
  ])("routes %s from our own row", async (table, rpc, kind, extra) => {
    const row = storyRow(extra);
    if (table === "payments") delete (row as Record<string, unknown>).price_paise;
    scenario.tables = { [table]: [row] };
    const res = await callVerify(await signedVerifyBody());
    expect(await res.json()).toMatchObject({ ok: true, kind });
    expect(grants().map((c) => c.fn)).toEqual([rpc]);
  });
});

describe("razorpay-webhook — the provider path", () => {
  it("grants on a captured event that matches our row", async () => {
    const res = await callWebhook(capturedEvent());
    expect(res.status).toBe(200);
    expect(grants().map((c) => c.fn)).toEqual(["credit_story_purchase"]);
  });

  it("cannot be routed to another product by the notes", async () => {
    scenario.tables = { video_purchases: [storyRow()] };
    const res = await callWebhook(capturedEvent({ notes: { kind: "story_seconds" } }));
    expect(res.status).toBe(200);
    expect(grants().map((c) => c.fn)).toEqual(["credit_video_purchase"]);
  });

  it("refuses a forged signature", async () => {
    const res = await callWebhook(capturedEvent(), { signature: "c".repeat(64) });
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["authorized", { status: "authorized", captured: false }],
    ["refunded", { amount_refunded: 4900 }],
    ["amount mismatch", { amount: 1 }],
  ])("acknowledges without granting: %s", async (_label, over) => {
    scenario.payment = capturedPayment(over);
    const res = await callWebhook(capturedEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(grants()).toEqual([]);
  });

  it("does not acknowledge a provider failure it could not classify", async () => {
    scenario.paymentThrows = true;
    const res = await callWebhook(capturedEvent());
    expect(res.status).toBe(500);
    expect(grants()).toEqual([]);
  });

  it("does not acknowledge when our own database read fails", async () => {
    scenario.tableStatus = 500;
    const res = await callWebhook(capturedEvent());
    expect(res.status).toBe(500);
    expect(grants()).toEqual([]);
  });

  it("does not acknowledge when the grant RPC fails", async () => {
    scenario.rpcStatus = 500;
    const res = await callWebhook(capturedEvent());
    expect(res.status).toBe(500);
  });

  it("grants nothing on order.paid with no payment entity", async () => {
    const res = await callWebhook({
      event: "order.paid",
      payload: { order: { entity: { id: ORDER } } },
    });
    expect(res.status).toBe(200);
    expect(grants()).toEqual([]);
  });

  it("records a failure through the ledger our row names, not the notes", async () => {
    scenario.tables = { plan_purchases: [storyRow()] };
    const res = await callWebhook({
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: PAY,
            order_id: ORDER,
            notes: { kind: "story_seconds" },
            error_description: "declined",
          },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["fail_plan_purchase"]);
    expect(grants()).toEqual([]);
  });

  it("is idempotent-safe on a duplicate delivery: same RPC, same arguments", async () => {
    await callWebhook(capturedEvent());
    await callWebhook(capturedEvent());
    expect(grants().map((c) => c.fn)).toEqual([
      "credit_story_purchase",
      "credit_story_purchase",
    ]);
    expect(grants()[0].args).toEqual(grants()[1].args);
  });

  it("ignores an event with no usable order id", async () => {
    const res = await callWebhook({ event: "payment.captured", payload: {} });
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([]);
  });
});
