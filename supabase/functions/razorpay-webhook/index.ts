// razorpay-webhook — Razorpay's own word, which is the one that counts.
//
// WHY THIS EXISTS WHEN razorpay-verify ALREADY DOES THE JOB. It doesn't, quite.
// A user pays and their train goes into a tunnel; the app is killed before the
// callback fires; the browser crashes. The money left their account and ONIQ
// never heard. This is the path that does not depend on the customer's device
// still being alive, and it is why a payment integration that only has the
// client callback is incomplete rather than merely simpler.
//
// A DIFFERENT SECRET FROM THE KEY SECRET. Webhook bodies are signed with
// RAZORPAY_WEBHOOK_SECRET, set when the webhook is registered in the dashboard.
// Verifying against the key secret never matches, and the failure reads as
// "webhooks are broken" rather than "wrong secret", which is a long afternoon.
//
// SIGNED OVER THE RAW BODY, byte for byte. Parsing the JSON and re-serialising
// changes key order and whitespace and the digest stops matching, so the text
// is read once and verified before anything looks inside it.
//
// NO USER JWT. Razorpay cannot present one, so this is verify_jwt = false and
// the signature IS the authentication. That is the whole security of this
// endpoint: no signature, no action, and the body is never trusted before the
// check passes.
import { verifyWebhookSignature } from "../_shared/razorpay.ts";

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
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!supabaseUrl || !serviceKey) return json({ configured: false }, 200);
    if (!webhookSecret) {
      // 200, deliberately. A 5xx makes Razorpay retry for hours against an
      // endpoint that cannot succeed; this says "heard you, not configured"
      // and is visible in the logs instead.
      console.error("razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not set");
      return json({ configured: false, missing: ["RAZORPAY_WEBHOOK_SECRET"] }, 200);
    }

    // RAW FIRST. Nothing may parse this before the signature is checked.
    const raw = await req.text();
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
      event = JSON.parse(raw);
    } catch {
      return json({ error: "bad json" }, 400);
    }

    const name = String(event.event ?? "");
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const paymentEntity = ((payload.payment as Record<string, unknown>)?.entity ?? {}) as Record<
      string,
      unknown
    >;
    const orderEntity = ((payload.order as Record<string, unknown>)?.entity ?? {}) as Record<
      string,
      unknown
    >;

    const providerOrderId = String(paymentEntity.order_id ?? orderEntity.id ?? "");
    const providerPaymentId = String(paymentEntity.id ?? "");
    if (!providerOrderId) {
      // Acknowledged: an event we cannot attribute is not an error Razorpay
      // should retry, it is an event we do not care about.
      return json({ ok: true, ignored: "no order id on the event", event: name }, 200);
    }

    // WHICH PRODUCT WAS THIS. ONIQ sells two unrelated things through one
    // Razorpay account: food orders, which settle against `orders`, and Story
    // seconds, which credit an allowance. The `kind` note is set when the order
    // is created and is the only thing on the event that distinguishes them.
    //
    // The note decides WHICH LEDGER TO LOOK IN and nothing else. It does not
    // decide the amount, the owner, or how many seconds to credit — all of
    // those are re-read from our own row, found by provider order id. A forged
    // note cannot mint anything, because the only path it can reach is a
    // lookup that will not find a matching purchase.
    const notes = {
      ...((orderEntity.notes as Record<string, unknown>) ?? {}),
      ...((paymentEntity.notes as Record<string, unknown>) ?? {}),
    };
    const kindNote = String(notes.kind ?? "");
    const isStory = kindNote === "story_seconds";
    const isSub = kindNote === "channel_sub";

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    if (PAID_EVENTS.has(name)) {
      const rpc = isSub
        ? "credit_channel_subscription"
        : isStory
          ? "credit_story_purchase"
          : "mark_order_paid";
      const marked = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _provider_order_id: providerOrderId,
          _provider_payment_id: providerPaymentId || null,
          _confirmed_by: "webhook",
        }),
      });
      if (!marked.ok) {
        const detail = await marked.text().catch(() => "");
        console.error("razorpay-webhook mark", rpc, marked.status, detail.slice(0, 200));
        // 500 HERE IS CORRECT, unlike above: this is a transient failure on our
        // side against a real payment, and Razorpay's retry is exactly what we
        // want. Both RPCs are idempotent, so a retry is safe.
        return json({ error: "could not record the payment" }, 500);
      }
      return json(
        {
          ok: true,
          kind: isSub ? "channel_sub" : isStory ? "story_seconds" : "order",
          ...(await marked.json()),
        },
        200,
      );
    }

    if (FAILED_EVENTS.has(name)) {
      const rpc = isSub
        ? "fail_channel_subscription"
        : isStory
          ? "fail_story_purchase"
          : "mark_payment_failed";
      await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _provider_order_id: providerOrderId,
          _error: String(paymentEntity.error_description ?? "payment failed"),
        }),
      }).catch((e) => console.error("razorpay-webhook fail-mark", rpc, e));
      return json({ ok: true, recorded: "failed" }, 200);
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
