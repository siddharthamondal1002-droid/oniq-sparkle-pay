// The UI→GPU wiring, proved without a credential or a cent (superloop
// phase 15). Behavior tests run the pure decision core in gpuVideoFlow.ts;
// where the guarantee lives in transport or SQL — fail-closed custody, the
// idempotency unique index, the player — the test reads the source, the
// same way storyReaper and callMediaWiring pin their wiring.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GPU_JOB_CAP_USD, admitGpuJob } from "../../../supabase/functions/_shared/gpuJob.ts";
import {
  GPU_VIDEO_PRICE_GATE,
  LAUNCH,
  MAX_PROMPT_CHARS,
  STAGED_REFERENCES,
  TARGET_GPU_ID,
  TERMINAL_STATUSES,
  UI_LABELS,
  WATCHDOG_SECONDS,
  admitGeneration,
  buildWorkerPayload,
  idempotentReuse,
  outputRefFor,
  statusFromPoll,
  validateRequest,
  verifyStoredArtifact,
  verifyWorkerOutput,
  watchdogExpired,
  watermarkVerdict,
  type JobStatus,
} from "@/lib/gpuVideoFlow";
import { VIDEO_PROVIDERS, selectVideoProvider } from "@/lib/videoProvider.server";
import { stripComments, stripSqlComments } from "@/test/sourceText";

const ROOT = process.cwd();
const SERVER_SRC = readFileSync(join(ROOT, "src/lib/gpuVideo.server.ts"), "utf8");
const FUNCTIONS_SRC = readFileSync(join(ROOT, "src/lib/gpuVideo.functions.ts"), "utf8");
const ROUTE_SRC = readFileSync(
  join(ROOT, "src/routes/_authenticated/app.admin_.gpu-video.tsx"),
  "utf8",
);
const MIGRATION_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260826090000_gpu_video_jobs.sql"),
  "utf8",
);

const A_REQUEST = {
  prompt: "The character slowly turns toward the camera and smiles.",
  referenceId: "reference-001",
  idempotencyKey: "11111111-2222-3333-4444-555555555555",
  audio: "off" as const,
};

/**
 * The measured run #39 worker output, as a fixture shape. Every number is
 * that run's; gpu_name is the one field retargeted since — the owner moved
 * the endpoint to the A5000 (2026-08-26), so this is what a good output
 * names today.
 */
function goodWorkerOutput(): Record<string, unknown> {
  return {
    ok: true,
    device: "cuda",
    gpu_name: "NVIDIA RTX A5000",
    model: "Lightricks/LTX-Video",
    model_load_ms: 8900,
    inference_ms: 25700,
    frames: 97,
    video_seconds: 4.04,
    output_bytes: 330061,
  };
}

/** Bytes whose 4..8 spell "ftyp", like every real MP4. */
function mp4Bytes(total: number): Uint8Array {
  const b = new Uint8Array(total);
  b.set([0x66, 0x74, 0x79, 0x70], 4);
  return b;
}

// 1 ------------------------------------------------------- provider selection
describe("provider selection", () => {
  it("the tool runs on the launch decision: in-house primary, LTX 2B, A5000", () => {
    expect(LAUNCH.provider).toBe("in_house");
    expect(LAUNCH.model).toBe("LTX_VIDEO_2B");
    expect(LAUNCH.gpu).toBe("RTX_A5000");
    expect(selectVideoProvider()).toBe(VIDEO_PROVIDERS.in_house);
  });
});

