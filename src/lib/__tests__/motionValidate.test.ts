/**
 * MOTION_VALIDATE — the check that would have caught the false "motion PASS":
 * a still with camera + parallax is not a character walking or talking.
 */
import { describe, expect, it } from "vitest";
import {
  motionCalledFor,
  motionSourceOf,
  validateFilmMotion,
  validateShotMotion,
  type ShotMotionInput,
} from "@/lib/motionValidate";

describe("motionCalledFor — the action text, not the camera", () => {
  it("is true when the action names body or speech movement", () => {
    for (const a of [
      "The fisherman walks along the pier",
      "She turns and waves to the crowd",
      "He sits, then reaches for the lamp",
      "The girl is dancing in the square",
      '"Come closer," the old man says',
      "The merchant nods and smiles",
    ]) {
      expect(motionCalledFor(a), a).toBe(true);
    }
  });

  it("is false for pure scenery and camera-only description", () => {
    for (const a of [
      "A wide, empty harbour at dawn, soft light",
      "The market square, no people in it",
      "A slow camera pan across the rooftops", // 'pan' is a camera word, not here
      "",
    ]) {
      expect(motionCalledFor(a), a).toBe(false);
    }
  });
});

describe("motionSourceOf — clip beats rig beats none", () => {
  it("prefers a temporal clip, then a rig, else none", () => {
    expect(motionSourceOf({ action: "", hasClip: true, hasRig: true })).toBe("clip");
    expect(motionSourceOf({ action: "", hasClip: false, hasRig: true })).toBe("rig");
    expect(motionSourceOf({ action: "", hasClip: false, hasRig: false })).toBe("none");
  });
});

describe("validateShotMotion — FAIL only for still-only where motion is called for", () => {
  it("FAILS a still-only shot whose action calls for character motion", () => {
    const r = validateShotMotion(
      { action: "The fishmonger walks to the stall and waves", hasClip: false, hasRig: false },
      3,
    );
    expect(r.verdict).toBe("FAIL");
    expect(r.source).toBe("none");
    expect(r.motionCalledFor).toBe(true);
  });

  it("does NOT fail a still-only scenery shot (motion not called for) — UNKNOWN", () => {
    const r = validateShotMotion(
      { action: "A wide, empty harbour at dawn", hasClip: false, hasRig: false },
      0,
    );
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.motionCalledFor).toBe(false);
  });

  it("never issues PASS from a rig or clip alone — capability is not pixel proof", () => {
    const rig = validateShotMotion(
      { action: "He waves and speaks", hasClip: false, hasRig: true },
      1,
    );
    const clip = validateShotMotion(
      { action: "He waves and speaks", hasClip: true, hasRig: false },
      2,
    );
    expect(rig.verdict).toBe("UNKNOWN");
    expect(rig.source).toBe("rig");
    expect(clip.verdict).toBe("UNKNOWN");
    expect(clip.source).toBe("clip");
  });
});

describe("validateFilmMotion — the 43-shot still-only reality", () => {
  it("FAILS a film where every motion-calling shot is still-only, and counts them", () => {
    // The shape of the real user film: no cast member matched a measured rig,
    // the clip stage was off, so every shot rendered still-only — yet the
    // stories ask people to walk, work and speak.
    const shots: ShotMotionInput[] = [
      { action: "The fishmonger arranges fish and calls to a buyer", hasClip: false, hasRig: false },
      { action: "A child runs past, laughing", hasClip: false, hasRig: false },
      { action: "The weaver sits at her loom, hands moving", hasClip: false, hasRig: false },
      { action: "A quiet, empty temple at dusk", hasClip: false, hasRig: false }, // scenery
    ];
    const film = validateFilmMotion(shots);
    expect(film.verdict).toBe("FAIL");
    expect(film.total).toBe(4);
    expect(film.stillOnly).toBe(4);
    expect(film.withSource).toBe(0);
    expect(film.failed).toBe(3); // the three action shots; the scenery shot is UNKNOWN
  });

  it("a film whose shots all carry a motion source is UNKNOWN, never an unearned PASS", () => {
    const shots: ShotMotionInput[] = [
      { action: "Aladdin walks and speaks", hasClip: false, hasRig: true },
      { action: "The genie gestures", hasClip: true, hasRig: false },
    ];
    const film = validateFilmMotion(shots);
    expect(film.verdict).toBe("UNKNOWN");
    expect(film.failed).toBe(0);
    expect(film.withSource).toBe(2);
    expect(film.stillOnly).toBe(0);
    // PASS is never emitted without pixel evidence.
    expect(film.shots.every((s) => s.verdict !== "PASS")).toBe(true);
  });
});
