// razorpay-webhook — Razorpay's own word, which is the one that counts, plus
// the credential-gated door the recovery worker is reached through.
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
// ═══ THE CONTRACT CHANGED: IT IS A DURABLE QUEUE NOW ═══
//
// The previous version answered a retryable non-2xx whenever a handled event
// was not fully processed, which was correct and handed the whole durability
// problem to Razorpay's retry window. Once that window closes, a captured
// payment nobody granted is simply gone.
//
// So a verified event is PERSISTED — ids, name, minor-unit amount, provider
// status, timestamps and a SHA-256 of the exact verified bytes, never the
// payload — and only then acknowledged. The 2xx now means "this is written
// down and cannot be lost", not "this is finished". `payment-recovery` mode
// finishes it afterwards, for as long as it takes.
//
// A NON-2xx IS NOW NARROW AND MEANS ONE THING: the durable write did not
// happen. That is the only situation where Razorpay re-sending helps.
//
// INSTANT CREDIT IS UNCHANGED AND IS NOT THIS PATH'S JOB. `razorpay-verify`
// still grants inline on the customer's callback, which is what the UX
// depends on; this path is the safety net under it.
//
// ═══ TWO DOORS, TWO AUTHENTICATIONS, NEITHER BYPASSES THE OTHER ═══
//
// `?mode=recovery` is the worker, gated by a constant-time comparison against
// the actual server credential — never by decoding a JWT and reading a `role`
// claim, which is a statement a token makes about itself. Every other request
// is the provider's, gated by the raw HMAC. A mode flag cannot skip the
// signature and a signature cannot reach the worker. An unrecognised mode is
// refused outright rather than falling through to either.
import { razorpayCreds, verifyWebhookSignature } from "../_shared/razorpay.ts";
import { isPlainRecord, readBoundedBody } from "../_shared/razorpayConfirm.ts";
import {
  extractEventFacts,
  providerEventId,
  redact,
  sha256Hex,
} from "../_shared/paymentRecovery.ts";
import {
  constantTimeEquals,
  handlePaymentRecovery,
} from "../_shared/paymentRecoveryWorker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-razorpay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The one status for "we did not write this down; please send it again". */
const RETRY = 503;
/** A credential header longer than this is not a credential. */
const MAX_AUTH_HEADER = 512;

