import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VFX, particlesAt, vfxKindFor, vfxSeed, type VfxKind } from "@/lib/particleField";

/**
 * The particle math's one hard contract is DETERMINISM ACROSS RENDER ORDER:
 * Remotion renders frames out of order in parallel processes, and the film
 * is rendered in halves — any state between frames tears the film at the
 * seam. These pin that, the coordinate bounds the composition trusts, and
 * the words-to-effect gate.
 */
describe("vfxKindFor", () => {
  it("lets the scene's words choose the effect", () => {
    expect(vfxKindFor("Embers drift up from the festival fires")).toBe("embers");
    expect(vfxKindFor("Rain hammers the harbour at night")).toBe("rain");
    expect(vfxKindFor("Snow settles on the pass")).toBe("snow");
    expect(vfxKindFor("Fireflies wake in the moonlit garden")).toBe("fireflies");
    expect(vfxKindFor("A dusty bazaar in late amber light")).toBe("dust");
  });

  it("speaks thesaurus: synonyms earn the same effect as the plain word", () => {
    expect(vfxKindFor("A blazing brazier beside the throne")).toBe("embers");
    expect(vfxKindFor("Cinders drift from the smouldering pyre")).toBe("embers");
    expect(vfxKindFor("A candlelit study, late")).toBe("embers");
    expect(vfxKindFor("A deluge over the harbour")).toBe("rain");
    expect(vfxKindFor("The squall drives torrential water down the lanes")).toBe("rain");
    expect(vfxKindFor("Flurries over the wintry pass")).toBe("snow");
    expect(vfxKindFor("A hailstorm rattles the shutters")).toBe("snow");
    expect(vfxKindFor("Glowworms under starlight by the stream")).toBe("fireflies");
    expect(vfxKindFor("The twinkling city far below")).toBe("fireflies");
    expect(vfxKindFor("Pollen turns in a sunbeam in the old cellar")).toBe("dust");
    expect(vfxKindFor("Ashes and smoke hang in the ruined hall")).toBe("dust");
  });

  it("returns NOTHING for a scene that names nothing — absence is the default", () => {
    expect(vfxKindFor("A quiet palace hall, a princess reading a letter")).toBeNull();
    expect(vfxKindFor("")).toBeNull();
  });

  it("water beats light: a rainy night is rain, not fireflies", () => {
    expect(vfxKindFor("Rain over the moonlit rooftops")).toBe("rain");
  });

  it("does not fire on mere substrings of other words", () => {
    // 'grain' contains 'rain'; the word-boundary anchor must hold.
    expect(vfxKindFor("Sacks of grain stacked in the storehouse")).toBeNull();
    // The thesaurus traps, each guarded individually in the classifier:
    expect(vfxKindFor("Her sparkling jewels catch the light")).toBeNull();
    expect(vfxKindFor("A soothing voice from the doorway")).toBeNull();
    expect(vfxKindFor("He looked away, ashamed")).toBeNull();
    expect(vfxKindFor("The crowd hailed the young king")).toBeNull();
    // The review's second sweep of prose traps:
    expect(vfxKindFor("A burnished shield above the door")).toBeNull();
    expect(vfxKindFor("He would never forget her face")).toBeNull();
    expect(vfxKindFor("The sandals stride through frame")).toBeNull();
    expect(vfxKindFor("A twinkle in his eye")).toBeNull();
    expect(vfxKindFor("She stormed out of the hall")).toBeNull();
  });

  it("routes compound storms to their own element, not to rain", () => {
    expect(vfxKindFor("A snowstorm over the pass")).toBe("snow");
    expect(vfxKindFor("A sandstorm swallows the caravan")).toBe("dust");
    expect(vfxKindFor("The dust storm rolls toward the city")).toBe("dust");
    expect(vfxKindFor("A storm breaks over the harbour")).toBe("rain");
  });

  it("pins the priority ladder beyond the rain-vs-fireflies rung", () => {
    // Embers are checked first — a fire IN weather stays a fire scene.
    expect(vfxKindFor("The storm drowned the campfire")).toBe("embers");
    // Fireflies outrank dust: a moonlit bazaar is a night scene.
    expect(vfxKindFor("The moonlit bazaar, empty and silver")).toBe("fireflies");
  });
});

