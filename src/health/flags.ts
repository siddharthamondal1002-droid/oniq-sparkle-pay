/**
 * ONIQ HEALTH — client feature flags. ALL OFF.
 *
 * Owner brief, 2026-09-08: everything in ONIQ Health ships behind these
 * eleven switches. The names are the brief's, dotted exactly as given; the
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
