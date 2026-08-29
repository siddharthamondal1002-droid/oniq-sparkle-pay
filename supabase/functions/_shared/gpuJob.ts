// gpuJob — ONIQ's GPU compute contract. RunPod is one implementation of it.
//
// WHY A CONTRACT AND NOT A RUNPOD CLIENT. The goal is not to own a GPU; it is
// to have the cheapest reliable NVIDIA compute that is actually economic for
// ONIQ's workload. That sentence only stays true if the provider can be
// swapped when the price moves — and RunPod's prices move, which this loop
// found out the hard way (see GPU_AVAILABILITY_NOTE). So the application talks
// to `GpuProvider` and never to RunPod.
//
// HOW GPU SPEND DIFFERS FROM EVERY OTHER LEDGER ENTRY. Tokens and searches are
// billed per unit consumed: if the call fails, the units were small. A GPU is
// billed per SECOND OF WALL CLOCK, from the moment it boots, whether it is
// computing or idling or stuck. That inverts the risk. The dangerous failure
// is not an expensive job, it is a cheap job whose worker never stopped —
// $0.27/hour is nothing for four minutes and $194 for a month.
//
// Everything below follows from that: a reservation is a TIME budget, every
// job carries a hard runtime ceiling before it is admitted, and termination is
// unconditional rather than a success path.

import type { Capability } from "./financialLedger.ts";

/**
 * MEASURED against ONIQ's RunPod account, 2026-08-25, via the provider's own
 * API — not from a price page and not from memory.
 *
 *   pods existing        0
 *   serverless endpoints 0        (so nothing was billing at the time)
 *   RTX A5000 24GB       in the catalogue, secureCloud true,
 *                        lowestPrice NULL for both on-demand and spot
 *
 * A null price is RunPod saying it has none to allocate. The A5000 is
 * therefore NOT currently provisionable, and the $0.27/hour figure this loop
 * started from is unconfirmed — it must not be used as a reservation input.
 *
 * Cheapest available alternatives at >=16GB, from the same response:
 *
 *   RTX 4000 Ada SFF  20GB  $0.18/h  community only
 *   RTX A4500         20GB  $0.19/h  secure + community
 *   Tesla V100        16GB  $0.19/h  community only
 *   RTX 3090          24GB  $0.22/h  secure + community
 *   RTX 4090          24GB  $0.34/h  secure + community
 *
 * The 20GB and 16GB options are cheaper and are NOT substitutes: the parked
 * workload this GPU layer exists for (WAN 2.1 I2V-14B) needs 24-40GB, and
 * choosing less VRAM to save two cents produces a job that cannot run. The
 * V100 is additionally a Volta part without bf16, which modern video models
 * assume.
 *
 * SUPERSEDED for serverless, measured 2026-08-26: the null above was the
 * POD-market signal, and the owner's serverless rule (gpu-worker
 * validation/admission.py) reads secure_cloud + secure_price instead — the
 * A5000's secure list price measured $0.27/h live, the owner pinned
 * endpoint p3zmlv8ek10dzt to exactly that card, and the audio canary
 * admitted and billed against it the same day. This note stays as the
 * dated 08-25 evidence for why the pod signal is never the quote.
 */
export const GPU_AVAILABILITY_NOTE = {
  measuredAt: "2026-08-25",
  a5000: { inCatalogue: true, vramGb: 24, secureCloud: true, priceUsdPerHour: null },
  unconfirmedLegacyQuote: 0.27,
} as const;

/** GPU spend is its own capability. It does NOT share the SEARCH ceiling. */
export const GPU_CAPABILITY: Capability = "GPU";

/**
 * The GPUs ONIQ will run on, with the VRAM each actually has.
 *
 * An ALLOW-LIST, not a preference. A caller — including an authenticated user
 * driving a request — must never be able to name a GPU type, because "give me
 * 8x H100" is a $30/hour sentence typed by someone who does not pay the bill.
 *
 * WHICH card production runs on is not decided here: the app names exactly
 * one, gpuVideoCore's TARGET_GPU_ID (the A5000, owner-settled 2026-08-26),
 * and there is no fallback across rows. These rows only bound what may ever
 * be requested, with each card's real VRAM.
 */
export const ALLOWED_GPU_TYPES: Record<string, { vramGb: number; secureCloud: boolean }> = {
  "NVIDIA RTX A5000": { vramGb: 24, secureCloud: true },
  "NVIDIA GeForce RTX 3090": { vramGb: 24, secureCloud: true },
  "NVIDIA GeForce RTX 4090": { vramGb: 24, secureCloud: true },
};

