/**
 * PREFLIGHT wiring + the 300-second duration contract, pinned in the worker.
 *
 * storyPreflight.test.ts proves the pure gate. This proves the WORKER actually
 * runs it in the right place and that a 300-second request cannot silently
 * become 60 on the way to the renderer. The worker (remotion/scripts/story-
 * worker.mjs) claims a job and renders at module load, so it cannot be imported
 * — it is pinned by source assertion, the repo's established discipline for Deno
 * and Node entrypoints. The behavioural half (planStory preserves 300; the gate
 * refuses a shrunk timeline) is exercised directly against the pure modules.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planStory } from "@/lib/storyPlan";
import { preflight, type JobManifest } from "@/lib/storyPreflight";

const WORKER = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");

describe("the worker runs PREFLIGHT before the expensive stage", () => {
  it("imports and calls the pure gate", () => {
    expect(WORKER).toMatch(/from '\.\.\/\.\.\/src\/lib\/storyPreflight\.ts'/);
    expect(WORKER).toMatch(/const pf = preflight\(manifest\)/);
  });

  it("gates the render — preflight runs, and fails, before renderPlan", () => {
    const preflightAt = WORKER.indexOf("const pf = preflight(manifest)");
    const throwAt = WORKER.indexOf("stageFail('PREFLIGHT'");
    // The online renderPlan call is the last renderPlan( in the file.
    const renderAt = WORKER.lastIndexOf("await renderPlan(renderInput");
    expect(preflightAt).toBeGreaterThan(0);
    expect(throwAt).toBeGreaterThan(preflightAt);
    expect(renderAt).toBeGreaterThan(throwAt); // render is downstream of the gate
  });

  it("builds the manifest from the same plan the render loads", () => {
    expect(WORKER).toMatch(/buildPreflightManifest\(job, renderInput, rendered, publicDir\)/);
    // Probes the real files, not just existsSync — size and (for av) duration.
    expect(WORKER).toMatch(/fs\.statSync\(abs\)\.size/);
    expect(WORKER).toMatch(/seconds = secondsOf\(abs\)/);
  });

  it("fails a preflight without launching the browser or regenerating", () => {
    // On !pf.ok the worker throws immediately; renderPlan/openBrowser are never
    // reached, and there is no asset-regeneration call in the failure arm.
    const failBlock = WORKER.slice(
      WORKER.indexOf("if (!pf.ok) {"),
      WORKER.indexOf("await markAssembling(job)"),
    );
    expect(failBlock).toMatch(/throw err/);
    expect(failBlock).not.toMatch(/renderPlan|openBrowser|generateClip|story-still/);
  });
});

describe("explicit stage markers — no more ambiguous 'browser launch failed'", () => {
  it("brackets every lifecycle stage with START and SUCCESS/FAILURE + elapsed ms", () => {
    for (const stage of [
      "PREPARE",
      "PREFLIGHT",
      "RENDER",
      "OUTPUT_VALIDATE",
      "UPLOAD",
      "FINALIZE",
    ]) {
      expect(WORKER, `${stage} start`).toContain(`stageStart('${stage}')`);
      expect(WORKER, `${stage} ok`).toContain(`stageOk('${stage}'`);
    }
    // RENDER, OUTPUT_VALIDATE, UPLOAD and PREFLIGHT each log a failure marker.
    for (const stage of ["PREFLIGHT", "RENDER", "OUTPUT_VALIDATE", "UPLOAD"]) {
      expect(WORKER, `${stage} fail`).toContain(`stageFail('${stage}'`);
    }
    expect(WORKER).toMatch(/STAGE_START \$\{name\}/);
    expect(WORKER).toMatch(/STAGE_SUCCESS \$\{name\} \$\{Date\.now\(\) - t0\}ms/);
    expect(WORKER).toMatch(/STAGE_FAILURE \$\{name\} \$\{Date\.now\(\) - t0\}ms/);
  });
});

describe("the 300-second duration contract", () => {
  it("the worker propagates the requested seconds verbatim — no 60s fallback", () => {
    // Read off the row, mapped straight through claimJob, used by planStory and
    // verbatimFits, and carried into the preflight manifest — unclamped, with no
    // "|| 60" or DEFAULT_STORY_SECONDS substitution anywhere in the path.
    expect(WORKER).toMatch(/requestedSeconds: row\.requested_seconds/);
    expect(WORKER).toMatch(/requestedSeconds: got\.requestedSeconds/);
    expect(WORKER).toMatch(/planStory\(job\.requestedSeconds\)/);
    expect(WORKER).toMatch(/requestedSeconds: job\.requestedSeconds/);
    expect(WORKER).not.toMatch(/requestedSeconds[^\n]*\|\|\s*60/);
    expect(WORKER).not.toMatch(/DEFAULT_STORY_SECONDS/);
  });

  it("planStory keeps 300 seconds as 300, not 60", () => {
    // The production planner the worker calls: a 300s request must plan a 300s
    // film. If this ever returns 60, the shrink is in the planner, not upstream.
    const plan = planStory(300);
    expect(plan.seconds).toBe(300);
    expect(plan.shots.reduce((a, s) => a + s.seconds, 0)).toBe(300);
    expect(plan.shots.length).toBeGreaterThan(1);
  });

  it("the gate refuses to render a 300s job whose timeline came out at 60s", () => {
    const shots = [];
    for (let i = 0; i < 6; i++) {
      shots.push({
        index: i,
        seconds: 10,
        assets: [
          { role: "still", path: `s${i}.png`, kind: "image", present: true, bytes: 80_000 },
          {
            role: "audio",
            path: `s${i}.wav`,
            kind: "audio",
            present: true,
            bytes: 200_000,
            seconds: 10,
          },
        ],
      });
    }
    const manifest = {
      id: "job-x",
      requestedSeconds: 300,
      verbatim: true,
      fps: 30,
      width: 1080,
      height: 1920,
      shots,
    } as unknown as JobManifest;
    const r = preflight(manifest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_DURATION_MISMATCH");
  });
});
