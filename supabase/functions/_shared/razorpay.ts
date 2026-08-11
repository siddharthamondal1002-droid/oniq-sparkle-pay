// Razorpay: credentials, signatures, and the one call that creates an order.
//
// THE THREE SECRETS ARE THREE DIFFERENT THINGS and mixing them up is the
// commonest way this integration goes wrong:
//
//   RAZORPAY_KEY_ID        Public. Ships to the browser — Checkout needs it.
//                          Leaking it costs nothing; it names the merchant.
//   RAZORPAY_KEY_SECRET    Server only. Signs the Orders API call AND verifies
//                          the signature the browser brings back. Anyone with
//                          it can charge your customers.
//   RAZORPAY_WEBHOOK_SECRET  Server only, and SEPARATE from the key secret.
//                          Razorpay signs webhook bodies with this. Verifying a
//                          webhook against the key secret silently never
//                          matches, which reads as "webhooks are broken".
//
// SIGNATURES ARE COMPARED IN CONSTANT TIME. A byte-by-byte early return leaks
// how much of a forged signature was right, which is enough to construct one a
// byte at a time. Same reasoning as _shared/jobToken.ts.

/** What a signature check found. Never a bare boolean — the reason gets logged. */
export type VerifyResult = { ok: true } | { ok: false; reason: string };

export type RazorpayCreds = {
  keyId: string;
  keySecret: string;
};

/**
 * The credentials, or a list of exactly what is missing.
 *
 * Named individually because "Razorpay is not configured" sends someone to
 * check three secrets, and two of them are probably fine.
 */
export function razorpayCreds(): { creds: RazorpayCreds } | { missing: string[] } {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  const missing = [!keyId && "RAZORPAY_KEY_ID", !keySecret && "RAZORPAY_KEY_SECRET"].filter(
    Boolean,
  ) as string[];
  if (missing.length > 0) return { missing };
  return { creds: { keyId: keyId!, keySecret: keySecret! } };
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

/** Constant-time compare of two hex strings. */
function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The signature Checkout hands back after a successful payment.
 *
 * Razorpay signs `${razorpay_order_id}|${razorpay_payment_id}` with the KEY
 * SECRET. Without this check the browser's word is the only evidence a payment
 * happened, and the browser is the one party with a reason to lie.
 */
export async function verifyCheckoutSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<VerifyResult> {
  if (!orderId || !paymentId || !signature) return { ok: false, reason: "missing fields" };
  const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`);
  return sameSignature(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

/**
 * The signature on a webhook.
 *
 * OVER THE RAW BODY, byte for byte. Parsing the JSON and re-serialising it
 * changes key order and whitespace, and the digest then never matches — which
 * looks like a wrong secret and is not. The caller must pass the exact text it
 * received.
 */
export async function verifyWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string | null,
): Promise<VerifyResult> {
  if (!signature) return { ok: false, reason: "no x-razorpay-signature header" };
  const expected = await hmacHex(webhookSecret, rawBody);
  return sameSignature(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}

/**
 * Create an order with Razorpay and return its id.
 *
 * `amountMinor` is paise, an integer, and the caller reads it off the database
 * rather than the request. `receipt` is our own order id, which is what makes a
 * Razorpay dashboard row traceable back to a meal.
 *
 * `notes` RIDE BACK ON THE WEBHOOK, which is the only reason they exist here.
 * ONIQ now sells two unrelated things through one Razorpay account — food
 * orders and Story seconds — and a webhook carries nothing of ours except the
 * provider order id and these. Without a `kind` note the webhook has to guess
 * which table to look in, and guessing wrong means crediting the wrong ledger.
 * They are NOT trusted as an amount or an owner: both of those are re-read from
 * our own tables by provider order id.
 */
export async function createRazorpayOrder(
  creds: RazorpayCreds,
  amountMinor: number,
  currency: string,
  receipt: string,
  notes?: Record<string, string>,
): Promise<{ id: string } | { error: string }> {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { error: `amount must be a positive integer in minor units, got ${amountMinor}` };
  }
  const auth = btoa(`${creds.keyId}:${creds.keySecret}`);
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: amountMinor,
      currency,
      receipt,
      // Razorpay only captures automatically when told to. Left off, a payment
      // sits authorised and never settles, which looks like success on the
      // phone and like nothing in the bank.
      payment_capture: 1,
      ...(notes ? { notes } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { error: `razorpay orders ${res.status}: ${text.slice(0, 200)}` };
  }
  try {
    const body = JSON.parse(text) as { id?: string };
    if (!body.id) return { error: "razorpay returned no order id" };
    return { id: body.id };
  } catch {
    return { error: `razorpay returned non-JSON: ${text.slice(0, 120)}` };
  }
}

/**
 * Send ONE payout through RazorpayX's composite payout API — money OUT, to a
 * recipient's UPI ID, in one call (contact + fund account created inline).
 *
 * A fourth secret joins the three above: RAZORPAYX_ACCOUNT_NUMBER, the
 * X-account the money leaves from. Payouts authenticate with the same
 * key id/secret pair as the gateway.
 *
 * `queue_if_low_balance` is deliberate: a payout run bigger than the X
 * balance QUEUES at Razorpay rather than half-failing, which matches how the
 * payout_queue itself behaves on our side.
 */
export async function createRazorpayPayout(
  creds: RazorpayCreds,
  accountNumber: string,
  p: {
    amountPaise: number;
    vpa: string;
    recipientName: string;
    referenceId: string;
  },
): Promise<{ id: string; status: string } | { error: string }> {
  try {
    const res = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${creds.keyId}:${creds.keySecret}`),
        "content-type": "application/json",
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
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: { description?: string };
    };
    if (!res.ok || !body.id) {
      return { error: body.error?.description ?? `payout http ${res.status}` };
    }
    return { id: body.id, status: body.status ?? "queued" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "payout call failed" };
  }
}
