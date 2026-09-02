/**
 * The runtime image and the routing code must describe the SAME stack.
 *
 * `runtime/arap-cpu/pins.json` is the single source of truth for what the
 * ARAP CPU image installs and bakes; `arapProvider.ts`'s ARAP_L3_RUN is the
 * spec the routing code commits to. They were written apart and they can
 * drift apart — a numpy bump in the image, a renamed retarget config, a
 * silently substituted torch — and every one of those drifts is invisible
 * until a render comes out wrong on a host nobody can reach.
 *
 * So the agreement is a test rather than a convention. Nothing here builds,
 * downloads or renders: it reads two files and compares them.
 *
 * It also pins the SEPARATION the owner directive of 2026-09-02 asked for.
 * The image is a standalone artifact and story-worker.yml is deliberately
 * untouched, so "story-worker.yml declares no container" is asserted here.
 * Wiring the worker to this runtime is a decision, and this test makes it a
 * decision somebody has to take on purpose.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ARAP_L3_RUN } from "../arapProvider";

const root = process.cwd();
const pins = JSON.parse(readFileSync(join(root, "runtime/arap-cpu/pins.json"), "utf8")) as {
  envs: {
    autorig: {
      numpy: string;
      torch: {
        spec: string;
        index_url: string;
        cpu_only: boolean;
        hash_pin_status: string;
        wheels: Record<string, { sha256: string | null; version: string }>;
      };
    };
    arap: { freeze: Record<string, string> };
  };
  system: { gl_env: Record<string, string> };
  source: { animated_drawings: { repo: string; commit: string; license: string } };
  assets: Record<string, { url: string; sha256: string; bytes: number; license: string }>;
  validation: Record<string, { status: string }>;
};
const dockerfile = readFileSync(join(root, "runtime/arap-cpu/Dockerfile"), "utf8");

describe("pins.json agrees with the ARAP provider spec", () => {
  it("names the same Animated Drawings repository", () => {
    expect(pins.source.animated_drawings.repo).toBe(ARAP_L3_RUN.officialRepo);
  });

  it("pins the numpy the retarget stack needs", () => {
    // np.bool8 is gone in numpy 2 and AD's retarget uses it. The provider
    // records the pin; the image has to install exactly that.
    expect(pins.envs.arap.freeze.numpy).toBe(ARAP_L3_RUN.numpyPin);
  });

  it("sets the same headless GL environment", () => {
    expect(pins.system.gl_env.PYOPENGL_PLATFORM).toBe(ARAP_L3_RUN.env.PYOPENGL_PLATFORM);
    expect(pins.system.gl_env.MESA_GL_VERSION_OVERRIDE).toBe(
      ARAP_L3_RUN.env.MESA_GL_VERSION_OVERRIDE,
    );
  });

  it("bakes the mask model the provider calls mandatory", () => {
    expect(ARAP_L3_RUN.mask).toBe("rembg-u2netp");
    expect(pins.assets["u2netp.onnx"].url).toContain("u2netp.onnx");
  });

  it("ships the three scripts the provider's argv names", () => {
    for (const script of [ARAP_L3_RUN.runner, ARAP_L3_RUN.retargetConfig, ARAP_L3_RUN.autorig]) {
      expect(dockerfile).toContain(script);
    }
  });
});

describe("every baked asset is pinned, licensed and checkable", () => {
  it("hashes are 64 hex characters and byte counts are real", () => {
    const names = Object.keys(pins.assets).filter((k) => !k.startsWith("$"));
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) {
      const a = pins.assets[name];
      expect(a.sha256, `${name} sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(a.bytes, `${name} bytes`).toBeGreaterThan(0);
      expect(a.license, `${name} licence`).toBeTruthy();
      expect(a.url, `${name} url`).toMatch(/^https:\/\//);
    }
  });

  it("the Dockerfile verifies each download before unpacking it", () => {
    // A hash that is recorded but never compared is documentation, not a
    // control. The build must read pins.json and refuse a mismatch.
    expect(dockerfile).toContain("sha256sum");
    expect(dockerfile).toContain("FAIL sha256 mismatch");
    expect(dockerfile).toContain("pins.json");
  });
});

describe("torch is CPU-only, and cannot silently become the CUDA build", () => {
  it("pins the +cpu local version from PyTorch's own index", () => {
    expect(pins.envs.autorig.torch.spec).toBe("torch==1.13.1+cpu");
    expect(pins.envs.autorig.torch.index_url).toBe("https://download.pytorch.org/whl/cpu");
    expect(pins.envs.autorig.torch.cpu_only).toBe(true);
  });

  it("the Dockerfile stops rather than falling back to PyPI", () => {
    // PyPI holds no +cpu local version for 1.13.1 — only the 887 MB CUDA
    // wheel — so `--index-url` (not `--extra-index-url`) plus the `+cpu`
    // specifier is what makes a substitution impossible rather than
    // merely discouraged.
    expect(dockerfile).toContain("torch==1.13.1+cpu");
    expect(dockerfile).toContain("--index-url https://download.pytorch.org/whl/cpu");
    // Comment lines are excluded on purpose: the header EXPLAINS why
    // --extra-index-url is wrong here, and a naive whole-file grep would
    // fail on its own explanation.
    const instructions = dockerfile.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    expect(instructions.join("\n")).not.toContain("--extra-index-url");
    expect(dockerfile).toContain(
      "BLOCKED: torch 1.13.1 CPU artifact unavailable from permitted source",
    );
  });

  it("asserts at build time that no CUDA came with it", () => {
    expect(dockerfile).toContain("torch.version.cuda is None");
  });
});

describe("torch is the one asset that could not be hashed in advance", () => {
  // download.pytorch.org is 403 CONNECT from the container that authored
  // this build, so torch's wheels could not be streamed and hashed the way
  // the .mar models were. The build closes that with pip's own report:
  // record on the first build, enforce after. These tests hold the contract
  // so the "record" half cannot quietly become permanent.
  const wheels = pins.envs.autorig.torch.wheels;

  it("names the wheels it intends to pin", () => {
    expect(Object.keys(wheels).sort()).toEqual(["torch", "torchvision"]);
    expect(wheels.torch.version).toBe("1.13.1+cpu");
    expect(wheels.torchvision.version).toBe("0.14.1+cpu");
  });

  it("any recorded hash is a real sha256, never a placeholder", () => {
    for (const [name, w] of Object.entries(wheels)) {
      if (w.sha256 !== null) {
        expect(w.sha256, `${name} sha256`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("the status agrees with whether hashes are actually present", () => {
    const locked = Object.values(wheels).every((w) => w.sha256 !== null);
    expect(pins.envs.autorig.torch.hash_pin_status).toBe(
      locked ? "ENFORCED" : "RECORD_ON_FIRST_BUILD",
    );
  });

  it("the build asks pip for the hashes and checks them", () => {
    expect(dockerfile).toContain("--report /opt/oniq/torch-report.json");
    expect(dockerfile).toContain("verify_torch_pins.py");
  });
});

describe("the two environments stay separate", () => {
  it("pins a different numpy in each, which is why they are two", () => {
    expect(pins.envs.autorig.numpy).not.toBe(pins.envs.arap.freeze.numpy);
  });

  it("keeps torch out of the render environment", () => {
    expect(Object.keys(pins.envs.arap.freeze)).not.toContain("torch");
  });
});

describe("the image is not in production yet", () => {
  it("story-worker.yml declares no container", () => {
    // OWNER DIRECTIVE 2026-09-02: build and validate the runtime as a
    // standalone artifact FIRST. If this ever fails, someone has pointed
    // the worker at a runtime image — which is a real decision and should
    // come with the digest, the benchmark and a deliberate edit to this
    // test, not arrive as a side effect.
    const wf = readFileSync(join(root, ".github/workflows/story-worker.yml"), "utf8");
    expect(wf).not.toMatch(/^\s{4,}container:/m);
  });

  it("records honestly what has been proven and what has not", () => {
    expect(pins.validation.env_b_render.status).toBe("PASS");
    for (const key of ["env_a_stack", "image_build", "benchmark_200_frame", "torch_hash_pin"]) {
      expect(pins.validation[key].status, key).toMatch(/^PENDING/);
    }
  });
});
