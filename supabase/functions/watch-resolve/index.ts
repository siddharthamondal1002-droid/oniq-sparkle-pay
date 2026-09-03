// watch-resolve — metadata for a saved Watch reference, from the provider's
// OWN public endpoint, server-side.
//
// Owner mission, 2026-09-03. Two actions:
//   resolve — { provider, contentId } → title, creator, duration, rights fields.
//             YouTube and Vimeo via their oEmbed endpoints, Dailymotion via its
//             public Data API, the Internet Archive via its metadata API. Nebula
//             and Twitch publish no public metadata endpoint, so they resolve to
//             "not available" and the person types the title.
//   browse  — { category } → up to 24 Internet Archive films in a category, with
//             the licence and rights fields the Archive publishes per item, so
//             the client can classify rights honestly (src/lib/watch/rights.ts).
//
// WHAT THIS NEVER DOES: fetch a watch page, a stream, a manifest, a transcript
// or a thumbnail file. It reads metadata endpoints the providers publish for
// exactly this purpose, and it stores nothing itself — the client saves what
// the user confirms. JWT-gated. Logs carry provider, id shape and status only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";
import { fetchWithTimeout } from "../_shared/fetchTimeout.ts";

const ID_SHAPE: Record<string, RegExp> = {
  youtube: /^(list:[A-Za-z0-9_-]{10,60}|[\w-]{11})$/,
  vimeo: /^\d{6,12}$/,
  dailymotion: /^(playlist:)?[a-z0-9]{5,12}$/i,
  internet_archive: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,99}$/,
  nebula: /^[a-z0-9][a-z0-9-]{1,120}$/,
  twitch: /^(channel:[a-z0-9_]{3,25}|\d{6,14})$/i,
};

type Resolved = {
  resolved: boolean;
  reason?: string;
  title?: string;
  creator?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  archive?: { licenseurl?: string; rights?: string; possibleCopyrightStatus?: string };
  metadata?: Record<string, unknown>;
};

const UA = "ONIQ-Watch/1.0 (+https://oniqhub.com)";

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetchWithTimeout(
    url,
    { headers: { accept: "application/json", "user-agent": UA } },
    8000,
  );
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function str(v: unknown, max = 200): string {
  const s = Array.isArray(v) ? String(v[0] ?? "") : typeof v === "string" ? v : "";
  return s.trim().slice(0, max);
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** "1:02:05" or "3725.4" → seconds. The Archive stores either. */
function archiveLength(v: unknown): number | undefined {
  if (typeof v === "number") return num(v);
  if (typeof v !== "string") return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return num(v);
  const parts = v.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return num(parts.reduce((acc, p) => acc * 60 + p, 0));
}

async function resolveYouTube(id: string): Promise<Resolved> {
  const page = id.startsWith("list:")
    ? `https://www.youtube.com/playlist?list=${encodeURIComponent(id.slice(5))}`
    : `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const { status, body } = await getJson(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(page)}&format=json`,
  );
  if (status !== 200 || !body || typeof body !== "object") {
    console.warn(`watch-resolve: youtube oembed ${status}`);
    return { resolved: false, reason: `oembed ${status}` };
  }
  const b = body as Record<string, unknown>;
  return {
    resolved: true,
    title: str(b.title),
    creator: str(b.author_name, 120),
    thumbnailUrl: str(b.thumbnail_url, 500) || undefined,
    metadata: { source: "youtube-oembed" },
  };
}

async function resolveVimeo(id: string): Promise<Resolved> {
  const { status, body } = await getJson(
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
  );
  if (status !== 200 || !body || typeof body !== "object") {
    console.warn(`watch-resolve: vimeo oembed ${status}`);
    return { resolved: false, reason: `oembed ${status}` };
  }
  const b = body as Record<string, unknown>;
  return {
    resolved: true,
    title: str(b.title),
    creator: str(b.author_name, 120),
    durationSeconds: num(b.duration),
    thumbnailUrl: str(b.thumbnail_url, 500) || undefined,
    metadata: { source: "vimeo-oembed" },
  };
}

async function resolveDailymotion(id: string): Promise<Resolved> {
  const playlist = id.startsWith("playlist:");
  const url = playlist
    ? `https://api.dailymotion.com/playlist/${encodeURIComponent(id.slice(9))}?fields=name,owner.screenname,videos_total`
    : `https://api.dailymotion.com/video/${encodeURIComponent(id)}?fields=title,duration,owner.screenname,thumbnail_240_url`;
  const { status, body } = await getJson(url);
  if (status !== 200 || !body || typeof body !== "object") {
    console.warn(`watch-resolve: dailymotion api ${status}`);
    return { resolved: false, reason: `api ${status}` };
  }
  const b = body as Record<string, unknown>;
  return {
    resolved: true,
    title: str(playlist ? b.name : b.title),
    creator: str(b["owner.screenname"], 120),
    durationSeconds: playlist ? undefined : num(b.duration),
    thumbnailUrl: str(b.thumbnail_240_url, 500) || undefined,
    metadata: {
      source: "dailymotion-api",
      ...(playlist ? { videosTotal: num(b.videos_total) } : {}),
    },
  };
}

