/**
 * The motion-provider contract: classify a shot, order the engines, run them
 * with a bounded fallback — proven with mocks, no GPU, no network, no spend.
 * This is the local/mock validation the directive calls for while a real GPU
 * host does not exist.
 */
import { describe, expect, it, vi } from "vitest";
import {
  WAN22_META,
  VEO_META,
  VACE_1_3B_META,
  VACE_1_3B_RUN,
  ANIMATED_DRAWINGS_META,
  buildVaceArgs,
  classNeedsClip,
  classifyShotMotion,
  gpuVaceBackend,
  makeVaceMotionProvider,
  motionOnlyPrompt,
  runMotion,
  selectProviderOrder,
  type MotionClip,
  type MotionDriver,
  type MotionProvider,
  type MotionRequest,
  type VaceGpuRunner,
} from "@/lib/motionProvider";

function provider(
  kind: "oss" | "premium",
  available: boolean,
  generate: (r: MotionRequest) => Promise<MotionClip>,
): MotionProvider {
  return {
    meta: kind === "oss" ? WAN22_META : VEO_META,
    available: () => available,
    generate,
  };
}

const REQ: MotionRequest = {
  sourceStillBase64: "AAAA",
  sourceMime: "image/png",
  motionPrompt: "She takes several steps through the market. Slow push in.",
  durationSeconds: 8,
  aspectRatio: "9:16",
  motionClass: "WALKING",
};

describe("classifyShotMotion — from the authored movie grammar", () => {
  it("a spoken line makes it TALKING", () => {
    expect(classifyShotMotion({ dialogue: { speaker: "Ma", line: "Come here." } })).toBe("TALKING");
    expect(classifyShotMotion({ motion: "He faces her", narration: "he says softly" })).toBe("TALKING");
  });
  it("locomotion is WALKING, gestures are GESTURE", () => {
    expect(classifyShotMotion({ motion: "She walks to the stall" })).toBe("WALKING");
    expect(classifyShotMotion({ motion: "He waves and points" })).toBe("GESTURE");
  });
  it("two-party contact is INTERACTION", () => {
    expect(classifyShotMotion({ motion: "She hands him the basket" })).toBe("INTERACTION");
  });
  it("a camera-only motion field is CAMERA_ONLY; empty is STATIC", () => {
    expect(classifyShotMotion({ motion: "Slow push in across the rooftops" })).toBe("CAMERA_ONLY");
    expect(classifyShotMotion({})).toBe("STATIC");
  });
  it("still-only classes do not need a clip; motion classes do", () => {
    expect(classNeedsClip("STATIC")).toBe(false);
    expect(classNeedsClip("CAMERA_ONLY")).toBe(false);
    for (const c of ["WALKING", "TALKING", "GESTURE", "INTERACTION", "CHARACTER_MOTION"] as const) {
      expect(classNeedsClip(c)).toBe(true);
    }
  });
});

describe("selectProviderOrder — OSS first, Veo premium/gated", () => {
  it("still-only classes select no provider (keep the existing still)", () => {
    const ps = [provider("oss", true, async () => ({ ok: false, reason: "x", provider: "w", class: "transient" }))];
    expect(selectProviderOrder("STATIC", ps, { allowPremium: true })).toEqual([]);
    expect(selectProviderOrder("CAMERA_ONLY", ps, { allowPremium: true })).toEqual([]);
  });
  it("OSS leads; premium omitted unless policy allows it", () => {
    const oss = provider("oss", true, async () => REQ_OK("wan"));
    const veo = provider("premium", true, async () => REQ_OK("veo"));
    const noVeo = selectProviderOrder("WALKING", [oss, veo], { allowPremium: false });
    expect(noVeo.map((p) => p.meta.kind)).toEqual(["oss"]);
    const withVeo = selectProviderOrder("WALKING", [oss, veo], { allowPremium: true });
    expect(withVeo.map((p) => p.meta.kind)).toEqual(["oss", "premium"]);
  });
  it("premium leads for classes named premium-worthy", () => {
    const oss = provider("oss", true, async () => REQ_OK("wan"));
    const veo = provider("premium", true, async () => REQ_OK("veo"));
    const order = selectProviderOrder("INTERACTION", [oss, veo], {
      allowPremium: true,
      premiumClasses: ["INTERACTION"],
    });
    expect(order.map((p) => p.meta.kind)).toEqual(["premium", "oss"]);
  });
  it("an unavailable engine is dropped, never started", () => {
    const oss = provider("oss", false, async () => REQ_OK("wan"));
    const veo = provider("premium", true, async () => REQ_OK("veo"));
    const order = selectProviderOrder("WALKING", [oss, veo], { allowPremium: true });
    expect(order.map((p) => p.meta.name)).toEqual([VEO_META.name]);
  });
});

