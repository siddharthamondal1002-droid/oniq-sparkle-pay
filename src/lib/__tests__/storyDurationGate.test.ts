// The story duration gates, pinned end to end after the 2026-08-26 economic
// failure: job 76d09a89 asked for 300s of verbatim narration from 381 words,
// cleared every PREDICTIVE gate (client, claim SQL, worker) by 2.4 estimated
// seconds, and then measured 142.6s — 47.5% — at the authoritative
// post-PREPARE check, with 43 stills and 43 voice clips already paid for.
//
// The fix is not a new band and not a better guess. Speech rate measured
// across four real films runs 1.86–2.67 words/second (English prose to
// romanized Hindi), so no word-count estimate can hold a 50% boundary. The
// worker now speaks and MEASURES every voice before the first still
// (voices-first, owner directive 2026-08-26) and re-checks the same
// authoritative band on the measurement — TTS-only cost for a doomed film.
// Behavior tests run the pure gates; source tests pin the ORDER the money
// depends on, the way storyReaper and callMediaWiring pin their wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MAX_NARRATION_CHARS,
  SPOKEN_WORDS_PER_SECOND,
  VERBATIM_MAX_FILL,
  VERBATIM_MIN_FILL,
  estimateSpokenSeconds,
  verbatimFits,
} from "@/lib/verbatimNarration";
import {
  DURATION_MAX_RATIO,
  DURATION_MIN_RATIO,
  STORY_FPS,
  STORY_HEIGHT,
  STORY_WIDTH,
  validateTimeline,
  type JobManifest,
} from "@/lib/storyPreflight";

const ROOT = process.cwd();
const WORKER = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const CLAIM_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260826110000_claim_duration_typed_refusal.sql"),
  "utf8",
);
const REFUND_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260810115624_9ba7e01b-3f20-4d70-974a-029d5f5f1db8.sql"),
  "utf8",
);

