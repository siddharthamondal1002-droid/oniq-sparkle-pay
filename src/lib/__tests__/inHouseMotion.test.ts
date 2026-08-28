/**
 * The film pipeline's LEVEL 4 motion stage — ONIQ's own GPU, not Google's.
 *
 * The two things worth proving are the ones that cost money when wrong:
 * a retry must not re-spend, and a still key must be one the server owns.
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import {
  CLIP_SECONDS,
  GPU_SECONDS_PER_CLIP,
  STILL_PREFIX,
  buildClipPayload,
  clipsForShot,
  gpuJobCount,
  motionProgress,
  outputKeyFor,
  pendingUnits,
  planMotion,
  routeMotion,
  stillKeyFor,
  unitKey,
  IN_HOUSE_CLIP_COST,
  MAX_UNIT_ATTEMPTS,
  estimateMotionUsd,
  policyFromRoute,
  runUnit,
  runUnits,
  type ClipUnit,
  type ShotInput,
  type SubmitDeps,
} from "../../../supabase/functions/_shared/inHouseMotion";
import type { MovieShot } from "../../../supabase/functions/_shared/movieGrammar";

const SHOT: MovieShot = {
  still: "a lamp on a table",
  narration: "He found the lamp.",
  motion: "Slow push in.",
};

function shot(over: Partial<ShotInput> = {}): ShotInput {
  return {
    sceneId: "s1",
    shotId: "sh1",
    seconds: 4,
    shot: SHOT,
    ...over,
  };
}

describe("clip arithmetic", () => {
  it("uses the worker's fixed 97-frame clock", () => {
    expect(CLIP_SECONDS).toBeCloseTo(97 / 24, 6);
  });

  it("covers a long shot with several clips rather than shortening it", () => {
    // 10s at ~4.04s per clip is 3 clips, not 2. Rounding down would silently
    // cut the film; the last clip is trimmed at assembly instead.
    expect(clipsForShot(10)).toBe(3);
  });

  it("a shot inside one clip is one clip", () => {
    expect(clipsForShot(3)).toBe(1);
    expect(clipsForShot(CLIP_SECONDS)).toBe(1);
  });

  it("refuses to plan a zero or negative shot", () => {
    expect(clipsForShot(0)).toBe(0);
    expect(clipsForShot(-5)).toBe(0);
    expect(clipsForShot(Number.NaN)).toBe(0);
  });
});

describe("logical identity is deterministic", () => {
  it("the same shot and version produce the same key twice", () => {
    expect(unitKey("p", "s", "sh", 1, 0)).toBe(unitKey("p", "s", "sh", 1, 0));
  });

  it("bumping the version is the only way to ask again", () => {
    expect(unitKey("p", "s", "sh", 1, 0)).not.toBe(unitKey("p", "s", "sh", 2, 0));
  });

  it("clips within a shot are distinct", () => {
    expect(unitKey("p", "s", "sh", 1, 0)).not.toBe(unitKey("p", "s", "sh", 1, 1));
  });

  it("the output key is derived from the identity, never supplied", () => {
    expect(outputKeyFor("p/s/sh/v1/0")).toBe("story/clip/p/s/sh/v1/0/ltx-001.mp4");
  });

  it("a replanned film reuses the same keys, so a retry cannot double-spend", () => {
    const a = planMotion("p", [shot()], 1);
    const b = planMotion("p", [shot()], 1);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.units.map((u) => u.key)).toEqual(b.units.map((u) => u.key));
      expect(a.units.map((u) => u.outputKey)).toEqual(b.units.map((u) => u.outputKey));
    }
  });
});

describe("the still fence is derive-only", () => {
  it("derives the key from identifiers under the server's namespace", () => {
    expect(stillKeyFor("job1", "s1", "sh1")).toBe(`${STILL_PREFIX}job1-s1-sh1.png`);
    const plan = planMotion("p", [shot()], 1);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.units[0].stillKey.startsWith(STILL_PREFIX)).toBe(true);
  });

  it("takes NO key parameter at all — a bucket path has nowhere to go", () => {
    // The strongest form of the fence: not "we validate the key" but "there
    // is no key to supply". Proven structurally so a future overload that
    // accepts one has to delete this test to land.
    const src = readFileSync(
      new URL("../../../supabase/functions/_shared/inHouseMotion.ts", import.meta.url),
      "utf-8",
    );
    const shotInput = src.slice(
      src.indexOf("export type ShotInput"),
      src.indexOf("export type MotionPlan"),
    );
    expect(shotInput).not.toContain("stillKey");
    expect(shotInput).not.toContain("url");
    expect(shotInput).not.toContain("path");
  });

  it("refuses a traversal in an identifier rather than sanitising it", () => {
    // Rewriting it would make two shots share one key, and a shared key is a
    // shared clip.
    expect(() => stillKeyFor("job1", "../../etc", "sh1")).toThrow(/unsafe sceneId/);
    expect(() => stillKeyFor("../x", "s1", "sh1")).toThrow(/unsafe jobId/);
  });

  it("refuses a scheme or a slash smuggled through an identifier", () => {
    expect(() => stillKeyFor("job1", "s1", "https://evil/x")).toThrow(/unsafe shotId/);
    expect(() => stillKeyFor("job1", "s1", "a/b")).toThrow(/unsafe shotId/);
    expect(() => stillKeyFor("job1", "s1", "")).toThrow(/unsafe shotId/);
  });

  it("an unsafe project id refuses the whole plan", () => {
    const plan = planMotion("../p", [shot()], 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.refusal).toBe("still-not-server-owned");
  });
});

describe("planning refuses rather than guessing", () => {
  it("a film with no shots", () => {
    const plan = planMotion("p", [], 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.refusal).toBe("no-shots");
  });

  it("a shot with an unusable duration", () => {
    const plan = planMotion("p", [shot({ seconds: 0 })], 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.refusal).toBe("shot-duration-invalid");
  });

  it("a version that is not a positive integer", () => {
    for (const v of [0, -1, 1.5]) {
      const plan = planMotion("p", [shot()], v);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.refusal).toBe("version-invalid");
    }
  });

  it("a prompt past the worker's bound", () => {
    const long: MovieShot = { ...SHOT, motion: "x".repeat(1200) };
    const plan = planMotion("p", [shot({ shot: long })], 1);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.refusal).toBe("prompt-too-long");
  });
});

describe("the payload matches the worker contract", () => {
  it("animates the still by its server-owned key", () => {
    const plan = planMotion("p", [shot()], 1);
    if (!plan.ok) throw new Error("expected a plan");
    const payload = buildClipPayload(plan.units[0], SHOT, false);
    expect(payload.input.op).toBe("video_generate");
    expect(payload.input.input_key).toBe(stillKeyFor("p", "s1", "sh1"));
    expect(payload.input.output_key).toBe(plan.units[0].outputKey);
    expect(payload.input.params.prompt).toContain("Slow push in.");
  });

  it("watermarks by default and only lifts it on entitlement", () => {
    const plan = planMotion("p", [shot()], 1);
    if (!plan.ok) throw new Error("expected a plan");
    expect(buildClipPayload(plan.units[0], SHOT, false).input.params.watermark).toBe(true);
    expect(buildClipPayload(plan.units[0], SHOT, true).input.params.watermark).toBe(false);
  });

  it("never carries a provider or model field — no fallback is expressible", () => {
    const plan = planMotion("p", [shot()], 1);
    if (!plan.ok) throw new Error("expected a plan");
    const raw = JSON.stringify(buildClipPayload(plan.units[0], SHOT, false));
    for (const banned of ["provider", "google", "veo", "model", "fallback"]) {
      expect(raw.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("resumability and progress", () => {
  const film = [shot(), shot({ shotId: "sh2", seconds: 10 })];

  it("only the missing units are pending", () => {
    const plan = planMotion("p", film, 1);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.units).toHaveLength(1 + 3);
    const done = new Set([plan.units[0].key, plan.units[1].key]);
    const pending = pendingUnits(plan.units, done);
    expect(pending).toHaveLength(2);
    expect(pending.map((u) => u.key)).not.toContain(plan.units[0].key);
  });

  it("a finished film has nothing pending, so a re-run spends nothing", () => {
    const plan = planMotion("p", film, 1);
    if (!plan.ok) throw new Error("expected a plan");
    const done = new Set(plan.units.map((u) => u.key));
    expect(pendingUnits(plan.units, done)).toHaveLength(0);
    expect(motionProgress(plan.units, done)).toBe(1);
  });

  it("progress counts completed work, not elapsed time", () => {
    const plan = planMotion("p", film, 1);
    if (!plan.ok) throw new Error("expected a plan");
    expect(motionProgress(plan.units, new Set())).toBe(0);
    expect(motionProgress(plan.units, new Set([plan.units[0].key]))).toBeCloseTo(0.25, 6);
  });
});

describe("capacity accounting", () => {
  it("counts one GPU job per clip and no more", () => {
    const plan = planMotion("p", [shot({ seconds: 10 })], 1);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.gpuJobs).toBe(3);
    expect(gpuJobCount(plan)).toBe(3);
    expect(plan.gpuSeconds).toBeCloseTo(3 * GPU_SECONDS_PER_CLIP, 6);
  });

  it("a refused plan books no GPU capacity at all", () => {
    expect(gpuJobCount(planMotion("p", [], 1))).toBe(0);
  });
});

describe("routing: in-house, and never a silent fallback", () => {
  const ok = { inHouseEnabled: true, gpuHealthy: true, workerImagePresent: true };

  it("routes to the in-house GPU at level 4 when everything is ready", () => {
    expect(routeMotion(ok)).toEqual({ engine: "in-house", level: 4 });
  });

  it("is OFF by default, so this merge changes no production behaviour", () => {
    expect(routeMotion({ ...ok, inHouseEnabled: false })).toEqual({
      engine: "premium",
      level: 5,
    });
  });

  it("BLOCKS rather than falling back when the worker image is missing", () => {
    // The live state on 2026-08-28: template hhhdwtjw0y is empty.
    expect(routeMotion({ ...ok, workerImagePresent: false })).toEqual({
      engine: "blocked",
      reason: "worker-image-missing",
    });
  });

  it("BLOCKS rather than falling back when the GPU is unhealthy", () => {
    expect(routeMotion({ ...ok, gpuHealthy: false })).toEqual({
      engine: "blocked",
      reason: "gpu-unavailable",
    });
  });

  it("never answers premium once in-house has been selected", () => {
    for (const gpuHealthy of [true, false]) {
      for (const workerImagePresent of [true, false]) {
        const route = routeMotion({ inHouseEnabled: true, gpuHealthy, workerImagePresent });
        expect(route.engine).not.toBe("premium");
      }
    }
  });
});

describe("measured economics, not a price list", () => {
  it("carries the measurement's date and source with the figure", () => {
    expect(IN_HOUSE_CLIP_COST.usdPerClip).toBe(0.0029);
    expect(IN_HOUSE_CLIP_COST.measuredOn).toBe("2026-08-27");
    expect(IN_HOUSE_CLIP_COST.source).toMatch(/gpu_video_jobs/);
  });

  it("estimates a reservation from unit count", () => {
    expect(estimateMotionUsd(3)).toBeCloseTo(0.0087, 6);
    expect(estimateMotionUsd(0)).toBe(0);
  });
});

describe("the submit path", () => {
  const unit = { ...(planMotion("p", [shot()], 1) as { units: ClipUnit[] }).units[0] };

  function deps(over: Partial<SubmitDeps> = {}) {
    const recorded: unknown[] = [];
    const base: SubmitDeps = {
      findCompleted: async () => null,
      submit: async () => "gpu-1",
      awaitTerminal: async () => ({ ok: true }),
      record: async (row) => void recorded.push(row),
      ...over,
    };
    return { deps: base, recorded };
  }

  it("skips a unit already done — a retry re-spends nothing", async () => {
    const { deps: d, recorded } = deps({ findCompleted: async () => "media/film/done.mp4" });
    let submits = 0;
    const outcome = await runUnit(unit, SHOT, false, {
      ...d,
      submit: async () => {
        submits++;
        return "gpu-x";
      },
    });
    expect(outcome).toEqual({ state: "reused", outputKey: "media/film/done.mp4" });
    expect(submits).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it("completes on the first attempt and records a terminal state", async () => {
    const { deps: d, recorded } = deps();
    const outcome = await runUnit(unit, SHOT, false, d);
    expect(outcome.state).toBe("completed");
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { status: string }).status).toBe("completed");
  });

  it("forgives one blip, then stops — attempts are bounded", async () => {
    let calls = 0;
    const { deps: d } = deps({
      awaitTerminal: async () => {
        calls++;
        return calls === 1 ? { ok: false, reason: "blip" } : { ok: true };
      },
    });
    const outcome = await runUnit(unit, SHOT, false, d);
    expect(outcome.state).toBe("completed");
    expect(calls).toBe(2);
  });

  it("never exceeds MAX_UNIT_ATTEMPTS, so a failing unit cannot bill forever", async () => {
    let submits = 0;
    const { deps: d, recorded } = deps({
      submit: async () => {
        submits++;
        return "gpu-1";
      },
      awaitTerminal: async () => ({ ok: false, reason: "cuda-unavailable" }),
    });
    const outcome = await runUnit(unit, SHOT, false, d);
    expect(outcome).toEqual({
      state: "failed",
      reason: "cuda-unavailable",
      attempts: MAX_UNIT_ATTEMPTS,
    });
    expect(submits).toBe(MAX_UNIT_ATTEMPTS);
    // Terminal state WRITTEN — never left running for a reconciler to find.
    expect((recorded.at(-1) as { status: string }).status).toBe("failed");
  });

  it("records a terminal failure even when submit itself throws", async () => {
    const { deps: d, recorded } = deps({
      submit: async () => {
        throw new Error("worker unreachable");
      },
    });
    const outcome = await runUnit(unit, SHOT, false, d);
    expect(outcome.state).toBe("failed");
    expect((recorded.at(-1) as { status: string; gpuJobId: string | null }).gpuJobId).toBeNull();
  });

  it("runs a film's units and reports exactly which failed", async () => {
    const plan = planMotion("p", [shot(), shot({ shotId: "sh2" })], 1);
    if (!plan.ok) throw new Error("expected a plan");
    const { deps: d } = deps({
      awaitTerminal: async () => ({ ok: false, reason: "nope" }),
      findCompleted: async (key) => (key.includes("sh1") ? "media/film/a.mp4" : null),
    });
    const res = await runUnits(plan.units, () => SHOT, false, d);
    expect(res.failed).toEqual([plan.units[1].key]);
    expect(res.outcomes.get(plan.units[0].key)?.state).toBe("reused");
  });
});

describe("a route becomes a level policy, and cannot leak to Veo", () => {
  it("in-house allows L4 and WITHDRAWS premium, so a QC miss cannot escalate", () => {
    expect(policyFromRoute({ engine: "in-house", level: 4 })).toEqual({
      allowDiffusion: true,
      allowPremium: false,
    });
  });

  it("premium keeps today's behaviour", () => {
    expect(policyFromRoute({ engine: "premium", level: 5 })).toEqual({
      allowDiffusion: false,
      allowPremium: true,
    });
  });

  it("blocked allows nothing at all", () => {
    expect(policyFromRoute({ engine: "blocked", reason: "worker-image-missing" })).toEqual({
      allowDiffusion: false,
      allowPremium: false,
    });
  });
});
