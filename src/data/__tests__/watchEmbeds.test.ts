/**
 * OTHER PLATFORMS' PLAYERS — owner directive, 2026-09-03 (afternoon): "make
 * them just like we have youtube in watch, also include them in watch tab of
 * home screen".
 *
 * What is pinned is the line that did not move when four more players were
 * framed: every frame points at the platform's own player and nowhere else,
 * no stream URL is built, no SDK script is loaded, every player host is
 * declared, and a pasted link is parsed rather than resolved.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THIRD_PARTY_REQUESTS } from "@/config/playCompliance";
import { WATCH_ENTRIES, channelUrl, platformNameOf, playableOf } from "@/data/watchDirectory";
import {
  EMBED_HOSTS,
  EMBED_PLATFORM_NAME,
  embedKey,
  embedPageUrl,
  embedSrc,
  isLiveEmbed,
  isValidEmbedRef,
  parseEmbedLink,
  type EmbedRef,
} from "@/data/watchEmbeds";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(p)) out.push(p);
  }
  return out;
}

function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const sourceFiles = walk(join(ROOT, "src")).filter((p) => !p.includes("__tests__"));

const REFS: EmbedRef[] = [
  { platform: "vimeo", video: "123456789" },
  { platform: "dailymotion", video: "x8abcde" },
  { platform: "dailymotion", playlist: "x7z3jt" },
  { platform: "twitch", channel: "nasa" },
  { platform: "twitch", video: "1234567890" },
  { platform: "archive", item: "his_girl_friday" },
];
const OPTS = { autoplay: true, muted: true, host: "oniqhub.com" };

function cspDirective(name: string): string {
  const headers = readFileSync(join(ROOT, "public/_headers"), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const csp = headers.match(/Content-Security-Policy:([^\n]*)/)?.[1] ?? "";
  return csp.match(new RegExp(`${name}([^;]*)`))?.[1] ?? "";
}

describe("every frame points at the platform's own player, and nowhere else", () => {
  it("builds a src on the declared host for every shape of ref", () => {
    for (const r of REFS) {
      const u = new URL(embedSrc(r, OPTS));
      expect(u.protocol).toBe("https:");
      expect(u.host, embedKey(r)).toBe(EMBED_HOSTS[r.platform]);
    }
  });

  it("never builds a stream URL", () => {
    for (const r of REFS) {
      expect(embedSrc(r, OPTS)).not.toMatch(/m3u8|googlevideo|videoplayback|manifest|\.mp4/i);
    }
  });

  it("gives Twitch the embedding host as parent, which its player requires", () => {
    expect(embedSrc({ platform: "twitch", channel: "nasa" }, OPTS)).toContain("parent=oniqhub.com");
  });

  it("asks Vimeo not to track the viewer", () => {
    expect(embedSrc({ platform: "vimeo", video: "123456789" }, OPTS)).toContain("dnt=1");
  });

  it("does not autoplay the Archive's player, which cannot be muted", () => {
    expect(embedSrc({ platform: "archive", item: "x" }, OPTS)).not.toMatch(/autoplay/);
  });

  it("autoplays muted only when asked, everywhere else", () => {
    expect(embedSrc({ platform: "vimeo", video: "123456789" }, OPTS)).toContain(
      "autoplay=1&muted=1",
    );
    expect(
      embedSrc({ platform: "vimeo", video: "123456789" }, { ...OPTS, autoplay: false }),
    ).toContain("autoplay=0");
    expect(embedSrc({ platform: "twitch", channel: "nasa" }, OPTS)).toContain("muted=true");
  });

  it("links to the thing's own page on its own platform", () => {
    const hosts = REFS.map((r) => new URL(embedPageUrl(r)).host);
    expect(hosts).toEqual([
      "vimeo.com",
      "www.dailymotion.com",
      "www.dailymotion.com",
      "www.twitch.tv",
      "www.twitch.tv",
      "archive.org",
    ]);
  });

  it("keys are distinct per ref and stable", () => {
    const keys = REFS.map(embedKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(embedKey({ platform: "twitch", channel: "nasa" })).toBe("twitch:c:nasa");
  });

  it("knows which refs are live feeds", () => {
    expect(isLiveEmbed({ platform: "twitch", channel: "nasa" })).toBe(true);
    expect(isLiveEmbed({ platform: "dailymotion", video: "xar7p26", live: true })).toBe(true);
    expect(isLiveEmbed({ platform: "dailymotion", video: "x8abcde" })).toBe(false);
    expect(isLiveEmbed({ platform: "vimeo", video: "123456789" })).toBe(false);
    expect(isLiveEmbed({ platform: "archive", item: "x" })).toBe(false);
  });
});

describe("a pasted link is parsed, never resolved", () => {
  it.each<[string, EmbedRef]>([
    ["https://vimeo.com/123456789", { platform: "vimeo", video: "123456789" }],
    ["vimeo.com/channels/staffpicks/123456789", { platform: "vimeo", video: "123456789" }],
    ["https://player.vimeo.com/video/123456789?h=abc", { platform: "vimeo", video: "123456789" }],
    ["https://www.dailymotion.com/video/x8abcde", { platform: "dailymotion", video: "x8abcde" }],
    [
      "https://www.dailymotion.com/video/x8abcde_some-title",
      { platform: "dailymotion", video: "x8abcde" },
    ],
    ["https://dai.ly/x8abcde", { platform: "dailymotion", video: "x8abcde" }],
    [
      "https://www.dailymotion.com/playlist/x7z3jt",
      { platform: "dailymotion", playlist: "x7z3jt" },
    ],
    ["https://www.twitch.tv/NASA", { platform: "twitch", channel: "nasa" }],
    ["https://m.twitch.tv/chess", { platform: "twitch", channel: "chess" }],
    ["https://www.twitch.tv/videos/1234567890", { platform: "twitch", video: "1234567890" }],
    ["https://player.twitch.tv/?channel=nasa&parent=x", { platform: "twitch", channel: "nasa" }],
    [
      "https://archive.org/details/his_girl_friday",
      { platform: "archive", item: "his_girl_friday" },
    ],
    ["https://archive.org/embed/his_girl_friday", { platform: "archive", item: "his_girl_friday" }],
  ])("parses %s", (url, expected) => {
    expect(parseEmbedLink(url)).toEqual(expected);
  });

  it("refuses pages that are not something to play, and anything it cannot read", () => {
    for (const raw of [
      "https://www.twitch.tv/directory",
      "https://www.twitch.tv/",
      "https://vimeo.com/channels/staffpicks",
      "https://vimeo.com/watch",
      "https://www.dailymotion.com/euronews-en",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.facebook.com/watch/",
      "not a url",
      "",
    ]) {
      expect(parseEmbedLink(raw), raw).toBeNull();
    }
  });

  it("refuses an id that is not the shape the platform issues", () => {
    expect(isValidEmbedRef({ platform: "vimeo", video: "abc" })).toBe(false);
    expect(isValidEmbedRef({ platform: "twitch", channel: "directory" })).toBe(false);
    expect(isValidEmbedRef({ platform: "archive", item: "../etc" })).toBe(false);
    expect(isValidEmbedRef({ platform: "dailymotion", playlist: "x7z3jt" })).toBe(true);
  });
});

describe("the CSP frames exactly these players and loads none of their scripts", () => {
  it("grants frame-src to every player host", () => {
    const frameSrc = cspDirective("frame-src");
    for (const h of Object.values(EMBED_HOSTS)) {
      expect(frameSrc, `${h} is not framed`).toContain(`https://${h}`);
    }
  });

  it("widens script-src for none of them — ENDED rides postMessage, not an SDK", () => {
    const scriptSrc = cspDirective("script-src");
    for (const h of ["vimeo.com", "dailymotion.com", "twitch.tv", "archive.org"]) {
      expect(scriptSrc, `${h} script is allowed`).not.toContain(h);
    }
  });

  it("loads no platform SDK anywhere in the source", () => {
    const offenders = sourceFiles.filter((p) =>
      /player\.vimeo\.com\/api\/player\.js|dailymotion\.com\/libs\/player|player\.twitch\.tv\/js\/embed|embed\.twitch\.tv/.test(
        codeOf(p),
      ),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("builds a player URL in one file only", () => {
    const offenders = sourceFiles.filter((p) =>
      /player\.vimeo\.com\/video|geo\.dailymotion\.com\/player\.html|player\.twitch\.tv\/\?|archive\.org\/embed\//.test(
        codeOf(p),
      ),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual(["src/data/watchEmbeds.ts"]);
  });

  it("declares every player host as an automatic request", () => {
    const declared = THIRD_PARTY_REQUESTS.map((r) => r.host);
    for (const h of Object.values(EMBED_HOSTS)) {
      expect(declared, `${h} is undeclared`).toContain(h);
    }
  });

  it("the shared player frames an embed and reports it through the same handle", () => {
    const src = codeOf(join(ROOT, "src/components/watch/WatchPlayer.tsx"));
    expect(src).toContain('kind === "embed"');
    expect(src).toContain("embedSrc(");
    expect(src).toContain("listenForEmbedEnded(");
    // The frame's src comes from the module above, never assembled here.
    expect(src, "the player hand-builds a platform URL").not.toMatch(
      /https:\/\/[^"'`]*(vimeo|dailymotion|twitch|archive\.org)/,
    );
  });
});

describe("directory cards from other platforms", () => {
  const embedded = WATCH_ENTRIES.filter((e) => e.embed);

  it("has at least one card per playable platform, each with a well-formed id", () => {
    for (const platform of Object.keys(EMBED_HOSTS) as (keyof typeof EMBED_HOSTS)[]) {
      const mine = embedded.filter((e) => e.embed?.platform === platform);
      expect(mine.length, `no ${EMBED_PLATFORM_NAME[platform]} card`).toBeGreaterThan(0);
      for (const e of mine) {
        expect(isValidEmbedRef(e.embed as EmbedRef), `${e.name} has a malformed id`).toBe(true);
      }
    }
  });

  it("never carries a YouTube id as well — one platform per card", () => {
    for (const e of embedded) {
      expect(e.channelId, e.name).toBeUndefined();
      expect(e.handle, e.name).toBeUndefined();
    }
  });

  it("plays as an embed, names its platform, and links to its own page there", () => {
    for (const e of embedded) {
      const p = playableOf(e);
      expect(p?.kind, e.name).toBe("embed");
      expect(platformNameOf(p as NonNullable<typeof p>)).toBe(
        EMBED_PLATFORM_NAME[(e.embed as EmbedRef).platform],
      );
      const url = channelUrl(e);
      expect(url, e.name).toBeTruthy();
      expect(new URL(url as string).host, e.name).not.toMatch(/youtu/);
    }
  });

  it("no two cards play the same thing", () => {
    const keys = embedded.map((e) => embedKey(e.embed as EmbedRef));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("the Films genre exists and is fed by the Archive", () => {
    const films = WATCH_ENTRIES.filter((e) => e.genre === "film");
    expect(films.length).toBeGreaterThanOrEqual(5);
    expect(films.some((e) => e.embed?.platform === "archive")).toBe(true);
  });
});
