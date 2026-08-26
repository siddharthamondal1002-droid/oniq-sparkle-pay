// The voice-over (audio_mux) extension of the UI→GPU path, proved without
// a credential or a cent. Behavior tests run the pure decision core; where
// the guarantee lives in the edge function's orchestration or the SQL —
// the salvage rule, the second admission, the production gate — the test
// reads the source, exactly like gpuVideoFlow.test.ts does for the video
// half. The video half's own tests are untouched: nothing here weakens a
// guarantee that already held.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NARRATION_FASTEST_WPS,
  NARRATION_MAX_CHARS,
  NARRATION_MAX_WORDS,
  TERMINAL_STATUSES,
  UI_LABELS,
  VIDEO_CLOCK_SECONDS,
  buildAudioMuxPayload,
  finalRefFor,
  narrationWordCount,
  outputRefFor,
  validateRequest,
  verifyAudioMuxOutput,
} from "@/lib/gpuVideoFlow";
import {
  AV_DRIFT_TOLERANCE_S,
  SILENCE_FLOOR_DB,
} from "../../../supabase/functions/_shared/videoAudio.ts";

const ROOT = process.cwd();
const EDGE_SRC = readFileSync(join(ROOT, "supabase/functions/gpu-video/index.ts"), "utf8");
const PANEL_SRC = readFileSync(join(ROOT, "src/components/admin/GpuVideoPanel.tsx"), "utf8");
const MIGRATION_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260826150000_gpu_video_audio.sql"),
  "utf8",
);

const BASE = {
  prompt: "The character slowly turns toward the camera.",
  referenceId: "reference-001",
  idempotencyKey: "11111111-2222-3333-4444-555555555555",
};

function goodAudioOutput(): Record<string, unknown> {
  return {
    ok: true,
    op: "audio_mux",
    has_audio: true,
    narration_seconds: 1.71,
    audio_seconds: 4.042,
    video_seconds: 4.042,
    audio_sample_rate: 22050,
    audio_peak_dbfs: -3.8,
    audio_gain_db: -3.7,
    tts_ms: 1731,
    mux_ms: 45,
    output_bytes: 991_234,
  };
}

// 1 ------------------------------------------------------ request validation
describe("voice-over request validation", () => {
  it("audio is optional and defaults to off", () => {
    const v = validateRequest({ ...BASE });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.request.audio).toBe("off");
  });

  it("an unknown audio mode is refused, never coerced to off", () => {
    const v = validateRequest({ ...BASE, audio: "VEO_NATIVE_AUDIO" });
    expect(v).toEqual({ ok: false, reason: "audio-mode-unknown" });
  });

  it("narration mode without a line is refused", () => {
    const v = validateRequest({ ...BASE, audio: "narration" });
    expect(v).toEqual({ ok: false, reason: "narration-missing" });
    const blank = validateRequest({ ...BASE, audio: "narration", narrationText: "   " });
    expect(blank).toEqual({ ok: false, reason: "narration-missing" });
  });

  it("a narration over the character fence is refused", () => {
    const v = validateRequest({
      ...BASE,
      audio: "narration",
      narrationText: "x".repeat(NARRATION_MAX_CHARS + 1),
    });
    expect(v).toEqual({ ok: false, reason: "narration-too-long" });
  });

  it("the estimate gate refuses a line too long even at the fastest measured rate", () => {
    const eleven = Array.from({ length: NARRATION_MAX_WORDS + 1 }, (_, i) => `w${i}`).join(" ");
    const v = validateRequest({ ...BASE, audio: "narration", narrationText: eleven });
    expect(v).toEqual({ ok: false, reason: "narration-estimate-too-long" });
  });

  it("a line at exactly the word ceiling passes to the worker's measured gate", () => {
    const ten = Array.from({ length: NARRATION_MAX_WORDS }, (_, i) => `w${i}`).join(" ");
    const v = validateRequest({ ...BASE, audio: "narration", narrationText: `  ${ten}  ` });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.request.audio).toBe("narration");
      expect(v.request.narrationText).toBe(ten);
    }
  });

  it("the word count treats NBSP as a space, like the Story SQL gate", () => {
    expect(narrationWordCount("one two three")).toBe(3);
    expect(narrationWordCount("  one   two  ")).toBe(2);
    expect(narrationWordCount("")).toBe(0);
  });

  it("the ceiling is derived from the measured fastest speech rate, not invented", () => {
    expect(NARRATION_MAX_WORDS).toBe(Math.floor(VIDEO_CLOCK_SECONDS * NARRATION_FASTEST_WPS));
    expect(NARRATION_MAX_WORDS).toBe(10);
    expect(VIDEO_CLOCK_SECONDS).toBeCloseTo(97 / 24, 10);
  });

  it("the char fence mirrors the worker contract's MAX_NARRATION_CHARS", () => {
    // oniq-gpu-worker/contract.py pins MAX_NARRATION_CHARS = 300; the two
    // repos cannot import each other, so the number is pinned on both sides.
    expect(NARRATION_MAX_CHARS).toBe(300);
  });
});

