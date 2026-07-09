// v3: news = live streams, other genres = latest uploads via RSS
// Shape: { genres: [{ id, name, emoji, live, videos: [{ videoId, title, channelName, publishedAt, thumbnail }] }] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GenreId = "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle";
type Candidate = { name: string; id?: string; handle?: string };
type GenreDef = {
  id: GenreId;
  name: string;
  emoji: string;
  live: boolean;
  candidates: Candidate[];
  perChannel?: number;
};

const GENRES: GenreDef[] = [
  {
    id: "news",
    name: "News",
    emoji: "📰",
    live: true,
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
    id: "entertainment",
    name: "Entertainment",
    emoji: "🎬",
    live: false,
    candidates: [
      { id: "UChz5aEi3dfrDVC8-YJsMUDA", name: "T-Series" },
      { id: "UCim0ZIz8SAQGPvg4mJHG3JA", name: "Netflix India" },
      { id: "UCFFbwnve3yF62-tVXkTyHqg", name: "Zee Music" },
      { id: "UC4zWG9LccdWGUlF77LZ8toA", name: "Prime Video India" },
      { id: "UC56gTxNs4f9xZ7Pa2i5xNzg", name: "Sony Music India" },
      { id: "UCFqyJFbsV-uEcosvNhg0PaQ", name: "Sony Pictures India" },
    ],
  },
  {
    id: "finance",
    name: "Finance",
    emoji: "💹",
    live: false,
    candidates: [
      { id: "UCD-qZSqFPqyx43L6gAR8qfQ", name: "CA Rachana Ranade" },
      { id: "UCNXapAc8mXTwW82MTncdfzQ", name: "Pranjal Kamra" },
      { id: "UCRzYN32xtBf3Yxsx5BvJWJw", name: "warikoo" },
      { id: "UCBI57iTXtmJoaI6Ht7MgcfA", name: "Finance With Sharan" },
      { id: "UCqW8jxh4tH1Z1sWPbkGWL4g", name: "Akshat Shrivastava" },
      { id: "UCvPTFsvuCEwXav7JwJ-3JVA", name: "Zerodha" },
    ],
  },
  {
    id: "influencer",
    name: "Influencer",
    emoji: "🔥",
    live: false,
    candidates: [
      { handle: "MrBeast", name: "MrBeast" },
      { handle: "IShowSpeed", name: "IShowSpeed" },
      { handle: "DudePerfect", name: "Dude Perfect" },
      { handle: "PewDiePie", name: "PewDiePie" },
      { handle: "ksi", name: "KSI" },
      { handle: "Sidemen", name: "Sidemen" },
      { handle: "Mrwhosetheboss", name: "Mrwhosetheboss" },
      { handle: "CarryMinati", name: "CarryMinati" },
      { handle: "TotalGaming093", name: "Total Gaming" },
      { handle: "TechnoGamerzOfficial", name: "Techno Gamerz" },
      { id: "UCLyswjODCCi5UbDe-eh5cFQ", name: "Sourav Joshi Vlogs" },
      { handle: "HikakinTV", name: "HikakinTV" },
    ],
  },
  {
    id: "sports",
    name: "Sports",
    emoji: "⚽",
    live: false,
    candidates: [
      { id: "UCt2JXOLNxqry7B_4rRZME3Q", name: "ICC" },
      { id: "UCXnFh8S94wQCPw-p6j6bX9A", name: "BCCI" },
      { id: "UCpcTrCXblq78GZrTUTLWeBw", name: "FIFA" },
      { id: "UCWJ2lWNubArHWmf3FIHbfcQ", name: "NBA" },
      { id: "UCpryVRk_VDudG8SHXgWcG0w", name: "Premier League" },
    ],
  },
  {
    id: "lifestyle",
    name: "Lifestyle",
    emoji: "🌿",
    live: false,
    candidates: [
      { id: "UCPxMZIFE856tbTfdkdjzTSQ", name: "BeerBiceps" },
      { id: "UCBRvR4Q1ddonASMOSV4QGOg", name: "Nas Daily" },
      { id: "UCk3JZr7eS3pg5AGEvBdEvFg", name: "Village Cooking Channel" },
      { id: "UCDWVNwQce16D16tPc5NBYlQ", name: "FitTuber" },
      { id: "UC9SM7V7J1pAhPabOUST01fw", name: "NASA" },
    ],
  },

];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Video = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
};
type ResolvedGenre = {
  id: GenreId;
  name: string;
  emoji: string;
  live: boolean;
  videos: Video[];
};
type CacheEntry = { at: number; data: { genres: ResolvedGenre[] } };
let cache: CacheEntry | null = null;
const TTL_MS = 10 * 60 * 1000;

