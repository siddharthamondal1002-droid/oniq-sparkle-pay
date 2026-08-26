// In-house GPU video generation — server-only orchestration.
//
// Owner directive 2026-08-26: this is the PRIMARY video path. The order is
// the same one every ONIQ generation tool enforces: admin gate -> kill
// switch -> daily cap -> validation -> financial admission on a LIVE quote
// -> one billable call. No batching, no retry — a failing prompt fails
// identically every time, and a GPU bills wall-clock from boot.
//
// RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID are read here and only here. They
// are never returned to the browser, never logged, never in an error
// message. R2 stays worker-side: this server holds NO R2 credentials — the
// finished clip is fetched from the bucket's public dev URL and taken into
// custody in Supabase storage (video-gen), then played via signed URLs like
// every other generated clip.
//
// Decisions live in src/lib/gpuVideoFlow.ts (pure, vitest-proved); this
// file is transport: secrets, sockets, rows.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { RUNWAY_BUCKET, requireAdmin } from "./runway.server";
import {
  TARGET_GPU_ID,
  TERMINAL_STATUSES,
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
  type JobStatus,
} from "./gpuVideoFlow";
import { gpuActualUsd } from "../../supabase/functions/_shared/gpuJob.ts";

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";
const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2";
// Cloudflare fronts api.runpod.io and bans default library agents outright
// (error 1010, measured 2026-08-25 in the validation harness).
const USER_AGENT = "oniq-gpu-video/1.0 (oniq server)";

export type GpuJobRow = {
  id: string;
  created_by: string;
  idempotency_key: string;
  provider: string;
  model: string;
  gpu_type: string;
  prompt: string;
  input_ref: string;
  output_ref: string;
  runpod_job_id: string | null;
  status: JobStatus;
  price_per_hour_usd: number | null;
  reservation_usd: number | null;
  billed_seconds: number | null;
  actual_cost_usd: number | null;
  output_bytes: number | null;
  video_seconds: number | null;
  stored_path: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

/**
 * gpu_video_jobs is not in the generated Supabase types yet (same timing gap
 * storyJobsClient documents for story_jobs): the migration is applied, the
 * generated file has not been regenerated. Narrowed to this one helper; to
 * be deleted the moment the types catch up.
 */
function gpuJobs(admin: SupabaseClient<Database>) {
  return (admin as unknown as { from: (t: string) => ReturnType<SupabaseClient["from"]> }).from(
    "gpu_video_jobs",
  );
}

function envOrThrow(name: "RUNPOD_API_KEY" | "RUNPOD_ENDPOINT_ID" | "R2_PUBLIC_BASE_URL"): string {
  const v = process.env[name];
  // The NAME of the missing variable is operator information; no value ever is.
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
 * 2026-08-26): serverless bills the SECURE price; the pod-market
 * lowestPrice is not consulted (its null flapped across three cards in
 * one evening while every secure price stayed firm). A missing or
 * non-positive secure price returns null, and null refuses admission.
 */
export async function liveTargetGpuPriceUsd(): Promise<number | null> {
  const query = "query { gpuTypes { id securePrice } }";
  const res = await fetch(RUNPOD_GRAPHQL, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    console.error(`[gpu-video] price quote upstream ${res.status}`);
    return null;
  }
  const doc = (await res.json()) as {
    data?: { gpuTypes?: Array<Record<string, unknown>> };
  };
  const gpu = doc.data?.gpuTypes?.find((g) => g.id === TARGET_GPU_ID);
  if (!gpu) return null;
  const secure = gpu.securePrice;
  if (typeof secure !== "number" || secure <= 0) return null;
  return secure;
}

async function runpodSubmit(payload: Record<string, unknown>): Promise<string> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetch(`${RUNPOD_SERVERLESS}/${endpoint}/run`, {
    method: "POST",
    headers: runpodHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`[gpu-video] submit upstream ${res.status}`);
    throw new Error(`gpu provider rejected the request (${res.status})`);
  }
  const parsed = (await res.json()) as { id?: string };
  if (!parsed.id) throw new Error("gpu provider returned no job id");
  return parsed.id;
}

