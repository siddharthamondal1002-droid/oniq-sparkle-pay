// Film-level capacity admission — the Director's preflight.
//
// Owner directive 2026-08-27: "Do not create 86 jobs and hope the queue
// handles it." And: do not change the numbers. These tests hold both —
// the arithmetic is real, and no ceiling is ever set here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GPU_SECONDS,
  MAX_CONCAT_SEGMENTS,
  admitFilm,
  costFilm,
  dispatchAllowance,
} from "../../../supabase/functions/_shared/filmCapacity.ts";

/** The live policy at the time of writing, passed IN, never assumed. */
const POLICY = { dailyCap: 20, usedToday: 0, concurrency: 1 };

describe("a film is costed before anything is dispatched", () => {
  it("counts every job a movie-grade minute needs", () => {
    const cost = costFilm(60, { grade: "movie" });
    expect(cost.shots).toBe(15);
    expect(cost.imageJobs).toBe(15);
    expect(cost.videoJobs).toBe(15);
    expect(cost.audioJobs).toBe(15);
    expect(cost.totalJobs).toBeGreaterThan(45);
  });

  it("assembles long films in groups, because the worker refuses 17 segments", () => {
    const cost = costFilm(300, { grade: "movie" });
    expect(cost.shots).toBe(75);
    // 75 -> 5 groups -> 1 final: concat is jobs too, and jobs are capped.
    expect(cost.concatJobs).toBe(6);
    expect(MAX_CONCAT_SEGMENTS).toBe(16);
  });

  it("classic grade costs no video and no assembly on the GPU", () => {
    const cost = costFilm(60, { grade: "classic" });
    expect(cost.videoJobs).toBe(0);
    expect(cost.concatJobs).toBe(0);
  });

  it("estimates GPU seconds from the measured rates", () => {
    // The video and audio rates are measured (job e010372d); the image
    // rate is an estimate and is named as one in the source.
    expect(GPU_SECONDS.video).toBeCloseTo(38.87, 2);
    expect(GPU_SECONDS.audio).toBeCloseTo(2.35, 2);
    expect(costFilm(60, { grade: "movie" }).estimatedGpuSeconds).toBeGreaterThan(800);
  });
});

describe("admission is honest about what the policy can carry", () => {
  it("admits a film that fits in what is left today", () => {
    const cost = costFilm(4, { grade: "movie" }); // one shot
    const verdict = admitFilm(cost, POLICY);
    expect(verdict.decision).toBe("ADMIT");
  });

  it("QUEUES a film that fits the policy but not one day — it never half-starts", () => {
    const cost = costFilm(60, { grade: "movie" });
    const verdict = admitFilm(cost, POLICY);
    expect(verdict.decision).toBe("QUEUE");
    if (verdict.decision === "QUEUE") {
      expect(verdict.daysRequired).toBeGreaterThan(1);
      expect(verdict.reason).toContain("20/day");
    }
  });

  it("a spent day queues rather than pretending there is room", () => {
    const cost = costFilm(4, { grade: "movie" });
    const verdict = admitFilm(cost, { ...POLICY, usedToday: 20 });
    expect(verdict.decision).toBe("QUEUE");
  });

  it("refuses outright when the policy cannot deliver at all", () => {
    const cost = costFilm(60, { grade: "movie" });
    expect(admitFilm(cost, { ...POLICY, dailyCap: 0 }).decision).toBe("REFUSE");
    expect(admitFilm(cost, { ...POLICY, concurrency: 0 }).decision).toBe("REFUSE");
  });
});

describe("the cap is never bypassed, and never set here", () => {
  it("dispatch is bounded by the SMALLER of the day's cap and the free workers", () => {
    expect(dispatchAllowance({ dailyCap: 20, usedToday: 0, concurrency: 1 }, 0)).toBe(1);
    expect(dispatchAllowance({ dailyCap: 20, usedToday: 19, concurrency: 4 }, 0)).toBe(1);
    expect(dispatchAllowance({ dailyCap: 20, usedToday: 0, concurrency: 1 }, 1)).toBe(0);
    expect(dispatchAllowance({ dailyCap: 20, usedToday: 20, concurrency: 1 }, 0)).toBe(0);
  });

  it("this module contains no ceiling of its own — every limit is an argument", () => {
    // A module that could raise a cap is a module that eventually will.
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/filmCapacity.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/dailyCap\s*[:=]\s*\d/);
    expect(src).not.toMatch(/concurrency\s*[:=]\s*\d/);
  });
});
