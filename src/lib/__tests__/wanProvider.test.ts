/**
 * WAN 2.1 I2V-14B-480P provider — additive, fail-closed, default OFF.
 *
 * The contract under test: Wan conforms to the landed provider fabric
 * WITHOUT touching it — motionProvider.ts (home of the frozen L3R reserve)
 * stays byte-identical, Veo's selection stays unchanged, and with no GPU
 * runner injected (every ONIQ environment today) Wan can never generate,
 * never be selected, and never mask the still fallback.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runMotion,
  selectProviderOrder,
  VEO_META,
  type MotionProvider,
  type MotionRequest,
} from "@/lib/motionProvider";
import {
  buildWanI2vArgs,
  makeWanI2vProvider,
  WAN21_I2V_META,
  WAN21_I2V_RUN,
  type WanGpuRunner,
} from "@/lib/wanProvider";

const REQ: MotionRequest = {
  sourceStillBase64: "aGVsbG8=",
  sourceMime: "image/png",
  motionPrompt: "walking forward along the cliff path",
  durationSeconds: 4,
  aspectRatio: "9:16",
  motionClass: "WALKING",
};

const veo = (available: boolean): MotionProvider => ({
  meta: VEO_META,
  available: () => available,
  generate: () =>
    Promise.resolve({ ok: true, data: "QUJD", mime: "video/mp4", seconds: 4, provider: VEO_META.name }),
});

describe("provider identity and recorded facts", () => {
  it("names the official model and stays honest about cost", () => {
    expect(WAN21_I2V_META.name).toBe("wan2.1-i2v-14b-480p");
    expect(WAN21_I2V_META.role).toBe("i2v");
    expect(WAN21_I2V_META.kind).toBe("oss");
    expect(WAN21_I2V_META.requiresGpu).toBe(true);
    expect(WAN21_I2V_META.billing).toBe("gpu-compute");
    // Never invented: the ₹/s is measured on a real host or stays null.
    expect(WAN21_I2V_META.inrPerSecond).toBeNull();
  });

  it("pins the official checkpoint, defaults and license evidence", () => {
    expect(WAN21_I2V_RUN.modelId).toBe("Wan-AI/Wan2.1-I2V-14B-480P");
    expect(WAN21_I2V_RUN.officialRepo).toBe("https://github.com/Wan-Video/Wan2.1");
    expect(WAN21_I2V_RUN.task).toBe("i2v-14B");
    expect(WAN21_I2V_RUN.size).toBe("832*480");
    // Official defaults: 81 frames at 16 fps ≈ 5.06s.
    expect(WAN21_I2V_RUN.frames).toBe(81);
    expect(WAN21_I2V_RUN.fps).toBe(16);
    expect(WAN21_I2V_RUN.license).toMatch(/apache-2\.0/);
  });
});

describe("default OFF — no runner means no Wan, anywhere", () => {
  it("is unavailable with no injected GPU runner", () => {
    expect(makeWanI2vProvider(null).available()).toBe(false);
  });

  it("is dropped from selection, so ordering never offers a dead engine", () => {
    const order = selectProviderOrder("WALKING", [makeWanI2vProvider(null), veo(true)], {
      allowPremium: true,
    });
    expect(order.map((p) => p.meta.name)).toEqual([VEO_META.name]);
  });

  it("generate() without a runner misses fail-closed, naming the gate", async () => {
    const out = await makeWanI2vProvider(null).generate(REQ);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.class).toBe("permanent");
      expect(out.reason).toMatch(/GPU host/);
    }
  });

  it("runMotion falls through to the caller's still fallback", async () => {
    const { clip, tried } = await runMotion(REQ, [makeWanI2vProvider(null)].filter((p) => p.available()));
    expect(clip).toBeNull();
    expect(tried).toEqual([]);
  });
});

describe("additive beside Veo — never a silent replacement", () => {
  const readyRunner: WanGpuRunner = {
    ready: () => true,
    exec: (args) =>
      Promise.resolve({ videoPath: `out://${args[args.indexOf("--base_seed") + 1]}.mp4`, seconds: 5.06, fps: 16 }),
  };

  it("an available Wan leads the OSS tier; premium Veo stays appended", () => {
    const order = selectProviderOrder("WALKING", [makeWanI2vProvider(readyRunner), veo(true)], {
      allowPremium: true,
    });
    expect(order.map((p) => p.meta.name)).toEqual([WAN21_I2V_META.name, VEO_META.name]);
  });

  it("with premium disallowed, Veo is absent and Wan alone serves", () => {
    const order = selectProviderOrder("WALKING", [makeWanI2vProvider(readyRunner), veo(true)], {
      allowPremium: false,
    });
    expect(order.map((p) => p.meta.name)).toEqual([WAN21_I2V_META.name]);
  });

  it("a ready runner produces a real file-backed clip with the provider named", async () => {
    const out = await makeWanI2vProvider(readyRunner, { seed: 7 }).generate(REQ);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.videoPath).toBe("out://7.mp4");
      expect(out.provider).toBe(WAN21_I2V_META.name);
      expect(out.seconds).toBeCloseTo(5.06);
      // A file path, never inline fabricated bytes.
      expect(out.data).toBeUndefined();
    }
  });

  it("a runner exception surfaces as a structured transient miss", async () => {
    const boom: WanGpuRunner = {
      ready: () => true,
      exec: () => Promise.reject(new Error("CUDA out of memory")),
    };
    const out = await makeWanI2vProvider(boom).generate(REQ);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.class).toBe("transient");
      expect(out.reason).toMatch(/CUDA out of memory/);
    }
  });
});

describe("the exact official invocation, versioned", () => {
  it("builds the generate.py argv with seed, frames and offload recorded", () => {
    const args = buildWanI2vArgs({
      spec: WAN21_I2V_RUN,
      imagePath: "/host/still.png",
      motionPrompt: "a person walking forward, natural gait, full body",
      seed: 20260822,
      saveFile: "/host/out.mp4",
      offload: true,
    });
    expect(args).toEqual([
      "generate.py",
      "--task", "i2v-14B",
      "--size", "832*480",
      "--ckpt_dir", "./models/Wan2.1-I2V-14B-480P",
      "--image", "/host/still.png",
      "--prompt", "a person walking forward, natural gait, full body",
      "--frame_num", "81",
      "--base_seed", "20260822",
      "--save_file", "/host/out.mp4",
      "--offload_model", "True",
    ]);
  });

  it("the provider's own prompt is movement-only — no identity words", () => {
    // ACTOR ASSET ≠ PERMANENT BIOGRAPHY: the still carries identity; the
    // prompt may only describe movement.
    const args = buildWanI2vArgs({
      spec: WAN21_I2V_RUN,
      imagePath: "x",
      motionPrompt: "a person walking forward, natural gait, full body",
      seed: 1,
      saveFile: "y",
    });
    const prompt = args[args.indexOf("--prompt") + 1];
    expect(prompt).not.toMatch(/\b(man|woman|boy|girl|old|young|ethnic|indian|asian|african|european)\b/i);
  });
});

describe("the GPU-day harness mirrors the provider and the validator", () => {
  // remotion/scripts/wan_i2v_reference.py is what the provisioned GPU host
  // actually runs. If it drifts from the provider's argv or the worker's
  // aliveness gate, the benchmark stops measuring what production would do —
  // so the constants are pinned here, where drift fails the build.
  const harness = readFileSync(
    join(process.cwd(), "remotion/scripts/wan_i2v_reference.py"),
    "utf8",
  );

  it("runs the provider's exact configuration", () => {
    expect(harness).toMatch(/MODEL_ID = "Wan-AI\/Wan2\.1-I2V-14B-480P"/);
    expect(harness).toMatch(/TASK = "i2v-14B"/);
    expect(harness).toMatch(/SIZE = "832\*480"/);
    expect(harness).toMatch(/FRAME_NUM = 81/);
    expect(harness).toMatch(/FPS = 16/);
    expect(harness).toMatch(/"--offload_model", "True"/);
    expect(harness).toMatch(/"--base_seed", str\(a\.seed\)/);
  });

  it("applies the worker's aliveness gate, unweakened", () => {
    expect(harness).toMatch(/ALIVENESS_MIN = 0\.75/);
    expect(harness).toMatch(/0\.2126 \* a\[i\] \+ 0\.7152 \* a\[i \+ 1\] \+ 0\.0722 \* a\[i \+ 2\]/);
    expect(harness).toMatch(/STATIC_REJECTED/);
    // Aliveness alone is never the motion verdict — the human review is.
    expect(harness).toMatch(/ALIVE_PENDING_PIXEL_REVIEW/);
    expect(harness).not.toMatch(/CHARACTER_MOVED"?\s*[:=]\s*(true|True)/);
  });
});

describe("Wan is additive — the frozen modules are untouched", () => {
  it("motionProvider.ts (L3R's home) carries no Wan2.1-I2V code", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/motionProvider.ts"), "utf8");
    expect(src).not.toMatch(/i2v-14b|Wan2\.1-I2V/i);
  });

  it("the worker's clip stage still speaks only to story-clip (Veo)", () => {
    const worker = readFileSync(
      join(process.cwd(), "remotion/scripts/story-worker.mjs"),
      "utf8",
    );
    expect(worker).not.toMatch(/wanProvider|wan2\.1/i);
    expect(worker).toMatch(/edge\('story-clip'/);
  });
});
