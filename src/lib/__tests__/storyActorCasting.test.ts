/**
 * Casting matcher (worker-side, alias-free) — same conservative behaviour as the
 * app-side resolver, proven against the real owner-asset map.
 */
import { describe, expect, it } from "vitest";
import { ACTOR_ASSETS } from "@/data/storyActorAssets";
import { castShot, matchActor } from "@/lib/storyActorCasting";

describe("matchActor — conservative, deterministic, owner-map only", () => {
  it("matches a registered actor from its description and returns a fetch URL", () => {
    const m = matchActor("an Oaxacan weaver working a backstrap loom");
    expect(m).not.toBeNull();
    expect(m!.referenceUrl).toMatch(/^https:\/\/oniqhub\.com\/__l5e\/assets-v1\//);
    expect(ACTOR_ASSETS.some((a) => a.characterRefId === m!.actor.characterRefId)).toBe(true);
  });

  it("never latches onto a bare subject or lone region", () => {
    expect(matchActor("a woman")).toBeNull();
    expect(matchActor("someone in Mexico")).toBeNull();
    expect(matchActor("")).toBeNull();
  });

  it("is reproducible", () => {
    const a = matchActor("Oaxacan weaver at a loom");
    const b = matchActor("Oaxacan weaver at a loom");
    expect(a?.actor.characterRefId).toBe(b?.actor.characterRefId);
  });

  it("marks a sheet-source match ineligible (identity right, not attachable)", () => {
    // The Oaxacan weaver's frame is a -sheet; it must still match by identity
    // but carry eligible:false so the worker degrades to text-only, never a
    // substituted actor.
    const m = matchActor("Oaxacan weaver at a backstrap loom");
    expect(m?.actor.kind).toBe("sheet");
    expect(m?.eligible).toBe(false);
  });

  it("marks a scene-source match eligible", () => {
    const m = matchActor("Greek fisherman mending nets by the sea");
    expect(m?.actor.kind).toBe("scene");
    expect(m?.eligible).toBe(true);
  });
});

describe("castShot — only relevant actors, capped, deduped", () => {
  it("returns at most `max` distinct actors, best first", () => {
    const cast = castShot(["Oaxacan weaver at her loom", "Oaxacan weaver again"], { max: 2 });
    expect(cast.length).toBeLessThanOrEqual(2);
    const ids = new Set(cast.map((c) => c.actor.characterRefId));
    expect(ids.size).toBe(cast.length); // deduped
  });

  it("returns nothing when no text names a registered actor", () => {
    expect(castShot(["a spaceship over Mars", "a generic office"])).toHaveLength(0);
  });
});
