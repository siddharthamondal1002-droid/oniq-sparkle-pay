/**
 * ARAP L3 CPU provider — the zero-GPU pose-warp tier, proven additive
 * WITHOUT touching anything: motionProvider.ts (home of the frozen L3R
 * reserve) stays byte-identical, Veo's selection stays unchanged, and with
 * no CPU runner injected (every ONIQ environment today) ARAP can never
 * generate, never be selected, and never mask the still fallback. The
 * grammar is evidence-gated: only real-pixel-passed motions exist in it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  runMotion,
  selectProviderOrder,
  VEO_META,
  type MotionProvider,
  type MotionRequest,
} from "@/lib/motionProvider";
import {
  ARAP_ELIGIBILITY,
  ARAP_L3_META,
  ARAP_L3_RUN,
  ARAP_MOTION_GRAMMAR,
  arapCharacterEligible,
  buildArapRenderArgs,
  makeArapL3Provider,
  type ArapCpuRunner,
} from "@/lib/arapProvider";

const REQ: MotionRequest = {
  sourceStillBase64: "aGVsbG8=",
  sourceMime: "image/png",
  motionPrompt: "walking forward through the bazaar",
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
  it("is CPU-only OSS pose-warp and stays honest about cost", () => {
    expect(ARAP_L3_META.name).toBe("arap-l3-armdamped");
    expect(ARAP_L3_META.kind).toBe("oss");
    expect(ARAP_L3_META.role).toBe("pose-warp");
    expect(ARAP_L3_META.requiresGpu).toBe(false);
    expect(ARAP_L3_META.billing).toBe("cpu-runner");
    // CPU-runner seconds are the cost; a rupee figure is priced at deploy.
    expect(ARAP_L3_META.inrPerSecond).toBeNull();
  });

  it("pins the MIT license and the measured recipe", () => {
    expect(ARAP_L3_RUN.license).toBe(
      "MIT (Animated Drawings code and drawn-humanoid weights — official repo)",
    );
    expect(ARAP_L3_RUN.officialRepo).toBe("https://github.com/facebookresearch/AnimatedDrawings");
    expect(ARAP_L3_RUN.retargetConfig).toBe("remotion/scripts/retarget_armdamped_reference.yaml");
    expect(ARAP_L3_RUN.mask).toBe("rembg-u2netp");
    expect(ARAP_L3_RUN.numpyPin).toBe("1.26.4");
    expect(ARAP_L3_RUN.env).toEqual({ PYOPENGL_PLATFORM: "osmesa", MESA_GL_VERSION_OVERRIDE: "3.3" });
  });

  it("the grammar carries ONLY pixel-proven motion (WALKING today)", () => {
    expect(Object.keys(ARAP_MOTION_GRAMMAR)).toEqual(["WALKING"]);
    expect(ARAP_MOTION_GRAMMAR.WALKING).toBe("examples/bvh/fair1/zombie.bvh");
  });
});

describe("the exact runner argv", () => {
  it("builds the reference-runner command verbatim", () => {
    expect(
      buildArapRenderArgs({
        spec: ARAP_L3_RUN,
        adDir: "/host/AnimatedDrawings",
        charDir: "/host/rigs/aladdin",
        motionCfg: "/host/motion/zombie.yaml",
        outPath: "/host/out/shot7.gif",
      }),
    ).toEqual([
      "python3",
      "remotion/scripts/l3_animate_reference.py",
      "/host/AnimatedDrawings",
      "/host/rigs/aladdin",
      "/host/motion/zombie.yaml",
      "remotion/scripts/retarget_armdamped_reference.yaml",
      "/host/out/shot7.gif",
    ]);
  });
});

describe("fail-closed without a provisioned CPU runner", () => {
  it("null runner: unavailable, and generate is a structured permanent miss", async () => {
    const p = makeArapL3Provider(null);
    expect(p.available()).toBe(false);
    const out = await p.generate(REQ);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.class).toBe("permanent");
      expect(out.reason).toMatch(/no CPU runner/);
    }
  });

  it("a runner that is not ready is never executed", async () => {
    const exec = vi.fn();
    const p = makeArapL3Provider({ ready: () => false, exec });
    expect(p.available()).toBe(false);
    const out = await p.generate(REQ);
    expect(out.ok).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("an unproven motion class misses WITHOUT touching the runner", async () => {
    const exec = vi.fn();
    const p = makeArapL3Provider({ ready: () => true, exec });
    const out = await p.generate({ ...REQ, motionClass: "GESTURE" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.class).toBe("permanent");
      expect(out.reason).toMatch(/evidence-gated/);
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it("a runner exception surfaces as a structured transient miss", async () => {
    const boom: ArapCpuRunner = {
      ready: () => true,
      exec: () => Promise.reject(new Error("OSMesa context creation failed")),
    };
    const out = await makeArapL3Provider(boom).generate(REQ);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.class).toBe("transient");
      expect(out.reason).toMatch(/OSMesa context creation failed/);
    }
  });
});

describe("additive beside Veo — never a silent replacement", () => {
  const readyRunner: ArapCpuRunner = {
    ready: () => true,
    exec: () => Promise.resolve({ videoPath: "out://arap.mp4", seconds: 12.5, fps: 16 }),
  };

  it("an available ARAP leads the OSS tier; premium Veo stays appended", () => {
    const order = selectProviderOrder("WALKING", [makeArapL3Provider(readyRunner), veo(true)], {
      allowPremium: true,
    });
    expect(order.map((p) => p.meta.name)).toEqual([ARAP_L3_META.name, VEO_META.name]);
  });

  it("with premium disallowed, Veo is absent and ARAP alone serves", () => {
    const order = selectProviderOrder("WALKING", [makeArapL3Provider(readyRunner), veo(true)], {
      allowPremium: false,
    });
    expect(order.map((p) => p.meta.name)).toEqual([ARAP_L3_META.name]);
  });

  it("with no runner the order is exactly what it was before ARAP existed", () => {
    const order = selectProviderOrder("WALKING", [makeArapL3Provider(null), veo(true)], {
      allowPremium: true,
    });
    expect(order.map((p) => p.meta.name)).toEqual([VEO_META.name]);
  });

  it("a ready runner produces a real file-backed clip with the provider named", async () => {
    const out = await makeArapL3Provider(readyRunner).generate(REQ);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.videoPath).toBe("out://arap.mp4");
      expect(out.provider).toBe(ARAP_L3_META.name);
      expect(out.seconds).toBeCloseTo(12.5);
      // A file path, never inline fabricated bytes.
      expect(out.data).toBeUndefined();
    }
  });
});

describe("separation pins — nothing existing moves", () => {
  it("motionProvider.ts (L3R's home) carries no ARAP-provider code", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/motionProvider.ts"), "utf8");
    expect(src).not.toMatch(/arapProvider|arap-l3/i);
  });

  it("the worker has no ARAP path — the provider is default OFF everywhere", () => {
    const worker = readFileSync(
      join(process.cwd(), "remotion/scripts/story-worker.mjs"),
      "utf8",
    );
    expect(worker).not.toMatch(/arapProvider|arap-l3/i);
    expect(worker).toMatch(/edge\('story-clip'/);
  });
});

describe("chaos — every breakage ends on the still path, film still renderable", () => {
  it("broken runner + unavailable Veo: no clip, reasons recorded, caller falls back", async () => {
    const broken: ArapCpuRunner = {
      ready: () => true,
      exec: () => Promise.reject(new Error("render segfault")),
    };
    const order = selectProviderOrder("WALKING", [makeArapL3Provider(broken), veo(false)], {
      allowPremium: true,
    });
    const { clip, tried } = await runMotion(REQ, order);
    expect(clip).toBeNull(); // the worker keeps the still/parallax renderer
    expect(tried).toEqual([
      { provider: ARAP_L3_META.name, reason: expect.stringMatching(/render segfault/) },
    ]);
  });

  it("no providers at all: the order is empty and nothing is attempted", async () => {
    const order = selectProviderOrder("WALKING", [makeArapL3Provider(null), veo(false)], {
      allowPremium: false,
    });
    expect(order).toEqual([]);
    const { clip, tried } = await runMotion(REQ, order);
    expect(clip).toBeNull();
    expect(tried).toEqual([]);
  });
});

describe("character eligibility — the measured 6-character corpus verbatim", () => {
  // Real 2026-08-22 measurements: bbox fill % of the rembg mask, and which
  // skeleton joints the auto-rig localized outside the silhouette.
  const CORPUS = [
    { name: "aladdin_hand", fill: 57.0, outside: ["left_elbow"], walked: true },
    { name: "aladdin_auto", fill: 57.0, outside: ["right_hand"], walked: true },
    { name: "morgiana", fill: 51.7, outside: [], walked: true },
    { name: "mother", fill: 74.8, outside: [], walked: false },
    { name: "fisherman", fill: 53.4, outside: ["left_shoulder", "left_foot"], walked: false },
    { name: "lampJinni", fill: 67.3, outside: [], walked: false },
  ];

  it("admits every measured clean walk and rejects every measured collapse", () => {
    for (const c of CORPUS) {
      const v = arapCharacterEligible({ bboxFillPct: c.fill, jointsOutsideMask: c.outside });
      expect(v.eligible, c.name).toBe(c.walked);
    }
  });

  it("an elbow or hand grazing outside the mask is not a rejection", () => {
    const v = arapCharacterEligible({
      bboxFillPct: 55,
      jointsOutsideMask: ["left_elbow", "right_hand"],
    });
    expect(v.eligible).toBe(true);
  });

  it("names the reason classes so the fallback log says WHY", () => {
    const blob = arapCharacterEligible({ bboxFillPct: 80, jointsOutsideMask: [] });
    expect(blob.reasons[0]).toMatch(/merged blob/);
    const joints = arapCharacterEligible({ bboxFillPct: 50, jointsOutsideMask: ["right_knee"] });
    expect(joints.reasons[0]).toMatch(/core joints off the silhouette/);
  });

  it("pins the provisional thresholds so a drift is a decision, not an accident", () => {
    expect(ARAP_ELIGIBILITY.maxBboxFillPct).toBe(65);
    expect(ARAP_ELIGIBILITY.coreJoints).toEqual(["shoulder", "hip", "knee", "foot"]);
  });
});

describe("the committed retarget config IS the measured one", () => {
  const cfg = readFileSync(
    join(process.cwd(), "remotion/scripts/retarget_armdamped_reference.yaml"),
    "utf8",
  );

  it("drives all four elbow/hand joints with the DOWNWARD trunk vector", () => {
    for (const joint of ["left_elbow", "left_hand", "right_elbow", "right_hand"]) {
      const m = cfg.match(
        new RegExp(`  ${joint}: !!python/tuple\\n  - (\\w+)\\n  - (\\w+)`),
      );
      expect(m, joint).not.toBeNull();
      // (from, to) = (Spine3, Hips): the vector points DOWN the trunk so the
      // arms hang. The reversed tuple is the recorded folded-character failure.
      expect([m![1], m![2]], joint).toEqual(["Spine3", "Hips"]);
    }
  });

  it("leaves the legs on their true BVH bones (the gait is untouched)", () => {
    expect(cfg).toMatch(/left_knee: !!python\/tuple\n  - LeftUpLeg\n  - LeftLeg/);
    expect(cfg).toMatch(/right_foot: !!python\/tuple\n  - RightLeg\n  - RightFoot/);
  });
});
