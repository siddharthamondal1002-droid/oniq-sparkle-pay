/**
 * Episode 3 is the first episode made of generated video rather than stills, so
 * a scene is now several clips instead of one image. That multiplies every way
 * the shot list can be quietly wrong, and each of those ways costs a paid
 * generation to discover.
 *
 * The expensive failures, in order of how much they cost to find late:
 *
 *  - A scene whose clips do not add up to its narration. Every scene after it
 *    then sits at the wrong offset and the music duck drifts out from under the
 *    voice. Invisible in any still.
 *  - A shot allocated more than ten seconds. The generator simply cannot make
 *    it, and you find out at generation time, one clip at a time.
 *  - A cast key that does not resolve. shotPromptFor filters unresolved keys
 *    out, so a typo costs nothing at build time and ships a shot with no lock —
 *    the character is re-invented in that clip alone, which is the exact fault
 *    the locks exist to prevent.
 *
 * All of these are checkable BEFORE any audio or any image exists, which is the
 * point: the same trick that caught ep3's overlong finale for free.
 */
import { describe, expect, it } from "vitest";
import { EP3_CAST, ORIGINALS, STORYBOOK_STYLE } from "@/data/originals";
import { EP3_SHOTS, shotPromptFor, shotsFor, type Ep3Shot } from "@/data/ep3Shots";
import { estimateSeconds, narrationFor } from "@/data/originalsScript";
import { allocateFrames, checkShotFrames } from "@/lib/shotAllocation";

const EP3 = ORIGINALS.find((e) => e.id === "ep3")!;
const FPS = 30;

describe("every scene is covered, and only real scenes are", () => {
  it("gives every episode 3 scene at least one shot", () => {
    for (const scene of EP3.scenes) {
      expect(shotsFor(scene.id).length, `${scene.id} has no shots`).toBeGreaterThan(0);
    }
  });

  it("has no shot pointing at a scene that does not exist", () => {
    // A renamed or deleted scene leaves an orphan shot that is generated, paid
    // for, and never appears in the episode.
    const ids = new Set(EP3.scenes.map((s) => s.id));
    for (const shot of EP3_SHOTS) {
      expect(ids.has(shot.sceneId), `${shot.id} covers unknown scene ${shot.sceneId}`).toBe(true);
    }
  });

  it("accounts for every shot in the array exactly once", () => {
    const viaScenes = EP3.scenes.flatMap((s) => shotsFor(s.id));
    expect(viaScenes.length).toBe(EP3_SHOTS.length);
  });
});

describe("shot ids are stable, unique and in cut order", () => {
  it("has no duplicate id", () => {
    // Ids are filename stems. A duplicate silently overwrites a generated clip
    // with a different one and the episode plays the same shot twice.
    const ids = EP3_SHOTS.map((s) => s.id);
    expect(new Set(ids).size, `duplicate shot id in ${ids.join(", ")}`).toBe(ids.length);
  });

  it("names each shot for its scene plus a letter, in sequence", () => {
    for (const scene of EP3.scenes) {
      const shots = shotsFor(scene.id);
      const expected = shots.map((_, i) => `${scene.id}${String.fromCharCode(97 + i)}`);
      expect(
        shots.map((s) => s.id),
        `${scene.id} shot ids out of sequence`,
      ).toEqual(expected);
    }
  });

  it("keeps a scene's shots contiguous in the array", () => {
    // The composition walks EP3_SHOTS in order. Interleaving two scenes' shots
    // would cut the episode into the wrong sequence while every per-scene
    // check above still passed.
    const order = EP3_SHOTS.map((s) => s.sceneId);
    const firstSeen = [...new Set(order)];
    expect(order).toEqual(firstSeen.flatMap((id) => shotsFor(id).map(() => id)));
  });
});

