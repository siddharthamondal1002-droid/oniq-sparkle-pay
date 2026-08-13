/**
 * Episode 4's shot list under the same guards as episode 3's, because it is
 * made by the same procedure and can be quietly wrong in all the same ways —
 * each of which costs a paid generation to discover late. See ep3Shots.test.ts
 * for why each guard exists; nothing here is new, which is the point.
 */
import { describe, expect, it } from "vitest";
import { EP3_PROPS, EP4_CAST, ORIGINALS, STORYBOOK_STYLE } from "@/data/originals";
import { EP4_SHOTS, shotPromptFor, shotsFor, type Ep4Shot } from "@/data/ep4Shots";
import { estimateSeconds, narrationFor } from "@/data/originalsScript";
import { allocateFrames, checkShotFrames } from "@/lib/shotAllocation";

const EP4 = ORIGINALS.find((e) => e.id === "ep4")!;
const FPS = 30;

describe("every scene is covered, and only real scenes are", () => {
  it("gives every episode 4 scene at least one shot", () => {
    for (const scene of EP4.scenes) {
      expect(shotsFor(scene.id).length, `${scene.id} has no shots`).toBeGreaterThan(0);
    }
  });

  it("has no shot pointing at a scene that does not exist", () => {
    const ids = new Set(EP4.scenes.map((s) => s.id));
    for (const shot of EP4_SHOTS) {
      expect(ids.has(shot.sceneId), `${shot.id} covers unknown scene ${shot.sceneId}`).toBe(true);
    }
  });

  it("accounts for every shot in the array exactly once", () => {
    const viaScenes = EP4.scenes.flatMap((s) => shotsFor(s.id));
    expect(viaScenes.length).toBe(EP4_SHOTS.length);
  });
});

describe("shot ids are stable, unique and in cut order", () => {
  it("has no duplicate id", () => {
    const ids = EP4_SHOTS.map((s) => s.id);
    expect(new Set(ids).size, `duplicate shot id in ${ids.join(", ")}`).toBe(ids.length);
  });

  it("names each shot for its scene plus a letter, in sequence", () => {
    for (const scene of EP4.scenes) {
      const shots = shotsFor(scene.id);
      const expected = shots.map((_, i) => `${scene.id}${String.fromCharCode(97 + i)}`);
      expect(
        shots.map((s) => s.id),
        `${scene.id} shot ids out of sequence`,
      ).toEqual(expected);
    }
  });

  it("keeps a scene's shots contiguous in the array", () => {
    const order = EP4_SHOTS.map((s) => s.sceneId);
    const firstSeen = [...new Set(order)];
    expect(order).toEqual(firstSeen.flatMap((id) => shotsFor(id).map(() => id)));
  });
});

describe("the arithmetic closes before any audio exists", () => {
  it("splits every scene into shots that the generator can actually make", () => {
    for (const scene of EP4.scenes) {
      const shots = shotsFor(scene.id);
      const seconds = estimateSeconds(narrationFor(scene.id) ?? "");
      const frames = allocateFrames(
        shots.map((s) => s.weight),
        Math.round(seconds * FPS),
      );

      expect(frames.reduce((a, b) => a + b, 0)).toBe(Math.round(seconds * FPS));

      const violations = checkShotFrames(frames, FPS);
      expect(
        violations.map((v) => `${shots[v.index].id} ${v.seconds.toFixed(2)}s ${v.reason}`),
        `${scene.id} (~${seconds}s over ${shots.length} shots)`,
      ).toEqual([]);
    }
  });

  it("gives every shot a weight that means something", () => {
    for (const shot of EP4_SHOTS) {
      expect(Number.isFinite(shot.weight), `${shot.id} weight is not finite`).toBe(true);
      expect(shot.weight, `${shot.id} weight must be positive`).toBeGreaterThan(0);
    }
  });
});

