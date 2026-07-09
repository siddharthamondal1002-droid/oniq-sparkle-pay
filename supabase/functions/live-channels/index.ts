// Resolves current live videoId for a curated list of YouTube channels by genre.
// Returns { channels: [{ id, name, videoId, genre }] } — only channels currently live.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type Genre = "news" | "sports" | "entertainment" | "finance" | "lifestyle";
type Candidate = { name: string; genre: Genre; id?: string; handle?: string };

const CANDIDATES: Candidate[] = [
  // NEWS (existing curated set — known channel IDs)
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera", genre: "news" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News", genre: "news" },
  { id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24", genre: "news" },
  { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News", genre: "news" },
  { id: "UC83jt4dlz1Gjl58fzQrrKZg", name: "CNA", genre: "news" },
  { id: "UC_gUM8rL-Lrg6O3adPW9K1g", name: "WION", genre: "news" },
  { id: "UCZFMm1mMw0F81Z37aaEzTUA", name: "NDTV 24x7", genre: "news" },
  { id: "UCYPvAwZP8pZhSMW8qs7cVCw", name: "India Today", genre: "news" },

  // FINANCE
  { id: "UCIALMKvObZNtJ6AmdCLP7Lg", name: "Bloomberg Television", genre: "finance" },
  { handle: "yahoofinance", name: "Yahoo Finance", genre: "finance" },
  { handle: "cnbctv18", name: "CNBC-TV18", genre: "finance" },
  { handle: "ndtvprofitindia", name: "NDTV Profit", genre: "finance" },
  { handle: "etnow", name: "ET NOW", genre: "finance" },

  // SPORTS
  { handle: "ddsportschannel", name: "DD Sports", genre: "sports" },
  { handle: "redbull", name: "Red Bull TV", genre: "sports" },
  { handle: "FanCode", name: "FanCode", genre: "sports" },
  { handle: "eurosport", name: "Eurosport", genre: "sports" },
  { handle: "TSportsNews", name: "T Sports", genre: "sports" },

  // ENTERTAINMENT
  { handle: "9XM", name: "9XM", genre: "entertainment" },
  { handle: "b4umusic", name: "B4U Music", genre: "entertainment" },
  { handle: "zoomtv", name: "Zoom TV", genre: "entertainment" },
  { handle: "tseries", name: "T-Series", genre: "entertainment" },
  { handle: "mastiiitv", name: "Mastiii", genre: "entertainment" },

  // LIFESTYLE
  { handle: "LofiGirl", name: "Lofi Girl", genre: "lifestyle" },
  { handle: "NASA", name: "NASA", genre: "lifestyle" },
  { handle: "weatherchannel", name: "The Weather Channel", genre: "lifestyle" },
  { handle: "chilledcow", name: "Chilled Cow", genre: "lifestyle" },
  { handle: "jazzhopcafe", name: "Jazz Hop Café", genre: "lifestyle" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Resolved = { id: string; name: string; videoId: string; genre: Genre };
type CacheEntry = { at: number; data: { channels: Resolved[] } };
let cache: CacheEntry | null = null;
const TTL_MS = 10 * 60 * 1000;

async function resolveLive(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": "CONSENT=YES+1; SOCS=CAI",
      },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const finalUrl = res.url || "";
    const html = await res.text();
    const isLive = /"hlsManifestUrl"|"isLiveNow":true|"isLive":true/.test(html);
    if (!isLive) return null;
    let m = finalUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    m = html.match(/<link rel="canonical" href="https?:\/\/[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    const vdIdx = html.indexOf('"videoDetails"');
    if (vdIdx >= 0) {
      const slice = html.slice(vdIdx, vdIdx + 4000);
      const vm = slice.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
      if (vm) return vm[1];
    }
    const og = html.match(/<meta property="og:url" content="[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
    return og ? og[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCandidate(c: Candidate): Promise<Resolved | null> {
  const url = c.id
    ? `https://www.youtube.com/channel/${c.id}/live?hl=en&persist_hl=1`
    : `https://www.youtube.com/@${c.handle}/live?hl=en&persist_hl=1`;
  const videoId = await resolveLive(url);
  if (!videoId) return null;
  return { id: c.id ?? `@${c.handle}`, name: c.name, videoId, genre: c.genre };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settled = await Promise.allSettled(CANDIDATES.map(resolveCandidate));
    const channels = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((c): c is Resolved => !!c);

    const data = { channels };
    cache = { at: Date.now(), data };
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ channels: [], error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