// 2 ---------------------------------------------------------------- payload
describe("audio_mux payload", () => {
  it("muxes THIS job's own silent output into its own final, narration only", () => {
    const p = buildAudioMuxPayload("He turns to face us.", "job-1");
    expect(p).toEqual({
      input: {
        op: "audio_mux",
        input_key: outputRefFor("job-1"),
        output_key: finalRefFor("job-1"),
        params: { narration: "He turns to face us." },
      },
    });
    expect(finalRefFor("job-1")).toBe("media/video/job-1/final-001.mp4");
  });
});

// 3 ----------------------------------------------------------------- states
describe("audio job states", () => {
  it("audio_generating is a live state with user-facing copy, never terminal", () => {
    expect(UI_LABELS.audio_generating).toBe("Adding voice…");
    expect(TERMINAL_STATUSES.has("audio_generating")).toBe(false);
  });
});

// 4 ------------------------------------------------------------ output proof
describe("verifyAudioMuxOutput", () => {
  it("accepts the measured happy output", () => {
    expect(verifyAudioMuxOutput(goodAudioOutput())).toEqual({ ok: true });
  });

  it.each([
    [null, "no-output"],
    [{ ...goodAudioOutput(), ok: false, code: "narration-too-long" }, "worker-not-ok:narration-too-long"],
    [{ ...goodAudioOutput(), has_audio: false }, "no-audio-stream"],
    [{ ...goodAudioOutput(), narration_seconds: 0 }, "no-narration"],
    [{ ...goodAudioOutput(), output_bytes: 0 }, "no-artifact"],
  ])("refuses %#", (output, reason) => {
    expect(verifyAudioMuxOutput(output)).toEqual({ ok: false, reason });
  });

  it("refuses a drifted mux through the SHARED media verdict", () => {
    const drifted = { ...goodAudioOutput(), audio_seconds: 4.042 - AV_DRIFT_TOLERANCE_S - 0.1 };
    const v = verifyAudioMuxOutput(drifted);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/^media:.*drift/);
  });

  it("refuses silence with extra steps through the SHARED silence floor", () => {
    const silent = { ...goodAudioOutput(), audio_peak_dbfs: SILENCE_FLOOR_DB - 10 };
    const v = verifyAudioMuxOutput(silent);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/^media:.*silent/);
  });

  it("the shared constants are the measured ones both runtimes pin", () => {
    // audio.py mirrors these exact values (test_verdict_constants_mirror_
    // the_shared_media_contract in the worker repo).
    expect(AV_DRIFT_TOLERANCE_S).toBe(0.25);
    expect(SILENCE_FLOOR_DB).toBe(-60);
  });
});

