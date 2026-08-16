/**
 * My TV and user-made genres.
 *
 * These came back on 2026-08-16 with the rest of Watch, and the risk in
 * restoring them is not that they fail to work — it is that the shortcuts the
 * ORIGINAL took come back with them. Two in particular:
 *
 *   1. The `my-tv` edge function resolved a pasted @handle by fetching YouTube
 *      with a spoofed browser User-Agent and a consent cookie. It is deleted,
 *      and nothing here may fetch YouTube to turn a paste into an id.
 *   2. Every My TV card carried an <img> on i.ytimg.com. That fires for every
 *      row the moment a LIST renders, with no user decision involved — further
 *      than the embed goes, and declared as not happening.
 *
 * The caps are asserted too. They are the ORIGINAL numbers, and changing one
 * is an owner decision under CLAUDE.md rather than a tidy-up, so a diff that
 * moves them has to move a test that says so.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_CHANNELS_PER_GENRE,
  MAX_MYTV_CHANNELS,
  MAX_USER_GENRES,
  MYTV_GENRE_ID,
  USER_GENRE_PREFIX,
  channelIdFrom,
  parseYouTube,
  playableOfMyTv,
  playableOfUserChannel,
} from "@/lib/userWatch";

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

/** Code lines only — a comment naming a forbidden host is not a use of it. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const sourceFiles = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase"))].filter(
  (p) => !p.includes("__tests__"),
);

describe("a paste is read, never resolved over the network", () => {
  it("finds the channel id inside a /channel/ URL", () => {
    expect(channelIdFrom("https://www.youtube.com/channel/UCknLrEdhRCp1aegoMqRaCZg")).toBe(
      "UCknLrEdhRCp1aegoMqRaCZg",
    );
    // With trailing path and query, which is how a real copy-paste arrives.
    expect(
      channelIdFrom("https://www.youtube.com/channel/UCknLrEdhRCp1aegoMqRaCZg/videos?view=0"),
    ).toBe("UCknLrEdhRCp1aegoMqRaCZg");
  });

  it("refuses a bare @handle instead of going to look it up", () => {
    // THE WHOLE POINT. A handle carries no id, and the only ways to get one
    // are the Data API (no key on this project) or a scrape. Returning null
    // is what makes the UI say "paste the /channel/ link" rather than fetch.
    expect(channelIdFrom("@dwnews")).toBeNull();
    expect(channelIdFrom("https://www.youtube.com/@dwnews")).toBeNull();
    expect(channelIdFrom("")).toBeNull();
    expect(channelIdFrom("not a url at all")).toBeNull();
  });

  it("never calls the retired my-tv function, and that function is gone", () => {
    let exists = true;
    try {
      statSync(join(ROOT, "supabase/functions/my-tv"));
    } catch {
      exists = false;
    }
    expect(exists, "supabase/functions/my-tv is back").toBe(false);

    const callers = sourceFiles.filter((p) => /invoke\(\s*["'`]my-tv["'`]/.test(codeOf(p)));
    expect(callers.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("takes no thumbnail from YouTube for a user's own channels either", () => {
    // The original built i.ytimg.com/vi/<id>/hqdefault.jpg per My TV row.
    const offenders = sourceFiles.filter((p) => /ytimg\.com\/vi\//.test(codeOf(p)));
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });
});

describe("parseYouTube", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/playlist?list=PLabc123", "list", "PLabc123"],
  ])("reads %s", (input, kind, id) => {
    expect(parseYouTube(input)).toEqual({ kind, id });
  });

  it("returns null for a channel page — there is nothing there to autoplay", () => {
    expect(parseYouTube("https://www.youtube.com/channel/UCknLrEdhRCp1aegoMqRaCZg")).toBeNull();
    expect(parseYouTube("https://www.youtube.com/@dwnews")).toBeNull();
    expect(parseYouTube("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTube("")).toBeNull();
  });
});

describe("what the player is handed", () => {
  it("turns a My TV channel into its uploads playlist, with no lookup", () => {
    // UCzwCEE_PchiBULMnAJqhGVg is one of the ids really sitting in
    // user_channels in production. UC -> UU is the whole derivation.
    expect(playableOfMyTv({ channel_id: "UCzwCEE_PchiBULMnAJqhGVg", name: "Raj Shamani" })).toEqual(
      {
        kind: "playlist",
        list: "UUzwCEE_PchiBULMnAJqhGVg",
        name: "Raj Shamani",
      },
    );
  });

  it("plays a My TV channel's LIVE feed when that channel has one", () => {
    // A user may add a broadcaster that is already in the live roster. It
    // should behave the same there as it does in the directory.
    expect(playableOfMyTv({ channel_id: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW" })).toEqual({
      kind: "live",
      channelId: "UCknLrEdhRCp1aegoMqRaCZg",
      name: "DW",
    });
  });

  it("refuses a malformed channel id rather than building a broken playlist", () => {
    expect(playableOfMyTv({ channel_id: "nonsense", name: "x" })).toBeNull();
    expect(playableOfMyTv({ channel_id: "UCtooshort", name: "x" })).toBeNull();
  });

  it("turns a user's pasted link into a video or a playlist", () => {
    const row = { id: "1", genre_id: "g", name: "clip", position: 0 };
    expect(playableOfUserChannel({ ...row, youtube_url: "https://youtu.be/dQw4w9WgXcQ" })).toEqual({
      kind: "video",
      videoId: "dQw4w9WgXcQ",
      name: "clip",
    });
    expect(
      playableOfUserChannel({
        ...row,
        youtube_url: "https://www.youtube.com/playlist?list=PLabc123",
      }),
    ).toEqual({ kind: "playlist", list: "PLabc123", name: "clip" });
    expect(playableOfUserChannel({ ...row, youtube_url: "https://example.com/nope" })).toBeNull();
  });
});

describe("caps are the original numbers, and an owner decision to change", () => {
  it("keeps 10 / 20 / 50", () => {
    expect(MAX_MYTV_CHANNELS).toBe(10);
    expect(MAX_USER_GENRES).toBe(20);
    expect(MAX_CHANNELS_PER_GENRE).toBe(50);
  });
});

describe("a user genre id can never collide with a built-in", () => {
  it("namespaces user genres and keeps My TV distinct", () => {
    // The tab state is one string across built-ins, My TV and user genres.
    // A user naming a genre "news" must not hijack the built-in news tab —
    // the prefix is what prevents it, and the prefix contains a character
    // that cannot appear in a WatchGenre.
    expect(USER_GENRE_PREFIX).toContain(":");
    expect(MYTV_GENRE_ID).not.toContain(":");
    const builtIns = [
      "all",
      "news",
      "sports",
      "entertainment",
      "finance",
      "influencer",
      "lifestyle",
    ];
    for (const b of builtIns) {
      expect(b.startsWith(USER_GENRE_PREFIX)).toBe(false);
      expect(b).not.toBe(MYTV_GENRE_ID);
    }
  });
});

describe("both surfaces offer the same personal genres", () => {
  it("Home and Watch each render My TV and the user's own genres", () => {
    // The owner's note was that the genre selector was missing from Home.
    // A selector that omits the personal genres is the same bug in a smaller
    // form, so both files are checked for both.
    for (const p of [
      "src/routes/_authenticated/app.index.tsx",
      "src/routes/_authenticated/app.watch.tsx",
    ]) {
      const src = codeOf(join(ROOT, p));
      expect(src, `${p} has no genre selector`).toMatch(/MYTV_GENRE_ID/);
      expect(src, `${p} does not offer user genres`).toMatch(/USER_GENRE_PREFIX/);
      expect(src, `${p} does not read the user's genres`).toMatch(/useUserGenres/);
    }
  });

  it("only Watch can CREATE — Home routes there rather than duplicating the editor", () => {
    const home = codeOf(join(ROOT, "src/routes/_authenticated/app.index.tsx"));
    const watch = codeOf(join(ROOT, "src/routes/_authenticated/app.watch.tsx"));
    expect(watch).toContain("AddGenreSheet");
    expect(watch).toContain("MyTvManageSheet");
    expect(watch).toContain("AddChannelSheet");
    expect(home, "the add-genre editor was duplicated onto Home").not.toContain("AddGenreSheet");
  });
});
