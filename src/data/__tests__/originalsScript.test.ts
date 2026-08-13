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
  VOICES,
  estimateSeconds,
  narrationFor,
  segmentsFor,
} from "@/data/originalsScript";
// Straight from the server module rather than a copy. runway.server.ts is
// "never imported by the client", but its top-level imports are type-only, so
// a test can read the constant without pulling in a runtime dependency — and
// a second copy of the limit is exactly how this check would go stale.
import { ALLOWED_DURATIONS } from "@/lib/runway.server";

const allScenes = ORIGINALS.flatMap((e) => e.scenes);

describe("every scene has exactly one line, and every line a scene", () => {
  it("covers all 58 scenes", () => {
    // Hardcoded on purpose: a scene silently disappearing is otherwise
    // invisible, because every remaining scene would still have its line.
    // 40 until the two finales were split three ways each — see the hold
    // ceiling below. 44 until ep4 (the owner's Aladdin cut) added fourteen.
    expect(allScenes).toHaveLength(58);
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

describe("splitting a scene by speaker changes nothing but the voice", () => {
  const withDialogue = SEASON_SCRIPT.filter((l) => l.segments);

  it("has dialogue scenes at all", () => {
    // Guards the guard: if segments were dropped wholesale, every assertion
    // below would iterate an empty list and pass.
    expect(withDialogue.length).toBeGreaterThan(0);
  });

  it("rejoins to the narration word for word", () => {
    // The whole safety property. `narration` is what a human reviewed and what
    // every compliance check reads; the segments are only a division of it. If
    // they can drift, the episode people HEAR stops being the script anyone
    // approved — and nothing else in the suite would notice.
    for (const line of withDialogue) {
      const rejoined = line.segments!.map((s) => s.text).join(" ");
      expect(rejoined, `${line.sceneId} segments do not rejoin to its narration`).toBe(
        line.narration,
      );
    }
  });

  it("names a real voice for every segment", () => {
    for (const line of withDialogue) {
      for (const seg of line.segments!) {
        expect(VOICES[seg.voice], `${line.sceneId} uses unknown voice "${seg.voice}"`).toBeTruthy();
      }
    }
  });

  it("keeps the two jinn audibly apart", () => {
    // The production notes require the DESIGNS to be distinct. The voices
    // matter more: a listener has nothing else to tell them apart by.
    expect(VOICES.ringJinni).not.toBe(VOICES.lampJinni);
  });

  it("keeps the narrator on the season voice", () => {
    // Episode 1 and 2 are already published with this narrator. Changing it
    // reads as a different show.
    expect(VOICES.narrator).toBe("ash");
  });

  it("gives every character a voice of their own", () => {
    const used = Object.values(VOICES);
    expect(new Set(used).size, `voices collide: ${used.join(", ")}`).toBe(used.length);
  });

  it("leaves an attribution with the narrator, not the character", () => {
    // "“Below,”" is the magician; "said the man," is not. A character reading
    // their own stage direction aloud is the failure this splitting exists to
    // avoid, and it is invisible until someone listens.
    const s04 = SEASON_SCRIPT.find((l) => l.sceneId === "ep3_s04")!;
    const attribution = s04.segments!.find((s) => s.text.includes("said the man"));
    expect(attribution?.voice).toBe("narrator");
  });

  it("falls back to the narrator for a scene with no dialogue", () => {
    const plain = SEASON_SCRIPT.find((l) => !l.segments)!;
    const segs = segmentsFor(plain);
    expect(segs).toHaveLength(1);
    expect(segs[0].voice).toBe("narrator");
    expect(segs[0].text).toBe(plain.narration);
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

  it("holds no single still past the point where it reads as a stall", () => {
    // These episodes are stills under narration with slow Ken Burns over them.
    // A still can carry a long line, but not an unlimited one — past roughly
    // forty-five seconds the motion stops registering as motion and the shot
    // reads as frozen.
    //
    // 45s is not a guess: it is ep1_s09, the longest hold in the one episode
    // that has actually shipped, and it works. 50 gives that a little room.
    //
    // Both season finales busted it. ep2_s14 was 167 words and measured 65.2s
    // on one image; ep3_s14 was 158 words and estimated 68s. Neither was
    // rewritten — each was split into the beats its paragraph already had,
    // reassembling to the original word for word.
    //
    // This runs on the ESTIMATE because it has to be checkable before any
    // audio exists. That is the whole point: ep3 has not been generated, so
    // catching its finale here cost nothing, where catching it after fourteen
    // stills and fourteen recordings would not have.
    const CEILING = 50;
    for (const scene of allScenes) {
      const seconds = estimateSeconds(narrationFor(scene.id) ?? "");
      expect(seconds, `${scene.id} holds one still for ~${seconds}s`).toBeLessThanOrEqual(CEILING);
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