// 2 ------------------------------------------- server-side infrastructure control
describe("server-side infrastructure control", () => {
  it("the worker payload carries no provider, GPU, budget or bucket choice", () => {
    const payload = buildWorkerPayload(A_REQUEST, "job-1");
    expect(Object.keys(payload)).toEqual(["input"]);
    expect(Object.keys(payload.input).sort()).toEqual(["input_key", "op", "output_key", "params"]);
    // params is the prompt plus the SERVER-derived watermark entitlement
    // and nothing else — no runtime, no model, no size.
    expect(Object.keys(payload.input.params).sort()).toEqual(["prompt", "watermark"]);
    // The default is the marked product; only the server's deliberate
    // noWatermark=true produces a clean export request.
    expect(payload.input.params.watermark).toBe(true);
    expect(buildWorkerPayload(A_REQUEST, "job-1", true).input.params.watermark).toBe(false);
  });

  it("client-reachable files hold no secret reads and no secret names", () => {
    // The route's not-configured alert may NAME the missing variables — the
    // server's own rule ("the name is operator information; no value ever
    // is"). What client files must never do is READ an env var or mention a
    // key-bearing name at all.
    for (const src of [FUNCTIONS_SRC, ROUTE_SRC]) {
      expect(src).not.toContain("process.env");
      expect(src).not.toMatch(/R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|AWS_ACCESS|AWS_SECRET/);
    }
    // The route talks only to server functions — never to the providers.
    expect(ROUTE_SRC).not.toMatch(/runpod\.(io|ai)|r2\.dev/);
  });

  it("secrets are read in the server module only, and only by name", () => {
    expect(SERVER_SRC).toContain("envOrThrow");
    // The error path names the VARIABLE, never interpolates its value.
    expect(SERVER_SRC).toContain("not configured (${name} unset)");
  });
});

// 3 ------------------------------------------------------------ submit request
describe("submit request", () => {
  it("assembles the exact proven worker contract", () => {
    const payload = buildWorkerPayload(A_REQUEST, "0b0b0b0b-aaaa-bbbb-cccc-121212121212");
    expect(payload.input.op).toBe("video_generate");
    expect(payload.input.input_key).toBe(STAGED_REFERENCES["reference-001"].key);
    expect(payload.input.output_key).toBe(
      "media/video/0b0b0b0b-aaaa-bbbb-cccc-121212121212/ltx-001.mp4",
    );
    expect(payload.input.params.prompt).toBe(A_REQUEST.prompt);
  });

  it("the artifact's watermark state must match the entitlement of record", () => {
    // The wrong product is a failure, not a delivery.
    expect(watermarkVerdict({ watermarked: true }, false)).toEqual({ ok: true });
    expect(watermarkVerdict({ watermarked: false }, true)).toEqual({ ok: true });
    expect(watermarkVerdict({ watermarked: true }, true)).toEqual({
      ok: false,
      reason: "wrong-watermark",
    });
    expect(watermarkVerdict({ watermarked: false }, false)).toEqual({
      ok: false,
      reason: "wrong-watermark",
    });
    // Evidence must be a real boolean — a truthy string proves nothing.
    expect(watermarkVerdict({ watermarked: "true" }, false)).toEqual({
      ok: false,
      reason: "watermark-evidence-invalid",
    });
    // The pre-watermark worker image reports nothing: status quo ante,
    // accepted — the canary reads it as "image not rebuilt", never clean.
    expect(watermarkVerdict({ ok: true }, false)).toEqual({ ok: true });
    expect(watermarkVerdict(null, false)).toEqual({ ok: false, reason: "no-output" });
  });

  it("output references are server-minted under media/video/<job>/", () => {
    expect(outputRefFor("abc")).toBe("media/video/abc/ltx-001.mp4");
  });
});

// 4 --------------------------------------------------------------- idempotency
describe("idempotency", () => {
  it("no existing job → a fresh submit", () => {
    expect(idempotentReuse(null)).toBe(false);
  });

  it("an in-flight or completed job is returned, never re-run", () => {
    for (const status of [
      "queued",
      "admitted",
      "provisioning",
      "running",
      "uploading",
      "completed",
      "orphaned",
    ] as JobStatus[]) {
      expect(idempotentReuse({ status }), status).toBe(true);
    }
  });

  it("only the failed family frees the key for an explicit retry", () => {
    for (const status of ["failed", "timed-out", "cancelled"] as JobStatus[]) {
      expect(idempotentReuse({ status }), status).toBe(false);
    }
  });
});

