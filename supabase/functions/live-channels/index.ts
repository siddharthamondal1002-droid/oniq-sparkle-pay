// v3: news = live streams, other genres = latest uploads via RSS
// Shape: { genres: [{ id, name, emoji, live, videos: [{ videoId, title, channelName, publishedAt, thumbnail }] }] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type GenreId = "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle" | "devotional";
type Faith = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jain" | "jewish";
type Candidate = { name: string; id?: string; handle?: string; faith?: Faith };
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
  {
    id: "devotional",
    name: "Devotional",
    emoji: "🙏",
    live: true,
    candidates: [
      // Islamic — Grand Mosque / Prophet's Mosque live broadcasts
      { id: "UChMtBGc9nYBGEsRWKrV_uSw", name: "Makkah Live", faith: "islamic" },
      { id: "UCCZnJmWUimOYtIkB6GLrG8A", name: "Madinah Live", faith: "islamic" },
      { id: "UCyJeX5GaHTheVHBoTUSnQcw", name: "Al Haramain Al Sharifain", faith: "islamic" },
      // Islamic — nasheed / vocal hymns (verified handles → IDs)
      { id: "UCuRjIwyf33-VNeyNxWcstYg", name: "Awakening Music", faith: "islamic" },
      { id: "UCz4AXmFeSbi-0vPXI102Q5w", name: "Muslim Central", faith: "islamic" },
      { id: "UCk9wXD940aaTKy8AGjM5H8A", name: "Nasheed Records", faith: "islamic" },
      // Sikh — SGPC Amritsar (Sri Harmandir Sahib official)
      { id: "UCYn6UEtQ771a_OWSiNBoG8w", name: "SGPC, Sri Amritsar", faith: "sikh" },
      { id: "UCjSHfIYLQHDAKW9VEO5gRNQ", name: "Daily Hukamnama", faith: "sikh" },
      // Sikh — kirtan channels (verified)
      { id: "UCLMfeT_BVADvx_sTybotSLA", name: "Amritt Saagar Kirtan", faith: "sikh" },
      { id: "UC4F00emD5EG8OibGo5ixd-Q", name: "SikhNet", faith: "sikh" },
      // Hindu — TTD (Tirumala) related, mainstream devotional broadcasters
      { id: "UCsGVmie9VldduYuWYziIv9Q", name: "TTD Seva Online", faith: "hindu" },
      { id: "UCZMmfrbYGqSjKa4MWJHb9sQ", name: "Bageshwar Dham Sarkar", faith: "hindu" },
      { id: "UC7ZivIYRB0fMSGh-THcTYbw", name: "Shemaroo Bhakti", faith: "hindu" },
      // Hindu — bhajan music labels (verified)
      { id: "UCaayLD9i5x4MmIoVZxXSv_g", name: "T-Series Bhakti Sagar", faith: "hindu" },
      { id: "UC6vQRTCxutg6fJLUGkDKynQ", name: "Saregama Bhakti", faith: "hindu" },
      { id: "UCn9WB2Eb1QRSYkFxuPQHkxg", name: "Times Music Spiritual", faith: "hindu" },
      // Christian — hymns / worship music (verified)
      { id: "UC1_JSuk0BSA_FWzSvMsezGg", name: "GOD TV", faith: "christian" },
      { id: "UC4q12NoPNySbVqwpw4iO5Vg", name: "Hillsong Worship", faith: "christian" },
      { id: "UCSf-NCzjwcnXErUBW_qeFvA", name: "Elevation Worship", faith: "christian" },
      { id: "UCbertc-gMbkkHuSmg0qwnxw", name: "Bethel Music", faith: "christian" },
      { id: "UCqMof5-AMp88PfI3owykayg", name: "Maranatha Music", faith: "christian" },
      // Buddhist — teachings & chanting (verified handles → IDs)
      { id: "UCiPJ_g02LuOgOG0ZNk5j1jA", name: "Dalai Lama", faith: "buddhist" },
      { id: "UCjHbgWBt9ZUoqZBPEnsqX4A", name: "Tricycle", faith: "buddhist" },
      { id: "UClUMK5PN0vPSVAq2CDkM26w", name: "FPMT", faith: "buddhist" },
      { id: "UCTUkNCf8m5jAxzUblftQyBw", name: "Zen Mountain Monastery", faith: "buddhist" },
      { id: "UCfz9QrY-qz_j0uSygPesAeg", name: "Namgyal Monastery", faith: "buddhist" },
      // Jain — Digambar
      { id: "UCDNNWj0oAFXngcwHAwnwP4w", name: "Jinvani Channel", faith: "jain" },
      // Jain — Shwetambar
      { id: "UCsQUid3uu0yB2SLGq88EkHg", name: "Terapanth", faith: "jain" },
      { id: "UCgcOIWyN-hiHVjl1bDhj7JA", name: "Vitraag Jain Shwetambar Sangh", faith: "jain" },
      // Jain — general devotional (verified)
      { id: "UCo37KIbexDijRo0-2bfK_Tw", name: "Jain Live", faith: "jain" },
      { id: "UCh8hboHfOeh5eoVbNgRCmlQ", name: "Jain Darshan", faith: "jain" },
      { id: "UCXcHpI7iFXxIyNa4HK6rqTg", name: "jainam live channel", faith: "jain" },
      // Jewish — Torah teachings & cantorial (verified handles → IDs)
      { id: "UCfZX3CU_wWgcDyhWkvQ5rSg", name: "Chabad.org", faith: "jewish" },
      { id: "UCl9IK49EtWMazcVLoHnHdgw", name: "Aleph Beta", faith: "jewish" },
      { id: "UCq-6cYitNBPy5rttFud4c5w", name: "ArtScroll Mesorah", faith: "jewish" },
      { id: "UCPS1ETXB86wgo2fF-4OrcnQ", name: "Jewish Music Toronto", faith: "jewish" },
      { id: "UC-KdXDCCJD2AEAhSWm--O7w", name: "Sameach Music", faith: "jewish" },
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
  isLive?: boolean;
  faith?: Faith;
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

// resolveLiveVideoId() is GONE. It fetched
// https://www.youtube.com/channel/<id>/live and regexed the markup for
// hlsManifestUrl / videoDetails to pull out a video id. That breaches
// YouTube's ToS, which require the Data API rather than scraping — and it
// resolved "whatever is live" with no idea what territory that stream was
// licensed for, which is how ONIQ ended up serving geo-restricted feeds to
// anyone who asked.
//
// Live channels are now served client-side from src/data/watchChannels.ts,
// filtered by CURRENT REGION, and embedded through YouTube's own endpoint:
//   https://www.youtube.com/embed/live_stream?channel=<CHANNEL_ID>
// YouTube resolves the live video itself and applies its own geo-restrictions.
// No scrape, no Data API key, and zero quota — so the search.list trap
// (100 units/call) cannot arise here at all.

// resolveHandleToChannelId() is GONE for the same reason: it fetched
// https://www.youtube.com/@<handle> and regexed externalId/channelId out of
// the markup. Candidates must now carry a real channel id. A handle-only
// candidate is skipped rather than scraped for — see resolveUploads().

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
  // Official public RSS feed — a published syndication endpoint, not scraping.
  // This is the same basis Pulse stands on.
  const channelId = c.id ?? null;
  // Handle-only candidates are skipped: resolving a handle to an id needs
  // either the Data API (no key on this project) or a scrape (forbidden).
  // Add the channel id to the candidate to bring one back.
  if (!channelId) return [];
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  let xml = await fetchText(rssUrl);
  if (!xml) xml = await fetchText(rssUrl); // one retry
  if (!xml) return [];
  return parseRssUploads(xml, c.name, 2);
}


// Live resolution has moved to the client, region-filtered, via YouTube's
// live_stream embed. Nothing here resolves a live video any more.
async function resolveNewsChannel(_c: Candidate): Promise<Video | null> {
  return null;
}

async function resolveGenre(g: GenreDef): Promise<ResolvedGenre | null> {
  if (g.live) {
    const settled = await Promise.allSettled(g.candidates.map(resolveNewsChannel));
    const videos = settled
      .map((s) => (s.status === "fulfilled" ? s.value : null))
      .filter((v): v is Video => !!v);
    if (videos.length < 3) return null;
    return { id: g.id, name: g.name, emoji: g.emoji, live: true, videos: videos.slice(0, 12) };
  }
  const settled = await Promise.allSettled(g.candidates.map(resolveUploads));
  const merged: Video[] = [];
  for (const s of settled) if (s.status === "fulfilled") merged.push(...s.value);
  merged.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  if (merged.length < 3) return null;
  return { id: g.id, name: g.name, emoji: g.emoji, live: false, videos: merged.slice(0, 12) };
}

const FAITH_ORDER: Faith[] = ["islamic", "sikh", "hindu", "christian", "buddhist", "jain", "jewish"];
const PER_FAITH_CAP = 6;

async function resolveFaithGroup(faith: Faith, candidates: Candidate[]): Promise<Video[]> {
  const [liveSettled, uploadsSettled] = await Promise.all([
    Promise.allSettled(candidates.map(resolveNewsChannel)),
    Promise.allSettled(candidates.map(resolveUploads)),
  ]);
  const liveVideos: Video[] = liveSettled
    .map((s) => (s.status === "fulfilled" ? s.value : null))
    .filter((v): v is Video => !!v)
    .map((v) => ({ ...v, isLive: true, faith }));
  const uploadVideos: Video[] = [];
  for (const s of uploadsSettled) {
    if (s.status === "fulfilled") uploadVideos.push(...s.value.map((v) => ({ ...v, isLive: false, faith })));
  }
  uploadVideos.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  const liveIds = new Set(liveVideos.map((v) => v.videoId));
  const merged = [...liveVideos, ...uploadVideos.filter((v) => !liveIds.has(v.videoId))];
  return merged.slice(0, PER_FAITH_CAP);
}

async function resolveDevotionalGenre(g: GenreDef): Promise<ResolvedGenre | null> {
  const groups = FAITH_ORDER.map((f) => ({ faith: f, candidates: g.candidates.filter((c) => c.faith === f) }));
  const settled = await Promise.allSettled(groups.map((grp) => resolveFaithGroup(grp.faith, grp.candidates)));
  const videos: Video[] = [];
  let anyLive = false;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (s.value.length === 0) {
        console.warn("[live-channels] devotional faith empty", groups[i].faith);
      } else {
        if (s.value.some((v) => v.isLive)) anyLive = true;
        videos.push(...s.value);
      }
    } else {
      console.warn("[live-channels] devotional faith failed", groups[i].faith, s.reason);
    }
  });
  if (videos.length < 1) return null;
  return { id: g.id, name: g.name, emoji: g.emoji, live: anyLive, videos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (cache && Date.now() - cache.at < TTL_MS) {
      return new Response(JSON.stringify(cache.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const settled = await Promise.allSettled(GENRES.map((g) => g.id === "devotional" ? resolveDevotionalGenre(g) : resolveGenre(g)));
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