type RunpodStatus = {
  status: string;
  executionTime: number | null;
  output: unknown;
};

async function runpodStatus(jobId: string): Promise<RunpodStatus> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetch(`${RUNPOD_SERVERLESS}/${endpoint}/status/${encodeURIComponent(jobId)}`, {
    headers: runpodHeaders(),
  });
  if (!res.ok) {
    console.error(`[gpu-video] status upstream ${res.status}`);
    throw new Error(`could not read gpu job (${res.status})`);
  }
  const body = (await res.json()) as {
    status?: string;
    executionTime?: number;
    output?: unknown;
  };
  return {
    status: String(body.status ?? "UNKNOWN"),
    executionTime: typeof body.executionTime === "number" ? body.executionTime : null,
    output: body.output,
  };
}

async function runpodCancel(jobId: string): Promise<boolean> {
  const endpoint = envOrThrow("RUNPOD_ENDPOINT_ID");
  const res = await fetch(`${RUNPOD_SERVERLESS}/${endpoint}/cancel/${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: runpodHeaders(),
  });
  return res.ok;
}

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function setJob(
  admin: SupabaseClient<Database>,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await gpuJobs(admin).update(patch).eq("id", id);
  if (error) console.error("[gpu-video] row update failed", error.message);
}

// ---------------------------------------------------------------- submit
export async function submitGeneration(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  raw: Record<string, unknown>,
): Promise<{ id: string; status: JobStatus; reused: boolean }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  // --- kill switch: the SAME config row that governs every video tool ------
  const { data: cfg } = await supabaseAdmin
    .from("video_gen_config")
    .select("enabled, daily_cap")
    .eq("id", true)
    .maybeSingle();
  if (!cfg || cfg.enabled === false) throw new Error("video generation is disabled");

  // --- daily cap, SHARED with the Runway tool: one budget, not one each ----
  const [runway, gpu] = await Promise.all([
    supabaseAdmin
      .from("video_jobs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfUtcDay()),
    gpuJobs(supabaseAdmin)
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

  // --- idempotency: a repeat returns the job it already has ----------------
  const { data: existing } = await gpuJobs(supabaseAdmin)
    .select("id, status")
    .eq("created_by", userId)
    .eq("idempotency_key", request.idempotencyKey)
    .maybeSingle();
  if (existing && idempotentReuse(existing as { status: JobStatus })) {
    return {
      id: (existing as { id: string }).id,
      status: (existing as { status: JobStatus }).status,
      reused: true,
    };
  }

  // --- orphan guard + concurrency 1 (production limit) ---------------------
  const { data: open } = await gpuJobs(supabaseAdmin)
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
  const { data: row, error: insertErr } = await gpuJobs(supabaseAdmin)
    .insert({
      created_by: userId,
      idempotency_key: request.idempotencyKey,
      prompt: request.prompt,
      input_ref: request.referenceId,
      output_ref: "pending",
      status: "queued",
      // Same canonical constant admission and proof use — never the column
      // default, which can go stale on a card move.
      gpu_type: TARGET_GPU_ID,
    })
    .select("id")
    .single();
  if (insertErr || !row) {
    // A unique-index race on the idempotency key IS the duplicate case.
    const { data: raced } = await gpuJobs(supabaseAdmin)
      .select("id, status")
      .eq("created_by", userId)
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (raced) {
      return {
        id: (raced as { id: string }).id,
        status: (raced as { status: JobStatus }).status,
        reused: true,
      };
    }
    throw new Error("could not record the job");
  }
  const jobId = (row as { id: string }).id;
  await setJob(supabaseAdmin, jobId, { output_ref: outputRefFor(jobId) });

  // --- live quote + admission, fail closed ---------------------------------
  let price: number | null = null;
  try {
    price = await liveTargetGpuPriceUsd();
  } catch (e) {
    console.error("[gpu-video] quote failed", (e as Error).message);
  }
  const admission = admitGeneration(price);
  if (!admission.ok) {
    await setJob(supabaseAdmin, jobId, {
      status: "failed",
      error: `admission:${admission.reason}`,
    });
    throw new Error(`generation refused: ${admission.reason}`);
  }
  await setJob(supabaseAdmin, jobId, {
    status: "admitted",
    price_per_hour_usd: price,
    reservation_usd: admission.reservationUsd,
  });

  // --- exactly one billable submission -------------------------------------
  try {
    const runpodJobId = await runpodSubmit(buildWorkerPayload(request, jobId));
    await setJob(supabaseAdmin, jobId, {
      status: "provisioning",
      runpod_job_id: runpodJobId,
      started_at: new Date().toISOString(),
    });
    return { id: jobId, status: "provisioning", reused: false };
  } catch (e) {
    await setJob(supabaseAdmin, jobId, {
      status: "failed",
      error: `submit:${(e as Error).message.slice(0, 160)}`,
    });
    throw e;
  }
}

// ------------------------------------------------------------------ poll
export async function pollGenerations(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ checked: number }> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);

  const { data: jobs } = await gpuJobs(supabaseAdmin)
    .select("*")
    .not("status", "in", "(completed,failed,timed-out,cancelled,orphaned)")
    .limit(5);

  for (const job of (jobs ?? []) as GpuJobRow[]) {
    // Watchdog first: nothing waits forever, and nothing re-submits itself.
    if (watchdogExpired(job.created_at, Date.now())) {
      let cancelled = false;
      if (job.runpod_job_id) {
        try {
          cancelled = await runpodCancel(job.runpod_job_id);
        } catch {
          cancelled = false;
        }
      }
      await setJob(supabaseAdmin, job.id, {
        status: cancelled || !job.runpod_job_id ? "timed-out" : "orphaned",
        error: `watchdog: exceeded ${WATCHDOG_SECONDS}s wall clock`,
        completed_at: new Date().toISOString(),
      });
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
      if (mapped !== job.status) await setJob(supabaseAdmin, job.id, { status: mapped });
      continue;
    }
    if (mapped === "failed" || mapped === "cancelled" || mapped === "timed-out") {
      const code =
        state.output && typeof state.output === "object"
          ? String((state.output as Record<string, unknown>).code ?? state.status)
          : state.status;
      await setJob(supabaseAdmin, job.id, {
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
      await setJob(supabaseAdmin, job.id, {
        status: "failed",
        error: `proof:${verdict.reason}`,
        completed_at: new Date().toISOString(),
      });
      continue;
    }
    await setJob(supabaseAdmin, job.id, { status: "uploading" });

    const out = state.output as Record<string, unknown>;
    const expectedBytes = out.output_bytes as number;
    let stored: string | null = null;
    try {
      const base = envOrThrow("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
      const res = await fetch(`${base}/${job.output_ref}`);
      if (!res.ok) throw new Error(`artifact fetch ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const artifact = verifyStoredArtifact(bytes, expectedBytes);
      if (!artifact.ok) throw new Error(artifact.reason);
      const path = `gpu/${job.id}.mp4`;
      const { error } = await supabaseAdmin.storage
        .from(RUNWAY_BUCKET)
        .upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`store: ${error.message}`);
      stored = path;
    } catch (e) {
      // completed is never reported without a verified artifact in custody.
      await setJob(supabaseAdmin, job.id, {
        status: "failed",
        error: `artifact:${(e as Error).message.slice(0, 140)}`,
        completed_at: new Date().toISOString(),
      });
      continue;
    }

    const billedSeconds = state.executionTime !== null ? state.executionTime / 1000 : null;
    const actual = gpuActualUsd(job.price_per_hour_usd, billedSeconds);
    // The worker enforces the 900s execution ceiling; a bill implying it was
    // breached is an anomaly, and an anomaly is a failure, not a discount.
    if (billedSeconds !== null && billedSeconds > 900) {
      await setJob(supabaseAdmin, job.id, {
        status: "failed",
        error: "billing-anomaly: executionTime exceeds the 900s ceiling",
        completed_at: new Date().toISOString(),
      });
      continue;
    }
    await setJob(supabaseAdmin, job.id, {
      status: "completed",
      stored_path: stored,
      billed_seconds: billedSeconds,
      actual_cost_usd: actual,
      output_bytes: expectedBytes,
      video_seconds: typeof out.video_seconds === "number" ? out.video_seconds : null,
      error: null,
      completed_at: new Date().toISOString(),
    });
  }
  return { checked: jobs?.length ?? 0 };
}

