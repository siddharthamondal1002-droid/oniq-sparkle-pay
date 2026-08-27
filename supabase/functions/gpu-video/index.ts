// gpu-video — the in-house GPU tool's server half, as an EDGE FUNCTION.
//
// Why an edge function and not the TanStack server functions that first
// carried this tool (2026-08-26, measured on the owner's device): three
// Generate-video presses produced no server-side trace at all, a raw probe
// of the /_serverFn endpoint answered with serializer errors, and the RunPod
// credentials were provisioned into THIS environment — the same one every
// story function reads its keys from and proves in production daily. The
// transport changed; not one gate did.
//
// The order is the same one every ONIQ generation tool enforces: caller gate
// -> kill switch -> daily cap -> validation -> financial admission on a LIVE
// quote -> one billable call. No batching, no retry.
//
// USER-FACING since 2026-08-27 (owner directive: "make video production live
// for users", issued after the path passed its full production proof). Any
// signed-in user may submit and may see, poll and sign THEIR OWN jobs; the
// admin keeps the unscoped operator view. Not one financial gate moved: the
// kill switch, the shared daily cap, the live-quote admission, the per-job
// cap, one-generation-at-a-time and per-user idempotency all sit exactly
// where the admin-only era put them.
//
// DELIBERATELY ABSENT from config.toml: the caller is a signed-in person, so
// the platform's verify_jwt gate applies, and the function still re-derives
// the user and reads is_admin itself — same shape as story-deliver.
//
// RUNPOD_API_KEY is read here and only here. Never returned, never logged,
// never in an error message — the NAME of a missing variable is operator
// information; no value ever is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetchTimeout.ts";
import { GPU_JOB_CAP_USD, gpuActualUsd } from "../_shared/gpuJob.ts";
import {
  TARGET_GPU_ID,
  VIDEO_CLOCK_SECONDS,
  WATCHDOG_SECONDS,
  admitGeneration,
  buildAudioMuxPayload,
  buildWorkerPayload,
  finalRefFor,
  idempotentReuse,
  outputRefFor,
  statusFromPoll,
  validateRequest,
  verifyAudioMuxOutput,
  verifyStoredArtifact,
  verifyWorkerOutput,
  watchdogExpired,
  type JobStatus,
} from "../_shared/gpuVideoCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";
const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2";
// Cloudflare fronts api.runpod.io and bans default library agents outright
// (error 1010, measured 2026-08-25 in the validation harness).
const USER_AGENT = "oniq-gpu-video/1.0 (oniq server)";
const RUNWAY_BUCKET = "video-gen";
const EXTERNAL_TIMEOUT_MS = 20_000;

/**
 * What a NON-ADMIN status read returns, column by column: the fields the
 * user panel renders and nothing operator-grade — no provider job ids, no
 * price quotes, no reservation or actual cost, no refs, no idempotency key.
 */
const USER_JOB_COLUMNS =
  "id, status, prompt, stored_path, video_seconds, error, created_at, " +
  "audio_mode, narration_text, audio_error";

function envOrThrow(name: "RUNPOD_API_KEY" | "RUNPOD_ENDPOINT_ID" | "R2_PUBLIC_BASE_URL"): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`gpu video generation is not configured (${name} unset)`);
  return v;
}

function runpodHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${envOrThrow("RUNPOD_API_KEY")}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
}

/**
 * Live secure-cloud price for THE production card — quoted NOW, never
 * reused, never defaulted. THE SERVERLESS RULE (owner directive
 * 2026-08-26): serverless jobs bill the SECURE price against an endpoint
 * that manages its own worker pool; the pod-market lowestPrice field is
 * not consulted, because one evening's record showed it flapping null on
 * three cards in turn while every secure price stayed firm. A missing or
 * non-positive secure price still returns null, and null still refuses
 * admission — a null price is never free.
 */
async function liveTargetGpuPriceUsd(): Promise<number | null> {
  const query = "query { gpuTypes { id securePrice } }";
  const res = await fetchWithTimeout(
    RUNPOD_GRAPHQL,
    { method: "POST", headers: runpodHeaders(), body: JSON.stringify({ query }) },
    EXTERNAL_TIMEOUT_MS,
  );
  if (!res.ok) {
    console.error(`[gpu-video] price quote upstream ${res.status}`);
    return null;
  }
  const doc = (await res.json()) as { data?: { gpuTypes?: Array<Record<string, unknown>> } };
  const gpu = doc.data?.gpuTypes?.find((g) => g.id === TARGET_GPU_ID);
  if (!gpu) return null;
  const secure = gpu.securePrice;
  if (typeof secure !== "number" || secure <= 0) return null;
  return secure;
}