// Permanent module-memory handle→channelId cache
const handleToChannelId = new Map<string, string>();

async function fetchText(url: string, timeoutMs = 6000): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
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
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLiveVideoId(channelId: string): Promise<string | null> {
  const html = await fetchText(`https://www.youtube.com/channel/${channelId}/live?hl=en&persist_hl=1`);
  if (!html) return null;
  const isLive = /"hlsManifestUrl"|"isLiveNow":true|"isLive":true/.test(html);
  if (!isLive) return null;
  let m = html.match(/<link rel="canonical" href="https?:\/\/[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  const vdIdx = html.indexOf('"videoDetails"');
  if (vdIdx >= 0) {
    const slice = html.slice(vdIdx, vdIdx + 4000);
    const vm = slice.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    if (vm) return vm[1];
  }
  const og = html.match(/<meta property="og:url" content="[^"]*[?&]v=([A-Za-z0-9_-]{11})/);
  return og ? og[1] : null;
}

async function resolveHandleToChannelId(handle: string): Promise<string | null> {
  const cached = handleToChannelId.get(handle);
  if (cached) return cached;
  const html = await fetchText(`https://www.youtube.com/@${handle}`);
  if (!html) return null;
  const m = html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/<meta itemprop="channelId" content="(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (!m) return null;
  handleToChannelId.set(handle, m[1]);
  return m[1];
}

function parseRssUploads(xml: string, fallbackChannelName: string, cap: number): Video[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? [];
  const out: Video[] = [];
  const channelNameMatch = xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/);
  const channelName = channelNameMatch ? channelNameMatch[1].trim() : fallbackChannelName;
  for (const e of entries) {
    const vid = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!vid) continue;
    const title = e.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    const published = e.match(/<published>([^<]+)<\/published>/)?.[1] ?? "";
    const thumb = e.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ||
      `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    out.push({
      videoId: vid,
      title: title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      channelName,
      publishedAt: published,
      thumbnail: thumb,
    });
    if (out.length >= cap) break;
  }
  return out;
}

async function resolveUploads(c: Candidate): Promise<Video[]> {
  let channelId = c.id ?? null;
  if (!channelId && c.handle) channelId = await resolveHandleToChannelId(c.handle);
  if (!channelId) return [];
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!xml) return [];
  return parseRssUploads(xml, c.name, 2);
}

async function resolveNewsChannel(c: Candidate): Promise<Video | null> {
  if (!c.id) return null;
  const vid = await resolveLiveVideoId(c.id);
  if (!vid) return null;
  return {
    videoId: vid,
    title: `${c.name} LIVE`,
    channelName: c.name,
    publishedAt: new Date().toISOString(),
    thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
  };
}

async function resolveGenre(g: GenreDef): Promise<ResolvedGenre | null> {
  if (g.live) {
    const settled = await Promise.allSettled(g.candidates.map(resolveNewsChannel));
    const videos = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is Video => !!v);
    if (videos.length < 4) return null;
    return { id: g.id, name: g.name, emoji: g.emoji, live: true, videos: videos.slice(0, 12) };
  }
  const settled = await Promise.allSettled(g.candidates.map(resolveUploads));
  const merged: Video[] = [];
  for (const s of settled) if (s.status === "fulfilled") merged.push(...s.value);
  merged.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  if (merged.length < 4) return null;
  return { id: g.id, name: g.name, emoji: g.emoji, live: false, videos: merged.slice(0, 12) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const settled = await Promise.allSettled(GENRES.map(resolveGenre));
    const resolved: ResolvedGenre[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled" && s.value) resolved.push(s.value);
      else if (s.status === "rejected") console.warn("[live-channels] genre failed", GENRES[i].id, s.reason);
    });
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
