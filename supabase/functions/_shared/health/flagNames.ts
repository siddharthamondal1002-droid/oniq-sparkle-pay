/**
 * ONIQ HEALTH — the eleven feature flags, by name.
 *
 * MIRRORED. This file exists twice, byte for byte: `src/health/flagNames.ts`
 * (the client reads the constants in `flags.ts`) and
 * `supabase/functions/_shared/health/flagNames.ts` (the edge function reads
 * the `health_config` row). Deno cannot import from `src/` and the bundle
 * guard forbids the reverse, so the names live in both trees and
 * `src/health/__tests__/agreement.test.ts` fails the moment the copies differ.
 *
 * The names are the owner's, from the 2026-09-08 brief, dotted exactly as
 * given. The column is what the server row calls the same switch.
 */
export const HEALTH_FLAG_NAMES = [
  "health.enabled",
  "health.uploads.enabled",
  "health.ai.enabled",
  "health.health_connect.enabled",
  "health.abdm.enabled",
  "health.fhir.enabled",
  "health.dicom.enabled",
  "health.hl7.enabled",
  "health.medgemma.enabled",
  "health.healthcare_search.enabled",
  "health.research.enabled",
] as const;

export type HealthFlag = (typeof HEALTH_FLAG_NAMES)[number];

/** The `health_config` column that carries each flag. */
export const HEALTH_FLAG_COLUMNS: Record<HealthFlag, string> = {
  "health.enabled": "enabled",
  "health.uploads.enabled": "uploads_enabled",
  "health.ai.enabled": "ai_enabled",
  "health.health_connect.enabled": "health_connect_enabled",
  "health.abdm.enabled": "abdm_enabled",
  "health.fhir.enabled": "fhir_enabled",
  "health.dicom.enabled": "dicom_enabled",
  "health.hl7.enabled": "hl7_enabled",
  "health.medgemma.enabled": "medgemma_enabled",
  "health.healthcare_search.enabled": "healthcare_search_enabled",
  "health.research.enabled": "research_enabled",
};

/** Every flag off — the shape a missing server row resolves to. */
export function allHealthFlagsOff(): Record<HealthFlag, boolean> {
  const out = {} as Record<HealthFlag, boolean>;
  for (const name of HEALTH_FLAG_NAMES) out[name] = false;
  return out;
}
