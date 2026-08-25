/**
 * GPU COMPUTE CONTRACT — owner loop, 2026-08-25.
 *
 * GPU spend behaves unlike every other line in this ledger. A token call that
 * fails cost almost nothing; a GPU that fails costs whatever it was rented for,
 * because billing runs on wall clock from boot to termination regardless of
 * whether anything is computing.
 *
 * So the tests here are not really about inference. They are about the one
 * failure that is expensive out of all proportion to its likelihood: a worker
 * that started and never stopped. $0.22/hour is $0.015 for four minutes and
 * $158 for a month, and nothing in a green test run tells you which one you
 * are living in.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_GPU_TYPES,
  GPU_AVAILABILITY_NOTE,
  GPU_CAPABILITY,
  GPU_IDLE_TIMEOUT_SECONDS,
  GPU_JOB_CAP_USD,
  type GpuProvider,
  MAX_GPU_RUNTIME_SECONDS,
  TERMINATION_REASONS,
  admitGpuJob,
  gpuActualUsd,
  gpuReservationUsd,
  withGpuWorker,
} from "../../../supabase/functions/_shared/gpuJob.ts";

/** RTX 3090 at the price RunPod's API actually quoted on 2026-08-25. */
const PRICE_3090 = 0.22;
const GPU_3090 = "NVIDIA GeForce RTX 3090";

function fakeProvider(over: Partial<GpuProvider> & { failTerminate?: boolean } = {}) {
  const state = { provisioned: 0, terminated: 0, active: new Set<string>() };
  const p: GpuProvider & { state: typeof state } = {
    name: "fake",
    configured: true,
    state,
    async priceFor() {
      return PRICE_3090;
    },
    async provision() {
      state.provisioned += 1;
      const id = `w-${state.provisioned}`;
      state.active.add(id);
      return { ok: true as const, workerId: id, gpuType: GPU_3090, pricePerHourUsd: PRICE_3090 };
    },
    async terminate(id: string) {
      state.terminated += 1;
      if (over.failTerminate) return { ok: false, billedSeconds: 42 };
      state.active.delete(id);
      return { ok: true, billedSeconds: 42 };
    },
    async listActive() {
      return [...state.active];
    },
    ...over,
  };
  return p;
}

// ============================================================ PHASES 2-3
describe("what the provider's API actually said", () => {
  it("records that the A5000 had NO price, so it was not provisionable", () => {
    // A null lowestPrice is RunPod saying it has none to allocate. The loop's
    // $0.27/hour starting figure was never confirmed by the API.
    expect(GPU_AVAILABILITY_NOTE.a5000.inCatalogue).toBe(true);
    expect(GPU_AVAILABILITY_NOTE.a5000.vramGb).toBe(24);
    expect(GPU_AVAILABILITY_NOTE.a5000.priceUsdPerHour).toBeNull();
  });

  it("refuses to admit a job on an unpriced GPU", () => {
    // This is the A5000's exact state. Reserving against a null price would
    // be reserving nothing at all.
    const a = admitGpuJob({
      gpuType: "NVIDIA RTX A5000",
      pricePerHourUsd: null,
      maxRuntimeSeconds: 300,
      requiredVramGb: 24,
    });
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.reason).toBe("gpu-unpriced");
  });
});

// ============================================================ PHASE 8 money
describe("GPU spend is time, and reserved as the worst case", () => {
  it("is its own capability, not folded into SEARCH", () => {
    // Same number as the search cap, deliberately a different control.
    expect(GPU_CAPABILITY).toBe("GPU");
    expect(GPU_JOB_CAP_USD).toBe(0.5);
  });

  it("reserves the FULL runtime, not an expected one", () => {
    // 900s at $0.22/h.
    expect(gpuReservationUsd(PRICE_3090, 900)).toBeCloseTo((0.22 / 3600) * 900, 10);
    expect(gpuReservationUsd(PRICE_3090, 900)).toBeCloseTo(0.055, 6);
  });

  it("clamps a runtime request to the ceiling rather than trusting it", () => {
    expect(gpuReservationUsd(PRICE_3090, 999_999)).toBeCloseTo(
      gpuReservationUsd(PRICE_3090, MAX_GPU_RUNTIME_SECONDS)!,
      12,
    );
  });

  it("returns null — never zero — for an unpriced or nonsense input", () => {
    for (const bad of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gpuReservationUsd(bad as number | null, 300), String(bad)).toBeNull();
    }
    expect(gpuReservationUsd(PRICE_3090, 0)).toBeNull();
  });

  it("settles on billed seconds, which include boot time we were charged for", () => {
    expect(gpuActualUsd(PRICE_3090, 42)).toBeCloseTo((0.22 / 3600) * 42, 12);
    // Unknown stays unknown. Never a fabricated zero.
    expect(gpuActualUsd(PRICE_3090, null)).toBeNull();
    expect(gpuActualUsd(null, 42)).toBeNull();
  });

  it("the whole runtime ceiling fits inside the job cap on every allowed GPU", () => {
    for (const gpuType of Object.keys(ALLOWED_GPU_TYPES)) {
      // Priced at the most expensive card measured, $0.34/h for a 4090.
      const worst = gpuReservationUsd(0.34, MAX_GPU_RUNTIME_SECONDS)!;
      expect(worst, gpuType).toBeLessThanOrEqual(GPU_JOB_CAP_USD);
    }
  });
});

