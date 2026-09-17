// razorpayCaseRead — what the provider says about a refund or a dispute RIGHT
// NOW, read server-side, because the event stream cannot answer it.
//
// WHY A READ AND NOT THE EVENT. `refund.created` already carries
// `status: "processed"` in Razorpay's own documented sample, and a dispute
// moves `open -> under_review -> action_required -> under_review -> ...` and
// can cycle. So a linear rank over event NAMES orders deliveries; it is not a
// statement about the current state. The rank decides whether a delivery is
// stale; this module decides what is true.
//
// GET ONLY. `/v1/refunds/:id` and `/v1/disputes/:id` are documented reads. No
// POST, no capture, no refund, no clawback appears anywhere in this file — a
// case is written down for a person, never acted on.
//
// THE CASE AMOUNT IS THE CASE'S, NEVER THE PAYMENT'S. Both documents embed the
// payment they belong to. A ₹49 refund of a ₹4,900 payment must be recorded as
// ₹49: substituting the payment's amount turns a partial refund into a total
// one in the row somebody reads to decide policy.

import {
  isPlainRecord,
  isProviderId,
  readBoundedStream,
  type ConfirmFailure,
  type PurchaseBinding,
} from "./razorpayConfirm.ts";
import type { RazorpayCreds } from "./razorpay.ts";

const API = "https://api.razorpay.com/v1/";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 64 * 1024;

/** Refund and dispute ids, bounded before they reach a URL path segment. */
export function isCaseId(value: unknown, prefix: "rfnd" | "disp"): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]{6,48}$`).test(value);
}

/**
 * One bounded GET against the pinned origin.
 *
 * Same shape as `fetchRazorpayPayment`: a fixed https base nothing of ours can
 * redirect, `redirect: "manual"` so a 3xx refuses rather than hops, a
 * deadline, a streamed body cap, and no retry inside the call.
 */
async function providerGet(
  creds: RazorpayCreds,
  path: string,
  doFetch: typeof fetch,
): Promise<{ body: Record<string, unknown> } | { error: ConfirmFailure }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(`${API}${path}`, {
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
    return { body };
  } catch {
    return { error: { code: "provider-unreachable", retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The minimal, validated truth about one case.
 *
 * `terminal` is about the PROVIDER's state, not about the event name that
 * prompted the read — a dispute that is `under_review` today may be
 * `action_required` tomorrow and back again, and only won/lost/closed settle.
 */
export type CaseFacts = {
  kind: "refund" | "dispute";
  caseId: string;
  paymentId: string;
  /** Minor units of THIS case, which may be a fraction of the payment. */
  amountMinor: number;
  currency: string;
  status: string;
  terminal: boolean;
  /** When the provider says the case was created, if it is readable. */
  observedCreatedAt: string | null;
};

const REFUND_STATUSES = new Set(["pending", "processed", "failed"]);
/** Documented dispute states. `contested` is NOT one of them. */
const DISPUTE_STATUSES = new Set([
  "open",
  "under_review",
  "action_required",
  "won",
  "lost",
  "closed",
]);
const REFUND_TERMINAL = new Set(["processed", "failed"]);
const DISPUTE_TERMINAL = new Set(["won", "lost", "closed"]);

const EPOCH_MIN = 946_684_800;
const EPOCH_MAX = 4_102_444_800;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < EPOCH_MIN || value > EPOCH_MAX) return null;
  return new Date(value * 1000).toISOString();
}

function parseCase(
  kind: "refund" | "dispute",
  body: Record<string, unknown>,
): { facts: CaseFacts } | { error: ConfirmFailure } {
  const bad = (code: string, retryable = false) => ({ error: { code, retryable } });
  if (body.entity !== kind) return bad("provider-bad-entity");

  const prefix = kind === "refund" ? "rfnd" : "disp";
  if (!isCaseId(body.id, prefix)) return bad("provider-bad-shape");
  if (!isProviderId(body.payment_id, "pay")) return bad("provider-bad-shape");

  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return bad("provider-bad-amount");
  }
  const currency = body.currency;
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    return bad("provider-bad-currency");
  }
  const status = body.status;
  const allowed = kind === "refund" ? REFUND_STATUSES : DISPUTE_STATUSES;
  // An UNDOCUMENTED status is not silently kept: it would be written into the
  // case row as though it were understood, and a person reading it would have
  // no way to tell a real state from a typo in a payload.
  if (typeof status !== "string" || !allowed.has(status)) return bad("provider-bad-status");

  const terminal = (kind === "refund" ? REFUND_TERMINAL : DISPUTE_TERMINAL).has(status);
  return {
    facts: {
      kind,
      caseId: body.id,
      paymentId: body.payment_id,
      amountMinor: amount,
      currency,
      status,
      terminal,
      observedCreatedAt: isoOrNull(body.created_at),
    },
  };
}

export function fetchRefundCase(
  creds: RazorpayCreds,
  refundId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ facts: CaseFacts } | { error: ConfirmFailure }> {
  return readCase("refund", creds, refundId, doFetch);
}

export function fetchDisputeCase(
  creds: RazorpayCreds,
  disputeId: string,
  doFetch: typeof fetch = fetch,
): Promise<{ facts: CaseFacts } | { error: ConfirmFailure }> {
  return readCase("dispute", creds, disputeId, doFetch);
}

async function readCase(
  kind: "refund" | "dispute",
  creds: RazorpayCreds,
  id: string,
  doFetch: typeof fetch,
): Promise<{ facts: CaseFacts } | { error: ConfirmFailure }> {
  const prefix = kind === "refund" ? "rfnd" : "disp";
  if (!isCaseId(id, prefix)) return { error: { code: `invalid-${kind}-id`, retryable: false } };
  const segment = kind === "refund" ? "refunds" : "disputes";
  const got = await providerGet(creds, `${segment}/${encodeURIComponent(id)}`, doFetch);
  if ("error" in got) return got;
  return parseCase(kind, got.body);
}

/**
 * Is this case actually ABOUT the purchase we think it is?
 *
 * A case that names another payment, or claims more than the purchase cost, or
 * is denominated in a different currency, is not evidence about this row — and
 * recording it against this row would attribute somebody else's refund to this
 * person. None of these refusals write anything; the delivery stays visible.
 */
export function caseMatchesBinding(
  facts: CaseFacts,
  binding: PurchaseBinding,
  eventPaymentId: string | null,
): { ok: true } | { ok: false; error: ConfirmFailure } {
  const refuse = (code: string) => ({ ok: false as const, error: { code, retryable: false } });
  if (eventPaymentId && facts.paymentId !== eventPaymentId) return refuse("case-payment-mismatch");
  if (binding.storedPaymentId && binding.storedPaymentId !== facts.paymentId) {
    return refuse("case-payment-mismatch");
  }
  if (facts.currency.toUpperCase() !== binding.currency.toUpperCase()) {
    return refuse("case-currency-mismatch");
  }
  // Equal is ordinary (a full refund); more than the purchase is not.
  if (facts.amountMinor > binding.amountMinor) return refuse("case-amount-exceeds-payment");
  return { ok: true };
}

/**
 * Material adverse news, for the reopen rule.
 *
 * A resolved case that a person closed must reopen when the provider's own
 * state turns against us — a refund that actually went through, a dispute we
 * lost. Everything else leaves a closed case closed.
 */
export function isMaterialAdverse(facts: CaseFacts): boolean {
  if (facts.kind === "refund") return facts.status === "processed";
  return facts.status === "lost";
}
