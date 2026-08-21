/**
 * The actor resolver, proven against the REAL 74-entry registry.
 *
 * These are the guarantees the character-as-actor brick rests on: every
 * registered character resolves to an auditable actor; the 67 with owner frames
 * become RESOLVED with a real assetRef; the 7 without become
 * REFERENCE_UNAVAILABLE with a null assetRef and no substituted face; and the
 * free-text matcher is conservative enough that a bare "a woman" or a lone
 * region never latches onto an unrelated character. It fabricates nothing.
 */
import { describe, expect, it } from "vitest";
import { STORY_CHARACTER_REFS } from "@/data/storyCharacterRefs";
import {
  allActors,
  characterRefById,
  matchCharacter,
  resolveActors,
  styleRefFor,
  toActor,
} from "@/lib/storyActors";

describe("every registered character resolves to an auditable actor", () => {
  const actors = allActors();

  it("covers all 74 registry entries, one actor each", () => {
    expect(actors).toHaveLength(74);
    expect(new Set(actors.map((a) => a.characterRefId)).size).toBe(74);
  });

  it("the 67 matched characters are RESOLVED with a real reference asset", () => {
    const resolved = actors.filter((a) => a.status === "RESOLVED");
    expect(resolved).toHaveLength(67);
    for (const a of resolved) {
      expect(a.referenceAvailable, `${a.displayName}`).toBe(true);
      expect(a.styleRefId, `${a.displayName} styleRefId`).toBeTruthy();
      expect(typeof a.assetRef, `${a.displayName} assetRef`).toBe("string");
      expect((a.assetRef ?? "").length).toBeGreaterThan(0);
    }
  });

  it("the 7 unmatched characters are REFERENCE_UNAVAILABLE with no fabricated asset", () => {
    const missing = actors.filter((a) => a.status === "REFERENCE_UNAVAILABLE");
    expect(missing).toHaveLength(7);
    for (const a of missing) {
      expect(a.referenceAvailable).toBe(false);
      expect(a.assetRef).toBeNull();
      expect(a.styleRefId).toBeNull();
    }
  });

  it("no styleRefId is dangling — every link points at a real frame with a url", () => {
    for (const ref of STORY_CHARACTER_REFS) {
      if (!ref.styleRefId) continue;
      const style = styleRefFor(ref);
      expect(style, `${ref.styleRefId} for "${ref.description}"`).not.toBeNull();
      expect((style!.url ?? "").length).toBeGreaterThan(0);
    }
  });

  it("looks a character up by its stable externalAssetId", () => {
    const first = STORY_CHARACTER_REFS[0];
    expect(characterRefById(first.externalAssetId)?.description).toBe(first.description);
    expect(characterRefById("not-a-real-id")).toBeNull();
  });
});

describe("matchCharacter — deterministic and conservative", () => {
  it("matches a character from its own description words", () => {
    // Use a real entry so the assertion tracks the shipped registry.
    const weaver = STORY_CHARACTER_REFS.find((c) => /oaxacan weaver/i.test(c.description));
    expect(weaver, "expected the Oaxacan weaver in the registry").toBeTruthy();
    const m = matchCharacter("an Oaxacan weaver working a loom");
    expect(m?.ref.externalAssetId).toBe(weaver!.externalAssetId);
  });

  it("does NOT latch onto a character from a bare subject or region alone", () => {
    // "a woman" and a lone country must clear neither the hit floor nor the
    // score bar — otherwise every vague mention would wear someone's face.
    expect(matchCharacter("a woman")).toBeNull();
    expect(matchCharacter("someone in Mexico")).toBeNull();
  });

  it("returns null for an empty or all-stopword query", () => {
    expect(matchCharacter("")).toBeNull();
    expect(matchCharacter("the and of a")).toBeNull();
  });

  it("is reproducible — same query, same result", () => {
    const a = matchCharacter("Havana balcony musician playing guitar");
    const b = matchCharacter("Havana balcony musician playing guitar");
    expect(a?.ref.externalAssetId).toBe(b?.ref.externalAssetId);
  });

  it("only ever returns ids that exist in the registry (no fabrication)", () => {
    const ids = new Set(STORY_CHARACTER_REFS.map((c) => c.externalAssetId));
    for (const q of ["fisherman at sea", "weaver at a loom", "musician on a balcony"]) {
      const m = matchCharacter(q);
      if (m) expect(ids.has(m.ref.externalAssetId)).toBe(true);
    }
  });
});

describe("resolveActors — auditable, deduped, honest about misses", () => {
  it("resolves matched mentions and flags unmatched ones without inventing actors", () => {
    const res = resolveActors([
      "Oaxacan weaver working a backstrap loom",
      "a completely unregistered spaceship captain on Mars",
    ]);
    expect(res).toHaveLength(2);
    expect(res[0].matched).toBe(true);
    expect(res[0].actor?.status).toBe("RESOLVED");
    expect(res[1].matched).toBe(false);
    expect(res[1].actor).toBeNull();
  });

  it("dedupes the same character mentioned twice into one actor", () => {
    const res = resolveActors([
      "Oaxacan weaver working a backstrap loom",
      "the Oaxacan weaver at her loom again",
    ]);
    const matched = res.filter((r) => r.matched);
    const ids = new Set(matched.map((r) => r.actor!.characterRefId));
    expect(ids.size).toBe(1);
  });

  it("a matched-but-pictureless character surfaces as REFERENCE_UNAVAILABLE", () => {
    // Drive toActor directly on an entry with no styleRefId to prove the honest
    // degrade path independent of the matcher.
    const pictureless = STORY_CHARACTER_REFS.find((c) => !c.styleRefId);
    expect(pictureless, "expected at least one unmatched registry entry").toBeTruthy();
    const actor = toActor(pictureless!);
    expect(actor.status).toBe("REFERENCE_UNAVAILABLE");
    expect(actor.assetRef).toBeNull();
  });
});