// ------------------------------------------------------------------ reads
export type GpuStatusResult = {
  jobs: GpuJobRow[];
  enabled: boolean;
  configured: boolean;
};

export async function listGenerations(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<GpuStatusResult> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);
  const [{ data: jobs }, { data: cfg }] = await Promise.all([
    gpuJobs(supabaseAdmin).select("*").order("created_at", { ascending: false }).limit(25),
    supabaseAdmin.from("video_gen_config").select("enabled").eq("id", true).maybeSingle(),
  ]);
  return {
    jobs: (jobs ?? []) as GpuJobRow[],
    enabled: cfg?.enabled ?? false,
    // Presence of the NAMES only — never values.
    configured: Boolean(
      process.env["RUNPOD_API_KEY"] &&
      process.env["RUNPOD_ENDPOINT_ID"] &&
      process.env["R2_PUBLIC_BASE_URL"],
    ),
  };
}

/**
 * Server-side wiring check, built because production has NO readable server
 * logs: when a link in the chain breaks (env, admin flag, the service-role
 * client), the browser sees an opaque 500 and this page is the only place
 * the truth can surface. Booleans, variable NAMES and bounded error codes
 * only — never a value. Auth-gated but deliberately NOT admin-gated: it
 * must keep working when the admin chain itself is what is broken.
 */
