// mappls-geo — Mappls (MapmyIndia) geocoding proxy.
// Auth-gated. Fetches an OAuth token server-side (cached ~23h), then proxies
// forward geocode / autosuggest / reverse geocode. Response is normalised to
// a small, stable shape. On any failure, returns HTTP 200 with
// { source: "unavailable", reason } — callers fall back to Nominatim.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchWithTimeout } from "../_shared/fetchTimeout.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function mask(s: string | undefined): string {
  if (!s) return "<empty>";
  if (s.length <= 4) return `****${s}`;
  return `****${s.slice(-4)}`;
}

let tokenCache: { token: string; expiresAt: number } | null = null;
// Log the raw shape from Mappls once so we can verify field mapping.
let loggedShape = { geocode: false, reverse: false, autosuggest: false };

async function getToken(force = false): Promise<string | null> {
  const now = Date.now();
  if (!force && tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  const clientId = Deno.env.get("MAPPLS_CLIENT_ID");
  const clientSecret = Deno.env.get("MAPPLS_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    console.warn(`mappls-geo: missing secrets id=${mask(clientId)} secret=${mask(clientSecret)}`);
    return null;
  }
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const r = await fetchWithTimeout("https://outpost.mappls.com/api/security/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn(`mappls-geo: token http ${r.status} id=${mask(clientId)} body=${t.slice(0, 200)}`);
      return null;
    }
    const j = await r.json() as { access_token?: string; expires_in?: number };
    if (!j?.access_token) {
      console.warn("mappls-geo: token response missing access_token");
      return null;
    }
    const ttlMs = Math.max(60_000, ((j.expires_in ?? 86400) - 300) * 1000);
    tokenCache = { token: j.access_token, expiresAt: now + Math.min(ttlMs, 23 * 3600 * 1000) };
    return tokenCache.token;
  } catch (e) {
    console.warn(`mappls-geo: token fetch failed ${String(e).slice(0, 200)}`);
    return null;
  }
}

type Norm = { lat: number; lon: number; label: string };

function pickNum(o: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (v == null) continue;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function pickStr(o: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normOne(item: any): Norm | null {
  if (!item || typeof item !== "object") return null;
  const lat = pickNum(item, "latitude", "lat", "Latitude");
  const lon = pickNum(item, "longitude", "lng", "lon", "Longitude");
  if (lat == null || lon == null) return null;
  const primary = pickStr(item, "formatted_address", "formattedAddress", "placeName", "placeAddress", "poi_name", "poi", "name", "address");
  const locality = pickStr(item, "locality", "subSubLocality", "subLocality", "village");
  const city = pickStr(item, "city", "district");
  const state = pickStr(item, "state");
  const parts = [primary, locality, city, state].filter((p, i, a) => p && a.indexOf(p) === i);
  const label = parts.slice(0, 3).join(", ") || primary || `${lat}, ${lon}`;
  return { lat, lon, label };
}

function extractArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.copResults,
    payload?.results,
    payload?.suggestedLocations,
    payload?.suggestedSearches,
    payload?.predictions,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c;
    if (c && typeof c === "object" && !Array.isArray(c)) return [c]; // singular object case
  }
  return [];
}