/**
 * Hard ceiling per GPU job, owner's figure, 2026-08-25.
 *
 * Deliberately the same NUMBER as the SEARCH request cap and deliberately a
 * SEPARATE control: a GPU job and a search request have nothing in common
 * except that the owner picked $0.50 for both, and collapsing them would mean
 * a change to one silently moved the other.
 */
export const GPU_JOB_CAP_USD = 0.5;

/**
 * The longest any single job may hold a GPU, before admission.
 *
 * 15 minutes at $0.27/h is $0.0675 — comfortably inside the ceiling, and short
 * enough that a stuck worker is a rounding error rather than an incident. It
 * is a starting bound to be raised against measured runtimes, not a guess at
 * what video generation needs.
 */
export const MAX_GPU_RUNTIME_SECONDS = 900;

/** Idle without progress for this long and the worker is killed regardless. */
export const GPU_IDLE_TIMEOUT_SECONDS = 120;

// ---------------------------------------------------------------- the job
export type GpuWorkloadType =
  "image-preprocess" | "image-embed" | "vision-infer" | "video-generate";

export type GpuJobStatus =
  | "queued"
  | "admitted"
  | "provisioning"
  | "running"
  | "uploading"
  | "completed"
  | "failed"
  | "timed-out"
  | "cancelled";

/** A GPU job, bounded in every dimension that can run away. */
export type GpuJob = {
  jobId: string;
  requestId: string;
  userId?: string;
  workload: GpuWorkloadType;
  model: string;
  /** Object-storage references. The worker is never the source of truth. */
  inputRefs: string[];
  outputRef: string;
  gpuType: string;
  /** Wall-clock ceiling. Enforced before admission and again by the worker. */
  maxRuntimeSeconds: number;
  maxCostUsd: number;
  status: GpuJobStatus;
  provider: string;
  actualRuntimeSeconds: number | null;
  actualCostUsd: number | null;
  error: string | null;
};

// ---------------------------------------------------------------- the money
/**
 * What a GPU job must reserve: the worst case, which is the full runtime.
 *
 * Not the expected runtime. A job that finishes in twenty seconds and a job
 * that wedges for the full fifteen minutes are indistinguishable at admission
 * time, and only one of them is affordable to be wrong about.
 */
export function gpuReservationUsd(
  pricePerHourUsd: number | null,
  maxRuntimeSeconds: number,
): number | null {
  if (pricePerHourUsd === null || !Number.isFinite(pricePerHourUsd) || pricePerHourUsd <= 0) {
    return null;
  }
  if (!Number.isFinite(maxRuntimeSeconds) || maxRuntimeSeconds <= 0) return null;
  const bounded = Math.min(maxRuntimeSeconds, MAX_GPU_RUNTIME_SECONDS);
  return (pricePerHourUsd / 3600) * bounded;
}

/** Settlement: what the worker actually held, at the price actually charged. */
export function gpuActualUsd(
  pricePerHourUsd: number | null,
  billedSeconds: number | null,
): number | null {
  if (pricePerHourUsd === null || billedSeconds === null) return null;
  if (!Number.isFinite(billedSeconds) || billedSeconds < 0) return null;
  return (pricePerHourUsd / 3600) * billedSeconds;
}

export type AdmissionRefusal =
  | "gpu-type-not-allowed"
  | "gpu-unpriced"
  | "runtime-exceeds-ceiling"
  | "over-job-cap"
  | "insufficient-vram";

export type GpuAdmission =
  // reservationUsd is NULLABLE because the price gate is switchable: with
  // it off an unpriced GPU is admitted and there is genuinely no reservation
  // to quote. Null is "not measured", never 0 — the rule the orphan sweep
  // and the queue probe already follow.
  | { ok: true; reservationUsd: number | null; maxRuntimeSeconds: number }
  | { ok: false; reason: AdmissionRefusal };

/**
 * Everything that must hold BEFORE a worker exists.
 *
 * The order matters. VRAM is checked before price, because a job that cannot
 * fit is not made acceptable by being cheap — that is the mistake of picking a
 * 20GB card to save two cents and discovering it at runtime, having paid for
 * the boot.
 */
