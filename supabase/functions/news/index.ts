// News edge function — Google News RSS (free, no API key).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "hl=en-IN&gl=IN&ceid=IN:en";
const FEEDS: Record<string, string> = {
  top: `https://news.google.com/rss?${BASE}`,
  india: `https://news.google.com/rss/headlines/section/topic/NATION?${BASE}`,
  world: `https://news.google.com/rss/headlines/section/topic/WORLD?${BASE}`,
  business: `https://news.google.com/rss/headlines/section/topic/BUSINESS?${BASE}`,
  technology: `https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?${BASE}`,
  entertainment: `https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?${BASE}`,
  sports: `https://news.google.com/rss/headlines/section/topic/SPORTS?${BASE}`,
  science: `https://news.google.com/rss/headlines/section/topic/SCIENCE?${BASE}`,
};

type NewsItem = { title: string; link: string; source: string; publishedAt: string };
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
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
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

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const blocks = xml.match(itemRe) ?? [];
  for (const block of blocks) {
    let title = extractTag(block, "title") ?? "";
    const link = extractTag(block, "link") ?? "";
    const pubDate = extractTag(block, "pubDate") ?? "";
    let source = extractTag(block, "source") ?? "";

    if (!source) {
      const idx = title.lastIndexOf(" - ");
      if (idx > 0) {
        source = title.slice(idx + 3).trim();
        title = title.slice(0, idx).trim();
      }
    }
    if (!title || !link) continue;

    let iso = "";
    if (pubDate) {
      const d = new Date(pubDate);
      if (!isNaN(d.getTime())) iso = d.toISOString();
    }
    items.push({ title, link, source: source || "News", publishedAt: iso });
    if (items.length >= 25) break;
  }
  return items;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let category = "top";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.category) category = String(body.category);
    } else {
      const url = new URL(req.url);
      category = url.searchParams.get("category") ?? "top";
    }
    if (!FEEDS[category]) return json(400, { error: "invalid category" });

    const now = Date.now();
    const hit = cache.get(category);
    if (hit && now - hit.at < TTL_MS) {
      return json(200, { items: hit.items });
    }

    const res = await fetch(FEEDS[category], {
      headers: { "User-Agent": "Mozilla/5.0 ONIQ-News/1.0" },
    });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const xml = await res.text();
    const items = parseRss(xml);
    cache.set(category, { at: now, items });
    return json(200, { items });
  } catch (e) {
    console.error("[news]", e);
    return json(200, { items: [], error: "News is napping — try again in a minute 😴" });
  }
});