// 5 ----------------------------------------------------------- job persistence
describe("job persistence", () => {
  it("the table pins the full state machine and the idempotency identity", () => {
    // The state machine now spans two migrations: the original table plus
    // the 2026-08-26 voice-over extension, which re-creates the status
    // CHECK with audio_generating added. The pin holds over their union.
    const AUDIO_MIGRATION_SQL = readFileSync(
      join(ROOT, "supabase/migrations/20260826150000_gpu_video_audio.sql"),
      "utf8",
    );
    const schema = MIGRATION_SQL + AUDIO_MIGRATION_SQL;
    for (const status of Object.keys(UI_LABELS)) {
      expect(schema, status).toContain(`'${status}'`);
    }
    expect(MIGRATION_SQL).toMatch(/unique index[\s\S]{0,90}\(created_by, idempotency_key\)/i);
  });

  it("rows are admin-only and hold references and figures, never secrets", () => {
    expect(MIGRATION_SQL).toContain("is_admin");
    // Executable SQL only — the header COMMENT is allowed to explain that no
    // credential-shaped column exists.
    expect(stripSqlComments(MIGRATION_SQL)).not.toMatch(/api_key|secret|credential/i);
  });

  it("every status has user-facing copy, with no provider vocabulary in it", () => {
    for (const [status, label] of Object.entries(UI_LABELS)) {
      expect(label.length, status).toBeGreaterThan(0);
      expect(label).not.toMatch(/runpod|r2|IN_QUEUE|IN_PROGRESS/i);
    }
  });
});

// 6 -------------------------------------------------------- status transitions
describe("status transitions", () => {
  it("maps the provider's vocabulary onto the job state machine", () => {
    expect(statusFromPoll("IN_QUEUE")).toBe("provisioning");
    expect(statusFromPoll("IN_PROGRESS")).toBe("running");
    expect(statusFromPoll("FAILED")).toBe("failed");
    expect(statusFromPoll("CANCELLED")).toBe("cancelled");
    expect(statusFromPoll("TIMED_OUT")).toBe("timed-out");
  });

  it("provider COMPLETED is only 'uploading' — proof and custody still ahead", () => {
    expect(statusFromPoll("COMPLETED")).toBe("uploading");
  });

  it("unknown provider vocabulary changes nothing (UNKNOWN is never success)", () => {
    expect(statusFromPoll("UNKNOWN")).toBeNull();
    expect(statusFromPoll("")).toBeNull();
    expect(statusFromPoll("COMPLETED_MAYBE")).toBeNull();
  });

  it("terminal is exactly the five states nothing polls further", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
      "orphaned",
      "timed-out",
    ]);
  });
});

