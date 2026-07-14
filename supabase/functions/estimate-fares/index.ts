// estimate-fares — server-side ride fare estimator for Indian metros.
// Returns per-provider low–high fare ranges from a static rate card.
// These are ESTIMATES only. Actual prices are set by the provider and may surge.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Point = { lat: number; lon: number; label?: string };
type Input = string | Point;

// Rate card (Kolkata / typical Indian metro).
// base (₹) + per_km (₹) + per_min (₹); low/high multipliers cover normal spread.
// Sources: publicly documented typical fare bands as of 2024–2025.
const RATE_CARD: Array<{
  providerId: string;
  providerName: string;
  vehicle: string;
  color: string;
  icon: "car" | "bike" | "auto";
  base: number;
  perKm: number;
  perMin: number;
  minFare: number;
  low: number;
  high: number;
}> = [
  { providerId: "uber",          providerName: "Uber",     vehicle: "Uber Go",   color: "#000000", icon: "car",  base: 50, perKm: 14,  perMin: 1.5, minFare: 65,  low: 0.9, high: 1.25 },
  { providerId: "ola",           providerName: "Ola",      vehicle: "Ola Mini",  color: "#3b7d0e", icon: "car",  base: 55, perKm: 13,  perMin: 1.5, minFare: 65,  low: 0.9, high: 1.25 },
  { providerId: "indrive",       providerName: "inDrive",  vehicle: "Sedan",     color: "#C1F11D", icon: "car",  base: 40, perKm: 12,  perMin: 1.2, minFare: 60,  low: 0.85, high: 1.15 },
  { providerId: "rapido-auto",   providerName: "Rapido",   vehicle: "Auto",      color: "#FFD100", icon: "auto", base: 30, perKm: 11,  perMin: 1.25, minFare: 45, low: 0.9, high: 1.2 },
  { providerId: "rapido-bike",   providerName: "Rapido",   vehicle: "Bike",      color: "#A67C00", icon: "bike", base: 20, perKm: 8,   perMin: 1.0, minFare: 30,  low: 0.9, high: 1.15 },
  { providerId: "yellow-taxi",   providerName: "Yellow Taxi", vehicle: "Metered", color: "#F4C400", icon: "car", base: 30, perKm: 15,  perMin: 0,   minFare: 35,  low: 0.95, high: 1.1 },
];

// --- rate limit (per-isolate) ---
const rlBuckets = new Map<string, number[]>();
function subFromAuth(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const p = t.split(".");
  if (p.length !== 3) return "anon";
  try { return JSON.parse(atob(p[1].replace(/-/g,"+").replace(/_/g,"/"))).sub || "anon"; } catch { return "anon"; }
}
function rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { rlBuckets.set(id, arr); return false; }
  arr.push(now); rlBuckets.set(id, arr); return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    if (!rateLimit(subFromAuth(req), 30)) return json({ error: "slow down bestie 😅" }, 429);

    const body = await req.json().catch(() => ({}));
    const pickup = await resolvePoint(body?.pickup);
    const destination = await resolvePoint(body?.destination);
    if (!pickup || !destination) {
      return json({ error: "need pickup and destination" }, 400);
    }

    const straightKm = haversineKm(pickup, destination);
    const km = Math.round(straightKm * 1.4 * 10) / 10;               // road-ish
    const mins = Math.max(3, Math.ceil((km / 22) * 60));              // ~22 km/h city avg

    const options = RATE_CARD.map((m) => {
      const raw = Math.max(m.minFare, m.base + m.perKm * km + m.perMin * mins);
      return {
        providerId: m.providerId,
        providerName: m.providerName,
        vehicle: m.vehicle,
        color: m.color,
        icon: m.icon,
        fareLow: Math.round(raw * m.low),
        fareHigh: Math.round(raw * m.high),
        etaMins: mins,
      };
    }).sort((a, b) => a.fareLow - b.fareLow);

    return json({
      route: { km, mins },
      options,
      disclaimer: "estimated fares — actual prices set by the provider and may surge",
    });
  } catch (e) {
    return json({ error: (e as Error)?.message ?? "estimator glitched" }, 500);
  }
});

async function resolvePoint(v: unknown): Promise<Point | null> {
  if (!v) return null;
  if (typeof v === "object") {
    const p = v as any;
    const lat = Number(p.lat), lon = Number(p.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, label: p.label };
  }
  if (typeof v === "string" && v.trim().length >= 3) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(v.trim())}`,
        { headers: { Accept: "application/json", "User-Agent": "ONIQ/1.0 (rides)" } },
      );
      if (!res.ok) return null;
      const rows = await res.json();
      const r = rows?.[0];
      if (!r) return null;
      return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: String(r.display_name ?? "").split(",").slice(0,3).join(",") };
    } catch { return null; }
  }
  return null;
}

function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat/2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAuth(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Auth unavailable" }, 500);
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: anon },
  });
  if (!res.ok) return json({ error: "Unauthorized" }, 401);
  return null;
}
