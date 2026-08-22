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
const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/story-worker.yml"),
  "utf8",
);
const worker = readFileSync(
  join(process.cwd(), "remotion/scripts/story-worker.mjs"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260822153000_story_jobs_motion_mode.sql"),
  "utf8",
);

describe("per-job motion mode (Veo select validation plumbing)", () => {
  it("story-dispatch reads motion_mode alongside the graduation fields", () => {
    expect(dispatch).toMatch(/select=id,requested_seconds,actor_refs,grade,motion_mode/);
  });

  it("only the literal 'select' travels; anything else sends nothing", () => {
    expect(dispatch).toMatch(
      /const motionMode = rows\[0\]\.motion_mode === "select" \? "select" : null;/,
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
    expect(worker).toMatch(/process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'/);
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
  });

  it("the column admits NULL or 'select' and nothing else", () => {
    expect(migration).toMatch(/add column if not exists motion_mode text/);
    expect(migration).toMatch(/check \(motion_mode is null or motion_mode = 'select'\)/);
  });
});
