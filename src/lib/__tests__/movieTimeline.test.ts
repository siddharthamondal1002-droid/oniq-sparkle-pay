/**
 * A STORY MOVIE IS AS LONG AS IT WAS ASKED TO BE.
 *
 * Owner directive 2026-08-29. A 300-second request carrying 85.8 seconds of
 * narration was refused as "28.6% of the requested duration". The number was
 * real and the conclusion was wrong: the film's length WAS its narration —
 * storyFrames multiplied the measured wav by fps — so the gate was reporting
 * a property of narration-as-clock as though the story were at fault.
 *
 * planStory had been building a timeline that sums to the request exactly,
 * and asserting it. The worker used its shot count and discarded its
 * seconds. These tests pin the timeline going back in, the guarantees that
 * must survive it, and the one policy that deliberately did not change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  TIMELINE_MAX_RATIO,
  clampRequested,
  planMovieTimeline,
  shotsOverClipCeiling,
} from "../movieTimeline";
import { DURATION_MAX_RATIO, DURATION_MIN_RATIO, validateTimeline } from "../storyPreflight";
import { MAX_STORY_SECONDS, planStory } from "../storyPlan";

const worker = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");
const claim = readFileSync(
  join(process.cwd(), "supabase/migrations/20260828190000_story_movie_motion_intent.sql"),
  "utf8",
);

/** The shot count planStory gives a request, so slots line up one-to-one. */
const shotsFor = (seconds: number) => planStory(seconds).shots.length;

/** Narration spread evenly over the film's shots, as a measured-wav stand-in. */
const evenNarration = (total: number, shots: number) => Array(shots).fill(total / shots);

// ---------------------------------------------------------------- the cases
describe("the owner's cases", () => {
  it("CASE 1 — 300s requested, 85.8s narration → accepted, and the film is 300s", () => {
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(85.8, shotsFor(300)),
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.timelineSeconds).toBeCloseTo(300, 5);
    expect(t.narrationSeconds).toBeCloseTo(85.8, 5);
    expect(t.holdSeconds).toBeCloseTo(214.2, 5);
    // The exact run that was refused at 28.6%.
    expect(t.narrationSeconds / t.requestedSeconds).toBeLessThan(DURATION_MIN_RATIO);
  });

  it("CASE 2 — 300s requested, 135.5s narration → accepted at 300s", () => {
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(135.5, shotsFor(300)),
    });
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.timelineSeconds).toBeCloseTo(300, 5);
  });

  it("CASE 3 — 300s requested, 300s narration → accepted, narration fills it", () => {
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(300, shotsFor(300)),
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    // Some shots' narration overruns their slot, so the film runs a little
    // long — speech is never cut to fit a plan.
    expect(t.timelineSeconds).toBeGreaterThanOrEqual(300);
    expect(t.holdSeconds).toBeGreaterThanOrEqual(0);
  });

  it("CASE 4 — 300s requested, 350s narration → the film is 350s, not a truncation", () => {
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(350, shotsFor(300)),
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.timelineSeconds).toBeCloseTo(350, 5);
    expect(t.holdSeconds).toBeCloseTo(0, 5);
    // Every shot is exactly its narration — nothing was clipped.
    for (const s of t.shots) expect(s.screenSeconds).toBeGreaterThanOrEqual(s.narrationSeconds);
  });

  it("CASE 5 — 300s requested, almost no narration → the visual pass carries it", () => {
    const shots = shotsFor(300);
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: Array(shots).fill(0.4),
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.timelineSeconds).toBeCloseTo(300, 5);
    expect(t.holdSeconds).toBeGreaterThan(280);
    // Every shot holds — none is a flash, none is the whole film.
    for (const s of t.shots) {
      expect(s.screenSeconds).toBeGreaterThan(s.narrationSeconds);
      expect(s.screenSeconds).toBeLessThanOrEqual(10);
    }
  });

  it("CASE 6 — an ordinary Story keeps narration-as-clock and its own band", () => {
    // The worker branches on `cinematic` (grade === 'movie'). Classic still
    // measures narration against the 50-160% band; only the movie branch
    // plans a timeline.
    expect(worker).toMatch(/if \(cinematic\) \{[\s\S]{0,400}planMovieTimeline\(/);
    expect(worker).toMatch(
      /\} else \{[\s\S]{0,300}const voicedRatio = voicedTimeline \/ voicedExpected;/,
    );
    expect(worker).toMatch(
      /voicedRatio < DURATION_MIN_RATIO \|\| voicedRatio > DURATION_MAX_RATIO/,
    );
    expect(DURATION_MIN_RATIO).toBe(0.5);
    expect(DURATION_MAX_RATIO).toBe(1.6);
  });

  it("CASE 7 — a timeline past the limits is refused BEFORE any still is drawn", () => {
    // Narration so far over the request that the plan and the words are
    // different films.
    const over = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(300 * TIMELINE_MAX_RATIO + 60, shotsFor(300)),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("narration-overruns-timeline");

    // And past the Story cost ceiling.
    const huge = planMovieTimeline({
      requestedSeconds: MAX_STORY_SECONDS,
      narrationSeconds: evenNarration(MAX_STORY_SECONDS + 200, shotsFor(MAX_STORY_SECONDS)),
    });
    expect(huge.ok).toBe(false);

    // The worker throws this before the still loop — the voices pass is the
    // only thing paid for.
    expect(worker).toMatch(/PREFLIGHT_TIMELINE_INFEASIBLE/);
    expect(worker).toMatch(/caught after voices, before any still was drawn/);
  });
});

