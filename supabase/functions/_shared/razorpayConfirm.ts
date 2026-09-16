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
// SO EVERY GRANT RESTS ON THREE INDEPENDENT FACTS:
//
//   1. OUR ROW says which product this order is, who owns it, and what it
//      should cost. Resolved from the database by provider order id — never
//      from the browser body and never from the event's notes.
//   2. THE SIGNATURE ties the caller's payment id to OUR STORED order id.
//   3. RAZORPAY'S OWN RECORD of that specific payment, fetched server-side,
//      agrees on id, order, amount, currency, refund state, and says captured.
//
// ABSENT IS NOT ZERO, AND MALFORMED IS NOT ABSENT. Earlier this module read a
// missing or non-numeric `amount_refunded` as 0 and an unreadable
// `refund_status` as null — which is inventing the evidence that a payment was
// never refunded out of the fact that we could not read whether it was. Every
// field the decision depends on is now required and typed, and anything else
// refuses.
//
// ISOLATED FROM THE PAYOUT HELPER ON PURPOSE. `createRazorpayPayout` moves
// money OUT; nothing here may ever be reachable from that path, and this
// module makes no POST to Razorpay at all — it reads one payment, once.

import type { RazorpayCreds } from "./razorpay.ts";

/** The five things ONIQ sells through the one Razorpay account. */
export type ProductKind =
  "order" | "story_seconds" | "watermark_removal" | "plan_month" | "video_seconds";

/** What a PostgREST RPC is contracted to answer with. */
export type RpcShape = "json" | "void";

type ProductSpec = {
  kind: ProductKind;
  table: string;
  /** Where the authoritative minor-unit price lives on that table. */
  amountColumn: "amount_minor" | "price_paise";
  creditRpc: string;
  failRpc: string;
  /**
   * The failure RPCs do NOT share a return contract. Read from the live
   * catalogue: `fail_watermark_purchase` is declared `returns void`, so
   * PostgREST answers 200 with a null/empty body, while the other four and
   * `mark_payment_failed` return `jsonb` `{ok:true}`. Treating void as a
   * malformed result made every successful watermark failure look broken.
   */
  failShape: RpcShape;
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
    failShape: "json",
  },
  {
    kind: "story_seconds",
    table: "story_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_story_purchase",
    failRpc: "fail_story_purchase",
    failShape: "json",
  },
  {
    kind: "watermark_removal",
    table: "watermark_purchases",
    amountColumn: "price_paise",
    creditRpc: "settle_watermark_purchase",
    failRpc: "fail_watermark_purchase",
    failShape: "void",
  },
  {
    kind: "plan_month",
    table: "plan_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_plan_purchase",
    failRpc: "fail_plan_purchase",
    failShape: "json",
  },
  {
    kind: "video_seconds",
    table: "video_purchases",
    amountColumn: "price_paise",
    creditRpc: "credit_video_purchase",
    failRpc: "fail_video_purchase",
    failShape: "json",
  },
];

/**
 * A refusal or a failure.
 *
 * `retryable` says whether trying again could plausibly produce a different
 * answer. It is NOT the same question as "may this be acknowledged": the
 * webhook has no durable inbox, so a handled event that was not successfully
 * processed is kept alive whatever this flag says. The flag decides the
 * callback's 4xx-versus-5xx, and appears in logs as our own code string.
 */
export type ConfirmFailure = { code: string; retryable: boolean };

export type PurchaseBinding = {
  kind: ProductKind;
  table: string;
  /** Read back from OUR row, never copied from the caller's string. */
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
  failShape: RpcShape;
};

/**
 * Razorpay ids are `order_`/`pay_` plus a short alphanumeric tail. Validating
 * the SHAPE before either hashing it or putting it in a URL is what keeps a
 * hostile body from reaching a query string or a path segment at all.
 */
