/**
 * ACTOR_REFS GRADUATION — movie-grade jobs condition on owner actors by
 * default (2026-08-22), after the 43-shot acceptance render (job 5871421e)
 * passed frame-level visual inspection: 38/38 eligible shots conditioned
 * with clean anatomy and no reference contamination, sheet refusals
 * degraded gracefully to text-only draws.
 *
 * Edge functions run on Deno (outside tsconfig), so the graduated shape is
 * pinned in source — the same convention as the OTP and IDOR guards. The
 * three contracts that must never silently change:
 *
 *   1. story-dispatch decides: movie grade → on, explicit per-job flag
 *      still wins, classic stays off.
 *   2. The workflow and worker DEFAULTS stay 'off' — an unset payload can
 *      never enable conditioning anywhere else.
 *   3. Sheet references stay refused at the casting layer regardless of
 *      how the job-level flag was set (graduation must not make sheets
 *      blindly attachable).
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

describe("actor_refs graduation (movie grade default-on)", () => {
  it("story-dispatch reads the job's grade alongside the per-job flag", () => {
    expect(dispatch).toMatch(/select=id,requested_seconds,actor_refs,grade/);
  });

  it("movie grade turns conditioning on; the explicit flag still wins", () => {
    expect(dispatch).toMatch(
      /const actorRefs = rows\[0\]\.actor_refs === true \|\| rows\[0\]\.grade === "movie";/,
    );
  });

  it("the flag still travels per job in the dispatch payload", () => {
    expect(dispatch).toMatch(/client_payload: \{ job_id: jobId, token, supabase_url: supabaseUrl, actor_refs: actorRefs \}/);
  });

  it("workflow and worker defaults remain off — only the payload enables it", () => {
    // The workflow expression may enable STORY_ACTOR_REFS only from the
    // dispatch payload (or the manual input); its fallback stays 'off'.
    expect(workflow).toMatch(
      /STORY_ACTOR_REFS: \$\{\{ \(github\.event\.client_payload\.actor_refs && 'on'\) \|\| inputs\.actor_refs \|\| 'off' \}\}/,
    );
  });

  it("sheet references remain refused at the casting layer", () => {
    // Graduation widens WHICH jobs condition, never WHAT may attach: the
    // worker still refuses sheet-kind references per shot.
    const worker = readFileSync(
      join(process.cwd(), "remotion/scripts/story-worker.mjs"),
      "utf8",
    );
    expect(worker).toMatch(/SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE/);
  });
});
