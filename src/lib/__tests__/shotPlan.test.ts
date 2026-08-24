/**
 * Shot-plan completeness pins (loop §20 A–O): retrieval per category, the
 * §11 multi-category example, the REFERENCE_UNCERTAIN discipline, the
 * excluded/unknown grammar handling, provenance survival, and — above all —
 * the explicit-generation boundary: a plan is analysis, never a render.
 */
import { describe, expect, it } from "vitest";

import { buildShotPlan, detectEmotion, EMOTIONS, NEGATIVE_CONSTRAINTS } from "../shotPlan.ts";

describe("emotion engineering (§10)", () => {
  it("covers the full 25-emotion vocabulary, each as a whole-body reading", () => {
    expect(EMOTIONS.length).toBe(25);
    for (const e of EMOTIONS) {
      for (const field of ["face", "gaze", "posture", "gesture", "bodyState", "context"] as const) {
        expect(e[field].length, `${e.emotion}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("detects adjective forms and stays identity-free", () => {
    expect(detectEmotion("an exhausted traveller")?.emotion).toBe("exhaustion");
    expect(detectEmotion("she is determined")?.emotion).toBe("determination");
    expect(detectEmotion("a plain sentence")).toBeNull();
    const banned = /ethnicit|gender|nationalit|religio|occupation/i;
    for (const e of EMOTIONS) expect(JSON.stringify(e)).not.toMatch(banned);
  });
});

describe("the §11 multi-category example", () => {
  const plan = buildShotPlan("An exhausted character walks slowly through a rainy modern city street at night.");

  it("produces one structured plan touching character, motion, scene, weather, time, lighting and camera", () => {
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.emotion).toBe("exhaustion");
    expect(plan.character.emotionReading?.posture).toContain("drooping");
    expect(plan.motion).toEqual({ grammar: "walking", status: "PRIMARY" });
    expect(plan.action).toContain("walking");
    expect(plan.weather).toBe("rain");
    expect(plan.time).toBe("night");
    expect(plan.environment).toContain("urban street");
    expect(plan.environment).toContain("wet pavement with reflections");
    expect(plan.lighting).toContain("streetlight");
    expect(plan.camera.lane).toBe("frontal/near_frontal");
    expect(plan.shelves).toEqual(
      expect.arrayContaining(["LIGHTING", "SCENE", "MOTION ENGINEERING", "CHARACTER ENGINEERING"]),
    );
  });

  it("carries the measured constraints and every negative constraint", () => {
    if (!plan.ok) throw new Error("plan failed");
    expect(plan.engineeringConstraints.join("\n")).toContain("aliveness >= 0.75");
    expect(plan.engineeringConstraints.join("\n")).toContain("knee damping 0.5");
    expect(plan.engineeringConstraints.join("\n")).toContain("no border contact");
    expect(plan.negativeConstraints).toBe(NEGATIVE_CONSTRAINTS);
    expect(NEGATIVE_CONSTRAINTS.length).toBe(24);
  });
});

describe("the remaining representative queries (final-audit pins)", () => {
  it("curious / foggy forest / dawn", () => {
    const p = buildShotPlan("A curious character walks through a foggy forest at dawn.");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.emotion).toBe("curiosity");
    expect(p.motion?.grammar).toBe("walking");
    expect(p.weather).toBe("fog");
    expect(p.time).toBe("sunrise");
    expect(p.environment).toEqual(expect.arrayContaining(["forest", "atmospheric fog depth"]));
  });

  it("determined / historical marketplace / sunset", () => {
    const p = buildShotPlan("A determined character walks through a historical marketplace at sunset.");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.emotion).toBe("determination");
    expect(p.motion?.grammar).toBe("walking");
    expect(p.time).toBe("sunset");
  });

  it("frightened / industrial facility / storm — plans without a motion (standing pose)", () => {
    const p = buildShotPlan("A frightened character stands inside a dark industrial facility during a storm.");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.emotion).toBe("fear");
    expect(p.motion).toBeNull();
    expect(p.explicitGenerationRequired).toBe(true);
  });

  it("joyful / bright modern city / morning", () => {
    const p = buildShotPlan("A joyful character walks through a bright modern city in the morning.");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.emotion).toBe("joy");
    expect(p.motion).toEqual({ grammar: "walking", status: "PRIMARY" });
    expect(p.time).toBe("morning");
    expect(p.environment).toContain("urban street");
  });
});

describe("uncertainty and grammar discipline (§12, §9)", () => {
  it("a request matching nothing yields REFERENCE_UNCERTAIN with the safe fallback, never invented constraints", () => {
    const r = buildShotPlan("qwxz 999");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("REFERENCE_UNCERTAIN");
      expect(r.fallback).toEqual({ action: "STILL_PARALLAX", contract: "MOTION_CONTRACT" });
    }
  });

  it("UNKNOWN grammars (turn/reach) refuse to plan; wave never enters a plan's motion", () => {
    const turn = buildShotPlan("the character turns in the street");
    expect(turn.ok).toBe(false);
    const wave = buildShotPlan("the character waves in the street");
    expect(wave.ok).toBe(true);
    if (wave.ok) {
      expect(wave.motion).toBeNull();
      expect(wave.engineeringConstraints.join("\n")).toContain("EXCLUDED");
    }
  });
});

describe("provenance and the explicit-generation boundary (§13)", () => {
  it("reference provenance survives into the plan and unknown ids fail closed", () => {
    const good = buildShotPlan("a rainy street scene", { referenceIds: ["SCN-002"], engineeringReferenceIds: ["ENG-004"] });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.referenceProvenance.map((r) => r.reference_id)).toEqual(["SCN-002", "ENG-004"]);
      for (const r of good.referenceProvenance) expect(r.reference_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const bad = buildShotPlan("a rainy street scene", { referenceIds: ["SCN-999"] });
    expect(bad.ok).toBe(false);
  });

  it("a plan is pure analysis: explicit generation stays required and the module performs no I/O", async () => {
    const plan = buildShotPlan("a night market scene");
    expect(plan.ok && plan.explicitGenerationRequired).toBe(true);
    // Boundary pin at the source level: no network, storage, or job client
    // enters this module — retrieval can never launch generation.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../shotPlan.ts", import.meta.url), "utf8"),
    );
    for (const banned of ["fetch(", "supabase", "XMLHttpRequest", "storyJobsClient", "claim_story_seconds"]) {
      expect(src).not.toContain(banned);
    }
  });
});
