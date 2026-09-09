/**
 * ONIQ HEALTH — client feature flags. FOUR ON: the master switch, the AI
 * switch and provider sharing (owner directive 2026-09-09: "ONIQ HEALTH —
 * FULL AUTONOMOUS IMPLEMENTATION, DEPLOYMENT AND ACTIVATION"), and uploads
 * (owner directive 2026-09-09, later the same day: "i want A, B and C all
 * done" — the attachment facility, PDF reading on ONIQ's side, and
 * transcription of photos and scans by the provider). The other eight stay
 * off — Health Connect, ABDM, FHIR, DICOM, HL7, MedGemma, search, research
 * are unbuilt or unauthorised.
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
  "health.enabled": true,
  "health.uploads.enabled": true,
  "health.ai.enabled": true,
  "health.health_connect.enabled": false,
  "health.abdm.enabled": false,
  "health.fhir.enabled": false,
  "health.dicom.enabled": false,
  "health.hl7.enabled": false,
  "health.medgemma.enabled": false,
  "health.healthcare_search.enabled": false,
  "health.research.enabled": false,
  "health.provider_sharing.enabled": true,
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
 * ON since Phase 3 (owner directive 2026-09-09). This flag decides only
 * whether the AI sections RENDER; the server's `health_config` row (ai_enabled,
 * the provider, the caps, the kill switch) decides whether they ANSWER, and
 * `status.aiAvailable` is what a screen reads before offering anything.
 * Symptom-to-cause, the way the phone flag records it: a section visible and
 * every action refused means the client half is on and the server half is
 * off. ROLLBACK is this constant back to false — one word, no other change —
 * or the emergency stop on /app/admin/health-ai, which needs no publish.
 */
export const HEALTH_AI_ENABLED = healthFlag("health.ai.enabled");
