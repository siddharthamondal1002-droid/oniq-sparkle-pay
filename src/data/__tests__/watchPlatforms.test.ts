/**
 * OTHER PLACES TO WATCH — owner directive, 2026-09-03.
 *
 * What is pinned here is the posture more than the roster: every platform is
 * a link that opens on its own site, nothing is framed, nothing is fetched
 * from a destination, and the platforms deliberately left out stay out until
 * an owner decision says otherwise.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import { THIRD_PARTY_REQUESTS } from "@/config/playCompliance";
import { WATCH_PLATFORMS, opensIn, watchPlatformsFor } from "@/data/watchPlatforms";

const ROOT = process.cwd();
const hostOf = (url: string) => new URL(url).host.toLowerCase().replace(/^www\./, "");

/** Code lines only — a comment naming a forbidden thing is not a use of it. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the platforms are a directory of front doors", () => {
  it("names Vimeo, the platform the directive was written for, and at least six more", () => {
    const names = WATCH_PLATFORMS.map((p) => p.name);
    expect(names).toContain("Vimeo");
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  it("every entry is an https front door on the platform's own domain, not YouTube", () => {
    for (const p of WATCH_PLATFORMS) {
      const u = new URL(p.url);
      expect(u.protocol, p.name).toBe("https:");
      expect(u.host, `${p.name} points at YouTube`).not.toMatch(/youtu/);
      // A front door, not a deep link: at most two path segments.
      expect(
        u.pathname.split("/").filter(Boolean).length,
        `${p.name} is a deep link`,
      ).toBeLessThanOrEqual(2);
      expect(u.search, `${p.name} carries a query string`).toBe("");
    }
  });

  it("has unique ids, names and URLs", () => {
    for (const key of ["id", "name", "url"] as const) {
      const values = WATCH_PLATFORMS.map((p) => p[key]);
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length);
    }
  });

  it("carries ONIQ's own description and a glyph, never artwork from the destination", () => {
    for (const p of WATCH_PLATFORMS) {
      expect(p.description.length, `${p.name} has no description`).toBeGreaterThan(10);
      expect(p.emoji.length, `${p.name} has no glyph`).toBeGreaterThan(0);
      expect(p.emoji, `${p.name} glyph is a URL`).not.toMatch(/https?:/);
    }
  });

  it("labels a tap that leaves the app honestly", () => {
    expect(opensIn("Vimeo")).toBe("Opens in Vimeo");
  });
});

describe("region is relevance only, the same rule as the channel directory", () => {
  it("shows every platform when the region is unknown", () => {
    expect(watchPlatformsFor(null).length).toBe(WATCH_PLATFORMS.length);
  });

  it("keeps the Indian short-video platforms for India and drops them elsewhere", () => {
    const india = watchPlatformsFor("IN").map((p) => p.name);
    expect(india).toContain("Moj");
    expect(india).toContain("Josh");
    const britain = watchPlatformsFor("GB").map((p) => p.name);
    expect(britain).not.toContain("Moj");
    expect(britain).not.toContain("Josh");
  });

  it("offers Vimeo, and something to open, in every country", () => {
    for (const c of ALL_COUNTRIES) {
      const names = watchPlatformsFor(c).map((p) => p.name);
      expect(names, `${c} has no Vimeo`).toContain("Vimeo");
      expect(names.length, `${c} has too few platforms`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("nothing is framed, fetched or declared — a tap is not a request", () => {
  const platformHosts = WATCH_PLATFORMS.map((p) => hostOf(p.url));

  it("no platform host is declared as an automatic request, because none is made", () => {
    const declared = THIRD_PARTY_REQUESTS.map((r) => r.host.toLowerCase().replace(/^www\./, ""));
    for (const h of platformHosts) {
      expect(declared, `${h} is declared as an automatic request`).not.toContain(h);
    }
  });

  it("no platform host is granted frame-src — only YouTube's player is framed", () => {
    const headers = readFileSync(join(ROOT, "public/_headers"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    const csp = headers.match(/Content-Security-Policy:([^\n]*)/)?.[1] ?? "";
    const frameSrc = csp.match(/frame-src([^;]*)/)?.[1] ?? "";
    expect(frameSrc, "no frame-src in the CSP").not.toBe("");
    for (const h of platformHosts) {
      expect(frameSrc, `${h} is framed`).not.toContain(h);
    }
  });

  it("the Watch screen opens a platform with openInApp and builds no frame for it", () => {
    const src = codeOf(join(ROOT, "src/routes/_authenticated/app.watch.tsx"));
    expect(src).toContain("watchPlatformsFor(null)");
    expect(src).toContain('data-testid="watch-platform"');
    expect(src).toMatch(/openInApp\(p\.url\)/);
    expect(src, "the screen builds its own frame").not.toMatch(/<iframe/);
    // The platform's front door is data, not something the screen assembles.
    expect(src, "the screen hardcodes a platform URL").not.toMatch(
      /https:\/\/[^"'`]*(vimeo|dailymotion|twitch|archive\.org|facebook|instagram|mojapp|myjosh)/,
    );
  });

  it("shows the not-affiliated notice beside the platform names", () => {
    const src = codeOf(join(ROOT, "src/routes/_authenticated/app.watch.tsx"));
    expect(src).toContain("NOT_AFFILIATED_NOTICE");
  });
});

describe("the platforms deliberately left out stay out", () => {
  it("lists nothing banned in India, and nothing whose content posture ONIQ would be lending a listing", () => {
    // TikTok is banned in India, where Watch is gated. The other four are
    // free, and are exactly the platforms Play asks an app about. Adding any
    // of them is an owner decision, recorded next to this test when made.
    const blob = WATCH_PLATFORMS.map((p) => `${p.id} ${p.name} ${p.url}`)
      .join(" ")
      .toLowerCase();
    for (const left of ["tiktok", "rumble", "odysee", "bitchute", "kick.com"]) {
      expect(blob, `${left} is listed`).not.toContain(left);
    }
  });
});
