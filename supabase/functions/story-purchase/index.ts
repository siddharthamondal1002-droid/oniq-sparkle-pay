// story-purchase — start a payment for Story seconds.
//
// SEPARATE FROM razorpay-order ON PURPOSE. That function is documented, tested
// and policy-scoped as physical-goods-only: it reads `orders.total` and its
// comment says so. Teaching it a second product would quietly erase the line
// this project drew between a food order and digital content, and that line is
// the thing a Play reviewer would be looking for. Two functions, one shared
// signature module.
//
// THE CLIENT SENDS A LENGTH, NOT A PRICE. `create_story_purchase` looks the
// price up in `story_price_tiers` under the service role. A request naming an
// amount cannot be expressed here, which is the same guarantee razorpay-order
// gives for meals.
//
// COLLECTED ON THE WEB. The native app does not call this — it opens
// oniqhub.com/pay/story in the system browser and the browser calls it. Nothing
// here enforces that, deliberately: a server-side platform check would be
// trivially spoofable by a header and would give a false sense of a control
// that does not exist. What IS recorded is `origin`, so if payments ever start
// arriving from inside the app it is visible rather than assumed.
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
    const seconds = Number(body?.seconds);
    if (!Number.isInteger(seconds) || seconds <= 0) return json({ error: "bad length" }, 400);
    const origin = body?.origin === "native-handoff" ? "native-handoff" : "web";

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    // The payments kill switch, which is about the RAIL rather than about
    // Stories. Checked as well as story_purchase_config.enabled — pausing
    // Razorpay must pause everything that charges through Razorpay, and a
    // second product that kept going would defeat the switch.
    const cfgRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_config?select=enabled,min_amount_minor,max_amount_minor&limit=1`,
      { headers: svc },
    );
    const cfg = cfgRes.ok ? ((await cfgRes.json())[0] ?? null) : null;
    if (!cfg) return json({ error: "payments are not configured" }, 503);
    if (cfg.enabled !== true) {
      return json({ error: "Payments are paused right now. Try again later." }, 503);
    }

    // CREATE THE ROW FIRST. It is what the webhook will join to, and a Razorpay
    // order created before we have somewhere to record it is a payment we
    // cannot attribute. `create_story_purchase` also applies the Story-specific
    // kill switch and rejects a length that is not a live tier.
    const startRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_story_purchase`, {
      method: "POST",
      headers: {
        ...svc,
        "content-type": "application/json",
        // Runs as the CALLER, so auth.uid() inside the function is this user —
        // the service key is only here to reach the endpoint.
        Authorization: authHeader,
      },
      body: JSON.stringify({ _seconds: seconds, _origin: origin }),
    });
    if (!startRes.ok) {
      const detail = await startRes.text().catch(() => "");
      console.error("story-purchase create", startRes.status, detail.slice(0, 200));
      return json({ error: "Could not start that payment." }, 502);
    }
    const start = (await startRes.json()) as {
      ok?: boolean;
      reason?: string;
      purchaseId?: string;
      seconds?: number;
      label?: string;
      amountMinor?: number;
      currency?: string;
    };
    if (!start?.ok) {
      if (start?.reason === "disabled") {
        return json({ error: "Buying Story time is paused right now." }, 503);
      }
      return json({ error: "That length is not for sale." }, 400);
    }

    const amountMinor = Number(start.amountMinor);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return json({ error: "Could not start that payment." }, 502);
    }
    // The same bounds the food rail uses. A tier outside them is a seeding
    // mistake, and the place to find out is here rather than at the bank.
    if (amountMinor < Number(cfg.min_amount_minor) || amountMinor > Number(cfg.max_amount_minor)) {
      console.error("story-purchase tier outside payment bounds", seconds, amountMinor);
      return json({ error: "That length is not for sale." }, 409);
    }

    const created = await createRazorpayOrder(
      creds,
      amountMinor,
      String(start.currency ?? "INR"),
      String(start.purchaseId),
      // What the webhook routes on. `kind` is the discriminator; the id is a
      // convenience for a human reading the Razorpay dashboard, not something
      // the webhook trusts — it re-reads the row by provider order id.
      { kind: "story_seconds", purchase_id: String(start.purchaseId) },
    );
    if ("error" in created) {
      console.error("story-purchase razorpay", created.error);
      return json({ error: "Could not start that payment." }, 502);
    }

    const attach = await fetch(`${supabaseUrl}/rest/v1/rpc/attach_story_purchase_order`, {
      method: "POST",
      headers: { ...svc, "content-type": "application/json" },
      body: JSON.stringify({
        _purchase_id: start.purchaseId,
        _provider_order_id: created.id,
      }),
    });
    if (!attach.ok) {
      // The Razorpay order exists and we cannot record its id, so no webhook
      // will ever find it. Refusing is the honest outcome: an unrecorded
      // payment is worse than a failed one, and the user has not been charged
      // yet — Checkout has not even opened.
      const detail = await attach.text().catch(() => "");
      console.error("story-purchase attach", attach.status, detail.slice(0, 200), created.id);
      return json({ error: "Could not start that payment." }, 502);
    }

    return json({
      configured: true,
      keyId: creds.keyId,
      providerOrderId: created.id,
      purchaseId: start.purchaseId,
      seconds: start.seconds,
      label: start.label,
      amountMinor,
      currency: start.currency ?? "INR",
    });
  } catch (e) {
    console.error("story-purchase fn error", e);
    return json({ error: "Something went sideways" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
