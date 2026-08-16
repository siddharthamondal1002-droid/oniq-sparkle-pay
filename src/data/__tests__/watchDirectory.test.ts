/**
 * NO LIVE CHANNELS — the tests assert an ABSENCE.
 *
 * The suite this replaces (watchChannels.test.ts) checked that ONIQ embedded
 * correctly: minimum player size, nothing rendered in front of the player, no
 * stream URL stored. Every one of those was a condition on a permission ONIQ
 * no longer relies on.
 *
 * The interesting property now is that no player exists at all, anywhere, in
 * any country. That cannot be checked by looking at a component's props — it
 * has to be checked by sweeping the source, because the failure mode is
 * somebody adding an embed back in six months' time in a file nobody thought
 * to look at.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  FAITH_ENTRIES,
  LINK_OUT_LABEL,
  WATCH_ENTRIES,
  WATCH_NOTICE,
  channelUrl,
  faithChannelsFor,
  watchDirectoryFor,
} from "@/data/watchDirectory";
import type { FaithId } from "@/data/faithContent";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|html)$/.test(p)) out.push(p);
  }
  return out;
}

// Source files, excluding tests — a test naming a forbidden pattern in order
// to forbid it is not a violation of it. That false positive has bitten this
// codebase before.
const sourceFiles = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase"))].filter(
  (p) => !p.includes("__tests__"),
);

/** Code lines only. A comment saying "we do not scrape" must not read as a scrape. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("nothing streams, embeds, proxies or resolves — anywhere", () => {
  it("no file resolves a live video by scraping a channel page", () => {
    // The original ToS breach: fetch youtube.com/channel/<id>/live, regex the
    // markup for a video id.
    const offenders = sourceFiles.filter((p) =>
      /youtube\.com\/(channel\/[^"'`\s]*\/live|@[^"'`\s]*)["'`\s]*\)/.test(codeOf(p)),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("no file extracts a stream manifest or stream URL", () => {
    const offenders: string[] = [];
    for (const p of sourceFiles) {
      if (/hlsManifestUrl|m3u8|videoplayback|googlevideo|url_resolved|streamUrl/i.test(codeOf(p))) {
        offenders.push(p.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * THE LINE MOVED, 2026-08-16 (evening). It did not disappear.
   *
   * The owner brought the player back, so an embed is no longer the thing to
   * forbid — this suite used to ban `/embed/` outright and that ban is gone.
   * What replaces it is the distinction the embed rests on: YouTube's OWN
   * player, framed, versus ONIQ resolving a stream and serving it itself.
   * The first is a supported use of their player. The second is what the
   * retired `live-channels` function did, with a spoofed User-Agent and a
   * consent cookie, and it is still forbidden.
   */
  it("drives no player of its own — the IFrame Player API stays out", () => {
    // The API is how a page controls playback programmatically. Nothing here
    // needs to, and loading it would widen what ONIQ can do with somebody
    // else's video from "show it" to "operate it".
    const offenders: string[] = [];
    for (const p of sourceFiles) {
      const code = codeOf(p);
      if (/iframe_api|YT\.Player|onYouTubeIframeAPIReady/.test(code)) {
        offenders.push(p.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("resolves, stores and proxies no stream URL", () => {
    // The actual risk, and the reason live-channels was retired. A googlevideo
    // host or a manifest is what you get from scraping the watch page; none of
    // it should exist anywhere in the source.
    const offenders: string[] = [];
    for (const p of sourceFiles) {
      const code = codeOf(p);
      if (/googlevideo\.com|get_video_info|player_response|hlsManifestUrl|\.m3u8/.test(code)) {
        offenders.push(p.slice(ROOT.length + 1));
      }
    }
    expect(offenders, "a stream URL is being resolved or stored").toEqual([]);
  });

  it("embeds only from the privacy-enhanced origin, and only one shape of URL", () => {
    const dir = codeOf(join(ROOT, "src/data/watchDirectory.ts"));
    expect(dir).toContain("youtube-nocookie.com/embed/videoseries");
    // The uploads playlist is derived, never a stored per-video id, so there
    // is nothing to go stale and nothing that pins a specific broadcast.
    expect(dir).toMatch(/UU\$\{.*channelId\.slice\(2\)\}/);
    // No autoplay: a directory that starts making noise on open is a bug.
    expect(dir).not.toMatch(/autoplay=1/);
  });

  it("no thumbnail is taken from the destination", () => {
    const offenders = sourceFiles.filter((p) => /ytimg\.com/.test(codeOf(p)));
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("the CSP permits the FRAME and still refuses the SCRIPT", () => {
    // The asymmetry is the point and it is easy to lose. frame-src has to
    // allow the embed or the browser refuses to render it. script-src must
    // stay closed: those hosts serve the IFrame Player API, and leaving them
    // out means an attempt to drive playback fails loudly rather than
    // quietly widening what the app does with somebody else's video.
    const headers = readFileSync(join(ROOT, "public/_headers"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    const csp = headers.match(/Content-Security-Policy:([^\n]*)/)?.[1] ?? "";
    expect(csp, "no CSP found").not.toBe("");
    const frameSrc = csp.match(/frame-src([^;]*)/)?.[1] ?? "";
    const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? "";
    expect(frameSrc, "the embed origin is not framed").toContain("youtube-nocookie.com");
    expect(scriptSrc, "the IFrame Player API is loadable again").not.toMatch(/youtube|ytimg/i);
  });

  it("the retired live-channels edge function is gone, not just unused", () => {
    let exists = true;
    try {
      statSync(join(ROOT, "supabase/functions/live-channels"));
    } catch {
      exists = false;
    }
    expect(exists, "supabase/functions/live-channels still exists").toBe(false);
  });

  it("no edge function disguises itself as a real browser", () => {
    // The camouflage was a full desktop-Chrome token plus Google's consent
    // cookie, so a scrape would be served the same markup a person gets.
    //
    // NOT flagged: "Mozilla/5.0 (compatible; ONIQ-News/1.0)". That is the
    // conventional self-identifying bot form — it names ONIQ, and every feed
    // publisher can see exactly who is calling. The first version of this test
    // matched bare "Mozilla/5.0" and reported it, which was wrong.
    const offenders: string[] = [];
    for (const p of sourceFiles.filter((f) => f.includes("supabase/functions"))) {
      const code = codeOf(p);
      if (/AppleWebKit\/|Chrome\/\d|Safari\/\d|CONSENT=YES/.test(code)) {
        offenders.push(p.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every entry is a link that leaves the app", () => {
  it("builds an https URL for every listed channel", () => {
    for (const e of WATCH_ENTRIES) {
      const url = channelUrl(e);
      expect(url, `${e.name} has neither a channel id nor a handle`).toBeTruthy();
      expect(url!).toMatch(/^https:\/\/www\.youtube\.com\//);
    }
    for (const e of FAITH_ENTRIES) {
      expect(channelUrl(e)!).toMatch(/^https:\/\/www\.youtube\.com\/channel\/UC/);
    }
  });

  it("says what is true now — hosting, not playing, is what ONIQ disclaims", () => {
    // The notice used to say "ONIQ does not play or host any of this", which
    // stopped being true the moment an embed rendered. A notice that is no
    // longer true is worse than no notice, so the claim narrowed to the one
    // that still holds: the bytes are YouTube's, and so is the player.
    expect(LINK_OUT_LABEL.toLowerCase()).toContain("opens in");
    expect(WATCH_NOTICE.toLowerCase()).not.toContain("does not play");
    expect(WATCH_NOTICE.toLowerCase()).toContain("hosts none of this");
    expect(WATCH_NOTICE.toLowerCase()).toContain("youtube");
  });

  it("the Watch surface is gone entirely — only the faith directory consumes this data", () => {
    let exists = true;
    try {
      statSync(join(ROOT, "src/components/landing/LiveNewsSection.tsx"));
    } catch {
      exists = false;
    }
    expect(exists, "the Watch surface still exists").toBe(false);
  });

  it("the faith surface renders link rows, with no iframe and no audio element", () => {
    const path = join(ROOT, "src/routes/_authenticated/app.faith.tsx");
    expect(readFileSync(path, "utf8")).toMatch(/openInApp/);
    // codeOf, not the raw file: the tombstone comment in that file says what
    // it no longer does, and naming `new Audio()` in order to record its
    // removal must not read as a use of it.
    expect(codeOf(path)).not.toMatch(/<iframe|new Audio\(/);
  });

  it("the public landing page does not advertise Watch", () => {
    // Watch was removed from the app entirely. The landing page kept selling
    // it in three places — a feature card, a "world" card and a chip in the
    // phone mockup — which is the same advertise-what-you-do-not-ship problem
    // the live-TV copy had, just reintroduced by the removal itself.
    const landing = readFileSync(join(ROOT, "src/routes/index.tsx"), "utf8");
    expect(landing, "landing page still mentions Watch").not.toMatch(/\bWatch\b/);
  });

  it("the home screen has no stream preview, and its Watch tile only links", () => {
    // THE TILE CAME BACK, THE PLAYER DID NOT (owner directive, 2026-08-16).
    //
    // This used to forbid the string "watch" on Home outright, as a proxy for
    // "no Watch surface exists". The owner resurfaced the directory, so the
    // proxy is retired and the real property is asserted directly: Home may
    // point AT Watch, and must still carry no player machinery of its own.
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/app.index.tsx"), "utf8");
    expect(src).not.toMatch(/livePreview|loadYouTubeApi|useLiveGenres/);
    // If the tile is there at all it goes to the directory route, not to an
    // embed, a channel id, or a stream.
    if (/\{ key: "watch"/.test(src)) {
      expect(src).toMatch(/\{ key: "watch", to: "\/app\/watch" \}/);
    }
  });

  it("the Watch screen plays in YouTube's frame, on a tap, and stays India-gated", () => {
    const src = codeOf(join(ROOT, "src/routes/_authenticated/app.watch.tsx"));
    // The player is an iframe whose src comes from the shared helper — not a
    // URL assembled here, where it could quietly grow a different shape.
    expect(src).toContain("<iframe");
    expect(src).toContain("embedUrl(entry)");
    expect(src, "the screen builds its own YouTube URL").not.toMatch(/https:\/\/[^"'`]*youtube/);
    // No <video> of ONIQ's own: that is the shape that needs a resolved
    // stream, which is the thing that must never come back.
    expect(src, "a native video element implies a resolved stream").not.toMatch(/<video/);
    // Nothing is drawn over the frame — a condition of using the embed, and
    // exactly what a later "improvement" breaks by accident.
    expect(src).not.toMatch(/absolute[^"'`]*z-\d+[^"'`]*"\s*\/>\s*<\/div>\s*<\/div>\s*<iframe/);
    // Handle-only entries cannot have a playlist derived, so they stay links.
    expect(src).toContain("canPlay");
    // The gate lives in the registry so the tile and the route cannot drift.
    expect(src).toContain('isAvailable("watch", home)');
    // And the notice the whole posture rests on is actually shown.
    expect(src).toContain("WATCH_NOTICE");
  });

  it("declares the embed as an automatic request again", () => {
    // The declaration was REMOVED when Watch became links, on the reasoning
    // that a tapped destination is not a request ONIQ makes. That reasoning
    // stops holding the moment a frame renders in-app, so the entry comes
    // back with the player. A feature that reaches Google undeclared is the
    // Play problem this file exists to prevent.
    const compliance = readFileSync(join(ROOT, "src/config/playCompliance.ts"), "utf8");
    expect(compliance).toContain('host: "www.youtube-nocookie.com"');
    expect(compliance).toMatch(/triggeredBy:[\s\S]{0,120}Tapping a channel in Watch/);
  });

  it("Watch is registered India-only, so it cannot leak onto every Home", () => {
    // isAvailable() answers TRUE for an unregistered id, so an unregistered
    // "watch" would render everywhere the moment it reached Home — the exact
    // trap the `upi` entry was added to avoid.
    const reg = readFileSync(join(ROOT, "src/data/countryRegistry.ts"), "utf8");
    expect(reg).toMatch(/\{ id: "watch", supportedCountries: \["IN"\] \}/);
  });
});

describe("region is relevance, not a rights gate", () => {
  it("shows the whole directory when the region is unknown", () => {
    // Under the embed model this failed CLOSED — an unknown region meant no
    // territorial basis, so only worldwide streams were offered. A link needs
    // no territorial basis, so withholding one helps nobody.
    const unknown = watchDirectoryFor(null);
    expect(unknown.length).toBe(WATCH_ENTRIES.filter((e) => e.verified).length);
  });

  it("still narrows to what is useful when the region is known", () => {
    const sg = watchDirectoryFor("SG", "news").map((e) => e.name);
    expect(sg).toContain("CNA");
    expect(sg).toContain("Al Jazeera English"); // worldwide
    expect(sg).not.toContain("Sky News"); // GB-scoped, not useful in SG
  });

  it("offers something in every country", () => {
    for (const c of ALL_COUNTRIES) {
      expect(watchDirectoryFor(c).length, `${c} has an empty directory`).toBeGreaterThan(0);
    }
  });

  it("every country keeps at least news, sports and influencer", () => {
    // The genres that must survive the filter everywhere, so no country is
    // left with a one-chip Watch screen.
    for (const c of ALL_COUNTRIES) {
      for (const g of ["news", "sports", "influencer"] as const) {
        expect(watchDirectoryFor(c, g).length, `${c}/${g} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("hides unverified entries, because a bad id links to the wrong channel", () => {
    expect(watchDirectoryFor(null).every((e) => e.verified)).toBe(true);
    expect(faithChannelsFor("jain").every((e) => e.verified)).toBe(true);
  });
});

describe("faith isolation holds — strict equality, own empty state", () => {
  const FAITHS: FaithId[] = ["islamic", "sikh", "hindu", "christian", "buddhist", "jain", "jewish"];

  it("returns only the asked-for faith, never another", () => {
    for (const f of FAITHS) {
      const got = faithChannelsFor(f);
      expect(got.length, `${f} has no channels`).toBeGreaterThan(0);
      expect(
        got.every((e) => e.faith === f),
        `${f} leaked another faith`,
      ).toBe(true);
    }
  });

  it("returns nothing rather than a default list when no faith is chosen", () => {
    expect(faithChannelsFor(null)).toEqual([]);
  });

  it("forced miss: an unknown faith yields its own empty state, not a fallback", () => {
    expect(faithChannelsFor("zoroastrian" as FaithId)).toEqual([]);
  });

  it("keeps the full Jain roster that the bleed bug was found on", () => {
    const jain = faithChannelsFor("jain").map((e) => e.name);
    for (const n of [
      "Jinvani Channel",
      "Terapanth",
      "Vitraag Jain Shwetambar Sangh",
      "Jain Live",
      "Jain Darshan",
      "jainam live channel",
    ]) {
      expect(jain, `${n} missing from the Jain roster`).toContain(n);
    }
    // And nothing else got in.
    expect(jain.length).toBe(6);
  });

  it("no faith's channels appear in any other faith's list", () => {
    for (const a of FAITHS) {
      const idsA = new Set(faithChannelsFor(a).map((e) => e.channelId));
      for (const b of FAITHS) {
        if (a === b) continue;
        for (const e of faithChannelsFor(b)) {
          expect(idsA.has(e.channelId), `${e.name} appears in both ${a} and ${b}`).toBe(false);
        }
      }
    }
  });
});

describe("the directory is a directory", () => {
  it("gives every entry its own description, not a copied one", () => {
    for (const e of [...WATCH_ENTRIES, ...FAITH_ENTRIES]) {
      expect(e.description.length, `${e.name} has no description`).toBeGreaterThan(10);
    }
  });

  it("has no duplicate channel ids", () => {
    const ids = [...WATCH_ENTRIES, ...FAITH_ENTRIES]
      .map((e) => ("channelId" in e ? e.channelId : undefined))
      .filter(Boolean) as string[];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
