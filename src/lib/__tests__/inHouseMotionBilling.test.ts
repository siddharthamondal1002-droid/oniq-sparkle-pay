/**
 * In-house motion billing: the ledger ONIQ already keeps, at the in-house rate.
 *
 * These test BEHAVIOUR — what the spend request says, what a retry produces,
 * what a stale or absent measurement does — rather than that a file contains a
 * word. The one structural check left is the ordering guarantee (reserve
 * strictly before the GPU), which is a property of the source and is asserted
 * as a sequence of real calls in the transport test, not as a grep.
 */
import { describe, it, expect } from "vitest";

import {
  CLIP_SECONDS,
  IN_HOUSE_CLIP_COST,
  IN_HOUSE_MODEL,
  IN_HOUSE_PROVIDER,
  actualUsdFor,
  gpuSecondsFrom,
  planMotion,
  runBilledUnit,
  spendRequestFor,
  type BilledDeps,
  type ShotInput,
} from "../../../supabase/functions/_shared/inHouseMotion";
import type { MovieShot } from "../../../supabase/functions/_shared/movieGrammar";

const SHOT: MovieShot = { still: "a lamp", narration: "He found it.", motion: "Push in." };
const shot = (over: Partial<ShotInput> = {}): ShotInput => ({
  sceneId: "s1",
  shotId: "sh1",
  seconds: 4,
  shot: SHOT,
  ...over,
});

