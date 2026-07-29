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

  // MSG91 transactional sendhttp (route=4) — delivers to DND numbers, no
  // pre-approved template required. We still generate + store the OTP in
  // otp_attempts and just send it as the SMS body, so verify-otp is unchanged.
  const key = Deno.env.get("MSG91_AUTH_KEY");
  if (!key) {
    // Fail closed: never return the OTP to the caller.
    console.error("MSG91_AUTH_KEY missing — refusing to issue OTP");
    return new Response(JSON.stringify({ error: "otp service not configured" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const sender = Deno.env.get("MSG91_SENDER_ID") ?? "ONIQSM";
    const message = `Your ONIQ verification code is ${otp}. Valid for 10 minutes.`;
    const url = `https://api.msg91.com/api/sendhttp.php?authkey=${encodeURIComponent(key)}&mobiles=${encodeURIComponent("91" + phone)}&message=${encodeURIComponent(message)}&sender=${encodeURIComponent(sender)}&route=4&country=91`;
    const r = await fetch(url);
    const text = await r.text();
    // sendhttp returns a request-id string on success, or an error message.
    const ok = r.ok && /^[a-f0-9-]{20,}$/i.test(text.trim());
    if (!ok) {
      console.error("msg91 sendhttp error", r.status, text);
      return new Response(JSON.stringify({ error: "SMS provider failed", detail: text }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, dev_mode: false, request_id: text.trim() }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("msg91 exception", e);
    return new Response(JSON.stringify({ error: "SMS provider unreachable" }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