// ------------------------------------------------------------ the invariants
describe("what the timeline may never do", () => {
  it("never shortens a shot below its own narration — speech is not cut", () => {
    const narration = [12, 0.5, 3, 9, 1, 40, 2];
    const t = planMovieTimeline({ requestedSeconds: 120, narrationSeconds: narration });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    t.shots.forEach((s, i) => {
      expect(s.screenSeconds).toBeGreaterThanOrEqual(narration[i]);
      expect(s.narrationSeconds).toBe(narration[i]);
      expect(s.holdSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  it("never stretches, repeats or speeds up speech — narration is returned untouched", () => {
    const narration = evenNarration(85.8, shotsFor(300));
    const t = planMovieTimeline({ requestedSeconds: 300, narrationSeconds: narration });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.shots.map((s) => s.narrationSeconds)).toEqual(narration);
    expect(t.narrationSeconds).toBeCloseTo(85.8, 5);
  });

  it("is total — a bad input is a value, never a throw", () => {
    for (const bad of [[], [NaN], [-1], [1, Number.POSITIVE_INFINITY]]) {
      const t = planMovieTimeline({ requestedSeconds: 300, narrationSeconds: bad });
      expect(t.ok).toBe(false);
      if (!t.ok) expect(t.reason).toBe("narration-invalid");
    }
  });

  it("respects the same clamp the rest of the pipeline uses", () => {
    expect(clampRequested(10)).toBe(60);
    expect(clampRequested(9999)).toBe(MAX_STORY_SECONDS);
    expect(clampRequested(300)).toBe(300);
  });

  it("a row-supplied shot count still gets a timeline that sums to the request", () => {
    // 17 shots for a 300s request is not what planStory would choose; the
    // slots are re-derived so the film is still 300s.
    const t = planMovieTimeline({ requestedSeconds: 300, narrationSeconds: Array(17).fill(2) });
    expect(t.ok).toBe(true);
    if (t.ok) expect(t.timelineSeconds).toBeCloseTo(300, 5);
  });

  it("reports shots past the clip ceiling rather than refusing them", () => {
    // One long sentence in a 120s film's natural shot count: that shot runs
    // to its narration and overruns the 10s clip ceiling; the rest sit in
    // their planned slots. Reported, not refused — the push carries the tail.
    const shots = shotsFor(120);
    const narration = Array(shots).fill(1);
    narration[0] = 15;
    const t = planMovieTimeline({ requestedSeconds: 120, narrationSeconds: narration });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(shotsOverClipCeiling(t)).toBe(1);
    expect(t.shots[0].screenSeconds).toBe(15);
  });

  it("a small shot count spreads the request wide, and says so", () => {
    // A row-supplied shot_count far below the natural one gives long shots.
    // That is the request being honoured, not a fault — but every one of
    // them is past the clip ceiling and the count is reported.
    const t = planMovieTimeline({ requestedSeconds: 60, narrationSeconds: [5, 5, 5] });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.timelineSeconds).toBe(60);
    expect(shotsOverClipCeiling(t)).toBe(3);
  });
});

// ------------------------------------------------- the gate that already worked
describe("the post-render gate now passes for the right reason", () => {
  it("a 300s movie timeline sits at 100% of the request", () => {
    const t = planMovieTimeline({
      requestedSeconds: 300,
      narrationSeconds: evenNarration(85.8, shotsFor(300)),
    });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const verdict = validateTimeline({
      requestedSeconds: 300,
      shots: t.shots.map((s, index) => ({ index, seconds: s.screenSeconds, assets: [] })),
    } as never);
    expect("code" in verdict).toBe(false);
    if (!("code" in verdict)) expect(verdict.ratio).toBeCloseTo(1, 2);
  });

  it("validateTimeline was never the thing that needed changing", () => {
    // It has always measured the FILM against the request. It failed only
    // because the film was the narration.
    expect(validateTimeline.toString()).toContain("job.shots.reduce");
    expect(validateTimeline.toString()).toContain("requestedSeconds");
  });
});

// ------------------------------------------------------- the chain, unchanged
describe("the motion route and the controls it must not cost", () => {
  it("CASE 8 — a movie claim still stamps STORY_MOVIE=select, no manual edit", () => {
    expect(claim).toMatch(/insert into story_jobs \([^)]*motion_mode\)/s);
    expect(claim).toMatch(
      /motion := case when coalesce\(cfg\.motion_select, false\) and grade_clean = 'movie'\s*\n?\s*then 'select' else null end;/,
    );
  });

  it("CASE 9, 10 — 'select' still opens the clip stage and in-house still routes to LTX", () => {
    expect(worker).toMatch(
      /job\.grade === 'movie' && \(process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'\)/,
    );
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
    expect(worker).toMatch(/await generateClip\(/);
    expect(worker).toMatch(/inHouseEnabled: process\.env\.IN_HOUSE_MOTION === 'on'/);
    expect(worker).toMatch(/MOTION_PROVIDER=\$\{inHouse \? 'in_house' : 'external'\}/);
  });

  it("the clip is asked to cover the SHOT, so a longer shot is not a longer freeze", () => {
    // Matched across newlines: the call grew a sixth argument (the still's
    // bucket key, so in-house motion cannot be sent after a gateway still)
    // and prettier broke it over several lines. The property under test is
    // unchanged — the SHOT's length is what the clip is asked to cover.
    expect(worker).toMatch(/await generateClip\(\s*shot,\s*stillFile,\s*shotSeconds,/s);
    // and the ambient bed spans the shot too, not just the words
    expect(worker).toMatch(/'-t', String\(shotSeconds\)/);
  });

  it("CASE 11, 12 — WAN and Google stay out of the timeline path", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/movieTimeline.ts"), "utf8");
    for (const forbidden of [/\bwan\b/i, /\bveo\b/i, /google/i, /gemini/i, /runway/i]) {
      expect(src).not.toMatch(forbidden);
    }
  });

  it("CASE 13, 14 — the client still chooses no infrastructure and no motion_mode", () => {
    expect(claim).toMatch(
      /claim_story_seconds\(_requested_seconds integer, _prompt text, _grade text DEFAULT 'movie'::text, _verbatim boolean DEFAULT false\)/,
    );
    for (const forbidden of [
      "gpu",
      "runpod",
      "endpoint",
      "provider",
      "budget",
      "model",
      "runtime",
    ]) {
      expect(claim.toLowerCase()).not.toContain(`_${forbidden}`);
    }
    // The timeline planner takes a duration and measured seconds. Nothing else.
    const src = readFileSync(join(process.cwd(), "src/lib/movieTimeline.ts"), "utf8");
    expect(src).toMatch(
      /requestedSeconds: number;\s*\n\s*\/\*\*[\s\S]{0,120}\*\/\s*\n\s*narrationSeconds: number\[\];/,
    );
  });
});
