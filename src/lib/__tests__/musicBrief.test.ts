/**
 * The reference-song pipeline's pure half.
 *
 * Owner directive 2026-09-04c: a reference song is LISTENED TO and described,
 * and Lyria generates fresh from the description. The audio never reaches
 * Lyria. Everything asserted here is either a real failure mode of asking a
 * language model for JSON, or the rights rule that makes the feature safe to
 * ship at all.
 */
import { describe, expect, it } from "vitest";
import {
  BRIEF_ASK,
  compileMusicPrompt,
  describeBrief,
  parseMusicBrief,
} from "../../../supabase/functions/_shared/musicBrief.ts";

describe("BRIEF_ASK — what the analysing model is told", () => {
  it("forbids reproducing the melody and the lyrics", () => {
    // The whole feature rests on this. A pipeline that copied the tune would
    // be laundering somebody else's song.
    expect(BRIEF_ASK).toMatch(/do not transcribe or reproduce/i);
    expect(BRIEF_ASK.toLowerCase()).toContain("melody");
    expect(BRIEF_ASK.toLowerCase()).toContain("lyrics");
  });

  it("asks for the style, not the song's identity", () => {
    expect(BRIEF_ASK).toMatch(/do not name the song or the artist/i);
  });

  it("names every key it wants back", () => {
    for (const k of [
      "genre",
      "tempo",
      "mood",
      "instruments",
      "arrangement",
      "vocals",
      "production",
    ]) {
      expect(BRIEF_ASK, k).toContain(k);
    }
  });
});

describe("parseMusicBrief — a language model's JSON, in the wild", () => {
  const good = {
    genre: "cinematic electronic pop",
    tempo: "118 BPM",
    mood: ["uplifting", "nostalgic"],
    instruments: ["analog synth", "piano", "electronic drums"],
    arrangement: "intro, verse, chorus, bridge, final chorus",
    vocals: "female lead",
    production: "wide stereo",
  };

  it("reads a clean object", () => {
    expect(parseMusicBrief(JSON.stringify(good))).toEqual(good);
  });

  it("survives a ```json fence", () => {
    expect(parseMusicBrief("```json\n" + JSON.stringify(good) + "\n```")?.genre).toBe(good.genre);
  });

  it("survives prose either side of the object", () => {
    const wrapped = `Sure! Here is the brief:\n${JSON.stringify(good)}\nHope that helps.`;
    expect(parseMusicBrief(wrapped)?.tempo).toBe("118 BPM");
  });

  it("unwraps a single object returned inside an array", () => {
    expect(parseMusicBrief(JSON.stringify([good]))?.genre).toBe(good.genre);
  });

  it("splits a comma string where a list was asked for", () => {
    // Asked for string[], models sometimes send "piano, synth, drums".
    // Dropping the field would silently lose the instrumentation.
    const b = parseMusicBrief(JSON.stringify({ instruments: "piano, synth; drums" }));
    expect(b?.instruments).toEqual(["piano", "synth", "drums"]);
  });

  it("keeps a partial brief rather than demanding every key", () => {
    const b = parseMusicBrief(JSON.stringify({ genre: "lo-fi" }));
    expect(b).toEqual({ genre: "lo-fi" });
  });

  it("invents nothing for the keys that were absent", () => {
    const b = parseMusicBrief(JSON.stringify({ genre: "lo-fi" }))!;
    for (const k of [
      "tempo",
      "mood",
      "instruments",
      "arrangement",
      "vocals",
      "production",
    ] as const) {
      expect(b[k], k).toBeUndefined();
    }
  });

  it("returns null for a brief with nothing usable in it", () => {
    // An empty brief would compile to "Create an original piece of music." —
    // exactly what attaching nothing gives you — while telling the person
    // their reference was used. That is the lie this guards against.
    for (const raw of ["{}", '{"genre":""}', '{"genre":"   "}', '{"mood":[]}', '{"nope":1}']) {
      expect(parseMusicBrief(raw), raw).toBeNull();
    }
  });

  it("returns null for anything that is not an object at all", () => {
    for (const raw of ["", "   ", "no json here", "[1,2,3]", "null", "{oops"]) {
      expect(parseMusicBrief(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("bounds what it accepts, so a runaway reply cannot become the prompt", () => {
    const b = parseMusicBrief(
      JSON.stringify({ genre: "x".repeat(500), instruments: Array(50).fill("synth") }),
    )!;
    expect(b.genre!.length).toBeLessThanOrEqual(80);
    expect(b.instruments!.length).toBeLessThanOrEqual(8);
  });

  it("does not throw on a hostile shape", () => {
    for (const raw of ['{"mood":{"a":1}}', '{"instruments":[null,7,{}]}', '{"genre":42}']) {
      expect(() => parseMusicBrief(raw), raw).not.toThrow();
    }
  });
});

describe("compileMusicPrompt — the sentence Lyria is given", () => {
  const brief = {
    genre: "cinematic electronic pop",
    tempo: "118 BPM",
    mood: ["uplifting"],
    instruments: ["piano"],
  };

  it("leads with the person's own words", () => {
    // What they typed IS the brief; the reference is the adjective.
    const p = compileMusicPrompt(brief, "a song for a road trip");
    expect(p.indexOf("road trip")).toBeLessThan(p.indexOf("cinematic"));
  });

  it("works with no words of their own", () => {
    expect(compileMusicPrompt(brief)).toContain("Create an original piece of music.");
  });

  it("carries every field the brief actually had", () => {
    const p = compileMusicPrompt(brief);
    expect(p).toContain("cinematic electronic pop");
    expect(p).toContain("118 BPM");
    expect(p).toContain("uplifting");
    expect(p).toContain("piano");
  });

  it("says nothing about a field the brief did not have", () => {
    const p = compileMusicPrompt({ genre: "lo-fi" });
    expect(p).not.toMatch(/Tempo:|Mood:|Vocals:|Production:|Arrangement:/);
  });

  it("repeats the no-copying rule to Lyria as well", () => {
    // The brief has been through a language model by now and could carry a
    // phrase closer to the original than intended.
    expect(compileMusicPrompt(brief)).toMatch(/do not reproduce any existing melody or lyrics/i);
  });

  it("is prose, not a JSON dump", () => {
    const p = compileMusicPrompt(brief, "hello");
    expect(p).not.toContain("{");
    expect(p).not.toContain('"genre"');
  });

  it("bounds the person's own words too", () => {
    expect(compileMusicPrompt(brief, "y".repeat(900)).length).toBeLessThan(900);
  });
});

describe("describeBrief — what the person is shown back", () => {
  it("summarises in one line", () => {
    expect(describeBrief({ genre: "lo-fi", tempo: "90 BPM", mood: ["calm"] })).toBe(
      "lo-fi · 90 BPM · calm",
    );
  });

  it("skips the gaps rather than printing empties", () => {
    expect(describeBrief({ genre: "lo-fi" })).toBe("lo-fi");
    expect(describeBrief({})).toBe("");
  });
});
