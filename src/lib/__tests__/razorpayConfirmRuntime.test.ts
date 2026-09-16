/**
 * THE TWO CONFIRMATION HANDLERS, EXECUTED — not read as source.
 *
 * A source-pattern test can see that a captured check was written. It cannot
 * see whether a grant RPC is still reachable around it, which is the only
 * question that matters here: almost every assertion below is "did a grant RPC
 * get called", against a mocked network, with the real handler bodies.
 *
 * HOW A DENO EDGE FUNCTION IS RUN HERE — the `gatewayRuntimeCallers.test.ts`
 * pattern. `globalThis.Deno` is given an `env.get` over a fixture map and a
 * `serve` that keeps the handler instead of listening, and `fetch` is replaced.
 * Nothing inside the functions is stubbed: signature verification, binding
 * resolution, evidence checking and the RPC call are the committed code. The
 * module specifiers go through VARIABLES so `tsc` does not pull `Deno.` into
 * the browser program — the same reason `geminiReplyModel.test.ts` does it.
 *
 * WHAT A REFUSAL TEST PROVES, stated precisely: that the handler did not report
 * SUCCESS and did not obtain a grant. Several of them do reach an RPC — a
 * semantic `ok:false` is only observable by calling it — so the assertion is
 * about the outcome, never about the absence of a call.
 *
 * No real credentials and no real network: the only key material is the
 * made-up secret below, and every provider response is a fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const VERIFY_MOD = "../../../supabase/functions/razorpay-verify/index.ts";
const WEBHOOK_MOD = "../../../supabase/functions/razorpay-webhook/index.ts";
const SHARED_MOD = "../../../supabase/functions/_shared/razorpayConfirm.ts";

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
  paymentBody?: string;
  paymentThrows?: boolean;
  tableStatus?: number;
  /** A raw (possibly non-array) body for the table read. */
  tableBody?: string;
  rpcResult?: unknown;
  /** A raw body for the RPC, for the void contract. */
  rpcBody?: string;
  rpcStatus?: number;
  user?: string | null;
  env?: Record<string, string>;
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
      if (scenario.rpcBody !== undefined) {
        return new Response(scenario.rpcBody, { status: scenario.rpcStatus ?? 200 });
      }
      return jsonResponse(scenario.rpcResult ?? { ok: true }, scenario.rpcStatus ?? 200);
    }

    const table = url.match(/\/rest\/v1\/(\w+)\?/);
    if (table) {
      if (scenario.tableStatus && scenario.tableStatus !== 200) {
        return new Response("boom", { status: scenario.tableStatus });
      }
      if (scenario.tableBody !== undefined) {
        return new Response(scenario.tableBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return jsonResponse(scenario.tables[table[1]] ?? []);
    }

    if (url.startsWith("https://api.razorpay.com/v1/payments/")) {
      if (scenario.paymentThrows) throw new Error("socket");
      if (scenario.payment === null) return new Response("nope", { status: 404 });
      if (scenario.paymentBody !== undefined) {
        return new Response(scenario.paymentBody, { status: scenario.paymentStatus ?? 200 });
      }
      const status = scenario.paymentStatus ?? 200;
      if (status >= 300 && status < 400) {
        return new Response("", { status, headers: { location: "https://elsewhere.test/" } });
      }
      return jsonResponse(scenario.payment ?? {}, status);
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

/**
 * A purchase row as PostgREST hands it back — including the stored order id
 * and provider, which the resolver now selects and re-validates rather than
 * copying the caller's string.
 */
function storyRow(over: Record<string, unknown> = {}) {
  return {
    provider_order_id: ORDER,
    provider: "razorpay",
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
  // Fresh module each call: the handler is captured out of `Deno.serve`, which
  // only runs on first evaluation, so a cached module yields no handler.
  vi.resetModules();
  await import(/* @vite-ignore */ mod);
  return handlers[handlers.length - 1];
}

async function callVerify(
  body: Record<string, unknown> | string,
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
      body: typeof body === "string" ? body : JSON.stringify(body),
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
  event: Record<string, unknown> | string,
  opts: { signature?: string } = {},
): Promise<Response> {
  const handler = await loadHandler(WEBHOOK_MOD);
  const raw = typeof event === "string" ? event : JSON.stringify(event);
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
    payload: {
      payment: { entity: { id: PAY, order_id: ORDER, notes: { kind: "order" }, ...over } },
    },
  };
}

function failedEvent(over: Record<string, unknown> = {}) {
  return {
    event: "payment.failed",
    payload: {
      payment: {
        entity: { id: PAY, order_id: ORDER, error_description: "declined", ...over },
      },
    },
  };
}

const grants = () =>
  rpcCalls.filter((c) => !c.fn.startsWith("fail_") && c.fn !== "mark_payment_failed");

/** A 2xx from either handler is the only thing that means "processed". */
const succeeded = (res: Response) => res.status >= 200 && res.status < 300;

beforeEach(() => {
  rpcCalls = [];
  handlers = [];
  scenario = { tables: { story_purchases: [storyRow()] }, payment: capturedPayment() };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (k: string) => (scenario.env ?? ENV)[k] },
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

  it("resolves the purchase exactly once for the whole confirmation", async () => {
    const reads: string[] = [];
    const base = router();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/rest\/v1\/\w+\?/.test(url)) reads.push(url);
      return base(input, init);
    }) as typeof fetch;
    await callVerify(await signedVerifyBody());
    // Five product tables are asked once each. A second resolution would
    // double that and leave two reads that could disagree.
    expect(reads.length).toBe(5);
  });

  it.each([
    ["authorized, never captured", { status: "authorized", captured: false }],
    ["captured flag false", { captured: false }],
    ["failed", { status: "failed", captured: false }],
    ["refunded amount", { amount_refunded: 4900 }],
    ["refund status set", { refund_status: "full" }],
    ["partially refunded", { amount_refunded: 100, refund_status: "partial" }],
    ["amount mismatch", { amount: 100 }],
    ["currency mismatch", { currency: "USD" }],
    ["order mismatch", { order_id: "order_OTHERxxx123" }],
    ["payment id mismatch", { id: "pay_OTHERxxx123" }],
    ["non-integer amount", { amount: 49.5 }],
  ])("refuses and grants nothing: %s", async (_label, over) => {
    scenario.payment = capturedPayment(over);
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    expect(grants()).toEqual([]);
  });

  // ABSENT IS NOT ZERO. Each of these used to become a benign 0/null, which is
  // inventing the evidence that a payment was not refunded.
  it.each([
    ["refund amount as a numeric string", { amount_refunded: "0" }],
    ["refund amount negative", { amount_refunded: -1 }],
    ["refund amount larger than the payment", { amount_refunded: 5000 }],
    ["refund amount fractional", { amount_refunded: 0.5 }],
    ["refund amount missing", { amount_refunded: undefined }],
    ["refund status unrecognised", { refund_status: "processing" }],
    ["refund status as a number", { refund_status: 0 }],
    ["captured missing", { captured: undefined }],
    ["captured as a string", { captured: "true" }],
    ["amount as a numeric string", { amount: "4900" }],
    ["currency malformed", { currency: "INRR" }],
    ["status empty", { status: "" }],
    ["id malformed", { id: "pay_!!" }],
    ["order id missing", { order_id: undefined }],
  ])("rejects a malformed provider payment rather than defaulting it: %s", async (_l, over) => {
    const body = capturedPayment();
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete (body as Record<string, unknown>)[k];
      else (body as Record<string, unknown>)[k] = v;
    }
    scenario.payment = body;
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    expect(grants()).toEqual([]);
  });

  it.each([
    ["a null provider body", "null"],
    ["an array provider body", "[]"],
    ["a string provider body", '"ok"'],
    ["unparseable provider body", "{"],
  ])("rejects %s", async (_label, raw) => {
    scenario.paymentBody = raw;
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
    expect(grants()).toEqual([]);
  });

  it.each([401, 403, 404, 429, 500])(
    "treats provider HTTP %s as unresolved, never as a settled refusal",
    async (status) => {
      scenario.payment = capturedPayment();
      scenario.paymentStatus = status;
      const res = await callVerify(await signedVerifyBody());
      expect(res.status).toBe(502);
      expect(grants()).toEqual([]);
    },
  );

  it("never follows a provider redirect", async () => {
    scenario.paymentStatus = 302;
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
    expect(grants()).toEqual([]);
  });

  it("refuses when our row already names a different payment", async () => {
    scenario.tables.story_purchases = [storyRow({ provider_payment_id: "pay_OTHERxxx123" })];
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    expect(grants()).toEqual([]);
  });

  it.each([
    ["a stored payment id that is not an id", { provider_payment_id: "garbage" }],
    ["a stored order id that differs", { provider_order_id: "order_OTHERxxx123" }],
    ["a stored order id that is malformed", { provider_order_id: "nonsense" }],
    ["a row settled through another provider", { provider: "stripe" }],
    ["a non-numeric price", { price_paise: "4900" }],
    ["a zero price", { price_paise: 0 }],
    ["a missing owner", { user_id: null }],
    ["a malformed currency", { currency: "rupees" }],
  ])("refuses a corrupt binding rather than reading past it: %s", async (_label, over) => {
    scenario.tables.story_purchases = [storyRow(over)];
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    expect(grants()).toEqual([]);
  });

  it.each([
    ["an object instead of rows", '{"message":"permission denied"}'],
    ["a bare string", '"nope"'],
    ["null", "null"],
  ])("refuses a malformed database response: %s", async (_label, raw) => {
    scenario.tableBody = raw;
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(502);
    expect(grants()).toEqual([]);
  });

  it("refuses two rows for one order inside a single table", async () => {
    scenario.tables.story_purchases = [storyRow(), storyRow()];
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
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

  it.each([
    ["40 hex", "b".repeat(40)],
    ["65 hex", "b".repeat(65)],
    ["non-hex", "z".repeat(64)],
    ["an array", ["b".repeat(64)]],
  ])("requires a signature of exactly 64 hex characters: %s", async (_label, signature) => {
    const body = await signedVerifyBody();
    const res = await callVerify({ ...body, razorpay_signature: signature });
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["an array root", "[]"],
    ["a null root", "null"],
    ["a string root", '"hi"'],
  ])("refuses a request body that is not a JSON object: %s", async (_label, raw) => {
    const res = await callVerify(raw);
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
    // The RPC IS called — a semantic refusal is only observable by calling it.
    // What is asserted is that no success was reported.
    scenario.rpcResult = { ok: false, reason: "unknown-order" };
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    expect(grants().map((c) => c.fn)).toEqual(["credit_story_purchase"]);
  });

  it.each([
    ["an array result", "[]"],
    ["a null result", "null"],
    ["an empty body from a JSON contract", ""],
  ])("does not report success on a malformed grant result: %s", async (_label, raw) => {
    scenario.rpcBody = raw;
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
  });

  it("reports the existing success shape on a duplicate (already paid) settlement", async () => {
    scenario.tables.story_purchases = [storyRow({ status: "paid", provider_payment_id: PAY })];
    scenario.rpcResult = { ok: true, alreadyPaid: true, seconds: 60 };
    const res = await callVerify(await signedVerifyBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alreadyPaid: true });
  });

  it.each([
    ["missing the service key", "SUPABASE_SERVICE_ROLE_KEY"],
    ["missing the anon key", "SUPABASE_ANON_KEY"],
    ["missing the Razorpay secret", "RAZORPAY_KEY_SECRET"],
  ])("does not report success when configuration is absent: %s", async (_label, drop) => {
    const env = { ...ENV };
    delete env[drop];
    scenario.env = env;
    const res = await callVerify(await signedVerifyBody());
    expect(succeeded(res)).toBe(false);
    // The existing client-readable shape is preserved on a non-2xx.
    expect(await res.json()).toMatchObject({ configured: false });
    expect(rpcCalls).toEqual([]);
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

  // ═══ THE ACKNOWLEDGEMENT RULE ═══
  // There is no durable event inbox and no quarantine table, so a 2xx on a
  // handled event that was not processed is a payment nobody will ever grant.
  it.each([
    ["not captured yet", () => void (scenario.payment = capturedPayment({ status: "authorized", captured: false }))],
    ["refunded", () => void (scenario.payment = capturedPayment({ amount_refunded: 4900 }))],
    ["amount mismatch", () => void (scenario.payment = capturedPayment({ amount: 1 }))],
    ["provider 401", () => void (scenario.paymentStatus = 401)],
    ["provider 403", () => void (scenario.paymentStatus = 403)],
    ["provider 404", () => void (scenario.paymentStatus = 404)],
    ["provider redirect", () => void (scenario.paymentStatus = 302)],
    ["provider unreachable", () => void (scenario.paymentThrows = true)],
    ["malformed provider body", () => void (scenario.paymentBody = "[]")],
    ["our database read fails", () => void (scenario.tableStatus = 500)],
    ["a malformed database response", () => void (scenario.tableBody = '{"message":"denied"}')],
    ["an order we have not written yet", () => void (scenario.tables = {})],
    [
      "an ambiguous order",
      () => void (scenario.tables = { story_purchases: [storyRow()], plan_purchases: [storyRow()] }),
    ],
    ["the grant RPC erroring", () => void (scenario.rpcStatus = 500)],
    ["the grant RPC semantically refusing", () => void (scenario.rpcResult = { ok: false })],
  ])("does not acknowledge a handled event it could not process: %s", async (_label, arrange) => {
    arrange();
    const res = await callWebhook(capturedEvent());
    expect(succeeded(res)).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("does not acknowledge a handled event with no usable order id", async () => {
    const res = await callWebhook({ event: "payment.captured", payload: {} });
    expect(succeeded(res)).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it("does not acknowledge order.paid with no payment entity", async () => {
    const res = await callWebhook({
      event: "order.paid",
      payload: { order: { entity: { id: ORDER } } },
    });
    expect(succeeded(res)).toBe(false);
    expect(grants()).toEqual([]);
  });

  it("grants on order.paid when the event does carry the payment", async () => {
    const res = await callWebhook({
      event: "order.paid",
      payload: {
        order: { entity: { id: ORDER } },
        payment: { entity: { id: PAY, order_id: ORDER } },
      },
    });
    expect(res.status).toBe(200);
    expect(grants().map((c) => c.fn)).toEqual(["credit_story_purchase"]);
  });

  it("still acknowledges an event type it does not handle", async () => {
    const res = await callWebhook({
      event: "refund.processed",
      payload: { payment: { entity: { id: PAY, order_id: ORDER } } },
    });
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["an array root", "[]"],
    ["a null root", "null"],
  ])("refuses an event body that is not a JSON object: %s", async (_label, raw) => {
    const res = await callWebhook(raw);
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("is idempotent-safe on a duplicate delivery: same RPC, same arguments", async () => {
    await callWebhook(capturedEvent());
    await callWebhook(capturedEvent());
    expect(grants().map((c) => c.fn)).toEqual(["credit_story_purchase", "credit_story_purchase"]);
    expect(grants()[0].args).toEqual(grants()[1].args);
  });

  it.each([
    ["payments", "mark_payment_failed", { amount_minor: 4900 }],
    ["story_purchases", "fail_story_purchase", {}],
    ["plan_purchases", "fail_plan_purchase", {}],
    ["video_purchases", "fail_video_purchase", {}],
  ])("records a failure against %s through the ledger our row names", async (table, rpc, extra) => {
    const row = storyRow(extra);
    if (table === "payments") delete (row as Record<string, unknown>).price_paise;
    scenario.tables = { [table]: [row] };
    const res = await callWebhook(failedEvent({ notes: { kind: "story_seconds" } }));
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toEqual([rpc]);
    expect(grants()).toEqual([]);
  });

  // fail_watermark_purchase is declared `returns void` in the live catalogue,
  // so PostgREST answers 200 with an empty body. Demanding {ok:true} made every
  // successful watermark failure look broken.
  it.each([
    ["an empty body", ""],
    ["a literal null", "null"],
  ])("accepts the void failure contract for watermark removal: %s", async (_label, raw) => {
    scenario.tables = { watermark_purchases: [storyRow()] };
    scenario.rpcBody = raw;
    const res = await callWebhook(failedEvent());
    expect(res.status).toBe(200);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["fail_watermark_purchase"]);
  });

  it("does not acknowledge a void failure RPC that answered non-2xx", async () => {
    scenario.tables = { watermark_purchases: [storyRow()] };
    scenario.rpcBody = "";
    scenario.rpcStatus = 500;
    const res = await callWebhook(failedEvent());
    expect(succeeded(res)).toBe(false);
  });

  it("does not acknowledge a JSON failure RPC that semantically refused", async () => {
    scenario.rpcResult = { ok: false, reason: "already settled" };
    const res = await callWebhook(failedEvent());
    expect(succeeded(res)).toBe(false);
    expect(rpcCalls.map((c) => c.fn)).toEqual(["fail_story_purchase"]);
  });

  it("does not acknowledge a JSON failure RPC that returned an empty body", async () => {
    scenario.rpcBody = "";
    const res = await callWebhook(failedEvent());
    expect(succeeded(res)).toBe(false);
  });
});

describe("bounded reads — the ceiling is enforced while streaming", () => {
  type Shared = typeof import("../../../supabase/functions/_shared/razorpayConfirm.ts");
  const shared = () => import(/* @vite-ignore */ SHARED_MOD) as Promise<Shared>;

  /** A chunked stream with NO content-length, the case arrayBuffer() missed. */
  function chunked(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) controller.close();
        else controller.enqueue(chunks[i++]);
      },
      cancel() {
        onCancel?.();
      },
    });
  }

  const bytes = (n: number, fill = 97) => new Uint8Array(n).fill(fill);

  it("reads a body that fits", async () => {
    const { readBoundedStream } = await shared();
    const got = await readBoundedStream(chunked([bytes(4), bytes(4)]), null, 64);
    expect(got).toEqual({ text: "aaaaaaaa" });
  });

  it("refuses an oversized chunked body with no content-length, and cancels it", async () => {
    const { readBoundedStream } = await shared();
    let cancelled = false;
    const stream = chunked([bytes(64), bytes(64), bytes(64)], () => {
      cancelled = true;
    });
    const got = await readBoundedStream(stream, null, 100);
    expect(got).toEqual({ error: { code: "body-too-large", retryable: false } });
    expect(cancelled).toBe(true);
  });

  it("refuses on a declared length over the ceiling without reading at all", async () => {
    const { readBoundedStream } = await shared();
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.close();
      },
    });
    const got = await readBoundedStream(stream, "999999", 100);
    expect(got).toEqual({ error: { code: "body-too-large", retryable: false } });
    expect(pulled).toBe(false);
  });

  it("bounds a stalled stream instead of holding the function open", async () => {
    const { readBoundedStream } = await shared();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Never enqueues, never closes.
        return new Promise<void>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const got = await readBoundedStream(stream, null, 100, 20);
    expect(got).toEqual({ error: { code: "body-stalled", retryable: true } });
    expect(cancelled).toBe(true);
  });

  it("surfaces a stream that errors mid-read as retryable", async () => {
    const { readBoundedStream } = await shared();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("reset"));
      },
    });
    const got = await readBoundedStream(stream, null, 100);
    expect(got).toEqual({ error: { code: "body-read-failed", retryable: true } });
  });

  it("keeps the bytes exact: a BOM survives and is not normalised", async () => {
    const { readBoundedStream } = await shared();
    const body = new TextEncoder().encode("\uFEFF{\"a\":1}");
    const got = await readBoundedStream(chunked([body]), String(body.byteLength), 1024);
    expect("text" in got && got.text).toBe('\uFEFF{"a":1}');
    // Byte-for-byte round trip is what the HMAC depends on.
    expect("text" in got && new TextEncoder().encode(got.text)).toEqual(body);
  });

  it("refuses malformed bytes rather than replacing them", async () => {
    const { readBoundedStream } = await shared();
    const got = await readBoundedStream(chunked([new Uint8Array([0xff, 0xfe, 0x00])]), null, 64);
    expect(got).toEqual({ error: { code: "body-not-utf8", retryable: false } });
  });

  it("joins a multi-byte character split across chunks", async () => {
    const { readBoundedStream } = await shared();
    const whole = new TextEncoder().encode("₹");
    const got = await readBoundedStream(
      chunked([whole.slice(0, 1), whole.slice(1)]),
      null,
      64,
    );
    expect(got).toEqual({ text: "₹" });
  });

  it("reads an absent body as empty", async () => {
    const { readBoundedStream } = await shared();
    expect(await readBoundedStream(null, null, 64)).toEqual({ text: "" });
  });
});
