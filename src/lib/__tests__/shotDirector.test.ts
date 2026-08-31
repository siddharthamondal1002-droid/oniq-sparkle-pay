/**
 * AI DIRECTOR — the monotony fix must never become a weather bug.
 *
 * Evidence base (owner brick #104): both 300s/43-shot proof runs rendered
 * visually monotone films — vfx:rain on ~40/43 shots (b20e5ce1's palette),
 * vfx:snow with air:surf on 43/43 (5871421e, Actions run 32481464700). The
 * director pass varies size and lighting across the sequence; these tests
 * pin the two safety contracts that make that variation shippable:
 *
 *   1. Determinism — same plan + same job id = the same film, on any
 *      machine, in any render order (the Remotion rule).
 *   2. Weather neutrality — no palette phrase may register with vfxKindFor,
 *      and decorating a wet/snowy/fiery still must preserve its
 *      classification verbatim (the one-authoritative-weather rule,
 *      owner 2026-08-21).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { vfxKindFor } from "../particleField.ts";
import { ambienceFor } from "../soundStage.ts";
import {
  FACE_LEGIBLE_SIZES,
  LIGHTING_PALETTE,
  SHOT_SIZES,
  directShots,
  faceCarriesTheBeat,
  hasLeadingSize,
} from "../shotDirector.ts";

/** 43 deliberately monotone stills — the measured failure shape. */
const MONOTONE = Array.from(
  { length: 43 },
  (_, i) =>
    `A snow-covered village lane at dusk, shot ${i + 1}, the same empty ` +
    `street under the same falling snow.`,
);

describe("shotDirector determinism", () => {
  it("same stills + same seed produce the identical film", () => {
    const a = directShots(MONOTONE, "5871421e-c298-45e7-a6db-746f7486424a");
    const b = directShots(MONOTONE, "5871421e-c298-45e7-a6db-746f7486424a");
    expect(a).toEqual(b);
  });

  it("a different job id cuts a different rhythm", () => {
    const a = directShots(MONOTONE, "job-a");
    const b = directShots(MONOTONE, "job-b");
    expect(a.map((s) => s.lighting)).not.toEqual(b.map((s) => s.lighting));
  });
});

describe("shotDirector variation (the brick's purpose)", () => {
  const out = directShots(MONOTONE, "job-a");

  it("uses several sizes and several lightings across a monotone plan", () => {
    const sizes = new Set(out.map((s) => s.size).filter(Boolean));
    const lights = new Set(out.map((s) => s.lighting));
    expect(sizes.size).toBeGreaterThanOrEqual(4);
    expect(lights.size).toBeGreaterThanOrEqual(5);
  });

  it("never repeats a lighting on adjacent shots", () => {
    for (let i = 1; i < out.length; i++) {
      expect(out[i].lighting).not.toBe(out[i - 1].lighting);
    }
  });

  it("opens establishing and closes wide", () => {
    expect(out[0].size).toBe("establishing");
    expect(out[out.length - 1].size).toBe("wide");
  });

  it("adds a bounded decoration, not a rewrite", () => {
    for (const [i, s] of out.entries()) {
      expect(s.still.startsWith(MONOTONE[i])).toBe(true);
      expect(s.still.length - MONOTONE[i].length).toBeLessThanOrEqual(70);
    }
  });
});

describe("shotDirector weather neutrality (must never change vfx)", () => {
  it("every palette phrase and size is invisible to vfxKindFor", () => {
    for (const phrase of [...LIGHTING_PALETTE, ...SHOT_SIZES, "establishing"]) {
      expect(vfxKindFor(phrase), phrase).toBeNull();
    }
  });

  it("every palette phrase and size is invisible to ambienceFor too", () => {
    // Defence in depth: the worker feeds ambienceFor the UNDECORATED still
    // (pinned below), but a palette word like "dusk" or "twilight" would turn
    // into night crickets the day someone reroutes that call. Keep the whole
    // palette silent to the audio chooser so that refactor can never make a
    // lighting note change a film's sound.
    for (const phrase of [...LIGHTING_PALETTE, ...SHOT_SIZES, "establishing"]) {
      expect(ambienceFor(phrase), phrase).toBeNull();
    }
  });

  it("decoration preserves the classification of weathered stills verbatim", () => {
    const weathered = [
      "The harbour under a driving rainstorm, nets slack.",
      "Snow settling on the shrine steps at first light.",
      "The forge, coals bright, sparks leaping from the anvil.",
      "A dusty bazaar aisle stacked with copper pots.",
      "A dry stone courtyard, nothing in the air at all.",
    ];
    for (const seed of ["job-a", "job-b", "job-c"]) {
      const out = directShots(weathered, seed);
      for (const [i, s] of out.entries()) {
        expect(vfxKindFor(s.still), s.still).toBe(vfxKindFor(weathered[i]));
      }
    }
  });
});

