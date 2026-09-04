/**
 * THE STYLE AND MOOD CHIPS — a closed vocabulary, expanded server-side.
 *
 * The chips exist because the owner's reference draws them. They are PROMPT
 * TEXT rather than an API parameter, and that is not a shortcut: neither
 * Gemini's image endpoint nor Lyria has a `style` or `mood` field this key has
 * been measured on, and CLAUDE.md's rule is that an unverified request field
 * does not get written into code. A clause appended to a prompt is something a
 * person could have typed themselves, and it cannot 400.
 *
 * The property that actually matters here is the one about the caller: a chip
 * is a TOKEN, and only this module turns a token into words. If a caller could
 * send the words, Create would have a second prompt slot on a paid model that
 * the client writes — which is the surface every other path in this codebase
 * refuses to open.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  imageConfigFor,
  readAspectRatio,
  IMAGE_STYLES,
  MUSIC_MOODS,
  readImageStyle,
  readMusicMood,
  withImageStyle,
  withMusicMood,
} from "../../data/createStyles";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the vocabulary is what the reference draws", () => {
  it("offers the four image styles, with auto first", () => {
    expect(IMAGE_STYLES).toEqual(["auto", "realistic", "cinematic", "anime"]);
  });

  it("offers the four music moods", () => {
    expect(MUSIC_MOODS).toEqual(["chill", "energetic", "cinematic", "happy"]);
  });
});

describe("reading a caller's token", () => {
  it("accepts every token it offers, in any casing or padding", () => {
    for (const s of IMAGE_STYLES) {
      expect(readImageStyle(s.toUpperCase()), s).toBe(s);
      expect(readImageStyle(`  ${s} `), s).toBe(s);
    }
    for (const m of MUSIC_MOODS) expect(readMusicMood(m.toUpperCase()), m).toBe(m);
  });

  it("returns null for anything it does not offer", () => {
    for (const bad of [
      "",
      "  ",
      "photoreal",
      "sad",
      "chill;",
      42,
      null,
      undefined,
      {},
      ["chill"],
    ]) {
      expect(readImageStyle(bad), JSON.stringify(bad)).toBeNull();
      expect(readMusicMood(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("does not let one screen's vocabulary leak into the other's", () => {
    // "cinematic" is deliberately in both; nothing else is.
    expect(readImageStyle("chill")).toBeNull();
    expect(readMusicMood("anime")).toBeNull();
    expect(readImageStyle("cinematic")).toBe("cinematic");
    expect(readMusicMood("cinematic")).toBe("cinematic");
  });
});

describe("composing the prompt", () => {
  const prompt = "a red bicycle against a blue wall";

  it("puts the person's own words first", () => {
    // Their sentence with a note after it. The reverse reads as the style's
    // picture with their subject as an afterthought.
    const out = withImageStyle(prompt, "cinematic");
    expect(out.indexOf("bicycle")).toBeLessThan(out.indexOf("depth of field"));
    expect(out.startsWith(prompt)).toBe(true);
  });

  it("adds nothing at all for auto, which is the absence of a style", () => {
    expect(withImageStyle(prompt, "auto")).toBe(prompt);
  });

  it("adds nothing for a token it does not know", () => {
    // A client ahead of its server is not an attack, and the person should
    // still get their picture.
    for (const bad of ["photoreal", "", null, undefined, 7]) {
      expect(withImageStyle(prompt, bad), JSON.stringify(bad)).toBe(prompt);
      expect(withMusicMood(prompt, bad), JSON.stringify(bad)).toBe(prompt);
    }
  });

  it("never manufactures a prompt out of a chip alone", () => {
    // Composing onto nothing would turn an empty box into a paid call; the
    // caller's own emptiness check is what should speak.
    for (const empty of ["", "   ", "\n"]) {
      expect(withImageStyle(empty, "cinematic"), JSON.stringify(empty)).toBe(empty);
      expect(withMusicMood(empty, "chill"), JSON.stringify(empty)).toBe(empty);
    }
  });

  it("does not double the full stop when the person wrote one", () => {
    expect(withImageStyle("a red bicycle.", "anime")).not.toContain("..");
    expect(withMusicMood("calm piano.  ", "chill")).not.toContain("..");
  });

  it("says something specific rather than repeating the chip's own word", () => {
    // "cinematic" alone is a word models interpret loosely; naming the light
    // and the framing is what makes the chip do anything.
    const out = withImageStyle(prompt, "cinematic");
    expect(out.length).toBeGreaterThan(prompt.length + 30);
    expect(out.toLowerCase()).toContain("light");
  });

  it("gives every token in both vocabularies a clause of its own", () => {
    const seen = new Set<string>();
    for (const s of IMAGE_STYLES) {
      if (s === "auto") continue;
      const out = withImageStyle(prompt, s);
      expect(out, s).not.toBe(prompt);
      expect(seen.has(out), `${s} repeats another style's clause`).toBe(false);
      seen.add(out);
    }
    const moods = new Set<string>();
    for (const m of MUSIC_MOODS) {
      const out = withMusicMood("a track", m);
      expect(out, m).not.toBe("a track");
      expect(moods.has(out), `${m} repeats another mood's clause`).toBe(false);
      moods.add(out);
    }
  });

  it("bounds what it adds, so a chip cannot swamp the subject", () => {
    for (const s of IMAGE_STYLES) {
      expect(withImageStyle(prompt, s).length - prompt.length, s).toBeLessThan(120);
    }
    for (const m of MUSIC_MOODS) {
      expect(withMusicMood("a track", m).length - "a track".length, m).toBeLessThan(120);
    }
  });
});

describe("the screens send a token, never a sentence", () => {
  it("is what both Create screens actually do", () => {
    const image = read("src/routes/_authenticated/app.image.tsx");
    const music = read("src/routes/_authenticated/app.music.tsx");
    // The state they hold is the token; the clause never appears client-side.
    expect(image).toMatch(/\bstyle,\n/);
    expect(music).toMatch(/\bmood,\n/);
    expect(image).not.toContain("depth of field");
    expect(music).not.toContain("driving rhythm");

    // And the server is the only place a clause is built.
    const imageFn = read("supabase/functions/image-generate/index.ts");
    const musicFn = read("supabase/functions/music-generate/index.ts");
    expect(imageFn).toContain("withImageStyle(prompt, body.style)");
    expect(musicFn).toContain("withMusicMood(prompt, body.mood)");
  });
});

/* ------------------------------------------------------------ aspect ratio
 * The one control on these screens that is a REAL request field. Style and
 * Mood are words appended to a prompt because no verified field exists for
 * them; `aspectRatio` reaches Google verbatim, which changes what has to be
 * true about it.
 * -------------------------------------------------------------------------- */