async function runpodSubmit(payload: Record<string, unknown>): Promise<string> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetchWithTimeout(
    `${RUNPOD_SERVERLESS}/${endpoint}/run`,
    { method: "POST", headers: runpodHeaders(), body: JSON.stringify(payload) },
    EXTERNAL_TIMEOUT_MS,
  );
  if (!res.ok) {
    console.error(`[gpu-video] submit upstream ${res.status}`);
    throw new Error(`gpu provider rejected the request (${res.status})`);
  }
  const parsed = (await res.json()) as { id?: string };
  if (!parsed.id) throw new Error("gpu provider returned no job id");
  return parsed.id;
}

type RunpodStatus = { status: string; executionTime: number | null; output: unknown };

async function runpodStatus(jobId: string): Promise<RunpodStatus> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetchWithTimeout(
    `${RUNPOD_SERVERLESS}/${endpoint}/status/${encodeURIComponent(jobId)}`,
    { headers: runpodHeaders() },
    EXTERNAL_TIMEOUT_MS,
  );
  if (!res.ok) {
    console.error(`[gpu-video] status upstream ${res.status}`);
    throw new Error(`could not read gpu job (${res.status})`);
  }
  const body = (await res.json()) as { status?: string; executionTime?: number; output?: unknown };
  return {
    status: String(body.status ?? "UNKNOWN"),
    executionTime: typeof body.executionTime === "number" ? body.executionTime : null,
    output: body.output,
  };
}

async function runpodCancel(jobId: string): Promise<boolean> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetchWithTimeout(
    `${RUNPOD_SERVERLESS}/${endpoint}/cancel/${encodeURIComponent(jobId)}`,
    { method: "POST", headers: runpodHeaders() },
    EXTERNAL_TIMEOUT_MS,
  );
  return res.ok;
}

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// deno-lint-ignore no-explicit-any
type AnyClient = any;

async function setJob(admin: AnyClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("gpu_video_jobs").update(patch).eq("id", id);
  if (error) console.error("[gpu-video] row update failed", error.message);
}

// ------------------------------------------- finished-video-time ledger
// The customer unit (owner directive 2026-08-27): one clip reserves its
// fixed clock up front and settles at the MEASURED finished duration; a
// generation that delivers nothing usable releases the whole reservation.
// The RPCs are idempotent per job, so a duplicate settle or a settle racing
// a release charges nothing twice. A ledger error never breaks job-state
// writes — it is logged evidence, not a crash.
const CLIP_RESERVE_MS = Math.ceil(VIDEO_CLOCK_SECONDS * 1000);

async function reserveTime(
  admin: AnyClient,
  userId: string,
  jobId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await admin.rpc("reserve_video_time", {
    _user: userId,
    _job_id: jobId,
    _ms: CLIP_RESERVE_MS,
  });
  if (error) {
    console.error("[gpu-video] reserve failed", error.message);
    // Fail closed: no reservation, no generation.
    return { ok: false, reason: "ledger-unavailable" };
  }
  return (data ?? { ok: false, reason: "ledger-unavailable" }) as {
    ok: boolean;
    reason?: string;
  };
}

async function settleTime(admin: AnyClient, jobId: string, videoSeconds: unknown): Promise<void> {
  const ms = Math.round(Number(videoSeconds) * 1000);
  // A delivered clip with no measured duration settles at the reservation —
  // never more (the RPC clamps), never silently free.
  const actual = Number.isFinite(ms) && ms > 0 ? ms : CLIP_RESERVE_MS;
  const { error } = await admin.rpc("settle_video_time", { _job_id: jobId, _actual_ms: actual });
  if (error) console.error("[gpu-video] settle failed", jobId, error.message);
}

async function releaseTime(admin: AnyClient, jobId: string): Promise<void> {
  const { error } = await admin.rpc("release_video_time", { _job_id: jobId });
  if (error) console.error("[gpu-video] release failed", jobId, error.message);
}

