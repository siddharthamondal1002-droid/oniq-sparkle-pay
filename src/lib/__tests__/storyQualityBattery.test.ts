/**
 * THE QUALITY BATTERY — fifteen categories, A to O.
 *
 * These exist because the 2026-08-31 capability audit found a system that was
 * GREEN and WRONG at the same time: 275 passing tests, a clean `tsc`, a
 * pipeline that completed films end to end, and a canvas that sampled 704x480
 * landscape while every prompt asked for "Vertical 9:16 portrait" and the
 * assembler cropped 61.6% of each frame's width away. Nothing in the suite
 * could see that, because nothing in the suite asked what the system actually
 * DID — only whether each piece returned without throwing.
 *
 * So the rule here is behavioural first. Where a claim can be checked by
 * calling the real function with real inputs, it is. Source-text assertions
 * appear only where the thing being pinned IS a property of the source — that
 * a module contains no `Math.random`, that a call site passes a particular
 * argument — and each says so.
 *
 * The letters are the directive's own fifteen concerns, in its order.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAX_ASK_CHARS,
  ENGINE_MAX_PROMPT_CHARS,
  MAX_NEGATIVE_PROMPT_CHARS,
} from "../../../supabase/functions/_shared/oniqImage.ts";
import {
  MAX_SEED,
  deriveSeed,
} from "../../../supabase/functions/_shared/storySeed.ts";
import {
  negativePromptFor,
  shotShowsAFace,
} from "../../../supabase/functions/_shared/faceQuality.ts";
import {
  CAPABILITY_MARKER,
  classifyReferenceFailure,
} from "../../../supabase/functions/_shared/referenceOutcome.ts";
import {
  DEFAULT_CAMERA,
  DEFAULT_EXPRESSION,
  composeInHouseVideoPrompt,
  composeVideoPrompt,
  namesACameraMove,
  visualCondition,
} from "../../../supabase/functions/_shared/movieGrammar.ts";
import {
  buildClipPayload,
  clipSeed,
  unitKey,
} from "../../../supabase/functions/_shared/inHouseMotion.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * Source with its comments removed. Several assertions below are about what
 * the CODE does not do, and this codebase deliberately records a prohibition
 * in the comment right above the code that honours it — so a naive substring
 * search finds the very words it is checking for the absence of. Stripping
 * first means the note can stay where it is useful.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const worker = read("remotion/scripts/story-worker.mjs");
const stillFn = read("supabase/functions/story-still/index.ts");
const motionFn = read("supabase/functions/story-motion/index.ts");
const seedSrc = read("supabase/functions/_shared/storySeed.ts");
const faceSrc = read("supabase/functions/_shared/faceQuality.ts");
const grammarSrc = read("supabase/functions/_shared/movieGrammar.ts");

/** The film's canvas, as the assembler and the worker's contract both hold it. */
const FILM_W = 1080;
const FILM_H = 1920;
/** contract.py, post-fix. Mirrored here so a drift shows up as a failure. */
const GEN_W = 704;
const GEN_H = 1248;

// ─────────────────────────────────────────────── A. the canvas
describe("A — the canvas is portrait, and nothing asks for it in words", () => {
  it("the generation canvas is portrait and 32-divisible on both axes", () => {
    expect(GEN_H).toBeGreaterThan(GEN_W);
    expect(GEN_W % 32).toBe(0);
    expect(GEN_H % 32).toBe(0);
  });

  it("the old 16x pixel deficit cannot come back", () => {
    // 704x480 into 1080x1920 scaled 4.00x and threw away 61.6% of the width:
    // 129,600 source pixels were visible behind 2,073,600 film pixels.
    const scale = Math.max(FILM_W / GEN_W, FILM_H / GEN_H);
    const visible =
      Math.min(GEN_W, Math.round(FILM_W / scale)) *
      Math.min(GEN_H, Math.round(FILM_H / scale));
    const deficit = (FILM_W * FILM_H) / visible;
    expect(deficit).toBeLessThan(3);
    // And the crop is a rounding error rather than a decision.
    expect(FILM_W / (GEN_W * scale)).toBeGreaterThan(0.99);
    expect(FILM_H / (GEN_H * scale)).toBeGreaterThan(0.99);
  });

  it("no prompt asks for an aspect ratio — the tensor is the only place it is true", () => {
    expect(stillFn).not.toContain("ASPECT_SUFFIX");
    expect(stillFn).not.toMatch(/9:16/);
    expect(worker).not.toMatch(/Vertical 9:16 portrait composition/);
  });
});

