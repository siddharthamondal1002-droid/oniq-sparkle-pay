// B1 — short-lived media URL signer.
// Signs storage paths with the CALLER'S OWN identity (anon key + caller JWT),
// so storage RLS decides access — this function holds no bypass: the service
// role is never used here. TTL is hard-capped at 300 seconds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TTL = 300;
const ALLOWED_BUCKETS = new Set(["clips", "chat-media", "moments", "verification-docs"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: "Unauthorized" }, 401);

  let payload: { bucket?: string; path?: string; ttl?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const bucket = String(payload.bucket ?? "");
  const path = String(payload.path ?? "").replace(/^\/+/, "");
  if (!ALLOWED_BUCKETS.has(bucket)) return json({ error: "Unknown bucket" }, 400);
  if (!path || path.includes("..")) return json({ error: "Invalid path" }, 400);
  const ttl = Math.min(Math.max(Math.floor(Number(payload.ttl) || MAX_TTL), 30), MAX_TTL);

  // Caller-scoped client: signing succeeds only if storage RLS lets THIS
  // user read the object (own folder, or policies granting wider read).
  const asCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data: userRes, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

  const { data, error } = await asCaller.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return json({ error: "Not found or not permitted" }, 404);

  return json({ url: data.signedUrl, expires_in: ttl });
});
