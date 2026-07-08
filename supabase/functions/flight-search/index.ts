// Flight search edge function — Amadeus Self-Service API (test environment).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://test.api.amadeus.com";

let cachedToken: { token: string; expiresAt: number } | null = null;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseIsoDuration(iso: string): number {
  // PT5H30M / PT45M / PT2H
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso ?? "");
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const mm = parseInt(m[2] ?? "0", 10);
  return h * 60 + mm;
}

async function getToken(key: string, secret: string): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.token;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: key,
    client_secret: secret,
  });
  const res = await fetch(`${BASE}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const token = data?.access_token;
  const expiresIn = Number(data?.expires_in ?? 1500);
  if (!token) return null;
  cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

async function resolveCode(token: string, keyword: string): Promise<string | null> {
  const url = new URL(`${BASE}/v1/reference-data/locations`);
  url.searchParams.set("subType", "CITY,AIRPORT");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("page[limit]", "1");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const first = data?.data?.[0];
  return first?.iataCode ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const key = Deno.env.get("AMADEUS_API_KEY");
    const secret = Deno.env.get("AMADEUS_API_SECRET");
    if (!key || !secret) return json(200, { configured: false });

    const { from, to, date, adults } = await req.json().catch(() => ({}));
    if (
      typeof from !== "string" || !from.trim() || from.length > 60 ||
      typeof to !== "string" || !to.trim() || to.length > 60
    ) {
      return json(400, { error: "from and to are required" });
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json(400, { error: "date must be YYYY-MM-DD" });
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const d = new Date(`${date}T00:00:00Z`);
    if (isNaN(d.getTime()) || d.getTime() < today.getTime()) {
      return json(400, { error: "date must be today or in the future" });
    }
    let n = Number.isFinite(adults) ? Math.floor(adults as number) : 1;
    if (n < 1 || n > 9) n = 1;

    const token = await getToken(key, secret);
    if (!token) return json(200, { configured: false });

    const [fromCode, toCode] = await Promise.all([
      resolveCode(token, from.trim()),
      resolveCode(token, to.trim()),
    ]);
    if (!fromCode || !toCode) {
      return json(404, { error: "Couldn't find that city — try the airport name" });
    }

    const search = new URL(`${BASE}/v2/shopping/flight-offers`);
    search.searchParams.set("originLocationCode", fromCode);
    search.searchParams.set("destinationLocationCode", toCode);
    search.searchParams.set("departureDate", date);
    search.searchParams.set("adults", String(n));
    search.searchParams.set("currencyCode", "INR");
    search.searchParams.set("max", "10");
    const res = await fetch(search, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) {
      return json(429, { error: "Amadeus is rate-limiting us — try again in a moment 🐢" });
    }
    if (!res.ok) {
      return json(200, { offers: [], fromCode, toCode });
    }
    const data = await res.json();
    const raw = Array.isArray(data?.data) ? data.data : [];
    const offers = raw
      .map((o: any) => {
        const itin = o?.itineraries?.[0];
        const segs = itin?.segments ?? [];
        if (!segs.length) return null;
        const first = segs[0];
        const last = segs[segs.length - 1];
        const price = Number(o?.price?.grandTotal ?? o?.price?.total);
        if (!Number.isFinite(price)) return null;
        return {
          price,
          airline: (o?.validatingAirlineCodes?.[0] as string) ?? first?.carrierCode ?? "??",
          departure: first?.departure?.at,
          arrival: last?.arrival?.at,
          durationMinutes: parseIsoDuration(itin?.duration ?? ""),
          stops: Math.max(0, segs.length - 1),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.price - b.price);

    return json(200, { offers, fromCode, toCode });
  } catch (e) {
    console.error("[flight-search]", e);
    return json(500, { error: "Flight search failed" });
  }
});
