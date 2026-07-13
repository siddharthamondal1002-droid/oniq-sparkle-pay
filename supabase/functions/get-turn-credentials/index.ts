// get-turn-credentials — auth-gated. Fetches Metered.ca managed TURN
// credentials server-side (API key never leaves the server) and returns the
// iceServers array to the client.
//
// Response shape: { iceServers: RTCIceServer[], source: "metered" | "fallback" }
//
// On any failure we return HTTP 200 with a STUN-ONLY fallback so the client
// can still detect the situation via `source: "fallback"` and refuse to
// start a doomed call. We do NOT include any `openrelay.metered.ca` entries
// in the fallback — that project is decommissioned and its credentials no
// longer authenticate, which previously caused calls to hang on
// "Connecting..." indefinitely because the client saw `turn:` URLs and
// assumed relay was available.
//
// We cache ONLY successful Metered payloads for 30 min. Fallback responses
// are never cached, so a transient Metered blip does not poison every
// subsequent call for the next half hour.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const STUN_ONLY_FALLBACK = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  source: "fallback" as const,
};

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { iceServers: unknown[]; expiresAt: number } | null = null;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function maskKey(k: string): string {
  if (!k) return "<empty>";
  if (k.length <= 4) return `****${k}`;
  return `****${k.slice(-4)}`;
}

async function fetchMetered(
  domain: string,
  apiKey: string,
): Promise<{ ok: true; arr: unknown[] } | { ok: false; reason: string }> {
  try {
    const r = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return {
        ok: false,
        reason: `http ${r.status} key=${maskKey(apiKey)} body=${body.slice(0, 200)}`,
      };
    }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, reason: `empty payload key=${maskKey(apiKey)}` };
    }
    return { ok: true, arr };
  } catch (e) {
    return { ok: false, reason: `fetch error key=${maskKey(apiKey)} err=${String(e).slice(0, 200)}` };
  }
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
    return json(200, { iceServers: cache.iceServers, source: "metered" });
  }

  const domain = Deno.env.get("METERED_DOMAIN");
  const apiKey = Deno.env.get("METERED_API_KEY") ?? Deno.env.get("METERED_TURN_API_KEY");
  if (!domain || !apiKey) {
    console.warn("get-turn-credentials: missing METERED_DOMAIN or METERED_API_KEY");
    return json(200, STUN_ONLY_FALLBACK);
  }

  // Try once, then retry once after 1s on failure, before giving up.
  let result = await fetchMetered(domain, apiKey);
  if (!result.ok) {
    console.warn(`get-turn-credentials: metered attempt 1 failed — ${result.reason}`);
    await new Promise((r) => setTimeout(r, 1000));
    result = await fetchMetered(domain, apiKey);
    if (!result.ok) {
      console.warn(`get-turn-credentials: metered attempt 2 failed — ${result.reason}`);
      // Do NOT cache fallback — retry Metered on the very next request.
      return json(200, STUN_ONLY_FALLBACK);
    }
  }

  cache = { iceServers: result.arr, expiresAt: now + CACHE_TTL_MS };
  return json(200, { iceServers: result.arr, source: "metered" });
});