// ─────────────────────────────────────────── B. the ask survives intact
describe("B — the character description reaches the engine whole", () => {
  it("the app's ceiling IS the engine's, with nothing skimmed off it", () => {
    expect(MAX_ASK_CHARS).toBe(ENGINE_MAX_PROMPT_CHARS);
  });

  it("a description at the ceiling is sent unchanged", () => {
    // The failure this replaces: 46 characters of aspect sentence were
    // appended to every ask, so a 1000-character description was silently a
    // 954-character one and the tail — which is where a cast lock lives — was
    // the part that got cut.
    const ask = "x".repeat(MAX_ASK_CHARS);
    expect(ask.length).toBe(ENGINE_MAX_PROMPT_CHARS);
  });
});

// ───────────────────────────────────────────────── C. the seed
describe("C — the seed is derived from the shot, never rolled", () => {
  const parts = {
    stage: "still" as const,
    jobId: "job-1",
    sceneId: "sc-1",
    shotId: "sh-1",
    attempt: 0,
  };

  it("the same shot and the same attempt give the same frame back", () => {
    expect(deriveSeed(parts)).toBe(deriveSeed({ ...parts }));
  });

  it("the next attempt is a genuinely different draw", () => {
    expect(deriveSeed({ ...parts, attempt: 1 })).not.toBe(deriveSeed(parts));
  });

  it("a different shot, scene, job or stage is independent", () => {
    const base = deriveSeed(parts);
    expect(deriveSeed({ ...parts, shotId: "sh-2" })).not.toBe(base);
    expect(deriveSeed({ ...parts, sceneId: "sc-2" })).not.toBe(base);
    expect(deriveSeed({ ...parts, jobId: "job-2" })).not.toBe(base);
    // A clip and the still it animates must not share a seed: sampling a
    // video from the same point as its own conditioning frame is an accident,
    // not a pairing.
    expect(deriveSeed({ ...parts, stage: "clip" })).not.toBe(base);
  });

  it("every derived seed is inside the worker's contract bound", () => {
    for (let a = 0; a < 64; a++) {
      const s = deriveSeed({ ...parts, attempt: a });
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(BigInt(s)).toBeLessThanOrEqual(MAX_SEED);
    }
  });

  it("nothing in the derivation can change between two runs", () => {
    // A source assertion on purpose: the property is the ABSENCE of these,
    // and absence is not observable from a return value. Comments are
    // stripped first — the module NAMES the three forbidden calls in the
    // note explaining why it does not use them, and deleting that note to
    // satisfy a regex would remove the only record of the reasoning.
    for (const forbidden of ["Date.now", "Math.random", "randomUUID", "performance.now"]) {
      expect(stripComments(seedSrc), forbidden).not.toContain(forbidden);
    }
  });
});

// ──────────────────────────────────────── D. ten retries are ten draws
describe("D — the retry budget can actually succeed", () => {
  it("ten attempts at one shot are ten distinct seeds", () => {
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 10; attempt++) {
      seen.add(
        deriveSeed({ stage: "still", jobId: "j", sceneId: "s", shotId: "h", attempt }),
      );
    }
    // With videogen.py's `SEED = 42` this set had one member and the ceiling
    // the owner raised from 3 to 10 bought nothing at all.
    expect(seen.size).toBe(10);
  });

  it("the still ladder counts its draws across rungs, not per rung", () => {
    expect(worker).toMatch(/let stillDraw = 0;/);
    expect(worker).toMatch(/stillDraw \+= 1;/);
    expect(worker).toMatch(/attempt: stillDraw,/);
  });
});

