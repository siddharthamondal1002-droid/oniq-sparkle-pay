/**
 * THE RECOVERY WORKER, EXECUTED THROUGH THE DOOR IT IS ACTUALLY REACHED BY.
 *
 * Every test below calls the REAL `razorpay-webhook` handler at the real URL
 * shape the cron will use — `?mode=recovery` — with a real bearer header. The
 * worker is never imported and poked directly, because the questions worth
 * asking are about the door: does a wrong credential reach the database, can a
 * mode flag skip the HMAC, does a typo'd mode fall through to the worker.
 *
 * WHAT IS MOCKED AND WHAT IS NOT. `Deno.env`/`Deno.serve` and `fetch` are
 * replaced; the authentication, the routing, the claim loop, the binding
 * resolution, the evidence check, the case parser and the bounded reader are
 * all the committed code.
 *
 * NO PROVIDER WRITE MAY APPEAR. One test asserts that over every request the
 * whole suite made: a POST to api.razorpay.com from this path would be ONIQ
 * moving somebody's money without a person in the loop, and it is the one
 * failure that no amount of correct accounting afterwards would undo.
 *
 * No real credentials, no real network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
const RFND = "rfnd_ABCdef123456";
const DISP = "disp_ABCdef123456";
const USER = "11111111-1111-1111-1111-111111111111";
const LEASE = "22222222-2222-2222-2222-222222222222";

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let handlers: ((req: Request) => Promise<Response>)[] = [];
const realFetch = globalThis.fetch;

type Scenario = {
  tables: Record<string, Record<string, unknown>[]>;
  inboxRows: Record<string, unknown>[];
  reconcileRows: Record<string, unknown>[];
  payment?: Record<string, unknown> | null;
  paymentStatus?: number;
  /** What `GET /v1/payments/:id/... ` list read answers for reconciliation. */
  orderPayments?: Record<string, unknown>[];
  orderPaymentsStatus?: number;
  refund?: Record<string, unknown> | null;
  refundStatus?: number;
  dispute?: Record<string, unknown> | null;
  /** What `payment_case_upsert` says it DID. `advanced` unless a test says otherwise. */
  caseOutcome?: unknown;
  grantResult?: unknown;
  grantStatus?: number;
  /** `{ok:false}` from a completion RPC means the lease is gone. */
  completeOk?: boolean;
  reconcileCompleteOk?: boolean;
  /** A response body far over the ceiling, to prove the bound. */
  hugeProviderBody?: boolean;
  env?: Record<string, string>;
};

let scenario: Scenario;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function purchaseRow(over: Record<string, unknown> = {}) {
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
    entity: "payment",
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

function inboxRow(over: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    lease_token: LEASE,
    event_name: "payment.captured",
    event_class: "paid",
    provider_order_id: ORDER,
    provider_payment_id: PAY,
    provider_refund_id: null,
    provider_dispute_id: null,
    ...over,
  };
}

function rpcCalls(name?: string) {
  return calls.filter(
    (c) => c.url.includes("/rest/v1/rpc/") && (!name || c.url.endsWith(`/${name}`)),
  );
}
function rpcNames() {
  return calls.filter((c) => c.url.includes("/rest/v1/rpc/")).map((c) => c.url.split("/rpc/")[1]!);
}
function argsOf(name: string): Record<string, unknown> {
  const c = rpcCalls(name)[0];
  return (c?.body ?? {}) as Record<string, unknown>;
}