function REQ_OK(name: string): MotionClip {
  return { ok: true, data: "bytes", mime: "video/mp4", seconds: 8, provider: name };
}

describe("runMotion — bounded fallback, never a still-as-clip", () => {
  it("ONE WALKING SHOT (mock): still → OSS provider → temporal clip artifact", async () => {
    // The end-to-end contract proof the directive asks for, with a mock engine
    // standing in for the GPU that is not present. A real Wan run would replace
    // only `generate`; every other line here is the production contract.
    const wanExec = vi.fn(async (r: MotionRequest): Promise<MotionClip> => {
      expect(r.motionClass).toBe("WALKING");
      expect(r.aspectRatio).toBe("9:16");
      expect(r.sourceStillBase64).toBeTruthy();
      return { ok: true, data: "MP4BYTES", mime: "video/mp4", seconds: r.durationSeconds, provider: WAN22_META.name };
    });
    const order = selectProviderOrder(
      "WALKING",
      [provider("oss", true, wanExec), provider("premium", true, async () => REQ_OK("veo"))],
      { allowPremium: true },
    );
    const { clip, tried } = await runMotion(REQ, order);
    expect(wanExec).toHaveBeenCalledOnce();
    expect(clip && clip.ok).toBe(true);
    expect(clip).toMatchObject({ ok: true, mime: "video/mp4", seconds: 8, provider: WAN22_META.name });
    expect(tried).toHaveLength(0); // OSS won first try; Veo never billed
  });

  it("OSS failure falls over to Veo (premium)", async () => {
    const wan = provider("oss", true, async () => ({
      ok: false,
      reason: "cuda oom",
      provider: WAN22_META.name,
      class: "transient" as const,
    }));
    const veo = provider("premium", true, async () => REQ_OK("veo"));
    const { clip, tried } = await runMotion(REQ, [wan, veo]);
    expect(clip).toMatchObject({ ok: true, provider: "veo" });
    expect(tried).toEqual([{ provider: WAN22_META.name, reason: "cuda oom" }]);
  });

  it("all providers fail → null clip (caller uses still/depth), never a fake PASS", async () => {
    const wan = provider("oss", true, async () => ({ ok: false, reason: "down", provider: "w", class: "transient" as const }));
    const veo = provider("premium", true, async () => {
      throw new Error("http 502 upstream");
    });
    const { clip, tried } = await runMotion(REQ, [wan, veo]);
    expect(clip).toBeNull();
    expect(tried.map((t) => t.reason)).toEqual(["down", "http 502 upstream"]);
  });

  it("provider cost/billing stay distinct (no merged 'AI cost')", () => {
    expect(VEO_META.billing).toBe("google-metered");
    expect(VEO_META.inrPerSecond).toBe(12.6);
    expect(WAN22_META.billing).toBe("gpu-compute");
    expect(WAN22_META.requiresGpu).toBe(true);
    expect(WAN22_META.inrPerSecond).toBeNull(); // measured at deploy, never guessed
  });
});

