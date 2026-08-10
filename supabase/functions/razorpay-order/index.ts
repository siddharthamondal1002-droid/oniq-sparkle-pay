// razorpay-order — start a payment for an order that already exists.
//
// THE CLIENT SENDS AN ORDER ID AND NOTHING ELSE. No amount, no currency, no
// item list. The amount is read from `orders.total`, which `place_order`
// computed from `menu_items` prices the browser never supplied. A checkout that
// accepted an amount would be one request away from paying a rupee for a
// hundred-rupee meal, and this one cannot express that request.
//
// GUARD ORDER, the same one the rest of this project uses: authenticate, kill
// switch, ownership, state, bounds — and only then the call that creates a real
// payment at a real provider.
import { createRazorpayOrder, razorpayCreds } from "../_shared/razorpay.ts";

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
    const creds = got.creds;

    // Who is asking — re-derived by the auth server, not decoded here.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: anon },
    });
    if (!who.ok) return json({ error: "Unauthorized" }, 401);
    const userId = ((await who.json()) as { id?: string })?.id;
    if (!userId) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = String(body?.orderId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "bad order id" }, 400);

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    // Kill switch before anything billable, as always.
    const cfgRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_config?select=enabled,currency,min_amount_minor,max_amount_minor&limit=1`,
      { headers: svc },
    );
    const cfg = cfgRes.ok ? ((await cfgRes.json())[0] ?? null) : null;
    if (!cfg) return json({ error: "payments are not configured" }, 503);
    if (cfg.enabled !== true) {
      return json({ error: "Payments are paused right now. Try again later." }, 503);
    }

    const ordRes = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${orderId}&select=id,user_id,total,payment_status`,
      { headers: svc },
    );
    if (!ordRes.ok) return json({ error: "could not read that order" }, 502);
    const rows = (await ordRes.json()) as Record<string, unknown>[];
    const order = Array.isArray(rows) ? rows[0] : null;
    // 404 rather than 403 for somebody else's order: a different answer would
    // confirm the id exists.
    if (!order || order.user_id !== userId) return json({ error: "no such order" }, 404);
    if (order.payment_status === "paid") return json({ error: "that order is already paid" }, 409);

    // Paise, from the database, via an integer. `total` is NUMERIC(10,2) and
    // arrives as a string over PostgREST — Math.round on the parsed value is
    // what keeps 249.90 from becoming 24989.999999999996.
    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) return json({ error: "that order has no total" }, 409);
    const amountMinor = Math.round(total * 100);
    if (amountMinor < Number(cfg.min_amount_minor)) {
      return json({ error: "that order is below the minimum payable amount" }, 409);
    }
    if (amountMinor > Number(cfg.max_amount_minor)) {
      // The one line that stops a single order becoming a large one.
      console.error("razorpay-order over cap", orderId, amountMinor);
      return json({ error: "that order is above the payment limit" }, 409);
    }

    // REUSE AN EXISTING ATTEMPT rather than creating a second one. A user who
    // taps Pay, backgrounds the app and comes back should land on the same
    // Razorpay order — two open orders for one meal is how a double charge
    // starts.
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?order_id=eq.${orderId}&status=eq.created&select=provider_order_id,amount_minor,currency&limit=1`,
      { headers: svc },
    );
    const existing = existingRes.ok ? ((await existingRes.json())[0] ?? null) : null;
    if (existing && Number(existing.amount_minor) === amountMinor) {
      return json({
        configured: true,
        keyId: creds.keyId,
        providerOrderId: existing.provider_order_id,
        amountMinor,
        currency: existing.currency,
        orderId,
      });
    }

    const created = await createRazorpayOrder(creds, amountMinor, String(cfg.currency), orderId);
    if ("error" in created) {
      console.error("razorpay-order create", created.error);
      return json({ error: "Could not start that payment." }, 502);
    }

    const ins = await fetch(`${supabaseUrl}/rest/v1/payments`, {
      method: "POST",
      headers: { ...svc, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        order_id: orderId,
        provider_order_id: created.id,
        amount_minor: amountMinor,
        currency: cfg.currency,
        status: "created",
      }),
    });
    if (!ins.ok) {
      // The Razorpay order exists and we failed to record it. Refuse rather
      // than hand the browser an id nothing will ever reconcile — an
      // unrecorded payment is worse than a failed one.
      const detail = await ins.text().catch(() => "");
      console.error("razorpay-order insert", ins.status, detail.slice(0, 200), created.id);
      return json({ error: "Could not start that payment." }, 502);
    }

    return json({
      configured: true,
      keyId: creds.keyId,
      providerOrderId: created.id,
      amountMinor,
      currency: cfg.currency,
      orderId,
    });
  } catch (e) {
    console.error("razorpay-order fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
