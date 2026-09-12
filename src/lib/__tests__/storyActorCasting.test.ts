/**
 * Casting matcher (worker-side, alias-free) — same conservative behaviour as the
 * app-side resolver, proven against the real owner-asset map.
 */
import { describe, expect, it } from "vitest";
import { ACTOR_ASSETS } from "@/data/storyActorAssets";
import { castShot, matchActor } from "@/lib/storyActorCasting";
import { APP_ORIGIN } from "@/config/appOrigin";

describe("matchActor — conservative, deterministic, owner-map only", () => {
  it("matches a registered actor from its description and returns a fetch URL", () => {
    const m = matchActor("an Oaxacan weaver working a backstrap loom");
    expect(m).not.toBeNull();
    expect(m!.referenceUrl.startsWith(`${APP_ORIGIN}/__l5e/assets-v1/`)).toBe(true);
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

describe("ACTOR ASSET ≠ PERMANENT BIOGRAPHY — reusable reference, current description wins", () => {
  // The product rule: an owner asset is a REUSABLE VISUAL reference, never a
  // fixed biography. It is attached only when the CURRENT shot text already
  // agrees with it (text-driven selection), and even then it contributes image
  // conditioning only — 100% of the generation prompt is the current shot. So a
  // divergent description can never make the asset impose a contradicting
  // ethnicity/gender/age/occupation/location: it simply is not selected, and the
  // shot falls back to text-only. These pin that a stored description cannot
  // override a contradicting current request. (Audit 2026-08-21: no bug; guard.)
  const FISH_MARKET = "caribbean-fish-market"; // region Jamaica, "Fishmonger woman ... coastal market"

  it("a matching current description selects the asset (reuse works)", () => {
    const m = matchActor("a Jamaican fishmonger woman arranging fresh fish at a coastal market");
    expect(m?.actor.styleRefId).toBe(FISH_MARKET);
  });

  it("a divergent description does NOT bind that same asset (current wins, no biography lock)", () => {
    // Same visual family could be *reused* by the owner, but the current shot
    // says something else entirely — a different ethnicity, occupation and
    // place. The Jamaica fishmonger asset must not latch on and make her wear
    // the wrong identity; the matcher yields it (text-only fallback instead).
    const m = matchActor("a middle-aged Bengali woman selling saris in a Kolkata bazaar");
    expect(m?.actor.styleRefId).not.toBe(FISH_MARKET);
  });

  it("a bare shared subject ('woman') never latches the asset onto an unrelated occupation", () => {
    // "woman" alone is one shared token; the two-token floor keeps it from
    // binding a specific registered actor to a generic, unrelated description.
    const m = matchActor("a young Japanese office worker, a woman, at her desk");
    expect(m?.actor.styleRefId).not.toBe(FISH_MARKET);
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
