// News edge function — multi-source publisher RSS (free, no API key).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Feed = { url: string; source: string };
const FEEDS: Record<string, Feed[]> = {
  top: [
    { url: "https://feeds.bbci.co.uk/news/rss.xml", source: "BBC" },
    { url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", source: "Times of India" },
    { url: "https://feeds.feedburner.com/ndtvnews-top-stories", source: "NDTV" },
  ],
  india: [
    { url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms", source: "Times of India" },
    { url: "https://feeds.feedburner.com/ndtvnews-india-news", source: "NDTV" },
    { url: "https://www.thehindu.com/news/national/feeder/default.rss", source: "The Hindu" },
  ],
  world: [
    { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
    { url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", source: "Times of India" },
  ],
  business: [
    { url: "https://feeds.bbci.co.uk/news/business/rss.xml", source: "BBC" },
    { url: "https://timesofindia.indiatimes.com/rssfeeds/1898055.cms", source: "Times of India" },
  ],
  technology: [
    { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", source: "BBC" },
    { url: "https://timesofindia.indiatimes.com/rssfeeds/66949542.cms", source: "Times of India" },
  ],
  entertainment: [
    { url: "https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms", source: "Times of India" },
    { url: "https://feeds.feedburner.com/ndtvmovies-latest", source: "NDTV" },
  ],
  sports: [
    { url: "https://feeds.bbci.co.uk/sport/rss.xml", source: "BBC" },
    { url: "https://timesofindia.indiatimes.com/rssfeeds/4719148.cms", source: "Times of India" },
  ],
  science: [
    { url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", source: "BBC" },
    { url: "https://www.thehindu.com/sci-tech/science/feeder/default.rss", source: "The Hindu" },
  ],
};

type NewsItem = { title: string; link: string; source: string; publishedAt: string; image?: string };
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; items: NewsItem[] }>();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = re.exec(block);
  return m ? decodeEntities(m[1]) : null;
}

function extractImage(block: string): string | undefined {
  const patterns: RegExp[] = [
    /<media:thumbnail[^>]*\burl=["']([^"']+)["']/i,
    /<media:content[^>]*\bmedium=["']image["'][^>]*\burl=["']([^"']+)["']/i,
    /<media:content[^>]*\burl=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i,
    /<enclosure[^>]*\btype=["']image\/[^"']+["'][^>]*\burl=["']([^"']+)["']/i,
    /<enclosure[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\/[^"']+["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(block);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title") ?? "";
    const link = extractTag(block, "link") ?? "";
    const pubDate = extractTag(block, "pubDate") ?? "";
    if (!title || !link) continue;
    let iso = "";
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) iso = d.toISOString();
    }
    const image = extractImage(block);
    items.push({ title, link, source, publishedAt: iso, image });
  }
  return items;
}

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ONIQ-News/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`${feed.source} ${res.status}`);
    const xml = await res.text();
    return parseRss(xml, feed.source);
  } finally {
    clearTimeout(t);
  }
}

// Countries where Pulse serves NO feed, enforced here as well as in the
// client. A client-side check is a rendering decision, not a gate: anyone can
// call this function directly. Mirrors src/data/newsPolicy.ts — keep the two
// in step (src/data/__tests__/newsPolicy.test.ts asserts they agree).
//
// AE: the 2023/24 UAE Media Law reaches foreign apps serving news into the
// country, penalties to AED 1M, and there is no intermediary safe harbour to
// fall back on. Do not add an override.
const FEED_BLOCKED: Record<string, string> = {
  AE: "ONIQ doesn't carry a news feed in the UAE. Local media rules reach apps that serve news here, so we'd rather show you nothing than something we can't stand behind.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let category = "top";
    let country = "";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.category) category = String(body.category);
      if (body?.country) country = String(body.country).toUpperCase();
    } else {
      const q = new URL(req.url).searchParams;
      category = q.get("category") ?? "top";
      country = (q.get("country") ?? "").toUpperCase();
    }

    const blocked = FEED_BLOCKED[country];
    if (blocked) return json(200, { items: [], unavailable: blocked, country });

    const feeds = FEEDS[category];
    if (!feeds) return json(400, { error: "invalid category" });

    const now = Date.now();
    const hit = cache.get(category);
    if (hit && now - hit.at < TTL_MS) return json(200, { items: hit.items });

    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const failures: string[] = [];
    const merged: NewsItem[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") merged.push(...r.value);
      else {
        failures.push(`${feeds[i].source}: ${String(r.reason?.message ?? r.reason)}`);
        console.error("[news] feed failed", feeds[i].url, r.reason);
      }
    });

    if (merged.length === 0) {
      return json(200, {
        items: [],
        error: "News is napping — try again in a minute 😴",
        failures,
      });
    }

    const seen = new Set<string>();
    const deduped: NewsItem[] = [];
    for (const it of merged) {
      const key = it.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }
    deduped.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    const items = deduped.slice(0, 25);
    cache.set(category, { at: now, items });
    return json(200, { items });
  } catch (e) {
    console.error("[news]", e);
    return json(200, { items: [], error: "News is napping — try again in a minute 😴" });
  }
});
