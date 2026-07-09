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
  const url = `https://www.youtube.com/channel/${channelId}/live`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Only consider it live if the page reports isLive
    const isLive = /"isLiveNow":true|"isLive":true/.test(html);
    if (!isLive) return null;
    // Extract canonical live videoId
    const m =
      html.match(/"videoId":"([A-Za-z0-9_-]{11})"/) ||
      html.match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
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

    const settled = await Promise.allSettled(
      CHANNELS.map(async (c) => ({ ...c, videoId: await resolveLive(c.id) })),
    );
    const channels = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((c): c is { id: string; name: string; videoId: string } => !!c && !!c.videoId);

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
