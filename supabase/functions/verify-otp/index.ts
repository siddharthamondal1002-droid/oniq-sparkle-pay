// Verify OTP → provision Supabase auth user via a synthetic email and hand
// the client a magiclink token_hash it can pass to supabase.auth.verifyOtp.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Entry = { otp: string; expiresAt: number };
const OTP_STORE: Map<string, Entry> = (globalThis as unknown as {
  __oniqOtpStore?: Map<string, Entry>;
}).__oniqOtpStore ?? new Map();
(globalThis as unknown as { __oniqOtpStore?: Map<string, Entry> }).__oniqOtpStore = OTP_STORE;

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

  let body: { phone?: string; otp?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const phone = normalizeIndian(body.phone ?? "");
  const code = String(body.otp ?? "").trim();
  if (!phone || !/^\d{6}$/.test(code)) {
    return new Response(JSON.stringify({ error: "invalid phone or otp" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const entry = OTP_STORE.get(phone);
  if (!entry || entry.expiresAt < Date.now() || entry.otp !== code) {
    return new Response(JSON.stringify({ error: "invalid or expired code" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  OTP_STORE.delete(phone);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const email = syntheticEmail(phone);

  // Provision user if needed. If already exists this returns an error; ignore.
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { phone, phone_verified: true, auth_via: "phone_otp" },
  });
  if (created.error && !/(already|exists|registered)/i.test(created.error.message)) {
    console.error("createUser failed", created.error);
    return new Response(JSON.stringify({ error: "provisioning failed" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Mint a magiclink; client verifies token_hash to establish the session.
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
