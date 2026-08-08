/**
 * The narration and the shot list must describe the same season.
 *
 * They live in two files because the camera and the voice are edited by
 * different people at different times. That separation is only safe if drift
 * is impossible — a scene added without a line, or a line left behind after a
 * scene is cut, would surface as a silent gap in a finished episode, which is
 * the most expensive place to find it.
 *
 * These also check the production arithmetic. The scripts were written before
 * anyone asked how long they take to read aloud, and the answer determines
 * which pipeline can build them at all.
 */
import { describe, expect, it } from "vitest";
import { ORIGINALS } from "@/data/originals";
import {
  NARRATION_WPM,
  SEASON_SCRIPT,
  estimateSeconds,
  narrationFor,
} from "@/data/originalsScript";
// Straight from the server module rather than a copy. runway.server.ts is
// "never imported by the client", but its top-level imports are type-only, so
// a test can read the constant without pulling in a runtime dependency — and
// a second copy of the limit is exactly how this check would go stale.
import { ALLOWED_DURATIONS } from "@/lib/runway.server";

const allScenes = ORIGINALS.flatMap((e) => e.scenes);

describe("every scene has exactly one line, and every line a scene", () => {
  it("covers all 40 scenes", () => {
    expect(allScenes).toHaveLength(40);
    for (const s of allScenes) {
      expect(narrationFor(s.id), `no narration for ${s.id} (${s.label})`).toBeTruthy();
    }
  });

  it("leaves no orphan lines behind a cut scene", () => {
    const ids = new Set(allScenes.map((s) => s.id));
    const orphans = SEASON_SCRIPT.filter((l) => !ids.has(l.sceneId)).map((l) => l.sceneId);
    expect(orphans, `narration for scenes that do not exist: ${orphans.join(", ")}`).toEqual([]);
  });

  it("has no duplicate scene ids", () => {
    const seen = SEASON_SCRIPT.map((l) => l.sceneId);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives every line real prose, not a placeholder", () => {
    for (const l of SEASON_SCRIPT) {
      expect(l.narration.trim().length, l.sceneId).toBeGreaterThan(40);
      expect(l.narration, `${l.sceneId} looks like a placeholder`).not.toMatch(/TODO|TBD|lorem/i);
      // Direction belongs in originals.ts. A narrator reading "SCENE 4" aloud
      // is the failure this catches.
      expect(l.narration, `${l.sceneId} contains direction`).not.toMatch(
        /^\s*(SCENE|INT\.|EXT\.|CUT TO)/i,
      );
    }
  });
});

describe("compliance survives in the words actually spoken", () => {
  const spoken = SEASON_SCRIPT.map((l) => l.narration).join(" ");

  it("names no prophet, divine figure or scripture", () => {
    // The rule lives in originals.ts as a comment on the pictures. It has to
    // hold for the narration too, which is the half an audience hears.
    expect(spoken).not.toMatch(
      /\b(prophet|Solomon|Sulayman|Allah|God|Qur'?an|Koran|scripture|angel)\b/i,
    );
  });

  it("keeps the jar's seal unattributed", () => {
    expect(narrationFor("ep1_s06")).toMatch(/mark that no one living could read/i);
  });

  it("depicts no violence", () => {
    // Kasim's death, the thirty-seven and the captain are all off-page. The
    // words carry the outcome and never the method.
    expect(spoken).not.toMatch(/\b(blood|stab|behead|quarter(ed)?|boil(ing)?\s+oil|dismember)\b/i);
    expect(narrationFor("ep2_s11")).toMatch(/did not come home/i);
    expect(narrationFor("ep2_s13")).toMatch(/dealt with them, quietly/i);
  });
});

describe("the production arithmetic, which decides the pipeline", () => {
  const perEpisode = ORIGINALS.map((e) => ({
    id: e.id,
    seconds: e.scenes.reduce((n, s) => n + estimateSeconds(narrationFor(s.id) ?? ""), 0),
    scenes: e.scenes.length,
  }));

  it("estimates from words, and says so rather than hardcoding a runtime", () => {
    expect(NARRATION_WPM).toBeGreaterThan(100);
    expect(estimateSeconds("one two three four five six seven")).toBe(3);
  });

  it("runs several minutes per episode", () => {
    for (const e of perEpisode) {
      expect(e.seconds, `${e.id} is only ${e.seconds}s`).toBeGreaterThan(150);
    }
  });

  it("needs scenes far longer than Runway can generate", () => {
    // THE FINDING. Runway tops out at 10 seconds a clip. These scenes average
    // well past that, so image-to-video cannot build these episodes on its
    // own — they need stills held under narration with planned motion, which
    // is what episodeTimeline.ts describes and what the missing renderer would
    // execute. Recorded as a test so nobody re-discovers it by burning credits.
    const longest = Math.max(...ALLOWED_DURATIONS);
    for (const e of perEpisode) {
      const avg = e.seconds / e.scenes;
      expect(avg, `${e.id} averages ${Math.round(avg)}s per scene`).toBeGreaterThan(longest);
    }
  });
});
