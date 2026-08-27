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

    // WHICH PRODUCT WAS THIS. Two ledgers hang off one Razorpay account: food
    // orders in `payments`, Story seconds in `story_purchases`. The provider
    // order id appears in exactly one of them.
    //
    // NOTE WHAT IS *NOT* USED HERE — the client does not get to say which. The
    // webhook has to read a `kind` note because an event carries nothing else
    // of ours, but this path can simply look, and looking cannot be spoofed. A
    // caller who claimed "story" for a food order's payment would still be
    // found in `payments` and settled as a meal.
    const findIn = async (table: string, select: string) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/${table}?provider_order_id=eq.${encodeURIComponent(providerOrderId)}&select=${select}&limit=1`,
        { headers: svc },
      );
      if (!res.ok) return { failed: true as const };
      return { row: ((await res.json())[0] ?? null) as Record<string, unknown> | null };
    };

    const foodHit = await findIn("payments", "user_id,order_id,status");
    if ("failed" in foodHit) return json({ error: "could not read that payment" }, 502);
    let row = foodHit.row;
    let isStory = false;
    let isWatermark = false;
    let isPlan = false;
    if (!row) {
      const storyHit = await findIn("story_purchases", "user_id,seconds,status");
      if ("failed" in storyHit) return json({ error: "could not read that payment" }, 502);
      row = storyHit.row;
      isStory = !!row;
    }
    if (!row) {
      const wmHit = await findIn("watermark_purchases", "user_id,job_id,status");
      if ("failed" in wmHit) return json({ error: "could not read that payment" }, 502);
      row = wmHit.row;
      isWatermark = !!row;
    }
    if (!row) {
      // Monthly plans. The order of these lookups is only a search for which
      // table holds this provider order id — the ids are unique across all
      // of them.
      const planHit = await findIn("plan_purchases", "user_id,plan_key,status");
      if ("failed" in planHit) return json({ error: "could not read that payment" }, 502);
      row = planHit.row;
      isPlan = !!row;
    }
    let isVideo = false;
    if (!row) {
      // Finished video time (PAYG minutes, 2026-08-27) — the newest product.
      const videoHit = await findIn("video_purchases", "user_id,seconds,status");
      if ("failed" in videoHit) return json({ error: "could not read that payment" }, 502);
      row = videoHit.row;
      isVideo = !!row;
    }

    // THE SIGNATURE PROVES A PAYMENT HAPPENED, NOT WHOSE IT WAS. A valid
    // signature from somebody else's payment is still a valid signature, so the
    // attempt must also belong to this caller — otherwise one user could settle
    // another's order, or credit another account's Story seconds.
    if (!row) return json({ error: "no such payment" }, 404);
    if (row.user_id !== userId) {
      console.error("razorpay-verify wrong owner", providerOrderId, userId);
      return json({ error: "no such payment" }, 404);
    }

    const rpc = isStory
      ? "credit_story_purchase"
      : isWatermark
        ? "settle_watermark_purchase"
        : isPlan
          ? "credit_plan_purchase"
          : isVideo
            ? "credit_video_purchase"
            : "mark_order_paid";
    const marked = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
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
      console.error("razorpay-verify mark", rpc, marked.status, detail.slice(0, 200));
      return json({ error: "Payment taken, but recording it failed." }, 502);
    }
    const result = await marked.json();
    return json({
      ok: true,
      kind: isStory
        ? "story_seconds"
        : isWatermark
          ? "watermark_removal"
          : isPlan
            ? "plan_month"
            : isVideo
              ? "video_seconds"
              : "order",
      ...result,
    });
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
