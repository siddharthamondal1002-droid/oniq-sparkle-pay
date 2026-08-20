import { describe, expect, it } from "vitest";
import {
  candidateNeedsRegeneration,
  chooseAcceptedCandidate,
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

  it("does not average a blocking character finding back to PASS", () => {
    const out = evaluateContinuity({
      shotIndex: 0,
      shotStill: "Asha waits at the village gate",
      shotNarration: "Asha watches the road.",
      characterBible: { Asha: "silver-haired pilot wearing a green coat" },
    });
    expect(out.score).toBe(82);
    expect(out.findings.some((finding) => finding.status === "REGENERATE")).toBe(true);
    expect(out.status).toBe("REGENERATE");
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

  it("does not average a blocking visual finding back to PASS", () => {
    const visual = evaluateVisualQuality({ stillLuma: 10 });
    expect(visual.score).toBe(80);
    expect(visual.findings.some((finding) => finding.status === "REGENERATE")).toBe(true);
    expect(visual.status).toBe("REGENERATE");
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

  it("regenerates when cinematic QC is the only blocking domain", () => {
    const cinematic = evaluateCinematicQuality({
      technicalScore: 100,
      continuityScore: 80,
      hasSubjectCue: false,
      hasMotionCue: false,
      framing: { figureHeight: 0.9, pan: 1, travel: 0 },
    });
    expect(cinematic.score).toBe(59);
    expect(cinematic.status).toBe("REGENERATE");
    expect(
      candidateNeedsRegeneration({
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: cinematic.status,
      }),
    ).toBe(true);
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
      cinematicStatus: "FAIL",
    });
    expect(out.focus).toEqual(expect.arrayContaining(["audio", "clip", "continuity", "camera"]));
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

  it("requires regeneration when continuity or visual status fails even if technical QC passed", () => {
    expect(
      candidateNeedsRegeneration({
        qcPassed: true,
        continuityStatus: "REGENERATE",
        visualStatus: "PASS",
        cinematicStatus: "PASS",
      }),
    ).toBe(true);
    expect(
      candidateNeedsRegeneration({
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "FAIL",
        cinematicStatus: "PASS",
      }),
    ).toBe(true);
    expect(
      candidateNeedsRegeneration({
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: "REGENERATE",
      }),
    ).toBe(true);
    expect(
      candidateNeedsRegeneration({
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: "PASS",
      }),
    ).toBe(false);
  });

  it("prefers the highest-ranked acceptable candidate over a higher-ranked rejected one", () => {
    const { winner } = chooseAcceptedCandidate([
      {
        technicalScore: 99,
        continuityScore: 96,
        cinematicScore: 92,
        storyRelevance: 95,
        audioCompatibility: 100,
        generationConfidence: 95,
        qcPassed: true,
        continuityStatus: "REGENERATE",
        visualStatus: "PASS",
        cinematicStatus: "PASS",
      },
      {
        technicalScore: 90,
        continuityScore: 82,
        cinematicScore: 81,
        storyRelevance: 84,
        audioCompatibility: 100,
        generationConfidence: 88,
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: "PASS",
      },
    ]);
    expect(winner).not.toBeNull();
    expect(winner?.continuityStatus).toBe("PASS");
  });

  it("rejects a higher-ranked candidate with blocking cinematic QC", () => {
    const { winner } = chooseAcceptedCandidate([
      {
        technicalScore: 99,
        continuityScore: 96,
        cinematicScore: 92,
        storyRelevance: 95,
        audioCompatibility: 100,
        generationConfidence: 95,
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: "REGENERATE",
      },
      {
        technicalScore: 90,
        continuityScore: 82,
        cinematicScore: 81,
        storyRelevance: 84,
        audioCompatibility: 100,
        generationConfidence: 88,
        qcPassed: true,
        continuityStatus: "PASS",
        visualStatus: "PASS",
        cinematicStatus: "PASS",
      },
    ]);
    expect(winner?.cinematicStatus).toBe("PASS");
  });
});

describe("cv-backed continuity evidence", () => {
  it("regenerates on high-confidence observed mismatch", () => {
    const out = evaluateContinuity({
      shotIndex: 3,
      shotStill: "Ravi stands near the same harbor gate",
      shotNarration: "He watches the rain gather.",
      observedShot: {
        expectedShotId: 4,
        observedCutCount: 3,
        classification: "MISMATCH",
        confidence: 0.91,
        reasons: ["multiple_internal_cuts"],
      },
    });
    expect(out.status).toMatch(/REGENERATE|FAIL/);
    expect(out.findings.some((f) => f.category === "temporal" && f.status === "REGENERATE")).toBe(true);
  });

  it("keeps low-confidence cv mismatch as warning evidence", () => {
    const out = evaluateContinuity({
      shotIndex: 1,
      shotStill: "Asha walks through mist by the village gate",
      shotNarration: "The shot continues calmly.",
      observedShot: {
        expectedShotId: 2,
        observedCutCount: 2,
        classification: "MISMATCH",
        confidence: 0.31,
        reasons: ["low_confidence"],
      },
    });
    expect(out.findings.some((f) => f.status === "REGENERATE")).toBe(false);
    expect(out.findings.some((f) => f.status === "WARN")).toBe(true);
  });

  it("keeps UNKNOWN observed-shot evidence non-blocking", () => {
    const out = evaluateContinuity({
      shotIndex: 2,
      shotStill: "Ravi waits at the same harbor rail",
      shotNarration: "The wind rises over the same dock.",
      observedShot: {
        expectedShotId: 3,
        observedCutCount: 4,
        classification: "UNKNOWN",
        confidence: 0.2,
        reasons: ["low_confidence"],
      },
    });
    expect(out.findings.some((f) => f.category === "temporal" && f.status === "REGENERATE")).toBe(false);
  });
});