export function admitGpuJob(req: {
  gpuType: string;
  pricePerHourUsd: number | null;
  maxRuntimeSeconds: number;
  requiredVramGb: number;
  jobCapUsd?: number;
  /** Owner switch. Omit or true = refuse on price; false = measure only. */
  priceGate?: boolean;
}): GpuAdmission {
  const spec = ALLOWED_GPU_TYPES[req.gpuType];
  if (!spec) return { ok: false, reason: "gpu-type-not-allowed" };
  if (spec.vramGb < req.requiredVramGb) return { ok: false, reason: "insufficient-vram" };
  if (req.maxRuntimeSeconds > MAX_GPU_RUNTIME_SECONDS) {
    return { ok: false, reason: "runtime-exceeds-ceiling" };
  }
  const reservationUsd = gpuReservationUsd(req.pricePerHourUsd, req.maxRuntimeSeconds);
  // THE PRICE GATE, and only the price gate, is switchable.
  //
  // Everything above this line is technical and stays unconditional: an
  // unknown card, a card too small for the model, and a runtime past the
  // ceiling are all refused whatever the caller asks for. Those are the
  // checks that stop a job that cannot work; these two stop a job that
  // works but costs more than a rule allows, which is a different kind of
  // decision and the owner's to make.
  //
  // DEFAULT ON. `priceGate` must be explicitly false to skip these, so
  // every existing caller keeps the gate it was written with and no
  // workflow loses its ceiling by being forgotten.
  if (req.priceGate !== false) {
    // A null price is an UNAVAILABLE or unpriced GPU — the A5000's exact
    // state when this was written. Reserving against it would be reserving
    // nothing.
    if (reservationUsd === null) return { ok: false, reason: "gpu-unpriced" };
    const cap = req.jobCapUsd ?? GPU_JOB_CAP_USD;
    if (reservationUsd > cap) return { ok: false, reason: "over-job-cap" };
  }
  // The reservation is returned either way: with the gate off it stops
  // being a permission and stays a measurement.
  return { ok: true, reservationUsd, maxRuntimeSeconds: req.maxRuntimeSeconds };
}

// ---------------------------------------------------------------- the provider
export type ProvisionOutcome =
  | { ok: true; workerId: string; gpuType: string; pricePerHourUsd: number }
  | { ok: false; reason: "not-configured" | "unavailable" | "provider-error" | "timeout" };

export type TerminateOutcome = { ok: boolean; billedSeconds: number | null };

/**
 * What any GPU provider must offer.
 *
 * `terminate` returns billed seconds where the provider reports them, because
 * settling a GPU job on our own stopwatch would ignore the boot time we were
 * charged for.
 */
export type GpuProvider = {
  name: string;
  configured: boolean;
  /** Live price, or null when the provider has none to allocate. */
  priceFor(gpuType: string): Promise<number | null>;
  provision(spec: {
    gpuType: string;
    image: string;
    maxRuntimeSeconds: number;
  }): Promise<ProvisionOutcome>;
  terminate(workerId: string): Promise<TerminateOutcome>;
  listActive(): Promise<string[]>;
};

// ---------------------------------------------------------------- termination
export type TerminationReason =
  "completed" | "failed" | "timed-out" | "cancelled" | "idle" | "admission-rollback";

/**
 * Every reason a worker stops. There is no path that leaves one running.
 *
 * The list is exhaustive on purpose: the question "which outcomes terminate?"
 * has exactly one correct answer — all of them — and writing it as a union
 * makes a future outcome that forgets to terminate a type error rather than a
 * bill.
 */
export const TERMINATION_REASONS: readonly TerminationReason[] = [
  "completed",
  "failed",
  "timed-out",
  "cancelled",
  "idle",
  "admission-rollback",
] as const;

/**
 * Run a GPU job and terminate the worker no matter how it ends.
 *
 * `finally` rather than a success path, because the expensive failure is an
 * exception thrown between provisioning and cleanup. If terminate itself
 * fails, the worker id is returned as `orphan` so a reaper can chase it — a
 * lost worker must be loud, never swallowed.
 */
export async function withGpuWorker<T>(
  provider: GpuProvider,
  spec: { gpuType: string; image: string; maxRuntimeSeconds: number },
  run: (workerId: string) => Promise<T>,
): Promise<
  | { ok: true; value: T; billedSeconds: number | null; terminated: boolean; orphan?: string }
  | { ok: false; reason: string; billedSeconds: number | null; orphan?: string }
> {
  const p = await provider.provision(spec);
  if (!p.ok) {
    // Nothing was created, so there is nothing to bill and nothing to clean up.
    return { ok: false, reason: `provision-${p.reason}`, billedSeconds: null };
  }

  let value: T;
  let failure: string | null = null;
  try {
    value = await run(p.workerId);
  } catch (e) {
    failure = String((e as Error)?.message ?? e).slice(0, 200);
    value = undefined as T;
  }

  const t = await provider.terminate(p.workerId);
  const orphan = t.ok ? undefined : p.workerId;

  if (failure !== null) {
    return { ok: false, reason: failure, billedSeconds: t.billedSeconds, orphan };
  }
  return { ok: true, value, billedSeconds: t.billedSeconds, terminated: t.ok, orphan };
}
