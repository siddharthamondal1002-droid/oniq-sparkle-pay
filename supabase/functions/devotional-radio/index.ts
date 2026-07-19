// Devotional internet radio via Radio Browser API (community directory).
// Returns up to ~4 currently-reachable stations per faith.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Faith = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jewish";
type Station = { faith: Faith; name: string; streamUrl: string; favicon: string | null; tags: string[] };

const FAITH_TAGS: Record<Faith, string[]> = {
  hindu: ["bhajan", "kirtan", "devotional"],
  sikh: ["gurbani", "kirtan"],
  islamic: ["nasheed", "islamic", "quran"],
  christian: ["gospel", "christian", "worship"],
  buddhist: ["buddhism", "buddhist", "meditation"],
  jewish: ["jewish", "judaism", "torah", "hebrew"],
};

const MIRRORS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "at1.api.radio-browser.info"];
const UA = "ONIQ/1.0 (devotional-radio)";
const CACHE_TTL_MS = 30 * 60 * 1000;
const PER_FAITH_CAP = 4;

let cache: { at: number; stations: Station[] } | null = null;

type RBStation = {
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  lastcheckok?: number;
  stationuuid?: string;
};

async function searchTag(mirror: string, tag: string): Promise<RBStation[]> {
  const url = `https://${mirror}/json/stations/search?tag=${encodeURIComponent(tag)}&limit=15&hidebroken=true&order=clickcount&reverse=true`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

async function pickMirror(): Promise<string> {
  // Try each in order; fall back to first if all ping fails.
  for (const m of MIRRORS) {
    try {
      const r = await fetch(`https://${m}/json/stats`, { headers: { "User-Agent": UA } });
      if (r.ok) return m;
    } catch { /* next */ }
  }
  return MIRRORS[0];
}

async function collectForFaith(mirror: string, faith: Faith): Promise<Station[]> {
  const tags = FAITH_TAGS[faith];
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const tag of tags) {
    const list = await searchTag(mirror, tag);
    for (const s of list) {
      if (out.length >= PER_FAITH_CAP) break;
      const stream = (s.url_resolved || s.url || "").trim();
      if (!stream) continue;
      if (s.lastcheckok !== 1) continue;
      const key = stream;
      if (seen.has(key)) continue;
      seen.add(key);
      if (s.stationuuid) seen.add(s.stationuuid);
      out.push({
        faith,
        name: (s.name || "Unknown").trim().slice(0, 80),
        streamUrl: stream,
        favicon: s.favicon ? s.favicon.trim() : null,
        tags: (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6),
      });
    }
    if (out.length >= PER_FAITH_CAP) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return new Response(JSON.stringify({ stations: cache.stations, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mirror = await pickMirror();
    const faiths: Faith[] = ["islamic", "sikh", "hindu", "christian", "buddhist", "jewish"];
    const results = await Promise.all(faiths.map((f) => collectForFaith(mirror, f)));
    const stations = results.flat();

    if (stations.length === 0) {
      return new Response(JSON.stringify({ stations: [], reason: "no reachable stations" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    cache = { at: Date.now(), stations };
    return new Response(JSON.stringify({ stations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.warn("devotional-radio failed:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ stations: [], reason: "radio directory unreachable" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