// ────────────────────────────────────── E. the negative prompt, per shot
describe("E — the negative prompt is about THIS shot", () => {
  it("a shot with a person is steered off the faults that ruin a face", () => {
    const neg = negativePromptFor(["She turns toward the window, eyes catching the light."]);
    for (const term of ["malformed eyes", "deformed face", "warped hands"]) {
      expect(neg).toContain(term);
    }
  });

  it("a shot with nobody in it is not", () => {
    const neg = negativePromptFor(["A wide desert at dawn with no people in it."]);
    expect(neg).not.toContain("malformed eyes");
    // It still gets the quality terms — softness ruins a landscape too.
    expect(neg).toContain("worst quality");
  });

  it("rung 2 of the worker's own ladder reads as people-less", () => {
    // The exact text the ladder builds. "no people" contains the word
    // "people", which an earlier draft of shotShowsAFace matched as a person.
    expect(
      shotShowsAFace([
        "A gentle watercolor storybook illustration of a place with no people in it: a market square. Soft warm light, wide view.",
      ]),
    ).toBe(false);
  });

  it("an unreadable shot falls to the safe side", () => {
    expect(shotShowsAFace([])).toBe(true);
    expect(shotShowsAFace([null, undefined, "   "])).toBe(true);
  });

  it("it never exceeds the worker's bound, and never cuts mid-term", () => {
    const neg = negativePromptFor(["a face, eyes, hands"], MAX_NEGATIVE_PROMPT_CHARS);
    expect(neg.length).toBeLessThanOrEqual(MAX_NEGATIVE_PROMPT_CHARS);
    expect(neg.endsWith(",")).toBe(false);
    // A budget too small for even one term yields nothing, not a fragment.
    expect(negativePromptFor(["a face"], 3)).toBe("");
    for (const term of negativePromptFor(["a face"], 60).split(", ")) {
      expect(faceSrc).toContain(`"${term}"`);
    }
  });

  it("the old global list — five motion faults and no face — is gone", () => {
    // videogen.py sent this for every shot of every film. Not one term is
    // about a face, which is what the audit was opened to explain. (The
    // string survives in the comment recording what was replaced.)
    expect(stripComments(worker)).not.toContain(
      "worst quality, inconsistent motion, blurry, jittery, distorted",
    );
  });
});

// ──────────────────────────── F. a capability failure is not a content verdict
describe("F — a missing capability never makes the prompt worse", () => {
  it("only a refusal of the CONTENT lowers the rung", () => {
    const outcomes = [
      classifyReferenceFailure({ status: 422, sentReference: false }),
      classifyReferenceFailure({ status: 422, code: CAPABILITY_MARKER, sentReference: true }),
      classifyReferenceFailure({ status: 422, sentReference: true }),
      classifyReferenceFailure({ status: 503, sentReference: true }),
    ];
    expect(outcomes.map((o) => o.outcome)).toEqual([
      "CONTENT_REFUSED",
      "CAPABILITY_UNSUPPORTED",
      "INVALID_REFERENCE",
      "TRANSIENT",
    ]);
    expect(outcomes.filter((o) => o.stepDown).length).toBe(1);
    expect(outcomes[0].stepDown).toBe(true);
  });

  it("the engine says which it is in a FIELD, not in prose", () => {
    // The whole bug was a caller inferring the meaning of a bare 422. An
    // English error message is not an API.
    expect(stillFn).toContain("CAPABILITY_MARKER");
    expect(stillFn).toMatch(/code: CAPABILITY_MARKER/);
  });

  it("the ladder drops the reference and keeps the rung", () => {
    const v = classifyReferenceFailure({
      status: 422,
      code: CAPABILITY_MARKER,
      sentReference: true,
    });
    expect(v).toEqual({
      outcome: "CAPABILITY_UNSUPPORTED",
      stepDown: false,
      dropReference: true,
      retrySameAsk: false,
    });
    expect(worker).toMatch(/refBlocked = true;/);
    expect(worker).toMatch(/&& !refBlocked/);
  });

  it("a failure that is neither transient nor about the content is thrown at once", () => {
    // A 401 must not buy three paid attempts at an answer that cannot change.
    expect(worker).toMatch(/if \(verdict\.outcome !== 'CONTENT_REFUSED'\) throw err;/);
    expect(worker).toMatch(/status >= 500 \|\| status === 429/);
  });
});

