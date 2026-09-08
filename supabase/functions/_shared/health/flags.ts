/**
 * ONIQ HEALTH — server feature flags, read from the `health_config` row.
 *
 * FAILS CLOSED. No row, an unreadable row, or a row whose master switch is
 * off all resolve to every flag false. The function then answers
 * `503 health_disabled` before it has read anything about the caller.
 *
 * The twelve names come from `flagNames.ts`, mirrored with the client; the
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

/** Pure: one row (or none) → the twelve flags. Exercised by flags.test.ts. */
export function flagsFromRow(row: HealthConfigRow): HealthFlags {
  const out = allHealthFlagsOff();
  if (!row || typeof row !== "object") return out;
  for (const name of HEALTH_FLAG_NAMES) out[name] = row[HEALTH_FLAG_COLUMNS[name]] === true;
  // The master switch gates every other one: a row with uploads on and
  // enabled off is "off", not "uploads only".
  if (!out["health.enabled"]) return allHealthFlagsOff();
  // THE EMERGENCY STOP (owner directive 2026-09-08). One column, read here
  // and nowhere else, forces every AI flag off whatever the other columns
  // say — so an admin can end all Health AI from the app in seconds, and
  // every function that reads the flags obeys without a deploy.
  if (aiKillSwitchFromRow(row)) {
    out["health.ai.enabled"] = false;
    out["health.provider_sharing.enabled"] = false;
  }
  return out;
}

/** True only for the boolean true, like every other column here. */
export function aiKillSwitchFromRow(row: HealthConfigRow): boolean {
  return !!row && typeof row === "object" && row.ai_kill_switch === true;
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

/**
 * The whole row, flags resolved. `row` is null when there is none or it
 * could not be read — and then every flag is off, so nothing downstream can
 * mistake "unreadable" for "on".
 */
export async function readHealthConfig(
  admin: Reader,
): Promise<{ flags: HealthFlags; environment: string; row: HealthConfigRow }> {
  try {
    const { data, error } = await admin
      .from("health_config")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) return { flags: allHealthFlagsOff(), environment: "production", row: null };
    const row = (data ?? null) as HealthConfigRow;
    return { flags: flagsFromRow(row), environment: environmentFromRow(row), row };
  } catch {
    return { flags: allHealthFlagsOff(), environment: "production", row: null };
  }
}

export async function readHealthFlags(
  admin: Reader,
): Promise<{ flags: HealthFlags; environment: string }> {
  const { flags, environment } = await readHealthConfig(admin);
  return { flags, environment };
}
