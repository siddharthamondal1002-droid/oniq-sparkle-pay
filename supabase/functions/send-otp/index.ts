// Send an SMS OTP (India). Persists it in public.otp_attempts, service-role only.
//
// THIS ENDPOINT SPENDS MONEY AND ANYONE CAN CALL IT. Every request that gets
// past the guards below sends a real MSG91 SMS billed to ONIQ, to a phone the
// caller names. It cannot require a session — nobody is signed in yet when
// they ask for a sign-in code — so the guards ARE the security, and they have
// to hold against a caller who controls every byte of the request.
//
// The app's own sign-in does NOT come through here: `src/lib/otpFlow.ts` drives
// the MSG91 widget and verifies server-side in msg91-verify-session. Nothing in
// `src` invokes this function. It stays deployed for older clients, which is
// precisely why it needs guards that work unattended.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Best-effort per-IP throttle. NOT the control — it is a cheap first pass that
 * makes casual hammering cost a little more, and it fails against anyone
 * trying. Two independent reasons, both worth writing down so nobody mistakes
 * it for a defence again:
 *
 *   1. `RL` is module scope in a serverless isolate. Each isolate keeps its own
 *      Map, isolates are recycled, and concurrent requests land on different
 *      ones — so the window is "5 per 60s PER ISOLATE", not per IP.
 *   2. The key comes from `x-forwarded-for`, whose leftmost element is supplied
 *      by the caller. Sending a different value each request buys a fresh
 *      bucket every time, isolates or not.
 *
 * The real control is the per-phone cooldown below, which lives in Postgres
 * (shared across isolates) and is keyed on the normalised phone number — the
 * one field a caller cannot forge, because it is also where the SMS goes.
 */
const RL: Map<string, number[]> = new Map();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (RL.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  RL.set(ip, arr);
  return arr.length > 5;
}

/**
 * How long one phone number waits between codes.
 *
 * 60s matches the IP window above so the two read as one policy, and it is the
 * ordinary resend interval a person expects. It bounds the spend: a caller who
 * wants N messages needs N distinct valid Indian mobile numbers and a minute
 * between each. A per-day ceiling would bound it harder still, but that is a
 * quota rather than a bug fix, so it is the owner's to set.
 */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * Six digits from the CSPRNG, without modulo bias.
 *
 * `Math.random()` was the wrong tool here: V8 seeds xorshift128+ per isolate
 * and its outputs are recoverable from a handful of observed values, so codes
 * issued by the same isolate are predictable from each other. This is the one
 * secret the whole flow rests on.
 *
 * The rejection loop matters as much as the source. 2^32 is not a multiple of
 * 900000, so a bare `% 900000` would make the lowest ~167k values fractionally
 * likelier. Discarding the short tail (a 0.004% chance per draw) keeps every
 * code equally likely.
 */
function sixDigitOtp(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / 900000) * 900000;
  let v: number;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return String(100000 + (v % 900000));
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
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: "too many requests, slow down" }), {
      status: 429,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: { phone?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const phone = normalizeIndian(body.phone ?? "");
  if (!phone) {
    return new Response(JSON.stringify({ error: "invalid Indian phone number" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // THE ACTUAL GUARD, and it runs before a code is generated or an SMS is sent,
  // so a throttled request costs nothing — no row written, no message billed.
  //
  // `otp_attempts.phone` is the PRIMARY KEY, so this reads at most one row and
  // needs no new column, no index and no migration. A failure to READ is not
  // treated as permission to send: an unreachable database means the cooldown
  // cannot be evaluated, and sending anyway is how a database blip turns into
  // an SMS bill.
  const { data: last, error: lastErr } = await admin
    .from("otp_attempts")
    .select("created_at")
    .eq("phone", phone)
    .maybeSingle();
  if (lastErr) {
    console.error("otp cooldown lookup failed", lastErr);
    return new Response(JSON.stringify({ error: "try again in a moment" }), {
      status: 503,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const since = last?.created_at ? Date.now() - new Date(last.created_at).getTime() : Infinity;
  if (since < RESEND_COOLDOWN_MS) {
    return new Response(
      JSON.stringify({
        error: "a code was just sent — check your messages",
        retry_after_seconds: Math.ceil((RESEND_COOLDOWN_MS - since) / 1000),
      }),
      { status: 429, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const otp = sixDigitOtp();
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
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
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
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
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
      // The provider's raw body is logged, never returned: it can carry account
      // and routing detail, and an unauthenticated caller is the last audience
      // for it.
      console.error("msg91 sendhttp error", r.status, text);
      return new Response(JSON.stringify({ error: "SMS provider failed" }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ success: true, dev_mode: false, request_id: text.trim() }),
      {
        headers: { ...CORS, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("msg91 exception", e);
    return new Response(JSON.stringify({ error: "SMS provider unreachable" }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
