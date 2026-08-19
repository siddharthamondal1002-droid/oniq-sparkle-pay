// Track B3 — Real-time Developer Notifications from Google Play, delivered by
// Pub/Sub push.
//
// THE THING THAT CATCHES EVERYONE: AN RTDN ONLY SAYS THE STATE CHANGED. It
// carries a notification type and a purchase token and nothing you may treat
// as the truth about the subscription. The actual state has to be FETCHED from
// the Play Developer API afterwards — acting on the notification body alone
// gives you renewals that never happened and revocations you invented.
//
// Pub/Sub push is at-least-once, so the same messageId arrives again whenever
// the ack is slow or lost. Dedupe is on messageId, in Postgres, before any
// work happens: a duplicate must not post a second charge.
//
// This lives under /api/public/* because Google calls it, which means the
// platform does not authenticate it — so the handler does, with a shared
// secret compared in constant time.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type PubSubPush = {
  message?: { data?: string; messageId?: string; message_id?: string };
  subscription?: string;
};

type PlayNotice = {
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string };
  testNotification?: { version?: string };
};

/** Notification types that mean "money arrived": purchased, renewed, recovered. */
const CHARGE_TYPES = new Set([1, 2, 4, 7]);
/** Revoked / refunded. */
const REVOKE_TYPES = new Set([12]);
/** Ended without money moving back. */
const END_TYPES = new Set([3, 13]);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  // .buffer, freshly allocated above, so the type is a plain ArrayBuffer.
  return out.buffer;
}

/**
 * A Google access token from the service account, signed here rather than
 * pulled from a library: the Worker runtime has WebCrypto and no Node crypto
 * addons, and this is forty lines against a dependency that assumes Node.
 */
async function playAccessToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/androidpublisher",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${claim}`),
    ),
  );
  const assertion = `${header}.${claim}.${b64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`play token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export const Route = createFileRoute("/api/public/play-rtdn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["PLAY_RTDN_SECRET"] ?? "";
        const url = new URL(request.url);
        const presented =
          (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") ||
          (url.searchParams.get("token") ?? "");
        // An unset secret must never mean "everyone is allowed".
        if (secret.length < 20 || !constantTimeEqual(secret, presented)) {
          return new Response("forbidden", { status: 403 });
        }

        const supa = createClient(
          process.env["SUPABASE_URL"] ?? "",
          process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
          { auth: { persistSession: false } },
        );

        const push = (await request.json().catch(() => ({}))) as PubSubPush;
        const messageId = push.message?.messageId ?? push.message?.message_id ?? "";
        if (!messageId) return Response.json({ error: "no messageId" }, { status: 400 });

        let notice: PlayNotice = {};
        try {
          notice = JSON.parse(atob(push.message?.data ?? "")) as PlayNotice;
        } catch {
          notice = {};
        }
        const sub = notice.subscriptionNotification;

        // DEDUPE FIRST. A conflict means this exact delivery has already been
        // handled; Pub/Sub wants a 200 either way, or it redelivers forever.
        const { error: dupErr } = await supa.from("creator_rtdn_events").insert({
          message_id: messageId,
          notification_type: sub?.notificationType ?? null,
          purchase_token: sub?.purchaseToken ?? null,
          sku: sub?.subscriptionId ?? null,
          payload: notice,
        });
        if (dupErr) {
          return Response.json({ ok: true, deduped: true, messageId });
        }
        if (notice.testNotification || !sub?.purchaseToken) {
          await supa
            .from("creator_rtdn_events")
            .update({ processed_at: new Date().toISOString() })
            .eq("message_id", messageId);
          return Response.json({ ok: true, test: true });
        }

        // NOW ask Play what is actually true.
        const saJson = process.env["GOOGLE_PLAY_SERVICE_ACCOUNT"] ?? "";
        const pkg = process.env["PLAY_PACKAGE_NAME"] ?? notice.packageName ?? "";
        if (!saJson || !pkg) {
          await supa
            .from("creator_rtdn_events")
            .update({ error: "missing GOOGLE_PLAY_SERVICE_ACCOUNT or PLAY_PACKAGE_NAME" })
            .eq("message_id", messageId);
          // 200 on purpose: the delivery is recorded and replayable from the
          // table. Failing here would have Pub/Sub redeliver a message we
          // already stored, forever, for a configuration problem.
          return Response.json({ ok: false, stored: true, error: "play api not configured" });
        }

        let state: Record<string, unknown>;
        try {
          const token = await playAccessToken(saJson);
          const res = await fetch(
            `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${encodeURIComponent(sub.purchaseToken)}`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          if (!res.ok) throw new Error(`play api ${res.status}: ${await res.text()}`);
          state = (await res.json()) as Record<string, unknown>;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await supa.from("creator_rtdn_events").update({ error: msg }).eq("message_id", messageId);
          return Response.json({ ok: false, stored: true, error: msg });
        }

        // The creator being paid rides in the obfuscated profile id, the
        // subscriber in the obfuscated account id. Play knows only the tier —
        // the mapping from tier to creator is ONIQ's, which is the whole point
        // of B2.
        const ext = (state["externalAccountIdentifiers"] ?? {}) as Record<string, string>;
        const subscriberId = ext["obfuscatedExternalAccountId"] ?? "";
        const creatorId = ext["obfuscatedExternalProfileId"] ?? "";
        const line = (state["lineItems"] as Array<Record<string, unknown>> | undefined)?.[0];
        const sku = (line?.["productId"] as string) ?? sub.subscriptionId ?? "";
        const periodEnd = (line?.["expiryTime"] as string) ?? null;

        let result: unknown = null;
        let error: string | null = null;
        const type = sub.notificationType ?? 0;
        try {
          if (REVOKE_TYPES.has(type)) {
            const { data, error: e } = await supa.rpc("record_creator_refund", {
              _purchase_token: sub.purchaseToken,
              _reason: `play notification ${type}`,
            });
            result = data;
            error = e?.message ?? null;
          } else if (END_TYPES.has(type)) {
            await supa
              .from("creator_subscriptions")
              .update({ status: "expired", updated_at: new Date().toISOString() })
              .eq("purchase_token", sub.purchaseToken);
            result = { ended: true };
          } else if (CHARGE_TYPES.has(type)) {
            const { data: skuRow } = await supa
              .from("creator_sub_skus")
              .select("price_paise")
              .eq("sku", sku)
              .maybeSingle();
            const { data, error: e } = await supa.rpc("record_creator_charge", {
              _purchase_token: sub.purchaseToken,
              _subscriber: subscriberId,
              _creator: creatorId,
              _sku: sku,
              _gross_paise: skuRow?.price_paise ?? 0,
              _period_end: periodEnd,
            });
            result = data;
            error = e?.message ?? null;
          } else {
            result = { ignored: type };
          }
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }

        await supa
          .from("creator_rtdn_events")
          .update({
            fetched_state: state,
            processed_at: new Date().toISOString(),
            error,
          })
          .eq("message_id", messageId);

        return Response.json({ ok: !error, type, result, error });
      },
    },
  },
});
