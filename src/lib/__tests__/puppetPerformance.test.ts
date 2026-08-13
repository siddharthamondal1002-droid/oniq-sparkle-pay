import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEAT_GAP_FRAMES,
  POSE_LIMITS,
  beatFrames,
  centerForFacing,
  conversationFacings,
  puppetPoseAt,
  speakerMatchesRig,
  walkFor,
  type PoseParams,
} from "@/lib/puppetPerformance";
import { REST } from "@/lib/visemes";

const ROOT = join(__dirname, "../../..");
const MODULE_SRC = readFileSync(join(ROOT, "src/lib/puppetPerformance.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const FILM_SRC = readFileSync(join(ROOT, "remotion/src/story/StoryFilm.tsx"), "utf8");

/**
 * Rung 4's hard contracts: the module stays worker-importable (zero
 * imports), the pose is a bounded pure function of frame, the gait gate
 * only fires on feet, and the eyeline pass makes conversations face each
 * other. The wiring pins at the bottom keep the worker and the composition
 * from silently drifting off the module.
 */
describe("the module contract", () => {
  it("has zero imports — the story worker loads it under Node type-stripping", () => {
    // One relative import silently disqualifies the module from the worker
    // (the parallaxPlanes.ts lesson). Match real import statements at line
    // starts, not the word in prose.
    expect(MODULE_SRC).not.toMatch(/^import /m);
    expect(MODULE_SRC).not.toMatch(/^export .* from /m);
  });

  it("treats visemes.REST as the rest shape it skips", () => {
    // beatFrames compares against the literal 'X' to stay import-free;
    // this pins that literal to the alphabet visemes.ts actually owns.
    expect(REST).toBe("X");
  });
});

describe("walkFor — gait verbs only, guarded against prose", () => {
  it("hears an arrival", () => {
    expect(walkFor("Aladdin enters the throne room")).toBe("enter");
    expect(walkFor("She arrives at the gate by dusk")).toBe("enter");
    expect(walkFor("The captain approaches the bench")).toBe("enter");
    expect(walkFor("He returned home with empty hands")).toBe("enter");
  });

  it("hears feet moving through a shot", () => {
    expect(walkFor("They walk the length of the bazaar")).toBe("drift");
    expect(walkFor("Morgiana strides across the courtyard")).toBe("drift");
    // The irregular past — the tense the plans actually narrate in.
    expect(walkFor("She strode across the square")).toBe("drift");
    expect(walkFor("The old man trudges up the hill")).toBe("drift");
    expect(walkFor("She hurried along the harbour wall")).toBe("drift");
    expect(walkFor("The boy runs through the alley")).toBe("drift");
    expect(walkFor("He fled into the dark")).toBe("drift");
    expect(walkFor("The captain paces the deck")).toBe("drift");
  });

  it("an arrival outranks a wander when both appear", () => {
    expect(walkFor("She walks the corridor and enters the hall")).toBe("enter");
  });

  it("does not walk on flight, idiom or furniture", () => {
    // Flying is motion but not a walk — a step-bounce on a carpet reads
    // instantly as wrong.
    expect(walkFor("The carpet flies over the sleeping city")).toBeNull();
    expect(walkFor("The ship sails out of the bay")).toBeNull();
    // Idioms go nowhere.
    expect(walkFor("He ran out of time")).toBeNull();
    expect(walkFor("She entered into a bargain with the jinni")).toBeNull();
    // Substrings are not verbs.
    expect(walkFor("A run-down house by the well")).toBeNull();
    expect(walkFor("The palace stood silent")).toBeNull();
    expect(walkFor("Space enough for two")).toBeNull();
    // "across" contains 'cross' with no word boundary.
    expect(walkFor("A rope stretched across the gorge")).toBeNull();
    expect(walkFor("")).toBeNull();
  });
});

describe("conversationFacings — the 180-degree eyeline pass", () => {
  const shots = (...rigs: (string | null)[]) => rigs.map((rig) => ({ rig }));

  it("makes a two-hander face each other across the cuts", () => {
    expect(conversationFacings(shots("aladdin", "magician", "aladdin", "magician"))).toEqual([
      "right",
      "left",
      "right",
      "left",
    ]);
  });

  it("keeps a solo character on camera — no conversation, no eyeline", () => {
    expect(conversationFacings(shots("aladdin", "aladdin", "aladdin"))).toEqual([
      null,
      null,
      null,
    ]);
    expect(conversationFacings(shots("aladdin"))).toEqual([null]);
  });

  it("bridges ONE rigless insert without ending the scene", () => {
    expect(conversationFacings(shots("aladdin", null, "magician", "aladdin"))).toEqual([
      "right",
      null,
      "left",
      "right",
    ]);
  });

  it("two rigless shots end the conversation", () => {
    expect(conversationFacings(shots("aladdin", null, null, "magician"))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("a third speaker alternates back to the first side", () => {
    expect(conversationFacings(shots("aladdin", "magician", "princess"))).toEqual([
      "right",
      "left",
      "right",
    ]);
  });

  it("EVERY cut between two different characters looks across the frame", () => {
    // The property the global-parity version broke: with three speakers,
    // two of them could land on adjacent shots facing the same way.
    // Adjacency-flip makes the property hold by construction; assert it
    // over sequences that would have failed.
    const sequences = [
      ["aladdin", "princess", "magician", "aladdin", "magician"],
      ["aladdin", "magician", "princess", "aladdin"],
      ["mother", "aladdin", "mother", "princess", "mother"],
    ];
    for (const rigs of sequences) {
      const facings = conversationFacings(shots(...rigs));
      for (let i = 1; i < rigs.length; i++) {
        if (rigs[i] !== rigs[i - 1]) {
          expect(facings[i], `${rigs.join(",")} @${i}`).not.toBe(facings[i - 1]);
        }
      }
    }
  });

  it("a character holding consecutive coverage keeps their side", () => {
    expect(conversationFacings(shots("aladdin", "aladdin", "magician"))).toEqual([
      "right",
      "right",
      "left",
    ]);
  });

  it("survives the degenerate plans", () => {
    expect(conversationFacings([])).toEqual([]);
    expect(conversationFacings(shots(null, null))).toEqual([null, null]);
    // A conversation running to the LAST shot keeps its final facing — the
    // run-closing arithmetic must not drop the closing shot.
    const tail = conversationFacings(shots(null, "aladdin", "magician"));
    expect(tail).toEqual([null, "right", "left"]);
  });

  it("puts a facing character on the third looking across the frame", () => {
    expect(centerForFacing("right")).toBeLessThan(0.5);
    expect(centerForFacing("left")).toBeGreaterThan(0.5);
  });
});

describe("speakerMatchesRig — prose names against rig keys", () => {
  it("matches through articles, case and spacing", () => {
    expect(speakerMatchesRig("The Magician", "magician")).toBe(true);
    expect(speakerMatchesRig("Ali Baba", "aliBaba")).toBe(true);
    expect(speakerMatchesRig("ALADDIN", "aladdin")).toBe(true);
  });

  it("refuses different people and empty names", () => {
    expect(speakerMatchesRig("Genie", "lampJinni")).toBe(false);
    expect(speakerMatchesRig("", "aladdin")).toBe(false);
  });
});

describe("beatFrames — emphasis, not phonemes", () => {
  it("skips rest cues and thins syllables to gestures", () => {
    const cues = [
      { startFrame: 0, viseme: "D" },
      { startFrame: 3, viseme: "B" },
      { startFrame: 6, viseme: "C" },
      { startFrame: 20, viseme: "E" },
    ];
    expect(beatFrames(cues)).toEqual([0, 20]);
    expect(20 - 0).toBeGreaterThanOrEqual(BEAT_GAP_FRAMES);
  });

  it("hears nothing in a silent track", () => {
    expect(beatFrames([{ startFrame: 5, viseme: "X" }])).toEqual([]);
    expect(beatFrames([])).toEqual([]);
  });
});

describe("puppetPoseAt — bounded, deterministic, at rest when idle", () => {
  const base: PoseParams = {
    durationInFrames: 300,
    fps: 30,
    speech: [],
    beats: [],
    seed: 12345,
  };

  it("is a pure function of frame — same inputs, same pose, any order", () => {
    const a = puppetPoseAt(137, base);
    const b = puppetPoseAt(137, base);
    expect(a).toEqual(b);
    // Random access agrees with itself after visiting other frames — the
    // render-halves seam rule.
    puppetPoseAt(5, base);
    puppetPoseAt(299, base);
    expect(puppetPoseAt(137, base)).toEqual(a);
  });

  it("keeps a silent, standing, unfacing character nearly still", () => {
    for (const frame of [0, 50, 150, 299]) {
      const pose = puppetPoseAt(frame, base);
      expect(pose.dx).toBe(0);
      expect(pose.dy).toBe(0);
      // Only the idle micro-turn, under half a degree.
      expect(Math.abs(pose.rotDeg)).toBeLessThanOrEqual(0.5);
    }
  });

  it("never exceeds POSE_LIMITS, even under an adversarial pile-up", () => {
    const wild: PoseParams = {
      ...base,
      speech: [[0, 300]],
      beats: Array.from({ length: 300 }, (_, i) => i),
      facing: "right",
      walk: "enter",
      speaking: true,
    };
    for (let frame = 0; frame < 300; frame++) {
      const pose = puppetPoseAt(frame, wild);
      expect(Math.abs(pose.dx)).toBeLessThanOrEqual(POSE_LIMITS.dx);
      expect(Math.abs(pose.dy)).toBeLessThanOrEqual(POSE_LIMITS.dy);
      expect(Math.abs(pose.rotDeg)).toBeLessThanOrEqual(POSE_LIMITS.rotDeg);
    }
  });

  it("gestures while the voice is live, rests outside the spans", () => {
    const talking: PoseParams = { ...base, speech: [[60, 240]], speaking: true };
    const quiet = puppetPoseAt(30, talking);
    const quietBase = puppetPoseAt(30, base);
    // Outside the span the gesture contributes nothing.
    expect(quiet.rotDeg).toBeCloseTo(quietBase.rotDeg, 10);
    // Deep inside the span the lean is live somewhere: the oscillation
    // crosses zero, so assert the maximum over a window rather than one
    // frame.
    let maxGesture = 0;
    for (let frame = 100; frame < 200; frame++) {
      const withVoice = puppetPoseAt(frame, talking);
      const without = puppetPoseAt(frame, base);
      maxGesture = Math.max(maxGesture, Math.abs(withVoice.rotDeg - without.rotDeg));
    }
    expect(maxGesture).toBeGreaterThan(0.5);
  });

  it("a narrated character moves at reduced gain against a speaking one", () => {
    const spans: PoseParams = { ...base, speech: [[60, 240]] };
    let maxSpeaking = 0;
    let maxNarrated = 0;
    for (let frame = 100; frame < 200; frame++) {
      const idle = puppetPoseAt(frame, base);
      maxSpeaking = Math.max(
        maxSpeaking,
        Math.abs(puppetPoseAt(frame, { ...spans, speaking: true }).rotDeg - idle.rotDeg),
      );
      maxNarrated = Math.max(
        maxNarrated,
        Math.abs(puppetPoseAt(frame, spans).rotDeg - idle.rotDeg),
      );
    }
    expect(maxNarrated).toBeGreaterThan(0);
    expect(maxNarrated).toBeLessThan(maxSpeaking);
  });

  it("an entrance starts off the mark and settles onto it", () => {
    const enter: PoseParams = { ...base, walk: "enter", facing: "right" };
    // Facing right, the figure walks IN from the left of its mark.
    expect(puppetPoseAt(0, enter).dx).toBeLessThan(-0.15);
    // The window is min(2.2s * 30, 40% of 300) = 66 frames; from there on
    // the figure stands on its mark.
    for (const frame of [70, 150, 299]) {
      expect(Math.abs(puppetPoseAt(frame, enter).dx)).toBeLessThan(1e-9);
    }
  });

  it("a drift eases from one side of the mark to the other", () => {
    const drift: PoseParams = { ...base, walk: "drift", facing: "left" };
    const first = puppetPoseAt(0, drift).dx;
    const last = puppetPoseAt(299, drift).dx;
    // Facing left drifts leftward: starts right of the mark, ends left.
    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(0);
    expect(Math.abs(first + last)).toBeLessThan(1e-9);
  });

  it("emphasis beats bob the body only near the beat", () => {
    const beaten: PoseParams = { ...base, speech: [[0, 300]], beats: [100], speaking: true };
    expect(puppetPoseAt(104, beaten).dy).toBeGreaterThan(0);
    expect(puppetPoseAt(50, beaten).dy).toBe(0);
    expect(puppetPoseAt(150, beaten).dy).toBe(0);
  });

  it("an emphasis beat near the cut fades to rest ON the cut frame", () => {
    // The seam rule: every motion source is at rest at the hard cut. A beat
    // landing inside the last EMPHASIS_FRAMES must not leave the body
    // mid-bob on the shot's final frame.
    const lateBeat: PoseParams = { ...base, speech: [[0, 300]], beats: [295], speaking: true };
    expect(puppetPoseAt(299, lateBeat).dy).toBe(0);
    // Away from the cut, the same beat still bobs.
    const early: PoseParams = { ...base, speech: [[0, 300]], beats: [100], speaking: true };
    expect(puppetPoseAt(104, early).dy).toBeGreaterThan(0);
  });

  it("a walking body RISES between footfalls — positive translateY is down", () => {
    const enter: PoseParams = { ...base, walk: "enter", facing: "right" };
    let rose = false;
    for (let frame = 5; frame < 50; frame++) {
      const pose = puppetPoseAt(frame, enter);
      // Never sinks into the ground while walking...
      expect(pose.dy).toBeLessThanOrEqual(0);
      if (pose.dy < -0.003) rose = true;
    }
    // ...and actually lifts off it at some point in the gait.
    expect(rose).toBe(true);
  });
});

describe("the wiring pins", () => {
  it("the worker runs the eyeline pass and attaches the performance", () => {
    // Loose on purpose: these fail loudly if rung 4 is unplugged from the
    // worker, not if a variable is renamed.
    expect(
      WORKER_SRC.includes("conversationFacings("),
      "story-worker.mjs no longer runs conversationFacings — the eyeline pass is unplugged",
    ).toBe(true);
    expect(
      /from '\.\.\/\.\.\/src\/lib\/puppetPerformance\.ts'/.test(WORKER_SRC),
      "story-worker.mjs must import puppetPerformance with the explicit .ts suffix",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("performance ? { performance }"),
      "the manifest no longer attaches the performance to the character",
    ).toBe(true);
  });

  it("the composition hands the performance to the Character", () => {
    expect(
      FILM_SRC.includes("performance={shot.character.performance}"),
      "StoryFilm.tsx no longer passes the performance down — rung 4 renders nothing",
    ).toBe(true);
    expect(
      FILM_SRC.includes("performance?: PuppetPerformance"),
      "StoryShotInput.character lost its performance field",
    ).toBe(true);
  });
});
