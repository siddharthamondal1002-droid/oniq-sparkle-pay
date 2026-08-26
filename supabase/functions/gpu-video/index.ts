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
// The order is the same one every ONIQ generation tool enforces: admin gate
// -> kill switch -> daily cap -> validation -> financial admission on a LIVE
// quote -> one billable call. No batching, no retry.
//
// DELIBERATELY ABSENT from config.toml: the caller is a signed-in person, so
// the platform's verify_jwt gate applies, and the function still re-derives
// the user and checks is_admin itself — same shape as story-deliver.
//
// RUNPOD_API_KEY is read here and only here. Never returned, never logged,
// never in an error message — the NAME of a missing variable is operator
// information; no value ever is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithTimeout } from "../_shared/fetchTimeout.ts";
import { GPU_JOB_CAP_USD, gpuActualUsd } from "../_shared/gpuJob.ts";
import {
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
 * Live RTX 3090 Secure Cloud price — quoted NOW, never reused, never
 * defaulted. A null lowestPrice is RunPod saying it has none to allocate,
 * and an unprovisionable GPU must refuse admission rather than queue blind.
 */
async function live3090PriceUsd(): Promise<number | null> {
  const query =
    "query { gpuTypes { id securePrice lowestPrice(input: {gpuCount: 1}) { uninterruptablePrice } } }";
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
  const gpu = doc.data?.gpuTypes?.find((g) => g.id === "NVIDIA GeForce RTX 3090");
  if (!gpu) return null;
  const secure = gpu.securePrice;
  const lowest = (gpu.lowestPrice as { uninterruptablePrice?: unknown } | null)
    ?.uninterruptablePrice;
  if (typeof secure !== "number" || secure <= 0) return null;
  if (typeof lowest !== "number" || lowest <= 0) return null; // no capacity to allocate
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
  } catch (e) {
    await setJob(admin, job.id as string, {
      status: "failed",
      audio_error: audioError.slice(0, 160),
      ...audioBilling,
      error: `artifact:${(e as Error).message.slice(0, 140)}`,
      completed_at: new Date().toISOString(),
    });
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
    price = await live3090PriceUsd();
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
  try {
    const runpodJobId = await runpodSubmit(
      buildAudioMuxPayload(job.narration_text as string, job.id as string),
    );
    await setJob(admin, job.id as string, {
      status: "audio_generating",
      audio_runpod_job_id: runpodJobId,
      // The audio run's OWN live quote — the video step's rate is history
      // by now, and history is exactly what a bill must never be priced on.
      audio_price_per_hour_usd: price,
    });
  } catch (e) {
    await salvageSilent(admin, job, `audio-submit:${(e as Error).message.slice(0, 120)}`);
  }
}

/** One voice-over job's audio run, polled to its verdict. */
async function pollAudioRun(admin: AnyClient, job: Record<string, unknown>): Promise<void> {
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
    await salvageSilent(admin, job, "audio-billing-anomaly: executionTime exceeds the 900s ceiling", audioBilling);
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
      narration_seconds:
        typeof out.narration_seconds === "number" ? out.narration_seconds : null,
      ...audioBilling,
      audio_error: null,
      error: null,
      completed_at: new Date().toISOString(),
    });
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
      audio_mode: request.audio,
      narration_text: request.audio === "narration" ? request.narrationText : null,
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

  // --- live quote + admission, fail closed ---------------------------------
  let price: number | null = null;
  try {
    price = await live3090PriceUsd();
  } catch (e) {
    console.error("[gpu-video] quote failed", (e as Error).message);
  }
  const admission = admitGeneration(price);
  if (!admission.ok) {
    await setJob(admin, jobId, { status: "failed", error: `admission:${admission.reason}` });
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
    throw e;
  }
}

// ------------------------------------------------------------------ poll
async function pollGenerations(admin: AnyClient): Promise<{ checked: number }> {
  const { data: jobs } = await admin
    .from("gpu_video_jobs")
    .select("*")
    .not("status", "in", "(completed,failed,timed-out,cancelled,orphaned)")
    .limit(5);

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
      continue;
    }
    await setJob(admin, job.id, {
      status: "completed",
      stored_path: stored,
      ...videoBilling,
      error: null,
      completed_at: new Date().toISOString(),
    });
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

  const { data: adminFlag, error: adminErr } = await asCaller.rpc("is_admin", { _uid: userId });
  if (adminErr || adminFlag !== true) {
    console.warn(`[gpu-video] refused: non-admin caller ${userId}`);
    return json({ error: "forbidden" }, 403);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    switch (payload.action) {
      case "status": {
        const [{ data: jobs }, { data: cfg }] = await Promise.all([
          admin
            .from("gpu_video_jobs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(25),
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
        const result = await pollGenerations(admin);
        return json(result);
      }
      case "sign": {
        const path = String(payload.path ?? "");
        if (!/^gpu\/[0-9a-f-]{36}\.mp4$/.test(path)) return json({ url: null });
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
