// razorpay-webhook — Razorpay's own word, which is the one that counts.
//
// WHY THIS EXISTS WHEN razorpay-verify ALREADY DOES THE JOB. It doesn't, quite.
// A user pays and their train goes into a tunnel; the app is killed before the
// callback fires; the browser crashes. The money left their account and ONIQ
// never heard. This is the path that does not depend on the customer's device
// still being alive.
//
// A DIFFERENT SECRET FROM THE KEY SECRET. Webhook bodies are signed with
// RAZORPAY_WEBHOOK_SECRET, set when the webhook is registered in the dashboard.
// Verifying against the key secret never matches, and the failure reads as
// "webhooks are broken" rather than "wrong secret", which is a long afternoon.
//
// SIGNED OVER THE RAW BODY, byte for byte, BEFORE ANYTHING PARSES IT. Parsing
// and re-serialising changes key order and whitespace and the digest stops
// matching — and an unverified body has no business reaching a JSON parser.
//
// NO USER JWT. Razorpay cannot present one, so the signature IS the
// authentication.
//
// THE NOTES NO LONGER ROUTE ANYTHING. `notes.kind` is a string we wrote on the
// order and the event echoes back; using it to pick which ledger to credit
// meant the routing decision was outside our database. The product, the owner
// and the price are now read from OUR row by provider order id, and the grant
// only happens after Razorpay's own record of the payment agrees on amount,
// currency and capture. An event is a prompt to go and check, never evidence.
import { razorpayCreds, verifyWebhookSignature } from "../_shared/razorpay.ts";
import {
  callGrantRpc,
  confirmPayment,
  isProviderId,
  readBoundedBody,
  resolveBinding,
} from "../_shared/razorpayConfirm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-razorpay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Only the events that change our mind about an order. */
const PAID_EVENTS = new Set(["payment.captured", "order.paid"]);
const FAILED_EVENTS = new Set(["payment.failed"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    // FAIL CLOSED AND DO NOT ACKNOWLEDGE. This used to answer 200 so Razorpay
    // would stop retrying — which turns a misconfiguration into a silently
    // dropped payment. A 5xx keeps the event alive until someone fixes it.
    if (!supabaseUrl || !serviceKey || !webhookSecret) {
      console.error("razorpay-webhook not configured");
      return json({ error: "not configured" }, 500);
    }
    const got = razorpayCreds();
    if ("missing" in got) {
      console.error("razorpay-webhook missing key credentials");
      return json({ error: "not configured" }, 500);
    }

    // RAW FIRST, AND BOUNDED. Nothing may parse this before the signature is
    // checked, and nothing unbounded may be read into memory at all.
    const raw = await readBoundedBody(req, 512 * 1024);
    if (raw === null) return json({ error: "body too large" }, 413);
    const verified = await verifyWebhookSignature(
      webhookSecret,
      raw,
      req.headers.get("x-razorpay-signature"),
    );
    if (!verified.ok) {
      console.error("razorpay-webhook rejected", verified.reason);
      return json({ error: "bad signature" }, 401);
    }

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return json({ error: "bad json" }, 400);
    }

    const name = typeof event.event === "string" ? event.event : "";
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const paymentEntity = ((payload.payment as Record<string, unknown>)?.entity ?? {}) as Record<
      string,
      unknown
    >;
    const orderEntity = ((payload.order as Record<string, unknown>)?.entity ?? {}) as Record<
      string,
      unknown
    >;

    const providerOrderId = isProviderId(paymentEntity.order_id, "order")
      ? paymentEntity.order_id
      : isProviderId(orderEntity.id, "order")
        ? orderEntity.id
        : null;
    const providerPaymentId = isProviderId(paymentEntity.id, "pay") ? paymentEntity.id : null;

    if (!providerOrderId) {
      // Acknowledged: an event we cannot attribute is not an error Razorpay
      // should retry, it is an event we do not care about.
      return json({ ok: true, ignored: "no usable order id on the event", event: name }, 200);
    }

    const rest = { supabaseUrl, serviceKey };

    if (PAID_EVENTS.has(name)) {
      // An `order.paid` with no payment entity cannot be confirmed against a
      // specific payment, so it grants nothing. The matching
      // `payment.captured` is the one that can be, and it always follows.
      if (!providerPaymentId) {
        return json({ ok: false, refused: "no payment id on the event", event: name }, 200);
      }
      const confirmed = await confirmPayment(rest, got.creds, providerOrderId, providerPaymentId);
      if ("error" in confirmed) {
        console.error("razorpay-webhook evidence", confirmed.error.code, providerOrderId);
        // Retryable means we could not establish the facts — keep the event
        // alive. A definitive refusal is acknowledged, because retrying it
        // will produce the same verdict for ever.
        if (confirmed.error.retryable) return json({ error: "could not confirm" }, 500);
        return json({ ok: false, refused: confirmed.error.code }, 200);
      }
      const binding = confirmed.binding;
      const granted = await callGrantRpc(rest, binding.creditRpc, {
        _provider_order_id: binding.providerOrderId,
        _provider_payment_id: providerPaymentId,
        _confirmed_by: "webhook",
      });
      if ("error" in granted) {
        console.error("razorpay-webhook mark", binding.creditRpc, granted.error.code);
        // 500 so Razorpay retries: the RPCs are idempotent, so a retry is safe
        // and a real captured payment must not be lost to a transient failure.
        if (granted.error.retryable) return json({ error: "could not record the payment" }, 500);
        return json({ ok: false, refused: granted.error.code }, 200);
      }
      return json({ ok: true, kind: binding.kind, ...granted.result }, 200);
    }

    if (FAILED_EVENTS.has(name)) {
      // Unchanged business policy — this only records a failure, it grants
      // nothing — but the ledger it records against now comes from our row
      // rather than from a note on the event.
      const bound = await resolveBinding(rest, providerOrderId);
      if ("error" in bound) {
        if (bound.error.retryable) return json({ error: "could not read that order" }, 500);
        return json({ ok: true, ignored: bound.error.code, event: name }, 200);
      }
      const marked = await callGrantRpc(rest, bound.binding.failRpc, {
        _provider_order_id: bound.binding.providerOrderId,
        _error:
          typeof paymentEntity.error_description === "string"
            ? paymentEntity.error_description.slice(0, 300)
            : "payment failed",
      });
      if ("error" in marked && marked.error.retryable) {
        console.error("razorpay-webhook fail-mark", bound.binding.failRpc, marked.error.code);
        return json({ error: "could not record the failure" }, 500);
      }
      return json({ ok: true, recorded: "failed", kind: bound.binding.kind }, 200);
    }

    // Everything else — refunds, settlements, disputes — is acknowledged and
    // not acted on. Silently succeeding on an event we do not handle beats
    // making Razorpay retry it forever.
    return json({ ok: true, ignored: name }, 200);
  } catch (e) {
    console.error("razorpay-webhook fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
