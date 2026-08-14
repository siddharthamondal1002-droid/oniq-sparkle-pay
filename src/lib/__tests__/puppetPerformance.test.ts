import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEAT_GAP_FRAMES,
  BLINK,
  LISTEN_GAP_FRAMES,
  POSE_LIMITS,
  TWO_SHOT_MAX_FIGURE_HEIGHT,
  beatFrames,
  blinkClosureAt,
  centerForFacing,
  conversationFacings,
  oppositeFacing,
  puppetPoseAt,
  riggedMentions,
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

describe("walkFor — a named walker plus a gait verb, or nothing", () => {
  const CAST = ["Aladdin", "Morgiana", "The Captain"];

  it("hears an arrival when a cast member makes one", () => {
    expect(walkFor("Aladdin enters the throne room", CAST)).toBe("enter");
    expect(walkFor("The captain approaches the bench", CAST)).toBe("enter");
    // Narration leans on pronouns; a bare he/she/they is a walker too.
    expect(walkFor("She arrives at the gate by dusk", CAST)).toBe("enter");
    expect(walkFor("He returned home with empty hands", CAST)).toBe("enter");
    expect(walkFor("Morgiana returned to the kitchen", CAST)).toBe("enter");
  });

  it("hears feet moving through a shot", () => {
    expect(walkFor("They walk the length of the bazaar", CAST)).toBe("drift");
    expect(walkFor("Morgiana strides across the courtyard", CAST)).toBe("drift");
    // The irregular past — the tense the plans actually narrate in.
    expect(walkFor("She strode across the square", CAST)).toBe("drift");
    expect(walkFor("She hurried along the harbour wall", CAST)).toBe("drift");
    expect(walkFor("He fled into the dark", CAST)).toBe("drift");
    expect(walkFor("The captain paces the deck", CAST)).toBe("drift");
    expect(walkFor("Aladdin runs through the alley", CAST)).toBe("drift");
  });

  it("an arrival outranks a wander when both appear", () => {
    expect(walkFor("She walks the corridor and enters the hall", CAST)).toBe("enter");
  });

  it("SCENERY NEVER WALKS — a verb without a named walker is a landscape", () => {
    // The adversarial pass walked twenty-one of these; the named-subject
    // rule kills the class. All carry gait verbs; none names a walker.
    expect(walkFor("Winter arrived early that year", CAST)).toBeNull();
    expect(walkFor("The storm approaches the harbour", CAST)).toBeNull();
    expect(walkFor("News of the theft arrived at the palace", CAST)).toBeNull();
    expect(walkFor("Moonlight entering through the lattice", CAST)).toBeNull();
    expect(walkFor("Tears ran down the princess's cheeks", CAST)).toBeNull();
    expect(walkFor("The road runs along the cliff edge", CAST)).toBeNull();
    expect(walkFor("A winding road runs through the hills", CAST)).toBeNull();
    expect(walkFor("The sun climbed over the rooftops", CAST)).toBeNull();
    expect(walkFor("The vine climbed the trellis", CAST)).toBeNull();
    expect(walkFor("Rumours chased each other through the bazaar", CAST)).toBeNull();
    expect(walkFor("A hurried whisper in the dark", CAST)).toBeNull();
    expect(walkFor("The river crosses the plain far below", CAST)).toBeNull();
  });

  it("guards the idioms and the bare nouns even WITH a walker in reach", () => {
    // Idioms go nowhere.
    expect(walkFor("He ran out of time", CAST)).toBeNull();
    expect(walkFor("She entered into a bargain with the jinni", CAST)).toBeNull();
    expect(walkFor("He returned to his senses", CAST)).toBeNull();
    // Body language and thought are not locomotion.
    expect(walkFor("Morgiana crossed her arms and waited", CAST)).toBeNull();
    expect(walkFor("The thought crossed his mind", CAST)).toBeNull();
    expect(walkFor("Aladdin's mind wandered to the old days", CAST)).toBeNull();
    // Bare 'march' and 'rush' are nouns; only the verb forms walk.
    expect(walkFor("Aladdin waited; by March the mill had failed", CAST)).toBeNull();
    expect(walkFor("She felt a rush of wind from the shaft", CAST)).toBeNull();
    // Substrings are not verbs.
    expect(walkFor("He found a run-down house by the well", CAST)).toBeNull();
    expect(walkFor("She saw a rope stretched across the gorge", CAST)).toBeNull();
  });

  it("does not walk on flight or sail, and survives the degenerates", () => {
    expect(walkFor("The carpet flies over the sleeping city", CAST)).toBeNull();
    expect(walkFor("The ship sails out of the bay", CAST)).toBeNull();
    expect(walkFor("", CAST)).toBeNull();
    // No cast list means no named walker — only the pronouns remain, and
    // this line has none. (The worker never gets here: no cast, no rig.)
    expect(walkFor("Aladdin walks in", [])).toBeNull();
    // Regex metacharacters in a user's cast name must not blow up.
    expect(walkFor("Mr. O'Brien (the elder) walks the wall", ["Mr. O'Brien (the elder)"])).toBe(
      "drift",
    );
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

  it("three or more speakers play to camera — a wrong eyeline is worse than none", () => {
    // The adversarial pass killed both clever versions of this: global
    // parity put two different speakers on the same mark across a cut, and
    // adjacency-flip teleported a character across the frame when a third
    // interjected. With two stage positions, only a two-hander can have
    // stable sides AND opposed cuts — so only a two-hander gets an eyeline.
    expect(conversationFacings(shots("aladdin", "magician", "princess"))).toEqual([
      null,
      null,
      null,
    ]);
    expect(conversationFacings(shots("aladdin", "magician", "princess", "aladdin"))).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("a two-hander has BOTH eyeline properties by construction", () => {
    const sequences = [
      ["aladdin", "magician", "aladdin", "magician", "aladdin"],
      ["mother", "aladdin", "mother", "aladdin"],
      ["princess", "princess", "morgiana", "princess"],
    ];
    for (const rigs of sequences) {
      const facings = conversationFacings(shots(...rigs));
      const byRig = new Map<string, string | null>();
      for (let i = 0; i < rigs.length; i++) {
        // Every cut between different characters looks across the frame...
        if (i > 0 && rigs[i] !== rigs[i - 1]) {
          expect(facings[i], `${rigs.join(",")} @${i}`).not.toBe(facings[i - 1]);
        }
        // ...and each character keeps one side for the whole scene.
        const seen = byRig.get(rigs[i]);
        if (seen !== undefined) expect(facings[i], `${rigs.join(",")} @${i}`).toBe(seen);
        byRig.set(rigs[i], facings[i]);
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

describe("rung 6 — the two-shot", () => {
  const CAST = [
    { name: "Ali Baba", rig: "aliBaba" },
    { name: "The Mother", rig: "mother" },
    { name: "The Weaver", rig: null },
    { name: "Morgiana", rig: "morgiana" },
  ];

  it("finds rigged cast in first-mention order, skipping the unrigged", () => {
    expect(
      riggedMentions("The mother ran to Ali Baba as the weaver watched", CAST),
    ).toEqual(["mother", "aliBaba"]);
    // Cast order and mention order disagree here; mention order wins.
    expect(riggedMentions("Morgiana poured wine for Ali Baba", CAST)).toEqual([
      "morgiana",
      "aliBaba",
    ]);
  });

  it("returns nobody for scenery and no duplicate for a repeated name", () => {
    expect(riggedMentions("A quiet market street at dawn", CAST)).toEqual([]);
    expect(
      riggedMentions("Ali Baba paused. Then Ali Baba spoke.", CAST),
    ).toEqual(["aliBaba"]);
  });

  it("answers an eyeline from the other third", () => {
    expect(oppositeFacing("right")).toBe("left");
    expect(oppositeFacing("left")).toBe("right");
    // The two stage positions look AT each other across the frame.
    expect(centerForFacing("right")).toBeLessThan(centerForFacing("left"));
  });

  it("mirrors shotGrammar's FULL figure — the widest framing two figures share", () => {
    // Mirrored, not imported, so puppetPerformance stays zero-import for
    // the worker. If the grammar re-measures its full shot, this fails
    // and both move together.
    const grammar = readFileSync(join(ROOT, "src/lib/shotGrammar.ts"), "utf8");
    const full = grammar.match(/full:\s*\{[^}]*figureHeight:\s*([\d.]+)/);
    expect(full).not.toBeNull();
    expect(TWO_SHOT_MAX_FIGURE_HEIGHT).toBe(Number(full?.[1]));
  });

  it("the worker stages the companion and the composition renders it", () => {
    expect(
      WORKER_SRC.includes("riggedMentions("),
      "story-worker.mjs no longer scans for a second figure — rung 6 is unplugged",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("TWO_SHOT_MAX_FIGURE_HEIGHT"),
      "the framing gate is gone — two figures would share a close-up",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("companion: { ...companion, speech: spans }"),
      "the manifest no longer attaches the companion",
    ).toBe(true);
    expect(
      FILM_SRC.includes("shot.companion && CHARACTER_RIGS[shot.companion.rig]"),
      "StoryFilm.tsx no longer renders the second figure",
    ).toBe(true);
    // The mouth cues ride exactly one mouth: the primary rests when the
    // companion speaks, and the companion rests when it does not.
    expect(
      FILM_SRC.includes("shot.companion?.speaks ? REST : visemeAtFrame(cues, frame)"),
      "the primary no longer yields the mouth cues to a speaking companion",
    ).toBe(true);
    expect(
      FILM_SRC.includes("shot.companion.speaks ? visemeAtFrame(cues, frame) : REST"),
      "a listening companion no longer holds its mouth at rest",
    ).toBe(true);
  });
});

describe("rung 10 — the listener", () => {
  const FPS = 30;
  const base: PoseParams = {
    durationInFrames: 300,
    fps: FPS,
    speech: [[30, 240]],
    beats: [40, 46, 55, 100, 160],
    facing: "left",
    speaking: false,
    seed: 77,
  };

  it("nods AFTER a beat — a response, not a chorus — and stays bounded", () => {
    const listener = { ...base, listening: true };
    // On the beat itself, nothing has arrived yet.
    const atBeat = puppetPoseAt(40, listener);
    const still = puppetPoseAt(20, listener);
    expect(atBeat.dy).toBeCloseTo(still.dy, 5);
    // Mid-nod, the body dips DOWN (positive dy) and turns toward the
    // speaker (facing left → negative rotation contribution).
    const midNod = puppetPoseAt(51, listener);
    expect(midNod.dy).toBeGreaterThan(still.dy);
    for (let f = 0; f < 300; f++) {
      const p = puppetPoseAt(f, listener);
      expect(Math.abs(p.dy)).toBeLessThanOrEqual(POSE_LIMITS.dy);
      expect(Math.abs(p.rotDeg)).toBeLessThanOrEqual(POSE_LIMITS.rotDeg);
    }
  });

  it("answers only SOME beats — thinned, never a metronome", () => {
    // Beats 40 and 46 sit closer than LISTEN_GAP_FRAMES: one nod, not two.
    expect(46 - 40).toBeLessThan(LISTEN_GAP_FRAMES);
    const listener = { ...base, listening: true };
    // If 46 also nodded, dy at its peak would stack above a single nod's
    // ceiling; instead frames after 46+delay reflect only the tail of 40's.
    let peak = 0;
    for (let f = 40; f < 70; f++) peak = Math.max(peak, puppetPoseAt(f, listener).dy - puppetPoseAt(20, listener).dy);
    let peakSingle = 0;
    for (let f = 100; f < 130; f++) peakSingle = Math.max(peakSingle, puppetPoseAt(f, listener).dy - puppetPoseAt(90, listener).dy);
    expect(peak).toBeLessThanOrEqual(peakSingle * 1.05);
  });

  it("does not orate while listening — the gesture lean belongs to the speaker", () => {
    // Same params with and without listening, mid-speech, away from any
    // nod window: the listener's rotation is the idle+facing baseline.
    const talkerRot = puppetPoseAt(200, { ...base, speaking: true }).rotDeg;
    const listenerRot = puppetPoseAt(200, { ...base, listening: true }).rotDeg;
    const idleRot = puppetPoseAt(200, { ...base, speech: [] }).rotDeg;
    expect(Math.abs(listenerRot - idleRot)).toBeLessThan(0.01);
    expect(Math.abs(talkerRot - idleRot)).toBeGreaterThan(0.01);
  });

  it("the worker marks both directions and the rig passes it down", () => {
    expect(
      WORKER_SRC.includes("...(compSpeaks ? { speaks: true } : {})") &&
        WORKER_SRC.includes("...(compSpeaks ? { listening: true } : {})"),
      "the primary no longer listens when the companion speaks",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("...(primarySpeaks ? { listening: true } : {})"),
      "the companion no longer listens when the primary speaks",
    ).toBe(true);
    const CHARACTER_SRC = readFileSync(
      join(ROOT, "remotion/src/rig/Character.tsx"),
      "utf8",
    );
    expect(
      CHARACTER_SRC.includes("listening: performance.listening ?? false"),
      "Character.tsx no longer passes listening into the pose",
    ).toBe(true);
  });
});

describe("rung 7 — the blink clock", () => {
  const FPS = 30;

  it("stays a closure in [0,1], deterministic for a seed", () => {
    for (let frame = 0; frame < 600; frame++) {
      const c = blinkClosureAt(frame, FPS, 42);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(c).toBe(blinkClosureAt(frame, FPS, 42));
    }
  });

  it("blinks like a person: full closures at a living rate, never at frame 0", () => {
    // A blink is an onset: the closure leaving zero.
    const countBlinks = (seed: number) => {
      let blinks = 0;
      let prev = 0;
      for (let frame = 0; frame < 60 * FPS; frame++) {
        const c = blinkClosureAt(frame, FPS, seed);
        if (c > 0 && prev === 0) blinks += 1;
        prev = c;
      }
      return blinks;
    };
    for (const seed of [1, 7, 99, 1234, 0]) {
      const blinks = countBlinks(seed);
      // 60s of gaps between 2.2s and 5.4s (plus the blink itself) must
      // land between ~10 and ~27 blinks — the human band.
      expect(blinks).toBeGreaterThanOrEqual(9);
      expect(blinks).toBeLessThanOrEqual(28);
      // The first look at a character is never mid-blink.
      expect(blinkClosureAt(0, FPS, seed)).toBe(0);
    }
  });

  it("two seeds drift apart — no metronome across the cast", () => {
    let differ = 0;
    for (let frame = 0; frame < 20 * FPS; frame++) {
      if (blinkClosureAt(frame, FPS, 5) !== blinkClosureAt(frame, FPS, 6)) differ += 1;
    }
    expect(differ).toBeGreaterThan(0);
  });

  it("is safe at the edges, and a blink lasts exactly its envelope", () => {
    expect(blinkClosureAt(-1, FPS, 3)).toBe(0);
    expect(blinkClosureAt(100, 0, 3)).toBe(0);
    // Every positive run is one whole envelope long — ~200ms at 30fps.
    const envelope = BLINK.CLOSE_FRAMES + BLINK.HOLD_FRAMES + BLINK.OPEN_FRAMES;
    let run = 0;
    for (let frame = 0; frame < 20 * FPS; frame++) {
      if (blinkClosureAt(frame, FPS, 11) > 0) {
        run += 1;
      } else if (run > 0) {
        expect(run).toBe(envelope);
        run = 0;
      }
    }
  });

  it("the composition draws the lids from whichever face is showing", () => {
    const CHARACTER_SRC = readFileSync(
      join(ROOT, "remotion/src/rig/Character.tsx"),
      "utf8",
    );
    expect(
      CHARACTER_SRC.includes("blinkClosureAt(frame, fps, performance.seed"),
      "Character.tsx no longer runs the blink clock — rung 7 is unplugged",
    ).toBe(true);
    expect(
      CHARACTER_SRC.includes("expressionHead ? expressionHead.eyes : view.eyes"),
      "the lids no longer follow the worn face — a bust swap would blink the base eyes",
    ).toBe(true);
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
