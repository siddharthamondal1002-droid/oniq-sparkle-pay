// FCM v1 push sender. Auth required (sender's JWT).
// Never logs tokens. Cleans up UNREGISTERED/404 tokens.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

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
  const j = await res.json() as { access_token: string; expires_in: number };
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
  try { return JSON.parse(atob(p[1].replace(/-/g,"+").replace(/_/g,"/"))).sub || "anon"; } catch { return "anon"; }
}
function _rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { rlBuckets.set(id, arr); return false; }
  arr.push(now); rlBuckets.set(id, arr); return true;
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
  const wrapFetch = (key: string, extraAuth?: string): typeof fetch => (input, init) => {
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
  if (!_rateLimit(senderId, 60)) return new Response(JSON.stringify({ error: "slow down bestie 😅" }), { status: 429, headers: { ...corsHeaders, "content-type": "application/json" } });

  let body: {
    conversation_id?: string;
    kind?: "message" | "call";
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
    .select("token")
    .in("user_id", recipientIds);
  const tokenList = (tokens ?? []).map((t: { token: string }) => t.token);
  if (tokenList.length === 0) {
    return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
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

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    console.error("oauth error", (e as Error).message);
    return new Response(JSON.stringify({ error: "auth failed" }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const url = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;
  let sent = 0;
  let failed = 0;
  const staleTokens: string[] = [];

  await Promise.all(
    tokenList.map(async (token) => {
      try {
        // For call pushes, send DATA-ONLY (no notification block) so the
        // OniqMessagingService always runs — even when the app is backgrounded
        // or killed — and can ring the phone via a full-screen intent.
        const isCall = kind === "call";
        // Include acceptCall+acceptType in the deep link so tapping the call
        // notification lands the user directly on the accepting call —
        // GlobalIncomingCall's URL-adopt path picks these up on load.
        const callUrl = call_id
          ? `/app/chat/${conversation_id}?acceptCall=${encodeURIComponent(call_id)}&acceptType=${encodeURIComponent(call_type ?? "audio")}`
          : `/app/chat/${conversation_id}`;
        const dataPayload: Record<string, string> = isCall
          ? {
              kind: "call",
              title,
              body: bodyText,
              url: callUrl,
              call_type: call_type ?? "voice",
              call_id: call_id ?? "",
              conversation_id,
            }
          : {
              kind: "message",
              title,
              body: bodyText,
              url: `/app/chat/${conversation_id}`,
              conversation_id,
            };

        const messagePayload: Record<string, unknown> = {
          token,
          data: dataPayload,
          android: {
            priority: "HIGH",
            ttl: isCall ? "60s" : "3600s",
          },
        };
        if (!isCall) {
          messagePayload.notification = { title, body: bodyText };
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
          if (r.status === 404) {
            staleTokens.push(token);
          } else {
            const errText = await r.text();
            if (errText.includes("UNREGISTERED") || errText.includes("INVALID_ARGUMENT")) {
              staleTokens.push(token);
            }
          }
        }
      } catch {
        failed++;
      }
    })
  );

  if (staleTokens.length > 0) {
    await admin.from("device_tokens").delete().in("token", staleTokens);
  }

  return new Response(JSON.stringify({ sent, failed, cleaned: staleTokens.length }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
