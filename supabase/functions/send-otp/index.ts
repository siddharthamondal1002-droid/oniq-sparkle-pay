// Send SMS OTP via Fast2SMS (India). Persists the OTP in public.otp_attempts
// (service-role only). Dev-mode (no FAST2SMS_API_KEY) returns the OTP.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  let body: { phone?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const phone = normalizeIndian(body.phone ?? "");
  if (!phone) {
    return new Response(JSON.stringify({ error: "invalid Indian phone number" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  // Sweep expired rows, then upsert current OTP.
  await admin.from("otp_attempts").delete().lt("expires_at", new Date().toISOString());
  const { error: upErr } = await admin.from("otp_attempts").upsert({
    phone,
    otp,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  });
  if (upErr) {
    console.error("otp store failed", upErr);
    return new Response(JSON.stringify({ error: "storage failed" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // MSG91 transactional OTP route — delivers to DND numbers (unlike Fast2SMS
  // promotional Quick route). NOTE: we still generate + store the OTP in
  // otp_attempts and pass it to MSG91 as the `otp` param, so MSG91 sends OUR
  // code. verify-otp remains unchanged — it matches against our stored value.
  const key = Deno.env.get("MSG91_AUTH_KEY");
  if (!key) {
    return new Response(JSON.stringify({ success: true, dev_mode: true, otp }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const r = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { authkey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        template_id: Deno.env.get("MSG91_TEMPLATE_ID") ?? "",
        mobile: "91" + phone,
        otp,
      }),
    });
    const body = await r.json().catch(() => ({} as { type?: string }));
    if (!r.ok || (body as { type?: string }).type !== "success") {
      console.error("msg91 error", r.status, body);
      return new Response(JSON.stringify({ error: "SMS provider failed" }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, dev_mode: false }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("msg91 exception", e);
    return new Response(JSON.stringify({ error: "SMS provider unreachable" }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
