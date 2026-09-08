/**
 * ONIQ HEALTH — client feature flags. ALL OFF.
 *
 * Owner brief, 2026-09-08: everything in ONIQ Health ships behind these
 * twelve switches (§83C names the twelfth). The names are the brief's, dotted exactly as given; the
 * list lives in `flagNames.ts`, which is mirrored server-side, so the client
 * and the `health_config` row cannot name different switches.
 *
 * TWO HALVES, BOTH MUST BE ON. This file decides what RENDERS — the Home
 * tile, the bottom tab, the three screens. The server row decides what the
 * `health-api` function will DO, and it fails closed when the row is missing.
 * Flipping only the client shows screens that answer "not switched on yet";
 * flipping only the server changes nothing anyone can see. Both are one-line
 * changes and both are recorded in docs/health/04-decisions-for-owner.md §A.
 *
 * NOT A SECURITY BOUNDARY. A flag here is a compile-time constant that anyone
 * can read in the bundle. What guards the data is the server: JWT, consent,
 * the ownership filter and RLS.
 */
import { HEALTH_FLAG_NAMES, type HealthFlag } from "./flagNames";

export type { HealthFlag };
export { HEALTH_FLAG_NAMES };

export const HEALTH_FLAGS: Record<HealthFlag, boolean> = {
  "health.enabled": false,
  "health.uploads.enabled": false,
  "health.ai.enabled": false,
  "health.health_connect.enabled": false,
  "health.abdm.enabled": false,
  "health.fhir.enabled": false,
  "health.dicom.enabled": false,
  "health.hl7.enabled": false,
  "health.medgemma.enabled": false,
  "health.healthcare_search.enabled": false,
  "health.research.enabled": false,
  "health.provider_sharing.enabled": false,
};

/** True only when the master switch AND the named switch are on. */
export function healthFlag(name: HealthFlag): boolean {
  if (!Object.prototype.hasOwnProperty.call(HEALTH_FLAGS, name)) {
    throw new Error(`unknown health flag: ${name}`);
  }
  return HEALTH_FLAGS["health.enabled"] && HEALTH_FLAGS[name];
}

export const HEALTH_ENABLED = healthFlag("health.enabled");
export const HEALTH_UPLOADS_ENABLED = healthFlag("health.uploads.enabled");
/**
 * PHASE 2 STAYS FALSE IN PRODUCTION. The only provider is synthetic and the
 * server refuses it to every non-admin in production regardless; this flag
 * decides only whether the AI sections RENDER. Symptom-to-cause, the way the
 * phone flag records it: a section visible and every action refused means
 * the client half is on and the server half (the row, the caps, the admin
 * verification switch) is off. The server's `status.aiAvailable` is what a
 * screen should read before offering anything.
 */
export const HEALTH_AI_ENABLED = healthFlag("health.ai.enabled");