// ── PHASE 9 — L4 VACE readiness (no GPU here; contract + fail-closed) ──────────
describe("L4 VACE 1.3B — command spec + backend, fail-closed without a GPU", () => {
  const WALK: MotionDriver = {
    id: "walk_9x16",
    motionClass: "WALK",
    driverVideo: "remotion/fixtures/motion-drivers/walk_9x16.mp4",
    durationSeconds: 8,
    fps: 30,
    aspectRatio: "9:16",
    source: "x",
    license: "x",
  };

  it("min GPU config is the verified 8GB floor at native 480x832", () => {
    expect(VACE_1_3B_RUN.minVramGb).toBe(8);
    expect(VACE_1_3B_RUN.recommendedVramGb).toBe(12);
    expect(VACE_1_3B_RUN.resolution).toBe("480x832");
    expect(VACE_1_3B_META.requiresGpu).toBe(true);
  });

  it("buildVaceArgs: identity=ref image, motion=pose+prompt; NO biography param", () => {
    const args = buildVaceArgs({
      spec: VACE_1_3B_RUN,
      refImagePath: "aladdin.png",
      poseControlPath: "walk_pose.mp4",
      motionPrompt: motionOnlyPrompt("WALKING"),
      frames: 132,
      saveFile: "out.mp4",
    });
    expect(args).toEqual([
      "generate.py", "--task", "vace-1.3B", "--size", "480*832",
      "--ckpt_dir", "./models/Wan2.1-VACE-1.3B",
      "--src_ref_images", "aladdin.png", "--src_video", "walk_pose.mp4",
      "--frame_num", "132", "--prompt", "a person walking forward, natural gait, full body",
      "--save_file", "out.mp4",
    ]);
    // ACTOR ASSET ≠ PERMANENT BIOGRAPHY: the motion prompt carries movement only.
    expect(motionOnlyPrompt("WALKING")).not.toMatch(/aladdin|boy|shirt|hair|sandal|face|skin/i);
  });

  it("data path: a READY GPU runner → makeVaceMotionProvider → MotionClip (mocked, no real GPU)", async () => {
    const exec = vi.fn(async () => ({ videoPath: "/out/walk.mp4", fps: 30 }));
    const runner: VaceGpuRunner = { ready: () => true, exec };
    const provider = makeVaceMotionProvider(gpuVaceBackend(VACE_1_3B_RUN, runner), [WALK]);
    expect(provider.available()).toBe(true);
    const clip = await provider.generate({
      sourceStillBase64: "AAAA", sourceMime: "image/png", motionPrompt: "walk",
      durationSeconds: 8, aspectRatio: "9:16", motionClass: "WALKING", driverClass: "WALK",
    });
    expect(exec).toHaveBeenCalledOnce();
    expect(clip).toMatchObject({ ok: true, videoPath: "/out/walk.mp4", provider: VACE_1_3B_META.name });
  });

  it("FAIL-CLOSED: no GPU host → backend unavailable → runMotion returns null (still, never a fake clip)", async () => {
    const provider = makeVaceMotionProvider(gpuVaceBackend(VACE_1_3B_RUN, null), [WALK]);
    expect(provider.available()).toBe(false);
    // even if forced to run, it reports a permanent miss — no fabricated clip
    const clip = await provider.generate({
      sourceStillBase64: "AAAA", sourceMime: "image/png", motionPrompt: "walk",
      durationSeconds: 8, aspectRatio: "9:16", motionClass: "WALKING", driverClass: "WALK",
    });
    expect(clip.ok).toBe(false);
    const { clip: run } = await runMotion(
      { sourceStillBase64: "AAAA", sourceMime: "image/png", motionPrompt: "walk", durationSeconds: 8, aspectRatio: "9:16", motionClass: "WALKING" },
      [provider],
    );
    expect(run).toBeNull(); // caller falls to still/depth; never a torn/fake clip
  });

  it("provider ordering: CPU pose-warp (L3) leads, VACE (L4) next, Veo (L5) gated", () => {
    const wrap = (meta: typeof VEO_META): MotionProvider => ({
      meta,
      available: () => true,
      generate: async () => ({ ok: false, reason: "n/a", provider: meta.name, class: "permanent" }),
    });
    const ps = [wrap(VEO_META), wrap(VACE_1_3B_META), wrap(ANIMATED_DRAWINGS_META)];
    const names = selectProviderOrder("WALKING", ps, { allowPremium: true }).map((p) => p.meta.name);
    expect(names.indexOf(ANIMATED_DRAWINGS_META.name)).toBeLessThan(names.indexOf(VACE_1_3B_META.name));
    expect(names.indexOf(VACE_1_3B_META.name)).toBeLessThan(names.indexOf(VEO_META.name));
    // premium stays gated: dropping the flag removes Veo, keeps the OSS tiers
    const noVeo = selectProviderOrder("WALKING", ps, { allowPremium: false }).map((p) => p.meta.name);
    expect(noVeo).not.toContain(VEO_META.name);
    expect(noVeo).toContain(VACE_1_3B_META.name);
  });
});