export function isProviderId(value: unknown, prefix: "order" | "pay"): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,48}$`).test(value);
}

/** A JSON root we are willing to read: an object, not null, not an array. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Razorpay's checkout and webhook digests are HMAC-SHA256: 64 hex, exactly. */
export function isHexSignature(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

type Rest = { supabaseUrl: string; serviceKey: string };

function svcHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

// ───────────────────────── bounded reads ─────────────────────────

const STREAM_STALL_MS = 8000;

export type BoundedRead = { text: string } | { error: ConfirmFailure };

/**
 * Read a body with the ceiling enforced WHILE STREAMING.
 *
 * `arrayBuffer()` buffers the whole body first and only then lets you look at
 * its size, so a chunked request with no `content-length` could exhaust the
 * function before the check it was supposedly bounded by ever ran. This reads
 * chunk by chunk, stops the moment the running total exceeds the cap, and
 * cancels the stream instead of draining it.
 *
 * BYTES ARE PRESERVED EXACTLY, which matters because the webhook body is
 * hashed. The decoder is `fatal` (malformed input throws rather than being
 * silently replaced with U+FFFD, which would change the bytes the signature is
 * computed over) and `ignoreBOM: true` — confusingly named: it means the BOM is
 * NOT stripped, so a body beginning with one still round-trips byte for byte.
 * No normalisation, no trimming.
 *
 * A read that simply stops producing chunks is bounded too: a stalled upstream
 * must not hold the function open until its wall clock.
 */
export async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  maxBytes: number,
  stallMs: number = STREAM_STALL_MS,
): Promise<BoundedRead> {
  // CANCELLATION IS INITIATED, NEVER AWAITED. `cancel()` resolves only when the
  // underlying source acknowledges, and a source that never does would hold the
  // refusal open for exactly as long as the body we are refusing to read — the
  // bound would be decorative. The rejection is still handled, so the discarded
  // promise cannot surface as an unhandled rejection.
  const abandon = (s: { cancel(): Promise<void> } | null | undefined) => {
    try {
      void s?.cancel().catch(() => {});
    } catch {
      /* a source that throws synchronously is already gone */
    }
  };



  const declared = Number(declaredLength ?? "");
  if (declaredLength !== null && Number.isFinite(declared) && declared > maxBytes) {
    await abandon(body);

    return { error: { code: "body-too-large", retryable: false } };
  }
  if (!body) return { text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>;
      try {
        step = await withDeadline(reader.read(), stallMs);
      } catch (e) {
        abandon(reader);

        // A STALL AND A RESET ARE DIFFERENT FAULTS and must not collapse into
        // one label: the deadline rejects with its own sentinel, so a stream
        // that errors mid-read is reported as a read failure rather than as a
        // silent upstream.
        if (e === DEADLINE) return { error: { code: "body-stalled", retryable: true } };
        return { error: { code: "body-read-failed", retryable: true } };
      }
      if (step.done) break;
      const chunk = step.value;
      if (!chunk) continue;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await abandon(reader);


        return { error: { code: "body-too-large", retryable: false } };
      }
      chunks.push(chunk);
    }
  } catch {
    abandon(reader);
    return { error: { code: "body-read-failed", retryable: true } };
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    // fatal: malformed bytes are an error, never a silent replacement.
    // ignoreBOM: true keeps a leading BOM in the string, so the text hashes
    // to the same digest the provider signed.
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(joined) };
  } catch {
    return { error: { code: "body-not-utf8", retryable: false } };
  }
}

/** The deadline's own rejection value, so it cannot be mistaken for a reset. */
const DEADLINE = Symbol("read-deadline");

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(DEADLINE), Math.max(1, ms));

    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

/** Read a request body with a hard ceiling, before anything parses it. */
export function readBoundedBody(req: Request, maxBytes = 512 * 1024): Promise<BoundedRead> {
  return readBoundedStream(req.body, req.headers.get("content-length"), maxBytes);
}

// ───────────────────────── our own row ─────────────────────────

/**
 * WHICH PRODUCT IS THIS, ACCORDING TO US.
 *
 * Every table is asked, and finding the id in two of them is an AMBIGUOUS
 * refusal rather than a first-match win: two products claiming one provider
 * order means our own data is wrong, and guessing which ledger to credit is
 * the one mistake that cannot be undone from here.
 *
 * THE STORED ORDER ID IS SELECTED AND RE-VALIDATED rather than copied from the
 * caller. `?provider_order_id=eq.X` returning a row is not by itself proof
 * that the row holds exactly X — a filter is not a read — and every later step
 * (the HMAC, the provider comparison, the RPC argument) is built from this
 * field. `provider` is checked for the same reason: a row settled through a
 * different processor is not ours to confirm with Razorpay's evidence.
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
    const select =
      `provider_order_id,provider,user_id,currency,status,provider_payment_id,` + spec.amountColumn;
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
    let rows: unknown;
    try {
      rows = await res.json();
    } catch {
      return { error: { code: "binding-read-failed", retryable: true } };
    }
    // A non-array here is PostgREST answering something we do not understand
    // (an error object, a single row, a string). It is not "no rows".
    if (!Array.isArray(rows)) return { error: { code: "binding-bad-response", retryable: true } };
    if (rows.length === 0) continue;
    // Two rows in ONE table under one provider order id is the same corruption
    // as two tables claiming it.
    if (rows.length > 1) return { error: { code: "ambiguous-binding", retryable: false } };

    const row: unknown = rows[0];
    if (!isPlainRecord(row)) return { error: { code: "binding-bad-response", retryable: true } };

    const storedOrderId = row.provider_order_id;
    if (!isProviderId(storedOrderId, "order") || storedOrderId !== providerOrderId) {
      return { error: { code: "binding-order-mismatch", retryable: false } };
    }
    if (row.provider !== "razorpay") {
      return { error: { code: "binding-wrong-provider", retryable: false } };
    }
    const userId = row.user_id;
    const currency = row.currency;
    const amount = row[spec.amountColumn];
    if (typeof userId !== "string" || !userId) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
      return { error: { code: "invalid-binding", retryable: false } };
    }
    // A non-null payment id that is not a payment id is corruption, not
    // absence. Reading it as "never settled" would let a second payment
    // through against a row whose history we cannot read.
    const stored = row.provider_payment_id;
    let storedPaymentId: string | null = null;
    if (stored !== null && stored !== undefined) {
      if (!isProviderId(stored, "pay")) {
        return { error: { code: "invalid-stored-payment-id", retryable: false } };
      }
      storedPaymentId = stored;
    }

    found.push({
      kind: spec.kind,
      table: spec.table,
      providerOrderId: storedOrderId,
      userId,
      amountMinor: amount,
      currency,
      storedPaymentId,
      status: typeof row.status === "string" ? row.status : "",
      creditRpc: spec.creditRpc,
      failRpc: spec.failRpc,
      failShape: spec.failShape,
    });
  }

  if (found.length === 0) return { error: { code: "unknown-order", retryable: false } };
  if (found.length > 1) return { error: { code: "ambiguous-binding", retryable: false } };
  return { binding: found[0] };
}

// ───────────────────────── the provider's record ─────────────────────────

/** The subset of Razorpay's payment entity this module is willing to read. */
export type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  amountRefunded: number;
  refundStatus: "partial" | "full" | null;
};

const PAYMENT_URL_BASE = "https://api.razorpay.com/v1/payments/";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 64 * 1024;
// JSON null is the unrefunded value. The STRING "null" is not: it is what a
// serialiser produces when it has lost the difference between a null and the
// word, and treating it as unrefunded would grant on a payment whose refund
// state was never actually read.
const REFUND_STATUSES = new Set(["partial", "full"]);


/**
 * Read ONE payment from Razorpay with the server credentials.
 *
 * BOUNDED IN EVERY DIRECTION, because this call sits in front of a grant: a
 * fixed https origin so no field of ours can redirect it, `redirect: "manual"`
 * so a 3xx is a refusal rather than a hop to somewhere else, a deadline so a
 * hung socket cannot hold a webhook open, a streaming body cap, and NO RETRY —
 * a retry here is a second chance to grant, and the caller's own retry
 * (Razorpay's, or the user's) is the right place for that.
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
      // Never followed. A redirect off the pinned origin is a refusal, and it
      // is also the shape a credential or gateway misconfiguration takes.
      return { error: { code: "provider-redirect", retryable: true } };
    }
    const read = await readBoundedStream(
      res.body,
      res.headers.get("content-length"),
      MAX_BODY_BYTES,
    );
    if ("error" in read) {
      return { error: { code: `provider-${read.error.code}`, retryable: read.error.retryable } };
    }
    if (!res.ok) {
      // 401/403/404 are OUR problem as often as theirs — a rotated key, the
      // wrong account, an id we have not caught up with — so they are worth
      // another attempt rather than a silent drop. 5xx and 429 obviously are.
      return { error: { code: `provider-http-${res.status}`, retryable: true } };
    }
    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return { error: { code: "provider-bad-json", retryable: true } };
    }
    if (!isPlainRecord(body)) return { error: { code: "provider-bad-shape", retryable: true } };
    const parsed = parsePaymentEntity(body);
    if ("error" in parsed) return parsed;
    return { payment: parsed.payment };
  } catch {
    // Abort, DNS, reset — we do not know what happened, so it stays retryable
    // and nothing is granted.
    return { error: { code: "provider-unreachable", retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every field a grant depends on, REQUIRED and typed.
 *
 * There are no defaults here on purpose. A numeric string, a negative, a
 * refund larger than the payment, an unrecognised `refund_status`, a missing
 * `captured` — each used to become a benign value, and a benign value invented
 * out of an unreadable one is exactly how money gets given away.
 */
export function parsePaymentEntity(
  body: Record<string, unknown>,
): { payment: RazorpayPayment } | { error: ConfirmFailure } {
  const bad = (code: string, retryable = true) => ({ error: { code, retryable } });
  // The envelope is part of the evidence: a body that is not a payment entity
  // is not a payment, however many payment-shaped fields it happens to carry.
  if (body.entity !== "payment") return bad("provider-bad-entity");
  if (!isProviderId(body.id, "pay")) return bad("provider-bad-shape");
  if (!isProviderId(body.order_id, "order")) return bad("provider-bad-shape");
  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return bad("provider-bad-amount");
  }
  const currency = body.currency;
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    return bad("provider-bad-currency");
  }
  const status = body.status;
  if (typeof status !== "string" || !status) return bad("provider-bad-status");
  if (typeof body.captured !== "boolean") return bad("provider-bad-captured");

  const refunded = body.amount_refunded;
  if (
    typeof refunded !== "number" ||
    !Number.isSafeInteger(refunded) ||
    refunded < 0 ||
    refunded > amount
  ) {
    return bad("provider-bad-refund-amount");
  }
  // REQUIRED, like every other field here. An ABSENT refund_status is not
  // evidence of no refund — it is evidence that the refund state was not read,
  // and defaulting it to null was the one remaining invented value.
  const refundStatusRaw = body.refund_status;
  let refundStatus: "partial" | "full" | null;
  if (refundStatusRaw === null) {
    refundStatus = null;
  } else if (typeof refundStatusRaw === "string" && REFUND_STATUSES.has(refundStatusRaw)) {
    refundStatus = refundStatusRaw as "partial" | "full";
  } else {
    return bad("provider-bad-refund-status");
  }


  return {
    payment: {
      id: body.id,
      order_id: body.order_id,
      amount,
      currency,
      status,
      captured: body.captured,
      amountRefunded: refunded,
      refundStatus,
    },
  };
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
  const refuse = (code: string, retryable = false) => ({
    ok: false as const,
    error: { code, retryable },
  });
  if (payment.id !== expectedPaymentId) return refuse("payment-id-mismatch");
  if (payment.order_id !== binding.providerOrderId) return refuse("order-id-mismatch");
  if (payment.amount !== binding.amountMinor) return refuse("amount-mismatch");
  if (payment.currency.toUpperCase() !== binding.currency.toUpperCase()) {
    return refuse("currency-mismatch");
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    // A payment that is merely `authorized` or `created` may still be captured
    // a moment from now, so this is a "not yet", not a verdict — the caller
    // decides whether that means try again.
    return refuse("not-captured", payment.status === "authorized" || payment.status === "created");
  }
  if (payment.amountRefunded > 0) return refuse("refunded");
  if (payment.refundStatus !== null) return refuse("refunded");
  // A row that already names a DIFFERENT payment is a second payment against
  // one purchase. Refusing keeps the first settlement authoritative.
  if (binding.storedPaymentId && binding.storedPaymentId !== expectedPaymentId) {
    return refuse("payment-id-conflict");
  }
  return { ok: true };
}

/**
 * The provider half of the check, against a binding the caller has ALREADY
 * resolved and used for ownership and the HMAC. One lookup, one binding, one
 * decision — resolving a second time would leave the possibility that the row
 * checked and the row credited were different reads.
 */
export async function confirmAgainstBinding(
  creds: RazorpayCreds,
  binding: PurchaseBinding,
  providerPaymentId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ payment: RazorpayPayment } | { error: ConfirmFailure }> {
  if (!isProviderId(providerPaymentId, "pay")) {
    return { error: { code: "invalid-payment-id", retryable: false } };
  }
  const got = await fetchRazorpayPayment(creds, providerPaymentId, doFetch);
  if ("error" in got) return got;
  const matched = evidenceMatches(got.payment, binding, providerPaymentId);
  if (!matched.ok) return { error: matched.error };
  return { payment: got.payment };
}

// ───────────────────────── the grant ─────────────────────────

/**
 * Call one of the existing service-role RPCs and believe it only if it says
 * so. An HTTP 200 carrying `{"ok":false,"reason":"unknown-order"}` is a
 * refusal, and treating it as success is how a caller reports a grant that
 * never happened.
 *
 * `shape` exists because the catalogue is not uniform: the failure RPC for
 * watermark removal returns void, so its success looks like a 200 with a null
 * or empty body. Demanding `{ok:true}` from it would report every successful
 * failure-marking as broken.
 */
export async function callGrantRpc(
  rest: Rest,
  rpc: string,
  args: Record<string, unknown>,
  doFetch: typeof fetch = fetch,
  shape: RpcShape = "json",
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

  const raw = await res.text().catch(() => null);
  if (raw === null) return { error: { code: "grant-read-failed", retryable: true } };

  if (shape === "void") {
    // Void contract: 2xx with an empty body or a literal null is success.
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "null") return { result: {} };
    // Anything else means the contract we compiled against has changed.
    return { error: { code: "grant-unexpected-body", retryable: true } };
  }

  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    return { error: { code: "grant-bad-json", retryable: true } };
  }
  if (!isPlainRecord(result)) return { error: { code: "grant-bad-result", retryable: true } };
  if (result.ok !== true) return { error: { code: "grant-refused", retryable: false } };
  return { result };
}
