// paymentRecovery — the pure half of "a payment happened and ONIQ did not hear".
//
// WHY THIS EXISTS. `razorpay-webhook` answers a retryable non-2xx whenever a
// handled event was not successfully processed, which is correct and is not
// enough: it hands the whole durability problem to Razorpay's retry window.
// Once that window closes, a captured payment nobody granted is simply gone.
// So events are PERSISTED after the signature check and before any
// acknowledgement, and a worker finishes them afterwards — for as long as it
// takes, not for as long as the provider is willing to re-send.
//
// WHAT IS STORED IS MINIMAL AND VALIDATED, NEVER THE PAYLOAD. A webhook body
// carries the payer's email, contact, card fingerprint, VPA and our own notes.
// None of that is evidence of anything — every grant is re-derived from OUR
// row plus a fresh server-side read — so none of it is written down. The inbox
// keeps ids, the event name, minor-unit amount, provider status, timestamps
// and a SHA-256 of the exact verified bytes. The digest is what makes a
// redelivery recognisable without retaining the thing it hashes.
//
// EVENT IDS: `x-razorpay-event-id` is the provider's own delivery identity and
// deliveries are explicitly NOT ordered. So dedup is on the event id AND the
// body digest: the same id with a DIFFERENT body is a conflict, not a repeat,
// and an absent id falls back to the digest of the verified body — which is
// safe precisely because the bytes were signed.
//
// NOTHING HERE CALLS A PROVIDER WRITE. The only outbound request this module
// makes is one bounded GET of an order's payments. No charge, no capture, no
// refund, no payout — those verbs do not appear.

import {
  isPlainRecord,
  isProviderId,
  readBoundedStream,
  type ConfirmFailure,
  type PurchaseBinding,
  type RazorpayPayment,
} from "./razorpayConfirm.ts";
import type { RazorpayCreds } from "./razorpay.ts";

// ───────────────────────── event classification ─────────────────────────

/**
 * What kind of thing an event is, from OUR point of view.
 *
 * `paid` and `failed` are the two the webhook already acts on. `refund` and
 * `dispute` are recorded as CASES and never acted on automatically — money
 * going back out is policy, and this repository has no rule that says it may
 * happen without a person. `other` is acknowledged and dropped.
 */
export type EventClass = "paid" | "failed" | "refund" | "dispute" | "other";

const PAID = new Set(["payment.captured", "order.paid"]);
const FAILED = new Set(["payment.failed"]);

/**
 * The real event names, not a wildcard guess.
 *
 * Refunds arrive as `refund.created`, `refund.processed`, `refund.failed`,
 * and also `refund.speed_changed`. Disputes are `payment.dispute.*`, NOT
 * `dispute.*` — a handler keyed on the latter never fires, and the failure is
 * silent because an unmatched event is acknowledged.
 */
export function classifyEvent(name: string): EventClass {
  if (PAID.has(name)) return "paid";
  if (FAILED.has(name)) return "failed";
  if (name.startsWith("refund.")) return "refund";
  if (name.startsWith("payment.dispute.")) return "dispute";
  return "other";
}

/**
 * Case state ordering, so an out-of-order delivery cannot walk a case
 * backwards. Razorpay states plainly that deliveries are unordered, so
 * `refund.created` arriving AFTER `refund.processed` is ordinary, not an
 * error — it must be ignored rather than applied.
 *
 * A rank the map does not know is -1: unknown states never overwrite a known
 * one, and never lose to one either (the caller keeps the case open).
 */
const REFUND_RANK: Record<string, number> = {
  "refund.speed_changed": 0,
  "refund.created": 1,
  "refund.failed": 2,
  "refund.processed": 3,
};

const DISPUTE_RANK: Record<string, number> = {
  "payment.dispute.created": 1,
  "payment.dispute.under_review": 2,
  "payment.dispute.action_required": 3,
  "payment.dispute.contested": 4,
  "payment.dispute.won": 5,
  "payment.dispute.lost": 5,
  "payment.dispute.closed": 6,
};

