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
// The bounded reader decodes strictly (no replacement characters, BOM kept) so
// the string hashed is the bytes sent.
//
// NO USER JWT. Razorpay cannot present one, so the signature IS the
// authentication.
//
// THE NOTES ROUTE NOTHING. `notes.kind` is a string we wrote on the order and
// the event echoes back; using it to pick which ledger to credit put the
// routing decision outside our database. The product, the owner and the price
// are read from OUR row by provider order id, and the grant only happens after
// Razorpay's own record of the payment agrees. An event is a prompt to go and
// check, never evidence.
//
// ═══ A 2xx IS A PROMISE WE CANNOT KEEP ═══
//
// Razorpay stops retrying once it gets a 2xx, and ONIQ has NO durable event
// inbox and NO quarantine table — so an acknowledged event that was not
// processed is simply gone, and with it a paid purchase nobody will ever
// grant. The previous version acknowledged a long list of situations that all
// look final and are not: a provider 401/403/404 (a rotated key, the wrong
// account), a redirect (a gateway in front of the API), a payment not captured
// *yet*, an order id our database has not caught up with, an ambiguous or
// missing binding, a missing payment id, and a semantic refusal from a grant
// RPC that may itself have been racing another writer.
//
// SO THE RULE IS NARROW AND ABSOLUTE: if the event is one this function
// HANDLES, it gets a 2xx only when it was successfully processed. Everything
// else is a retryable non-2xx and grants nothing. Events we do not handle at
// all — refunds, settlements, disputes — are still acknowledged, because there
// is nothing for a retry to achieve.
import { razorpayCreds, verifyWebhookSignature } from "../_shared/razorpay.ts";
import {
  callGrantRpc,
  confirmAgainstBinding,
  isPlainRecord,
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

/** The one status for "we did not finish; please send this again". */
const RETRY = 503;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    // FAIL CLOSED AND DO NOT ACKNOWLEDGE. Answering 200 so Razorpay stops
    // retrying turns a misconfiguration into a silently dropped payment.
    if (!supabaseUrl || !serviceKey || !webhookSecret) {
      console.error("razorpay-webhook not configured");
      return json({ error: "not configured" }, 500);
    }
    const got = razorpayCreds();
    if ("missing" in got) {
      console.error("razorpay-webhook missing key credentials");
      return json({ error: "not configured" }, 500);
    }

    // RAW FIRST, AND BOUNDED WHILE STREAMING. Nothing may parse this before the
    // signature is checked, and a chunked body with no content-length must not
    // be buffered whole before its size is looked at.
    const read = await readBoundedBody(req, 512 * 1024);
    if ("error" in read) {
      const code = read.error.code;
      if (code === "body-too-large") return json({ error: "body too large" }, 413);
      // A stalled or unreadable stream is not the event's fault: keep it alive.
      return json({ error: "could not read the body" }, RETRY);
    }
    const raw = read.text;
    const verified = await verifyWebhookSignature(
      webhookSecret,
      raw,
      req.headers.get("x-razorpay-signature"),
    );
    if (!verified.ok) {
      // Our own reason code only. An unverified body is attacker-controlled.
      console.error("razorpay-webhook rejected", verified.reason);
      return json({ error: "bad signature" }, 401);
    }

    let parsedEvent: unknown;
    try {
      parsedEvent = JSON.parse(raw);
    } catch {
      return json({ error: "bad json" }, 400);
    }
    if (!isPlainRecord(parsedEvent)) return json({ error: "bad json" }, 400);
    const event = parsedEvent;

    const name = typeof event.event === "string" ? event.event : "";
    const handled = PAID_EVENTS.has(name) || FAILED_EVENTS.has(name);
    // Not ours to act on — refunds, settlements, disputes. Acknowledged,
    // because no amount of retrying changes what this function would do.
    if (!handled) return json({ ok: true, ignored: name }, 200);

    const payload = isPlainRecord(event.payload) ? event.payload : {};
    const paymentEntity = entityOf(payload.payment);
    const orderEntity = entityOf(payload.order);

    const providerOrderId = isProviderId(paymentEntity.order_id, "order")
      ? paymentEntity.order_id
      : isProviderId(orderEntity.id, "order")
        ? orderEntity.id
        : null;
    const providerPaymentId = isProviderId(paymentEntity.id, "pay") ? paymentEntity.id : null;

    if (!providerOrderId) {
      // A HANDLED event we cannot attribute is not a shrug. Either the payload
      // shape moved or we are reading it wrong, and either way a real payment
      // may be behind it — so it stays queued rather than disappearing.
      console.error("razorpay-webhook no order id", name);
      return json({ error: "no usable order id on the event", event: name }, RETRY);
    }

    const rest = { supabaseUrl, serviceKey };

    // ONE binding, used for the provider check and for routing the RPC.
    const bound = await resolveBinding(rest, providerOrderId);
    if ("error" in bound) {
      // Even "unknown-order" is retryable HERE, unlike in the callback: the
      // webhook races our own insert, so an order id we have not written yet
      // is an eventual-consistency gap, not a verdict.
      console.error("razorpay-webhook binding", bound.error.code, name);
      return json({ error: "could not resolve that order", reason: bound.error.code }, RETRY);
    }
    const binding = bound.binding;

    if (PAID_EVENTS.has(name)) {
      // An `order.paid` with no payment entity cannot be confirmed against a
      // specific payment. Razorpay normally also sends `payment.captured` for
      // the same order, but that is not guaranteed to arrive, or to arrive
      // first, so this is held for retry rather than written off.
      if (!providerPaymentId) {
        console.error("razorpay-webhook no payment id", name);
        return json({ error: "no payment id on the event", event: name }, RETRY);
      }
      const confirmed = await confirmAgainstBinding(got.creds, binding, providerPaymentId);
      if ("error" in confirmed) {
        console.error("razorpay-webhook evidence", confirmed.error.code);
        // No acknowledgement either way. A provider 401/403/404, a redirect, a
        // not-yet-captured payment and a mismatch all look alike from here,
        // and only the first three are even about this payment.
        return json({ error: "could not confirm", reason: confirmed.error.code }, RETRY);
      }
      const granted = await callGrantRpc(rest, binding.creditRpc, {
        _provider_order_id: binding.providerOrderId,
        _provider_payment_id: providerPaymentId,
        _confirmed_by: "webhook",
      });
      if ("error" in granted) {
        console.error("razorpay-webhook mark", binding.creditRpc, granted.error.code);
        // Includes `grant-refused` — a 200 carrying ok:false. The RPCs are
        // idempotent, so a retry is safe, and a semantic refusal can be a race
        // with the callback rather than a settled answer.
        return json({ error: "could not record the payment", reason: granted.error.code }, RETRY);
      }
      return json({ ok: true, kind: binding.kind, ...granted.result }, 200);
    }

    // payment.failed. This grants nothing — it only records the failure — but
    // it is still a handled event, so it is acknowledged only when the RPC
    // actually succeeded.
    const marked = await callGrantRpc(
      rest,
      binding.failRpc,
      {
        _provider_order_id: binding.providerOrderId,
        _error:
          typeof paymentEntity.error_description === "string"
            ? paymentEntity.error_description.slice(0, 300)
            : "payment failed",
      },
      fetch,
      // NOT EVERY FAILURE RPC ANSWERS THE SAME WAY. `fail_watermark_purchase`
      // is declared `returns void`, so success is a 200 with an empty body;
      // the other four return `{ok:true}`. The spec carries which.
      binding.failShape,
    );
    if ("error" in marked) {
      console.error("razorpay-webhook fail-mark", binding.failRpc, marked.error.code);
      return json({ error: "could not record the failure", reason: marked.error.code }, RETRY);
    }
    return json({ ok: true, recorded: "failed", kind: binding.kind }, 200);
  } catch {
    // The caught value is deliberately not logged: it can carry fragments of a
    // body that, at this point, may not even have been verified.
    console.error("razorpay-webhook fn error");
    return json({ error: "Something went sideways" }, 500);
  }
});

/** `payload.<thing>.entity`, defensively — any non-record is an empty record. */
function entityOf(node: unknown): Record<string, unknown> {
  if (!isPlainRecord(node)) return {};
  return isPlainRecord(node.entity) ? node.entity : {};
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