describe("the cast locks hold across fifty-six generations", () => {
  it("resolves every cast key a shot names", () => {
    for (const shot of EP4_SHOTS) {
      for (const key of shot.cast ?? []) {
        expect(EP4_CAST[key], `${shot.id} names unknown cast key "${key}"`).toBeTruthy();
      }
    }
  });

  it("puts the style first and the lock text into the prompt", () => {
    const shot = EP4_SHOTS.find((s) => s.id === "ep4_s11a")!;
    const prompt = shotPromptFor(shot);
    expect(prompt.startsWith(STORYBOOK_STYLE)).toBe(true);
    expect(prompt).toContain("THE MAGICIAN");
  });

  it("leaves an uncast shot free of lock text", () => {
    const prompt = shotPromptFor(EP4_SHOTS.find((s) => s.id === "ep4_s02c")!);
    expect(prompt).not.toContain("THE BOY is the same boy");
  });

  it("never puts two jinn in one shot", () => {
    const jinn = ["jarJinni", "ringJinni", "lampJinni"];
    for (const shot of EP4_SHOTS) {
      const n = (shot.cast ?? []).filter((k) => jinn.includes(k)).length;
      expect(n, `${shot.id} casts ${n} jinn at once`).toBeLessThanOrEqual(1);
    }
  });

  it("locks Aladdin in every shot his face is in", () => {
    for (const id of [
      "ep4_s01b",
      "ep4_s03c",
      "ep4_s08d",
      "ep4_s09c",
      "ep4_s10d",
      "ep4_s12a",
      "ep4_s13b",
      "ep4_s14c",
    ]) {
      expect(shotPromptFor(EP4_SHOTS.find((s) => s.id === id)!), id).toContain(
        "THE BOY is the same boy",
      );
    }
  });
});

describe("recurring props are locked like recurring characters", () => {
  it("resolves every prop key a shot names", () => {
    for (const shot of EP4_SHOTS) {
      for (const key of shot.props ?? []) {
        expect(EP3_PROPS[key], `${shot.id} names unknown prop "${key}"`).toBeTruthy();
      }
    }
  });

  it("locks the lamp in every shot that has one in frame", () => {
    for (const shot of EP4_SHOTS) {
      if (!/\blamps?\b/i.test(shot.still)) continue;
      expect(
        (shot.props ?? []).length,
        `${shot.id} has a lamp in frame but no prop lock`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the pedlar's trade readable: same shape, obviously newer", () => {
    for (const id of ["ep4_s07a", "ep4_s07b"]) {
      expect(EP4_SHOTS.find((s) => s.id === id)!.props, id).toContain("newLamps");
    }
    expect(EP4_SHOTS.find((s) => s.id === "ep4_s07d")!.props).toEqual(
      expect.arrayContaining(["lamp", "newLamps"]),
    );
  });
});

describe("coverage, not repeated takes", () => {
  it("keeps most shots free of any legible character", () => {
    const faced = EP4_SHOTS.filter((s) => (s.cast ?? []).length > 0).length;
    expect(faced / EP4_SHOTS.length, `${faced}/${EP4_SHOTS.length} shots are cast`).toBeLessThan(
      0.5,
    );
  });

  it("never repeats the same framing twice running inside a scene", () => {
    const opening = (s: Ep4Shot) => s.still.slice(0, 40).toLowerCase();
    for (const scene of EP4.scenes) {
      const shots = shotsFor(scene.id);
      for (let i = 1; i < shots.length; i++) {
        expect(opening(shots[i]), `${shots[i].id} repeats ${shots[i - 1].id}`).not.toBe(
          opening(shots[i - 1]),
        );
      }
    }
  });

  it("describes movement in every motion prompt without re-describing the subject", () => {
    for (const shot of EP4_SHOTS) {
      expect(shot.motion.length, `${shot.id} has no motion`).toBeGreaterThan(30);
      expect(shot.still.length, `${shot.id} has no frame`).toBeGreaterThan(30);
      expect(shot.motion, `${shot.id} motion repeats its still`).not.toContain(
        shot.still.slice(0, 40),
      );
    }
  });
});

describe("dissolves are the exception, and only where time jumps", () => {
  it("dissolves in exactly two places, both in S6", () => {
    // The lamp gathering dust "one quiet day at a time" — the film's only
    // jumps in time, so its only dissolves.
    const dissolves = EP4_SHOTS.filter((s) => s.transitionIn === "dissolve");
    expect(dissolves.map((s) => s.id)).toEqual(["ep4_s06b", "ep4_s06c"]);
  });

  it("never dissolves into the first shot of a scene", () => {
    for (const scene of EP4.scenes) {
      expect(shotsFor(scene.id)[0].transitionIn, `${scene.id} first shot`).toBeUndefined();
    }
  });
});