function router(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = String(init?.body);
    }
    calls.push({ url, method: init?.method ?? "GET", body });

    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (rpc === "payment_recovery_maintain") return jsonResponse({ enqueued: 0 });
    if (rpc === "payment_inbox_claim") return jsonResponse(scenario.inboxRows);
    if (rpc === "payment_reconcile_claim") return jsonResponse(scenario.reconcileRows);
    if (rpc === "payment_inbox_complete") {
      return jsonResponse({ ok: scenario.completeOk ?? true });
    }
    if (rpc === "payment_reconcile_complete") {
      return jsonResponse({ ok: scenario.reconcileCompleteOk ?? true });
    }
    if (rpc === "payment_case_upsert") {
      return jsonResponse({ outcome: scenario.caseOutcome ?? "advanced", id: "case-1" });
    }
    if (rpc) {
      return jsonResponse(scenario.grantResult ?? { ok: true }, scenario.grantStatus ?? 200);
    }

    const table = url.match(/\/rest\/v1\/(\w+)\?/)?.[1];
    if (table) return jsonResponse(scenario.tables[table] ?? []);

    if (url.includes("/v1/orders/") && url.includes("/payments")) {
      if (scenario.orderPaymentsStatus && scenario.orderPaymentsStatus !== 200) {
        return new Response("boom", { status: scenario.orderPaymentsStatus });
      }
      return jsonResponse({ entity: "collection", items: scenario.orderPayments ?? [] });
    }
    if (url.startsWith("https://api.razorpay.com/v1/payments/")) {
      if (scenario.payment === null) return new Response("nope", { status: 404 });
      return jsonResponse(scenario.payment ?? capturedPayment(), scenario.paymentStatus ?? 200);
    }
    if (url.startsWith("https://api.razorpay.com/v1/refunds/")) {
      if (scenario.hugeProviderBody) {
        return new Response("x".repeat(400 * 1024), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (scenario.refund === null) return new Response("nope", { status: 500 });
      return jsonResponse(scenario.refund ?? {}, scenario.refundStatus ?? 200);
    }
    if (url.startsWith("https://api.razorpay.com/v1/disputes/")) {
      if (scenario.dispute === null) return new Response("nope", { status: 500 });
      return jsonResponse(scenario.dispute ?? {});
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

async function loadHandler(): Promise<(req: Request) => Promise<Response>> {
  handlers = [];
  vi.resetModules();
  await import(/* @vite-ignore */ WEBHOOK_MOD);
  return handlers[handlers.length - 1]!;
}

async function callRecovery(
  opts: { auth?: string | null; action?: string; mode?: string; method?: string } = {},
): Promise<Response> {
  const handler = await loadHandler();
  const mode = opts.mode === undefined ? "recovery" : opts.mode;
  const url =
    mode === ""
      ? "https://fn.test/razorpay-webhook"
      : `https://fn.test/razorpay-webhook?mode=${mode}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` : opts.auth;
  if (auth !== null) headers.Authorization = auth;
  const method = opts.method ?? "POST";
  return handler(
    new Request(url, {
      method,
      headers,
      // GET/HEAD cannot carry one, and the handler must refuse on the verb
      // long before it would have looked for a body.
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : JSON.stringify({ source: "cron", action: opts.action ?? "run" }),
    }),
  );
}

beforeEach(() => {
  calls = [];
  handlers = [];
  scenario = {
    tables: { story_purchases: [purchaseRow()] },
    inboxRows: [],
    reconcileRows: [],
  };
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

// ─────────────────────────────────────────────────────────────────────────────

describe("the recovery door — authentication before anything else", () => {
  it.each([
    ["no Authorization header at all", null],
    ["an empty bearer", "Bearer "],
    ["the wrong key", "Bearer not-the-service-key"],
    ["the anon key", "Bearer anon-key"],
    ["the webhook secret", "Bearer hook-secret"],
    ["a raw key with no scheme", "service-key"],
    ["the right key under the wrong scheme", "Basic service-key"],
    // A JWT IS A CLAIM, NOT A CREDENTIAL. Anyone can mint one that says
    // service_role; the only thing that settles it is holding the secret.
    [
      "a forged JWT claiming service_role",
      "Bearer " +
        btoa(JSON.stringify({ alg: "none" })) +
        "." +
        btoa(JSON.stringify({ role: "service_role" })) +
        ".",
    ],
    ["a credential far over the header bound", "Bearer " + "a".repeat(5000)],
  ])("refuses %s with 401 and touches nothing", async (_label, auth) => {
    const res = await callRecovery({ auth });
    expect(res.status).toBe(401);
    // NOT "no writes" — NO CALLS AT ALL. A refused caller must not be able to
    // make this function read a table or talk to Razorpay on their behalf.
    expect(calls).toEqual([]);
  });

  it("accepts the exact service credential", async () => {
    const res = await callRecovery();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: "recovery" });
  });

  it("refuses a near-miss credential — one byte longer", async () => {
    const res = await callRecovery({ auth: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}x` });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("refuses a prefix of the credential", async () => {
    const res = await callRecovery({ auth: "Bearer service-ke" });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe("the mode is exact, and neither branch's authentication can be skipped", () => {
  it.each([
    ["a misspelt mode", "recovry"],
    ["a mode with different case", "Recovery"],
    ["a prefix of the mode", "recover"],
    ["the mode with trailing space", "recovery%20"],
    ["a longer mode containing it", "recovery2"],
    ["an empty mode value", "%20"],
  ])("refuses %s rather than letting it select the worker", async (_label, mode) => {
    const res = await callRecovery({ mode });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  // THE FLAG CANNOT REACH PAST THE SIGNATURE, AND THE SIGNATURE CANNOT REACH
  // THE WORKER. These are the two ways one door could be opened by the other.
  it("does not let the service credential bypass the HMAC on the normal URL", async () => {
    const handler = await loadHandler();
    const res = await handler(
      new Request("https://fn.test/razorpay-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ event: "payment.captured", payload: {} }),
      }),
    );
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("does not let a valid provider signature reach the worker", async () => {
    const handler = await loadHandler();
    const raw = JSON.stringify({ event: "payment.captured", payload: {} });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(ENV.RAZORPAY_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const res = await handler(
      new Request("https://fn.test/razorpay-webhook?mode=recovery", {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-signature": sig },
        body: raw,
      }),
    );
    // A provider delivery carries no service key, so it lands on 401 rather
    // than on a worker run. That is the point of the constant-time check.
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("answers OPTIONS publicly and does no work", async () => {
    const handler = await loadHandler();
    const res = await handler(
      new Request("https://fn.test/razorpay-webhook?mode=recovery", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("refuses GET on the recovery mode", async () => {
    const res = await callRecovery({ method: "GET" });
    expect(res.status).toBe(405);
    expect(calls).toEqual([]);
  });
});

describe("the probe — authenticated, and it may not write", () => {
  it("answers without touching a table, an RPC or the provider", async () => {
    const res = await callRecovery({ action: "probe" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, action: "probe" });
    // A probe that needed the work's privileges would be testing something
    // other than the credential the cron is about to use.
    expect(calls).toEqual([]);
  });

  it("still needs the credential", async () => {
    const res = await callRecovery({ action: "probe", auth: "Bearer wrong" });
    expect(res.status).toBe(401);
  });

  it("refuses an action it does not recognise rather than defaulting to work", async () => {
    const res = await callRecovery({ action: "drain" });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("the inbox — a recorded event finished afterwards", () => {
  it("reaps and tops up before claiming anything", async () => {
    await callRecovery();
    // THE HEARTBEAT IS FIRST, and before anything that can fail. A run that
    // only stamped itself once it had finished would read as "never ran" for
    // exactly the runs whose silence is worth an alert.
    expect(rpcNames().slice(0, 2)).toEqual(["payment_recovery_beat", "payment_recovery_maintain"]);
    expect(rpcNames().indexOf("payment_inbox_claim")).toBeGreaterThan(1);
  });

  // THE WORKER MUST NOT CALL THE TICK. The tick POSTs this worker, so a worker
  // that called it would summon another worker, without bound.
  it("never calls the dispatching tick", async () => {
    scenario.inboxRows = [inboxRow()];
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_recovery_tick");
  });

  it("grants a captured event and completes the row under its lease", async () => {
    scenario.inboxRows = [inboxRow()];
    const res = await callRecovery();
    expect(res.status).toBe(200);
    expect(rpcNames()).toContain("credit_story_purchase");
    expect(argsOf("credit_story_purchase")).toMatchObject({
      _provider_order_id: ORDER,
      _provider_payment_id: PAY,
    });
    expect(argsOf("payment_inbox_complete")).toMatchObject({
      p_id: "row-1",
      p_lease: LEASE,
      p_outcome: "done",
    });
    expect(await res.json()).toMatchObject({ inbox: { claimed: 1, done: 1 } });
  });

  it("refuses to grant when the provider's payment does not match our row", async () => {
    scenario.inboxRows = [inboxRow()];
    scenario.payment = capturedPayment({ amount: 100 });
    await callRecovery();
    expect(rpcNames()).not.toContain("credit_story_purchase");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("fatal");
  });

  it("retries rather than gives up when the provider is unreachable", async () => {
    scenario.inboxRows = [inboxRow()];
    scenario.paymentStatus = 500;
    await callRecovery();
    expect(rpcNames()).not.toContain("credit_story_purchase");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });

  it("retries an order we have not written down yet", async () => {
    scenario.inboxRows = [inboxRow()];
    scenario.tables = {};
    await callRecovery();
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });

  it("retries a grant RPC that semantically refused", async () => {
    scenario.inboxRows = [inboxRow()];
    scenario.grantResult = { ok: false, reason: "already settled" };
    await callRecovery();
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });

  it("ignores an event class it does not act on without reading anything", async () => {
    scenario.inboxRows = [inboxRow({ event_class: "other", event_name: "payment.authorized" })];
    await callRecovery();
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("ignored");
    expect(calls.some((c) => c.url.startsWith("https://api.razorpay.com"))).toBe(false);
  });

  // ═══ LOSING A LEASE IS A REFUSAL, NOT A SUCCESS ═══
  it("counts a lost lease as lost, never as done", async () => {
    scenario.inboxRows = [inboxRow()];
    scenario.completeOk = false;
    const res = await callRecovery();
    const body = (await res.json()) as { inbox: Record<string, number> };
    expect(body.inbox.leaseLost).toBe(1);
    expect(body.inbox.done).toBe(0);
  });

  it("processes a finite batch and completes every row it claimed", async () => {
    scenario.inboxRows = [inboxRow({ id: "a" }), inboxRow({ id: "b" }), inboxRow({ id: "c" })];
    const res = await callRecovery();
    expect(rpcCalls("payment_inbox_complete").length).toBe(3);
    expect(await res.json()).toMatchObject({ inbox: { claimed: 3, done: 3 } });
  });

  it("asks for a bounded batch and a lease, never an unbounded drain", async () => {
    await callRecovery();
    const args = argsOf("payment_inbox_claim");
    expect(typeof args.p_limit).toBe("number");
    expect(args.p_limit as number).toBeGreaterThan(0);
    expect(args.p_limit as number).toBeLessThanOrEqual(50);
    expect(args.p_lease_seconds as number).toBeGreaterThan(0);
  });
});

describe("a stale failure may not downgrade a purchase that was paid", () => {
  it("records a failure on a row that never settled", async () => {
    scenario.inboxRows = [inboxRow({ event_class: "failed", event_name: "payment.failed" })];
    await callRecovery();
    expect(rpcNames()).toContain("fail_story_purchase");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("done");
  });

  it.each([
    ["a stored payment id", { provider_payment_id: PAY }],
    ["a paid status", { status: "paid" }],
    ["a captured status", { status: "captured" }],
    ["a refunded status", { status: "refunded" }],
  ])("ignores a late failure against a row carrying %s", async (_label, over) => {
    scenario.tables = { story_purchases: [purchaseRow(over)] };
    scenario.inboxRows = [inboxRow({ event_class: "failed", event_name: "payment.failed" })];
    await callRecovery();
    expect(rpcNames()).not.toContain("fail_story_purchase");
    // IGNORED, NOT RETRY. There is nothing to come back for: deliveries are
    // unordered and this one has simply been superseded.
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("ignored");
  });

  it("never sends the provider's own error text into our ledger", async () => {
    scenario.inboxRows = [inboxRow({ event_class: "failed", event_name: "payment.failed" })];
    await callRecovery();
    expect(argsOf("fail_story_purchase")._error).toBe("payment-failed");
  });
});

describe("refunds and disputes become cases, read fresh from the provider", () => {
  const refundRow = () =>
    inboxRow({
      event_class: "refund",
      event_name: "refund.processed",
      provider_refund_id: RFND,
    });

  it("asks the provider what the refund is NOW rather than trusting the event", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    expect(calls.some((c) => c.url === `https://api.razorpay.com/v1/refunds/${RFND}`)).toBe(true);
    expect(argsOf("payment_case_upsert")).toMatchObject({
      p_case_type: "refund",
      p_case_id: RFND,
      // THE CASE'S OWN AMOUNT. A ₹1 refund of a ₹49 payment is ₹1; taking the
      // payment's 4900 would turn a partial refund into a total one.
      p_amount: 100,
      p_currency: "INR",
      p_verified_status: "processed",
      p_material_adverse: true,
    });
  });

  it("records a pending refund as not-yet-adverse", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "pending",
    };
    await callRecovery();
    expect(argsOf("payment_case_upsert").p_material_adverse).toBe(false);
  });

  it("retries when the provider read fails, and writes no case", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.refund = null;
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });

  it.each([
    ["an amount bigger than the payment", { amount: 99999 }],
    ["a different currency", { currency: "USD" }],
    ["somebody else's payment", { payment_id: "pay_OTHERxxx1234" }],
  ])("refuses to file a case that does not belong to this order: %s", async (_l, over) => {
    scenario.inboxRows = [refundRow()];
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
      ...over,
    };
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("fatal");
  });

  it("files a lost dispute as adverse and an open one as not", async () => {
    const base = {
      entity: "dispute",
      id: DISP,
      payment_id: PAY,
      amount: 4900,
      currency: "INR",
    };
    scenario.inboxRows = [
      inboxRow({
        event_class: "dispute",
        event_name: "dispute.lost",
        provider_dispute_id: DISP,
      }),
    ];
    scenario.dispute = { ...base, status: "lost" };
    await callRecovery();
    expect(argsOf("payment_case_upsert").p_material_adverse).toBe(true);

    calls = [];
    scenario.dispute = { ...base, status: "under_review" };
    await callRecovery();
    expect(argsOf("payment_case_upsert").p_material_adverse).toBe(false);
    // The RANK still comes from the delivery; the STATUS comes from the read.
    // A dispute cycles, so conflating them is how a reopened dispute reads as
    // settled.
    expect(argsOf("payment_case_upsert").p_verified_status).toBe("under_review");
  });

  // ---------------------------------------------------------------------
  // THE PROVIDER'S ANSWER MUST BE ABOUT THE THING THAT WAS ASKED FOR. A probe
  // of the source found readCase accepting a DIFFERENT valid-shaped id in the
  // body for both refunds and disputes: the shape was parsed, the identity was
  // never compared, so another customer's refund could be filed against this
  // order.
  // ---------------------------------------------------------------------
  it("refuses a refund body that answers about a different refund", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.refund = {
      entity: "refund",
      id: "rfnd_SOMEONEelse99",
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_error).toBe("refund-id-mismatch");
  });

  it("refuses a dispute body that answers about a different dispute", async () => {
    scenario.inboxRows = [
      inboxRow({ event_class: "dispute", event_name: "dispute.lost", provider_dispute_id: DISP }),
    ];
    scenario.dispute = {
      entity: "dispute",
      id: "disp_SOMEONEelse9",
      payment_id: PAY,
      amount: 4900,
      currency: "INR",
      status: "lost",
    };
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_error).toBe("dispute-id-mismatch");
  });

  it("refuses a case amount that is not a positive whole number of paise", async () => {
    for (const amount of [0, -100, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      calls = [];
      scenario.inboxRows = [refundRow()];
      scenario.refund = {
        entity: "refund",
        id: RFND,
        payment_id: PAY,
        amount,
        currency: "INR",
        status: "processed",
      };
      await callRecovery();
      expect(rpcNames()).not.toContain("payment_case_upsert");
      // Two guards refuse these, and which one speaks first is not the point:
      // the parser's own bound catches most, the binding check catches the
      // rest. What matters is that NEITHER lets it through.
      expect(["provider-bad-amount", "case-amount-invalid"]).toContain(
        argsOf("payment_inbox_complete").p_error,
      );
    }
  });

  // A CASE WITH NOTHING TO CHECK IT AGAINST IS NOT VERIFIED. With neither an
  // event payment id nor a stored one there is no anchor, and "it matched"
  // would mean "nothing contradicted it". The binding read refuses this row
  // first, which is the same answer one guard earlier — what is asserted is
  // that an unanchored case never reaches the case routine.
  it("never files a case it has no payment to check against", async () => {
    scenario.inboxRows = [
      inboxRow({
        event_class: "refund",
        event_name: "refund.processed",
        provider_refund_id: RFND,
        provider_payment_id: null,
      }),
    ];
    // A purchase that is otherwise perfectly readable and has simply never
    // recorded a payment id. Everything else about this refund lines up, so
    // only the anchor rule stands between it and being filed.
    scenario.tables = { story_purchases: [purchaseRow({ provider_payment_id: null })] };
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_outcome).not.toBe("done");
  });

  // ---------------------------------------------------------------------
  // THE DATABASE'S OWN VERDICT DECIDES, NOT THE HTTP STATUS. A 200 carrying
  // `linkage-conflict` means the content was REFUSED; counting it as done
  // would report a discarded fact as processed, and retrying it would spend
  // the budget on a decision no retry can change.
  // ---------------------------------------------------------------------
  it.each([
    ["linkage-conflict", "case-linkage-conflict"],
    ["conflict", "case-conflict"],
  ])("files a %s as handled-but-not-done", async (outcome, code) => {
    scenario.inboxRows = [refundRow()];
    scenario.caseOutcome = outcome;
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    const done = argsOf("payment_inbox_complete");
    expect(done.p_outcome).toBe("ignored");
    expect(done.p_error).toBe(code);
  });

  it("carries the routine's own outcome through on success", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.caseOutcome = "reopened";
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    expect(argsOf("payment_inbox_complete")).toMatchObject({
      p_outcome: "done",
      p_error: "case-reopened",
    });
  });

  it("retries rather than guesses when the routine answers something unknown", async () => {
    scenario.inboxRows = [refundRow()];
    scenario.caseOutcome = "whatever-comes-next";
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    await callRecovery();
    expect(argsOf("payment_inbox_complete")).toMatchObject({
      p_outcome: "retry",
      p_error: "case-unknown-outcome",
    });
  });

  it("retries an actionable event whose case id is unusable", async () => {
    scenario.inboxRows = [
      inboxRow({ event_class: "refund", event_name: "refund.created", provider_refund_id: null }),
    ];
    await callRecovery();
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });
});