/**
 * Fetch one artifact from R2 by its server-owned reference, verify it is
 * the exact object the worker measured, and put the custody copy where
 * every generated clip lives. Throws rather than storing anything less.
 */
async function custodyArtifact(
  admin: AnyClient,
  jobId: string,
  ref: string,
  expectedBytes: number,
): Promise<string> {
  const base = envOrThrow("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  const res = await fetchWithTimeout(`${base}/${ref}`, {}, EXTERNAL_TIMEOUT_MS);
  if (!res.ok) throw new Error(`artifact fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const artifact = verifyStoredArtifact(bytes, expectedBytes);
  if (!artifact.ok) throw new Error(artifact.reason);
  const path = `gpu/${jobId}.mp4`;
  const { error } = await admin.storage
    .from(RUNWAY_BUCKET)
    .upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`store: ${error.message}`);
  return path;
}

/**
 * The audio salvage rule (voice-over jobs only): the VIDEO money is spent
 * and the silent clip is real, so an audio-stage failure DELIVERS THE
 * SILENT VIDEO with the failure recorded on the row — same philosophy as
 * a Story shot whose dialogue fails and downgrades to narration-only.
 * Nothing retries by itself, and no second video is ever rented for a
 * voice that failed.
 */
async function salvageSilent(
  admin: AnyClient,
  job: Record<string, unknown>,
  audioError: string,
  audioBilling: Record<string, unknown> = {},
): Promise<void> {
  try {
    const stored = await custodyArtifact(
      admin,
      job.id as string,
      job.output_ref as string,
      job.output_bytes as number,
    );
    await setJob(admin, job.id as string, {
      status: "completed",
      stored_path: stored,
      audio_error: audioError.slice(0, 160),
      ...audioBilling,
      error: null,
      completed_at: new Date().toISOString(),
    });
    // A silent video was DELIVERED: the finished duration is charged.
    await settleTime(admin, job.id as string, job.video_seconds);
  } catch (e) {
    await setJob(admin, job.id as string, {
      status: "failed",
      audio_error: audioError.slice(0, 160),
      ...audioBilling,
      error: `artifact:${(e as Error).message.slice(0, 140)}`,
      completed_at: new Date().toISOString(),
    });
    // Nothing reached the user: full refund of the reservation.
    await releaseTime(admin, job.id as string);
  }
}

/**
 * The SECOND paid step of a voice-over job: its own live quote, its own
 * admission, and a combined-exposure check against the SAME per-job cap —
 * video already spent plus the audio reservation may not exceed it. Any
 * refusal or submit failure salvages the silent video; it never blocks
 * what the first step already produced.
 */
async function submitAudioRun(admin: AnyClient, job: Record<string, unknown>): Promise<void> {
  let price: number | null = null;
  try {
    price = await liveTargetGpuPriceUsd();
  } catch (e) {
    console.error("[gpu-video] audio quote failed", (e as Error).message);
  }
  const admission = admitGeneration(price);
  if (!admission.ok) {
    await salvageSilent(admin, job, `audio-admission:${admission.reason}`);
    return;
  }
  const spent = typeof job.actual_cost_usd === "number" ? job.actual_cost_usd : 0;
  if (spent + admission.reservationUsd > GPU_JOB_CAP_USD) {
    await salvageSilent(admin, job, "audio-admission:job-cap-exhausted");
    return;
  }
  // Mark BEFORE submitting: a poller that finds audio_generating with no
  // provider id knows a submit was interrupted and salvages — it never
  // submits again. The reverse order would let a died invocation turn the
  // 5s poll into an automatic paid retry, which is banned.
  await setJob(admin, job.id as string, {
    status: "audio_generating",
    // The audio run's OWN live quote — the video step's rate is history
    // by now, and history is exactly what a bill must never be priced on.
    audio_price_per_hour_usd: price,
  });
  try {
    const runpodJobId = await runpodSubmit(
      buildAudioMuxPayload(job.narration_text as string, job.id as string),
    );
    await setJob(admin, job.id as string, { audio_runpod_job_id: runpodJobId });
  } catch (e) {
    await salvageSilent(admin, job, `audio-submit:${(e as Error).message.slice(0, 120)}`);
  }
}

/** One voice-over job's audio run, polled to its verdict. */
async function pollAudioRun(admin: AnyClient, job: Record<string, unknown>): Promise<void> {
  if (!job.audio_runpod_job_id) {
    // audio_generating with no provider id: the submit was interrupted.
    // After a grace window (a concurrent poller may be mid-submit right
    // now) this salvages the silent video; it NEVER submits again.
    const markedAt = Date.parse(String(job.updated_at ?? ""));
    if (Number.isFinite(markedAt) && Date.now() - markedAt > 120_000) {
      await salvageSilent(admin, job, "audio-submit:interrupted-before-provider-id");
    }
    return;
  }
  let state: RunpodStatus;
  try {
    state = await runpodStatus(job.audio_runpod_job_id as string);
  } catch (e) {
    console.warn("[gpu-video] audio status read failed", (e as Error).message);
    return; // transient read failure changes nothing
  }

  const billed = state.executionTime !== null ? state.executionTime / 1000 : null;
  const audioBilling: Record<string, unknown> = {
    audio_billed_seconds: billed,
    audio_cost_usd: gpuActualUsd(job.audio_price_per_hour_usd as number | null, billed),
  };

  const mapped = statusFromPoll(state.status);
  if (mapped === "provisioning" || mapped === "running") return; // still audio_generating
  if (mapped === "failed" || mapped === "cancelled" || mapped === "timed-out") {
    const code =
      state.output && typeof state.output === "object"
        ? String((state.output as Record<string, unknown>).code ?? state.status)
        : state.status;
    await salvageSilent(admin, job, `audio-worker:${code}`, audioBilling);
    return;
  }
  if (mapped !== "uploading") return; // unknown provider vocabulary: leave it

  const verdict = verifyAudioMuxOutput(state.output);
  if (!verdict.ok) {
    await salvageSilent(admin, job, `audio-proof:${verdict.reason}`, audioBilling);
    return;
  }
  if (billed !== null && billed > 900) {
    await salvageSilent(
      admin,
      job,
      "audio-billing-anomaly: executionTime exceeds the 900s ceiling",
      audioBilling,
    );
    return;
  }

  const out = state.output as Record<string, unknown>;
  try {
    const stored = await custodyArtifact(
      admin,
      job.id as string,
      finalRefFor(job.id as string),
      out.output_bytes as number,
    );
    await setJob(admin, job.id as string, {
      status: "completed",
      stored_path: stored,
      output_bytes: out.output_bytes as number,
      narration_seconds: typeof out.narration_seconds === "number" ? out.narration_seconds : null,
      ...audioBilling,
      audio_error: null,
      error: null,
      completed_at: new Date().toISOString(),
    });
    // The voiced final is delivered: charge the measured finished duration.
    await settleTime(
      admin,
      job.id as string,
      typeof out.video_seconds === "number" ? out.video_seconds : job.video_seconds,
    );
  } catch (e) {
    // The voiced final could not reach custody; the silent source still can.
    await salvageSilent(
      admin,
      job,
      `audio-artifact:${(e as Error).message.slice(0, 120)}`,
      audioBilling,
    );
  }
}

// ---------------------------------------------------------------- submit
async function submitGeneration(
  admin: AnyClient,
  userId: string,
  raw: Record<string, unknown>,
): Promise<{ id: string; status: JobStatus; reused: boolean }> {
  // --- kill switch: the SAME config row that governs every video tool ------
  const { data: cfg } = await admin
    .from("video_gen_config")
    .select("enabled, daily_cap, audio_enabled")
    .eq("id", true)
    .maybeSingle();
  if (!cfg || cfg.enabled === false) throw new Error("video generation is disabled");

  // --- daily cap, SHARED with the Runway tool: one budget, not one each ----
  const [runway, gpu] = await Promise.all([
    admin
      .from("video_jobs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfUtcDay()),
    admin
      .from("gpu_video_jobs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfUtcDay()),
  ]);
  const usedToday = (runway.count ?? 0) + (gpu.count ?? 0);
  if (usedToday >= cfg.daily_cap) {
    throw new Error(`daily cap reached (${usedToday}/${cfg.daily_cap})`);
  }

  // --- the client's words, bounded ----------------------------------------
  const validated = validateRequest(raw);
  if (!validated.ok) throw new Error(`request refused: ${validated.reason}`);
  const request = validated.request;

  // --- audio production gate (owner flip, Phase 21): default OFF -----------
  if (request.audio === "narration" && cfg.audio_enabled !== true) {
    throw new Error("voice-over is not enabled yet");
  }

  // --- idempotency: a repeat returns the job it already has ----------------
  const { data: existing } = await admin
    .from("gpu_video_jobs")
    .select("id, status")
    .eq("created_by", userId)
    .eq("idempotency_key", request.idempotencyKey)
    .maybeSingle();
  if (existing && idempotentReuse(existing as { status: JobStatus })) {
    return { id: existing.id, status: existing.status as JobStatus, reused: true };
  }

  // --- orphan guard + concurrency 1 (production limit) ---------------------
  const { data: open } = await admin
    .from("gpu_video_jobs")
    .select("id, status")
    .not("status", "in", "(completed,failed,timed-out,cancelled)")
    .limit(1);
  if (open?.length) {
    const status = (open[0] as { status: string }).status;
    if (status === "orphaned") {
      throw new Error("a previous job needs operator attention; new jobs are paused");
    }
    throw new Error("a generation is already running — one at a time");
  }

  // --- the watermark entitlement OF RECORD, derived server-side ------------
  // Read at submit and burned onto the row: the export layer reads THIS,
  // never a client flag. (Clip exports do not carry a burned mark yet; the
  // column is the entitlement the burn capability will honor.)
  const { data: cleanFlag } = await admin.rpc("has_entitlement", {
    _user: userId,
    _key: "no_watermark",
  });

  // --- the row exists before the money moves -------------------------------
  const { data: row, error: insertErr } = await admin
    .from("gpu_video_jobs")
    .insert({
      created_by: userId,
      idempotency_key: request.idempotencyKey,
      prompt: request.prompt,
      input_ref: request.referenceId,
      output_ref: "pending",
      status: "queued",
      // Recorded explicitly from the same canonical constant admission and
      // proof use — never left to a column default that can go stale on a
      // card move (the 3090-era default did exactly that).
      gpu_type: TARGET_GPU_ID,
      audio_mode: request.audio,
      narration_text: request.audio === "narration" ? request.narrationText : null,
      no_watermark: cleanFlag === true,
    })
    .select("id")
    .single();
  if (insertErr || !row) {
    // A unique-index race on the idempotency key IS the duplicate case.
    const { data: raced } = await admin
      .from("gpu_video_jobs")
      .select("id, status")
      .eq("created_by", userId)
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (raced) return { id: raced.id, status: raced.status as JobStatus, reused: true };
    throw new Error("could not record the job");
  }
  const jobId = row.id as string;
  await setJob(admin, jobId, { output_ref: outputRefFor(jobId) });

  // --- finished-video-time reservation, fail closed ------------------------
  // Owner directive 2026-08-27: entitlement is determined and the allowance
  // atomically reserved BEFORE any provider money moves. A refusal here has
  // spent nothing anywhere — provider or customer.
  const reserved = await reserveTime(admin, userId, jobId);
  if (!reserved.ok) {
    await setJob(admin, jobId, {
      status: "failed",
      error: `entitlement:${reserved.reason ?? "refused"}`,
    });
    throw new Error(
      reserved.reason === "exhausted"
        ? "You are out of video time."
        : "Video time could not be reserved — nothing was generated.",
    );
  }

  // --- live quote + admission, fail closed ---------------------------------
  let price: number | null = null;
  try {
    price = await liveTargetGpuPriceUsd();
  } catch (e) {
    console.error("[gpu-video] quote failed", (e as Error).message);
  }
  const admission = admitGeneration(price);
  if (!admission.ok) {
    await setJob(admin, jobId, { status: "failed", error: `admission:${admission.reason}` });
    await releaseTime(admin, jobId);
    throw new Error(`generation refused: ${admission.reason}`);
  }
  await setJob(admin, jobId, {
    status: "admitted",
    price_per_hour_usd: price,
    reservation_usd: admission.reservationUsd,
  });

  // --- exactly one billable submission -------------------------------------
  try {
    const runpodJobId = await runpodSubmit(buildWorkerPayload(request, jobId));
    await setJob(admin, jobId, {
      status: "provisioning",
      runpod_job_id: runpodJobId,
      started_at: new Date().toISOString(),
    });
    return { id: jobId, status: "provisioning", reused: false };
  } catch (e) {
    await setJob(admin, jobId, {
      status: "failed",
      error: `submit:${(e as Error).message.slice(0, 160)}`,
    });
    // No provider job exists, so no artifact ever will: full refund.
    await releaseTime(admin, jobId);
    throw e;
  }
}

// ------------------------------------------------------------------ poll
/**
 * Advance open jobs. A NON-ADMIN caller advances only their own — so the
 * only clients that can ever race on one job's paid audio fork are the same
 * user's own tabs, exactly the exposure the admin-only era already carried.
 * The operator view still advances everything.
 */
async function pollGenerations(
  admin: AnyClient,
  scopeUserId: string | null,
): Promise<{ checked: number }> {
  const openQuery = admin
    .from("gpu_video_jobs")
    .select("*")
    .not("status", "in", "(completed,failed,timed-out,cancelled,orphaned)")
    .limit(5);
  const { data: jobs } = await (scopeUserId ? openQuery.eq("created_by", scopeUserId) : openQuery);

  for (const job of jobs ?? []) {
    // Watchdog first: nothing waits forever, and nothing re-submits itself.
    // One wall-clock window covers BOTH paid steps of a voice-over job; the
    // cancel targets whichever provider run is currently live.
    if (watchdogExpired(job.created_at, Date.now())) {
      const liveRunId =
        job.status === "audio_generating" ? job.audio_runpod_job_id : job.runpod_job_id;
      let cancelled = false;
      if (liveRunId) {
        try {
          cancelled = await runpodCancel(liveRunId);
        } catch {
          cancelled = false;
        }
      }
      await setJob(admin, job.id, {
        status: cancelled || !liveRunId ? "timed-out" : "orphaned",
        error: `watchdog: exceeded ${WATCHDOG_SECONDS}s wall clock`,
        completed_at: new Date().toISOString(),
      });
      // Nothing usable was delivered: the customer's reservation goes back.
      await releaseTime(admin, job.id);
      continue;
    }
    if (job.status === "audio_generating") {
      await pollAudioRun(admin, job);
      continue;
    }
    if (!job.runpod_job_id) continue;

    let state: RunpodStatus;
    try {
      state = await runpodStatus(job.runpod_job_id);
    } catch (e) {
      console.warn("[gpu-video] status read failed", (e as Error).message);
      continue; // transient read failure changes nothing
    }

    const mapped = statusFromPoll(state.status);
    if (mapped === "provisioning" || mapped === "running") {
      if (mapped !== job.status) await setJob(admin, job.id, { status: mapped });
      continue;
    }
    if (mapped === "failed" || mapped === "cancelled" || mapped === "timed-out") {
      const code =
        state.output && typeof state.output === "object"
          ? String((state.output as Record<string, unknown>).code ?? state.status)
          : state.status;
      await setJob(admin, job.id, {
        status: mapped,
        error: `worker:${code}`.slice(0, 160),
        completed_at: new Date().toISOString(),
      });
      await releaseTime(admin, job.id);
      continue;
    }
    if (mapped !== "uploading") continue; // unknown provider vocabulary: leave it

    // COMPLETED from the provider — now the proof, then custody, then done.
    const verdict = verifyWorkerOutput(state.output);
    if (!verdict.ok) {
      await setJob(admin, job.id, {
        status: "failed",
        error: `proof:${verdict.reason}`,
        completed_at: new Date().toISOString(),
      });
      await releaseTime(admin, job.id);
      continue;
    }
    const out = state.output as Record<string, unknown>;
    const expectedBytes = out.output_bytes as number;
    const billedSeconds = state.executionTime !== null ? state.executionTime / 1000 : null;
    const actual = gpuActualUsd(job.price_per_hour_usd, billedSeconds);
    // The worker enforces the 900s execution ceiling; a bill implying it was
    // breached is an anomaly, and an anomaly is a failure, not a discount.
    if (billedSeconds !== null && billedSeconds > 900) {
      await setJob(admin, job.id, {
        status: "failed",
        error: "billing-anomaly: executionTime exceeds the 900s ceiling",
        completed_at: new Date().toISOString(),
      });
      continue;
    }

    const videoBilling = {
      billed_seconds: billedSeconds,
      actual_cost_usd: actual,
      output_bytes: expectedBytes,
      video_seconds: typeof out.video_seconds === "number" ? out.video_seconds : null,
    };

    // --- the fork: silent jobs finish here; voice-over jobs speak next -----
    if (job.audio_mode === "narration" && job.narration_text) {
      // The silent source STAYS in R2 as the mux input; the row records the
      // video step's billing before the second paid step begins.
      await setJob(admin, job.id, videoBilling);
      await submitAudioRun(admin, { ...job, ...videoBilling });
      continue;
    }

    await setJob(admin, job.id, { status: "uploading" });
    let stored: string | null = null;
    try {
      stored = await custodyArtifact(admin, job.id, job.output_ref, expectedBytes);
    } catch (e) {
      // completed is never reported without a verified artifact in custody.
      await setJob(admin, job.id, {
        status: "failed",
        error: `artifact:${(e as Error).message.slice(0, 140)}`,
        completed_at: new Date().toISOString(),
      });
      await releaseTime(admin, job.id);
      continue;
    }
    await setJob(admin, job.id, {
      status: "completed",
      stored_path: stored,
      ...videoBilling,
      error: null,
      completed_at: new Date().toISOString(),
    });
    // Delivered: charge the MEASURED finished duration, refund the rest.
    await settleTime(admin, job.id, out.video_seconds);
  }
  return { checked: jobs?.length ?? 0 };
}

// ------------------------------------------------------------------- serve
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ error: "Unauthorized" }, 401);

  let payload: { action?: string; request?: Record<string, unknown>; path?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // The caller's own identity — the screen is not the gate.
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);
  const userId = userRes.user.id;

  // Admin is a VIEW, not the gate (owner directive 2026-08-27): signed-in
  // users generate; only the unscoped operator view stays admin. A failed
  // flag read degrades to the scoped user view rather than refusing.
  const { data: adminFlag } = await asCaller.rpc("is_admin", { _uid: userId });
  const isAdmin = adminFlag === true;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    switch (payload.action) {
      case "status": {
        // A user sees ONLY their own jobs, and only the columns the panel
        // renders — never provider ids, quotes or ONIQ's costs. The admin
        // keeps the full operator view the tool always had.
        const jobsQuery = admin
          .from("gpu_video_jobs")
          .select(isAdmin ? "*" : USER_JOB_COLUMNS)
          .order("created_at", { ascending: false })
          .limit(25);
        const [{ data: jobs }, { data: cfg }] = await Promise.all([
          isAdmin ? jobsQuery : jobsQuery.eq("created_by", userId),
          admin
            .from("video_gen_config")
            .select("enabled, audio_enabled")
            .eq("id", true)
            .maybeSingle(),
        ]);
        return json({
          jobs: jobs ?? [],
          enabled: cfg?.enabled ?? false,
          audioEnabled: cfg?.audio_enabled === true,
          // Presence of the NAMES only — never values.
          configured: Boolean(
            Deno.env.get("RUNPOD_API_KEY") &&
            Deno.env.get("RUNPOD_ENDPOINT_ID") &&
            Deno.env.get("R2_PUBLIC_BASE_URL"),
          ),
        });
      }
      case "submit": {
        const result = await submitGeneration(admin, userId, payload.request ?? {});
        return json(result);
      }
      case "poll": {
        const result = await pollGenerations(admin, isAdmin ? null : userId);
        return json(result);
      }
      case "sign": {
        const path = String(payload.path ?? "");
        const match = /^gpu\/([0-9a-f-]{36})\.mp4$/.exec(path);
        if (!match) return json({ url: null });
        if (!isAdmin) {
          // A signed URL is delivery: only the job's own creator gets one.
          const { data: owned } = await admin
            .from("gpu_video_jobs")
            .select("id")
            .eq("id", match[1])
            .eq("created_by", userId)
            .maybeSingle();
          if (!owned) return json({ url: null });
        }
        const { data } = await admin.storage.from(RUNWAY_BUCKET).createSignedUrl(path, 60 * 60);
        return json({ url: data?.signedUrl ?? null });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || "request failed" }, 400);
  }
});
