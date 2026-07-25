import { describe, it, expect, vi } from "vitest";

// regionService imports the supabase client at module load; stub it so tests
// run without env vars or a network.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));

import { getRegionStatus, normalizeRegion, REGION_PROVIDER_TARGET } from "../regionService";

const rpcOk = (rows: unknown) => async () => ({ data: rows, error: null });
const rpcErr = (message: string) => async () => ({ data: null, error: { message } });

describe("normalizeRegion", () => {
  it("lowercases and trims", () => {
    expect(normalizeRegion("  Kolkata ")).toBe("kolkata");
    expect(normalizeRegion("SINGUR")).toBe("singur");
  });
});

describe("getRegionStatus", () => {
  it("reports a region below threshold as not enabled with remaining count", async () => {
    const res = await getRegionStatus("Kolkata", rpcOk([{ provider_count: 7, enabled: false }]));
    expect(res).toEqual({
      state: "ready",
      providerCount: 7,
      enabled: false,
      remaining: REGION_PROVIDER_TARGET - 7,
    });
  });

  it("reports a live region at/above threshold", async () => {
    const res = await getRegionStatus("kolkata", rpcOk([{ provider_count: 23, enabled: true }]));
    expect(res).toEqual({ state: "ready", providerCount: 23, enabled: true, remaining: 0 });
  });

  it("treats an empty result as zero providers", async () => {
    const res = await getRegionStatus("nowhere", rpcOk([]));
    expect(res).toEqual({
      state: "ready",
      providerCount: 0,
      enabled: false,
      remaining: REGION_PROVIDER_TARGET,
    });
  });

  it("degrades gracefully on RPC error", async () => {
    const res = await getRegionStatus("kolkata", rpcErr("function does not exist"));
    expect(res.state).toBe("unavailable");
  });

  it("degrades gracefully on network throw", async () => {
    const res = await getRegionStatus("kolkata", async () => {
      throw new Error("network down");
    });
    expect(res).toEqual({ state: "unavailable", reason: "network down" });
  });

  it("rejects empty region input without calling the service", async () => {
    const rpc = vi.fn();
    const res = await getRegionStatus("   ", rpc);
    expect(res.state).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
});
