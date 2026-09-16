// razorpayConfirm — the evidence layer between "a signature checked out" and
// "grant the thing".
//
// WHY THIS EXISTS. Both confirmation paths used to reason like this: the HMAC
// matched, therefore the payment happened, therefore call the grant RPC. That
// is two claims too many. A checkout signature proves only that *some* payment
// id was paired with *some* order id by a party holding the key secret — it
// says nothing about the amount, the currency, or whether the money was ever
// captured. An `authorized` payment (money held, never taken) carries a
// perfectly valid signature. A webhook `notes.kind` is a routing hint we wrote
// ourselves and is not evidence of anything.
//
// SO EVERY GRANT NOW RESTS ON THREE INDEPENDENT FACTS:
//
//   1. OUR ROW says which product this order is, who owns it, and what it
//      should cost. Resolved from the database by provider order id — never
//      from the browser body and never from the event's notes.
//   2. THE SIGNATURE ties the caller's payment id to OUR STORED order id.
//   3. RAZORPAY'S OWN RECORD of that specific payment, fetched server-side,
//      agrees on id, order, amount, currency, and says captured.
//
// Any disagreement refuses. A refusal is never a grant, and a failure we
// cannot classify is retryable rather than quietly settled.
//
// ISOLATED FROM THE PAYOUT HELPER ON PURPOSE. `createRazorpayPayout` moves
// money OUT; nothing here may ever be reachable from that path, and this
// module makes no POST to Razorpay at all — it reads one payment, once.

import type { RazorpayCreds } from "./razorpay.ts";

/** The five things ONIQ sells through the one Razorpay account. */
export type ProductKind =
  | "order"
  | "story_seconds"
  | "watermark_removal"
  | "plan_month"
  | "video_seconds";

type ProductSpec = {
  kind: ProductKind;
  table: string;
  /** Where the authoritative minor-unit price lives on that table. */
  amountColumn: "amount_minor" | "price_paise";
  creditRpc: string;
  failRpc: string;
};

/**
 * THE WHOLE PRODUCT MAP, in one place. Adding a sixth product means adding a
 * row here; forgetting to teach one of the two handlers about it is then
 * impossible, because neither handler names a table or an RPC any more.
 */
export const PRODUCTS: readonly ProductSpec[] = [
  {
    kind: "order",
    table: "payments",
    amountColumn: "amount_minor",
    creditRpc: "mark_order_paid",
    failRpc: "mark_payment_failed",
  },
  {
    kind: "story_seconds",
    table: "story_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_story_purchase",
    failRpc: "fail_story_purchase",
  },
  {
    kind: "watermark_removal",
    table: "watermark_purchases",
    amountColumn: "price_paise",
    creditRpc: "settle_watermark_purchase",
    failRpc: "fail_watermark_purchase",
  },
  {
    kind: "plan_month",
    table: "plan_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_plan_purchase",
    failRpc: "fail_plan_purchase",
  },
  {
    kind: "video_seconds",
    table: "video_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_video_purchase",
    failRpc: "fail_video_purchase",
  },
];

/** A refusal or a failure. `retryable` decides whether the caller may 5xx. */
export type ConfirmFailure = { code: string; retryable: boolean };

export type PurchaseBinding = {
  kind: ProductKind;
  table: string;
  providerOrderId: string;
  userId: string;
  /** Minor units (paise), read from our own row. */
  amountMinor: number;
  currency: string;
  /** Already-recorded provider payment id, if this row has settled before. */
  storedPaymentId: string | null;
  status: string;
  creditRpc: string;
  failRpc: string;
};

/**
 * Razorpay ids are `order_`/`pay_` plus a short alphanumeric tail. Validating
 * the SHAPE before either hashing it or putting it in a URL is what keeps a
 * hostile body from reaching a query string or a path segment at all.
 */