async function resolveArchive(id: string): Promise<Resolved> {
  const { status, body } = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  if (status !== 200 || !body || typeof body !== "object") {
    console.warn(`watch-resolve: archive metadata ${status}`);
    return { resolved: false, reason: `metadata ${status}` };
  }
  const b = body as { metadata?: Record<string, unknown>; files?: Record<string, unknown>[] };
  const m = b.metadata ?? {};
  if (!m.identifier && !m.title) return { resolved: false, reason: "no such item" };
  let longest: number | undefined;
  for (const f of b.files ?? []) {
    const name = String(f.name ?? "");
    if (!/\.(mp4|ogv|mkv|avi|mov|webm|m4v)$/i.test(name)) continue;
    const len = archiveLength(f.length);
    if (len && (!longest || len > longest)) longest = len;
  }
  return {
    resolved: true,
    title: str(m.title),
    creator: str(m.creator, 120),
    durationSeconds: longest,
    thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    archive: {
      licenseurl: str(m.licenseurl, 300) || undefined,
      rights: str(m.rights, 500) || undefined,
      possibleCopyrightStatus: str(m["possible-copyright-status"], 300) || undefined,
    },
    metadata: {
      source: "archive-metadata",
      date: str(m.date, 40) || undefined,
      collection: Array.isArray(m.collection)
        ? m.collection.slice(0, 6)
        : str(m.collection, 80) || undefined,
    },
  };
}

/** Internet Archive film categories: the query each one runs. Real collection ids. */
const ARCHIVE_CATEGORIES: Record<string, { label: string; q: string }> = {
  public_domain: {
    label: "Public-domain films",
    q: "mediatype:movies AND licenseurl:(*creativecommons.org/publicdomain*)",
  },
  silent: { label: "Silent films", q: "mediatype:movies AND collection:silent_films" },
  classic: { label: "Classic films", q: "mediatype:movies AND collection:feature_films" },
  documentary: {
    label: "Documentary and educational",
    q: "mediatype:movies AND collection:prelinger",
  },
  historical: {
    label: "Historical footage",
    q: "mediatype:movies AND collection:newsandpublicaffairs",
  },
  scifi: {
    label: "Science fiction",
    q: "mediatype:movies AND collection:SciFi_Horror AND subject:(science fiction)",
  },
  horror: { label: "Horror", q: "mediatype:movies AND collection:SciFi_Horror AND subject:horror" },
  animation: { label: "Animation", q: "mediatype:movies AND collection:classic_cartoons" },
  government: {
    label: "Government and public information films",
    q: "mediatype:movies AND collection:FedFlix",
  },
  travel: {
    label: "Travel films",
    q: "mediatype:movies AND subject:travel AND collection:prelinger",
  },
};

export const ARCHIVE_CATEGORY_IDS = Object.keys(ARCHIVE_CATEGORIES);

async function browseArchive(category: string) {
  const cat = ARCHIVE_CATEGORIES[category];
  if (!cat) return json(200, { rows: [], reason: "no such category" });
  const params = new URLSearchParams();
  params.set("q", cat.q);
  for (const f of [
    "identifier",
    "title",
    "creator",
    "year",
    "licenseurl",
    "rights",
    "possible-copyright-status",
  ]) {
    params.append("fl[]", f);
  }
  params.set("rows", "24");
  params.append("sort[]", "downloads desc");
  params.set("output", "json");
  const { status, body } = await getJson(
    `https://archive.org/advancedsearch.php?${params.toString()}`,
  );
  if (status !== 200 || !body || typeof body !== "object") {
    console.warn(`watch-resolve: archive browse ${category} ${status}`);
    return json(200, { rows: [], reason: `search ${status}` });
  }
  const docs = (
    (body as { response?: { docs?: Record<string, unknown>[] } }).response?.docs ?? []
  ).slice(0, 24);
  const rows = docs
    .map((d) => ({
      identifier: str(d.identifier, 100),
      title: str(d.title),
      creator: str(d.creator, 120) || undefined,
      year: str(d.year, 12) || undefined,
      licenseurl: str(d.licenseurl, 300) || undefined,
      rights: str(d.rights, 300) || undefined,
      possibleCopyrightStatus: str(d["possible-copyright-status"], 300) || undefined,
    }))
    .filter((r) => r.identifier && r.title);
  return json(200, { category, label: cat.label, rows });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
  } catch {
    return json(401, { error: "unauthorized" });
  }

  let body: { action?: string; provider?: string; contentId?: string; category?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* keep {} */
  }

  if (body.action === "browse") {
    return browseArchive(String(body.category ?? ""));
  }

  const provider = String(body.provider ?? "");
  const contentId = String(body.contentId ?? "").trim();
  const shape = ID_SHAPE[provider];
  if (!shape || !shape.test(contentId)) {
    console.warn(`watch-resolve: malformed ref provider=${provider} len=${contentId.length}`);
    return json(200, { resolved: false, reason: "malformed reference" });
  }
  try {
    let out: Resolved;
    switch (provider) {
      case "youtube":
        out = await resolveYouTube(contentId);
        break;
      case "vimeo":
        out = await resolveVimeo(contentId);
        break;
      case "dailymotion":
        out = await resolveDailymotion(contentId);
        break;
      case "internet_archive":
        out = await resolveArchive(contentId);
        break;
      default:
        out = { resolved: false, reason: "no public metadata endpoint" };
    }
    return json(200, out);
  } catch (e) {
    console.warn(
      `watch-resolve: ${provider} failed: ${String((e as Error)?.name ?? e).slice(0, 60)}`,
    );
    return json(200, { resolved: false, reason: "lookup failed" });
  }
});