// ============================================================ PHASE 12 security
describe("the caller cannot choose what it costs", () => {
  it("refuses a GPU type that is not on the allow-list", () => {
    // "8x H100" is a $30/hour sentence typed by someone who does not pay.
    const a = admitGpuJob({
      gpuType: "NVIDIA H100 80GB HBM3",
      pricePerHourUsd: 3.5,
      maxRuntimeSeconds: 300,
      requiredVramGb: 24,
    });
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.reason).toBe("gpu-type-not-allowed");
  });

  it("refuses a runtime above the ceiling instead of clamping it silently", () => {
    // Clamping at admission would let a caller ask for a week and be told yes.
    const a = admitGpuJob({
      gpuType: GPU_3090,
      pricePerHourUsd: PRICE_3090,
      maxRuntimeSeconds: MAX_GPU_RUNTIME_SECONDS + 1,
      requiredVramGb: 24,
    });
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.reason).toBe("runtime-exceeds-ceiling");
  });

  it("refuses a GPU with too little VRAM before it considers the price", () => {
    // The measured trap: RTX A4500 20GB is $0.19/h against the 3090's $0.22,
    // and a 24GB workload on it is a job that cannot run, bought at a discount.
    const cheap: typeof ALLOWED_GPU_TYPES = {
      "NVIDIA RTX A4500": { vramGb: 20, secureCloud: true },
    };
    const saved = ALLOWED_GPU_TYPES["NVIDIA RTX A4500"];
    ALLOWED_GPU_TYPES["NVIDIA RTX A4500"] = cheap["NVIDIA RTX A4500"];
    try {
      const a = admitGpuJob({
        gpuType: "NVIDIA RTX A4500",
        pricePerHourUsd: 0.19,
        maxRuntimeSeconds: 300,
        requiredVramGb: 24,
      });
      expect(a.ok).toBe(false);
      expect(a.ok === false && a.reason).toBe("insufficient-vram");
    } finally {
      if (saved) ALLOWED_GPU_TYPES["NVIDIA RTX A4500"] = saved;
      else delete ALLOWED_GPU_TYPES["NVIDIA RTX A4500"];
    }
  });

  it("refuses a job whose reservation exceeds the cap", () => {
    const a = admitGpuJob({
      gpuType: GPU_3090,
      pricePerHourUsd: 50,
      maxRuntimeSeconds: 900,
      requiredVramGb: 24,
    });
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.reason).toBe("over-job-cap");
  });

  it("admits the one shape that is actually safe", () => {
    const a = admitGpuJob({
      gpuType: GPU_3090,
      pricePerHourUsd: PRICE_3090,
      maxRuntimeSeconds: 300,
      requiredVramGb: 24,
    });
    expect(a.ok).toBe(true);
    expect(a.ok === true && a.reservationUsd).toBeCloseTo((0.22 / 3600) * 300, 10);
  });
});

// ============================================================ PHASE 9 + 18
describe("no worker survives its job, whatever the job did", () => {
  it("terminates after success", async () => {
    const p = fakeProvider();
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => "art",
    );
    expect(out.ok).toBe(true);
    expect(p.state.terminated).toBe(1);
    expect(await p.listActive()).toEqual([]);
  });

  it("terminates after the workload THROWS — the expensive case", async () => {
    // An exception between provisioning and cleanup is how a GPU is left
    // running. `finally`, not a success path.
    const p = fakeProvider();
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => {
        throw new Error("CUDA out of memory");
      },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toMatch(/CUDA out of memory/);
    expect(p.state.terminated).toBe(1);
    expect(await p.listActive()).toEqual([]);
  });

  it("still reports billed seconds when the job failed", async () => {
    // The GPU ran. Something is owed regardless of whether it produced output.
    const p = fakeProvider();
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => {
        throw new Error("boom");
      },
    );
    expect(out.billedSeconds).toBe(42);
    expect(gpuActualUsd(PRICE_3090, out.billedSeconds)).toBeGreaterThan(0);
  });

  it("surfaces an ORPHAN loudly when termination itself fails", async () => {
    // The one outcome that must never be swallowed: the provider said no to
    // the kill. Something has to chase it.
    const p = fakeProvider({ failTerminate: true });
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => "x",
    );
    expect(out.orphan).toBe("w-1");
    expect(await p.listActive()).toEqual(["w-1"]);
  });

  it("provisioning failure creates nothing and bills nothing", async () => {
    const p = fakeProvider({
      async provision() {
        return { ok: false as const, reason: "unavailable" as const };
      },
    });
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => "x",
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe("provision-unavailable");
    expect(out.billedSeconds).toBeNull();
    // Nothing was created, so nothing was terminated and nothing leaked.
    expect(p.state.terminated).toBe(0);
    expect(await p.listActive()).toEqual([]);
  });

  it("an unconfigured provider never provisions", async () => {
    const p = fakeProvider({
      configured: false,
      async provision() {
        return { ok: false as const, reason: "not-configured" as const };
      },
    });
    const out = await withGpuWorker(
      p,
      { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 300 },
      async () => "x",
    );
    expect(out.ok === false && out.reason).toBe("provision-not-configured");
    expect(p.state.provisioned).toBe(0);
  });

  it("every termination reason is enumerated, so a new one cannot forget to stop", () => {
    expect([...TERMINATION_REASONS].sort()).toEqual(
      ["admission-rollback", "cancelled", "completed", "failed", "idle", "timed-out"].sort(),
    );
    expect(GPU_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(0);
    expect(GPU_IDLE_TIMEOUT_SECONDS).toBeLessThan(MAX_GPU_RUNTIME_SECONDS);
  });
});

// ============================================================ PHASE 21
describe("no idle cost", () => {
  it("a completed job leaves zero active workers", async () => {
    const p = fakeProvider();
    for (let i = 0; i < 5; i += 1) {
      await withGpuWorker(
        p,
        { gpuType: GPU_3090, image: "i", maxRuntimeSeconds: 60 },
        async () => i,
      );
    }
    expect(p.state.provisioned).toBe(5);
    expect(p.state.terminated).toBe(5);
    expect(await p.listActive()).toEqual([]);
  });
});
