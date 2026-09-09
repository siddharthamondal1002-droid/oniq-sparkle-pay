/**
 * ONIQ HEALTH — the domain model, ABOVE FHIR.
 *
 * MIRRORED byte for byte with `supabase/functions/_shared/health/domain.ts`;
 * `agreement.test.ts` fails if the two differ. No imports, on purpose: a
 * self-contained module can be copied without its specifiers changing.
 *
 * WHY NOT FHIR DIRECTLY. FHIR is the interchange format ABDM and the Cloud
 * Healthcare API speak; it is not a good shape for a phone screen or for a
 * consent rule. The app reads and writes these types; an adapter (Phase 4)
 * maps them to Observation / Condition / MedicationStatement /
 * AllergyIntolerance / Immunization / Procedure / Encounter /
 * DocumentReference and back. Nothing in the UI ever edits FHIR JSON.
 *
 * EVERY LIST HERE IS CLOSED. The database carries the same lists as CHECK
 * constraints (`migration.test.ts` reads them back), so a value the type
 * system would refuse is refused by Postgres as well.
 */

/* --------------------------------------------------------------- kinds -- */

export const RECORD_KINDS = [
  "vital",
  "lab",
  "condition",
  "medication",
  "allergy",
  "immunization",
  "procedure",
  "encounter",
  "note",
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const DATA_CATEGORIES = [
  "vitals",
  "labs",
  "conditions",
  "medications",
  "allergies",
  "immunizations",
  "procedures",
  "encounters",
  "documents",
  "notes",
  "device_metrics",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/** The consent category a record kind falls under. Total, by construction. */
export const CATEGORY_FOR_KIND: Record<RecordKind, DataCategory> = {
  vital: "vitals",
  lab: "labs",
  condition: "conditions",
  medication: "medications",
  allergy: "allergies",
  immunization: "immunizations",
  procedure: "procedures",
  encounter: "encounters",
  note: "notes",
};

export const DOCUMENT_KINDS = [
  "lab_report",
  "prescription",
  "discharge_summary",
  "imaging_report",
  "vaccination",
  "invoice",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/* ---------------------------------------------------------- provenance -- */

export const PROVENANCE_SOURCES = [
  "user_entry",
  "document_upload",
  "document_extraction",
  "health_connect",
  "abdm",
  "clinician_import",
  "ai_interpretation",
] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/**
 * Sources whose content a model produced. These are labelled as AI in the UI,
 * and an UNKNOWN source is labelled as AI too — over-label, never under-label,
 * the same rule the character portraits already follow.
 */
export const AI_DERIVED_SOURCES: readonly ProvenanceSource[] = [
  "document_extraction",
  "ai_interpretation",
];

export type Provenance = {
  source: ProvenanceSource;
  /** A document id, a device name, an ABDM consent artefact id — never content. */
  sourceRef?: string;
  capturedAt: string;
  method?: string;
  /** 0–1, only meaningful for AI-derived sources. */
  confidence?: number;
  verifiedBy?: "user" | "clinician";
};

export function isAiDerived(source: string | null | undefined): boolean {
  if (!source) return true;
  if (!(PROVENANCE_SOURCES as readonly string[]).includes(source)) return true;
  return (AI_DERIVED_SOURCES as readonly string[]).includes(source);
}

/* ------------------------------------------------------------- records -- */

export const CODE_SYSTEMS = ["LOINC", "SNOMED", "ICD10", "ATC", "ONIQ"] as const;
export type CodeSystem = (typeof CODE_SYSTEMS)[number];

export type HealthCode = { system: CodeSystem; code: string; display: string };

/**
 * `candidate` and `rejected` arrived with Phase 2: a value the document
 * extractor read is a CANDIDATE until the person confirms it (→ active) or
 * rejects it (→ rejected, kept as the receipt of what was read). Neither
 * renders on the timeline; only `active` does.
 */
export const RECORD_STATUSES = [
  "active",
  "entered_in_error",
  "deleted",
  "candidate",
  "rejected",
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export type HealthRecord = {
  id: string;
  userId: string;
  kind: RecordKind;
  code?: HealthCode;
  valueNum?: number;
  valueUnit?: string;
  valueText?: string;
  effectiveAt: string;
  recordedAt: string;
  status: RecordStatus;
  provenance: Provenance;
  documentId?: string;
  expiresAt?: string;
};

/** What a person may submit when entering a record by hand. */
export type RecordInput = {
  kind: RecordKind;
  display: string;
  valueNum?: number;
  valueUnit?: string;
  valueText?: string;
  effectiveAt: string;
};

export const MAX_DISPLAY_CHARS = 120;
export const MAX_TEXT_CHARS = 2000;
export const MAX_UNIT_CHARS = 24;

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

/**
 * Validate a manual record. Pure, and used on BOTH sides: the client refuses
 * before sending and the server refuses before inserting, so a crafted request
 * meets the same rule as a typed one.
 */
export function validateRecordInput(raw: unknown): Validation<RecordInput> {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "bad_input" };
  const r = raw as Record<string, unknown>;
  if (!(RECORD_KINDS as readonly string[]).includes(String(r.kind))) {
    return { ok: false, reason: "bad_kind" };
  }
  const display = typeof r.display === "string" ? r.display.trim() : "";
  if (!display || display.length > MAX_DISPLAY_CHARS) return { ok: false, reason: "bad_display" };
  if (!isIsoDate(r.effectiveAt)) return { ok: false, reason: "bad_date" };
  if (Date.parse(r.effectiveAt) > Date.now() + 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "future_date" };
  }
  const out: RecordInput = { kind: r.kind as RecordKind, display, effectiveAt: r.effectiveAt };
  if (r.valueNum !== undefined && r.valueNum !== null) {
    if (typeof r.valueNum !== "number" || !Number.isFinite(r.valueNum)) {
      return { ok: false, reason: "bad_value" };
    }
    out.valueNum = r.valueNum;
  }
  if (r.valueUnit !== undefined && r.valueUnit !== null) {
    if (typeof r.valueUnit !== "string" || r.valueUnit.length > MAX_UNIT_CHARS) {
      return { ok: false, reason: "bad_unit" };
    }
    out.valueUnit = r.valueUnit;
  }
  if (r.valueText !== undefined && r.valueText !== null) {
    if (typeof r.valueText !== "string" || r.valueText.length > MAX_TEXT_CHARS) {
      return { ok: false, reason: "bad_text" };
    }
    out.valueText = r.valueText;
  }
  if (out.valueNum === undefined && !out.valueText) return { ok: false, reason: "empty_value" };
  return { ok: true, value: out };
}

/* ----------------------------------------------------------- documents -- */

export const DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type DocumentMime = (typeof DOCUMENT_MIMES)[number];

/** 10 MiB. A phone photo of a report is 2–4 MB; a scanned PDF rarely more. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TITLE_CHARS = 120;

export const DOCUMENT_STATUSES = [
  "pending_upload",
  "stored",
  "processing",
  "ready",
  "deleted",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type HealthDocument = {
  id: string;
  userId: string;
  kind: DocumentKind;
  title: string;
  mime: DocumentMime;
  sizeBytes: number;
  sha256?: string;
  status: DocumentStatus;
  capturedAt?: string;
  provenance: Provenance;
  expiresAt?: string;
};

export type DocumentInput = {
  kind: DocumentKind;
  title: string;
  mime: DocumentMime;
  sizeBytes: number;
  capturedAt?: string;
};

export function validateDocumentInput(raw: unknown): Validation<DocumentInput> {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "bad_input" };
  const r = raw as Record<string, unknown>;
  if (!(DOCUMENT_KINDS as readonly string[]).includes(String(r.kind))) {
    return { ok: false, reason: "bad_kind" };
  }
  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (!title || title.length > MAX_TITLE_CHARS) return { ok: false, reason: "bad_title" };
  if (!(DOCUMENT_MIMES as readonly string[]).includes(String(r.mime))) {
    return { ok: false, reason: "bad_mime" };
  }
  const size = r.sizeBytes;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, reason: "bad_size" };
  }
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large" };
  const out: DocumentInput = {
    kind: r.kind as DocumentKind,
    title,
    mime: r.mime as DocumentMime,
    sizeBytes: size,
  };
  if (r.capturedAt !== undefined && r.capturedAt !== null) {
    if (!isIsoDate(r.capturedAt)) return { ok: false, reason: "bad_date" };
    out.capturedAt = r.capturedAt;
  }
  return { ok: true, value: out };
}

/** The file extension a stored object gets, from its declared type. */
export const EXT_FOR_MIME: Record<DocumentMime, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/* ------------------------------------------------------------ consents -- */

export const CONSENT_PURPOSES = [
  "store_records",
  "ai_interpretation",
  "share_with_clinician",
  "health_connect_sync",
  "abdm_exchange",
  "research_deidentified",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const RECIPIENTS = ["oniq", "google_vertex", "clinician", "abdm", "research"] as const;
export type Recipient = (typeof RECIPIENTS)[number];

export const CONSENT_STATUSES = ["active", "revoked", "expired"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export type HealthConsent = {
  consentId: string;
  userId: string;
  purpose: ConsentPurpose;
  dataCategories: DataCategory[];
  /** Where the consent was captured: the screen, a signup step, an import. */
  source: string;
  recipient: Recipient;
  startTime: string;
  expiryTime: string | null;
  status: ConsentStatus;
  revokedAt: string | null;
  createdAt: string;
  version: number;
  termsVersion: string;
  noticeLocale: string;
};

/**
 * The (purpose, recipient) pairs a person may grant today, and nothing else
 * can be granted at all. Phase 1 opened storage; Phase 2 opens AI
 * interpretation by ONIQ's OWN in-process provider — recipient "oniq",
 * because the synthetic provider never leaves the process. A recipient that
 * would carry bytes out of ONIQ (google_vertex, clinician, abdm, research)
 * is not grantable until the phase that registers such a recipient adds the
 * pair here AND a terms version that discloses it (`consent.ts`,
 * DISCLOSED_RECIPIENTS_BY_TERMS) — a consent given for "oniq" can never be
 * read as covering anyone else.
 */
export const GRANTABLE_CONSENTS: readonly { purpose: ConsentPurpose; recipient: Recipient }[] = [
  { purpose: "store_records", recipient: "oniq" },
  { purpose: "ai_interpretation", recipient: "oniq" },
  // Phase 3 (owner directive 2026-09-09): the real provider's recipient.
  // health-api offers a person exactly ONE of the two AI pairs — the one the
  // registered provider names (RECIPIENT_FOR_PROVIDER) — and refuses the
  // other as recipient_not_offered; both stay grantable here so the
  // synthetic provider remains a rollback that needs no schema change.
  { purpose: "ai_interpretation", recipient: "google_vertex" },
];

export function isGrantable(purpose: string, recipient: string): boolean {
  return GRANTABLE_CONSENTS.some((g) => g.purpose === purpose && g.recipient === recipient);
}

/** The purposes with at least one grantable pair, in the order they are offered. */
export const GRANTABLE_PURPOSES: readonly ConsentPurpose[] = GRANTABLE_CONSENTS.map(
  (g) => g.purpose,
).filter((p, i, all) => all.indexOf(p) === i);

/**
 * The consent-notice version each purpose is granted under. The AI purpose
 * has its own, so the sentence counsel writes for it (docs/health/04 D3) is
 * versioned apart from the storage sentence, and a later recipient means a
 * later version rather than a reinterpretation of this one — which is what
 * happened on 2026-09-09: `health-ai-terms-v2` is the notice that names
 * Google Cloud Vertex AI as a recipient (consent.ts DISCLOSED_RECIPIENTS_BY_TERMS).
 * A v1 row, granted when the notice named only ONIQ, covers the vertex
 * provider for nobody; every person grants again under v2.
 */
export const CONSENT_TERMS_VERSIONS: Record<ConsentPurpose, string> = {
  store_records: "health-terms-v1",
  ai_interpretation: "health-ai-terms-v2",
  share_with_clinician: "health-terms-v1",
  health_connect_sync: "health-terms-v1",
  abdm_exchange: "health-terms-v1",
  research_deidentified: "health-terms-v1",
};

/* --------------------------------------------------------------- audit -- */

export const AUDIT_ACTIONS = [
  "records.create",
  "records.delete",
  "records.confirm",
  "records.reject",
  "documents.register",
  "documents.confirm",
  "documents.read",
  "documents.delete",
  "documents.classify",
  "documents.extract",
  "consents.grant",
  "consents.revoke",
  "ai.request",
  "ai.refused",
  "export",
  "purge",
  "config.ai_kill",
  "config.ai_caps",
  "config.changed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OBJECT_TYPES = ["record", "document", "consent", "account", "config"] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];

/* ---------------------------------------------------------- magic bytes -- */

/**
 * The declared type of a file, checked against its first bytes. The client
 * reads a 12-byte head through a stream reader (never the whole file — that
 * is banned on upload paths repo-wide) and refuses a mismatch before anything
 * is registered; the Phase 2 worker will run the same check on the stored
 * object. Returns the sniffed type, or null when the head matches none.
 */
export function sniffDocumentMime(head: Uint8Array): DocumentMime | null {
  if (head.length < 4) return null;
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return "application/pdf";
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return "image/png";
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