export function caseRank(eventName: string): number {
  const r = REFUND_RANK[eventName] ?? DISPUTE_RANK[eventName];
  return typeof r === "number" ? r : -1;
}

/**
 * Should `incoming` replace the state a case is already in?
 *
 * Strictly greater, never equal: a duplicate delivery of the same event must
 * be a no-op, and an unknown rank (-1) can never win.
 */
export function advancesCase(currentEvent: string | null, incomingEvent: string): boolean {
  const incoming = caseRank(incomingEvent);
  if (incoming < 0) return false;
  if (!currentEvent) return true;
  return incoming > caseRank(currentEvent);
}

/**
 * A refund or dispute NEVER labels a purchase refunded by itself.
 *
 * `refund.created` is a REQUEST. The outstanding decision — whether ONIQ's
 * existing entitlement policy claws anything back — is a person's, and this
 * repository does not encode one, so the case stays open and says so. There
 * is no automatic clawback here and there must not be one added without the
 * owner writing the policy first.
 */
export const CASE_OPEN_REASON = "policy-decision-outstanding";

// ───────────────────────── minimal facts ─────────────────────────

/** Everything the inbox is willing to remember about one delivery. */
export type EventFacts = {
  eventName: string;
  eventClass: EventClass;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerRefundId: string | null;
  providerDisputeId: string | null;
  amountMinor: number | null;
  providerStatus: string | null;
  providerCreatedAt: string | null;
};

function entityOf(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return {};
  return isPlainRecord(value.entity) ? value.entity : {};
}

function minorOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** A short, bounded, alphanumeric provider status. Never free text. */
function statusOrNull(value: unknown): string | null {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : null;
}

