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
import { describe, expect, it } from "vitest";
import {
  IMAGE_STYLES,
  MUSIC_MOODS,
  readImageStyle,
  readMusicMood,
  withImageStyle,
  withMusicMood,
} from "../../data/createStyles";

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
  it("is what both Create screens actually do", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

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
