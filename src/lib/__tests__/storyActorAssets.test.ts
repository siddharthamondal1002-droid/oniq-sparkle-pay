/**
 * The worker-consumable actor-asset map cannot drift from the real registry.
 *
 * src/data/storyActorAssets.ts is a GENERATED, alias-free snapshot the Node
 * story worker imports (it cannot read the bundler-land registry — "@/" alias +
 * Vite ".asset.json" imports). This test recomputes the expected mapping from
 * the live STORY_CHARACTER_REFS / STORY_STYLE_REFS (which vitest CAN import) and
 * asserts the committed snapshot matches exactly. If a character↔frame link
 * moves, this fails until the map is regenerated (scratchpad/gen-actor-assets.mjs).
 */
import { describe, expect, it } from "vitest";
import { STORY_CHARACTER_REFS } from "@/data/storyCharacterRefs";
import { STORY_STYLE_REFS } from "@/data/storyStyleRefs";
import {
  ACTOR_ASSETS,
  ONIQ_ASSET_ORIGIN,
  assetUrl,
  referenceEligible,
  type ActorAsset,
} from "@/data/storyActorAssets";

const STYLE_URL = new Map(STORY_STYLE_REFS.map((s) => [s.id, s.url]));
const CHAR_BY_ID = new Map(STORY_CHARACTER_REFS.map((c) => [c.externalAssetId, c]));
const MAP_BY_ID = new Map(ACTOR_ASSETS.map((a) => [a.characterRefId, a]));

describe("the generated map mirrors the live registry", () => {
  it("covers exactly the 67 matched characters, no more, no fewer", () => {
    const matched = STORY_CHARACTER_REFS.filter((c) => c.styleRefId);
    expect(ACTOR_ASSETS).toHaveLength(67);
    expect(matched).toHaveLength(67);
    expect(new Set(ACTOR_ASSETS.map((a) => a.characterRefId)).size).toBe(67);
  });

  it("every map entry agrees with its registry entry (id, styleRefId, asset url)", () => {
    for (const a of ACTOR_ASSETS) {
      const ref = CHAR_BY_ID.get(a.characterRefId);
      expect(ref, `${a.characterRefId} in registry`).toBeTruthy();
      expect(a.styleRefId, `${a.styleRefId} styleRefId`).toBe(ref!.styleRefId);
      expect(a.region).toBe(ref!.region);
      expect(a.description).toBe(ref!.description);
      // The asset path is the style frame's url verbatim — the real owner image.
      expect(a.assetPath, `${a.styleRefId} url`).toBe(STYLE_URL.get(a.styleRefId));
      expect(a.assetPath.length).toBeGreaterThan(0);
    }
  });

  it("every matched registry character is present in the map", () => {
    for (const c of STORY_CHARACTER_REFS) {
      if (!c.styleRefId) continue;
      expect(MAP_BY_ID.has(c.externalAssetId), `${c.description} missing from map`).toBe(true);
    }
  });
});

describe("kind + eligibility mirror the registry (sheet gating)", () => {
  const STYLE_KIND = new Map(STORY_STYLE_REFS.map((s) => [s.id, s.kind]));

  it("every actor carries kind, matching its style frame's kind", () => {
    for (const a of ACTOR_ASSETS) {
      expect(["scene", "sheet"]).toContain(a.kind);
      expect(a.kind, `${a.styleRefId} kind`).toBe(STYLE_KIND.get(a.styleRefId));
    }
  });

  it("the 9 sheet actors are NOT reference-eligible; scenes are", () => {
    const sheets = ACTOR_ASSETS.filter((a) => a.kind === "sheet");
    const scenes = ACTOR_ASSETS.filter((a) => a.kind === "scene");
    expect(sheets).toHaveLength(9);
    expect(scenes.length).toBe(67 - 9);
    for (const a of sheets) expect(referenceEligible(a)).toBe(false);
    for (const a of scenes) expect(referenceEligible(a)).toBe(true);
  });
});

describe("assetUrl builds a fetchable ONIQ origin URL", () => {
  it("prefixes the ONIQ asset origin the probe proved fetchable", () => {
    expect(ONIQ_ASSET_ORIGIN).toBe("https://oniqhub.com");
    const a: ActorAsset = ACTOR_ASSETS[0];
    expect(assetUrl(a)).toBe(`https://oniqhub.com${a.assetPath}`);
    expect(assetUrl(a)).toMatch(/^https:\/\/oniqhub\.com\/__l5e\/assets-v1\//);
  });
});
