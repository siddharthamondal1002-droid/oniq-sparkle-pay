// Verify an MSG91 widget access-token, then provision (or fetch) the auth
// user via a synthetic email and return a magiclink token_hash. The client
// finishes the session via supabase.auth.verifyOtp({token_hash, type:'magiclink'}).
// Same downstream shape as the retired verify-otp; the OTP check itself now
// happens inside MSG91's DLT-compliant widget infra.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Brute-force gate: without this, an attacker gets unlimited access-token
// guesses AND each guess spends an MSG91 verify call under our auth key. Same
// per-IP window as send-otp (5 per 60s per isolate); a legitimate user
// verifies once per login, so 5/min never touches a real flow.
const RL: Map<string, number[]> = new Map();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (RL.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  RL.set(ip, arr);
  return arr.length > 5;
}

function normalizeIndian(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  const trimmed = digits.replace(/^0+/, "").replace(/^91/, "");
  return /^[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
}

const syntheticEmail = (phone: string) => `phone_${phone}@oniq.phone`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: "too many requests, slow down" }), {
      status: 429, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get("MSG91_AUTH_KEY");
  if (!key) {
    return new Response(JSON.stringify({ error: "otp service not configured" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: { access_token?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const token = String(body.access_token ?? "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "missing access_token" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Verify with MSG91.
  let phoneRaw = "";
  try {
    const r = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authkey: key, "access-token": token }),
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>));
    if (!r.ok || (j as { type?: string }).type !== "success") {
      console.error("msg91 verify failed", r.status, j);
      return new Response(JSON.stringify({ error: "invalid or expired code" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const msg = (j as { message?: unknown }).message;
    if (typeof msg === "string") {
      phoneRaw = msg;
    } else if (msg && typeof msg === "object") {
      const m = msg as Record<string, unknown>;
      phoneRaw = String(m.mobile ?? m.phone ?? m.number ?? "");
    }
  } catch (e) {
    console.error("msg91 verify exception", e);
    return new Response(JSON.stringify({ error: "verify unreachable" }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const phone = normalizeIndian(phoneRaw);
  if (!phone) {
    return new Response(JSON.stringify({ error: "phone missing from verification" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const email = syntheticEmail(phone);
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { phone, phone_verified: true, auth_via: "msg91_widget" },
  });
  if (created.error && !/(already|exists|registered)/i.test(created.error.message)) {
    console.error("createUser failed", created.error);
    return new Response(JSON.stringify({ error: "provisioning failed" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token_hash = link.data?.properties?.hashed_token;
  if (link.error || !token_hash) {
    console.error("generateLink failed", link.error);
    return new Response(JSON.stringify({ error: "session mint failed" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ verified: true, email, token_hash }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
