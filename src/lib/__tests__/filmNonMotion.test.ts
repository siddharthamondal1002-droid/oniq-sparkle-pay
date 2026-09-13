import { describe, expect, it } from "vitest";

import { sceneAmbienceFor, soundEmotionFor } from "../filmSound";
import {
  FILM_CONTINUITY_RULES,
  filmPacingGuidance,
} from "../../../supabase/functions/_shared/filmQuality";

describe("filmSound", () => {
  it("keeps emotion on the shot's authored words", () => {
    expect(
      soundEmotionFor({
        still: "A woman stands by the lamp.",
        narration: "Wonder stopped her cold.",
        dialogue: { line: "What light is this?" },
      }),
    ).toBe("wonder");
  });

  it("scores an expressive shot that has no rig and no clip", () => {
    expect(soundEmotionFor({ still: "The two cats snarl over the rooftop." })).toBe("anger");
    expect(soundEmotionFor({ still: "A ledger sits open on the table." })).toBeNull();
  });

  it("chooses ambience from the visible still, with rain controlled by visible weather", () => {
    expect(sceneAmbienceFor("A quiet cave mouth under the stars.", null)).toBe("cave");
    expect(sceneAmbienceFor("A rainbow over the market.", "rain")).toBe("rain");
    expect(sceneAmbienceFor("Rain remembered in a dry room.", null)).toBeNull();
  });

  it("strikes out absent rain without losing the rest of the visible air", () => {
    // The rain is remembered, the cavern is on screen.
    expect(sceneAmbienceFor("Deep in the cavern, she recalled the monsoon.", null)).toBe("cave");
    expect(sceneAmbienceFor("Deep in the cavern, the rain hammered down.", "rain")).toBe("rain");
  });
});

describe("filmPacingGuidance", () => {
  it("gives a bounded per-shot word band for generated speech", () => {
    const text = filmPacingGuidance(60, 9, false);
    expect(text).toContain("about 60 seconds across 9 shots");
    expect(text).toMatch(/roughly \d+–\d+ spoken words per shot/);
    expect(text).toContain("long inert holds");
  });

  it("says nothing when the narration is the user's own verbatim text", () => {
    expect(filmPacingGuidance(60, 9, true)).toBe("");
  });

  it("says nothing when the duration or shot count is unusable", () => {
    expect(filmPacingGuidance(null, 9, false)).toBe("");
    expect(filmPacingGuidance(60, 0, false)).toBe("");
    expect(filmPacingGuidance(60, 1.5, false)).toBe("");
  });
});

describe("FILM_CONTINUITY_RULES", () => {
  it("guards species and foreground drift while still allowing new cast", () => {
    expect(FILM_CONTINUITY_RULES).toContain("species");
    expect(FILM_CONTINUITY_RULES).toContain("Additional characters are allowed");
  });

  it("asks for coherent reflections rather than duplicated face closeups", () => {
    expect(FILM_CONTINUITY_RULES).toContain("REFLECTIONS");
    expect(FILM_CONTINUITY_RULES).toContain("one coherent reflection per visible subject");
  });
});