describe("shotDirector defers to the plan's own grammar", () => {
  it("keeps a still's own leading size", () => {
    expect(hasLeadingSize("Wide shot of the pier at dawn")).toBe(true);
    expect(hasLeadingSize("An extreme close-up on her hands")).toBe(true);
    expect(hasLeadingSize("The village square, a wide expanse of mud")).toBe(false);
    const out = directShots(["Wide shot of the pier at dawn", "The square at noon"], "s");
    expect(out[0].size).toBeNull();
    expect(out[0].still).toMatch(/^Wide shot of the pier at dawn — (?!.*shot, )/);
    expect(out[1].size).toBe("wide"); // last shot closes wide
  });

  it("leaves an over-budget still undecorated rather than half-sliced", () => {
    const long = "x".repeat(1800);
    const out = directShots([long, "short"], "s");
    expect(out[0].still).toBe(long);
    expect(out[0].size).toBeNull();
  });
});

describe("story worker carries the director pass", () => {
  const src = readFileSync(
    join(process.cwd(), "remotion/scripts/story-worker.mjs"),
    "utf8",
  );

  it("imports the director and runs it over the whole plan", () => {
    expect(src).toMatch(/import \{ directShots \} from '\.\.\/\.\.\/src\/lib\/shotDirector\.ts'/);
    expect(src).toMatch(/directShots\(\s*plan\.shots\.map\(\(s\) => s\.still\),\s*String\(job\.id\),/);
  });

  it("hands the director the shots' own grammar, not just their text", () => {
    // Size used to come from POSITION alone, so a line of dialogue could be
    // assigned `wide shot` and the face drawn at ~25px on a 704-wide canvas.
    // The beat has to reach the director for that to be impossible.
    expect(src).toMatch(/dialogue: s\.dialogue \?\? null,/);
    expect(src).toContain("FACE BEAT");
  });

  it("feeds the DECORATED still to both the weather decision and the image ask", () => {
    // One text, one decision: selectSceneWeather must read the directed
    // still, and the primary ask must be built from the same directed still.
    expect(src).toMatch(/selectSceneWeather\(directedStill\)/);
    expect(src).toMatch(/\$\{directedStill\}\\n\\nSetting: \$\{settingForImage\}/);
    // The undirected still must no longer reach the weather decision.
    expect(src).not.toMatch(/selectSceneWeather\(shot\.still\)/);
  });

  it("keeps the audio and emotion choosers on the UNDECORATED still", () => {
    // The director varies the image, not the sound stage or the acting: the
    // ambience bed and the expression register are earned by the plan's own
    // words. Pin their inputs so a refactor cannot silently hand them the
    // decorated text (where a lighting note could masquerade as scene words).
    expect(src).toMatch(/ambienceFor\(`\$\{shot\.still\} \$\{shot\.narration\}`\)/);
    expect(src).not.toMatch(/ambienceFor\([^)]*directedStill/);
    expect(src).toMatch(/emotionFor\(\s*`\$\{shot\.still\} \$\{shot\.narration\}/);
    expect(src).not.toMatch(/emotionFor\([^)]*directedStill/);
  });
});

// ─────────────────────────── face visibility (§9), as behaviour
describe("a beat the face carries is never assigned a wide", () => {
  const dialogueShot = {
    still: "A man stands in a doorway.",
    narration: "He answered at last.",
    dialogue: { line: "The jar was never mine." },
  };
  const sceneryShot = {
    still: "An empty desert at dawn with no people in it.",
    narration: "The sun rose.",
  };

  it("a spoken line forces a face-legible size", () => {
    const beats = Array.from({ length: 9 }, () => dialogueShot);
    const out = directShots(beats.map((b) => b.still), "film-1", beats);
    for (const shot of out) {
      expect(FACE_LEGIBLE_SIZES).toContain(shot.size);
      expect(shot.faceFramed).toBe(true);
    }
  });

  it("including the LAST shot, which used to be forced wide", () => {
    // The film ending on someone's face is exactly the shot a forced wide was
    // worst for.
    const beats = Array.from({ length: 5 }, (_, i) => (i === 4 ? dialogueShot : sceneryShot));
    const out = directShots(beats.map((b) => b.still), "film-2", beats);
    expect(FACE_LEGIBLE_SIZES).toContain(out[4].size);
  });

  it("but the rhythm survives — face beats still cut between framings", () => {
    const beats = Array.from({ length: 9 }, () => dialogueShot);
    const sizes = new Set(directShots(beats.map((b) => b.still), "film-3", beats).map((s) => s.size));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("a scenery beat is untouched, wides and all", () => {
    const beats = Array.from({ length: 6 }, () => sceneryShot);
    const out = directShots(beats.map((b) => b.still), "film-4", beats);
    expect(out.every((s) => s.faceFramed === false)).toBe(true);
    expect(out[0].size).toBe("establishing");
    expect(out[out.length - 1].size).toBe("wide");
  });

  it("a shot that merely contains a person does not become a close-up", () => {
    // Coverage is the consistency strategy; a film of faces reads as a glitch.
    expect(faceCarriesTheBeat({ still: "A figure walks along the harbour wall.", narration: "Time passed." })).toBe(false);
  });

  it("an explicit denial of people wins over the word 'people'", () => {
    expect(faceCarriesTheBeat({ still: "A square with no people in it.", narration: "He looks up." })).toBe(false);
  });

  it("with no beats supplied the director behaves exactly as before", () => {
    const stills = ["a", "b", "c", "d", "e"];
    const out = directShots(stills, "film-5");
    expect(out[0].size).toBe("establishing");
    expect(out[4].size).toBe("wide");
    expect(out.every((s) => s.faceFramed === false)).toBe(true);
  });
});