/** N whitespace-separated words, ~5 chars each — shaped like real prose. */
function wordsOf(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i % 10}`).join(" ");
}

/** A minimal manifest whose shots sum to `timelineSeconds`. */
function manifestOf(timelineSeconds: number, requestedSeconds: number): JobManifest {
  return {
    id: "test-job",
    requestedSeconds,
    verbatim: true,
    fps: STORY_FPS,
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    shots: [
      { seconds: timelineSeconds / 2 } as JobManifest["shots"][number],
      { seconds: timelineSeconds / 2 } as JobManifest["shots"][number],
    ],
  };
}

// ------------------------------------------------- the measured failure, replayed
describe("the 300s/381-word failure (job 76d09a89), replayed", () => {
  it("the ESTIMATE honestly passes — which is exactly why prediction cannot be the fix", () => {
    const text = wordsOf(381);
    expect(estimateSpokenSeconds(text)).toBeCloseTo(152.4, 1);
    const fit = verbatimFits(text, 300);
    // 152.4 / 300 = 0.508 — above the 0.5 floor by less than any estimator's
    // real error (this exact text measured 2.672 wps against the assumed 2.5).
    expect(fit.fits).toBe(true);
  });

  it("the MEASURED timeline still fails the authoritative gate, unchanged", () => {
    const verdict = validateTimeline(manifestOf(142.6, 300));
    expect(verdict).toMatchObject({ code: "PREFLIGHT_DURATION_MISMATCH" });
  });

  it("the worker now measures ALL voices and runs this band BEFORE any still", () => {
    const voicesFirst = WORKER.indexOf("VOICES FIRST");
    const measuredGate = WORKER.indexOf("caught after voices, before any still was drawn");
    const stillLadder = WORKER.indexOf("A REFUSED FRAME STEPS DOWN");
    expect(voicesFirst).toBeGreaterThan(-1);
    expect(measuredGate).toBeGreaterThan(voicesFirst);
    expect(stillLadder).toBeGreaterThan(measuredGate);
  });
});

// --------------------------------------------------------- boundary semantics
describe("band boundaries (both gates, exact semantics)", () => {
  it("estimate at exactly the 50% floor is accepted", () => {
    // words = seconds * rate * fill — exactly on the floor.
    const words = Math.round(300 * SPOKEN_WORDS_PER_SECOND * VERBATIM_MIN_FILL);
    expect(verbatimFits(wordsOf(words), 300).fits).toBe(true);
  });

  it("estimate below the floor is refused", () => {
    expect(verbatimFits(wordsOf(300), 300).fits).toBe(false); // 120s of speech
  });

  it("estimate at the verbatim ceiling is accepted, above it refused", () => {
    const atCeiling = Math.floor(300 * SPOKEN_WORDS_PER_SECOND * VERBATIM_MAX_FILL);
    expect(verbatimFits(wordsOf(atCeiling), 300).fits).toBe(true);
    expect(verbatimFits(wordsOf(atCeiling + 40), 300).fits).toBe(false);
  });

  it("measured timeline at exactly 50% and 160% passes; outside fails", () => {
    expect(validateTimeline(manifestOf(150, 300))).not.toHaveProperty("code");
    expect(validateTimeline(manifestOf(480, 300))).not.toHaveProperty("code");
    expect(validateTimeline(manifestOf(149, 300))).toMatchObject({
      code: "PREFLIGHT_DURATION_MISMATCH",
    });
    expect(validateTimeline(manifestOf(481, 300))).toMatchObject({
      code: "PREFLIGHT_DURATION_MISMATCH",
    });
  });

  it("the authoritative ratios themselves are unchanged", () => {
    expect(DURATION_MIN_RATIO).toBe(0.5);
    expect(DURATION_MAX_RATIO).toBe(1.6);
    expect(VERBATIM_MIN_FILL).toBe(0.5);
    expect(VERBATIM_MAX_FILL).toBe(1.25);
    expect(SPOKEN_WORDS_PER_SECOND).toBe(2.5);
  });
});

// ------------------------------------------------------------- input shapes
describe("input shapes", () => {
  it("empty narration is refused, not estimated into a film", () => {
    expect(estimateSpokenSeconds("")).toBe(0);
    expect(verbatimFits("", 60).fits).toBe(false);
    expect(verbatimFits("   \n  ", 60).fits).toBe(false);
  });

  it("multilingual text counts words alike — the band absorbs the rate spread mid-band", () => {
    const hindi = "Raat ke kareeb gyarah baje Aarav apne kamre mein akela tha";
    const english = "At exactly eleven that night Aarav was alone in his room";
    expect(estimateSpokenSeconds(hindi)).toBeCloseTo(11 / 2.5, 5);
    expect(estimateSpokenSeconds(english)).toBeCloseTo(11 / 2.5, 5);
  });

  it("punctuation and whitespace runs do not change the count", () => {
    expect(estimateSpokenSeconds("wow!!!   ok...")).toBeCloseTo(2 / 2.5, 5);
    expect(estimateSpokenSeconds("a b")).toBeCloseTo(2 / 2.5, 5); // NBSP is whitespace
    expect(estimateSpokenSeconds("one\n\ntwo\tthree")).toBeCloseTo(3 / 2.5, 5);
  });

  it("repeated evaluation is pure — same words, same verdict, no state", () => {
    const text = wordsOf(400);
    const a = verbatimFits(text, 300);
    const b = verbatimFits(text, 300);
    expect(a).toEqual(b);
  });
});

// -------------------------------------------------- the money's order, proven
describe("economic order (spend protection)", () => {
  it("claim SQL: the duration gate runs before the job insert — refused stories charge nothing", () => {
    const gate = CLAIM_SQL.indexOf("story-duration-estimate-out-of-band");
    const insert = CLAIM_SQL.indexOf("insert into story_jobs");
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(gate);
    // The refusal is typed and self-describing.
    for (const field of [
      "estimatedSeconds",
      "requestedSeconds",
      "wordCount",
      "lowerBound",
      "upperBound",
    ]) {
      expect(CLAIM_SQL).toContain(`'${field}'`);
    }
  });

  it("claim SQL literals mirror the TS constants (rate and band cannot drift silently)", () => {
    expect(CLAIM_SQL).toContain("/ 2.5");
    expect(CLAIM_SQL).toContain("* 0.5");
    expect(CLAIM_SQL).toContain("* 1.25");
    expect(CLAIM_SQL).toContain("translate(prompt_clean, chr(160)");
  });

  it("worker: narration TTS is synthesized exactly once, in the voices pass", () => {
    // One narration synth call site; the visual loop only consumes the result.
    expect(WORKER.match(/voiceWithRetry\(\{ text: shot\.narration/g)).toHaveLength(1);
    expect(WORKER).toContain("= voicedShots[i];");
  });

  it("worker: the voices pass contains no still, clip or depth work at all", () => {
    const passA = WORKER.slice(
      WORKER.indexOf("VOICES FIRST"),
      WORKER.indexOf("caught after voices, before any still was drawn"),
    );
    expect(passA.length).toBeGreaterThan(0);
    for (const marker of ["generateClip(", "story-still", "stillFile", "inferDepth", ".png"]) {
      expect(passA, marker).not.toContain(marker);
    }
  });

  it("the post-PREPARE authoritative preflight still runs, unweakened", () => {
    expect(WORKER).toContain("storyPreflight.ts");
    expect(WORKER.indexOf("STAGE"), "worker stages intact").toBeGreaterThan(-1);
  });
});

// ------------------------------------------------------------------- refunds
describe("refund safety", () => {
  it("refund_story_seconds is idempotent under a row lock", () => {
    const fn = REFUND_SQL.slice(REFUND_SQL.indexOf("refund_story_seconds"));
    expect(fn).toContain("for update");
    expect(fn).toContain("if job.refunded_at is not null then");
    // Repeats return refunded 0 rather than paying twice.
    expect(fn).toContain("'refunded', 0");
  });

  it("a story refused at the claim never creates a job, so there is nothing to refund", () => {
    // Structural: both verbatim refusals return before the insert.
    const firstReturnOk = CLAIM_SQL.indexOf("'ok', true, 'jobId'");
    const lastRefusal = CLAIM_SQL.lastIndexOf("story-duration-estimate-out-of-band");
    expect(lastRefusal).toBeGreaterThan(-1);
    expect(firstReturnOk).toBeGreaterThan(lastRefusal);
  });
});

// --------------------------------------------------------- narration ceiling
describe("TTS ceiling", () => {
  it("the per-call narration ceiling is unchanged", () => {
    expect(MAX_NARRATION_CHARS).toBe(1200);
  });
});