export function isProviderId(value: unknown, prefix: "order" | "pay"): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,48}$`).test(value);
}

type Rest = { supabaseUrl: string; serviceKey: string };

function svcHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

/**
 * WHICH PRODUCT IS THIS, ACCORDING TO US.
 *
 * Every table is asked, and finding the id in two of them is an AMBIGUOUS
 * refusal rather than a first-match win: two products claiming one provider
 * order means our own data is wrong, and guessing which ledger to credit is
 * the one mistake that cannot be undone from here.
 */
export async function resolveBinding(
  rest: Rest,
  providerOrderId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ binding: PurchaseBinding } | { error: ConfirmFailure }> {
  if (!isProviderId(providerOrderId, "order")) {
    return { error: { code: "invalid-order-id", retryable: false } };
  }

  const found: PurchaseBinding[] = [];
  for (const spec of PRODUCTS) {
    const select = `user_id,currency,status,provider_payment_id,${spec.amountColumn}`;
    const url =
      `${rest.supabaseUrl}/rest/v1/${spec.table}` +
      `?provider_order_id=eq.${encodeURIComponent(providerOrderId)}&select=${select}&limit=2`;
    let res: Response;
    try {
      res = await doFetch(url, { headers: svcHeaders(rest.serviceKey) });
    } catch {
      return { error: { code: "binding-read-failed", retryable: true } };
    }
    if (!res.ok) return { error: { code: "binding-read-failed", retryable: true } };
    let rows: Record<string, unknown>[];
    try {
      rows = (await res.json()) as Record<string, unknown>[];
    } catch {
      return { error: { code: "binding-read-failed", retryable: true } };
    }
    if (!Array.isArray(rows) || rows.length === 0) continue;
    // Two rows in ONE table under one provider order id is the same corruption
    // as two tables claiming it.
    if (rows.length > 1) return { error: { code: "ambiguous-binding", retryable: false } };

    const row = rows[0];
    const amount = row[spec.amountColumn];
    const userId = row.user_id;
    const currency = row.currency;
    if (typeof userId !== "string" || !userId) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    if (typeof currency !== "string" || !currency) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    const storedPaymentId = row.provider_payment_id;
    found.push({
      kind: spec.kind,
      table: spec.table,
      providerOrderId,
      userId,
      amountMinor: amount,
      currency,
      storedPaymentId: typeof storedPaymentId === "string" && storedPaymentId ? storedPaymentId : null,
      status: typeof row.status === "string" ? row.status : "",
      creditRpc: spec.creditRpc,
      failRpc: spec.failRpc,
    });
  }

  if (found.length === 0) return { error: { code: "unknown-order", retryable: false } };
  if (found.length > 1) return { error: { code: "ambiguous-binding", retryable: false } };
  return { binding: found[0] };
}

/** The subset of Razorpay's payment entity this module is willing to read. */
export type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  amount_refunded?: number;
  refund_status?: string | null;
};

const PAYMENT_URL_BASE = "https://api.razorpay.com/v1/payments/";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Read ONE payment from Razorpay with the server credentials.
 *
 * BOUNDED IN EVERY DIRECTION, because this call sits in front of a grant: a
 * fixed https origin so no field of ours can redirect it, `redirect: "manual"`
 * so a 3xx is a refusal rather than a hop to somewhere else, a deadline so a
 * hung socket cannot hold a webhook open, a body cap so a huge response cannot
 * exhaust the function, and NO RETRY — a retry here is a second chance to
 * grant, and the caller's own retry (Razorpay's, or the user's) is the right
 * place for that.
 *
 * Nothing from the provider payload is logged; only our own code strings are.
 */
export async function fetchRazorpayPayment(
  creds: RazorpayCreds,
  paymentId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ payment: RazorpayPayment } | { error: ConfirmFailure }> {
  if (!isProviderId(paymentId, "pay")) {
    return { error: { code: "invalid-payment-id", retryable: false } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(`${PAYMENT_URL_BASE}${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: {
        Authorization: "Basic " + btoa(`${creds.keyId}:${creds.keySecret}`),
        accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return { error: { code: "provider-redirect", retryable: false } };
    }
    const text = await readBounded(res);
    if (text === null) return { error: { code: "provider-body-too-large", retryable: false } };
    if (!res.ok) {
      // 5xx and 429 are Razorpay having a bad minute; 4xx is a verdict.
      const retryable = res.status >= 500 || res.status === 429;
      return { error: { code: `provider-http-${res.status}`, retryable } };
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: { code: "provider-bad-json", retryable: true } };
    }
    if (typeof body.id !== "string" || typeof body.order_id !== "string") {
      return { error: { code: "provider-bad-shape", retryable: false } };
    }
    return {
      payment: {
        id: body.id,
        order_id: body.order_id,
        amount: typeof body.amount === "number" ? body.amount : Number.NaN,
        currency: typeof body.currency === "string" ? body.currency : "",
        status: typeof body.status === "string" ? body.status : "",
        captured: body.captured === true,
        amount_refunded: typeof body.amount_refunded === "number" ? body.amount_refunded : 0,
        refund_status:
          typeof body.refund_status === "string" ? body.refund_status : null,
      },
    };
  } catch {
    // Abort, DNS, reset — we do not know what happened, so it stays retryable
    // and nothing is granted.
    return { error: { code: "provider-unreachable", retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/** Read at most MAX_BODY_BYTES of a response; null means it was bigger. */
async function readBounded(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) return null;
  return new TextDecoder().decode(buf);
}

/**
 * Does Razorpay's record of this payment actually match the thing we are about
 * to give away? Pure, so the whole truth table is testable.
 *
 * `captured === true` AND `status === "captured"` are both required and they
 * are not the same claim: `authorized` means the money is held and has not
 * moved, and that must never buy anything.
 */
export function evidenceMatches(
  payment: RazorpayPayment,
  binding: PurchaseBinding,
  expectedPaymentId: string,
): { ok: true } | { ok: false; error: ConfirmFailure } {
  const refuse = (code: string) => ({ ok: false as const, error: { code, retryable: false } });
  if (payment.id !== expectedPaymentId) return refuse("payment-id-mismatch");
  if (payment.order_id !== binding.providerOrderId) return refuse("order-id-mismatch");
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0) return refuse("invalid-amount");
  if (payment.amount !== binding.amountMinor) return refuse("amount-mismatch");
  if (payment.currency.toUpperCase() !== binding.currency.toUpperCase()) {
    return refuse("currency-mismatch");
  }
  if (payment.status !== "captured" || payment.captured !== true) return refuse("not-captured");
  if ((payment.amount_refunded ?? 0) > 0) return refuse("refunded");
  if (payment.refund_status) return refuse("refunded");
  // A row that already names a DIFFERENT payment is a second payment against
  // one purchase. Refusing keeps the first settlement authoritative.
  if (binding.storedPaymentId && binding.storedPaymentId !== expectedPaymentId) {
    return refuse("payment-id-conflict");
  }
  return { ok: true };
}

/**
 * Everything between "we have an order id and a payment id" and "it is safe to
 * grant". Used identically by the callback and the webhook, which is the point:
 * two paths that check different things are one path that can be walked around.
 */
export async function confirmPayment(
  rest: Rest,
  creds: RazorpayCreds,
  providerOrderId: string,
  providerPaymentId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ binding: PurchaseBinding; payment: RazorpayPayment } | { error: ConfirmFailure }> {
  if (!isProviderId(providerPaymentId, "pay")) {
    return { error: { code: "invalid-payment-id", retryable: false } };
  }
  const bound = await resolveBinding(rest, providerOrderId, doFetch);
  if ("error" in bound) return bound;
  const got = await fetchRazorpayPayment(creds, providerPaymentId, doFetch);
  if ("error" in got) return got;
  const matched = evidenceMatches(got.payment, bound.binding, providerPaymentId);
  if (!matched.ok) return { error: matched.error };
  return { binding: bound.binding, payment: got.payment };
}

/**
 * Call one of the existing service-role grant RPCs and believe it only if it
 * says so. An HTTP 200 carrying `{"ok":false,"reason":"unknown-order"}` is a
 * refusal, and treating it as success is how a caller reports a grant that
 * never happened.
 */
export async function callGrantRpc(
  rest: Rest,
  rpc: string,
  args: Record<string, unknown>,
  doFetch: typeof fetch = fetch,
): Promise<{ result: Record<string, unknown> } | { error: ConfirmFailure }> {
  let res: Response;
  try {
    res = await doFetch(`${rest.supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: { ...svcHeaders(rest.serviceKey), "content-type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch {
    return { error: { code: "grant-unreachable", retryable: true } };
  }
  if (!res.ok) return { error: { code: `grant-http-${res.status}`, retryable: true } };
  let result: unknown;
  try {
    result = await res.json();
  } catch {
    return { error: { code: "grant-bad-json", retryable: true } };
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { error: { code: "grant-bad-result", retryable: true } };
  }
  const row = result as Record<string, unknown>;
  if (row.ok !== true) return { error: { code: "grant-refused", retryable: false } };
  return { result: row };
}

/** Read a request body with a hard ceiling, before anything parses it. */
export async function readBoundedBody(req: Request, maxBytes = 512 * 1024): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) return null;
  return new TextDecoder().decode(buf);
}
