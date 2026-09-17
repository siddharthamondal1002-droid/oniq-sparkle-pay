/**
 * THE PURE HALF OF PAYMENT RECOVERY, EXECUTED.
 *
 * Every assertion below runs the committed functions against fixture bodies
 * shaped like Razorpay's own: a refund event carries BOTH a refund entity and
 * the whole payment it came from, which is the fixture that matters — reading
 * the payment first records a partial refund as a total one.
 *
 * The module specifier goes through a VARIABLE so `tsc` does not pull the
 * `_shared` tree's `Deno.` references into the browser program, the same reason
 * `razorpayConfirmRuntime.test.ts` and `geminiReplyModel.test.ts` do it.
 *
 * No network and no credentials: `fetchOrderPayments` is given a fake fetch.
 */
import { describe, it, expect } from "vitest";

const MOD = "../../../supabase/functions/_shared/paymentRecovery.ts";
type Rec = Record<string, unknown>;

const ORDER = "order_ABCdef123456";
const PAY = "pay_ABCdef123456";

// A plain record, not `as never`: spreading a `never` is a type error, and the
// cast belongs at the call sites that need the nominal type.
const binding: Rec = {
  kind: "story",
  table: "story_purchases",
  providerOrderId: ORDER,
  userId: "11111111-1111-1111-1111-111111111111",
  amountMinor: 4900,
  currency: "INR",
  storedPaymentId: null,
  status: "created",
  creditRpc: "credit_story_purchase",
  failRpc: "fail_story_purchase",
  failShape: "order",
};

async function mod() {
  return (await import(/* @vite-ignore */ MOD)) as Rec & {
    classifyEvent: (n: string) => string;
    caseRank: (n: string) => number;
    advancesCase: (c: string | null, i: string) => boolean;
    extractEventFacts: (e: Rec) => Rec;
    providerEventId: (h: string | null) => string | null;
    sha256Hex: (t: string) => Promise<string>;
    backoffSeconds: (a: number) => number;
    isExhausted: (a: number) => boolean;
    pickCapturedPayment: (i: readonly Rec[], b: never) => Rec;
    fetchOrderPayments: (c: Rec, o: string, f: typeof fetch) => Promise<Rec>;
    mayRecordFailure: (b: never) => boolean;
    redact: (c: unknown) => string;
    MAX_ATTEMPTS: number;
  };
}

describe("event classification", () => {
  it("names the real events, including the dispute prefix that is easy to get wrong", async () => {
    const m = await mod();
    expect(m.classifyEvent("payment.captured")).toBe("paid");
    expect(m.classifyEvent("order.paid")).toBe("paid");
    expect(m.classifyEvent("payment.failed")).toBe("failed");
    expect(m.classifyEvent("refund.processed")).toBe("refund");
    // `dispute.created` is NOT a Razorpay event name; a handler keyed on it
    // never fires, and silently, because unmatched events are acknowledged.
    expect(m.classifyEvent("payment.dispute.created")).toBe("dispute");
    expect(m.classifyEvent("dispute.created")).toBe("other");
    expect(m.classifyEvent("subscription.charged")).toBe("other");
  });

  it("ranks case states and refuses to walk backwards or sideways", async () => {
    const m = await mod();
    expect(m.advancesCase("refund.created", "refund.processed")).toBe(true);
    expect(m.advancesCase("refund.processed", "refund.created")).toBe(false);
    expect(m.advancesCase("refund.created", "refund.created")).toBe(false);
    expect(m.advancesCase(null, "refund.created")).toBe(true);
    expect(m.advancesCase(null, "refund.invented_state")).toBe(false);
    // won and lost share a rank on purpose: arrival order is not evidence.
    expect(m.caseRank("payment.dispute.won")).toBe(m.caseRank("payment.dispute.lost"));
  });
});

