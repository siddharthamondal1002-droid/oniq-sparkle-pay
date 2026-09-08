/**
 * ONIQ HEALTH — the seam to Google Cloud Healthcare, with nothing behind it.
 *
 * Phase 1 ships `NullAdapter`: every call succeeds and touches nothing. Phase 4
 * adds `GoogleFhirAdapter`, which maps the domain types to FHIR R4 resources
 * in a store in `asia-south1` and authenticates with `googleAccessToken()`
 * from `../googleAuth.ts` — a service-account token, never an API key. The
 * interface is here now so the function's call sites exist and the wiring
 * test can pin that a user write never WAITS on the mirror: an adapter
 * failure is logged and the Postgres write stands.
 */
import type { HealthDocument, HealthRecord } from "./domain.ts";
import type { HealthFlags } from "./flags.ts";

export type AdapterResult = { ok: true; remoteId?: string } | { ok: false; reason: string };

export interface HealthcareAdapter {
  readonly name: string;
  putRecord(record: HealthRecord): Promise<AdapterResult>;
  deleteRecord(recordId: string, userId: string): Promise<AdapterResult>;
  putDocumentReference(doc: HealthDocument): Promise<AdapterResult>;
  deleteDocumentReference(docId: string, userId: string): Promise<AdapterResult>;
}

export class NullAdapter implements HealthcareAdapter {
  readonly name = "null";
  putRecord(): Promise<AdapterResult> {
    return Promise.resolve({ ok: true });
  }
  deleteRecord(): Promise<AdapterResult> {
    return Promise.resolve({ ok: true });
  }
  putDocumentReference(): Promise<AdapterResult> {
    return Promise.resolve({ ok: true });
  }
  deleteDocumentReference(): Promise<AdapterResult> {
    return Promise.resolve({ ok: true });
  }
}

/** Phase 4 switches on `flags["health.fhir.enabled"]`. Today: always null. */
export function adapterFor(_flags: HealthFlags): HealthcareAdapter {
  return new NullAdapter();
}
