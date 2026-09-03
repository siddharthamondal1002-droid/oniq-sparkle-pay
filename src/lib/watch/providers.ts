/**
 * ONIQ Watch — the provider layer.
 *
 * Owner mission, 2026-09-03: one Watch system over several platforms, with a
 * provider abstraction so a fifth provider is an adapter, not a rewrite.
 *
 * A provider knows four things: how to recognise its links, what the content
 * id is, where the canonical page lives, and how the content is PLAYED — in
 * the provider's own embeddable player where one exists (src/data/watchEmbeds.ts
 * and YouTube's player in src/data/watchDirectory.ts), or by opening the
 * provider's own page where none does. Nothing here downloads, proxies or
 * resolves a stream, and nothing fetches a provider at parse time: a link is
 * parsed, not resolved. Metadata comes later, server-side, from the provider's
 * public endpoint (supabase/functions/watch-resolve).
 *
 * WHY NEBULA IS LINK-ONLY. Nebula publishes no embeddable player and no
 * public metadata endpoint; its videos are for its subscribers, in its own
 * apps. So a Nebula item is a reference — the canonical page, a title the
 * user confirms — and "Watch" opens nebula.tv. That is the legitimate
 * mechanism, and it is the only one implemented.
 */
import type { Playable } from "@/data/watchDirectory";
import { embedPageUrl, isValidEmbedRef, parseEmbedLink, type EmbedRef } from "@/data/watchEmbeds";
import { parseYouTube } from "@/lib/userWatch";

export type WatchProviderId =
  "youtube" | "vimeo" | "nebula" | "internet_archive" | "dailymotion" | "twitch";

export const WATCH_PROVIDER_IDS: readonly WatchProviderId[] = [
  "youtube",
  "vimeo",
  "nebula",
  "internet_archive",
  "dailymotion",
  "twitch",
];

/** What a provider can do for a saved item, so the UI never special-cases by name. */
export type ProviderCapabilities = {
  /** Plays inside Watch, in the provider's own player. */
  embed: boolean;
  /** The player can start at a saved position. */
  resume: boolean;
  /** The player reports playback position, so progress is tracked automatically. */
  progress: boolean;
  /** The provider publishes rights/licence metadata per item. */
  rights: boolean;
  /** Where server-side metadata comes from, if anywhere. */
  metadata: "oembed" | "archive" | "none";
};

/** A parsed link: the provider, its id for the thing, and where it lives. */
export type ParsedWatchRef = {
  provider: WatchProviderId;
  contentId: string;
  canonicalUrl: string;
  /** How the content plays. Null means "open the provider's page". */
  playable: Playable | null;
};

export type WatchProvider = {
  id: WatchProviderId;
  name: string;
  capabilities: ProviderCapabilities;
  /** A link into a reference, or null if this provider does not recognise it. */
  parse(raw: string): ParsedWatchRef | null;
  /** The canonical page for a stored content id — the "open on <provider>" link. */
  pageUrl(contentId: string): string;
  /** How a stored content id plays, or null when the provider's page is the player. */
  playable(contentId: string, name: string): Playable | null;
};

const NEBULA_HOSTS = new Set(["nebula.tv", "nebula.app", "watchnebula.com"]);
const NEBULA_SLUG = /^[a-z0-9][a-z0-9-]{1,120}$/;

function hostOf(raw: string): { host: string; url: URL } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return { host: url.hostname.toLowerCase().replace(/^www\./, ""), url };
  } catch {
    return null;
  }
}

function embedRef(platform: EmbedRef["platform"], raw: string): EmbedRef | null {
  const ref = parseEmbedLink(raw);
  return ref && ref.platform === platform ? ref : null;
}

function embedPlayable(embed: EmbedRef, name: string): Playable {
  return { kind: "embed", embed, name };
}

const youtube: WatchProvider = {
  id: "youtube",
  name: "YouTube",
  capabilities: { embed: true, resume: true, progress: true, rights: false, metadata: "oembed" },
  parse(raw) {
    const h = hostOf(raw);
    if (!h) return null;
    if (!/(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$/.test(h.host)) return null;
    const parsed = parseYouTube(raw);
    if (!parsed) return null;
    const contentId = parsed.kind === "list" ? `list:${parsed.id}` : parsed.id;
    return {
      provider: "youtube",
      contentId,
      canonicalUrl: youtube.pageUrl(contentId),
      playable: youtube.playable(contentId, ""),
    };
  },
  pageUrl(contentId) {
    return contentId.startsWith("list:")
      ? `https://www.youtube.com/playlist?list=${encodeURIComponent(contentId.slice(5))}`
      : `https://www.youtube.com/watch?v=${encodeURIComponent(contentId)}`;
  },
  playable(contentId, name) {
    return contentId.startsWith("list:")
      ? { kind: "playlist", list: contentId.slice(5), name }
      : { kind: "video", videoId: contentId, name };
  },
};

const vimeo: WatchProvider = {
  id: "vimeo",
  name: "Vimeo",
  capabilities: { embed: true, resume: true, progress: true, rights: false, metadata: "oembed" },
  parse(raw) {
    const ref = embedRef("vimeo", raw);
    if (!ref || ref.platform !== "vimeo") return null;
    return {
      provider: "vimeo",
      contentId: ref.video,
      canonicalUrl: embedPageUrl(ref),
      playable: embedPlayable(ref, ""),
    };
  },
  pageUrl(contentId) {
    return embedPageUrl({ platform: "vimeo", video: contentId });
  },
  playable(contentId, name) {
    const ref: EmbedRef = { platform: "vimeo", video: contentId };
    return isValidEmbedRef(ref) ? embedPlayable(ref, name) : null;
  },
};

const nebula: WatchProvider = {
  id: "nebula",
  name: "Nebula",
  capabilities: { embed: false, resume: false, progress: false, rights: false, metadata: "none" },
  parse(raw) {
    const h = hostOf(raw);
    if (!h || !NEBULA_HOSTS.has(h.host)) return null;
    const parts = h.url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "videos" || !parts[1]) return null;
    const slug = parts[1].toLowerCase();
    if (!NEBULA_SLUG.test(slug)) return null;
    return {
      provider: "nebula",
      contentId: slug,
      canonicalUrl: nebula.pageUrl(slug),
      playable: null,
    };
  },
  pageUrl(contentId) {
    return `https://nebula.tv/videos/${encodeURIComponent(contentId)}`;
  },
  playable() {
    return null;
  },
};