describe("extracting facts from a verified body", () => {
  it("takes a PARTIAL refund from the refund entity, not the payment it came from", async () => {
    const m = await mod();
    const f = m.extractEventFacts({
      event: "refund.created",
      payload: {
        refund: {
          entity: { id: "rfnd_ABCdef123456", payment_id: PAY, amount: 4900, status: "created" },
        },
        // The same body carries the whole payment. Reading this first is how a
        // ₹49 refund of a ₹4,900 payment gets written down as ₹4,900.
        payment: {
          entity: { id: PAY, order_id: ORDER, amount: 490000, status: "captured" },
        },
      },
    });
    expect(f.amountMinor).toBe(4900);
    expect(f.providerStatus).toBe("created");
    expect(f.providerRefundId).toBe("rfnd_ABCdef123456");
    expect(f.eventClass).toBe("refund");
  });

  it("takes a dispute's own amount and status over the payment's", async () => {
    const m = await mod();
    const f = m.extractEventFacts({
      event: "payment.dispute.created",
      payload: {
        dispute: {
          entity: { id: "disp_ABCdef123456", payment_id: PAY, amount: 1200, status: "open" },
        },
        payment: { entity: { id: PAY, order_id: ORDER, amount: 490000, status: "captured" } },
      },
    });
    expect(f.amountMinor).toBe(1200);
    expect(f.providerStatus).toBe("open");
    expect(f.providerDisputeId).toBe("disp_ABCdef123456");
    expect(f.providerOrderId).toBe(ORDER);
  });

  it("leaves a refund UNKNOWN rather than substituting the payment's amount", async () => {
    const m = await mod();
    const payment = { entity: { id: PAY, order_id: ORDER, amount: 490000, status: "captured" } };

    // The refund entity carries no amount at all.
    const missing = m.extractEventFacts({
      event: "refund.created",
      payload: { refund: { entity: { id: "rfnd_ABCdef123456", payment_id: PAY } }, payment },
    });
    expect(missing.amountMinor).toBeNull();
    expect(missing.providerStatus).toBeNull();

    // And the shape that is worse, because it looks like data: a string.
    const stringy = m.extractEventFacts({
      event: "refund.created",
      payload: {
        refund: { entity: { id: "rfnd_ABCdef123456", amount: "4900", status: 7 } },
        payment,
      },
    });
    expect(stringy.amountMinor).toBeNull();
    expect(stringy.providerStatus).toBeNull();

    // Same rule for a dispute.
    const disputed = m.extractEventFacts({
      event: "payment.dispute.created",
      payload: { dispute: { entity: { id: "disp_ABCdef123456", payment_id: PAY } }, payment },
    });
    expect(disputed.amountMinor).toBeNull();
    // The linkage still resolves: only the FACTS are unknown.
    expect(disputed.providerPaymentId).toBe(PAY);
  });

  it("still reads the payment for a capture", async () => {
    const m = await mod();
    const f = m.extractEventFacts({
      event: "payment.captured",
      payload: { payment: { entity: { id: PAY, order_id: ORDER, amount: 4900, status: "captured" } } },
    });
    expect(f).toMatchObject({
      eventClass: "paid",
      amountMinor: 4900,
      providerPaymentId: PAY,
      providerOrderId: ORDER,
      providerStatus: "captured",
    });
  });

  it("does not throw on a huge epoch, a hostile name, or a body with no payload", async () => {
    const m = await mod();
    // Number.isSafeInteger(1e15) is true and new Date(1e18).toISOString() throws.
    // A throw here loses the event before it is ever written down.
    const huge = m.extractEventFacts({
      event: "payment.captured",
      payload: { payment: { entity: { created_at: 1e15 } } },
    });
    expect(huge.providerCreatedAt).toBeNull();
    expect(
      m.extractEventFacts({
        event: "payment.captured",
        payload: { payment: { entity: { created_at: -1 } } },
      }).providerCreatedAt,
    ).toBeNull();
    expect(
      m.extractEventFacts({
        event: "payment.captured",
        payload: { payment: { entity: { created_at: 1_700_000_000 } } },
      }).providerCreatedAt,
    ).toBe("2023-11-14T22:13:20.000Z");
    expect((m.extractEventFacts({ event: "x".repeat(500) }).eventName as string).length).toBe(64);
    expect(m.extractEventFacts({}).eventClass).toBe("other");
    expect(m.extractEventFacts({ event: "refund.created", payload: "nope" }).amountMinor).toBeNull();
  });

  it("keeps nothing that identifies a person", async () => {
    const m = await mod();
    const f = m.extractEventFacts({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: PAY,
            order_id: ORDER,
            amount: 4900,
            email: "someone@example.com",
            contact: "+919000000000",
            card: { last4: "1111" },
            vpa: "someone@upi",
            notes: { user_id: "leak" },
          },
        },
      },
    });
    expect(JSON.stringify(f)).not.toMatch(/example\.com|9000000000|1111|upi|leak/);
  });
});

