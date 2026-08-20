import { describe, expect, it } from "vitest";
import {
  classifyRegenerationNeeds,
  createProductionState,
  evaluateCinematicQuality,
  evaluateContinuity,
  evaluateVisualQuality,
  selectBestCandidate,
  updateProductionStateWithAcceptedShot,
} from "@/lib/storyQcIntelligence";

describe("story continuity intelligence", () => {
  it("accepts stable character continuity", () => {
    const out = evaluateContinuity({
      shotIndex: 1,
      shotStill: "wide shot: Asha in red scarf at the same village gate",
      shotNarration: "Asha reaches the gate she left moments ago.",
      previousAcceptedShot: {
        id: 1,
        still: "medium shot: Asha in red scarf walking toward the village gate",
        narration: "Asha walks toward the village gate.",
      },
      characterBible: { Asha: "teen girl with red scarf and silver bracelet" },
    });
    expect(out.score).toBeGreaterThanOrEqual(70);
    expect(["PASS", "WARN"]).toContain(out.status);
  });

  it("detects unexpected discontinuity", () => {
    const out = evaluateContinuity({
      shotIndex: 2,
      shotStill: "astronaut drifting through a neon corridor in orbit",
      shotNarration: "A hard cut lands him in deep space.",
      previousAcceptedShot: {
        id: 2,
        still: "fisherman at the monsoon pier beside anchored boats",
        narration: "He waits by the rain-soaked harbor.",
      },
      characterBible: { Ravi: "middle-aged fisherman in blue raincoat" },
    });
    expect(out.score).toBeLessThanOrEqual(70);
    expect(out.findings.length).toBeGreaterThan(0);
  });

  it("tracks production state only from accepted shots", () => {
    const initial = createProductionState({
      setting: "Monsoon harbor at dusk",
      cast: [{ name: "Ravi", lock: "man wearing blue raincoat" }],
    });
    const next = updateProductionStateWithAcceptedShot(initial, {
      shotId: 1,
      still: "wide shot: Ravi in blue raincoat at harbor",
      narration: "Ravi checks the rope knots.",
      cast: [{ name: "Ravi", lock: "man wearing blue raincoat" }],
    });
    expect(next.shotState).toHaveLength(1);
    expect(next.wardrobeState.Ravi).toContain("blue raincoat");
    expect(initial.shotState).toHaveLength(0);
  });
});

describe("visual and cinematic scoring", () => {
  it("flags severe visual outliers", () => {
    const visual = evaluateVisualQuality({ stillLuma: 3, clipLuma: 250, clipFps: 15 });
    expect(visual.score).toBeLessThan(80);
    expect(["WARN", "REGENERATE", "FAIL"]).toContain(visual.status);
  });

  it("keeps cinematic score separate from technical", () => {
    const cinematic = evaluateCinematicQuality({
      technicalScore: 92,
      continuityScore: 55,
      hasSubjectCue: true,
      hasMotionCue: false,
      framing: { figureHeight: 0.9, pan: 1, travel: 0.1 },
    });
    expect(cinematic.score).toBeLessThan(92);
    expect(cinematic.findings.length).toBeGreaterThan(0);
  });
});

describe("regeneration + selector", () => {
  it("classifies targeted regeneration focus", () => {
    const out = classifyRegenerationNeeds({
      failedCheckNames: ["audio.decode", "clip.fps"],
      continuityStatus: "REGENERATE",
      continuityFindings: [
        {
          severity: "medium",
          category: "wardrobe",
          evidence: "wardrobe mismatch",
          confidence: 0.8,
          affectedShotIds: [1, 2],
          recommendedAction: "repeat wardrobe lock",
          status: "REGENERATE",
        },
      ],
      cinematicStatus: "WARN",
    });
    expect(out.focus).toEqual(expect.arrayContaining(["audio", "clip", "continuity"]));
  });

  it("chooses the best valid candidate", () => {
    const { winner, ranked } = selectBestCandidate([
      {
        technicalScore: 78,
        continuityScore: 90,
        cinematicScore: 74,
        storyRelevance: 88,
        audioCompatibility: 100,
        generationConfidence: 84,
      },
      {
        technicalScore: 95,
        continuityScore: 71,
        cinematicScore: 68,
        storyRelevance: 79,
        audioCompatibility: 90,
        generationConfidence: 70,
      },
    ]);
    expect(winner).not.toBeNull();
    expect(ranked[0].composite).toBeGreaterThanOrEqual(ranked[1].composite);
  });
});
