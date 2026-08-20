// Devotional radio DIRECTORY via Radio Browser API (community directory).
// Returns up to ~4 currently-reachable stations per faith, as LINKS.
//
// NO LIVE CHANNELS loop, Phase 1. This used to return `url_resolved` — the
// station's actual audio stream URL — which the client then played directly
// through `new Audio(streamUrl)`. That is a stronger form of the thing the
// loop removed from Watch, not a weaker one:
//
//   - it is literally stream-URL extraction, caching (30 min, in edge memory)
//     and storage, which is what Phase 1.2 says to delete;
//   - unlike an embed, no player belonging to the rights-holder sat in
//     between, so nothing applied the station's own territorial or licensing
//     rules;
//   - and Radio Browser is a community-maintained directory. The stream URLs
//     in it are contributed, not warranted by the stations.
//
// It now returns `homepage` instead. The user taps through to the station's
// own site and presses play there, where the station serves its own audio
// under its own terms. Stations without a homepage are dropped: a row with
// nowhere to go is not a directory entry.

import { fetchWithTimeout } from "../_shared/fetchTimeout.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Faith = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jewish";
type Station = { faith: Faith; name: string; homepage: string; favicon: string | null; tags: string[] };

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

// `url` / `url_resolved` are deliberately NOT in this type. Radio Browser
// returns them, but if the field cannot be named here it cannot be read
// downstream by accident.
type RBStation = {
  name?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  lastcheckok?: number;
  stationuuid?: string;
};

async function searchTag(mirror: string, tag: string): Promise<RBStation[]> {
  const url = `https://${mirror}/json/stations/search?tag=${encodeURIComponent(tag)}&limit=15&hidebroken=true&order=clickcount&reverse=true`;
  try {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
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
      const r = await fetchWithTimeout(`https://${m}/json/stats`, { headers: { "User-Agent": UA } });
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
      const homepage = (s.homepage || "").trim();
      // No homepage => nowhere to send the user => not a directory entry.
      if (!homepage || !/^https?:\/\//i.test(homepage)) continue;
      if (s.lastcheckok !== 1) continue;
      const key = homepage;
      if (seen.has(key)) continue;
      seen.add(key);
      if (s.stationuuid) seen.add(s.stationuuid);
      out.push({
        faith,
        name: (s.name || "Unknown").trim().slice(0, 80),
        homepage,
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
