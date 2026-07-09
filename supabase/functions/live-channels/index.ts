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

async function resolveLiveDebug(channelId: string): Promise<{ videoId: string | null; status?: number; finalUrl?: string; htmlLen?: number; hasLive?: boolean; hasCanonical?: boolean; err?: string }> {
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
    const finalUrl = res.url || "";
    const status = res.status;
    if (!res.ok) return { videoId: null, status, finalUrl };
    const html = await res.text();
    const hasLive = /"hlsManifestUrl"|"isLiveNow":true|"isLive":true/.test(html);
    const canonical = html.match(/<link rel="canonical" href="https?:\/\/[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
    const hasCanonical = !!canonical;
    if (!hasLive) return { videoId: null, status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
    let m = finalUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return { videoId: m[1], status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
    if (canonical) return { videoId: canonical[1], status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
    // videoDetails-scoped lookup: substring search then videoId regex
    const vdIdx = html.indexOf('"videoDetails"');
    if (vdIdx >= 0) {
      const slice = html.slice(vdIdx, vdIdx + 4000);
      const vm = slice.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
      if (vm) return { videoId: vm[1], status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
    }
    // Fallback: og:url meta
    const og = html.match(/<meta property="og:url" content="[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
    if (og) return { videoId: og[1], status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
    return { videoId: null, status, finalUrl, htmlLen: html.length, hasLive, hasCanonical };
  } catch (e) {
    return { videoId: null, err: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

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
