// UAE health-data block (Federal Law 2/2019 + Ministerial Resolution 51/2021).
// Mood, sleep, energy, water, exercise, cycle logs and the safety plan are all
// health data.
//
// The law targets health data GENERATED IN the UAE — it is about where the
// data is produced, not the person's nationality or home country. So there are
// TWO independent axes, and either one being AE blocks the write:
//
//   HOME axis   -> profiles.country_code, mirrored by src/lib/country.ts.
//                  FAILS OPEN: an unknown/null home country is NOT treated as
//                  UAE. Most profiles are still unconfirmed, and blocking
//                  every unconfirmed user would break health tracking for
//                  people nowhere near the UAE. Absence of evidence that a
//                  user is UAE-home is not evidence that they are.
//
//   REGION axis -> currentRegion (src/lib/region.ts), device-only, derived
//                  solely from the cf-ipcountry edge signal. FAILS CLOSED: a
//                  positive 'AE' signal blocks regardless of home country,
//                  because the data would be generated in the UAE. A null
//                  region is not a positive signal, so it defers to Home.
//
// The asymmetry is deliberate and differs from the age threshold
// (minor_age_for_country), which fails CLOSED on unknown. Age is about WHO the
// user is and can never be verified, so we take the strict reading. Health
// locality is about WHERE the user is, and we now have a positive signal for
// it — so we act on the signal when present, not on the absence of one.
//
// This is the client half. The database enforces the same two-axis rule
// independently (health_data_allowed() = health_request_region_ok() AND the
// home check, wired into per-table write triggers and restrictive policies),
// reading cf-ipcountry off the request itself — so a client that lies about
// its region, or a crafted request, still cannot persist anything. The region
// signal is read, used for the decision, and discarded; it is never stored.
import { getCountry } from "@/lib/country";
import { getCurrentRegion } from "@/lib/region";
import { isHealthDataAllowed } from "@/data/countryRegistry";
import type { Country } from "@/data/countryRegistry";

/** Device keys that hold health data. Cleared whenever health data is barred. */
export const LOCAL_HEALTH_KEYS = [
  "oniq.vitals.score.v1",
  "oniq.vitals.experience.v1",
  "oniq.safetyplan.v1",
];

/**
 * May health data be stored right now?
 * Blocked when Home is a country that disallows health data (fail open on
 * unknown), OR when the current region is such a country (fail closed on a
 * positive signal, open on null).
 */
export function healthWritesAllowed(
  home: Country = getCountry() as Country,
  region: Country | null = typeof window === "undefined" ? null : getCurrentRegion(),
): boolean {
  if (region && !isHealthDataAllowed(region)) return false;
  return isHealthDataAllowed(home);
}

export const HEALTH_BLOCKED_MESSAGE =
  "health tracking isn't available in your country — nothing was saved 🔒";

/**
 * Throwing guard for every health write path. Call this BEFORE any insert,
 * update or device write of health data.
 */
export function assertHealthWriteAllowed(
  home: Country = getCountry() as Country,
  region: Country | null = typeof window === "undefined" ? null : getCurrentRegion(),
): void {
  if (!healthWritesAllowed(home, region)) throw new Error(HEALTH_BLOCKED_MESSAGE);
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
