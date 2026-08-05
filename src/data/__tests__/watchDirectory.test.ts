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

  it("no YouTube embed or IFrame player survives", () => {
    const offenders: string[] = [];
    for (const p of sourceFiles) {
      const code = codeOf(p);
      if (
        /youtube[^"'`\s]*\/embed\/|live_stream\?|iframe_api|YT\.Player|onYouTubeIframeAPIReady/.test(
          code,
        )
      ) {
        offenders.push(p.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no thumbnail is taken from the destination", () => {
    const offenders = sourceFiles.filter((p) => /ytimg\.com/.test(codeOf(p)));
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("the CSP no longer permits a YouTube frame or script", () => {
    // Belt and braces: even if a component tried, the browser would refuse.
    const headers = readFileSync(join(ROOT, "public/_headers"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    const csp = headers.match(/Content-Security-Policy:([^\n]*)/)?.[1] ?? "";
    expect(csp, "no CSP found").not.toBe("");
    const frameSrc = csp.match(/frame-src([^;]*)/)?.[1] ?? "";
    const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? "";
    expect(frameSrc).not.toMatch(/youtube/i);
    expect(scriptSrc).not.toMatch(/youtube|ytimg/i);
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

  it("labels the link-out so nothing implies in-app playback", () => {
    expect(LINK_OUT_LABEL.toLowerCase()).toContain("opens in");
    expect(WATCH_NOTICE.toLowerCase()).toContain("does not play");
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

  it("the home screen has no Watch tile or stream preview at all", () => {
    const src = readFileSync(join(ROOT, "src/routes/_authenticated/app.index.tsx"), "utf8");
    expect(src).not.toMatch(/livePreview|loadYouTubeApi|useLiveGenres/);
    expect(src).not.toMatch(/"watch"/);
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

  it("never leaves a viewer on a genre chip that leads nowhere", () => {
    // The earlier version of the test above checked only the total per
    // country, which passed while entertainment and finance were empty in
    // every country except India — both rosters are India-scoped. A directory
    // that renders a tab and then says "nothing listed here yet" is worse than
    // not rendering the tab, so the surface drops empty built-in genres and
    // this pins that it has to.
    const surface = readFileSync(join(ROOT, "src/components/landing/LiveNewsSection.tsx"), "utf8");
    expect(surface, "empty built-in genres are no longer filtered out").toMatch(
      /\.filter\(\(s\) => s\.links\.length > 0\)/,
    );
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
