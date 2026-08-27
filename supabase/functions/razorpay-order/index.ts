// razorpay-order — start a payment. Two products, one function.
//
// WHAT THE CLIENT MAY SEND, and it is exactly one of these:
//
//   { orderId }   a food order that already exists. The amount comes from
//                 `orders.total`, which `place_order` computed from
//                 `menu_items` prices the browser never supplied.
//   { seconds }   a length of Story time. The amount comes from
//                 `story_price_tiers` via `create_story_purchase`.
//
// NEITHER FORM CAN NAME A PRICE. No amount, no currency, no item list. A
// checkout that accepted an amount would be one request away from paying a
// rupee for a hundred-rupee meal, and this one cannot express that request for
// either product.
//
// WHY TWO PRODUCTS SHARE ONE FUNCTION, because it was not the first choice and
// a future reader deserves the real reason. Story purchases were written as a
// separate `story-purchase` function, to keep the food rail's physical-goods
// scope visibly untouched. Lovable's platform refuses to CREATE new Supabase
// edge functions in a TanStack project — existing ones stay editable — so that
// function could not be deployed at all. Merging was the deployable option, and
// the boundary it cost was one of internal clarity rather than of policy: no
// reviewer reads edge-function source, and the Play question is about WHERE the
// money is collected, not about which function collects it.
//
// SO THE POLICY LINE MOVED, and here is where it actually lives now. Story time
// is digital content consumed in the app, and Play requires Play Billing for
// that. ONIQ's answer is that the app never takes the payment: the native build
// opens oniqhub.com/pay/story in the system browser and the BROWSER calls this.
// That is enforced client-side in `checkoutTarget()` and switchable server-side
// via `story_purchase_config.native_link_out`. Nothing in this file enforces
// it, deliberately — a platform check here would be a header away from being
// spoofed and would imply a control that does not exist. What this file does is
// RECORD it, as `story_purchases.origin`, so a payment arriving from inside the
// app is visible rather than assumed.
//
// GUARD ORDER, the same one the rest of this project uses: authenticate, kill
// switch, ownership, state, bounds — and only then the call that creates a real
// payment at a real provider.
import { createRazorpayOrder, createRazorpayPayout, razorpayCreds } from "../_shared/razorpay.ts";

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

    // -----------------------------------------------------------------------
    // CREATOR PROGRAM PAYOUT RUN — money OUT, not in. It lives on this
    // function because the platform cannot ADD edge functions to this project
    // (see the header), and payouts are a Razorpay operation. ADMIN ONLY:
    // this moves real money from the RazorpayX account.
    //
    // One request does the whole directive — computes the run (creator and
    // subscriber legs queued in the same transaction) and immediately
    // dispatches the queue through RazorpayX composite payouts to each
    // recipient's registered UPI ID. Recipients without a UPI ID on file are
    // marked no_method and wait, visible to them, until they add one.
    // -----------------------------------------------------------------------
    if (body?.runPayouts === true) {
      const svcHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
      const adminRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=is_admin&limit=1`,
        { headers: svcHeaders },
      );
      const adminRow = adminRes.ok ? ((await adminRes.json())[0] ?? null) : null;
      if (adminRow?.is_admin !== true) return json({ error: "admins only" }, 403);

      const runRes = await fetch(`${supabaseUrl}/rest/v1/rpc/run_creator_payouts`, {
        method: "POST",
        headers: { ...svcHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          _pool_paise: Number.isInteger(body?.poolPaise) ? body.poolPaise : null,
        }),
      });
      if (!runRes.ok) {
        const detail = await runRes.text().catch(() => "");
        console.error("payout run rpc", runRes.status, detail.slice(0, 200));
        return json({ error: "could not compute the payout run" }, 502);
      }
      const run = (await runRes.json()) as Record<string, unknown>;

      // Dispatch — even when THIS run queued nothing, older queued rows are
      // drained, so a recipient who added their UPI ID late still gets paid.
      const accountNumber = Deno.env.get("RAZORPAYX_ACCOUNT_NUMBER");
      if (!accountNumber) {
        return json({
          ok: true,
          run,
          dispatched: 0,
          note: "RAZORPAYX_ACCOUNT_NUMBER is not set — payouts are queued, not sent.",
        });
      }

      let dispatched = 0;
      let failed = 0;
      let noMethod = 0;
      // Bounded batches so one request stays inside the function's time box.
      for (let round = 0; round < 5; round++) {
        const batchRes = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_payout_batch`, {
          method: "POST",
          headers: { ...svcHeaders, "content-type": "application/json" },
          body: JSON.stringify({ _limit: 20 }),
        });
        if (!batchRes.ok) break;
        const batch = (await batchRes.json()) as {
          id: string;
          recipientId: string;
          amountPaise: number;
          kind: string;
          vpa: string | null;
        }[];
        if (!Array.isArray(batch) || batch.length === 0) break;

        for (const item of batch) {
          const mark = async (status: string, providerId?: string, error?: string) => {
            await fetch(`${supabaseUrl}/rest/v1/rpc/mark_payout_result`, {
              method: "POST",
              headers: { ...svcHeaders, "content-type": "application/json" },
              body: JSON.stringify({
                _id: item.id,
                _status: status,
                _provider_payout_id: providerId ?? null,
                _error: error ?? null,
              }),
            }).catch(() => {});
          };
          if (!item.vpa) {
            noMethod++;
            await mark("no_method", undefined, "no UPI ID on file");
            continue;
          }
          const paid = await createRazorpayPayout(creds, accountNumber, {
            amountPaise: item.amountPaise,
            vpa: item.vpa,
            recipientName: item.kind === "creator" ? "ONIQ creator" : "ONIQ subscriber",
            referenceId: item.id,
          });
          if ("error" in paid) {
            failed++;
            await mark("failed", undefined, paid.error);
          } else {
            dispatched++;
            await mark("paid", paid.id);
          }
        }
        if (batch.length < 20) break;
      }

      return json({ ok: true, run, dispatched, failed, noMethod });
    }
    const wantsOrder = body?.orderId !== undefined && body?.orderId !== null;
    const wantsStory = body?.seconds !== undefined && body?.seconds !== null;
    const wantsWatermark = body?.watermarkJobId !== undefined && body?.watermarkJobId !== null;
    const wantsPlan = body?.planKey !== undefined && body?.planKey !== null;
    const wantsVideo = body?.videoMinutes !== undefined && body?.videoMinutes !== null;

    // EXACTLY ONE PRODUCT PER REQUEST. Several together, or none, is refused
    // rather than resolved by precedence — a request that names a food order
    // AND a Story length is a client bug, and picking one of them silently is
    // how the wrong thing gets charged for.
    if (
      [wantsOrder, wantsStory, wantsWatermark, wantsPlan, wantsVideo].filter(Boolean).length !== 1
    ) {
      return json(
        { error: "name exactly one of orderId, seconds, watermarkJobId, planKey, or videoMinutes" },
        400,
      );
    }

    const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    // Kill switch before anything billable, as always. It governs the RAIL, so
    // it stops both products — a second product that kept charging while
    // Razorpay was paused would defeat the switch.
    const cfgRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_config?select=enabled,currency,min_amount_minor,max_amount_minor&limit=1`,
      { headers: svc },
    );
    const cfg = cfgRes.ok ? ((await cfgRes.json())[0] ?? null) : null;
    if (!cfg) return json({ error: "payments are not configured" }, 503);
    if (cfg.enabled !== true) {
      return json({ error: "Payments are paused right now. Try again later." }, 503);
    }

    // -----------------------------------------------------------------------
    // STORY TIME. Digital content, sold on the web only. Unchanged in every
    // respect that matters from the story-purchase function this replaced.
    // -----------------------------------------------------------------------
    if (wantsStory) {
      const seconds = Number(body.seconds);
      if (!Number.isInteger(seconds) || seconds <= 0) return json({ error: "bad length" }, 400);
      const origin = body?.origin === "native-handoff" ? "native-handoff" : "web";

      // CREATE THE ROW FIRST. It is what the webhook will join to, and a
      // Razorpay order created before we have somewhere to record it is a
      // payment we cannot attribute. `create_story_purchase` also applies the
      // Story-specific kill switch and rejects a length that is not a tier.
      const startRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_story_purchase`, {
        method: "POST",
        headers: {
          ...svc,
          "content-type": "application/json",
          // Runs as the CALLER, so auth.uid() inside the function is this user
          // — the service key is only here to reach the endpoint.
          Authorization: authHeader,
        },
        body: JSON.stringify({ _seconds: seconds, _origin: origin }),
      });
      if (!startRes.ok) {
        const detail = await startRes.text().catch(() => "");
        console.error("razorpay-order story create", startRes.status, detail.slice(0, 200));
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
      if (
        amountMinor < Number(cfg.min_amount_minor) ||
        amountMinor > Number(cfg.max_amount_minor)
      ) {
        console.error("razorpay-order story tier outside bounds", seconds, amountMinor);
        return json({ error: "That length is not for sale." }, 409);
      }

      const createdStory = await createRazorpayOrder(
        creds,
        amountMinor,
        String(start.currency ?? "INR"),
        String(start.purchaseId),
        // What the webhook routes on. `kind` is the discriminator; the id is a
        // convenience for a human reading the Razorpay dashboard, not something
        // the webhook trusts — it re-reads the row by provider order id.
        { kind: "story_seconds", purchase_id: String(start.purchaseId) },
      );
      if ("error" in createdStory) {
        console.error("razorpay-order story razorpay", createdStory.error);
        return json({ error: "Could not start that payment." }, 502);
      }

      const attach = await fetch(`${supabaseUrl}/rest/v1/rpc/attach_story_purchase_order`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _purchase_id: start.purchaseId,
          _provider_order_id: createdStory.id,
        }),
      });
      if (!attach.ok) {
        // The Razorpay order exists and we cannot record its id, so no webhook
        // will ever find it. Refusing is the honest outcome: an unrecorded
        // payment is worse than a failed one, and the user has not been charged
        // yet — Checkout has not even opened.
        const detail = await attach.text().catch(() => "");
        console.error("razorpay-order story attach", attach.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }

      return json({
        configured: true,
        kind: "story_seconds",
        keyId: creds.keyId,
        providerOrderId: createdStory.id,
        purchaseId: start.purchaseId,
        seconds: start.seconds,
        label: start.label,
        amountMinor,
        currency: start.currency ?? "INR",
      });
    }

    // -----------------------------------------------------------------------
    // A MONTHLY PLAN. Same discipline as Story seconds, and for the same
    // reasons: the row exists before the Razorpay order so a payment can
    // always be attributed, the PRICE COMES OFF subscription_plans rather
    // than off the request, and settlement happens by provider order id.
    //
    // The one thing this branch must never do is grant the plan. It creates
    // an intent to buy; `credit_plan_purchase` — reachable only by the
    // service role, from verify and from the webhook — is what calls
    // grant_subscription once money has actually moved.
    // -----------------------------------------------------------------------
    if (wantsPlan) {
      const planKey = String(body.planKey ?? "");
      // Keys are ours, so a strict shape is free. Anything else never reaches
      // the database.
      if (!/^[a-z0-9_]{2,32}$/.test(planKey)) return json({ error: "bad plan" }, 400);
      const origin = body?.origin === "native-handoff" ? "native-handoff" : "web";

      const startRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_plan_purchase`, {
        method: "POST",
        headers: {
          ...svc,
          "content-type": "application/json",
          // The caller's identity, not the service role's — the RPC reads
          // auth.uid() to decide whose purchase this is.
          Authorization: authHeader,
        },
        body: JSON.stringify({ _plan_key: planKey, _origin: origin }),
      });
      if (!startRes.ok) {
        const detail = await startRes.text().catch(() => "");
        console.error("razorpay-order plan create", startRes.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }
      const start = (await startRes.json()) as {
        ok?: boolean;
        reason?: string;
        purchaseId?: string;
        planKey?: string;
        label?: string;
        amountMinor?: number;
        currency?: string;
      };
      if (!start?.ok || !start.purchaseId) {
        // The RPC's own refusals, passed through by name so the client can say
        // something true rather than "something went wrong".
        const reason = start?.reason ?? "unavailable";
        const message =
          reason === "disabled"
            ? "Plans are not on sale right now."
            : reason === "no-such-plan" || reason === "not-subscribable"
              ? "That plan is not available."
              : "Could not start that payment.";
        return json({ error: message, reason }, 409);
      }

      const amountMinor = Number(start.amountMinor ?? 0);
      // The rail's own bounds, checked again here. The price came from a table
      // rather than the request, but a table can be edited too.
      if (
        !Number.isFinite(amountMinor) ||
        amountMinor <= 0 ||
        amountMinor < Number(cfg.min_amount_minor) ||
        amountMinor > Number(cfg.max_amount_minor)
      ) {
        console.error("razorpay-order plan outside bounds", planKey, amountMinor);
        return json({ error: "That plan is not for sale." }, 409);
      }

      const createdPlan = await createRazorpayOrder(
        creds,
        amountMinor,
        String(start.currency ?? "INR"),
        String(start.purchaseId),
        { kind: "plan_month", purchase_id: String(start.purchaseId) },
      );
      if ("error" in createdPlan) {
        console.error("razorpay-order plan razorpay", createdPlan.error);
        return json({ error: "Could not start that payment." }, 502);
      }

      const attach = await fetch(`${supabaseUrl}/rest/v1/rpc/attach_plan_purchase_order`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _purchase_id: start.purchaseId,
          _provider_order_id: createdPlan.id,
        }),
      });
      if (!attach.ok) {
        // A Razorpay order whose id we cannot record is a payment no webhook
        // will ever find. Refusing is honest: nothing has been charged yet,
        // because Checkout has not opened.
        const detail = await attach.text().catch(() => "");
        console.error("razorpay-order plan attach", attach.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }

      return json({
        configured: true,
        kind: "plan_month",
        keyId: creds.keyId,
        providerOrderId: createdPlan.id,
        purchaseId: start.purchaseId,
        planKey: start.planKey,
        label: start.label,
        amountMinor,
        currency: start.currency ?? "INR",
      });
    }

    // -----------------------------------------------------------------------
    // FINISHED VIDEO TIME — PAYG minutes for the in-house video product
    // (owner directive 2026-08-27). Same discipline as every product on this
    // rail: the row exists before the Razorpay order, the price is the
    // server's rate off video_sale_config times the minutes, and
    // credit_video_purchase — service role only, idempotent — moves the
    // balance once money has actually moved. The client names MINUTES from a
    // fixed tier list; it can never name a price.
    // -----------------------------------------------------------------------
    if (wantsVideo) {
      const minutes = Number(body.videoMinutes);
      if (!Number.isInteger(minutes) || minutes <= 0) return json({ error: "bad length" }, 400);
      const origin = body?.origin === "native-handoff" ? "native-handoff" : "web";

      const startRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_video_purchase`, {
        method: "POST",
        headers: {
          ...svc,
          "content-type": "application/json",
          // Caller-auth: auth.uid() inside the RPC is this user.
          Authorization: authHeader,
        },
        body: JSON.stringify({ _minutes: minutes, _origin: origin }),
      });
      if (!startRes.ok) {
        const detail = await startRes.text().catch(() => "");
        console.error("razorpay-order video create", startRes.status, detail.slice(0, 200));
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
      if (!start?.ok || !start.purchaseId) {
        if (start?.reason === "disabled") {
          return json({ error: "Buying video time is not open yet." }, 503);
        }
        return json({ error: "That length is not for sale." }, 400);
      }

      const amountMinor = Number(start.amountMinor);
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        return json({ error: "Could not start that payment." }, 502);
      }
      if (
        amountMinor < Number(cfg.min_amount_minor) ||
        amountMinor > Number(cfg.max_amount_minor)
      ) {
        console.error("razorpay-order video outside bounds", minutes, amountMinor);
        return json({ error: "That length is not for sale." }, 409);
      }

      const createdVideo = await createRazorpayOrder(
        creds,
        amountMinor,
        String(start.currency ?? "INR"),
        String(start.purchaseId),
        { kind: "video_seconds", purchase_id: String(start.purchaseId) },
      );
      if ("error" in createdVideo) {
        console.error("razorpay-order video razorpay", createdVideo.error);
        return json({ error: "Could not start that payment." }, 502);
      }

      const attachVideo = await fetch(`${supabaseUrl}/rest/v1/rpc/attach_video_purchase_order`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _purchase_id: start.purchaseId,
          _provider_order_id: createdVideo.id,
        }),
      });
      if (!attachVideo.ok) {
        // A Razorpay order whose id we cannot record is a payment no webhook
        // will ever find. Refusing is honest: nothing has been charged yet.
        const detail = await attachVideo.text().catch(() => "");
        console.error("razorpay-order video attach", attachVideo.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }

      return json({
        configured: true,
        kind: "video_seconds",
        keyId: creds.keyId,
        providerOrderId: createdVideo.id,
        purchaseId: start.purchaseId,
        seconds: start.seconds,
        label: start.label,
        amountMinor,
        currency: start.currency ?? "INR",
      });
    }

    // -----------------------------------------------------------------------
    // WATERMARK REMOVAL. Flat-priced addon on a Story the user already owns.
    // Same discipline as Story seconds: the row exists before the Razorpay
    // order, the price comes from story_addons, the webhook settles by
    // provider order id, and settlement clones a clean re-render when the
    // film has already shipped.
    // -----------------------------------------------------------------------
    if (wantsWatermark) {
      const jobId = String(body.watermarkJobId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "bad job id" }, 400);

      const startRes = await fetch(`${supabaseUrl}/rest/v1/rpc/create_watermark_purchase`, {
        method: "POST",
        headers: {
          ...svc,
          "content-type": "application/json",
          // Caller-auth: auth.uid() inside the RPC is this user, so ownership
          // of the job is checked where the price is read.
          Authorization: authHeader,
        },
        body: JSON.stringify({ _job_id: jobId }),
      });
      if (!startRes.ok) {
        const detail = await startRes.text().catch(() => "");
        console.error("razorpay-order watermark create", startRes.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }
      const start = (await startRes.json()) as {
        ok?: boolean;
        reason?: string;
        free?: boolean;
        purchaseId?: string;
        label?: string;
        amountMinor?: number;
        currency?: string;
      };
      if (!start?.ok) {
        if (start?.reason === "disabled")
          return json({ error: "Watermark removal is paused right now." }, 503);
        if (start?.reason === "already-clean")
          return json({ error: "That video already has no watermark." }, 409);
        return json({ error: "No such video." }, 404);
      }

      // Admin accounts get every paid feature free: the RPC already applied
      // the removal, so there is no order to create and nothing to charge.
      if (start.free === true) {
        return json({ configured: true, kind: "watermark_removal", free: true });
      }

      const amountMinor = Number(start.amountMinor);
      if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
        return json({ error: "Could not start that payment." }, 502);
      }
      if (
        amountMinor < Number(cfg.min_amount_minor) ||
        amountMinor > Number(cfg.max_amount_minor)
      ) {
        console.error("razorpay-order watermark outside bounds", amountMinor);
        return json({ error: "Watermark removal is paused right now." }, 409);
      }

      const createdWm = await createRazorpayOrder(
        creds,
        amountMinor,
        String(start.currency ?? "INR"),
        String(start.purchaseId),
        { kind: "watermark_removal", purchase_id: String(start.purchaseId) },
      );
      if ("error" in createdWm) {
        console.error("razorpay-order watermark razorpay", createdWm.error);
        return json({ error: "Could not start that payment." }, 502);
      }

      const attachWm = await fetch(`${supabaseUrl}/rest/v1/rpc/attach_watermark_purchase_order`, {
        method: "POST",
        headers: { ...svc, "content-type": "application/json" },
        body: JSON.stringify({
          _purchase_id: start.purchaseId,
          _provider_order_id: createdWm.id,
        }),
      });
      if (!attachWm.ok) {
        const detail = await attachWm.text().catch(() => "");
        console.error("razorpay-order watermark attach", attachWm.status, detail.slice(0, 200));
        return json({ error: "Could not start that payment." }, 502);
      }

      return json({
        configured: true,
        kind: "watermark_removal",
        keyId: creds.keyId,
        providerOrderId: createdWm.id,
        purchaseId: start.purchaseId,
        label: start.label,
        amountMinor,
        currency: start.currency ?? "INR",
      });
    }

    // -----------------------------------------------------------------------
    // FOOD ORDER. Physical goods and services, which Play permits a third-party
    // processor for. Everything below this line is unchanged.
    // -----------------------------------------------------------------------
    const orderId = String(body?.orderId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "bad order id" }, 400);

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
    if (!Number.isFinite(total) || total <= 0)
      return json({ error: "that order has no total" }, 409);
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
