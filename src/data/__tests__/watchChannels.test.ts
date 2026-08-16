/**
 * Watch: territorial axis + YouTube embed compliance.
 *
 * Origin: `live-channels` resolved a channel's live video by regex-ing
 * https://www.youtube.com/channel/<id>/live — forbidden by YouTube's ToS — and
 * Watch had no region axis, so ONIQ served whatever stream that returned to
 * whoever asked. Sourcing by a forbidden method AND ignoring territory is a
 * worse pairing than either alone.
 *
 * These tests fail if the scrape returns, if the quota trap is reintroduced,
 * or if the embed grant is voided by an overlay or an undersized player.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  WATCH_CHANNELS,
  YT_MIN_PLAYER_PX,
  liveEmbedUrl,
  watchChannelsFor,
} from "@/data/watchChannels";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** Code lines only — a URL inside a comment explaining why we avoid it is fine. */
function codeLines(): { path: string; line: number; text: string }[] {
  const out: { path: string; line: number; text: string }[] = [];
  for (const file of [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase"))]) {
    // Skip EVERY test file, not just this one. Restoring this suite on
    // 2026-08-16 immediately flagged watchDirectory.test.ts, which names
    // hlsManifestUrl in order to forbid it — a test naming a forbidden
    // pattern is not a violation of it, and the newer suite already carries
    // this same exclusion for the same reason.
    if (file.includes("__tests__")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
        const t = text.trimStart();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        out.push({ path: file.slice(ROOT.length + 1), line: i + 1, text });
      });
  }
  return out;
}

describe("YouTube is not scraped", () => {
  const lines = codeLines();

  it.each([
    ["fetches a channel's /live HTML", /youtube\.com\/channel\/[^"'`]*\/live/],
    ["fetches a @handle page", /fetchText\(\s*[`"']https:\/\/www\.youtube\.com\/@/],
    ['regexes "channelId" out of markup', /html\s*\.?\s*match\([^)]*channelId/],
    ["extracts hlsManifestUrl / a stream URL", /hlsManifestUrl|streamingData|player_response/],
  ])("never %s", (_label, pattern) => {
    const hits = lines.filter((l) => pattern.test(l.text)).map((l) => `${l.path}:${l.line}`);
    expect(hits).toEqual([]);
  });

  it("never calls search.list — 100 units would drain the free daily quota", () => {
    const hits = lines
      .filter((l) => /youtube\/v3\/search|search\.list/.test(l.text))
      .map((l) => `${l.path}:${l.line}`);
    expect(hits).toEqual([]);
  });
});

describe("live embed", () => {
  it("uses YouTube's official channel-live endpoint, so quota is not consumed", () => {
    const url = liveEmbedUrl("UCknLrEdhRCp1aegoMqRaCZg");
    expect(url.startsWith("https://www.youtube.com/embed/live_stream?")).toBe(true);
    expect(url).toContain("channel=UCknLrEdhRCp1aegoMqRaCZg");
  });

  it("does not autoplay a broadcaster's stream on the user's behalf", () => {
    expect(liveEmbedUrl("UCtest")).not.toContain("autoplay=1");
  });

  it("never embeds an unverified channel id", () => {
    for (const c of ALL_COUNTRIES) {
      for (const ch of watchChannelsFor(c)) expect(ch.verified).toBe(true);
    }
  });
});

describe("territorial axis", () => {
  it("offers only worldwide public-service streams when region is unknown", () => {
    const none = watchChannelsFor(null);
    expect(none.length).toBeGreaterThan(0);
    for (const c of none) expect(c.countries).toBe("*");
  });

  it("never leaks a territory-scoped channel into another region", () => {
    for (const region of ALL_COUNTRIES) {
      for (const ch of watchChannelsFor(region)) {
        if (ch.countries === "*") continue;
        expect(ch.countries, `${ch.name} leaked into ${region}`).toContain(region);
      }
    }
  });

  it("gives every region something to watch", () => {
    for (const c of ALL_COUNTRIES) {
      expect(watchChannelsFor(c).length, `${c} has nothing`).toBeGreaterThan(0);
    }
  });

  it("keeps Sky News out of India and NDTV out of Great Britain", () => {
    const inNames = watchChannelsFor("IN").map((c) => c.name);
    const gbNames = watchChannelsFor("GB").map((c) => c.name);
    expect(inNames).not.toContain("Sky News");
    expect(gbNames).not.toContain("NDTV 24x7");
    // ...while the worldwide PSBs reach both.
    expect(inNames).toContain("DW News");
    expect(gbNames).toContain("DW News");
  });
});

describe("embed grant is not voided", () => {
  it("declares a minimum player size of at least 200px", () => {
    expect(YT_MIN_PLAYER_PX).toBeGreaterThanOrEqual(200);
  });

  it("renders nothing in front of the player, on any screen that mounts it", () => {
    // Same rule, third address. The mount lived in LiveNewsSection, then in
    // the Watch route, and is now the shared <WatchPlayer> used by both Watch
    // and the Home banner loop. What is checked is unchanged and is a
    // condition of the embed grant: no sibling may be positioned over the
    // frame — badges, gradients and transport rows go above or below it.
    //
    // The player's own box is `relative` and the mount inside it is
    // `absolute inset-0`; anything ELSE absolutely positioned inside that box
    // would sit on top, so the scan is for a second absolute child.
    for (const screen of [
      "src/routes/_authenticated/app.watch.tsx",
      "src/routes/_authenticated/app.index.tsx",
    ]) {
      const src = readFileSync(join(ROOT, screen), "utf8");
      const mountIdx = src.indexOf("<WatchPlayer");
      if (mountIdx < 0) continue;
      // The enclosing frame box starts at the nearest preceding `relative`
      // container and ends at the mount's closing `/>`.
      const boxIdx = src.lastIndexOf("<div", src.lastIndexOf("relative", mountIdx));
      const box = src.slice(boxIdx, mountIdx);
      // One `absolute inset-0` is allowed in the box before the mount: the
      // empty state, which REPLACES the player rather than covering it (it
      // only renders when there is no player). Anything beyond that is an
      // overlay.
      const absolutes = box.match(/\babsolute\b/g) ?? [];
      expect(
        absolutes.length,
        `${screen}: ${absolutes.length} absolutely positioned nodes share the player's box`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("stores no stream URL", () => {
    for (const ch of WATCH_CHANNELS) {
      const blob = JSON.stringify(ch);
      expect(blob).not.toMatch(/m3u8|manifest|googlevideo|videoplayback/);
    }
  });
});
