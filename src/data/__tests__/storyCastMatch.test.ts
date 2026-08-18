/**
 * THE CASTING MANIFEST AND THE STYLE FRAMES AGREE ABOUT WHO HAS A PICTURE.
 *
 * Two catalogues arrived separately on 2026-08-18: 55 renderable frames in
 * STORY_STYLE_REFS (owner uploads, Lovable asset pointers) and a 74-entry
 * casting manifest in STORY_CHARACTER_REFS (transcribed from the external
 * generation tool, no images of its own). They overlap: 37 manifest entries
 * describe the same subject as an uploaded frame, and those now carry a
 * styleRefId linking the two.
 *
 * The match was made subject-by-subject, not region-by-region — a shared
 * country or trade was not enough. The pairs refused on that ground, kept
 * here so nobody "completes" them later by mistake:
 *
 *   outback stockman mustering cattle  ≠ outback-elder (an elder, walking)
 *   Beijing astronomer                 ≠ jiangnan-scholar (a scholar, desk)
 *   Inuit grandmother storytelling     ≠ inuit-ice-fisher (a fisher)
 *   glowing astrolabe artifact         ≠ isfahan-scholar-poet-sheet (a person)
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
    expect(STORY_STYLE_REFS).toHaveLength(55);
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

  it("exactly 37 characters have frames — moving this number is a deliberate act", () => {
    // Down means a link was lost; up means new frames were matched (fine —
    // update this count in the same commit that adds them, with the upload).
    expect(matched).toHaveLength(37);
  });

  it("the refused pairs stay refused", () => {
    // Same-region-different-subject, documented in the header. If one of
    // these gains the frame named here, it was matched by geography, not by
    // subject — undo it.
    const byDesc = (needle: string) =>
      STORY_CHARACTER_REFS.find((c) => c.description.includes(needle));
    expect(byDesc("stockman mustering cattle")?.styleRefId).toBeUndefined();
    expect(byDesc("Astronomer gazing")?.styleRefId).toBeUndefined();
    expect(byDesc("grandmother telling a story")?.styleRefId).toBeUndefined();
    expect(byDesc("astrolabe artifact")?.styleRefId).toBeUndefined();
  });

  it("every unmatched character is unmatched because no frame fits, not by omission", () => {
    // The complement check: each style ref is either claimed by a character
    // or genuinely has no counterpart in the manifest. If this list shrinks,
    // a new match was made — mirror it in the count above.
    const claimed = new Set(matched.map((c) => c.styleRefId));
    const orphanFrames = STORY_STYLE_REFS.filter((r) => !claimed.has(r.id)).map((r) => r.id);
    expect(orphanFrames).toHaveLength(55 - 37);
  });
});