describe("vfxSeed", () => {
  it("is stable for the same identity and different across identities", () => {
    expect(vfxSeed("3:ep4_s01a")).toBe(vfxSeed("3:ep4_s01a"));
    expect(vfxSeed("3:ep4_s01a")).not.toBe(vfxSeed("4:ep4_s01b"));
  });

  it("is an unsigned 32-bit integer — a JSON-safe plan field", () => {
    for (const id of ["a", "ep4_s13d", "0:still text with words"]) {
      const s = vfxSeed(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});

describe("particlesAt", () => {
  const KINDS = Object.keys(VFX) as VfxKind[];

  it("is a pure function of (kind, seed, frame): identical on every call", () => {
    for (const kind of KINDS) {
      const a = particlesAt(kind, 1234, 137, 30);
      const b = particlesAt(kind, 1234, 137, 30);
      expect(a).toEqual(b);
    }
  });

  it("needs no earlier frame: frame 500 computes without visiting 0..499", () => {
    // The test IS the call pattern: jump straight to a late frame and get
    // the same answer a sequential walk would give (purity implies it, and
    // the render halves depend on it).
    const late = particlesAt("embers", 77, 500, 30);
    const again = particlesAt("embers", 77, 500, 30);
    expect(late).toEqual(again);
    expect(late).not.toEqual(particlesAt("embers", 77, 499, 30));
  });

  it("keeps particles inside the frame (x may overhang by sway) and opacity in 0..1", () => {
    for (const kind of KINDS) {
      const sway = VFX[kind].sway[0];
      for (const frame of [0, 45, 313, 4000]) {
        for (const p of particlesAt(kind, 999, frame, 30)) {
          // Sway rides OUTSIDE the wrap (the teleport fix), so x may overhang
          // the frame by up to the sway amplitude; the overlay clips it.
          expect(p.x).toBeGreaterThanOrEqual(-sway);
          expect(p.x).toBeLessThan(1 + sway);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThan(1);
          expect(p.r).toBeGreaterThan(0);
          expect(p.opacity).toBeGreaterThanOrEqual(0);
          expect(p.opacity).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("never teleports: at most one seam recycle per particle per shot", () => {
    // The review EXECUTED the first version and counted seven full-width
    // x-jumps in a ten-second embers shot: sway inside the wrap re-crossed
    // the seam every half-cycle. With drift wrapped alone, |vx| bounds the
    // legitimate recycles to at most one in ten seconds for every kind.
    for (const kind of KINDS) {
      for (const seed of [7, 24, 999]) {
        const frames = Array.from({ length: 301 }, (_, f) => particlesAt(kind, seed, f, 30));
        const count = VFX[kind].count;
        for (let i = 0; i < count; i++) {
          let jumps = 0;
          for (let f = 1; f <= 300; f++) {
            if (Math.abs(frames[f][i].x - frames[f - 1][i].x) > 0.5) jumps++;
          }
          expect(jumps, `${kind} seed ${seed} particle ${i}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("delivers each kind's full count, and different seeds different air", () => {
    for (const kind of KINDS) {
      expect(particlesAt(kind, 5, 10, 30).length).toBe(VFX[kind].count);
    }
    expect(particlesAt("dust", 1, 10, 30)).not.toEqual(particlesAt("dust", 2, 10, 30));
  });

  it("is gated movie-grade-only in the worker and clip-free in the composition", () => {
    // The tier contract, pinned as text like every cross-into-remotion test:
    // classic plans must never carry vfx, clips must never get an overlay,
    // and the pushed shape must be what StoryShotInput['vfx'] declares.
    const worker = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");
    expect(worker).toMatch(/if \(cinematic && !clip\) \{\s*\n\s*const kind = vfxKindFor\(/);
    expect(worker).toMatch(/vfx = \{ kind, seed: vfxSeed\(/);
    // "the rain error" (owner, 2026-08-21): the atmosphere is a VISIBLE layer,
    // so it keys on the still prompt (the frame the viewer sees) ALONE — never
    // the narration, or a narrator merely mentioning weather paints rain over
    // a dry shot. Pin the argument so narration can't creep back in.
    expect(worker).toMatch(/const kind = vfxKindFor\(shot\.still\);/);
    expect(worker).not.toMatch(/vfxKindFor\(`\$\{shot\.still\} \$\{shot\.narration\}`\)/);
    const film = readFileSync(join(process.cwd(), "remotion/src/story/StoryFilm.tsx"), "utf8");
    expect(film).toMatch(/\{!shot\.clip && shot\.vfx \? <ParticleOverlay/);
  });

  /**
   * THE RAIN STROBE, 2026-08-16 — reported by the owner watching their own
   * films, and reproduced by rendering before it was believed.
   *
   * A streak IS motion blur, so its length has to be the distance travelled
   * in one frame. The first version drew `height: d * 14` — a multiple of
   * the DROP'S RADIUS, which knows nothing about how fast it falls. At the
   * story composition's 1080x1920 at 30fps that gave a 43-75px streak while
   * rain falls 58-90px per frame, so every drop cleared its own length
   * between frames and left up to 44px of dark behind it. Rendering frame 0
   * and frame 1 in different colours showed the pairs sitting apart with a
   * gap between them: the layer played as dashes flickering in place.
   *
   * The check computes the streak exactly as ParticleOverlay does and
   * asserts the drop cannot outrun it. Held at three frame rates, because
   * the bug was a length that ignored fps and 30 alone would not have shown
   * it.
   */
  it("draws rain streaks longer than one frame of fall — no strobe", () => {
    const W = 1080;
    const H = 1920; // the story composition, StoryRoot.tsx
    const OVERLAP = 1.15; // ParticleOverlay.STREAK_OVERLAP
    for (const fps of [24, 30, 60]) {
      const a = particlesAt("rain", 12345, 0, fps);
      const b = particlesAt("rain", 12345, 1, fps);
      for (let i = 0; i < a.length; i++) {
        const r = a[i].r * H;
        const d = Math.max(1, r * 2);
        const dx = (a[i].vx * W) / fps;
        const dy = (a[i].vy * H) / fps;
        const streak = Math.max(d, Math.hypot(dx, dy) * OVERLAP);
        // Actual travel, taken from the positions rather than the velocity,
        // so a drift term that stopped matching the motion would show here.
        let travel = (b[i].y - a[i].y) * H;
        if (travel < 0) travel += H; // recycled through the seam this frame
        expect(travel, `rain ${fps}fps particle ${i} outran its streak`).toBeLessThanOrEqual(
          streak,
        );
      }
    }
  });

  it("carries the drift velocity so a streak can be drawn from it", () => {
    // Rain is the only streaked kind: it falls (vy > 0) and the wind blows
    // one way (vx > 0), which is what fixes the lean of every streak.
    for (const p of particlesAt("rain", 7, 90, 30)) {
      expect(p.vy).toBeGreaterThan(0);
      expect(p.vx).toBeGreaterThan(0);
    }
    // Embers rise, so their vy is negative — the sign is the direction, not
    // a magnitude with a separate flag.
    for (const p of particlesAt("embers", 7, 90, 30)) expect(p.vy).toBeLessThan(0);
    // Velocity is a property of the particle, not of the frame: it must not
    // drift as the shot plays, or the streak would change length mid-fall.
    const early = particlesAt("rain", 7, 5, 30);
    const late = particlesAt("rain", 7, 300, 30);
    expect(late.map((p) => p.vy)).toEqual(early.map((p) => p.vy));
  });

  it("derives the streak from the particle, not from a hand-set constant", () => {
    // A hardcoded slant already got caught pointing every streak AGAINST its
    // own motion once. Derived from (vx, vy) it cannot disagree with the
    // physics again, so the absence of the constant is what is pinned.
    const overlay = readFileSync(
      join(process.cwd(), "remotion/src/story/ParticleOverlay.tsx"),
      "utf8",
    );
    expect(overlay).not.toContain("RAIN_SLANT_DEG");
    expect(overlay).toContain("Math.atan2(dx, dy)");
    expect(overlay).toContain("Math.hypot(dx, dy) * STREAK_OVERLAP");
    expect(overlay, "the streak is back to a multiple of the radius").not.toMatch(/d \* 14/);
  });

  it("actually moves: embers rise between frames, rain falls fast", () => {
    const before = particlesAt("embers", 42, 30, 30);
    const after = particlesAt("embers", 42, 45, 30);
    // Track a particle that does not wrap across the half-second.
    const moved = before.findIndex((p, i) => Math.abs(after[i].y - p.y) < 0.5);
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(after[moved].y).toBeLessThan(before[moved].y); // embers go UP
    const r0 = particlesAt("rain", 42, 30, 30);
    const r1 = particlesAt("rain", 42, 33, 30);
    const drop = r0.findIndex((p, i) => r1[i].y > p.y && r1[i].y - p.y < 0.5);
    expect(drop).toBeGreaterThanOrEqual(0);
    expect(r1[drop].y - r0[drop].y).toBeGreaterThan(0.05); // fast, in a tenth of a second
  });
});