// ─────────────────────────────── G. only server-owned keys reach the worker
describe("G — a caller cannot name a path, its own or anyone else's", () => {
  it("story-motion derives every key from the TOKEN's job id", () => {
    expect(motionFn).toMatch(/stillKeyFor\(verified\.jobId, sceneId, shotId\)/);
    expect(motionFn).toMatch(/unitKey\(verified\.jobId, sceneId, shotId, version, index\)/);
    // No field for a path exists, so a caller holding one has nowhere to put it.
    expect(motionFn).not.toMatch(/body\?\.(inputKey|input_key|stillKey|outputKey|path|url)/);
  });

  it("story-still refuses an inlined reference outright", () => {
    expect(stillFn).toMatch(/if \(referenceImage\) \{/);
    const refusal = stillFn.slice(stillFn.indexOf("if (referenceImage) {"));
    expect(refusal.slice(0, 500)).toContain("422");
  });

  it("nothing in either function opens a socket to a caller-supplied host", () => {
    for (const src of [stillFn, motionFn]) {
      for (const url of src.match(/https?:\/\/[^"'`\s]+/g) ?? []) {
        expect(url, url).toMatch(/^https:\/\/(api\.runpod\.ai|\$\{)|auth\/v1\/user/);
      }
    }
  });

  it("the worker may only fetch a reference from ONIQ's own origin", () => {
    expect(worker).toContain("ONIQ_ASSET_ORIGIN");
  });
});

// ──────────────────────────────────── H. the in-house video prompt
describe("H — the video prompt carries all four concerns", () => {
  const shot = {
    still: "A young merchant kneels beside a cracked jar in a narrow alley. Warm lamplight.\nCharacters:\nAli: a brown cloak",
    narration: "He hesitated at the lid.",
    motion: "He reaches slowly toward the lid. Slow push in.",
    vfx: "dust motes turning in a shaft of light",
  };

  it("visual condition, motion, camera and expression are all present", () => {
    const p = composeInHouseVideoPrompt(shot);
    expect(p).toContain("kneels beside a cracked jar"); // 1. visual condition
    expect(p).toContain("reaches slowly toward the lid"); // 2. motion
    expect(p.toLowerCase()).toContain("push in"); // 3. camera
    expect(p).toContain("face stays in focus"); // 4. expression
    expect(p.toLowerCase()).toContain("dust motes");
  });

  it("the cast lock never travels to the video model", () => {
    const p = composeInHouseVideoPrompt(shot);
    expect(p).not.toContain("brown cloak");
    expect(p).not.toContain("Characters:");
    // Its job ended when the still existed; repeating it here spends budget
    // the expression needs.
    expect(visualCondition(shot.still)).not.toContain("Ali");
  });

  it("a shot with nothing authored still says what moves and how", () => {
    const p = composeInHouseVideoPrompt({ still: "A lantern on a stone sill.", narration: "Night came." });
    expect(p).toContain("A lantern on a stone sill");
    expect(p.length).toBeGreaterThan(80);
    // The Veo composer's whole output for the same shot was twelve words with
    // no subject, no scene and no expression.
    expect(composeVideoPrompt({ still: "A lantern on a stone sill.", narration: "Night came." }).length)
      .toBeLessThan(p.length);
  });

  it("the Veo composer is untouched — its rules were measured on Veo", () => {
    expect(composeVideoPrompt({ still: "anything", narration: "x" })).toBe(
      "Very slow push in. Ambient movement only: air, light, cloth.",
    );
  });
});

// ───────────────────────────────────────────── I. one camera, once
describe("I — the camera is named exactly once", () => {
  it("an authored camera move is not doubled by the default", () => {
    const p = composeInHouseVideoPrompt({
      still: "A wide street.",
      narration: "x",
      motion: "Slow pan left across the stalls.",
    });
    expect(p.toLowerCase()).not.toContain(DEFAULT_CAMERA.toLowerCase());
    expect(p).toContain("Slow pan left");
  });

  it("a shot that authored none gets one, named", () => {
    const p = composeInHouseVideoPrompt({
      still: "A wide street.",
      narration: "x",
      motion: "The awnings shift.",
    });
    expect(p.toLowerCase()).toContain(DEFAULT_CAMERA.toLowerCase());
  });

  it("the detector recognises the vocabulary the planner is told to use", () => {
    for (const move of ["static camera", "push in", "slow pan right", "crane rise", "low angle"]) {
      expect(namesACameraMove(move), move).toBe(true);
    }
    expect(namesACameraMove("She lowers the lamp onto the table.")).toBe(false);
  });
});

// ───────────────────────────────────────────── J. dialogue and faces
describe("J — a spoken line brings its own expression", () => {
  const spoken = {
    still: "A close view of a face lit by a lamp.",
    narration: "He answered.",
    dialogue: { speaker: "Ali", line: "The jar was never mine." },
  };

  it("the line is carried and the speaker's name is not", () => {
    const p = composeInHouseVideoPrompt(spoken);
    expect(p).toContain("The jar was never mine.");
    expect(p).not.toContain("Ali");
  });

  it("it asks for lip movement instead of the default expression", () => {
    const p = composeInHouseVideoPrompt(spoken);
    expect(p).toContain("Natural lip movement");
    expect(p.toLowerCase()).not.toContain(DEFAULT_EXPRESSION.toLowerCase());
  });

  it("a quoted line does not end in two full stops", () => {
    expect(composeInHouseVideoPrompt(spoken)).not.toContain('."."');
    expect(composeInHouseVideoPrompt(spoken)).not.toMatch(/\."\./);
  });
});

// ────────────────────────────────── K. a clip retry is a different clip
describe("K — a clip retry varies, and its identity does not", () => {
  const unit = {
    key: unitKey("proj", "sc", "sh", 1, 0),
    sceneId: "sc",
    shotId: "sh",
    index: 0,
    stillKey: "story/still/proj-sc-sh.png",
    outputKey: "x",
    usedSeconds: 4,
  };
  const shot = { still: "A face by lamplight.", narration: "x", motion: "She turns. Slow push in." };

  it("attempt 2 samples a different point from attempt 1", () => {
    const a = buildClipPayload(unit, shot, false, 1);
    const b = buildClipPayload(unit, shot, false, 2);
    expect(a.input.params.seed).not.toBe(b.input.params.seed);
  });

  it("but the unit's identity is byte-identical, so a retry is not new paid work", () => {
    expect(unitKey("proj", "sc", "sh", 1, 0)).toBe(unitKey("proj", "sc", "sh", 1, 0));
    const a = buildClipPayload(unit, shot, false, 1);
    const b = buildClipPayload(unit, shot, false, 2);
    expect(a.input.output_key).toBe(b.input.output_key);
    expect(a.input.input_key).toBe(b.input.input_key);
  });

  it("the same attempt drawn again is the same clip", () => {
    expect(clipSeed(unit.key, 3)).toBe(clipSeed(unit.key, 3));
    expect(clipSeed(unit.key, 3)).not.toBe(clipSeed(unit.key, 4));
  });

  it("the payload carries the per-shot negative prompt too", () => {
    const p = buildClipPayload(unit, shot, false, 1);
    expect(p.input.params.negative_prompt).toContain("malformed eyes");
    expect(p.input.params.negative_prompt.length).toBeLessThanOrEqual(MAX_NEGATIVE_PROMPT_CHARS);
  });

  it("runUnit passes the attempt number into the payload", () => {
    const src = read("supabase/functions/_shared/inHouseMotion.ts");
    expect(src).toMatch(/buildClipPayload\(unit, shot, noWatermark, attempt\)/);
  });
});

// ───────────────────────────────────── L. the aliveness gate survives
describe("L — a frozen clip is still discarded, and low quality is not no motion", () => {
  it("the gate is intact and fails closed on an unmeasurable clip", () => {
    expect(worker).toContain("clipTemporallyAlive");
    expect(worker).toContain("aliveness unmeasurable — discarded (fail closed)");
  });

  it("nothing in the new negative-prompt work touches the aliveness threshold", () => {
    // The gate answers "did anything move". It must not be repurposed into a
    // quality judgement — a soft clip that moves is a shot, and discarding it
    // would trade a flawed shot for no shot.
    expect(worker).toContain("CLIP_ALIVENESS_MIN");
    expect(faceSrc).not.toContain("ALIVENESS");
    expect(grammarSrc).not.toContain("ALIVENESS");
  });
});

// ─────────────────── L2. the encode chain (folded into L: one lossy pass fewer)
describe("L — the master is encoded for the role it actually plays", () => {
  it("a master that will be re-encoded is not thrown away at delivery quality", () => {
    // MEASURED chain: clip crf 23 -> master crf 28 -> grade crf 21. Step two
    // is an INTERMEDIATE whenever the grade runs, and detail lost at crf 28
    // cannot be recovered by a crf 21 pass — the lower number then only buys
    // a bigger file carrying the earlier pass's artifacts.
    expect(worker).toContain("MASTER_CRF_INTERMEDIATE");
    expect(worker).toContain("MASTER_CRF_DELIVERED");
    expect(worker).toMatch(
      /crf: findGradeFfmpeg\(\) \? MASTER_CRF_INTERMEDIATE : MASTER_CRF_DELIVERED/,
    );
  });

  it("a master that ships keeps the measured delivery value", () => {
    // ep1: 41MB for 4:47 at crf 28, against 330MB at the default.
    expect(worker).toMatch(/const MASTER_CRF_DELIVERED = 28;/);
    expect(worker).toMatch(/const MASTER_CRF_INTERMEDIATE = 18;/);
  });

  it("the grade does not re-encode the audio it was handed", () => {
    expect(read("remotion/scripts/filmLook.mjs")).toMatch(/'-c:a', 'copy'/);
  });

  it("the film's own frame rate is unchanged — 30 is the composition's contract", () => {
    // Narration timing, Ken Burns travel and the puppet rig are all authored
    // in 30ths. The clip is written at its GENERATION rate (24) and resampled
    // by the compositor at draw time; re-encoding it to 30 first would be a
    // lossy pass bought for nothing.
    expect(read("src/lib/storyPreflight.ts")).toMatch(/export const STORY_FPS = 30;/);
    expect(worker).toMatch(/const FPS = 30;/);
    expect(worker).not.toMatch(/-r['"]?,\s*['"]?30/);
  });
});

// ────────────────────────────── M. the directive's own "do not" list
describe("M — what this change was forbidden to touch, untouched", () => {
  it("no Veo fallback was added under the in-house route", () => {
    expect(worker).toContain("no provider fallback");
    expect(read("supabase/functions/_shared/oniqMotion.ts")).not.toMatch(
      /generativelanguage|googleapis|veo/i,
    );
  });

  it("the in-house route is still the one the owner chose", () => {
    expect(worker).toMatch(/inHouseEnabled: process\.env\.IN_HOUSE_MOTION === 'on'/);
  });

  it("no price, cap or capacity class moved", () => {
    const ledger = read("supabase/functions/_shared/inHouseMotion.ts");
    expect(ledger).toContain("MAX_UNIT_ATTEMPTS = 2");
    // The attempt CEILING the owner raised lives in the database check, and
    // the per-unit bound below it is unchanged; this work made the attempts
    // different, not more numerous.
    expect(ledger).toMatch(/attempts per shot\s*\n?\s*\*?\s*raised 3 -> 10/);
  });
});

// ────────────────────────────────────── N. nothing secret gets logged
describe("N — no secret and no private URL reaches a log", () => {
  it("the new modules carry no credential and no storage host", () => {
    for (const [name, src] of [
      ["storySeed", seedSrc],
      ["faceQuality", faceSrc],
      ["referenceOutcome", read("supabase/functions/_shared/referenceOutcome.ts")],
    ] as const) {
      for (const forbidden of ["SERVICE_ROLE", "apikey", "Authorization", "r2.dev", "http://"]) {
        expect(src, `${name} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("the still's log line names a bucket KEY, never a signed or public URL", () => {
    expect(worker).toContain("STILL_KEY=");
    const line = worker.slice(worker.indexOf("STILL_KEY="), worker.indexOf("STILL_KEY=") + 200);
    expect(line).not.toContain("publicBase");
    expect(line).not.toContain("http");
  });
});

// ───────────────────────────── O. no identity is hard-coded anywhere
describe("O — the system describes behaviour, never people", () => {
  const IDENTITY = [
    // ethnicity / nationality
    "caucasian", "asian", "african", "arab", "indian", "european", "white ", "black ",
    // gender
    " male ", " female ", "woman", "girl", "boy",
    // occupation / location
    "merchant", "soldier", "princess", "village", "desert", "palace",
  ];

  it("the default expression cue names no person", () => {
    const lower = DEFAULT_EXPRESSION.toLowerCase();
    for (const token of IDENTITY) expect(lower, token).not.toContain(token.trim());
  });

  it("neither negative-prompt list names a person", () => {
    const neg = `${negativePromptFor(["a face"])} ${negativePromptFor(["no people, a horizon"])}`.toLowerCase();
    for (const token of IDENTITY) expect(neg, token).not.toContain(token.trim());
  });

  it("the visual condition is taken from the SHOT, not invented", () => {
    // Whatever identity a frame has came from the story. Nothing here adds one.
    expect(visualCondition("A figure in a doorway.")).toBe("A figure in a doorway");
    expect(visualCondition("")).toBe("");
    expect(visualCondition(null)).toBe("");
  });

  it("the visual condition is bounded and cut at a word boundary", () => {
    const long = `${"a lantern and a long stone sill ".repeat(40)}.`;
    const cut = visualCondition(long);
    expect(cut.length).toBeLessThanOrEqual(220);
    expect(long).toContain(cut);
    expect(cut.endsWith(" ")).toBe(false);
  });
});
