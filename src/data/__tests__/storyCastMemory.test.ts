/**
 * THE GENERATOR'S COPY OF THE CAST IS THE SAME CAST.
 *
 * The 74-entry manifest and the 55 uploaded frames live in src/data/, where
 * the app can read them. Nothing that spends money on a generation runs in the
 * app: story-plot, story-still and the worker are Deno, and they cannot import
 * a Vite alias or a `.asset.json`. So the merged catalogue is mirrored into
 * supabase/functions/_shared/storyCast.ts, and this file is what stops the two
 * from drifting.
 *
 * It re-derives the mirror from the sources — descriptions, frame URLs and the
 * scene/sheet attachable rule — and compares the whole list. A frame renamed
 * in storyStyleRefs.ts, a styleRefId added to a character, a new upload: any
 * of them fails here until the mirror is regenerated in the same commit.
 *
 * The drift this is really guarding is silent. A stale frame URL does not
 * throw — it points at an asset that no longer exists, the reference quietly
 * 404s, and the generation still returns a picture, just not the house's one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STORY_CHARACTER_REFS } from "@/data/storyCharacterRefs";
import { STORY_STYLE_REFS } from "@/data/storyStyleRefs";
import {
  STORY_CAST,
  castBlock,
  castFor,
  type StoryCastMember,
} from "../../../supabase/functions/_shared/storyCast.ts";

const ROOT = process.cwd();

/** What the mirror SHOULD be, rebuilt from the two source catalogues. */
const expected: StoryCastMember[] = STORY_CHARACTER_REFS.map((c) => {
  const row: StoryCastMember = { region: c.region, description: c.description };
  if (!c.styleRefId) return row;
  const frame = STORY_STYLE_REFS.find((r) => r.id === c.styleRefId);
  if (!frame) throw new Error(`${c.region}: styleRefId "${c.styleRefId}" resolves to nothing`);
  row.frame = frame.url;
  // Scenes are look references and may be attached. Character sheets carry
  // several views on one canvas; a model handed one paints the sheet.
  row.attachable = frame.kind === "scene";
  return row;
});

describe("the generator's cast mirror", () => {
  it("carries every character from the manifest, in manifest order", () => {
    expect(STORY_CAST).toHaveLength(STORY_CHARACTER_REFS.length);
    expect(STORY_CAST.map((c) => c.description)).toEqual(expected.map((c) => c.description));
  });

  it("agrees with the sources entry for entry — frames, regions and all", () => {
    // Whole-object equality rather than field spot-checks: a mirror that
    // matches on three fields and drifts on the fourth is the failure mode.
    expect([...STORY_CAST]).toEqual(expected);
  });

  it("never marks a character SHEET attachable", () => {
    // The ep3/ep4 runbook rule, restated where it can break: sheets are human
    // direction. If one is ever attached to a generation the shot comes back
    // as a contact sheet of expressions instead of a frame.
    const sheetIds = new Set(STORY_STYLE_REFS.filter((r) => r.kind === "sheet").map((r) => r.url));
    for (const c of STORY_CAST) {
      if (c.frame && sheetIds.has(c.frame)) {
        expect(c.attachable, `${c.region} is a sheet and must not be attachable`).toBe(false);
      }
    }
  });

  it("every frame URL points at a pointer that exists on disk", () => {
    // The mirror stores the resolved URL, not the id, so a deleted or renamed
    // asset pointer would otherwise only surface as a 404 mid-generation.
    const urls = new Set(STORY_STYLE_REFS.map((r) => r.url));
    for (const c of STORY_CAST) {
      if (c.frame)
        expect(urls.has(c.frame), `${c.region}: ${c.frame} is not a known frame`).toBe(true);
    }
  });
});

describe("casting a prompt", () => {
  it("finds the manifest entry a prompt is plainly describing", () => {
    const cast = castFor("a shepherd on a ridge overlooking a terraced valley");
    expect(cast[0]?.region).toBe("Kurdistan region");
  });

  it("takes two matching words, not one", () => {
    // One shared word is a coincidence. "market" alone appears in Jamaica,
    // Bolivia, Morocco and Panama at once — casting all four from it would
    // put four strangers in a story that asked for none of them.
    expect(castFor("market")).toHaveLength(0);
  });

  it("is deterministic — a retry of a failed shot casts the same people", () => {
    const idea = "a weaver at a handloom by a frozen lake in Srinagar";
    expect(castFor(idea)).toEqual(castFor(idea));
  });

  it("stays quiet when the story is nobody in the manifest", () => {
    expect(castFor("two robots argue about parking on a space station")).toHaveLength(0);
    expect(castBlock("two robots argue about parking on a space station")).toBe("");
  });

  it("the block names the region and the description, so a lock can be written from it", () => {
    const block = castBlock("a shepherd on a ridge overlooking a terraced valley");
    expect(block).toContain("Kurdistan region");
    expect(block).toContain("Shepherd on a ridge");
  });

  it("is bounded — a prompt touching half the manifest still casts a handful", () => {
    const greedy = STORY_CAST.map((c) => c.description).join(" ");
    expect(castFor(greedy).length).toBeLessThanOrEqual(4);
  });
});

describe("story-plot actually uses it", () => {
  const plot = readFileSync(join(ROOT, "supabase/functions/story-plot/index.ts"), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const code = strip(plot);

  it("imports the shared cast rather than re-listing it", () => {
    expect(code).toContain('from "../_shared/storyCast.ts"');
  });

  it("puts the cast into BOTH plan prompts — the short film and the spine", () => {
    // Long films are planned as a spine first. A house cast offered only to
    // short films would mean every Story over twelve shots quietly loses it.
    const uses = code.match(/\$\{houseCastBlock\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("yields to the user's own recurring cast", () => {
    // Two "cast these people" blocks in one prompt argue with each other, and
    // the user's own library wins that argument.
    expect(code).toMatch(/reuse\.length > 0 \? "" : castBlock\(prompt\)/);
  });
});