// 7 -------------------------------------------- successful artifact completion
describe("successful artifact completion", () => {
  it("accepts the measured production-canary shape", () => {
    expect(verifyWorkerOutput(goodWorkerOutput())).toEqual({ ok: true });
  });

  it("accepts a stored copy that is byte-identical and a real MP4", () => {
    expect(verifyStoredArtifact(mp4Bytes(330061), 330061)).toEqual({ ok: true });
  });

  it("the server stores custody before completed, and completed clears error", () => {
    // completed is written only after the verifyStoredArtifact CALL — the
    // import at the top of the file does not count as verification.
    const custody = SERVER_SRC.indexOf("verifyStoredArtifact(bytes");
    const completed = SERVER_SRC.search(/status: ['"]completed['"]/);
    expect(custody).toBeGreaterThan(-1);
    expect(completed).toBeGreaterThan(custody);
  });
});

// 8 ------------------------------------------------------------ missing artifact
describe("missing artifact", () => {
  it("a worker report with no bytes is a failure, not a success", () => {
    expect(verifyWorkerOutput({ ...goodWorkerOutput(), output_bytes: 0 })).toEqual({
      ok: false,
      reason: "no-artifact",
    });
  });

  it("an empty custody copy is refused", () => {
    expect(verifyStoredArtifact(new Uint8Array(0), 330061)).toEqual({
      ok: false,
      reason: "artifact-empty",
    });
  });

  it("a size mismatch is refused — the byte count is the identity check", () => {
    expect(verifyStoredArtifact(mp4Bytes(1000), 330061)).toEqual({
      ok: false,
      reason: "artifact-size-mismatch",
    });
  });

  it("right size but not an MP4 is refused", () => {
    expect(verifyStoredArtifact(new Uint8Array(330061), 330061)).toEqual({
      ok: false,
      reason: "artifact-not-mp4",
    });
  });
});

// 9 ------------------------------------------------------------ provider failure
describe("provider failure", () => {
  it("a provider FAILED lands as failed", () => {
    expect(statusFromPoll("FAILED")).toBe("failed");
  });

  it("a COMPLETED status with a bad proof is still a failure", () => {
    expect(verifyWorkerOutput({ ok: false, code: "cuda-oom" })).toEqual({
      ok: false,
      reason: "worker-not-ok:cuda-oom",
    });
    expect(verifyWorkerOutput({ ...goodWorkerOutput(), device: "cpu" })).toEqual({
      ok: false,
      reason: "not-cuda",
    });
    expect(verifyWorkerOutput({ ...goodWorkerOutput(), gpu_name: "NVIDIA H100 PCIe" })).toEqual({
      ok: false,
      reason: "wrong-gpu",
    });
    // Yesterday's card is wrong today: after the A5000 retarget a 3090-named
    // output must refuse, not silently pass on old affinity.
    expect(
      verifyWorkerOutput({ ...goodWorkerOutput(), gpu_name: "NVIDIA GeForce RTX 3090" }),
    ).toEqual({
      ok: false,
      reason: "wrong-gpu",
    });
    // No identity at all is not a pass either.
    const anonymous = goodWorkerOutput();
    delete anonymous.gpu_name;
    expect(verifyWorkerOutput(anonymous)).toEqual({ ok: false, reason: "wrong-gpu" });
    expect(verifyWorkerOutput({ ...goodWorkerOutput(), model: "missing" })).toEqual({
      ok: false,
      reason: "model-unproven",
    });
    expect(verifyWorkerOutput(null)).toEqual({ ok: false, reason: "no-output" });
  });

  it("the server records worker failures with a bounded code, no retry path", () => {
    expect(SERVER_SRC).toContain("`worker:${code}`");
    // No batching, no retry: exactly one submit call site in the whole module,
    // and no retry logic in the executable text (the header comment SAYS
    // "no retry", which is a mention).
    expect(SERVER_SRC.match(/runpodSubmit\(/g)).toHaveLength(2); // definition + one call
    expect(stripComments(SERVER_SRC)).not.toMatch(/retry|backoff/i);
  });
});

// 10 ----------------------------------------------------------------- R2 failure
describe("R2 failure", () => {
  it("an unreachable or unverifiable artifact fails the job — never completes it", () => {
    const branch = SERVER_SRC.slice(
      SERVER_SRC.indexOf("artifact fetch"),
      SERVER_SRC.search(/status: ['"]completed['"]/),
    );
    // Between the fetch and 'completed' sits the catch that writes 'failed'.
    expect(branch).toContain("artifact:");
    expect(branch).toMatch(/status: ['"]failed['"]/);
    expect(branch).toContain("continue");
  });
});

// 11 -------------------------------------------------------------------- timeout
describe("timeout", () => {
  it("the watchdog wall clock is the execution ceiling plus measured cold boot", () => {
    expect(WATCHDOG_SECONDS).toBe(1800);
  });

  it("expires a job past the wall clock and only then", () => {
    const created = "2026-08-26T10:00:00.000Z";
    const t0 = Date.parse(created);
    expect(watchdogExpired(created, t0 + 1799 * 1000)).toBe(false);
    expect(watchdogExpired(created, t0 + 1801 * 1000)).toBe(true);
  });

  it("an unparsable age is expired — not a license to run forever", () => {
    expect(watchdogExpired("not-a-date", Date.now())).toBe(true);
  });

  it("the server cancels before marking, and orphans loudly when cancel fails", () => {
    const watchdog = SERVER_SRC.slice(
      SERVER_SRC.indexOf("Watchdog first"),
      SERVER_SRC.indexOf("runpodStatus(job.runpod_job_id)"),
    );
    expect(watchdog).toContain("runpodCancel");
    expect(watchdog).toMatch(/['"]orphaned['"]/);
  });
});

// 12 -------------------------------------------------------- duplicate submission
describe("duplicate submission", () => {
  it("a re-sent key while the job runs reuses it — no second GPU", () => {
    expect(idempotentReuse({ status: "running" })).toBe(true);
    expect(idempotentReuse({ status: "provisioning" })).toBe(true);
  });

  it("the racing insert loses to the unique index and returns the winner", () => {
    // DB-level: unique (created_by, idempotency_key); server-level: the
    // insert-failure branch re-selects and returns the raced row as reused.
    expect(MIGRATION_SQL).toMatch(/unique index[\s\S]{0,90}\(created_by, idempotency_key\)/i);
    const race = SERVER_SRC.slice(SERVER_SRC.indexOf("insertErr"), SERVER_SRC.indexOf("jobId ="));
    expect(race).toContain("idempotency_key");
    expect(race).toContain("reused: true");
  });

  it("concurrency stays 1: an open job blocks a new one", () => {
    expect(SERVER_SRC).toContain("one at a time");
    expect(LAUNCH.limits.concurrency).toBe(1);
  });
});

// 13 ------------------------------------------------------ client cannot select GPU
describe("client cannot select GPU", () => {
  it("a gpu field is refused as infrastructure, not ignored", () => {
    expect(validateRequest({ ...A_REQUEST, gpu: "8x H100" })).toEqual({
      ok: false,
      reason: "infrastructure-not-selectable",
    });
    expect(validateRequest({ ...A_REQUEST, gpuType: "NVIDIA GeForce RTX 4090" })).toEqual({
      ok: false,
      reason: "infrastructure-not-selectable",
    });
  });

  it("the GPU is a server constant fed to the shared admission gate", () => {
    expect(SERVER_SRC).not.toMatch(/gpuType\s*:\s*(raw|data|request)\./);
    // admitGeneration takes only a price; the card is fixed inside it — and
    // the card is the owner's 2026-08-26 pick, pinned here so a drive-by
    // edit cannot quietly move production to another GPU.
    expect(admitGeneration.length).toBe(1);
    expect(TARGET_GPU_ID).toBe("NVIDIA RTX A5000");
  });
});

// 14 -------------------------------------------------- client cannot select provider
describe("client cannot select provider", () => {
  it("provider and model fields are refused as infrastructure", () => {
    expect(validateRequest({ ...A_REQUEST, provider: "google_veo" })).toEqual({
      ok: false,
      reason: "infrastructure-not-selectable",
    });
    expect(validateRequest({ ...A_REQUEST, model: "wan-2.1-14b" })).toEqual({
      ok: false,
      reason: "infrastructure-not-selectable",
    });
    expect(validateRequest({ ...A_REQUEST, endpointId: "p3zmlv8ek10dzt" })).toEqual({
      ok: false,
      reason: "infrastructure-not-selectable",
    });
  });

  it("a benign unknown field is still refused, under its own reason", () => {
    expect(validateRequest({ ...A_REQUEST, vibe: "cinematic" })).toEqual({
      ok: false,
      reason: "unknown-field",
    });
  });
});

// 15 ----------------------------------- client cannot override budget or runtime
describe("client cannot override budget or runtime", () => {
  it("budget, runtime and bucket fields are refused", () => {
    for (const field of ["budgetUsd", "maxRuntimeSeconds", "outputBucket", "costCapUsd"]) {
      expect(validateRequest({ ...A_REQUEST, [field]: 999 }), field).toEqual({
        ok: false,
        reason: "infrastructure-not-selectable",
      });
    }
  });

  /**
   * OWNER DIRECTIVE 2026-08-29: the price gate on THIS tool is off, so a
   * quality run can be generated and judged. These tests were the two that
   * asserted it refusing. They are not deleted and not loosened — they now
   * pin the switch itself, which is a stronger claim than the old pair
   * made: that the gate is off HERE, that it is still on everywhere else,
   * and that turning it back on restores the exact previous behaviour.
   */
  it("the price gate is OFF for this tool, and says so in one greppable word", () => {
    expect(GPU_VIDEO_PRICE_GATE).toBe(false);
  });

  it("no live quote no longer refuses — but the reservation reads null, never 0", () => {
    const unpriced = admitGeneration(null);
    expect(unpriced.ok).toBe(true);
    // UNKNOWN is not zero. A missing price must not be recorded as a free
    // job, which is the rule the orphan sweep and queue probe already keep.
    if (unpriced.ok) expect(unpriced.reservationUsd).toBeNull();
  });

  it("a price spike no longer refuses, and the reservation is still measured", () => {
    const ok = admitGeneration(0.22);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.reservationUsd).toBeCloseTo(0.055, 5);
      expect(ok.maxRuntimeSeconds).toBe(900);
    }
    // The A5000's measured secure price (2026-08-26, the card production
    // actually runs): a full 900s reservation is $0.0675.
    const a5000 = admitGeneration(0.27);
    expect(a5000.ok).toBe(true);
    if (a5000.ok) expect(a5000.reservationUsd).toBeCloseTo(0.0675, 5);
    // What used to be over-job-cap. Admitted now — and still priced, so the
    // number reaches reservation_usd exactly as it did before.
    const spike = admitGeneration(2.01);
    expect(spike.ok).toBe(true);
    if (spike.ok) expect(spike.reservationUsd).toBeCloseTo(0.5025, 5);
  });

  it("the gate still refuses everywhere it was not switched off", () => {
    // admitGpuJob defaults to gating, so no other caller lost its ceiling.
    const base = {
      gpuType: "NVIDIA RTX A5000",
      maxRuntimeSeconds: 900,
      requiredVramGb: 16,
      jobCapUsd: GPU_JOB_CAP_USD,
    };
    expect(admitGpuJob({ ...base, pricePerHourUsd: null })).toEqual({
      ok: false,
      reason: "gpu-unpriced",
    });
    expect(admitGpuJob({ ...base, pricePerHourUsd: 2.01 })).toEqual({
      ok: false,
      reason: "over-job-cap",
    });
    // …and an explicit true is the same as omitting it.
    expect(admitGpuJob({ ...base, pricePerHourUsd: 2.01, priceGate: true })).toEqual({
      ok: false,
      reason: "over-job-cap",
    });
  });

  it("only the PRICE half was switchable — the technical refusals are unconditional", () => {
    const off = { maxRuntimeSeconds: 900, requiredVramGb: 16, priceGate: false };
    // A card that is not the allowed one is still refused.
    expect(admitGpuJob({ ...off, gpuType: "NVIDIA H100", pricePerHourUsd: 0.27 })).toEqual({
      ok: false,
      reason: "gpu-type-not-allowed",
    });
    // A card too small for the model is still refused.
    expect(
      admitGpuJob({
        ...off,
        gpuType: "NVIDIA RTX A5000",
        pricePerHourUsd: 0.27,
        requiredVramGb: 80,
      }),
    ).toEqual({ ok: false, reason: "insufficient-vram" });
    // The runtime ceiling still holds — and with no price cap it is now the
    // thing that bounds what one job can cost.
    expect(
      admitGpuJob({
        ...off,
        gpuType: "NVIDIA RTX A5000",
        pricePerHourUsd: 0.27,
        maxRuntimeSeconds: 90_000,
      }),
    ).toEqual({ ok: false, reason: "runtime-exceeds-ceiling" });
  });

  it("the request itself is bounded: prompt length, known reference, one key", () => {
    expect(validateRequest({ ...A_REQUEST, prompt: "x".repeat(MAX_PROMPT_CHARS + 1) })).toEqual({
      ok: false,
      reason: "prompt-too-long",
    });
    expect(validateRequest({ ...A_REQUEST, prompt: "  " })).toEqual({
      ok: false,
      reason: "prompt-missing",
    });
    expect(validateRequest({ ...A_REQUEST, referenceId: "../../etc/passwd" })).toEqual({
      ok: false,
      reason: "reference-unknown",
    });
    expect(validateRequest({ ...A_REQUEST, idempotencyKey: "" })).toEqual({
      ok: false,
      reason: "idempotency-key-missing",
    });
    const good = validateRequest({ ...A_REQUEST });
    expect(good.ok).toBe(true);
  });
});

// 16 ------------------------------------------- completed job renders in player
describe("completed job renders in player", () => {
  it("a completed job gets a <video> player fed by a signed custody URL", () => {
    const completedBlock = ROUTE_SRC.slice(
      ROUTE_SRC.indexOf('j.status === "completed"'),
      ROUTE_SRC.indexOf('j.status === "failed"'),
    );
    expect(completedBlock).toContain("<video");
    expect(completedBlock).toContain("controls");
    expect(completedBlock).toContain("playback[j.id]");
    // The src comes from gpuVideoSign (Supabase signed URL), never a raw path.
    expect(ROUTE_SRC).toContain("gpuVideoSign");
  });

  it("failure states render the error and an explicit retry — nothing auto-retries", () => {
    expect(ROUTE_SRC).toContain("Ready to retry");
    expect(ROUTE_SRC).not.toMatch(/retryCount|autoRetry/);
  });

  it("the surface is AI-labelled and reportable", () => {
    expect(ROUTE_SRC).toContain("AI_OUTPUT_LABEL");
    expect(ROUTE_SRC).toContain('surface="gpu_video_ai_output"');
  });

  it("signed playback is path-anchored to the gpu custody folder", () => {
    expect(SERVER_SRC).toContain("^gpu\\/[0-9a-f-]{36}\\.mp4$");
  });
});
