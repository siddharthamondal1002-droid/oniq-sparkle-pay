// TURN credentials for WebRTC calls.
// Auth-gated: requires a valid Supabase JWT. Fetches short-lived TURN
// credentials from metered.ca server-side (API key never leaves the server)
// and caches them in-memory for 30 min to avoid hammering metered.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  // Require an authenticated Supabase user.
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

  // Serve from cache when fresh.
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return json(200, { iceServers: cache.iceServers });
  }

  const apiKey = Deno.env.get("METERED_API_KEY");
  if (!apiKey) return json(502, { error: "turn_unavailable" });

  try {
    const r = await fetch(
      `https://oniqhub.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
    );
    if (!r.ok) {
      console.warn("turn-creds: metered http", r.status);
      return json(502, { error: "turn_unavailable" });
    }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return json(502, { error: "turn_unavailable" });
    }
    cache = { iceServers: arr, expiresAt: now + CACHE_TTL_MS };
    return json(200, { iceServers: arr });
  } catch (e) {
    console.warn("turn-creds: metered fetch failed", e);
    return json(502, { error: "turn_unavailable" });
  }
});
