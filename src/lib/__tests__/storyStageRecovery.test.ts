/**
 * Stage-aware recovery inside one CI render — the "don't throw away a paid film"
 * rule, proven two ways.
 *
 * The policy is pure (src/lib/storyRenderer.ts) and mirrored by the worker
 * (remotion/scripts/story-worker.mjs), which cannot be imported here — it claims
 * a job and renders at module load. So the pure predicates are exercised
 * directly, and the worker is pinned to the SAME numbers by source assertion,
 * the discipline capabilityMatrix.test.ts uses against story-clip's constants.
 *
 * What must hold, and why it cost a film to learn:
 *   - a master that comes back truncated/empty is caught BEFORE upload, not
 *     shipped as a stub the user paid for;
 *   - a transient UPLOAD flake retries the upload IN PLACE — the expensive
 *     render is never recomputed to recover a dropped PUT;
 *   - the worker's mirrored constants cannot drift from the policy module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MASTER_MIN_DURATION_RATIO,
  UPLOAD_MAX_ATTEMPTS,
  masterLooksValid,
  uploadBackoffMs,
} from "@/lib/storyRenderer";

describe("masterLooksValid — catch the broken render before it ships", () => {
  it("accepts a whole film that matches its shots", () => {
    expect(masterLooksValid(300, 300)).toBe(true);
    expect(masterLooksValid(59.6, 60)).toBe(true);
  });

  it("rejects an unreadable or empty master", () => {
    expect(masterLooksValid(0, 60)).toBe(false);
    expect(masterLooksValid(-1, 60)).toBe(false);
    expect(masterLooksValid(NaN, 60)).toBe(false);
    expect(masterLooksValid(Infinity, 60)).toBe(false);
  });

  it("rejects a truncated master — under half of what its shots measured", () => {
    // A 300s film that comes back as 90s lost most of its shots to a concat
    // that stopped early. That is the failure worth catching pre-upload.
    expect(masterLooksValid(90, 300)).toBe(false);
    expect(masterLooksValid(300 * MASTER_MIN_DURATION_RATIO - 0.1, 300)).toBe(false);
  });

  it("never rejects a real film for being LONG — an over-long master still plays", () => {
    // A false rejection here would discard a fully-paid render, the exact waste
    // the whole section exists to prevent. So the bound is one-sided.
    expect(masterLooksValid(600, 300)).toBe(true);
  });

  it("applies only the playable floor when the expected duration is unknown", () => {
    expect(masterLooksValid(300)).toBe(true);
    expect(masterLooksValid(0)).toBe(false);
    expect(masterLooksValid(300, 0)).toBe(true);
    expect(masterLooksValid(300, NaN)).toBe(true);
  });
});

describe("uploadBackoffMs — paced, in-place retries", () => {
  it("never waits before the first attempt", () => {
    expect(uploadBackoffMs(1)).toBe(0);
  });

  it("lengthens linearly, matching the worker's browser-retry cadence", () => {
    expect(uploadBackoffMs(2)).toBe(3_000);
    expect(uploadBackoffMs(3)).toBe(6_000);
    expect(uploadBackoffMs(4)).toBe(9_000);
  });

  it("rejects a non-attempt", () => {
    expect(() => uploadBackoffMs(0)).toThrow(/attempt number/);
    expect(() => uploadBackoffMs(-1)).toThrow(/attempt number/);
    expect(() => uploadBackoffMs(1.5)).toThrow(/attempt number/);
  });

  it("gives the upload several tries before the film is called lost", () => {
    expect(UPLOAD_MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
  });
});

describe("the worker mirrors the policy — no drift", () => {
  const WORKER = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");

  it("validates the master with ffprobe before uploading", () => {
    // secondsOf() is the worker's ffprobe wrapper; the master must be measured
    // and gated before the upload loop, not after.
    expect(WORKER).toMatch(/const masterSeconds = secondsOf\(outFile\)/);
    expect(WORKER).toMatch(/master invalid:/);
    const validateAt = WORKER.indexOf("const masterSeconds = secondsOf(outFile)");
    const uploadAt = WORKER.indexOf("uploadFinished(job, outFile)");
    expect(validateAt).toBeGreaterThan(0);
    expect(uploadAt).toBeGreaterThan(validateAt);
  });

  it("pins the master duration ratio to the policy module", () => {
    expect(WORKER).toContain(`const MASTER_MIN_DURATION_RATIO = ${MASTER_MIN_DURATION_RATIO};`);
  });

  it("pins the upload attempt budget to the policy module", () => {
    expect(WORKER).toContain(`const UPLOAD_MAX_ATTEMPTS = ${UPLOAD_MAX_ATTEMPTS};`);
  });

  it("retries the upload in place — a loop over uploadFinished, not a re-render", () => {
    // The upload sits in an attempt loop; renderPlan (the expensive stage) is
    // called exactly once, above the loop, and is never reached from inside it.
    expect(WORKER).toMatch(/for \(let attempt = 1; ; attempt\+\+\)/);
    expect(WORKER).toMatch(/render preserved:/);
    const onlineRenderCalls = WORKER.match(/await renderPlan\(/g) ?? [];
    // One offline call site, one online call site — never a third that a retry
    // path could re-enter.
    expect(onlineRenderCalls.length).toBe(2);
  });

  it("backs off by attempt*3000ms, the uploadBackoffMs cadence", () => {
    expect(WORKER).toMatch(/const wait = attempt \* 3_000;/);
  });
});
