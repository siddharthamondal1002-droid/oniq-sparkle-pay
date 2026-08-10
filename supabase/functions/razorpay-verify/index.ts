// razorpay-verify — the browser says it paid. Check that against a signature.
//
// THE BROWSER IS THE ONE PARTY WITH A REASON TO LIE, so its word is evidence of
// nothing on its own. Razorpay signs `${order_id}|${payment_id}` with the key
// secret, and only a party holding that secret can produce it. Without this
// check, `POST {orderId, razorpay_payment_id: "anything"}` marks a meal paid.
//
// THIS IS THE CONVENIENT PATH, NOT THE AUTHORITATIVE ONE. It exists so the
// screen can say "paid" while the user is still looking at it. The webhook is
// what makes it true even when the app was closed mid-payment, and both call
// the same idempotent RPC, so whichever arrives first wins and the other is a
// no-op.
import { razorpayCreds, verifyCheckoutSignature } from "../_shared/razorpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

    const body = await req.json().catch(() => ({}));
    const providerOrderId = String(body?.razorpay_order_id ?? "");
    const providerPaymentId = String(body?.razorpay_payment_id ?? "");
    const signature = String(body?.razorpay_signature ?? "");

    const verified = await verifyCheckoutSignature(
      got.creds.keySecret,
      providerOrderId,
      providerPaymentId,
      signature,
    );
    if (!verified.ok) {
      // Loud, because a mismatch is either a bug or an attempt.
      console.error("razorpay-verify rejected", verified.reason, providerOrderId, userId);
      return json({ error: "That payment could not be verified." }, 400);
    }

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    // THE SIGNATURE PROVES A PAYMENT HAPPENED, NOT WHOSE IT WAS. A valid
    // signature from somebody else's payment is still a valid signature, so the
    // attempt must also belong to this caller — otherwise one user could settle
    // another's order and the order would show as paid to the wrong person.
    const payRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?provider_order_id=eq.${encodeURIComponent(providerOrderId)}&select=user_id,order_id,status&limit=1`,
      { headers: svc },
    );
    if (!payRes.ok) return json({ error: "could not read that payment" }, 502);
    const pay = ((await payRes.json())[0] ?? null) as Record<string, unknown> | null;
    if (!pay) return json({ error: "no such payment" }, 404);
    if (pay.user_id !== userId) {
      console.error("razorpay-verify wrong owner", providerOrderId, userId);
      return json({ error: "no such payment" }, 404);
    }

    const marked = await fetch(`${supabaseUrl}/rest/v1/rpc/mark_order_paid`, {
      method: "POST",
      headers: { ...svc, "content-type": "application/json" },
      body: JSON.stringify({
        _provider_order_id: providerOrderId,
        _provider_payment_id: providerPaymentId,
        _confirmed_by: "client",
      }),
    });
    if (!marked.ok) {
      const detail = await marked.text().catch(() => "");
      console.error("razorpay-verify mark", marked.status, detail.slice(0, 200));
      return json({ error: "Payment taken, but recording it failed." }, 502);
    }
    const result = await marked.json();
    return json({ ok: true, ...result });
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
