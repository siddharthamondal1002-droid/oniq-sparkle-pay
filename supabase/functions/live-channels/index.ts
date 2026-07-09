// Resolves current live videoId for curated YouTube channels grouped by genre.
// Returns { genres: [{ id, name, emoji, channels: [{ id, name, videoId }] }] }
// Genre is included only when >= 2 channels are currently live.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GenreId = "news" | "sports" | "entertainment" | "finance" | "lifestyle";
type Candidate = { name: string; id?: string; handle?: string };
type GenreDef = { id: GenreId; name: string; emoji: string; candidates: Candidate[] };

const GENRES: GenreDef[] = [
  {
    id: "news",
    name: "News",
    emoji: "📰",
    candidates: [
      { id: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera" },
      { id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News" },
      { id: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24" },
      { id: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News" },
      { id: "UC83jt4dlz1Gjl58fzQrrKZg", name: "CNA" },
      { id: "UC_gUM8rL-Lrg6O3adPW9K1g", name: "WION" },
      { id: "UCZFMm1mMw0F81Z37aaEzTUA", name: "NDTV 24x7" },
      { id: "UCYPvAwZP8pZhSMW8qs7cVCw", name: "India Today" },
    ],
  },
  {
    id: "sports",
    name: "Sports",
    emoji: "⚽",
    candidates: [
      { handle: "ddsportschannel", name: "DD Sports" },
      { handle: "SkySportsNews", name: "Sky Sports News" },
      { handle: "tntsports", name: "TNT Sports" },
      { handle: "SonySportsNetwork", name: "Sony Sports" },
      { handle: "stadium", name: "Stadium" },
      { handle: "beINSPORTS", name: "beIN SPORTS" },
      { handle: "FanCode", name: "FanCode" },
      { handle: "redbull", name: "Red Bull" },
      { handle: "eurosport", name: "Eurosport" },
      { handle: "TSportsNews", name: "T Sports" },
    ],
  },
  {
    id: "entertainment",
    name: "Entertainment",
    emoji: "🎬",
    candidates: [
      { handle: "9XMIndia", name: "9XM" },
      { handle: "B4UMusicOfficial", name: "B4U Music" },
      { handle: "mastiiitv", name: "Mastiii" },
      { handle: "LofiGirl", name: "Lofi Girl" },
      { handle: "zeemusiccompany", name: "Zee Music" },
      { handle: "tseries", name: "T-Series" },
      { handle: "zoomtv", name: "Zoom TV" },
    ],
  },
  {
    id: "finance",
    name: "Finance",
    emoji: "💹",
    candidates: [
      { handle: "markets", name: "Bloomberg TV" },
      { handle: "CNBCTV18", name: "CNBC-TV18" },
      { handle: "ETNOW", name: "ET NOW" },
      { handle: "ndtvprofitindia", name: "NDTV Profit" },
      { handle: "yahoofinance", name: "Yahoo Finance" },
      { handle: "BloombergQuicktake", name: "Bloomberg Quicktake" },
    ],
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    emoji: "🌿",
    candidates: [
      { handle: "NASA", name: "NASA" },
      { handle: "exploreLiveNatureCams", name: "Explore Nature Cams" },
      { handle: "weatherchannel", name: "Weather Channel" },
      { handle: "jazzhopcafe", name: "Jazz Hop Café" },
      { handle: "chilledcow", name: "Chilled Cow" },
    ],
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type ResolvedChannel = { id: string; name: string; videoId: string };
type ResolvedGenre = { id: GenreId; name: string; emoji: string; channels: ResolvedChannel[] };
type CacheEntry = { at: number; data: { genres: ResolvedGenre[] } };
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

async function resolveCandidate(c: Candidate): Promise<ResolvedChannel | null> {
  const url = c.id
    ? `https://www.youtube.com/channel/${c.id}/live?hl=en&persist_hl=1`
    : `https://www.youtube.com/@${c.handle}/live?hl=en&persist_hl=1`;
  const videoId = await resolveLive(url);
  if (!videoId) return null;
  return { id: c.id ?? `@${c.handle}`, name: c.name, videoId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolved: ResolvedGenre[] = [];
    await Promise.all(
      GENRES.map(async (g) => {
        const settled = await Promise.allSettled(g.candidates.map(resolveCandidate));
        const channels = settled
          .map((s) => (s.status === "fulfilled" ? s.value : null))
          .filter((c): c is ResolvedChannel => !!c);
        if (channels.length >= 2) {
          resolved.push({ id: g.id, name: g.name, emoji: g.emoji, channels });
        }
      }),
    );
    // Preserve declared genre order
    resolved.sort((a, b) => GENRES.findIndex((g) => g.id === a.id) - GENRES.findIndex((g) => g.id === b.id));

    const data = { genres: resolved };
    cache = { at: Date.now(), data };
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ genres: [], error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