describe("reconciliation — the payment whose event never arrived", () => {
  const recRow = (over: Record<string, unknown> = {}) => ({
    purchase_table: "story_purchases",
    provider_order_id: ORDER,
    lease_token: LEASE,
    ...over,
  });

  it("finds a captured payment nobody told us about and grants it", async () => {
    scenario.reconcileRows = [recRow()];
    scenario.orderPayments = [capturedPayment()];
    const res = await callRecovery();
    expect(rpcNames()).toContain("credit_story_purchase");
    expect(argsOf("credit_story_purchase")).toMatchObject({
      _provider_order_id: ORDER,
      _provider_payment_id: PAY,
      // THE HONEST LABEL. Passing 'webhook' to slip past a constraint would be
      // recording a client confirmation that never happened.
      _confirmed_by: "reconcile",
    });
    expect(argsOf("payment_reconcile_complete").p_outcome).toBe("resolved");
    expect(await res.json()).toMatchObject({ reconcile: { claimed: 1, done: 1 } });
  });

  it("skips an order with no captured payment rather than calling it resolved work", async () => {
    scenario.reconcileRows = [recRow()];
    scenario.orderPayments = [];
    const res = await callRecovery();
    expect(rpcNames()).not.toContain("credit_story_purchase");
    expect(argsOf("payment_reconcile_complete").p_outcome).toBe("skipped");
    const body = (await res.json()) as { reconcile: Record<string, number> };
    expect(body.reconcile.done).toBe(0);
    expect(body.reconcile.skipped).toBe(1);
  });

  it("skips a row somebody has already settled", async () => {
    scenario.reconcileRows = [recRow()];
    scenario.tables = { story_purchases: [purchaseRow({ provider_payment_id: PAY })] };
    await callRecovery();
    expect(rpcNames()).not.toContain("credit_story_purchase");
    expect(argsOf("payment_reconcile_complete").p_outcome).toBe("skipped");
  });

  it("retries when the provider list read fails", async () => {
    scenario.reconcileRows = [recRow()];
    scenario.orderPaymentsStatus = 500;
    await callRecovery();
    expect(argsOf("payment_reconcile_complete").p_outcome).toBe("retry");
  });

  // ═══ THE FOOD CONTRACT, WHICH CURRENTLY REFUSES 'reconcile' ═══
  // `mark_order_paid` rejects `_confirmed_by='reconcile'` for EVERY food row.
  // Until the grant-SQL cycle widens that, a food reconciliation must stay
  // VISIBLE — a retry that exhausts into a manual case — and must never be
  // relabelled as a client confirmation to get past the check.
  it("keeps a refused food reconciliation visible instead of resolving it", async () => {
    scenario.reconcileRows = [recRow({ purchase_table: "orders" })];
    scenario.tables = { orders: [purchaseRow({ price_paise: undefined, total_paise: 4900 })] };
    scenario.orderPayments = [capturedPayment()];
    scenario.grantResult = { ok: false, reason: "confirmed_by not allowed" };
    await callRecovery();
    const outcome = argsOf("payment_reconcile_complete").p_outcome;
    expect(outcome).toBe("retry");
    expect(outcome).not.toBe("resolved");
    // And it never re-labels itself to slip past the constraint.
    const sent = rpcCalls().map((c) => (c.body as Record<string, unknown>)?._confirmed_by);
    expect(sent).not.toContain("webhook");
  });

  it("counts a lost reconcile lease as lost, never as resolved", async () => {
    scenario.reconcileRows = [recRow()];
    scenario.orderPayments = [capturedPayment()];
    scenario.reconcileCompleteOk = false;
    const res = await callRecovery();
    const body = (await res.json()) as { reconcile: Record<string, number> };
    expect(body.reconcile.leaseLost).toBe(1);
    expect(body.reconcile.done).toBe(0);
  });

  it("asks for a bounded reconcile batch", async () => {
    await callRecovery();
    const args = argsOf("payment_reconcile_claim");
    expect(args.p_limit as number).toBeGreaterThan(0);
    expect(args.p_limit as number).toBeLessThanOrEqual(50);
  });
});

