/**
 * P1 payout safety — how a RazorpayX payout attempt's outcome is classified.
 *
 * This is the decision that makes a retry safe. The dispatcher for the Creator
 * Program (Track A: run_creator_payouts → payout_queue → claim_payout_batch →
 * createRazorpayPayout) must, for every attempt, choose EXACTLY ONE of three
 * transitions for the claimed ('processing') queue row:
 *
 *   PAID       the provider confirmed a payout id. Terminal success.
 *   FAILED     the provider DEFINITIVELY rejected it (a 4xx that is the
 *              recipient's fault, e.g. an invalid VPA). Terminal, and it is
 *              safe never to retry because no payout was created.
 *   UNKNOWN    we do not know whether money moved: a network error, a timeout,
 *              a 5xx, a 429, or an idempotency-conflict. The row is LEFT in
 *              'processing' — never marked failed — so the reaper requeues it
 *              and the dispatcher re-POSTs with the SAME idempotency key. If a
 *              payout was in fact created, RazorpayX returns that same payout
 *              (idempotent replay) instead of a second one; if it was not, one
 *              is created. Either way the recipient is paid exactly once.
 *
 * The cardinal error the old code made was marking a lost response 'failed'
 * (via a swallowed `.catch(() => {})`), which both hid the failure and — for a
 * payout that had actually succeeded — stranded real money as "failed" while
 * leaving the row eligible for a fresh queue entry next run. Classifying the
 * unknown case as its own thing, and NEVER as failed, is the whole fix on the
 * application side; the idempotency key is the whole fix on the provider side.
 *
 * Pure and provider-shaped so it can be unit-tested without a network: the
 * dispatcher passes what it observed (an HTTP status, or a thrown transport
 * error) and gets back the transition to apply.
 */

export type PayoutOutcome = "paid" | "failed" | "unknown";

/** What the dispatcher observed from a single createRazorpayPayout call. */
export type PayoutObservation =
  | { kind: "ok"; providerId: string } // 2xx with a payout id (incl. idempotent replay)
  | { kind: "http"; status: number; providerError?: string } // a response with a non-2xx status
  | { kind: "transport"; message: string }; // fetch threw / timed out / connection lost — response, if any, is lost

export type PayoutDecision = {
  outcome: PayoutOutcome;
  /** True when the row must be LEFT 'processing' for the reaper (unknown only). */
  leaveProcessing: boolean;
  /** Human-readable reason, recorded on the row for observability. */
  reason: string;
};

/**
 * Razorpay/RazorpayX conflict + rate-limit codes that mean "try again, the
 * request may or may not have taken effect" rather than "this will never work".
 * 409 in particular is what an idempotency replay-in-progress can surface as,
 * and it must NEVER be treated as a definitive failure.
 */
const RETRIABLE_HTTP = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function classifyPayout(obs: PayoutObservation): PayoutDecision {
  if (obs.kind === "ok") {
    return { outcome: "paid", leaveProcessing: false, reason: `provider payout ${obs.providerId}` };
  }

  if (obs.kind === "transport") {
    // The response was lost. We cannot know if the payout was created, so we
    // must not mark it failed and we must not blindly resend without the
    // idempotency key. Leave it processing; the reaper + idempotent re-POST
    // resolve it safely.
    return {
      outcome: "unknown",
      leaveProcessing: true,
      reason: `transport error, result unknown: ${obs.message}`.slice(0, 280),
    };
  }

  // obs.kind === "http"
  if (obs.status >= 200 && obs.status < 300) {
    // A 2xx that somehow carried no id is not a confirmed payout — treat as
    // unknown rather than paid. We never claim success without an id.
    return {
      outcome: "unknown",
      leaveProcessing: true,
      reason: "provider returned 2xx without a payout id",
    };
  }
  if (RETRIABLE_HTTP.has(obs.status)) {
    return {
      outcome: "unknown",
      leaveProcessing: true,
      reason: `retriable provider status ${obs.status}: ${obs.providerError ?? ""}`.slice(0, 280),
    };
  }
  // Any other non-2xx (a 4xx that is not in the retriable set) is a definitive
  // rejection: the provider refused and created nothing. Safe to fail and not
  // retry — e.g. an invalid VPA. A fresh, corrected queue row can be made later.
  return {
    outcome: "failed",
    leaveProcessing: false,
    reason: `provider rejected ${obs.status}: ${obs.providerError ?? ""}`.slice(0, 280),
  };
}