function idOrNull(value: unknown, prefix: string): string | null {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,48}$`).test(value)
    ? value
    : null;
}

/**
 * Seconds since the epoch, inside a range a payment can plausibly carry.
 *
 * `Number.isSafeInteger` is not a bound: 1e15 passes it, and
 * `new Date(1e18).toISOString()` THROWS. Extraction runs before the row is
 * written, so a throw here loses the event entirely — the one outcome this
 * module exists to prevent.
 */
const EPOCH_MIN = 946_684_800; // 2000-01-01
const EPOCH_MAX = 4_102_444_800; // 2100-01-01

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < EPOCH_MIN || value > EPOCH_MAX) return null;
  return new Date(value * 1000).toISOString();
}

/**
 * Pull the handful of identifiers out of a VERIFIED event body.
 *
 * Deliberately total: anything unreadable becomes null rather than throwing,
 * because the row must be written whatever shape the payload took — an event
 * we cannot parse is exactly the one worth keeping. Nothing here reads
 * `notes`, `email`, `contact`, `card`, `vpa` or `bank`.
 *
 * THE EVENT'S OWN ENTITY WINS, and this is not a tidy-up. A `refund.created`
 * body carries BOTH a refund entity and the full payment it came from, so
 * reading `payment.amount` first records a ₹49 refund of a ₹4,900 payment as
 * ₹4,900 — a partial refund written down as a total one, in the row a person
 * later reads to decide policy. The subject of the event is the subject of the
 * facts; the payment entity is only the fallback.
 */
export function extractEventFacts(event: Record<string, unknown>): EventFacts {
  const eventName = typeof event.event === "string" ? event.event.slice(0, 64) : "";
  const eventClass = classifyEvent(eventName);
  const payload = isPlainRecord(event.payload) ? event.payload : {};
  const payment = entityOf(payload.payment);
  const order = entityOf(payload.order);
  const refund = entityOf(payload.refund);
  const dispute = entityOf(payload.dispute);

  const subject =
    eventClass === "refund" ? refund : eventClass === "dispute" ? dispute : payment;

  const providerOrderId =
    (isProviderId(payment.order_id, "order") ? payment.order_id : null) ??
    (isProviderId(order.id, "order") ? order.id : null);

  const providerPaymentId =
    (isProviderId(payment.id, "pay") ? payment.id : null) ??
    (isProviderId(refund.payment_id, "pay") ? refund.payment_id : null) ??
    (isProviderId(dispute.payment_id, "pay") ? dispute.payment_id : null);

  return {
    eventName,
    eventClass,
    providerOrderId,
    providerPaymentId,
    providerRefundId: idOrNull(refund.id, "rfnd"),
    providerDisputeId: idOrNull(dispute.id, "disp"),
    amountMinor: minorOrNull(payment.amount) ?? minorOrNull(subject.amount),
    providerStatus: statusOrNull(subject.status) ?? statusOrNull(payment.status),
    providerCreatedAt: isoOrNull(subject.created_at) ?? isoOrNull(payment.created_at),
  };
}

/** SHA-256 of the exact verified bytes, lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The provider's delivery identity, if the header carried a usable one.
 *
 * THERE IS NO SINGLE DEDUP KEY, and that is the correction. Collapsing "event
 * id, else body digest" into one string fails the case it exists for: the same
 * body delivered once with the header and once without produces two different
 * keys and is processed twice. So both travel to the inbox and BOTH are unique
 * there — the digest catches a redelivery however it was labelled, and the
 * event id catches one identity describing two payloads.
 */
export function providerEventId(header: string | null): string | null {
  return header && /^[A-Za-z0-9_-]{6,80}$/.test(header) ? header : null;
}

// ───────────────────────── retry schedule ─────────────────────────

/**
 * Bounded exponential backoff, in seconds, capped.
 *
 * The cap matters more than the curve: an unbounded backoff is a row that is
 * never looked at again, which is the failure the inbox exists to prevent.
 */
export const MAX_ATTEMPTS = 12;
const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1800, 3600, 7200, 21600, 43200, 86400];

export function backoffSeconds(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKOFF_SECONDS.length - 1));
  return BACKOFF_SECONDS[i]!;
}

export function nextDueAt(attempt: number, now: Date): string {
  return new Date(now.getTime() + backoffSeconds(attempt) * 1000).toISOString();
}

/** Attempts are spent; the row is RETAINED for a person, never deleted. */
export function isExhausted(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}

// ───────────────────────── the order's payments ─────────────────────────

const ORDERS_URL_BASE = "https://api.razorpay.com/v1/orders/";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 128 * 1024;

/**
 * GET one order's payments, for the deliveries that never arrived at all.
 *
 * Same bounding as `fetchRazorpayPayment` and for the same reason: a fixed
 * https origin nothing of ours can redirect, `redirect: "manual"` so a 3xx is
 * a refusal, a deadline, a streamed body cap, and no retry inside the call.
 * It is a READ. There is no POST anywhere in this module.
 */
export async function fetchOrderPayments(
  creds: RazorpayCreds,
  providerOrderId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ items: Record<string, unknown>[] } | { error: ConfirmFailure }> {
  if (!isProviderId(providerOrderId, "order")) {
    return { error: { code: "invalid-order-id", retryable: false } };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(`${ORDERS_URL_BASE}${encodeURIComponent(providerOrderId)}/payments`, {
      method: "GET",
      headers: {
        Authorization: "Basic " + btoa(`${creds.keyId}:${creds.keySecret}`),
        accept: "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
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
    if (!res.ok) return { error: { code: `provider-http-${res.status}`, retryable: true } };
    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return { error: { code: "provider-bad-json", retryable: true } };
    }
    if (!isPlainRecord(body)) return { error: { code: "provider-bad-shape", retryable: true } };
    const items = body.items;
    if (!Array.isArray(items)) return { error: { code: "provider-bad-shape", retryable: true } };
    // NOT `.filter(isPlainRecord)`. Dropping the entries we cannot read turns
    // "the provider sent something unexpected" into "this order has no captured
    // payment", which is retried until it exhausts and then blamed on the
    // provider being slow.
    if (!items.every(isPlainRecord)) {
      return { error: { code: "provider-bad-item", retryable: false } };
    }
    return { items: items as Record<string, unknown>[] };
  } catch {
    return { error: { code: "provider-unreachable", retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which of an order's payments, if any, is the one that settles OUR row.
 *
 * STRICT AND SINGULAR. Captured, `status === "captured"`, unrefunded, and an
 * exact match on order id, amount and currency against our own binding. Two
 * candidates is an ambiguity refusal rather than a first-match win — the same
 * rule `resolveBinding` applies to two rows claiming one order, for the same
 * reason.
 *
 * SKIPPING AND REFUSING ARE DIFFERENT ANSWERS, and only one of them is a skip.
 * A payment belonging to another order, or one that is merely authorized or
 * failed, is ORDINARY and passed over. A payment that IS on our order and does
 * not match it — wrong amount, wrong currency, unreadable fields, already
 * refunded — is a refusal by name: swallowing it reports "no captured payment",
 * which is retryable, so the one case worth a person's attention is the one
 * that looks like the provider being slow.
 */
export function pickCapturedPayment(
  items: readonly Record<string, unknown>[],
  binding: PurchaseBinding,
): { payment: RazorpayPayment } | { error: ConfirmFailure } {
  const hits: RazorpayPayment[] = [];
  for (const item of items) {
    if (!isProviderId(item.order_id, "order")) {
      return { error: { code: "malformed-payment-item", retryable: false } };
    }
    if (item.order_id !== binding.providerOrderId) continue; // another order: ordinary
    if (item.status !== "captured" || item.captured !== true) continue; // not settled: ordinary

    if (!isProviderId(item.id, "pay")) {
      return { error: { code: "malformed-payment-item", retryable: false } };
    }
    if (typeof item.amount !== "number" || !Number.isSafeInteger(item.amount)) {
      return { error: { code: "malformed-payment-amount", retryable: false } };
    }
    if (item.amount !== binding.amountMinor) {
      return { error: { code: "amount-mismatch", retryable: false } };
    }
    if (typeof item.currency !== "string" || item.currency !== binding.currency) {
      return { error: { code: "currency-mismatch", retryable: false } };
    }
    const refunded = item.amount_refunded;
    if (typeof refunded !== "number" || !Number.isSafeInteger(refunded) || refunded < 0) {
      return { error: { code: "malformed-refund-field", retryable: false } };
    }
    const refundStatus = item.refund_status;
    if (refunded > 0 || (refundStatus !== null && refundStatus !== undefined)) {
      // Captured and then given back. Granting on this would hand over the
      // thing and the money; it is a case, not a retry.
      return { error: { code: "payment-refunded", retryable: false } };
    }
    hits.push({
      id: item.id,
      order_id: item.order_id,
      amount: item.amount,
      currency: item.currency,
      status: "captured",
      captured: true,
      amountRefunded: 0,
      refundStatus: null,
    });
  }
  if (hits.length === 0) return { error: { code: "no-captured-payment", retryable: true } };
  if (hits.length > 1) return { error: { code: "ambiguous-captured-payment", retryable: false } };
  return { payment: hits[0]! };
}

/**
 * A FAILED EVENT MAY NEVER DOWNGRADE A CAPTURED PURCHASE.
 *
 * Deliveries are unordered, so a stale `payment.failed` can arrive after the
 * capture that superseded it. These are the states a failure is allowed to
 * touch; anything already settled is left exactly as it is.
 */
const FAILABLE_STATUSES = new Set(["created", "pending", "attempted", "failed", ""]);

export function mayRecordFailure(binding: PurchaseBinding): boolean {
  if (binding.storedPaymentId) return false;
  return FAILABLE_STATUSES.has(binding.status);
}

// ───────────────────────── logging ─────────────────────────

/**
 * Our own code strings only, bounded.
 *
 * Nothing from a provider body or a caught error may be logged: a thrown value
 * can carry a request body, and a webhook body carries a payer's contact
 * details. This is what every log line in the recovery path goes through.
 */
export function redact(code: unknown): string {
  return typeof code === "string" && /^[a-z0-9._:-]{1,64}$/i.test(code) ? code : "unknown";
}
