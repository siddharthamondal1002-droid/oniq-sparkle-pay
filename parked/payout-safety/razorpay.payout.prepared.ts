// P1 PREPARED — drop-in replacement for createRazorpayPayout in
// supabase/functions/_shared/razorpay.ts. NOT wired into the live function yet;
// promotion is owner-gated (see README). Deno/edge context.
//
// TWO CHANGES versus the live version, both about not paying twice:
//
//   1. X-Payout-Idempotency header, keyed on the queue row id. RazorpayX's
//      documented idempotency mechanism: a second POST carrying the same key
//      returns the ORIGINAL payout (same id, same status) instead of creating
//      a new one. The queue row id is stable across every retry of one logical
//      payout, so it is the correct key. reference_id stays too (dashboard
//      traceability) but is NOT relied on for idempotency — RazorpayX does not
//      enforce reference_id uniqueness by default.
//
//   2. A richer return so the caller can classify the outcome instead of
//      collapsing every non-success into a single `{ error }`. A transport
//      failure (response lost) is reported distinctly from an HTTP rejection,
//      because only the caller — via classifyPayout — can decide that a lost
//      response must be treated as UNKNOWN (left processing) rather than failed.

import type { RazorpayCreds } from "./razorpay.ts";

/** What a single payout POST resolved to, before classification. */
export type PayoutObservation =
  | { kind: "ok"; providerId: string; status: string }
  | { kind: "http"; status: number; providerError?: string }
  | { kind: "transport"; message: string };

export async function createRazorpayPayout(
  creds: RazorpayCreds,
  accountNumber: string,
  p: {
    amountPaise: number;
    vpa: string;
    recipientName: string;
    // The queue row id. Doubles as the idempotency key AND the reference_id.
    referenceId: string;
  },
): Promise<PayoutObservation> {
  try {
    const res = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${creds.keyId}:${creds.keySecret}`),
        "content-type": "application/json",
        // THE IDEMPOTENCY GUARANTEE. Same key → same payout, never a second one.
        "X-Payout-Idempotency": p.referenceId,
      },
      body: JSON.stringify({
        account_number: accountNumber,
        amount: p.amountPaise,
        currency: "INR",
        mode: "UPI",
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: p.referenceId.slice(0, 40),
        narration: "ONIQ Creator Program",
        fund_account: {
          account_type: "vpa",
          vpa: { address: p.vpa },
          contact: {
            name: p.recipientName.slice(0, 50) || "ONIQ user",
            type: "vendor",
          },
        },
      }),
    });

    let body: { id?: string; status?: string; error?: { description?: string } } = {};
    try {
      body = await res.json();
    } catch {
      // A response with an unreadable body on a non-2xx is still an HTTP signal;
      // on a 2xx without a parseable id we fall through to "no id" below.
    }

    if (res.ok && body.id) {
      return { kind: "ok", providerId: body.id, status: body.status ?? "queued" };
    }
    return {
      kind: "http",
      status: res.status,
      providerError: body.error?.description ?? `payout http ${res.status}`,
    };
  } catch (e) {
    // fetch threw: DNS, connection reset, or the request was sent but the
    // response never arrived. We do NOT know whether a payout was created.
    return { kind: "transport", message: e instanceof Error ? e.message : "payout call failed" };
  }
}
