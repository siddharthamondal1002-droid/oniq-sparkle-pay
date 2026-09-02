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

describe("determinism is claimed where it actually holds", () => {
  // The reference container renders on an Ubuntu Mesa; the image is built on
  // Debian bookworm and carries a different one, and a different software
  // rasteriser may legitimately produce different pixels. Asserting the
  // image's bytes against the native figure would read that difference as a
  // defect. So the gate is two renders INSIDE the image.
  const benchmark = readFileSync(join(root, "runtime/arap-cpu/proofs/benchmark.py"), "utf8");
  const entrypoint = readFileSync(join(root, "runtime/arap-cpu/entrypoint.sh"), "utf8");

  it("renders twice and compares, rather than trusting one run", () => {
    expect(benchmark).toContain("ONIQ_ARAP_DETERMINISM");
    expect(benchmark).toContain("second render");
    expect(benchmark).toContain("produced different bytes");
  });

  it("the proofs entrypoint turns that second pass on", () => {
    expect(entrypoint).toContain("ONIQ_ARAP_DETERMINISM=1");
  });

  it("pins.json scopes the native byte-identity claim to its own host", () => {
    const scope = (pins.validation.env_b_render as unknown as { byte_identity_scope: string })
      .byte_identity_scope;
    expect(scope).toMatch(/WITHIN-HOST/);
  });

  it("wall-clock is recorded as a range, not a single number to match", () => {
    const runs = (
      pins.validation.env_b_render as unknown as {
        render_seconds_observed: { runs: number[] };
      }
    ).render_seconds_observed.runs;
    expect(runs.length).toBeGreaterThanOrEqual(3);
    // The spread is the point: a gate on any single figure would be noise.
    expect(Math.max(...runs) - Math.min(...runs)).toBeGreaterThan(10);
  });
});

describe("the evidence that leaves CI is the evidence that passed", () => {
  const workflow = readFileSync(join(root, ".github/workflows/arap-runtime-publish.yml"), "utf8");

  it("runs the proofs against a mounted volume", () => {
    // Unmounted, `proofs` rendered into a container filesystem that was
    // discarded and a SEPARATE run produced the uploaded clip — so the
    // downloadable artifact was never the one anything passed on.
    const proofsStep = workflow.slice(
      workflow.indexOf("Every proof in the image"),
      workflow.indexOf("The torch pin state"),
    );
    expect(proofsStep).toContain("/out:/work");
    expect(proofsStep).toContain("proofs /work/benchmark.gif");
    expect(proofsStep).toContain("test -s out/benchmark.gif");
    expect(proofsStep).toContain("test -s out/benchmark.json");
  });

  it("never swallows a benchmark failure", () => {
    // The step this replaced ended `|| true`, which would have hidden the
    // EACCES a uid-10001 write into a runner-owned mount produces.
    // Comment lines excluded: the step's own comment EXPLAINS why `|| true`
    // is wrong here, and a naive line scan fails on that explanation.
    const benchLines = workflow
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .filter((l) => l.includes("benchmark") && l.includes("|| true"));
    expect(benchLines).toEqual([]);
    expect(workflow).toContain("chmod 0777 out");
  });

  it("the benchmark records what the gate asks it to record", () => {
    const bench = readFileSync(join(root, "runtime/arap-cpu/proofs/benchmark.py"), "utf8");
    for (const field of ["max_rss_mb", "render_seconds", "output_sha256", '"gl"']) {
      expect(bench, field).toContain(field);
    }
    expect(bench).toContain('OUT.with_suffix(".json")');
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
    // This used to pin a fixed list of stages as PENDING, and it correctly
    // FAILED when a build actually proved them. A frozen list makes real
    // progress look like a regression. What must not drift is the HONESTY,
    // so that is what is asserted.
    expect(pins.validation.env_b_render.status).toBe("PASS");

    // No status may be blank or free-form: it starts PASS, PENDING, BLOCKED
    // or INFORMATIONAL, so "what state is this in" is always answerable.
    for (const [key, entry] of Object.entries(pins.validation)) {
      if (key.startsWith("$")) continue;
      expect(entry.status, key).toMatch(/^(PASS|PENDING|BLOCKED|INFORMATIONAL)\b/);
    }

    // A PASS must carry evidence. Anything claiming PASS names the run that
    // produced it or the measurements it rests on — never the word alone.
    for (const [key, entry] of Object.entries(pins.validation)) {
      if (key.startsWith("$") || !entry.status.startsWith("PASS")) continue;
      const e = entry as unknown as Record<string, unknown>;
      const hasEvidence =
        Boolean(e.run) || Boolean(e.measured) || Boolean(e.proved) || Boolean(e.where);
      expect(hasEvidence, `${key} claims PASS without naming its evidence`).toBe(true);
    }
  });

  it("the validated stages cannot quietly regress to PENDING", () => {
    // The runtime-validation gate is closed on measured results from a real
    // build. If someone reopens it by blanking these back to PENDING, or by
    // dropping the figures that justify the PASS, this fails rather than the
    // record silently softening.
    const bench = pins.validation.benchmark_in_image as unknown as {
      status: string;
      run?: string;
      digest?: string;
      measured?: Record<string, unknown>;
    };
    expect(bench.status).toBe("PASS");
    expect(bench.run).toBeTruthy();
    expect(bench.digest).toMatch(/@sha256:[0-9a-f]{64}$/);
    for (const field of [
      "render_seconds",
      "wall_seconds",
      "max_rss_mb",
      "gif_frames",
      "frame_size",
      "output_bytes",
      "output_sha256",
      "foreground_fraction_mean",
      "interframe_mean_abs_diff",
      "static_frames",
      "gif_frames_per_render_second",
      "gl_version",
      "gl_renderer",
    ]) {
      expect(bench.measured?.[field], `benchmark is missing ${field}`).toBeDefined();
    }
    // A truncated display value is not a measurement.
    expect(bench.measured?.output_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bench.measured?.static_frames).toBe(0);

    const det = pins.validation.in_image_determinism as unknown as {
      status: string;
      scope: string;
      not_asserted: string;
    };
    expect(det.status).toBe("PASS");
    // The scope is the whole point: two renders in the SAME image.
    expect(det.scope).toMatch(/WITHIN-IMAGE/);
    expect(det.scope).toMatch(/TWICE/);
    // And cross-host byte identity must never become a requirement.
    expect(det.not_asserted).toMatch(/Cross-host byte identity is NOT a requirement/);
  });

  it("keeps wall-clock out of the correctness gate", () => {
    // The performance gate is throughput with a floor of 0.5
    // gif-frames/render-second, measured at 4.36. Seconds are recorded.
    const bench = readFileSync(join(root, "runtime/arap-cpu/proofs/benchmark.py"), "utf8");
    expect(bench).toContain("MIN_GIF_FPS = 0.5");
    expect(bench).not.toContain("MIN_RENDER_SECONDS");
    const ref = pins.validation.reference_comparison as unknown as {
      status: string;
      recorded_not_asserted: Record<string, string>;
    };
    expect(ref.status).toMatch(/^INFORMATIONAL/);
    expect(Object.keys(ref.recorded_not_asserted)).toContain("render_seconds");
    expect(Object.keys(ref.recorded_not_asserted)).toContain("output_sha256");
  });
});