const internetArchive: WatchProvider = {
  id: "internet_archive",
  name: "Internet Archive",
  capabilities: { embed: true, resume: false, progress: false, rights: true, metadata: "archive" },
  parse(raw) {
    const ref = embedRef("archive", raw);
    if (!ref || ref.platform !== "archive") return null;
    return {
      provider: "internet_archive",
      contentId: ref.item,
      canonicalUrl: embedPageUrl(ref),
      playable: embedPlayable(ref, ""),
    };
  },
  pageUrl(contentId) {
    return embedPageUrl({ platform: "archive", item: contentId });
  },
  playable(contentId, name) {
    const ref: EmbedRef = { platform: "archive", item: contentId };
    return isValidEmbedRef(ref) ? embedPlayable(ref, name) : null;
  },
};

const dailymotion: WatchProvider = {
  id: "dailymotion",
  name: "Dailymotion",
  capabilities: { embed: true, resume: true, progress: true, rights: false, metadata: "oembed" },
  parse(raw) {
    const ref = embedRef("dailymotion", raw);
    if (!ref || ref.platform !== "dailymotion") return null;
    const contentId = "video" in ref ? ref.video : `playlist:${ref.playlist}`;
    return {
      provider: "dailymotion",
      contentId,
      canonicalUrl: embedPageUrl(ref),
      playable: embedPlayable(ref, ""),
    };
  },
  pageUrl(contentId) {
    return embedPageUrl(dailymotionRef(contentId));
  },
  playable(contentId, name) {
    const ref = dailymotionRef(contentId);
    return isValidEmbedRef(ref) ? embedPlayable(ref, name) : null;
  },
};

function dailymotionRef(contentId: string): EmbedRef {
  return contentId.startsWith("playlist:")
    ? { platform: "dailymotion", playlist: contentId.slice(9) }
    : { platform: "dailymotion", video: contentId };
}

const twitch: WatchProvider = {
  id: "twitch",
  name: "Twitch",
  capabilities: { embed: true, resume: false, progress: false, rights: false, metadata: "none" },
  parse(raw) {
    const ref = embedRef("twitch", raw);
    if (!ref || ref.platform !== "twitch") return null;
    const contentId = "channel" in ref ? `channel:${ref.channel}` : ref.video;
    return {
      provider: "twitch",
      contentId,
      canonicalUrl: embedPageUrl(ref),
      playable: embedPlayable(ref, ""),
    };
  },
  pageUrl(contentId) {
    return embedPageUrl(twitchRef(contentId));
  },
  playable(contentId, name) {
    const ref = twitchRef(contentId);
    return isValidEmbedRef(ref) ? embedPlayable(ref, name) : null;
  },
};

function twitchRef(contentId: string): EmbedRef {
  return contentId.startsWith("channel:")
    ? { platform: "twitch", channel: contentId.slice(8) }
    : { platform: "twitch", video: contentId };
}

export const WATCH_PROVIDERS: Record<WatchProviderId, WatchProvider> = {
  youtube,
  vimeo,
  nebula,
  internet_archive: internetArchive,
  dailymotion,
  twitch,
};

export function providerFor(id: string): WatchProvider | null {
  return (WATCH_PROVIDER_IDS as readonly string[]).includes(id)
    ? WATCH_PROVIDERS[id as WatchProviderId]
    : null;
}

/** A pasted link into a reference, trying every provider. Null = not something Watch can hold. */
export function parseWatchUrl(raw: string): ParsedWatchRef | null {
  for (const id of WATCH_PROVIDER_IDS) {
    const ref = WATCH_PROVIDERS[id].parse(raw);
    if (ref) return ref;
  }
  return null;
}

/** The provider's display name for a stored provider id, defensively. */
export function providerName(id: string): string {
  return providerFor(id)?.name ?? id;
}

/** A Nebula slug read as a title suggestion: "why-the-sky-is-blue" → "Why the sky is blue". */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}
