/**
 * Episode 2 is generated in a different rendering style from the rest of the
 * season, and the whole mechanism is one optional field.
 *
 * That is a quiet failure mode: if `style` is dropped from episode 2, or if
 * `stillPromptFor` stops consulting the owning episode, nothing throws and no
 * type complains — the stills simply come back in the wrong look, and nobody
 * finds out until fourteen images have been generated and paid for.
 *
 * So these assert the resolution both ways round: episode 2 gets storybook,
 * and every other episode does not.
 */
import { describe, expect, it } from "vitest";
import {
  HOUSE_STYLE,
  ORIGINALS,
  STORYBOOK_STYLE,
  findScene,
  stillPromptFor,
} from "@/data/originals";

describe("a scene is prompted in its own episode's style", () => {
  it("puts storybook on episode 2, and on nothing else", () => {
    for (const episode of ORIGINALS) {
      for (const scene of episode.scenes) {
        expect(
          stillPromptFor(scene).startsWith(STORYBOOK_STYLE),
          `${scene.id} storybook-ness is wrong`,
        ).toBe(episode.id === "ep2");
      }
    }
  });

  it("leaves an episode with no style of its own on the house style", () => {
    // ep1 is already generated and shipped; ep3 has not been generated yet.
    // Neither declares a style, and both must resolve to the season default.
    for (const id of ["ep1_s01", "ep3_s01"]) {
      expect(stillPromptFor(findScene(id)!).startsWith(HOUSE_STYLE), id).toBe(true);
    }
  });

  it("keeps the scene's own description after the style", () => {
    // Guards against a style string that replaces the prompt instead of
    // prefixing it — which would still start with STORYBOOK_STYLE and would
    // still pass the first test here.
    expect(stillPromptFor(findScene("ep2_s01")!)).toContain("lone woodcutter");
  });
});

describe("the storybook style does not contradict itself", () => {
  it("does not ask for film grain while also refusing it", () => {
    // HOUSE_STYLE asks for `film grain`; STORYBOOK_STYLE says `no film grain`.
    // The substring "film grain" appears in both, so a naive check passes on
    // either. Strip the negations first, then look for what remains — the
    // question is whether grain is ever requested, not whether it is named.
    const withoutNegations = STORYBOOK_STYLE.replace(/\bno\s+[a-z-]+(\s+[a-z-]+)?/g, "");
    expect(withoutNegations).not.toMatch(/film grain/);
    expect(STORYBOOK_STYLE).toMatch(/no film grain/);
  });
});
