// get-turn-credentials — auth-gated. Fetches Metered.ca managed TURN
// credentials server-side (API key never leaves the server) and returns the
// iceServers array to the client. On any failure returns HTTP 200 with a
// Google STUN-only fallback so calls still attempt P2P.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FALLBACK = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  fallback: true,
};

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { iceServers: unknown[]; expiresAt: number } | null = null;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
  } catch {
    return json(401, { error: "unauthorized" });
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return json(200, { iceServers: cache.iceServers });
  }

  const domain = Deno.env.get("METERED_DOMAIN");
  const apiKey = Deno.env.get("METERED_API_KEY") ?? Deno.env.get("METERED_TURN_API_KEY");
  if (!domain || !apiKey) {
    console.warn("get-turn-credentials: missing METERED_DOMAIN or METERED_API_KEY");
    return json(200, FALLBACK);
  }

  try {
    const r = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
    );
    if (!r.ok) {
      console.warn("get-turn-credentials: metered http", r.status);
      return json(200, FALLBACK);
    }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return json(200, FALLBACK);
    }
    cache = { iceServers: arr, expiresAt: now + CACHE_TTL_MS };
    return json(200, { iceServers: arr });
  } catch (e) {
    console.warn("get-turn-credentials: fetch failed", e);
    return json(200, FALLBACK);
  }
});