describe("delivery identity and digest", () => {
  it("keeps a usable event id and refuses an unusable one", async () => {
    const m = await mod();
    expect(m.providerEventId("abc123def")).toBe("abc123def");
    expect(m.providerEventId(null)).toBeNull();
    expect(m.providerEventId("short")).toBeNull();
    expect(m.providerEventId("has spaces and ; semicolons")).toBeNull();
  });

  it("hashes the exact bytes", async () => {
    const m = await mod();
    const a = await m.sha256Hex('{"event":"payment.captured"}');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await m.sha256Hex('{"event":"payment.captured"}')).toBe(a);
    expect(await m.sha256Hex('{"event":"payment.captured" }')).not.toBe(a);
  });
});

describe("the retry schedule", () => {
  it("grows and then stops growing", async () => {
    const m = await mod();
    expect(m.backoffSeconds(0)).toBe(30);
    expect(m.backoffSeconds(3)).toBeGreaterThan(m.backoffSeconds(1));
    // The cap is the point: an unbounded backoff is a row nobody looks at again.
    expect(m.backoffSeconds(99)).toBe(86400);
    expect(m.isExhausted(m.MAX_ATTEMPTS - 1)).toBe(false);
    expect(m.isExhausted(m.MAX_ATTEMPTS)).toBe(true);
  });
});

describe("picking the payment that settles our row", () => {
  // `entity: "payment"` is part of the evidence, and its absence is the first
  // thing the shared parser refuses. The earlier private parser in this module
  // accepted an item without it, and without `refund_status`.
  const captured = (over: Rec = {}): Rec => ({
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
  });

  const pick = (m: Awaited<ReturnType<typeof mod>>, items: Rec[], b: Rec = binding) =>
    m.pickCapturedPayment(items, b as never) as Rec;

  it("takes the single exact match", async () => {
    const m = await mod();
    expect((pick(m, [captured()]).payment as Rec).id).toBe(PAY);
  });

  it("refuses the two items the private parser used to accept", async () => {
    const m = await mod();
    // No entity envelope at all.
    const noEntity = captured();
    delete noEntity.entity;
    expect((pick(m, [noEntity]).error as Rec).code).toBe("provider-bad-entity");

    // refund_status absent is not evidence of no refund; it is evidence that
    // the refund state was never read.
    const noRefundStatus = captured();
    delete noRefundStatus.refund_status;
    expect((pick(m, [noRefundStatus]).error as Rec).code).toBe("provider-bad-refund-status");
  });

  it("refuses a captured payment that disagrees with the id our row already stored", async () => {
    const m = await mod();
    const settled = { ...binding, storedPaymentId: "pay_AAAdef123456" };
    const e = pick(m, [captured()], settled).error as Rec;
    expect(e.code).toBe("stored-payment-id-conflict");
    expect(e.retryable).toBe(false);
    // The same id is not a conflict; it is the row settling against itself.
    const same = { ...binding, storedPaymentId: PAY };
    expect((pick(m, [captured()], same).payment as Rec).id).toBe(PAY);
  });

  it("passes over what is ordinary and refuses what is wrong", async () => {
    const m = await mod();
    const other = captured({ order_id: "order_ZZZZZZ999999", id: "pay_ZZZZZZ999999" });
    const authorized = captured({ status: "authorized", captured: false });

    // Another order, and an unsettled attempt on ours: both ordinary.
    expect((pick(m, [other, authorized]).error as Rec).code).toBe("no-captured-payment");

    // On OUR order and not matching it: named by the SHARED validators.
    for (const [over, code] of [
      [{ amount: 4800 }, "amount-mismatch"],
      [{ currency: "USD" }, "currency-mismatch"],
      [{ amount: "4900" }, "provider-bad-amount"],
      [{ id: "nonsense" }, "provider-bad-shape"],
      [{ amount_refunded: "0" }, "provider-bad-refund-amount"],
      [{ amount_refunded: 100 }, "refunded"],
      [{ refund_status: "partial" }, "refunded"],
    ] as [Rec, string][]) {
      // `expect([code, e.retryable]).toEqual([e.code, false])` was the first
      // form of this and compared e.code with ITSELF — green whatever the code.
      expect((pick(m, [captured(over)]).error as Rec).code).toBe(code);
    }
  });

  it("refuses two candidates rather than taking the first", async () => {
    const m = await mod();
    const e = pick(m, [captured(), captured({ id: "pay_BBBdef123456" })]).error as Rec;
    expect(e.code).toBe("ambiguous-captured-payment");
    expect(e.retryable).toBe(false);
  });

  it("refuses an unreadable item instead of dropping it", async () => {
    const m = await mod();
    expect((pick(m, [{ order_id: 42 }]).error as Rec).code).toBe("provider-bad-entity");
  });
});

