/**
 * PER-JOB CLIP-STAGE MODE — the owner-authorized Veo `select` validation
 * plumbing (2026-08-22), pinned in source like the actor_refs graduation
 * (edge functions run on Deno, outside tsconfig).
 *
 * The chain is: story_jobs.motion_mode (service-role-writable only) →
 * story-dispatch client_payload.story_movie → workflow STORY_MOVIE →
 * the worker's already-landed motion-runtime contract. Three contracts
 * that must never silently change:
 *
 *   1. Only the literal 'select' travels. NULL (every production job) and
 *      any unexpected value send nothing, so STORY_MOVIE resolves to '' and
 *      the clip stage stays off — production is byte-for-byte unchanged.
 *   2. The workflow has NO manual input for STORY_MOVIE: the every-shot
 *      'on' experiment stays unreachable from any dispatch form or payload.
 *   3. The worker keeps its landed gating: 'on' and 'select' are the only
 *      enabling values, and 'select' routes through the motion plan.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dispatch = readFileSync(
  join(process.cwd(), "supabase/functions/story-dispatch/index.ts"),
  "utf8",
);
const workflow = readFileSync(join(process.cwd(), ".github/workflows/story-worker.yml"), "utf8");
const worker = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260822153000_story_jobs_motion_mode.sql"),
  "utf8",
);

describe("per-job motion mode (Veo select validation plumbing)", () => {
  it("story-dispatch reads motion_mode alongside the graduation fields", () => {
    expect(dispatch).toMatch(/select=id,requested_seconds,actor_refs,grade,motion_mode/);
  });

  it("only 'select' and 'in_house' travel; anything else sends nothing", () => {
    // 'in_house' rides as 'select' because the clip stage is a SEPARATE gate
    // from the engine choice — measured twice now, see the block below.
    expect(dispatch).toMatch(
      /rows\[0\]\.motion_mode === "select" \|\| rows\[0\]\.motion_mode === "in_house"\s*\?\s*"select"\s*:\s*null;/,
    );
    expect(dispatch).toMatch(/\.\.\.\(motionMode \? \{ story_movie: motionMode \} : \{\}\)/);
  });


  it("actor_refs graduation is untouched by the new field", () => {
    expect(dispatch).toMatch(
      /const actorRefs = rows\[0\]\.actor_refs === true \|\| rows\[0\]\.grade === "movie";/,
    );
  });

  it("the workflow takes STORY_MOVIE from the payload only — no manual input", () => {
    expect(workflow).toMatch(
      /STORY_MOVIE: \$\{\{ github\.event\.client_payload\.story_movie \|\| '' \}\}/,
    );
    // No workflow_dispatch input may feed it: 'on' stays unreachable from
    // any form, and an absent payload resolves to off.
    expect(workflow).not.toMatch(/STORY_MOVIE: [^\n]*inputs\./);
    expect(workflow).not.toMatch(/story_movie:\s*\n\s*description/);
  });

  it("the worker keeps its landed gating — 'on'/'select' only, plan-routed", () => {
    expect(worker).toMatch(
      /process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'/,
    );
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
  });

  it("the column admits NULL or 'select' and nothing else", () => {
    expect(migration).toMatch(/add column if not exists motion_mode text/);
    expect(migration).toMatch(/check \(motion_mode is null or motion_mode = 'select'\)/);
  });
});

/**
 * TWO GATES, NOT ONE — measured on the live run of 2026-08-28.
 *
 * Story job e377f793 rendered on the merged wiring with IN_HOUSE_MOTION=on.
 * The route resolved ("movie grade: in-house engine") and the film still came
 * back nine shots of stills:
 *
 *   STORY_MOVIE:
 *   IN_HOUSE_MOTION: on
 *   MOTION_CONTRACT: 9x no motion provider enabled (owner-gated)
 *
 * IN_HOUSE_MOTION chooses WHICH engine animates. STORY_MOVIE decides WHETHER
 * the clip stage runs at all. Turning the first on says nothing about the
 * second, and the reasonable-sounding assumption that it does is what made a
 * correctly-routed film arrive with no motion in it. These assert the two are
 * independent, so nobody has to learn it from an output again.
 */
describe("the clip stage has its own gate, independent of the engine choice", () => {
  it("IN_HOUSE_MOTION does not appear anywhere in the clip-stage condition", () => {
    const condition = worker.slice(
      worker.indexOf("const clipStage ="),
      worker.indexOf("const cinematic ="),
    );
    expect(condition).toContain("process.env.STORY_MOVIE");
    // The engine switch must not leak into the whether-to-clip decision.
    expect(condition).not.toContain("IN_HOUSE_MOTION");
  });

  it("the engine route is decided without consulting STORY_MOVIE", () => {
    const route = worker.slice(
      worker.indexOf("function motionRoute()"),
      worker.indexOf("async function generateClip("),
    );
    expect(route).toContain("IN_HOUSE_MOTION");
    expect(route).not.toContain("STORY_MOVIE");
  });

  it("an unset motion_mode sends no story_movie, so STORY_MOVIE resolves to ''", () => {
    // The production default. NULL is neither 'select' nor 'in_house', the
    // spread contributes nothing, and the workflow's `|| ''` leaves the clip
    // stage off.
    expect(dispatch).toMatch(
      /rows\[0\]\.motion_mode === "select" \|\| rows\[0\]\.motion_mode === "in_house"\s*\?\s*"select"\s*:\s*null;/,
    );
    expect(dispatch).toMatch(/\.\.\.\(motionMode \? \{ story_movie: motionMode \} : \{\}\)/);
    expect(workflow).toMatch(/client_payload\.story_movie \|\| ''/);
  });

  it("'in_house' turns the clip stage on as well as choosing the engine", () => {
    // Run 34686743759 dispatched in_house_motion:true with no story_movie and
    // printed "MOTION_STAGE=off ... (STORY_MOVIE unset)" — nine stills. Both
    // halves must travel or the test film has no motion to measure.
    expect(dispatch).toMatch(/motion_mode === "in_house"\s*\?\s*\{ in_house_motion: true \}/);
    expect(dispatch).toMatch(
      /rows\[0\]\.motion_mode === "select" \|\| rows\[0\]\.motion_mode === "in_house"/,
    );
  });


    // clipStage !== 'off' is the gate; the motion plan built from it is what
    // decides per shot, and `attemptClip` is the only door to generateClip.
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
    const call = worker.slice(worker.indexOf("if (motionPlan?.attemptClip)"));
    expect(call.slice(0, 600)).toMatch(/await generateClip\(/);
  });

  it("the clip stage cannot be reached with the grade alone", () => {
    // grade === 'movie' is necessary and NOT sufficient: job e377f793 was
    // movie grade and still rendered still-only.
    expect(worker).toMatch(
      /job\.grade === 'movie' && \(process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'\)/,
    );
  });
});