describe("the arithmetic closes before any audio exists", () => {
  // This is the guard the whole design hangs on. It runs on the ESTIMATE — the
  // same 140wpm planning figure the hold-ceiling test uses — because it has to
  // be answerable while the narration is still being generated.
  //
  // The estimate is deliberately the SLOW one. Measured against episode 2 the
  // real pace is ~2.49 words/second and 140wpm assumes 2.33, so it predicts
  // scenes slightly longer than they turn out to be. Sizing against the slower
  // figure means the real audio has headroom rather than overflowing.
  it("splits every scene into shots that the generator can actually make", () => {
    for (const scene of EP3.scenes) {
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
    for (const shot of EP3_SHOTS) {
      expect(Number.isFinite(shot.weight), `${shot.id} weight is not finite`).toBe(true);
      expect(shot.weight, `${shot.id} weight must be positive`).toBeGreaterThan(0);
    }
  });
});

describe("the cast locks hold across fifty-seven generations", () => {
  it("resolves every cast key a shot names", () => {
    for (const shot of EP3_SHOTS) {
      for (const key of shot.cast ?? []) {
        expect(EP3_CAST[key], `${shot.id} names unknown cast key "${key}"`).toBeTruthy();
      }
    }
  });

  it("puts the style first and the lock text into the prompt", () => {
    const shot = EP3_SHOTS.find((s) => s.id === "ep3_s02b")!;
    const prompt = shotPromptFor(shot);
    expect(prompt.startsWith(STORYBOOK_STYLE)).toBe(true);
    expect(prompt).toContain("crouched to a boy's height");
    expect(prompt).toContain("THE MAGICIAN");
    expect(prompt).toContain("ALADDIN");
  });

  it("leaves an uncast shot free of lock text", () => {
    // Hands, objects and crowds. A lock here spends prompt on a face that is
    // not in the frame, and invites the generator to add one.
    const prompt = shotPromptFor(EP3_SHOTS.find((s) => s.id === "ep3_s16c")!);
    expect(prompt).not.toContain("ALADDIN is the same boy");
  });

  it("never puts two jinn in one shot", () => {
    // Same rule as the scenes, restated at shot granularity — a scene can only
    // break it now by a shot breaking it.
    const jinn = ["jarJinni", "ringJinni", "lampJinni"];
    for (const shot of EP3_SHOTS) {
      const n = (shot.cast ?? []).filter((k) => jinn.includes(k)).length;
      expect(n, `${shot.id} casts ${n} jinn at once`).toBeLessThanOrEqual(1);
    }
  });

  it("locks Aladdin in every shot his face is in", () => {
    // He is in more shots than anyone and is the character most likely to
    // drift. If a shot shows his face, it carries his lock.
    for (const id of ["ep3_s01b", "ep3_s05d", "ep3_s06b", "ep3_s08c", "ep3_s13c", "ep3_s16b"]) {
      expect(shotPromptFor(EP3_SHOTS.find((s) => s.id === id)!), id).toContain(
        "ALADDIN is the same boy",
      );
    }
  });
});

describe("coverage, not repeated takes", () => {
  it("keeps most shots free of any recognisable face", () => {
    // The documented character-consistency strategy, asserted so it survives
    // editing. Four near-identical takes of one wide shot read as a glitch
    // because the eye compares them; four different angles read as filmmaking.
    // If this ever fails, the fix is more coverage — not better prompting.
    const faced = EP3_SHOTS.filter((s) => (s.cast ?? []).length > 0).length;
    expect(faced / EP3_SHOTS.length, `${faced}/${EP3_SHOTS.length} shots have a face`).toBeLessThan(
      0.5,
    );
  });

  it("never repeats the same framing twice running inside a scene", () => {
    // The specific fault this whole structure exists to avoid: two consecutive
    // clips of the same subject, which the eye compares and finds different.
    const opening = (s: Ep3Shot) => s.still.slice(0, 40).toLowerCase();
    for (const scene of EP3.scenes) {
      const shots = shotsFor(scene.id);
      for (let i = 1; i < shots.length; i++) {
        expect(opening(shots[i]), `${shots[i].id} repeats ${shots[i - 1].id}`).not.toBe(
          opening(shots[i - 1]),
        );
      }
    }
  });

  it("describes movement in every motion prompt without re-describing the subject", () => {
    for (const shot of EP3_SHOTS) {
      expect(shot.motion.length, `${shot.id} has no motion`).toBeGreaterThan(30);
      expect(shot.still.length, `${shot.id} has no frame`).toBeGreaterThan(30);
      // A motion prompt that restates the frame fights the image it is given.
      expect(shot.motion, `${shot.id} motion repeats its still`).not.toContain(
        shot.still.slice(0, 40),
      );
    }
  });
});

describe("dissolves are the exception, and only where time jumps", () => {
  it("dissolves in exactly three places, all in S11", () => {
    // "A house. Then a better house. Then a palace." A dissolve MEANS time
    // passed; anywhere else in this episode that is a lie, and between two
    // generated clips of one subject it is also a visible morph.
    const dissolves = EP3_SHOTS.filter((s) => s.transitionIn === "dissolve");
    expect(dissolves.map((s) => s.id)).toEqual(["ep3_s11b", "ep3_s11c", "ep3_s11d"]);
  });

  it("never dissolves into the first shot of a scene", () => {
    // Scene boundaries already cross-fade in the composition. A dissolve there
    // would stack two, and the scene would fade through black-ish twice.
    for (const scene of EP3.scenes) {
      expect(shotsFor(scene.id)[0].transitionIn, `${scene.id} first shot`).toBeUndefined();
    }
  });
});