// 5 --------------------------------------------------- edge fn orchestration
describe("edge function orchestration (source-pinned)", () => {
  it("the production gate refuses narration until the owner flips audio_enabled", () => {
    const gate = EDGE_SRC.indexOf("voice-over is not enabled yet");
    const insert = EDGE_SRC.indexOf('.insert({');
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(insert);
    expect(EDGE_SRC).toContain("audio_enabled");
  });

  it("the audio step has its own admission BEFORE its one submit, under the shared cap", () => {
    const fn = EDGE_SRC.slice(EDGE_SRC.indexOf("async function submitAudioRun"));
    const body = fn.slice(0, fn.indexOf("async function pollAudioRun"));
    const admit = body.indexOf("admitGeneration(");
    const cap = body.indexOf("GPU_JOB_CAP_USD");
    const submit = body.indexOf("runpodSubmit(");
    expect(admit).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(admit);
    expect(submit).toBeGreaterThan(cap);
    expect(body).toContain("buildAudioMuxPayload");
  });

  it("the audio run is billed on ITS OWN live quote, never the video step's", () => {
    expect(EDGE_SRC).toContain("audio_price_per_hour_usd: price");
    const poll = EDGE_SRC.slice(EDGE_SRC.indexOf("async function pollAudioRun"));
    expect(poll).toContain("gpuActualUsd(job.audio_price_per_hour_usd");
  });

  it("every audio failure path salvages the silent video instead of wasting it", () => {
    const poll = EDGE_SRC.slice(
      EDGE_SRC.indexOf("async function pollAudioRun"),
      EDGE_SRC.indexOf("async function pollGenerations"),
    );
    expect(poll).toContain("salvageSilent(admin, job, `audio-worker:");
    expect(poll).toContain("salvageSilent(admin, job, `audio-proof:");
    expect(poll).toContain("audio-billing-anomaly");
    const submitFn = EDGE_SRC.slice(
      EDGE_SRC.indexOf("async function submitAudioRun"),
      EDGE_SRC.indexOf("async function pollAudioRun"),
    );
    expect(submitFn).toContain("audio-admission:");
    expect(submitFn).toContain("audio-submit:");
  });

  it("a voiced completion custodies the FINAL artifact by its server-owned ref", () => {
    const poll = EDGE_SRC.slice(EDGE_SRC.indexOf("async function pollAudioRun"));
    expect(poll).toContain("finalRefFor(job.id as string)");
    expect(poll).toContain("verifyAudioMuxOutput(state.output)");
  });

  it("the salvage itself never completes without verified custody", () => {
    const salvage = EDGE_SRC.slice(
      EDGE_SRC.indexOf("async function salvageSilent"),
      EDGE_SRC.indexOf("async function submitAudioRun"),
    );
    expect(salvage).toContain("custodyArtifact(");
    const failBranch = salvage.slice(salvage.indexOf("catch"));
    expect(failBranch).toContain('status: "failed"');
  });

  it("the audio submit marks BEFORE it spends, so a died invocation can never retry", () => {
    const fn = EDGE_SRC.slice(
      EDGE_SRC.indexOf("async function submitAudioRun"),
      EDGE_SRC.indexOf("async function pollAudioRun"),
    );
    const mark = fn.indexOf('status: "audio_generating"');
    const spend = fn.indexOf("runpodSubmit(");
    expect(mark).toBeGreaterThan(-1);
    expect(spend).toBeGreaterThan(mark);
    // ...and the poller's answer to an interrupted submit is salvage,
    // never a second submit.
    const poll = EDGE_SRC.slice(
      EDGE_SRC.indexOf("async function pollAudioRun"),
      EDGE_SRC.indexOf("async function submitGeneration"),
    );
    expect(poll).toContain("audio-submit:interrupted-before-provider-id");
    expect(poll.indexOf("runpodSubmit(")).toBe(-1);
  });

  it("the watchdog's cancel follows whichever provider run is live", () => {
    expect(EDGE_SRC).toContain(
      'job.status === "audio_generating" ? job.audio_runpod_job_id : job.runpod_job_id',
    );
  });

  it("silent jobs keep the exact completed path: custody before completed", () => {
    const tail = EDGE_SRC.slice(EDGE_SRC.indexOf("the fork: silent jobs finish here"));
    const custody = tail.indexOf("custodyArtifact(admin, job.id, job.output_ref");
    const completed = tail.indexOf('status: "completed"');
    expect(custody).toBeGreaterThan(-1);
    expect(completed).toBeGreaterThan(custody);
  });
});

// 6 ------------------------------------------------------------------- SQL
describe("migration (source-pinned)", () => {
  it("audio_mode is constrained to the two modes and defaults off", () => {
    expect(MIGRATION_SQL).toContain("check (audio_mode in ('off', 'narration'))");
    expect(MIGRATION_SQL).toContain("default 'off'");
  });

  it("the state machine gains audio_generating and keeps every existing state", () => {
    const check = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("gpu_video_jobs_status_check\n"));
    for (const s of [
      "queued",
      "admitted",
      "provisioning",
      "running",
      "uploading",
      "audio_generating",
      "completed",
      "failed",
      "timed-out",
      "cancelled",
      "terminating",
      "orphaned",
    ]) {
      expect(check).toContain(`'${s}'`);
    }
  });

  it("voice-over ships disabled: the owner flips audio_enabled after the canaries", () => {
    expect(MIGRATION_SQL).toContain(
      "add column if not exists audio_enabled boolean not null default false",
    );
  });
});

// 7 ------------------------------------------------------------------ panel
describe("panel (source-pinned)", () => {
  it("the voice-over picker is disabled until the server says audio is enabled", () => {
    expect(PANEL_SRC).toContain("status.audioEnabled !== true");
    expect(PANEL_SRC).toContain("Voice-over is not enabled yet");
  });

  it("an audio failure renders as delivered-silent with the recorded reason", () => {
    expect(PANEL_SRC).toContain("voice failed — delivered silent");
    expect(PANEL_SRC).toContain("j.audio_error");
  });

  it("retry restores the narration alongside the prompt, with a fresh key", () => {
    const retry = PANEL_SRC.slice(PANEL_SRC.indexOf("Explicit retry only"));
    expect(retry).toContain("setNarrationText(j.narration_text ?? \"\")");
    expect(retry).toContain("setIdempotencyKey(freshKey())");
  });
});