describe("aspect ratio", () => {
  it("offers the four the reference draws", () => {
    expect(ASPECT_RATIOS).toEqual(["1:1", "3:4", "16:9", "9:16"]);
  });

  it("carries the measurement for every value it offers", () => {
    // Not three measured and one assumed. Each of these dimensions came back
    // from a real POST, and the file records them so the next person can tell
    // a verified value from a plausible one.
    const src = read("supabase/functions/_shared/createStyles.ts");
    for (const proof of ["1024x1024", "896x1200", "1376x768", "768x1376"]) {
      expect(src, proof).toContain(proof);
    }
    // And the control that makes those 200s mean anything.
    expect(src).toContain("nonsenseFieldXyz");
  });

  it("records that Lyria has no duration field, so nobody rebuilds that row", () => {
    const src = read("supabase/functions/_shared/createStyles.ts");
    expect(src).toContain("musicConfig.durationSeconds");
    // Whitespace collapsed: the sentence wraps across comment lines, and
    // asserting on where it breaks would fail the next time a word is added.
    expect(src.replace(/\s+\*?\s*/g, " ")).toMatch(/no duration parameter on Lyria/i);
  });

  it("accepts only what it offers", () => {
    for (const r of ASPECT_RATIOS) expect(readAspectRatio(r), r).toBe(r);
    for (const bad of ["4:3", "1:2", "16 : 9", "", 1, null, undefined, {}]) {
      expect(readAspectRatio(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("builds the nested shape Google actually takes", () => {
    // A top-level `aspectRatio` is 400 "Cannot find field"; it has to sit
    // inside imageConfig.
    expect(imageConfigFor("16:9")).toEqual({ aspectRatio: "16:9" });
  });

  it("sends NO imageConfig when no ratio was chosen", () => {
    // Undefined, not {}. The endpoint has rejected malformed config shapes
    // before, and omitting it is exactly what the measured control did.
    for (const none of [null, undefined, "", "4:3"]) {
      expect(imageConfigFor(none), JSON.stringify(none)).toBeUndefined();
    }
  });

  it("is passed through by the screen and resolved by the server", () => {
    const screen = read("src/routes/_authenticated/app.image.tsx");
    // Sent on the GENERATE tab, which is the only path it was measured on.
    // Whether an aspectRatio survives an inlineData part going first is not
    // measured, so the Edit and Transform tabs neither show the control nor
    // send the field — an accepted-and-ignored parameter is indistinguishable
    // from a working one by status code alone.
    expect(screen).toContain("aspectRatio: needsPicture ? null : ratio");
    const fn = read("supabase/functions/image-generate/index.ts");
    expect(fn).toContain("imageConfigFor(body.aspectRatio)");
    // It reaches Google nested, and only when there is one.
    expect(fn).toContain("{ generationConfig: { imageConfig } }");
  });

  it("ships no Duration CONTROL on Music, because there is no field behind it", () => {
    // The reference draws 30s / 1 min / 2 min / Custom. All four request
    // shapes returned 400 when measured 2026-09-04 and Lyria's response
    // carries no duration either, so four chips would be a lie told four
    // ways.
    //
    // WHAT CHANGED 2026-09-04: this used to forbid the WORD, which caught the
    // comment explaining the absence as readily as a control. It now holds
    // the real property — no input, no request field — and additionally
    // requires the screen to SAY so, because a silent gap reads as an
    // oversight and this is a decision.
    const music = read("src/routes/_authenticated/app.music.tsx");
    const code = music.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    // No request field, and no state holding a chosen length.
    expect(code).not.toMatch(/durationSeconds|duration:\s|setDuration/);
    // No chip group offering one — the shapes the reference draws.
    expect(code).not.toMatch(/30s|"1 min"|"2 min"/);
    // And it tells the person, rather than leaving a hole where a row was.
    expect(music).toContain('data-testid="music-length-note"');
    // The length it DID come out at is shown: the honest half of "duration".
    expect(music).toContain('data-testid="music-song-length"');
    expect(code).toContain("onLoadedMetadata");
    // preload="none" would leave that reading 0:00 until played, which is the
    // state the screen was in when the gap was raised.
    expect(code).toContain('preload="metadata"');
  });
});
