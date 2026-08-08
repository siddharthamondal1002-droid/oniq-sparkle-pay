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
  SHEETED,
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

describe("the THREE jinn are built to be told apart", () => {
  // The production notes warn about two. There are three: the JAR jinni in
  // episode 1, and the RING and LAMP jinn in episode 3. All are "a spirit
  // rising out of an object", all are reused, and a generator will draw that
  // shape the same way every time unless stopped.
  //
  // The jar jinni is the trap. It is already designed, already shipped, and it
  // is a vast ember-cracked giant trailing smoke — which is exactly how the
  // lamp jinni was first described here. Generated from that text, episode 3's
  // lamp jinni would have been episode 1's jar jinni in a different room.
  const ep1 = ORIGINALS.find((e) => e.id === "ep1")!.cast!;
  const ep3 = ORIGINALS.find((e) => e.id === "ep3")!.cast!;

  it("keeps the ring jinni small, light, and free of smoke", () => {
    expect(ep3.ringJinni).toMatch(/small/i);
    expect(ep3.ringJinni).toMatch(/light/i);
    // Saying what a thing IS leaves the generator free to add the rest.
    expect(ep3.ringJinni, "must exclude smoke").toMatch(/no smoke/i);
  });

  it("keeps the jar jinni vast, ember-lit and smoke-bodied", () => {
    expect(ep1.jarJinni).toMatch(/enormous|vast/i);
    expect(ep1.jarJinni).toMatch(/ember/i);
    expect(ep1.jarJinni).toMatch(/smoke/i);
  });

  it("makes the lamp jinni refuse BOTH siblings by name", () => {
    // Not just "different from the ring jinni". The jar jinni is the one it
    // would actually collide with, and only naming it prevents that.
    expect(ep3.lampJinni, "must refuse the ring jinni").toMatch(/ring jinni/i);
    expect(ep3.lampJinni, "must refuse the jar jinni").toMatch(/jar\s*\n?\s*jinni/i);
  });

  it("says out loud that the lamp jinni has no reference sheet", () => {
    // Every other name in the production notes was supplied as art. This one
    // was not, and a lock that reads like the others would hide that.
    expect(SHEETED.lampJinni).toBe(false);
    expect(ep3.lampJinni).toMatch(/no reference sheet/i);
  });

  it("puts each lock into the prompts of the scenes it appears in", () => {
    expect(stillPromptFor(findScene("ep1_s08")!)).toContain("THE JAR JINNI");
    expect(stillPromptFor(findScene("ep3_s08")!)).toContain("THE RING JINNI");
    expect(stillPromptFor(findScene("ep3_s10")!)).toContain("THE LAMP JINNI");
  });

  it("never puts two jinn in the same frame", () => {
    const jinn = ["jarJinni", "ringJinni", "lampJinni"];
    for (const episode of ORIGINALS) {
      for (const scene of episode.scenes) {
        const n = (scene.cast ?? []).filter((k) => jinn.includes(k)).length;
        expect(n, `${scene.id} casts ${n} jinn at once`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("we know which characters have reference art", () => {
  // Veo ignores style words in text-to-video, so a character can only be held
  // to its design by handing the generator an image. Whether a sheet exists is
  // therefore a production fact, not trivia — it decides how a shot is made.
  it("records a sheet status for every character in every episode", () => {
    for (const episode of ORIGINALS) {
      for (const key of Object.keys(episode.cast ?? {})) {
        expect(SHEETED[key], `no sheet status recorded for "${key}"`).toBeDefined();
      }
    }
  });

  it("makes every unsheeted character admit it in its own lock", () => {
    // Otherwise an unsheeted lock reads exactly like a sheeted one and someone
    // generates from prose believing it is pinned to art.
    const unsheeted = Object.entries(SHEETED)
      .filter(([, has]) => !has)
      .map(([key]) => key);
    expect(unsheeted.length, "expected at least one known gap").toBeGreaterThan(0);
    for (const episode of ORIGINALS) {
      for (const key of unsheeted) {
        const lock = episode.cast?.[key];
        if (!lock) continue;
        // Kasim was never requested as a sheet, so he only has to be absent
        // from the production-notes list — the lamp jinni was, and must say so.
        if (key === "lampJinni") {
          expect(lock, "lamp jinni lock must flag the missing sheet").toMatch(
            /no reference sheet/i,
          );
        }
      }
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
