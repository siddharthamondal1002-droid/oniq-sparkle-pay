/**
 * ONIQ HEALTH — server feature flags, read from the `health_config` row.
 *
 * FAILS CLOSED. No row, an unreadable row, or a row whose master switch is
 * off all resolve to every flag false. The function then answers
 * `503 health_disabled` before it has read anything about the caller.
 *
 * The eleven names come from `flagNames.ts`, mirrored with the client; the
 * column each one reads is recorded there too, so this file has no list of
 * its own to drift.
 */
import {
  HEALTH_FLAG_COLUMNS,
  HEALTH_FLAG_NAMES,
  allHealthFlagsOff,
  type HealthFlag,
} from "./flagNames.ts";

export type HealthFlags = Record<HealthFlag, boolean>;

export type HealthConfigRow = Record<string, unknown> | null | undefined;

/** Pure: one row (or none) → the eleven flags. Exercised by flags.test.ts. */
export function flagsFromRow(row: HealthConfigRow): HealthFlags {
  const out = allHealthFlagsOff();
  if (!row || typeof row !== "object") return out;
  for (const name of HEALTH_FLAG_NAMES) out[name] = row[HEALTH_FLAG_COLUMNS[name]] === true;
  // The master switch gates every other one: a row with uploads on and
  // enabled off is "off", not "uploads only".
  if (!out["health.enabled"]) return allHealthFlagsOff();
  return out;
}

export function environmentFromRow(row: HealthConfigRow): string {
  const env = row && typeof row === "object" ? row.environment : undefined;
  return typeof env === "string" && env ? env : "production";
}

// The Supabase client's builder types are deep enough that a structural
// parameter type sends the checker into "excessively deep" territory (measured
// with deno check, 2026-09-08); the function reads one row from one table, so
// the loose shape below is the honest one.
// deno-lint-ignore no-explicit-any
type Reader = { from(table: string): any };

export async function readHealthFlags(
  admin: Reader,
): Promise<{ flags: HealthFlags; environment: string }> {
  try {
    const { data, error } = await admin
      .from("health_config")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) return { flags: allHealthFlagsOff(), environment: "production" };
    const row = (data ?? null) as HealthConfigRow;
    return { flags: flagsFromRow(row), environment: environmentFromRow(row) };
  } catch {
    return { flags: allHealthFlagsOff(), environment: "production" };
  }
}
