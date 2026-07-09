// My TV — user-curated YouTube channels. Authenticated.
// Actions: "resolve" (URL/handle → { channelId, name }), "videos" (merged uploads from user_channels)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type Video = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
};

const videoCache = new Map<string, { at: number; videos: Video[] }>();
const TTL_MS = 5 * 60 * 1000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

function extractHandleOrId(input: string): { channelId?: string; handle?: string } | null {
  const s = input.trim();
  if (!s) return null;
  const idMatch = s.match(/(UC[A-Za-z0-9_-]{22})/);
  if (idMatch) return { channelId: idMatch[1] };
  const handleUrl = s.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
  if (handleUrl) return { handle: handleUrl[1] };
  const bareAt = s.match(/^@([A-Za-z0-9._-]+)$/);
  if (bareAt) return { handle: bareAt[1] };
  if (/^[A-Za-z0-9._-]+$/.test(s)) return { handle: s };
  return null;
}

async function resolveChannel(input: string): Promise<{ channelId: string; name: string } | null> {
  const parsed = extractHandleOrId(input);
  if (!parsed) return null;
  const url = parsed.channelId
    ? `https://www.youtube.com/channel/${parsed.channelId}`
    : `https://www.youtube.com/@${parsed.handle}`;
  const html = await fetchText(url, 8000);
  if (!html) return null;
  const idMatch = html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/);
  const channelId = idMatch ? idMatch[1] : parsed.channelId;
  if (!channelId) return null;
  const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/) ||
    html.match(/<title>([^<]+)<\/title>/);
  let name = nameMatch ? nameMatch[1] : (parsed.handle ?? channelId);
  name = name.replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return { channelId, name };
}

function parseRssUploads(xml: string, fallbackName: string, cap: number): Video[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/g) ?? [];
  const out: Video[] = [];
  const channelNameMatch = xml.match(/<author>[\s\S]*?<name>([^<]+)<\/name>/);
  const channelName = channelNameMatch ? channelNameMatch[1].trim() : fallbackName;
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

async function fetchChannelUploads(channelId: string, name: string): Promise<Video[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  let xml = await fetchText(url);
  if (!xml) xml = await fetchText(url);
  if (!xml) return [];
  return parseRssUploads(xml, name, 2);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "unauthorized" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json(401, { error: "unauthorized" });
  const userId = userData.user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  const action = body?.action;

  try {
    if (action === "resolve") {
      const input = String(body?.input ?? "").slice(0, 500);
      const resolved = await resolveChannel(input);
      if (!resolved) {
        return json(404, { error: "Couldn't find that channel — paste the full link" });
      }
      return json(200, resolved);
    }

    if (action === "videos") {
      const cached = videoCache.get(userId);
      if (cached && Date.now() - cached.at < TTL_MS) {
        return json(200, { videos: cached.videos });
      }
      const { data: rows, error } = await supabase
        .from("user_channels")
        .select("channel_id, name")
        .eq("user_id", userId);
      if (error) throw error;
      const list = rows ?? [];
      const settled = await Promise.allSettled(
        list.map((r) => fetchChannelUploads(r.channel_id, r.name)),
      );
      const merged: Video[] = [];
      for (const s of settled) if (s.status === "fulfilled") merged.push(...s.value);
      merged.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
      const videos = merged.slice(0, 12);
      videoCache.set(userId, { at: Date.now(), videos });
      return json(200, { videos });
    }

    return json(400, { error: "unknown action" });
  } catch (e) {
    console.error("[my-tv]", e);
    return json(500, { error: String(e) });
  }
});
