/**
 * ENGINEERING MODE pins — the same three contracts shotDirector lives under,
 * applied to the structured-intent layer:
 *
 *   1. Weather honesty — the phrase emitted for every weather choice earns
 *      EXACTLY the overlay class the module promises (WEATHER_VFX), measured
 *      against the live vfxKindFor, not assumed. Season trigger classes are
 *      pinned the same way (that "winter" reads as snow is a fact the
 *      conflict warning depends on).
 *   2. Weather neutrality everywhere else — no lighting or mood phrase may
 *      register with vfxKindFor (it would silently change a film's weather)
 *      or ambienceFor (it would change its sound bed).
 *   3. Fail-closed — unknown vocabulary never reaches a prompt; a budget
 *      overflow returns the user's own words untouched; an empty intent is
 *      byte-for-byte the existing behavior.
 *
 * Plus provenance: the frozen scene-library registry must carry real
 * 64-hex hashes, unique, and refuse unknown reference ids.
 */
import { describe, expect, it } from "vitest";

import { vfxKindFor } from "../particleField.ts";
import { ambienceFor } from "../soundStage.ts";
import {
  attachIntentToPrompt,
  describeShotIntent,
  DIMENSION_SUPPORT,
  LIGHTING_STYLES,
  MOODS,
  MOTION_GRAMMAR,
  PROMPT_BUDGET,
  provenanceFor,
  SCENE_REFERENCE_REGISTRY,
  SEASON_VFX,
  SEASONS,
  type ShotIntent,
  validateShotIntent,
  WEATHER_PHRASE,
  WEATHER_VFX,
  WEATHERS,
} from "../videoEngineering.ts";

const FULL_INTENT: ShotIntent = {
  environmentType: "village",
  sceneScale: "human scale",
  depth: "layered depth to the far background",
  cameraAngle: "low angle",
  composition: "rule-of-thirds composition",
  lighting: "soft key light with gentle fill",
  timeOfDay: "golden hour",
  weather: "rain",
  season: "monsoon",
  materials: ["stone", "wood"],
  mood: "peaceful tone",
  storyBeat: "establishing",
  referenceIds: ["SCN-002"],
};

describe("weather honesty", () => {
  it("every weather phrase earns exactly the promised overlay class", () => {
    for (const w of WEATHERS) {
      expect(vfxKindFor(WEATHER_PHRASE[w]), `weather "${w}" → "${WEATHER_PHRASE[w]}"`).toBe(WEATHER_VFX[w]);
    }
  });

  it("every season's own word earns exactly the class the conflict warning assumes", () => {
    for (const s of SEASONS) {
      expect(vfxKindFor(s), `season "${s}"`).toBe(SEASON_VFX[s]);
    }
  });

  it("a class-conflicting weather+season pair is applied with a warning, never silently", () => {
    const v = validateShotIntent({ weather: "rain", season: "winter" });
    expect(v.ok).toBe(true);
    expect(v.warnings.length).toBe(1);
    const clean = validateShotIntent({ weather: "rain", season: "monsoon" });
    expect(clean.warnings).toEqual([]);
  });
});

describe("weather and ambience neutrality of the non-weather vocabulary", () => {
  it("every lighting phrase is invisible to both classifiers", () => {
    for (const phrase of LIGHTING_STYLES) {
      expect(vfxKindFor(phrase), phrase).toBeNull();
      expect(ambienceFor(phrase), phrase).toBeNull();
    }
  });

  it("every mood phrase is invisible to both classifiers", () => {
    for (const phrase of MOODS) {
      expect(vfxKindFor(phrase), phrase).toBeNull();
      expect(ambienceFor(phrase), phrase).toBeNull();
    }
  });
});

describe("serialization", () => {
  it("is deterministic and fully populated for a full intent", () => {
    const a = describeShotIntent(FULL_INTENT);
    const b = describeShotIntent({ ...FULL_INTENT });
    expect(a).toBe(b);
    expect(a.startsWith("Cinematic intent — ")).toBe(true);
    expect(a).toContain("story beat: establishing");
    expect(a).toContain("setting: village");
    expect(a).toContain("visible materials: stone, wood");
  });

  it("an empty intent serializes to nothing and attaches nothing", () => {
    expect(describeShotIntent({})).toBe("");
    const r = attachIntentToPrompt("a quiet fable", {});
    expect(r).toEqual({ prompt: "a quiet fable", applied: false, reason: "empty-intent" });
  });
});

describe("fail-closed validation and budget", () => {
  it("rejects unknown vocabulary with a structured reason", () => {
    const v = validateShotIntent({ lighting: "torchlit gloom" });
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain("unknown lighting");
    const r = attachIntentToPrompt("a fable", { lighting: "torchlit gloom" });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("invalid-intent");
    expect(r.prompt).toBe("a fable");
  });

  it("drops the whole block rather than truncating the user's words at the 5000-char budget", () => {
    const long = "x".repeat(PROMPT_BUDGET - 10);
    const r = attachIntentToPrompt(long, FULL_INTENT);
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("prompt-budget");
    expect(r.prompt).toBe(long);
  });

  it("applies within budget, appending after a blank line", () => {
    const r = attachIntentToPrompt("a fable of the harbour", FULL_INTENT);
    expect(r.applied).toBe(true);
    expect(r.prompt.startsWith("a fable of the harbour\n\nCinematic intent — ")).toBe(true);
    expect(r.prompt.length).toBeLessThanOrEqual(PROMPT_BUDGET);
  });
});

describe("frozen-library provenance", () => {
  it("registry entries carry unique, well-formed sha256 hashes", () => {
    const seen = new Set<string>();
    for (const ref of SCENE_REFERENCE_REGISTRY) {
      expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(seen.has(ref.sha256)).toBe(false);
      seen.add(ref.sha256);
    }
    expect(SCENE_REFERENCE_REGISTRY.length).toBe(6);
  });

  it("provenanceFor round-trips known ids and refuses unknown ones", () => {
    const ok = provenanceFor(["SCN-001", "SCN-009"]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.refs[0]).toEqual({
        reference_id: "SCN-001",
        reference_sha256: "11e1c05a3de7a609fdc13139a0b63aff57ddfac80345f4f9d4a19cda4632f86c",
        reference_category: "SCENES/ENGINEERING",
      });
    }
    const bad = provenanceFor(["SCN-999"]);
    expect(bad.ok).toBe(false);
    const viaIntent = validateShotIntent({ referenceIds: ["SCN-404"] });
    expect(viaIntent.ok).toBe(false);
  });
});

describe("honest capability surface", () => {
  it("camera motion and physics FX are provider-dependent, never presented as enforced", () => {
    expect(DIMENSION_SUPPORT.cameraMotion).toBe("provider-dependent");
    expect(DIMENSION_SUPPORT.physicsFx).toBe("provider-dependent");
    expect(DIMENSION_SUPPORT.weather).toBe("structured");
    expect(DIMENSION_SUPPORT.lighting).toBe("structured");
  });

  it("the motion grammar promotes only measured motions — walking primary at knee damping 0.50", () => {
    const walking = MOTION_GRAMMAR.find((m) => m.motion === "walking");
    expect(walking?.rank).toBe("PRIMARY");
    expect(walking && "kneeDamping" in walking ? walking.kneeDamping : null).toBe(0.5);
    for (const m of MOTION_GRAMMAR.filter((g) => g.motion === "wave" || g.motion === "reach")) {
      expect(m.rank).toBe("UNPROMOTED");
    }
  });
});
