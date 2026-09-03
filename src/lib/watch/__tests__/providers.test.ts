/**
 * Provider parsing — YouTube, Vimeo, Nebula, the Internet Archive, and the two
 * players Watch already had. A link is parsed, never fetched; a page that is
 * not something to hold is refused; an unsupported host is refused.
 */
import { describe, expect, it } from "vitest";
import {
  WATCH_PROVIDERS,
  WATCH_PROVIDER_IDS,
  parseWatchUrl,
  providerFor,
  titleFromSlug,
} from "@/lib/watch/providers";

describe("parseWatchUrl", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "youtube",
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ",
      "youtube",
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://www.youtube.com/playlist?list=PL123abc",
      "youtube",
      "list:PL123abc",
      "https://www.youtube.com/playlist?list=PL123abc",
    ],
    ["https://vimeo.com/1222049983", "vimeo", "1222049983", "https://vimeo.com/1222049983"],
    [
      "https://player.vimeo.com/video/1222049983",
      "vimeo",
      "1222049983",
      "https://vimeo.com/1222049983",
    ],
    [
      "https://nebula.tv/videos/why-the-sky-is-blue",
      "nebula",
      "why-the-sky-is-blue",
      "https://nebula.tv/videos/why-the-sky-is-blue",
    ],
    ["nebula.app/videos/Some-Slug", "nebula", "some-slug", "https://nebula.tv/videos/some-slug"],
    [
      "https://archive.org/details/his_girl_friday",
      "internet_archive",
      "his_girl_friday",
      "https://archive.org/details/his_girl_friday",
    ],
    [
      "https://www.dailymotion.com/video/x8abcde",
      "dailymotion",
      "x8abcde",
      "https://www.dailymotion.com/video/x8abcde",
    ],
    [
      "https://www.dailymotion.com/playlist/x7z3jt",
      "dailymotion",
      "playlist:x7z3jt",
      "https://www.dailymotion.com/playlist/x7z3jt",
    ],
    ["https://www.twitch.tv/nasa", "twitch", "channel:nasa", "https://www.twitch.tv/nasa"],
    [
      "https://www.twitch.tv/videos/1234567890",
      "twitch",
      "1234567890",
      "https://www.twitch.tv/videos/1234567890",
    ],
  ])("parses %s", (url, provider, contentId, canonical) => {
    const ref = parseWatchUrl(url);
    expect(ref?.provider).toBe(provider);
    expect(ref?.contentId).toBe(contentId);
    expect(ref?.canonicalUrl).toBe(canonical);
  });

  it("refuses malformed and unsupported links", () => {
    for (const raw of [
      "",
      "not a url",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "https://www.tiktok.com/@someone/video/123",
      "https://www.youtube.com/@handle",
      "https://nebula.tv/some-creator",
      "https://nebula.tv/videos/",
      "https://vimeo.com/channels/staffpicks",
      "https://www.twitch.tv/directory",
      "javascript:alert(1)",
    ]) {
      expect(parseWatchUrl(raw), raw).toBeNull();
    }
  });

  it("round-trips a stored content id back to its page and its player", () => {
    for (const id of WATCH_PROVIDER_IDS) {
      const p = WATCH_PROVIDERS[id];
      expect(providerFor(id)).toBe(p);
      expect(p.capabilities.metadata).toBeDefined();
    }
    expect(WATCH_PROVIDERS.youtube.playable("dQw4w9WgXcQ", "x")).toEqual({
      kind: "video",
      videoId: "dQw4w9WgXcQ",
      name: "x",
    });
    expect(WATCH_PROVIDERS.youtube.playable("list:PL1", "x")).toEqual({
      kind: "playlist",
      list: "PL1",
      name: "x",
    });
    expect(WATCH_PROVIDERS.vimeo.playable("1222049983", "x")?.kind).toBe("embed");
    expect(WATCH_PROVIDERS.internet_archive.playable("his_girl_friday", "x")?.kind).toBe("embed");
    expect(WATCH_PROVIDERS.twitch.playable("channel:nasa", "x")?.kind).toBe("embed");
    expect(WATCH_PROVIDERS.dailymotion.playable("playlist:x7z3jt", "x")?.kind).toBe("embed");
  });

  it("Nebula is link-only: no player, no metadata, the page is the mechanism", () => {
    const n = WATCH_PROVIDERS.nebula;
    expect(n.capabilities.embed).toBe(false);
    expect(n.capabilities.metadata).toBe("none");
    expect(n.playable("why-the-sky-is-blue", "x")).toBeNull();
    expect(n.pageUrl("why-the-sky-is-blue")).toBe("https://nebula.tv/videos/why-the-sky-is-blue");
    expect(titleFromSlug("why-the-sky-is-blue")).toBe("Why the sky is blue");
  });

  it("names the four providers the mission locked, and no TikTok", () => {
    expect(WATCH_PROVIDER_IDS).toEqual(
      expect.arrayContaining(["youtube", "vimeo", "nebula", "internet_archive"]),
    );
    expect(WATCH_PROVIDER_IDS).not.toContain("tiktok");
    expect(providerFor("tiktok")).toBeNull();
  });

  it("only the Archive carries rights metadata", () => {
    for (const id of WATCH_PROVIDER_IDS) {
      expect(WATCH_PROVIDERS[id].capabilities.rights).toBe(id === "internet_archive");
    }
  });
});
