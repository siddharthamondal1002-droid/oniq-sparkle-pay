// razorpay-verify — the browser says it paid. Check that against the provider.
//
// THE BROWSER IS THE ONE PARTY WITH A REASON TO LIE, so its word is evidence of
// nothing on its own. It used to be checked against a signature and nothing
// else, and a signature is a weaker claim than it looks: it proves some party
// holding the key secret paired an order id with a payment id. It does not say
// the money moved. An `authorized` payment — held, never captured — carries a
// perfectly valid signature, and so does a payment for a different amount.
//
// SO THE ORDER OF OPERATIONS IS NOW:
//
//   1. Validate the shapes of both ids before they touch a hash or a URL.
//   2. Find OUR row by provider order id — that is what says which product this
//      is, who owns it, and what it costs. The caller never names any of those.
//   3. Ownership: the signed-in caller must be the owner of that row.
//   4. HMAC over the SERVER-STORED order id and the caller's payment id.
//   5. Ask Razorpay about that one payment and require it to agree on id,
//      order, amount, currency, and to be captured.
//   6. Only then the existing idempotent, service-role grant RPC — whose own
//      `ok` is checked, because an HTTP 200 can carry a refusal.
//
// THIS IS STILL THE CONVENIENT PATH, NOT THE AUTHORITATIVE ONE. It exists so
// the screen can say "paid" while the user is looking at it; the webhook makes
// it true when the app was closed. Both call the same idempotent RPC, so
// whichever arrives first wins and the other is a no-op.
import { razorpayCreds, verifyCheckoutSignature } from "../_shared/razorpay.ts";
import {
  callGrantRpc,
  confirmPayment,
  isProviderId,
  readBoundedBody,
  resolveBinding,
} from "../_shared/razorpayConfirm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anon) return json({ configured: false }, 200);

    const got = razorpayCreds();
    if ("missing" in got) return json({ configured: false, missing: got.missing }, 200);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: anon },
    });
    if (!who.ok) return json({ error: "Unauthorized" }, 401);
    const userId = ((await who.json()) as { id?: string })?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const rawBody = await readBoundedBody(req, 16 * 1024);
    if (rawBody === null) return json({ error: "body too large" }, 413);
    let body: Record<string, unknown> = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      return json({ error: "bad json" }, 400);
    }

    // STRICT SHAPES, NO COERCION. `String(x)` turns an object into
    // "[object Object]" and an array into its join — both of which used to
    // reach a hash and a query string.
    const providerOrderId = body.razorpay_order_id;
    const providerPaymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    if (
      !isProviderId(providerOrderId, "order") ||
      !isProviderId(providerPaymentId, "pay") ||
      typeof signature !== "string" ||
      !/^[a-f0-9]{40,128}$/i.test(signature)
    ) {
      return json({ error: "That payment could not be verified." }, 400);
    }

    const rest = { supabaseUrl, serviceKey };

    // OUR ROW DECIDES THE PRODUCT. Note what is NOT used: the caller does not
    // get to say which ledger to credit, and the notes on the Razorpay side are
    // never read here at all.
    const bound = await resolveBinding(rest, providerOrderId);
    if ("error" in bound) {
      console.error("razorpay-verify binding", bound.error.code, providerOrderId);
      if (bound.error.retryable) return json({ error: "could not read that payment" }, 502);
      return json({ error: "no such payment" }, 404);
    }
    const binding = bound.binding;

    // A VALID SIGNATURE FROM SOMEONE ELSE'S PAYMENT IS STILL A VALID SIGNATURE,
    // so the purchase must also belong to this caller. "Not yours" and "not
    // there" answer identically so the endpoint cannot be used to probe ids.
    if (binding.userId !== userId) {
      console.error("razorpay-verify wrong owner", providerOrderId, userId);
      return json({ error: "no such payment" }, 404);
    }

    // Signed over OUR stored order id, never the string the caller sent.
    const verified = await verifyCheckoutSignature(
      got.creds.keySecret,
      binding.providerOrderId,
      providerPaymentId,
      signature,
    );
    if (!verified.ok) {
      // Loud, because a mismatch is either a bug or an attempt.
      console.error("razorpay-verify rejected", verified.reason, providerOrderId, userId);
      return json({ error: "That payment could not be verified." }, 400);
    }

    // THE PROVIDER'S OWN RECORD. Nothing is granted until Razorpay itself says
    // this exact payment was captured for this order at this amount.
    const confirmed = await confirmPayment(
      rest,
      got.creds,
      binding.providerOrderId,
      providerPaymentId,
    );
    if ("error" in confirmed) {
      console.error("razorpay-verify evidence", confirmed.error.code, providerOrderId);
      if (confirmed.error.retryable) return json({ error: "could not verify that payment" }, 502);
      return json({ error: "That payment could not be verified." }, 400);
    }

    const granted = await callGrantRpc(rest, binding.creditRpc, {
      _provider_order_id: binding.providerOrderId,
      _provider_payment_id: providerPaymentId,
      _confirmed_by: "client",
    });
    if ("error" in granted) {
      console.error("razorpay-verify mark", binding.creditRpc, granted.error.code);
      return json({ error: "Payment taken, but recording it failed." }, 502);
    }

    return json({ ok: true, kind: binding.kind, ...granted.result });
  } catch (e) {
    console.error("razorpay-verify fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