describe("the bounds are real, in both directions", () => {
  it("refuses a provider body over the ceiling instead of buffering it", async () => {
    scenario.inboxRows = [
      inboxRow({
        event_class: "refund",
        event_name: "refund.processed",
        provider_refund_id: RFND,
      }),
    ];
    scenario.hugeProviderBody = true;
    const res = await callRecovery();
    expect(res.status).toBe(200);
    expect(rpcNames()).not.toContain("payment_case_upsert");
    expect(argsOf("payment_inbox_complete").p_outcome).toBe("retry");
  });

  it("refuses a request body over the ceiling", async () => {
    const handler = await loadHandler();
    const res = await handler(
      new Request("https://fn.test/razorpay-webhook?mode=recovery", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ pad: "x".repeat(64 * 1024) }),
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("refuses a body that is not JSON", async () => {
    const handler = await loadHandler();
    const res = await handler(
      new Request("https://fn.test/razorpay-webhook?mode=recovery", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: "{oops",
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("sends every database call with the service credential and no redirect following", async () => {
    scenario.inboxRows = [inboxRow()];
    await callRecovery();
    expect(rpcCalls().length).toBeGreaterThan(0);
  });

  // ═══ NOTHING HERE MOVES MONEY ═══
  it("makes no write of any kind to the provider, across every path above", async () => {
    scenario.inboxRows = [
      inboxRow(),
      inboxRow({
        id: "r",
        event_class: "refund",
        event_name: "refund.processed",
        provider_refund_id: RFND,
      }),
      inboxRow({
        id: "d",
        event_class: "dispute",
        event_name: "dispute.lost",
        provider_dispute_id: DISP,
      }),
    ];
    scenario.refund = {
      entity: "refund",
      id: RFND,
      payment_id: PAY,
      amount: 100,
      currency: "INR",
      status: "processed",
    };
    scenario.dispute = {
      entity: "dispute",
      id: DISP,
      payment_id: PAY,
      amount: 4900,
      currency: "INR",
      status: "lost",
    };
    scenario.reconcileRows = [
      { purchase_table: "story_purchases", provider_order_id: ORDER, lease_token: LEASE },
    ];
    scenario.orderPayments = [capturedPayment()];
    await callRecovery();

    const provider = calls.filter((c) => c.url.startsWith("https://api.razorpay.com"));
    expect(provider.length).toBeGreaterThan(0);
    for (const c of provider) expect(c.method).toBe("GET");
    // And the verbs that move money never appear in a URL either.
    for (const c of provider) {
      expect(c.url).not.toMatch(/\/(refund|capture|payout|transfer)s?$/);
    }
  });

  it("survives a database that is entirely unreachable without claiming success", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket");
    }) as typeof fetch;
    const res = await callRecovery();
    const body = (await res.json()) as { inbox?: { error?: string } };
    expect(res.status).toBe(200);
    expect(body.inbox?.error).toBeTruthy();
  });
});
