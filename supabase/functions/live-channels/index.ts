// Resolves current live videoId for a curated list of news YouTube channels.
// Returns { channels: [{ id, name, videoId }] } — only channels currently live.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const CHANNELS: { id: string; name: string }[] = [
  { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera" },
  { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
  { id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24" },
  { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" },
  { id: "UC83jt4dlz1Gjl58fzQrrKZg", name: "CNA" },
  { id: "UC_gUM8rL-Lrg6O3adPW9K1g", name: "WION" },
  { id: "UCZFMm1mMw0F81Z37aaEzTUA", name: "NDTV 24x7" },
  { id: "UCYPvAwZP8pZhSMW8qs7cVCw", name: "India Today" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type CacheEntry = { at: number; data: { channels: { id: string; name: string; videoId: string }[] } };
let cache: CacheEntry | null = null;
const TTL_MS = 10 * 60 * 1000;

async function resolveLive(channelId: string): Promise<string | null> {
  const url = `https://www.youtube.com/channel/${channelId}/live?hl=en&persist_hl=1`;
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
    // Confirm live: page will have hlsManifestUrl or isLive true for live streams
    const isLive = /"hlsManifestUrl"|"isLiveNow":true|"isLive":true/.test(html);
    if (!isLive) return null;
    // Prefer final redirect URL
    let m = finalUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    // Fallback: canonical link on the watch page
    m = html.match(/<link rel="canonical" href="https?:\/\/[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    // Last resort: first videoId inside videoDetails block
    m = html.match(/"videoDetails":\{[^}]*"videoId":"([A-Za-z0-9_-]{11})"/);
    return m ? m[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const debug: any[] = [];
    const settled = await Promise.allSettled(
      CHANNELS.map(async (c) => {
        const r = await resolveLiveDebug(c.id);
        debug.push({ name: c.name, ...r });
        return { ...c, videoId: r.videoId };
      }),
    );
    const channels = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((c): c is { id: string; name: string; videoId: string } => !!c && !!c.videoId);

    const data = { channels };
    cache = { at: Date.now(), data };
    return new Response(JSON.stringify({ ...data, debug }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ channels: [], error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
