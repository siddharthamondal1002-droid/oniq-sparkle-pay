// Service-availability layer: how many verified ONIQ partners a region has
// and whether services are live there (threshold: REGION_PROVIDER_TARGET).
// The RPC dependency is injectable so the module tests without a network.

import { supabase } from "@/integrations/supabase/client";

export const REGION_PROVIDER_TARGET = 20;

export type RegionStatus =
  | { state: "ready"; providerCount: number; enabled: boolean; remaining: number }
  | { state: "unavailable"; reason: string };

type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const defaultRpc: RpcFn = (fn, args) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase as any).rpc(fn, args);

export function normalizeRegion(input: string): string {
  return input.trim().toLowerCase();
}

export async function getRegionStatus(
  region: string,
  rpc: RpcFn = defaultRpc,
): Promise<RegionStatus> {
  const key = normalizeRegion(region);
  if (!key) return { state: "unavailable", reason: "no region given" };
  try {
    const { data, error } = await rpc("get_region_status", { _region: key });
    if (error) return { state: "unavailable", reason: error.message };
    const row = Array.isArray(data)
      ? (data[0] as { provider_count?: number; enabled?: boolean } | undefined)
      : undefined;
    const count = typeof row?.provider_count === "number" ? row.provider_count : 0;
    const enabled = !!row?.enabled;
    return {
      state: "ready",
      providerCount: count,
      enabled,
      remaining: Math.max(0, REGION_PROVIDER_TARGET - count),
    };
  } catch (err) {
    return { state: "unavailable", reason: err instanceof Error ? err.message : "network error" };
  }
}
