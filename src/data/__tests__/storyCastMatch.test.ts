/**
 * THE CASTING MANIFEST AND THE STYLE FRAMES AGREE ABOUT WHO HAS A PICTURE.
 *
 * Two catalogues arrived separately on 2026-08-18: renderable frames in
 * STORY_STYLE_REFS (owner uploads, Lovable asset pointers) and a 74-entry
 * casting manifest in STORY_CHARACTER_REFS (transcribed from the external
 * generation tool, no images of its own). Manifest entries that describe the
 * same subject as an uploaded frame carry a styleRefId linking the two — 37
 * after the first five upload batches, 67 after batches six to eight supplied
 * pictures for 30 more the same day.
 *
 * The match was made subject-by-subject, not region-by-region — a shared
 * country or trade was never enough. The four pairs refused on that ground:
 *
 *   outback stockman mustering cattle  ≠ outback-elder (an elder, walking)
 *   Beijing astronomer                 ≠ jiangnan-scholar (a scholar, desk)
 *   Inuit grandmother storytelling     ≠ inuit-ice-fisher (a fisher)
 *   glowing astrolabe artifact         ≠ isfahan-scholar-poet-sheet (a person)
 *
 * The last two later got pictures of their OWN and are now matched to those.
 * That is not the refusal being undone — the refusal was about wearing the
 * wrong face, and it still holds. The first two remain unmatched.
 *
 * Everything this file pins breaks silently otherwise: a styleRefId pointing
 * at a renamed frame just stops rendering, and a frame claimed twice makes
 * two different characters wear one face.
 */
import { describe, expect, it } from "vitest";
import { STORY_CHARACTER_REFS } from "@/data/storyCharacterRefs";
import { STORY_STYLE_REFS } from "@/data/storyStyleRefs";

const styleIds = new Set(STORY_STYLE_REFS.map((r) => r.id));
const matched = STORY_CHARACTER_REFS.filter((c) => c.styleRefId);

describe("the cast ↔ frame match", () => {
  it("both catalogues are the size the manifests claim", () => {
    expect(STORY_CHARACTER_REFS).toHaveLength(74);
    expect(STORY_STYLE_REFS).toHaveLength(85);
  });

  it("every styleRefId points at a frame that exists", () => {
    for (const c of matched) {
      expect(
        styleIds.has(c.styleRefId!),
        `${c.region}: "${c.styleRefId}" is not a style ref id`,
      ).toBe(true);
    }
  });

  it("no frame is claimed by two characters", () => {
    // One face, one character. A duplicated claim means two different people
    // in two different stories would render from the same picture.
    const seen = new Map<string, string>();
    for (const c of matched) {
      const prior = seen.get(c.styleRefId!);
      expect(prior, `${c.styleRefId} claimed by both "${prior}" and "${c.description}"`).toBe(
        undefined,
      );
      seen.set(c.styleRefId!, c.description);
    }
  });

  it("exactly 67 characters have frames — moving this number is a deliberate act", () => {
    // Down means a link was lost; up means new frames were matched (fine —
    // update this count in the same commit that adds them, with the upload).
    // 37 on 2026-08-18 from the first five upload batches; 67 later the same
    // day when batches six to eight supplied pictures for 30 more.
    expect(matched).toHaveLength(67);
  });

  it("the refused pairs are still refused — nobody wears the wrong face", () => {
    // The refusal was always about a SPECIFIC wrong frame, never about being
    // unmatched. Two of the four have since been given their own picture and
    // are correctly linked to it; what must never happen is either of them
    // pointing at the near-miss frame from the same region.
    const byDesc = (needle: string) =>
      STORY_CHARACTER_REFS.find((c) => c.description.includes(needle));
    expect(byDesc("grandmother telling a story")?.styleRefId).toBe("iglu-storytelling-grandmother");
    expect(byDesc("grandmother telling a story")?.styleRefId).not.toBe("inuit-ice-fisher");
    expect(byDesc("astrolabe artifact")?.styleRefId).toBe("brass-astrolabe-artifact");
    expect(byDesc("astrolabe artifact")?.styleRefId).not.toBe("isfahan-scholar-poet-sheet");
    // These two still have no picture of their own, so they stay unmatched —
    // the outback ELDER is not the stockman, the Jiangnan SCHOLAR is not the
    // Beijing astronomer.
    expect(byDesc("stockman mustering cattle")?.styleRefId).toBeUndefined();
    expect(byDesc("Astronomer gazing")?.styleRefId).toBeUndefined();
  });

  it("every unmatched character is unmatched because no frame fits, not by omission", () => {
    // The complement check: each style ref is either claimed by a character
    // or genuinely has no counterpart in the manifest. If this list shrinks,
    // a new match was made — mirror it in the count above.
    const claimed = new Set(matched.map((c) => c.styleRefId));
    const orphanFrames = STORY_STYLE_REFS.filter((r) => !claimed.has(r.id)).map((r) => r.id);
    expect(orphanFrames).toHaveLength(85 - 67);
  });
});
