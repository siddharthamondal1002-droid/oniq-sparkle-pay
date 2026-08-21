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
  classNeedsClip,
  classifyShotMotion,
  runMotion,
  selectProviderOrder,
  type MotionClip,
  type MotionProvider,
  type MotionRequest,
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
