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
  // Stated per episode rather than derived, so that changing an episode's look
  // is a deliberate edit here and never a side effect of editing originals.ts.
  // ep1 is photoreal and already shipped; ep2 and ep3 both use the Firefly
  // Forest look the owner chose from a reference clip.
  const EXPECTED: Record<string, string> = {
    ep1: HOUSE_STYLE,
    ep2: STORYBOOK_STYLE,
    ep3: STORYBOOK_STYLE,
  };

  it("gives every episode exactly the style it is meant to have", () => {
    for (const episode of ORIGINALS) {
      const expected = EXPECTED[episode.id];
      expect(expected, `no expected style recorded for ${episode.id}`).toBeTruthy();
      for (const scene of episode.scenes) {
        expect(stillPromptFor(scene).startsWith(expected), `${scene.id} has the wrong style`).toBe(
          true,
        );
      }
    }
  });

  it("covers every episode in the season", () => {
    // Otherwise a fourth episode could be added and silently go unchecked.
    expect(Object.keys(EXPECTED).sort()).toEqual(ORIGINALS.map((e) => e.id).sort());
  });

  it("still falls back to the house style when an episode declares none", () => {
    // The fallback is what ep1 relies on — it has no `style` of its own.
    expect(ORIGINALS.find((e) => e.id === "ep1")!.style).toBeUndefined();
    expect(stillPromptFor(findScene("ep1_s01")!).startsWith(HOUSE_STYLE)).toBe(true);
  });

  it("keeps the scene's own description after the style", () => {
    // Guards against a style string that replaces the prompt instead of
    // prefixing it — which would still start with STORYBOOK_STYLE and would
    // still pass the first test here.
    expect(stillPromptFor(findScene("ep2_s01")!)).toContain("lone woodcutter");
  });
});

describe("recurring characters are locked to one appearance", () => {
  it("resolves every cast key a scene names", () => {
    // stillPromptFor filters unresolved keys out, so a typo in a cast key
    // costs nothing at build time and silently ships a scene with no lock on
    // it — the character is then re-invented in that shot alone, which is the
    // exact fault the locks exist to prevent.
    for (const episode of ORIGINALS) {
      for (const scene of episode.scenes) {
        for (const key of scene.cast ?? []) {
          expect(episode.cast?.[key], `${scene.id} names unknown cast key "${key}"`).toBeTruthy();
        }
      }
    }
  });

  it("puts the lock text into the prompt", () => {
    const prompt = stillPromptFor(findScene("ep2_s14")!);
    // S14 is the three-hander, and the one most likely to drift.
    expect(prompt).toContain("MORGIANA");
    expect(prompt).toContain("THE CAPTAIN");
    expect(prompt).toContain("ALI BABA");
  });

  it("locks Ali Baba in every shot he appears in", () => {
    // S6 is why this exists: he came back a chibi child there while being a
    // bearded adult in S3, S7 and S9.
    for (const id of ["ep2_s01", "ep2_s03", "ep2_s06", "ep2_s07", "ep2_s09"]) {
      expect(stillPromptFor(findScene(id)!), id).toContain("ALI BABA is the same man");
    }
  });

  it("leaves scenes with nobody in them uncast", () => {
    // S5 is thieves filing into a rock face and S11 is untended mules. A lock
    // on a scene with no recognisable face just spends prompt on nothing.
    for (const id of ["ep2_s05", "ep2_s11"]) {
      expect(findScene(id)!.cast, id).toBeUndefined();
    }
  });
});

describe("the two jinn are built to be told apart", () => {
  // A season note, not a nicety: both are "a spirit rising out of an object",
  // and a generator will happily draw that twice. They are also introduced in
  // the same episode and reused after it, so a collision is permanent.
  const cast = ORIGINALS.find((e) => e.id === "ep3")!.cast!;

  it("describes them at opposite ends of size, speed and material", () => {
    expect(cast.ringJinni).toMatch(/small/i);
    expect(cast.ringJinni).toMatch(/light/i);
    expect(cast.lampJinni).toMatch(/vast/i);
    expect(cast.lampJinni).toMatch(/smoke/i);
  });

  it("refuses the other one's material explicitly", () => {
    // Saying what a thing IS leaves the generator free to add the rest. Each
    // lock also rules out the sibling's defining feature.
    expect(cast.ringJinni, "ring jinni must exclude smoke").toMatch(/no smoke/i);
    expect(cast.lampJinni, "lamp jinni must exclude the ring's blue glow").toMatch(/never.*blue/i);
  });

  it("puts both locks into the prompts of the scenes they appear in", () => {
    expect(stillPromptFor(findScene("ep3_s08")!)).toContain("THE RING JINNI");
    expect(stillPromptFor(findScene("ep3_s10")!)).toContain("THE LAMP JINNI");
  });

  it("never puts both in the same frame", () => {
    // They are never on screen together in this script, so any scene naming
    // both is a tagging mistake — and the one place a design collision would
    // be unmissable.
    for (const scene of ORIGINALS.find((e) => e.id === "ep3")!.scenes) {
      const both = scene.cast?.includes("ringJinni") && scene.cast?.includes("lampJinni");
      expect(both, `${scene.id} casts both jinn`).toBeFalsy();
    }
  });
});

describe("the storybook style does not contradict itself", () => {
  it("does not ask for film grain while also refusing it", () => {
    // HOUSE_STYLE asks for `film grain`; STORYBOOK_STYLE says `no film grain`.
    // The substring "film grain" appears in both, so a naive check passes on
    // either. Strip the negations first, then look for what remains — the
    // question is whether grain is ever requested, not whether it is named.
    // Case-insensitive: the negation is sentence-initial ("No film grain"),
    // and a case-sensitive strip leaves the phrase standing and reports a
    // contradiction that is not there.
    const withoutNegations = STORYBOOK_STYLE.replace(/\bno\s+[a-z-]+(\s+[a-z-]+)?/gi, "");
    expect(withoutNegations).not.toMatch(/film grain/i);
    expect(STORYBOOK_STYLE).toMatch(/no film grain/i);
  });
});