Deno.serve(async (req) => {
  // Public and does no work: no credential is read, no table is touched.
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // THE MODE IS READ AS AN EXACT STRING, AND THE ONLY RECOGNISED ONE OPENS THE
  // WORKER. Anything else — a typo, a prefix, an array of values — is refused
  // here rather than falling through, so no unrecognised mode can ever select
  // the worker by accident, and none reaches the provider branch carrying a
  // flag that might be read later.
  let mode: string | null = null;
  try {
    mode = new URL(req.url).searchParams.get("mode");
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (mode !== null && mode !== "recovery") return json({ error: "unknown mode" }, 400);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // FAIL CLOSED AND DO NOT ACKNOWLEDGE. Answering 200 so Razorpay stops
    // retrying turns a misconfiguration into a silently dropped payment.
    if (!supabaseUrl || !serviceKey) {
      console.error("razorpay-webhook not configured");
      return json({ error: "not configured" }, 500);
    }
    const rest = { supabaseUrl, serviceKey };

    if (mode === "recovery") {
      const header = req.headers.get("authorization");
      const presented =
        header && header.length <= MAX_AUTH_HEADER ? bearer(header) : null;
      // No database call, no provider call, no body read before this passes.
      // One answer for absent, wrong, and a forged `service_role` JWT: telling
      // them apart is a free oracle for whoever is guessing.
      if (!presented || !(await constantTimeEquals(presented, serviceKey))) {
        return json({ error: "unauthorized" }, 401);
      }
      return await handlePaymentRecovery(req, rest, corsHeaders);
    }

    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("razorpay-webhook not configured");
      return json({ error: "not configured" }, 500);
    }
    // Read now so a missing key credential is a refusal rather than a surprise
    // for the worker later; nothing on this path calls the provider.
    if ("missing" in razorpayCreds()) {
      console.error("razorpay-webhook missing key credentials");
      return json({ error: "not configured" }, 500);
    }

    // RAW FIRST, AND BOUNDED WHILE STREAMING. Nothing may parse this before the
    // signature is checked, and a chunked body with no content-length must not
    // be buffered whole before its size is looked at.
    const read = await readBoundedBody(req, 512 * 1024);
    if ("error" in read) {
      if (read.error.code === "body-too-large") return json({ error: "body too large" }, 413);
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
      console.error("razorpay-webhook rejected", redact(verified.reason));
      return json({ error: "bad signature" }, 401);
    }

    // From here the bytes are Razorpay's. The digest is over exactly those
    // bytes, which is what makes a redelivery recognisable without keeping the
    // thing it hashes.
    const bodySha = await sha256Hex(raw);
    const eventId = providerEventId(req.headers.get("x-razorpay-event-id"));

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    // A MALFORMED **VERIFIED** BODY IS STILL WRITTEN DOWN. Razorpay signed it,
    // so either their shape moved or ours is wrong, and dropping it with a 400
    // would destroy the only trace. It is recorded by digest with an
    // unactionable class, so a person can find it; the payload itself is never
    // stored.
    const facts = isPlainRecord(parsed)
      ? extractEventFacts(parsed)
      : {
          eventName: "unparsable",
          eventClass: "other" as const,
          providerOrderId: null,
          providerPaymentId: null,
          providerRefundId: null,
          providerDisputeId: null,
          amountMinor: null,
          providerStatus: null,
          providerCreatedAt: null,
        };

    const recorded = await recordEvent(rest, eventId, bodySha, facts);
    if ("error" in recorded) {
      // THE ONLY NON-2xx LEFT ON A VERIFIED EVENT. Acknowledging an event we
      // failed to write down is exactly the loss this inbox exists to prevent.
      console.error("razorpay-webhook inbox", redact(recorded.error));
      return json({ error: "could not record the event" }, RETRY);
    }

    const outcome = recorded.outcome;
    // The inbox asks for a resend when a colliding row turns out to belong to
    // a transaction that rolled back — there is genuinely nothing recorded.
    if (outcome === "retry") return json({ error: "not recorded" }, RETRY);

    // `duplicate` and `conflict` are both durable answers, so both are
    // acknowledged: a redelivery is already in the inbox, and one event id
    // carrying two payloads has been quarantined with an alert raised. Neither
    // is improved by Razorpay sending it again.
    return json({ ok: true, queued: outcome, event: facts.eventName }, 200);
  } catch {
    // The caught value is deliberately not logged: it can carry fragments of a
    // body that, at this point, may not even have been verified.
    console.error("razorpay-webhook fn error");
    return json({ error: "Something went sideways" }, 500);
  }
});

type Facts = ReturnType<typeof extractEventFacts>;

/**
 * The durable write, and the only thing standing between a 2xx and a lost
 * payment. Its own bounded call: a hung PostgREST must not hold the provider's
 * connection open past their timeout, because their timeout is a retry and a
 * retry is what we want when this fails.
 */
async function recordEvent(
  rest: { supabaseUrl: string; serviceKey: string },
  eventId: string | null,
  bodySha: string,
  facts: Facts,
): Promise<{ outcome: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${rest.supabaseUrl}/rest/v1/rpc/payment_inbox_record`, {
      method: "POST",
      headers: {
        apikey: rest.serviceKey,
        Authorization: `Bearer ${rest.serviceKey}`,
        "content-type": "application/json",
      },
      redirect: "manual",
      signal: controller.signal,
      body: JSON.stringify({
        p_provider_event_id: eventId,
        p_body_sha256: bodySha,
        p_event_name: facts.eventName,
        p_event_class: facts.eventClass,
        p_provider_order_id: facts.providerOrderId,
        p_provider_payment_id: facts.providerPaymentId,
        p_provider_refund_id: facts.providerRefundId,
        p_provider_dispute_id: facts.providerDisputeId,
        p_amount_minor: facts.amountMinor,
        p_provider_status: facts.providerStatus,
        p_provider_created_at: facts.providerCreatedAt,
      }),
    });
    if (!res.ok) return { error: `inbox-http-${res.status}` };
    const text = await res.text().catch(() => null);
    if (text === null) return { error: "inbox-read-failed" };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { error: "inbox-bad-json" };
    }
    if (!isPlainRecord(value) || typeof value.outcome !== "string") {
      return { error: "inbox-bad-result" };
    }
    return { outcome: value.outcome };
  } catch {
    return { error: "inbox-unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function bearer(header: string): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