describe("the spend request", () => {
  const plan = planMotion("job1", [shot()], 1);
  if (!plan.ok) throw new Error("expected a plan");
  const unit = plan.units[0];
  const req = spendRequestFor(unit, "job1", { stillKey: "story/still/x.png" });

  it("books GPU — time-billed, its own ceiling", () => {
    expect(req.capability).toBe("GPU");
    expect(req.unit).toBe("video_seconds");
    expect(req.units).toBeCloseTo(CLIP_SECONDS, 6);
  });

  it("names ONIQ's own worker, not a metered provider", () => {
    expect(req.provider).toBe(IN_HOUSE_PROVIDER);
    expect(req.model).toBe(IN_HOUSE_MODEL);
    expect(JSON.stringify(req).toLowerCase()).not.toContain("veo");
    expect(JSON.stringify(req).toLowerCase()).not.toContain("google");
  });

  it("reserves the measured in-house cost, not a user price", () => {
    expect(req.estimatedUsd).toBe(IN_HOUSE_CLIP_COST.usdPerClip);
  });

  it("scopes the reservation to the film and records the shot", () => {
    expect(req.jobId).toBe("job1");
    expect(req.detail.sceneId).toBe("s1");
    expect(req.detail.shotId).toBe("sh1");
    expect(req.detail.index).toBe(0);
  });

  it("keys the reservation on the LOGICAL UNIT, so a retry cannot double-charge", () => {
    const again = planMotion("job1", [shot()], 1);
    if (!again.ok) throw new Error("expected a plan");
    expect(spendRequestFor(again.units[0], "job1").requestId).toBe(req.requestId);
    expect(req.requestId).toBe(unit.key);
  });

  it("a deliberate re-generation is a DIFFERENT reservation", () => {
    const v2 = planMotion("job1", [shot()], 2);
    if (!v2.ok) throw new Error("expected a plan");
    expect(spendRequestFor(v2.units[0], "job1").requestId).not.toBe(req.requestId);
  });

  it("each clip of a long shot reserves separately", () => {
    const long = planMotion("job1", [shot({ seconds: 10 })], 1);
    if (!long.ok) throw new Error("expected a plan");
    const ids = long.units.map((u) => spendRequestFor(u, "job1").requestId);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("settling on measured time", () => {
  it("prices the clip from the GPU seconds the worker reported", () => {
    // The measured basis: $0.0029 over 38.87 GPU-seconds.
    expect(actualUsdFor(38.87)).toBeCloseTo(IN_HOUSE_CLIP_COST.usdPerClip, 6);
    expect(actualUsdFor(77.74)).toBeCloseTo(IN_HOUSE_CLIP_COST.usdPerClip * 2, 6);
  });

  it("returns undefined when nothing usable was reported, so the ESTIMATE stands", () => {
    // Over-counting is the safe direction; inventing a cheaper actual is not.
    for (const bad of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(actualUsdFor(bad as number)).toBeUndefined();
    }
  });

  it("reads the worker's own load+inference time", () => {
    expect(gpuSecondsFrom({ model_load_ms: 900, inference_ms: 37_970 })).toBeCloseTo(38.87, 6);
    expect(gpuSecondsFrom({ inference_ms: 2000 })).toBe(2);
  });

  it("a report with no timings is null, never zero-cost", () => {
    for (const bad of [null, undefined, {}, "x", { model_load_ms: 0, inference_ms: 0 }]) {
      expect(gpuSecondsFrom(bad)).toBeNull();
    }
  });
});

describe("reserve → generate → settle, as real calls", () => {
  const REF = { key: "job1/s1/sh1/v1/0", sceneId: "s1", shotId: "sh1", index: 0 };
  const RESULT: { gpuJobId: string; key: string; output: unknown } = {
    gpuJobId: "gpu-1",
    key: "story/clip/job1/s1/sh1/v1/0/ltx-001.mp4",
    output: { model_load_ms: 900, inference_ms: 37_970 },
  };

  function rig(over: Partial<BilledDeps<typeof RESULT>> = {}) {
    const calls: string[] = [];
    const settles: { id: string; s: Record<string, unknown> }[] = [];
    const deps: BilledDeps<typeof RESULT> = {
      admit: async () => {
        calls.push("admit");
        return { ok: true };
      },
      generate: async () => {
        calls.push("generate");
        return RESULT;
      },
      settle: async (id, s) => {
        calls.push("settle");
        settles.push({ id, s: s as unknown as Record<string, unknown> });
      },
      ...over,
    };
    return { deps, calls, settles };
  }

  it("reserves BEFORE the GPU is touched", async () => {
    const { deps, calls } = rig();
    await runBilledUnit(REF, "job1", deps);
    expect(calls).toEqual(["admit", "generate", "settle"]);
    expect(calls.indexOf("admit")).toBeLessThan(calls.indexOf("generate"));
  });

  it("a refused reservation means NO GPU JOB and no settle", async () => {
    const { deps, calls } = rig({
      admit: async () => {
        calls.push("admit");
        return { ok: false, reason: "daily-cap" };
      },
    });
    const out = await runBilledUnit(REF, "job1", deps);
    expect(out).toEqual({ ok: false, stage: "admission", reason: "daily-cap" });
    expect(calls).toEqual(["admit"]);
    expect(calls).not.toContain("generate");
  });

  it("settles on success at the measured cost", async () => {
    const { deps, settles } = rig();
    const out = await runBilledUnit(REF, "job1", deps);
    expect(out.ok).toBe(true);
    expect(settles).toHaveLength(1);
    expect(settles[0].id).toBe(REF.key);
    expect(settles[0].s.outcome).toBe("ACCEPTED");
    expect(settles[0].s.actualUsd).toBeCloseTo(IN_HOUSE_CLIP_COST.usdPerClip, 6);
  });

  it("a generation failure SETTLES rather than releasing — the card may have been held", async () => {
    const { deps, settles, calls } = rig({
      generate: async () => {
        calls.push("generate");
        throw new Error("cuda-unavailable (gpu job gpu-9)");
      },
    });
    const out = await runBilledUnit(REF, "job1", deps);
    expect(out).toMatchObject({ ok: false, stage: "generation" });
    expect(settles).toHaveLength(1);
    expect(settles[0].s.outcome).toBe("FAILED");
    expect(settles[0].s.unitsActual).toBe(0);
    expect(String((settles[0].s.detail as { reason: string }).reason)).toContain("gpu job gpu-9");
  });

  it("the estimate stands when the worker reported no usable time", async () => {
    const { deps, settles } = rig({
      generate: async () => ({ ...RESULT, output: {} }),
    });
    await runBilledUnit(REF, "job1", deps);
    expect(settles[0].s.actualUsd).toBeUndefined();
  });

  it("a retry reserves under the SAME id — the ledger, not a flag, dedupes", async () => {
    const seen: string[] = [];
    const admit = async (req: { requestId: string }) => {
      seen.push(req.requestId);
      return { ok: true };
    };
    const a = rig({ admit: admit as never });
    const b = rig({ admit: admit as never });
    await runBilledUnit(REF, "job1", a.deps);
    await runBilledUnit(REF, "job1", b.deps);
    expect(seen).toEqual([REF.key, REF.key]);
  });
});

describe("long video keeps its requested duration", () => {
  it("the clips a shot plans sum to EXACTLY the seconds asked for", () => {
    // The failure this guards: rounding down to 2 clips for a 10s shot, which
    // silently ships a 8.08s shot and a short film.
    for (const seconds of [1, 4, CLIP_SECONDS, 10, 17.5, 60]) {
      const plan = planMotion("job1", [shot({ seconds })], 1);
      if (!plan.ok) throw new Error(`no plan for ${seconds}`);
      const covered = plan.units.reduce((n, u) => n + u.usedSeconds, 0);
      expect(covered, `${seconds}s`).toBeCloseTo(seconds, 6);
    }
  });

  it("every clip but the last is a full clip; the last is the remainder", () => {
    const plan = planMotion("job1", [shot({ seconds: 10 })], 1);
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.units).toHaveLength(3);
    expect(plan.units[0].usedSeconds).toBeCloseTo(CLIP_SECONDS, 6);
    expect(plan.units[1].usedSeconds).toBeCloseTo(CLIP_SECONDS, 6);
    expect(plan.units[2].usedSeconds).toBeCloseTo(10 - 2 * CLIP_SECONDS, 6);
    // ...and the last is SHORTER than a clip, which is what assembly trims.
    expect(plan.units[2].usedSeconds).toBeLessThan(CLIP_SECONDS);
  });

  it("a whole film's coverage equals the sum of its shots", () => {
    const shots = [
      shot({ seconds: 3 }),
      shot({ shotId: "sh2", seconds: 10 }),
      shot({ shotId: "sh3", seconds: 7 }),
    ];
    const plan = planMotion("job1", shots, 1);
    if (!plan.ok) throw new Error("expected a plan");
    const covered = plan.units.reduce((n, u) => n + u.usedSeconds, 0);
    expect(covered).toBeCloseTo(20, 6);
  });
});
