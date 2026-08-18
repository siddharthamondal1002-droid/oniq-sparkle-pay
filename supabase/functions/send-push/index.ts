// FCM v1 push sender. Auth required (sender's JWT).
// Never logs tokens. Cleans up UNREGISTERED/404 tokens.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";
import {
  parseVapidJwk,
  sendWebPush,
  vapidPublicKey,
  type VapidJwk,
} from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIREBASE_PROJECT_ID = "oniq-309bd";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const pk = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error("oauth token failed");
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  return j.access_token;
}

// --- rate limit (per-isolate; resets on cold start) ---
const rlBuckets = new Map<string, number[]>();
function _subFromAuth(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const p = t.split(".");
  if (p.length !== 3) return "anon";
  try {
    return JSON.parse(atob(p[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || "anon";
  } catch {
    return "anon";
  }
}
function _rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rlBuckets.set(id, arr);
    return false;
  }
  arr.push(now);
  rlBuckets.set(id, arr);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  // New-format Supabase API keys (sb_publishable_/sb_secret_) are opaque, not JWTs.
  // Default supabase-js sends them as `Authorization: Bearer <key>`, which PostgREST
  // rejects with "Expected 3 parts in JWT; got 1", silently zeroing every DB read
  // in this function. Wrap fetch to send them via `apikey` header only.
  const isNewKey = (k: string) => k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
  const wrapFetch =
    (key: string, extraAuth?: string): typeof fetch =>
    (input, init) => {
      const headers = new Headers(
        typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
      );
      if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
      if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
        headers.delete("Authorization");
      }
      headers.set("apikey", key);
      if (extraAuth) headers.set("Authorization", extraAuth);
      return fetch(input, { ...init, headers });
    };

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader }, fetch: wrapFetch(ANON, authHeader) },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  const senderId = userRes.user.id;
  if (!_rateLimit(senderId, 60))
    return new Response(JSON.stringify({ error: "slow down bestie 😅" }), {
      status: 429,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  let body: {
    conversation_id?: string;
    kind?: "message" | "call" | "call_cancel";
    preview?: string;
    call_type?: string;
    call_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  const { conversation_id, kind, preview, call_type, call_id } = body;
  if (!conversation_id || !kind) {
    return new Response(JSON.stringify({ error: "missing fields" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  // The TypeScript annotation on `body` is erased at runtime — nothing above
  // stops a caller putting a number where a string belongs, and a non-string
  // value inside FCM's `data` map fails the WHOLE send with INVALID_ARGUMENT
  // for every token identically. Validate for real.
  if (kind !== "message" && kind !== "call" && kind !== "call_cancel") {
    return new Response(JSON.stringify({ error: "bad kind" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  for (const [k, v] of Object.entries({ conversation_id, preview, call_type, call_id })) {
    if (v !== undefined && typeof v !== "string") {
      return new Response(JSON.stringify({ error: `${k} must be a string` }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
  }
  // Everything that enters the FCM data map goes through this: bound the
  // length and drop lone surrogates — the client's preview is built with
  // content.slice(0, 60), which can split an emoji's surrogate pair, and the
  // resulting invalid UTF-16 is rejected by FCM as INVALID_ARGUMENT.
  const clean = (v: unknown) =>
    String(v ?? "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
      .slice(0, 200);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { fetch: wrapFetch(SERVICE_KEY) },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify sender is a member of the conversation
  const { data: senderMember } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversation_id)
    .eq("user_id", senderId)
    .maybeSingle();
  if (!senderMember) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const { data: others } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversation_id)
    .neq("user_id", senderId);
  const recipientIds = (others ?? []).map((m: { user_id: string }) => m.user_id);
  if (recipientIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token, platform, keys")
    .in("user_id", recipientIds);

  // TWO TRANSPORTS, ONE TABLE. An android row's `token` is an FCM
  // registration token; a web row's is the subscription endpoint URL, with
  // its key material in `keys`. Splitting here is not cosmetic — posting an
  // endpoint URL to FCM fails, and posting an FCM token to a push service is
  // not even a request.
  type Row = { token: string; platform: string | null; keys: Record<string, string> | null };
  const rows = (tokens ?? []) as Row[];
  const fcmTokens = rows.filter((r) => r.platform !== "web").map((r) => r.token);
  const webSubs = rows
    .filter((r) => r.platform === "web" && r.keys?.p256dh && r.keys?.auth)
    .map((r) => ({
      endpoint: r.token,
      keys: { p256dh: r.keys!.p256dh, auth: r.keys!.auth },
      // WHICH VAPID KEY THIS ROW WAS SUBSCRIBED WITH, recorded by the client
      // at subscribe time. Absent on rows written before 2026-08-15, which
      // reads as "unknown" and is sent to anyway — the row may be perfectly
      // good and refusing it on a missing field would be inventing a fault.
      appServerKey: typeof r.keys!.appServerKey === "string" ? r.keys!.appServerKey : null,
    }));

  if (fcmTokens.length === 0 && webSubs.length === 0) {
    // THE SILENT FAILURE THAT HID THIS FOR WEEKS. Returning {sent:0,failed:0}
    // with a 200 is honest — nothing failed — but it is indistinguishable
    // from a delivery, and that is how 87 unreachable accounts went unnoticed
    // until the call logs were read by hand. Say it out loud.
    console.warn(
      `send-push: no push address for any of ${recipientIds.length} recipient(s) — kind=${kind}`,
    );
    return new Response(JSON.stringify({ sent: 0, failed: 0, unaddressed: recipientIds.length }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const { data: senderProfile } = await admin
    .from("profiles")
    .select("display_name, username")
    .eq("id", senderId)
    .maybeSingle();
  const senderName =
    (senderProfile as { display_name?: string; username?: string } | null)?.display_name ??
    (senderProfile as { username?: string } | null)?.username ??
    "Someone";

  const title = senderName + (kind === "call" ? " 📞" : "");
  const bodyText =
    kind === "call"
      ? `Incoming ${call_type ?? "voice"} call — open ONIQ to answer`
      : (preview ?? "New message");

  // Only pay for a Google OAuth token when there is an FCM row to use it on.
  // A web-only conversation must not fail because the Firebase service
  // account is absent, and vice versa — one transport being unconfigured is
  // not a reason to silence the other.
  let accessToken = "";
  if (fcmTokens.length > 0) {
    try {
      accessToken = await getAccessToken();
    } catch (e) {
      console.error("oauth error", (e as Error).message);
      if (webSubs.length === 0) {
        return new Response(JSON.stringify({ error: "auth failed" }), {
          status: 500,
          headers: { ...corsHeaders, "content-type": "application/json" },
        });
      }
    }
  }

  const url = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;
  let sent = 0;
  let failed = 0;
  const staleTokens: string[] = [];

  await Promise.all(
    (accessToken ? fcmTokens : []).map(async (token) => {
      try {
        // For call pushes, send DATA-ONLY (no notification block) so the
        // OniqMessagingService always runs — even when the app is backgrounded
        // or killed — and can ring the phone via a full-screen intent.
        const isCall = kind === "call";
        const isCancel = kind === "call_cancel";
        // Include acceptCall+acceptType in the deep link so tapping the call
        // notification lands the user directly on the accepting call —
        // GlobalIncomingCall's URL-adopt path picks these up on load.
        const callUrl = call_id
          ? `/app/chat/${conversation_id}?acceptCall=${encodeURIComponent(call_id)}&acceptType=${encodeURIComponent(call_type ?? "audio")}`
          : `/app/chat/${conversation_id}`;
        const dataPayload: Record<string, string> = isCall
          ? {
              kind: "call",
              title: clean(title),
              body: clean(bodyText),
              url: callUrl,
              call_type: clean(call_type ?? "voice"),
              call_id: clean(call_id ?? ""),
              conversation_id: clean(conversation_id),
            }
          : isCancel
            ? {
                // Data-only "stop ringing" signal: the native service cancels
                // the insistent call notification. No visible notification of
                // its own — the missed call surfaces in the app's call log.
                kind: "call_cancel",
                call_id: clean(call_id ?? ""),
                conversation_id: clean(conversation_id),
              }
            : {
                kind: "message",
                title: clean(title),
                body: clean(bodyText),
                url: `/app/chat/${conversation_id}`,
                conversation_id: clean(conversation_id),
              };

        const messagePayload: Record<string, unknown> = {
          token,
          data: dataPayload,
          android: {
            priority: "HIGH",
            ttl: isCall ? "60s" : isCancel ? "120s" : "3600s",
          },
        };
        if (!isCall && !isCancel) {
          messagePayload.notification = { title: clean(title), body: clean(bodyText) };
        }

        const r = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: messagePayload }),
        });
        if (r.ok) {
          sent++;
        } else {
          failed++;
          // Delete a token ONLY on evidence scoped to the token itself.
          // Substring-matching the whole error body is not evidence: an
          // INVALID_ARGUMENT (or an echoed detail string) fires identically
          // for a malformed PAYLOAD field, and acting on it deleted every
          // recipient's device_tokens row in a single send. Parse the
          // structured error instead; an unparseable body deletes nothing —
          // a genuinely dead token will fail again next send.
          let stale = r.status === 404;
          const errText = await r.text().catch(() => "");
          if (!stale && (r.status === 400 || r.status === 403)) {
            try {
              const j = JSON.parse(errText) as {
                error?: {
                  details?: {
                    "@type"?: string;
                    errorCode?: string;
                    fieldViolations?: { field?: string }[];
                  }[];
                };
              };
              const details = j.error?.details ?? [];
              const fcmErr = details.find((d) =>
                d["@type"]?.endsWith("google.firebase.fcm.v1.FcmError"),
              );
              if (fcmErr?.errorCode === "UNREGISTERED") {
                stale = true;
              } else if (fcmErr?.errorCode === "INVALID_ARGUMENT") {
                // Ambiguous on its own — only token-scoped when BadRequest
                // names the token field, not some payload field.
                const badReq = details.find((d) => d["@type"]?.endsWith("google.rpc.BadRequest"));
                stale = (badReq?.fieldViolations ?? []).some((v) => v.field === "message.token");
              }
            } catch {
              // unparseable — never delete on a guess
            }
          }
          if (stale) {
            staleTokens.push(token);
          } else {
            // Status + FCM error body head only — never the token.
            console.error("fcm send failed", r.status, errText.slice(0, 300));
          }
        }
      } catch {
        failed++;
      }
    }),
  );

  // -------------------------------------------------------------------------
  // WEB PUSH. Same words, different transport.
  //
  // The payload is JSON rather than FCM's flat string map because the browser
  // hands the service worker whatever we encrypted — but the KEYS are kept
  // identical to the FCM data map so sw.js and OniqMessagingService read the
  // same field names and cannot drift apart.
  // -------------------------------------------------------------------------
  const deadEndpoints: string[] = [];
  /**
   * Rows we refused to send to because they hold a rotated VAPID key.
   *
   * KEPT APART FROM deadEndpoints ON PURPOSE. The circuit-breaker below
   * suppresses cleanup when a whole transport fails identically, because that
   * pattern means a message-level fault rather than N dead addresses. These
   * are the one case where an identical, total failure is fully explained —
   * we did not attempt them and we know exactly why — so they must not be
   * caught by that guard. Folding them into deadEndpoints would do precisely
   * that on the first send after any rotation, when every web row is stale.
   */
  const rotatedKeyEndpoints: string[] = [];
  /**
   * Rows the push service itself refused with a VAPID-mismatch 403. Stamped
   * with that fact after the batch, never deleted — see the branch below.
   */
  const mismatchSubs: { endpoint: string; keys: { p256dh: string; auth: string } }[] = [];

  let webSent = 0;
  let webFailed = 0;
  /** How many rows were actually attempted — the circuit-breaker's denominator. */
  let webAttempted = 0;

  if (webSubs.length > 0) {
    let jwk: VapidJwk | null = null;
    try {
      const raw = Deno.env.get("VAPID_PRIVATE_KEY");
      if (raw) jwk = parseVapidJwk(raw);
    } catch (e) {
      console.error("send-push: bad VAPID_PRIVATE_KEY —", (e as Error).message);
    }
    if (!jwk) {
      // Not fatal: android recipients were already served above.
      console.error(`send-push: web push unconfigured, ${webSubs.length} subscriber(s) skipped`);
      webFailed = webSubs.length;
    } else {
      const isCall = kind === "call";
      const isCancel = kind === "call_cancel";
      const callUrl = call_id
        ? `/app/chat/${conversation_id}?acceptCall=${encodeURIComponent(call_id)}&acceptType=${encodeURIComponent(call_type ?? "audio")}`
        : `/app/chat/${conversation_id}`;
      const webPayload = JSON.stringify(
        isCancel
          ? {
              kind: "call_cancel",
              call_id: clean(call_id ?? ""),
              conversation_id: clean(conversation_id),
            }
          : {
              kind: isCall ? "call" : "message",
              title: clean(title),
              body: clean(bodyText),
              url: isCall ? callUrl : `/app/chat/${conversation_id}`,
              conversation_id: clean(conversation_id),
              ...(isCall
                ? { call_type: clean(call_type ?? "voice"), call_id: clean(call_id ?? "") }
                : {}),
            },
      );
      const subject = Deno.env.get("VAPID_SUBJECT") ?? "https://oniqhub.com";

      // A ROW SUBSCRIBED TO A DIFFERENT KEY CANNOT BE DELIVERED TO, AND WE CAN
      // SEE THAT BEFORE SPENDING A REQUEST ON IT.
      //
      // The push service answers a VAPID mismatch with 403, which is not
      // 404/410 — so `gone` never fires and it fails on every send until
      // someone opens the app on that browser. Comparing our own record
      // against the key we are about to sign with turns a permanent silent
      // failure into a known, countable one.
      //
      // SKIPPED, NOT DELETED, and that distinction is the whole safety of it.
      //
      // This function's idea of the "live" key is whatever VAPID_PRIVATE_KEY
      // its isolate booted with, and isolates are reused — the module-scope
      // token cache and rate-limit map above only work because they are. So
      // in the window after a rotation, a warm isolate still signs with the
      // OLD key while browsers that have reopened the app have correctly
      // re-minted against the NEW one. This comparison then reads those
      // HEALTHY rows as stale and the sick ones as fine: the judgement is
      // exactly inverted, and a delete would make the loss outlive the window.
      //
      // The row's recorded key is also the evidence the CLIENT uses. Leave it
      // and subscribeWebPush finds the mismatch on the next app start and does
      // the correct unsubscribe → delete → re-subscribe, on every engine.
      // Delete it and that evidence is gone, which is the one thing that
      // cannot be undone from here.
      const livePublicKey = vapidPublicKey(jwk);
      const stale = webSubs.filter((s) => s.appServerKey && s.appServerKey !== livePublicKey);
      const deliverable = webSubs.filter((s) => !s.appServerKey || s.appServerKey === livePublicKey);
      if (stale.length > 0) {
        console.error(
          `send-push: ${stale.length} web subscriber(s) recorded a different VAPID key — skipped, the app repairs them on next start`,
        );
        for (const s of stale) rotatedKeyEndpoints.push(s.endpoint);
      }
      webAttempted = deliverable.length;

      await Promise.all(
        deliverable.map(async (sub) => {
          const r = await sendWebPush(sub, webPayload, {
            jwk: jwk!,
            subject,
            // A ring is worthless late. Match the FCM TTLs exactly so the two
            // transports expire together.
            ttlSeconds: isCall ? 60 : isCancel ? 120 : 3600,
            urgency: isCall || isCancel ? "high" : "normal",
          });
          if (r.ok) {
            webSent++;
            return;
          }
          webFailed++;
          if (r.gone) {
            deadEndpoints.push(sub.endpoint);
          } else if (r.vapidMismatch) {
            // THE SERVICE SAID IT, WE DID NOT INFER IT.
            //
            // Legacy rows carry no recorded key, so the comparison above reads
            // them as deliverable and they were retried on every single send —
            // the same 403 forever, because 403 is not 404/410 and nothing ever
            // marked them. This is the one 403 that is a permanent property of
            // the address, and unlike our own key comparison it cannot be
            // inverted by a warm isolate holding a rotated-out key: it is the
            // push service reading the subscription it issued.
            //
            // Still not a delete. We stamp the row with the fact instead, which
            // both stops the retry here (the stale filter now sees a recorded
            // key that differs) and gives the CLIENT the evidence it repairs
            // itself with — subscribeWebPush finds the mismatch on next start
            // and does the unsubscribe → delete → re-subscribe properly.
            mismatchSubs.push(sub);
          } else {
            // Status and the service's complaint only — the endpoint is a
            // capability URL and belongs in logs no more than a token does.
            console.error("web push failed", r.status, r.error);
          }

        }),
      );
    }
  }

  // Circuit-breaker: N devices belonging to N different users do not all die
  // between two sends. A 100% identical failure across multiple addresses is a
  // message-level fault by definition — log it, delete nothing. Applied per
  // transport, because an FCM payload fault says nothing about the web batch
  // and folding them together would let one transport's bug wipe the other's
  // rows.
  const wipedFcm = sent === 0 && staleTokens.length === fcmTokens.length && fcmTokens.length > 1;
  // ATTEMPTED, not addressed. Rows refused for a rotated key were never sent
  // to, so counting them here would make an ordinary post-rotation send look
  // like a total transport failure and suppress the cleanup for the rows that
  // genuinely did die.
  const wipedWeb = webSent === 0 && deadEndpoints.length === webAttempted && webAttempted > 1;
  // rotatedKeyEndpoints is DELIBERATELY ABSENT. Those rows are skipped, never
  // deleted: this function cannot tell a genuinely stale row from a healthy
  // one when its own isolate holds a rotated-out key, and deleting on that
  // inference destroys the record the client needs to repair itself.
  const toDelete = [...(wipedFcm ? [] : staleTokens), ...(wipedWeb ? [] : deadEndpoints)];
  if (wipedFcm || wipedWeb) {
    console.error("send-push: a whole transport failed identically — payload fault, no cleanup");
  }
  if (toDelete.length > 0) {
    await admin.from("device_tokens").delete().in("token", toDelete);
  }

  // Record what the push service told us about each mismatched row, so neither
  // side has to rediscover it: the stale filter skips it from now on, and the
  // client sees a recorded key that is not the live one and re-subscribes.
  // The sentinel is deliberately not a real key — it is never signed with, and
  // it can only ever compare unequal to whatever the live key is.
  if (mismatchSubs.length > 0) {
    console.error(
      `send-push: ${mismatchSubs.length} web subscriber(s) rejected by the push service for a VAPID mismatch — marked for re-subscribe`,
    );
    await Promise.all(
      mismatchSubs.map((s) =>
        admin
          .from("device_tokens")
          .update({
            keys: { p256dh: s.keys.p256dh, auth: s.keys.auth, appServerKey: "vapid-mismatch" },
            updated_at: new Date().toISOString(),
          })
          .eq("token", s.endpoint),
      ),
    );
  }



  return new Response(
    JSON.stringify({
      sent: sent + webSent,
      failed: failed + webFailed,
      cleaned: toDelete.length,
      fcm: { sent, failed, addressed: fcmTokens.length },
      web: {
        sent: webSent,
        failed: webFailed,
        addressed: webSubs.length,
        // Reported rather than hidden inside `failed`: a rotated-key row is a
        // known state with a known remedy, not an error to be investigated.
        rotatedKey: rotatedKeyEndpoints.length,
        /** Rows the push service rejected for a key mismatch, now marked. */
        vapidMismatch: mismatchSubs.length,

      },
    }),
    { headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