async function doForward(token: string, query: string): Promise<Norm[] | "unauthorized" | null> {
  try {
    const url = `https://atlas.mappls.com/api/places/geocode?address=${encodeURIComponent(query)}&access_token=${encodeURIComponent(token)}`;
    const r = await fetchWithTimeout(url);
    if (r.status === 401) return "unauthorized";
    if (!r.ok) { console.warn(`mappls-geo: geocode http ${r.status}`); return null; }
    const payload = await r.json().catch(() => null);
    if (!loggedShape.geocode) {
      loggedShape.geocode = true;
      console.log("mappls-geo: raw geocode payload =", JSON.stringify(payload).slice(0, 800));
    }
    return extractArray(payload).map(normOne).filter((x): x is Norm => !!x);
  } catch (e) {
    console.warn(`mappls-geo: geocode err ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function doAutosuggest(token: string, query: string, near?: string): Promise<Norm[] | "unauthorized" | null> {
  try {
    const params = new URLSearchParams({ query, access_token: token });
    if (near) params.set("location", near);
    const r = await fetchWithTimeout(`https://atlas.mappls.com/api/places/search/json?${params.toString()}`);
    if (r.status === 401) return "unauthorized";
    if (!r.ok) { console.warn(`mappls-geo: autosuggest http ${r.status}`); return null; }
    const payload = await r.json().catch(() => null);
    if (!loggedShape.autosuggest) {
      loggedShape.autosuggest = true;
      console.log("mappls-geo: raw autosuggest payload =", JSON.stringify(payload).slice(0, 800));
    }
    return extractArray(payload).map(normOne).filter((x): x is Norm => !!x);
  } catch (e) {
    console.warn(`mappls-geo: autosuggest err ${String(e).slice(0, 200)}`);
    return null;
  }
}

async function doReverse(token: string, lat: number, lon: number): Promise<string | "unauthorized" | null> {
  try {
    const url = `https://search.mappls.com/search/address/rev-geocode?lat=${lat}&lng=${lon}&access_token=${encodeURIComponent(token)}`;
    const r = await fetchWithTimeout(url);
    if (r.status === 401) return "unauthorized";
    if (!r.ok) { console.warn(`mappls-geo: reverse http ${r.status}`); return null; }
    const payload = await r.json().catch(() => null);
    if (!loggedShape.reverse) {
      loggedShape.reverse = true;
      console.log("mappls-geo: raw reverse payload =", JSON.stringify(payload).slice(0, 800));
    }
    const arr = extractArray(payload);
    const first = arr[0] ?? payload;
    const primary = pickStr(first, "formatted_address", "formattedAddress", "placeName", "placeAddress", "address");
    const locality = pickStr(first, "locality", "subSubLocality", "subLocality", "village");
    const city = pickStr(first, "city", "district");
    const state = pickStr(first, "state");
    const parts = [primary, locality, city, state].filter((p, i, a) => p && a.indexOf(p) === i);
    const label = parts.slice(0, 3).join(", ") || primary;
    return label || null;
  } catch (e) {
    console.warn(`mappls-geo: reverse err ${String(e).slice(0, 200)}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Auth gate — any signed-in Supabase user.
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

  const body = await req.json().catch(() => ({})) as {
    op?: string; query?: string; lat?: number; lon?: number; near?: string;
  };
  const op = body?.op;
  if (op !== "geocode" && op !== "reverse" && op !== "autosuggest") {
    return json(200, { source: "unavailable", reason: "invalid op" });
  }

  let apiToken = await getToken(false);
  if (!apiToken) return json(200, { source: "unavailable", reason: "no token" });

  const runOnce = async (t: string) => {
    if (op === "geocode") {
      if (!body.query || !body.query.trim()) return { source: "unavailable" as const, reason: "empty query" };
      const res = await doForward(t, body.query.trim());
      if (res === "unauthorized") return "retry" as const;
      if (!res || res.length === 0) return { source: "unavailable" as const, reason: "no results" };
      return { source: "mappls" as const, results: res };
    }
    if (op === "autosuggest") {
      if (!body.query || !body.query.trim()) return { source: "unavailable" as const, reason: "empty query" };
      const near = body.near || (Number.isFinite(body.lat) && Number.isFinite(body.lon) ? `${body.lat},${body.lon}` : undefined);
      const res = await doAutosuggest(t, body.query.trim(), near);
      if (res === "unauthorized") return "retry" as const;
      if (!res || res.length === 0) return { source: "unavailable" as const, reason: "no results" };
      return { source: "mappls" as const, results: res };
    }
    // reverse
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lon)) {
      return { source: "unavailable" as const, reason: "invalid coords" };
    }
    const label = await doReverse(t, body.lat as number, body.lon as number);
    if (label === "unauthorized") return "retry" as const;
    if (!label) return { source: "unavailable" as const, reason: "no label" };
    return { source: "mappls" as const, label };
  };

  let result = await runOnce(apiToken);
  if (result === "retry") {
    // Force-refresh token once and retry.
    tokenCache = null;
    apiToken = await getToken(true);
    if (!apiToken) return json(200, { source: "unavailable", reason: "no token (after 401)" });
    result = await runOnce(apiToken);
    if (result === "retry") return json(200, { source: "unavailable", reason: "auth failed" });
  }
  return json(200, result);
});