export type GpuDiag = {
  env: Record<
    | "SUPABASE_URL"
    | "SUPABASE_SERVICE_ROLE_KEY"
    | "RUNPOD_API_KEY"
    | "RUNPOD_ENDPOINT_ID"
    | "R2_PUBLIC_BASE_URL",
    boolean
  >;
  isAdmin: boolean | string;
  adminClient: string;
  table: string;
};

export async function diagGeneration(
  userSupabase: SupabaseClient<Database>,
  userId: string,
): Promise<GpuDiag> {
  const env = {
    SUPABASE_URL: Boolean(process.env["SUPABASE_URL"]),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]),
    RUNPOD_API_KEY: Boolean(process.env["RUNPOD_API_KEY"]),
    RUNPOD_ENDPOINT_ID: Boolean(process.env["RUNPOD_ENDPOINT_ID"]),
    R2_PUBLIC_BASE_URL: Boolean(process.env["R2_PUBLIC_BASE_URL"]),
  };

  let isAdmin: boolean | string;
  try {
    const { data, error } = await userSupabase.rpc("is_admin", { _uid: userId });
    isAdmin = error ? `error:${error.message.slice(0, 80)}` : data === true;
  } catch (e) {
    isAdmin = `error:${(e as Error).message.slice(0, 80)}`;
  }

  let adminClient = "ok";
  let table = "unchecked";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    void supabaseAdmin;
    try {
      const { error } = await (supabaseAdmin as unknown as SupabaseClient<Database>)
        .from("gpu_video_jobs" as never)
        .select("id", { count: "exact", head: true });
      table = error ? `error:${error.message.slice(0, 120)}` : "ok";
    } catch (e) {
      table = `error:${(e as Error).message.slice(0, 120)}`;
    }
  } catch (e) {
    // client.server's own error text names variables, never values.
    adminClient = `error:${(e as Error).message.slice(0, 140)}`;
  }

  return { env, isAdmin, adminClient, table };
}

/** Signed playback URL for a completed generation's custody copy. */
export async function signGenerated(
  userSupabase: SupabaseClient<Database>,
  userId: string,
  path: string,
): Promise<string | null> {
  const { supabaseAdmin } = await requireAdmin(userSupabase, userId);
  if (!/^gpu\/[0-9a-f-]{36}\.mp4$/.test(path)) return null;
  const { data } = await supabaseAdmin.storage.from(RUNWAY_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export { TERMINAL_STATUSES };