describe("the one outbound call", () => {
  const creds = { keyId: "rzp_test_key", keySecret: "secret" };

  it("is a GET of a fixed origin, and never a write", async () => {
    const m = await mod();
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ items: [{ id: PAY }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = (await m.fetchOrderPayments(creds, ORDER, fake)) as Rec;
    expect((r.items as Rec[]).length).toBe(1);
    expect(seen!.url).toBe(`https://api.razorpay.com/v1/orders/${ORDER}/payments`);
    expect(seen!.init.method).toBe("GET");
    expect(seen!.init.redirect).toBe("manual");
  });

  it("refuses a redirect, a bad body, and an unreadable item", async () => {
    const m = await mod();
    const respond = (body: string, status = 200) =>
      (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(
      (((await m.fetchOrderPayments(creds, ORDER, respond("", 302))) as Rec).error as Rec).code,
    ).toBe("provider-redirect");
    expect(
      (((await m.fetchOrderPayments(creds, ORDER, respond("{"))) as Rec).error as Rec).code,
    ).toBe("provider-bad-json");
    // A dropped item reads downstream as "no captured payment", which is
    // retryable, so a shape change would look like the provider being slow.
    expect(
      (
        ((await m.fetchOrderPayments(creds, ORDER, respond('{"items":["x"]}'))) as Rec)
          .error as Rec
      ).code,
    ).toBe("provider-bad-item");
    expect(
      (((await m.fetchOrderPayments(creds, "not-an-order", respond("{}"))) as Rec).error as Rec)
        .code,
    ).toBe("invalid-order-id");
  });
});

describe("a stale failure may not downgrade a settled purchase", () => {
  it("allows the open states and refuses the settled ones", async () => {
    const m = await mod();
    expect(m.mayRecordFailure({ ...binding, status: "created" } as never)).toBe(true);
    expect(m.mayRecordFailure({ ...binding, status: "paid" } as never)).toBe(false);
    expect(
      m.mayRecordFailure({ ...binding, status: "created", storedPaymentId: PAY } as never),
    ).toBe(false);
  });
});

describe("logging", () => {
  it("passes our own codes and nothing else", async () => {
    const m = await mod();
    expect(m.redact("provider-http-502")).toBe("provider-http-502");
    expect(m.redact("payer email someone@example.com")).toBe("unknown");
    expect(m.redact({ body: "secret" })).toBe("unknown");
    expect(m.redact("x".repeat(200))).toBe("unknown");
  });
});
