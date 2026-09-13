import { describe, expect, it } from "vitest";

import { sceneAmbienceFor, soundEmotionFor } from "../filmSound";

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

  it("chooses ambience from the visible still, with rain controlled by visible weather", () => {
    expect(sceneAmbienceFor("A quiet cave mouth under the stars.", null)).toBe("cave");
    expect(sceneAmbienceFor("A rainbow over the market.", "rain")).toBe("rain");
    expect(sceneAmbienceFor("Rain remembered in a dry room.", null)).toBeNull();
  });
});
