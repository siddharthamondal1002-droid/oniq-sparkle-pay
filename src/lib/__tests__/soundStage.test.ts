import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AMBIENT_FADE_SECONDS,
  AMBIENT_GAIN,
  SCORE_FADE_SECONDS,
  SCORE_GAIN,
  ambienceFor,
  ambienceGraph,
  ambientVolumeAt,
  scoreFor,
  scoreGraph,
  scoreVolumeAt,
  type AmbienceKind,
  type ScoreRegister,
} from "@/lib/soundStage";

const ROOT = join(__dirname, "../../..");
const MODULE_SRC = readFileSync(join(ROOT, "src/lib/soundStage.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const FILM_SRC = readFileSync(join(ROOT, "remotion/src/story/StoryFilm.tsx"), "utf8");

/**
 * Rung 8's contracts: the chooser hears real places and stays silent for
 * silent ones, the recipes stay deterministic lavfi graphs, the mix is one
 * constant and two fades, and the worker and composition stay plugged in.
 */
describe("ambienceFor — the scene earns its air", () => {
  it("hears each bed in its plain words", () => {
    expect(ambienceFor("Rain hammered the market awnings")).toBe("rain");
    expect(ambienceFor("The ship ran for the open sea")).toBe("surf");
    expect(ambienceFor("Embers settled in the hearth")).toBe("fire");
    expect(ambienceFor("Deep in the cavern the lamp glowed")).toBe("cave");
    expect(ambienceFor("A cold wind crossed the dunes")).toBe("wind");
    expect(ambienceFor("Under the starry sky the camp slept")).toBe("night");
  });

  it("stays silent for a scene that names no air", () => {
    expect(ambienceFor("A merchant counts coins at his table")).toBeNull();
    expect(ambienceFor("")).toBeNull();
  });

  it("runs precedence specific-first", () => {
    // Falling water beats the wind that drives it.
    expect(ambienceFor("Wind drove the rain across the bay")).toBe("rain");
    // The sea beats the night above it.
    expect(ambienceFor("Moonlight on the ocean at midnight")).toBe("surf");
    // An explicitly windy night is a wind scene; quiet darkness sings.
    expect(ambienceFor("A gale tore through the night camp")).toBe("wind");
    expect(ambienceFor("The night camp lay quiet")).toBe("night");
  });

  it("does not fire on the prose traps", () => {
    // A rainbow is dry; training is not weather.
    expect(ambienceFor("A rainbow arched over the valley")).toBeNull();
    expect(ambienceFor("Years of training made her quick")).toBeNull();
    // A surface is not the sea; waving goodbye is an arm, not water.
    expect(ambienceFor("Dust lay on the surface of the chest")).toBeNull();
    expect(ambienceFor("He waves goodbye from the gate")).toBeNull();
    // A firefly twinkles (rung 3's job), it does not crackle.
    expect(ambienceFor("Fireflies drifted over the garden")).toBeNull();
    // A window is not the wind; a winding road is a shape.
    expect(ambienceFor("She watched from the window")).toBeNull();
    expect(ambienceFor("The winding road climbed the hill")).toBeNull();
    // Knights and nightmares carry no crickets; a cave-in is a collapse.
    expect(ambienceFor("The knight bowed to the sultan")).toBeNull();
    expect(ambienceFor("He woke from a nightmare, safe indoors")).toBeNull();
    expect(ambienceFor("The roof caved in behind them")).toBeNull();
  });
});

describe("the recipes and the mix", () => {
  const KINDS: AmbienceKind[] = ["rain", "surf", "fire", "cave", "wind", "night"];

  it("every bed is a seeded, deterministic lavfi graph", () => {
    for (const kind of KINDS) {
      const g = ambienceGraph(kind, 4242);
      expect(g).toBe(ambienceGraph(kind, 4242));
      expect(g, kind).not.toBe(ambienceGraph(kind, 4243));
      // Noise-based beds carry the seed; the cricket chorus seeds its air
      // and offsets its chirp rates from the same number.
      expect(g, kind).toContain("seed=");
      expect(g, kind).toContain("tremolo");
    }
    // Negative and fractional seeds must not produce an invalid graph.
    expect(ambienceGraph("wind", -7.9)).toContain("seed=7");
  });

  it("mixes as one constant under the narration with eased edges", () => {
    expect(AMBIENT_GAIN).toBeGreaterThan(0.05);
    expect(AMBIENT_GAIN).toBeLessThan(0.35);
    const fps = 30;
    const dur = 10 * fps;
    // Full gain mid-shot, silent past the edges, monotone through a fade.
    expect(ambientVolumeAt(dur / 2, dur, fps)).toBeCloseTo(AMBIENT_GAIN, 5);
    expect(ambientVolumeAt(-1, dur, fps)).toBe(0);
    expect(ambientVolumeAt(dur, dur, fps)).toBe(0);
    const fadeFrames = AMBIENT_FADE_SECONDS * fps;
    for (let f = 1; f < fadeFrames; f++) {
      expect(ambientVolumeAt(f, dur, fps)).toBeGreaterThan(ambientVolumeAt(f - 1, dur, fps));
    }
    // A shot shorter than two fades never exceeds the gain.
    for (let f = 0; f < 20; f++) {
      const v = ambientVolumeAt(f, 20, fps);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(AMBIENT_GAIN);
    }
  });

  it("the module stays worker-importable — zero imports", () => {
    expect(MODULE_SRC).not.toMatch(/^import /m);
  });

  it("holds one chord per register, deterministic, distinct, refusing to compose", () => {
    const REGISTERS: ScoreRegister[] = ["joy", "sorrow", "anger", "wonder", "weary"];
    const graphs = REGISTERS.map((r) => scoreGraph(r, 555));
    for (const [i, g] of graphs.entries()) {
      expect(g).toBe(scoreGraph(REGISTERS[i], 555));
      expect(g, REGISTERS[i]).not.toBe(scoreGraph(REGISTERS[i], 556));
      // A drone is sines under a lowpass and one glacial swell — the
      // moment a recipe grows melody machinery, this pin asks why.
      expect(g, REGISTERS[i]).toContain("sine=frequency=");
      expect(g, REGISTERS[i]).toContain("lowpass");
      expect(g, REGISTERS[i]).toContain("tremolo=f=0.1");
    }
    expect(new Set(graphs).size, "two registers share a chord").toBe(REGISTERS.length);
  });

  it("votes a film's register: majority, surprise discarded, silence honest", () => {
    expect(scoreFor(["joy", null, "sorrow", "sorrow", null])).toBe("sorrow");
    // Surprise ballots never count — a startled film is not a genre.
    expect(scoreFor(["surprise", "surprise", "weary"])).toBe("weary");
    expect(scoreFor(["surprise", null])).toBeNull();
    expect(scoreFor([null, null])).toBeNull();
    expect(scoreFor([])).toBeNull();
    // A tie goes to the register that REACHED the winning count first —
    // wonder hits two ballots on shot three, anger only on shot four.
    expect(scoreFor(["anger", "wonder", "wonder", "anger"])).toBe("wonder");
  });

  it("sits under the beds, which sit under the voice, with the long fades", () => {
    expect(SCORE_GAIN).toBeLessThan(AMBIENT_GAIN);
    expect(SCORE_FADE_SECONDS).toBeGreaterThan(AMBIENT_FADE_SECONDS);
    const fps = 30;
    const dur = 60 * fps;
    expect(scoreVolumeAt(dur / 2, dur, fps)).toBeCloseTo(SCORE_GAIN, 5);
    expect(scoreVolumeAt(-1, dur, fps)).toBe(0);
    expect(scoreVolumeAt(dur, dur, fps)).toBe(0);
    expect(scoreVolumeAt(10, 0, fps)).toBe(0);
  });

  it("the worker votes and synthesizes the score and the film holds it", () => {
    expect(
      WORKER_SRC.includes("scoreFor(shotEmotions)"),
      "the worker no longer votes the film's register — rung 11 is unplugged",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("shotEmotions.push(expression)"),
      "the ballots are no longer collected per shot",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("...(score ? { score } : {})"),
      "renderPlan no longer receives the score",
    ).toBe(true);
    expect(
      FILM_SRC.includes("scoreVolumeAt(f, totalFrames, usedFps)"),
      "StoryFilm.tsx no longer holds the drone under the film",
    ).toBe(true);
  });

  it("the worker synthesizes the air and the composition plays it", () => {
    expect(
      /from '\.\.\/\.\.\/src\/lib\/soundStage\.ts'/.test(WORKER_SRC),
      "story-worker.mjs must import soundStage with the explicit .ts suffix",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("ambienceFor(") && WORKER_SRC.includes("ambienceGraph("),
      "the worker no longer asks the scene for its air — rung 8 is unplugged",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("ambience ? { ambience }"),
      "the manifest no longer attaches the bed to the shot",
    ).toBe(true);
    expect(
      FILM_SRC.includes("ambientVolumeAt(f, durationInFrames, fps)"),
      "StoryFilm.tsx no longer plays the bed under the narration",
    ).toBe(true);
  });
});
