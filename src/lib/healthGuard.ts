// UAE health-data block (Federal Law 2/2019 + Ministerial Resolution 51/2021).
// Mood, sleep, energy, water, exercise, cycle logs and the safety plan are all
// health data. Where the user's HOME country does not allow health data, none
// of it may be created — not in Supabase, not on the device.
//
// Home is resolved from profiles.country_code (mirrored by src/lib/country.ts).
// NEVER from currentRegion: a UAE resident travelling is still AE-home, and an
// Indian traveller in Dubai is not.
//
// This is the client half. The database enforces the same rule independently
// (health_data_allowed() + per-table write triggers and restrictive policies),
// so a crafted request or a deep-linked route still cannot persist anything.
import { getCountry } from "@/lib/country";
import { isHealthDataAllowed } from "@/data/countryRegistry";
import type { Country } from "@/data/countryRegistry";

/** Device keys that hold health data. Cleared whenever Home disallows it. */
export const LOCAL_HEALTH_KEYS = [
  "oniq.vitals.score.v1",
  "oniq.vitals.experience.v1",
  "oniq.safetyplan.v1",
];

/** May this Home country store health data at all? */
export function healthWritesAllowed(home: Country = getCountry() as Country): boolean {
  return isHealthDataAllowed(home);
}

export const HEALTH_BLOCKED_MESSAGE =
  "health tracking isn't available in your country — nothing was saved 🔒";

/**
 * Throwing guard for every health write path. Call this BEFORE any insert,
 * update or device write of health data.
 */
export function assertHealthWriteAllowed(home: Country = getCountry() as Country): void {
  if (!healthWritesAllowed(home)) throw new Error(HEALTH_BLOCKED_MESSAGE);
}

/** Remove all health data held in device storage. Safe to call repeatedly. */
export function clearLocalHealthData(): void {
  for (const key of LOCAL_HEALTH_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent("oniq:vitals-changed"));
  } catch {
    /* noop */
  }
  // Best-effort native mirror wipe; plugin absence is fine.
  void (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ "@capacitor" + "/preferences");
      await Promise.all(LOCAL_HEALTH_KEYS.map((key) => mod.Preferences.remove({ key })));
    } catch {
      /* plugin not installed */
    }
  })();
}

/** Server-side purge of the signed-in user's health rows. Returns rows deleted. */
export async function purgeMyHealthDataOnServer(): Promise<number> {
  const { supabase } = await import("@/integrations/supabase/client");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("purge_my_health_data");
  if (error) throw error;
  return Number(data ?? 0);
}

/** How many health rows the signed-in user still has server-side. */
export async function countMyHealthRows(): Promise<number> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return 0;
  const uid = u.user.id;
  const tables = ["health_checkins", "cycle_logs", "health_profiles"] as const;
  const counts = await Promise.all(
    tables.map(async (t) => {
      const { count } = await supabase
        .from(t)
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", uid);
      return count ?? 0;
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}
