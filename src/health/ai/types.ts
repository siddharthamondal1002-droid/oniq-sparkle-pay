/**
 * ONIQ HEALTH AI — the shared shapes. MIRRORED byte for byte with
 * `src/health/ai/types.ts` (`agreement.test.ts`). No imports, on purpose, so
 * the copy is exact.
 *
 * Phase 2 (owner brief 2026-09-08 §83) built a safety gateway with a
 * SYNTHETIC provider only. Phase 3 (owner directive 2026-09-09) registered
 * the ONE real provider: "vertex" — Google Cloud Vertex AI, Gemini, reached
 * with the Firebase service account (`ai/vertex.ts`). The lists here are
 * still closed. Two of them decide whether a health byte can leave ONIQ —
 * the provider registry and the model allowlist — and the recipient table
 * says where it goes, so a consent can name it.
 *
 * Reviewed 2026-09-08 (five-lens design review, docs/health/05 §14): record
 * ids never reach a provider (per-request aliases do), refusal reasons are
 * closed codes, the language travels with the response, the classes a
 * provider may emit are an allowlist per provider, and every reason a person
 * can be refused with has a sentence in three languages.
 */

/* --------------------------------------------------------------- tasks -- */

export const AI_TASKS = [
  "explain_record",
  "summarize_timeline",
  "answer_question",
  "classify_document",
  "extract_document",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

/** Every Phase 2 task runs under one consent purpose — one sentence for counsel. */
export const AI_PURPOSE = "ai_interpretation" as const;

export const AI_LANGUAGES = ["en", "hi", "bn"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

/* ----------------------------------------------------------- providers -- */

export const PROVIDER_IDS = ["synthetic", "vertex"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * The recipients an AI provider can name on a consent. A subset of
 * `RECIPIENTS` in domain.ts (asserted by test, since this file imports
 * nothing). "oniq" means the bytes never leave the process.
 */
export const AI_RECIPIENTS = ["oniq", "google_vertex"] as const;
export type AiRecipient = (typeof AI_RECIPIENTS)[number];

/**
 * The recipient a consent must name for each provider. Synthetic never
 * leaves ONIQ; vertex sends the request's context to Google Cloud Vertex AI
 * (Gemini), under the consent pair (ai_interpretation, google_vertex) and a
 * terms version that discloses Google (domain.ts, consent.ts).
 */
export const RECIPIENT_FOR_PROVIDER: Record<ProviderId, AiRecipient> = {
  synthetic: "oniq",
  vertex: "google_vertex",
};

/**
 * One model per real provider, priced in cost.ts ([PAGE] 2026-09-08, the
 * global endpoint). Verified by the first real POST on 2026-09-09; a second
 * id joins this list only after ITS first POST answers.
 */
export const MODEL_ALLOWLIST: Record<ProviderId, readonly string[]> = {
  synthetic: ["synthetic-v1"],
  vertex: ["gemini-3.1-flash-lite"],
};

/**
 * Where a document's text may come from. Phase 2 registered no source ("null"
 * yields nothing). Phase 3b (owner directive 2026-09-09, "A, B and C"):
 * "document" reads the STORED file — its PDF text layer here, on ONIQ's
 * side (`pdf_text`), or, for a photo, a scan or a PDF with no text layer,
 * a transcription by the registered provider (`vertex_transcription`),
 * which is the one step where the document's own bytes leave ONIQ.
 */
export const TEXT_SOURCE_IDS = ["null", "document"] as const;
export type TextSourceId = (typeof TEXT_SOURCE_IDS)[number];

/** How a document's text was obtained — closed, stored on the receipt and audited. */
export const TEXT_SOURCE_METHODS = ["pdf_text", "vertex_transcription"] as const;
export type TextSourceMethod = (typeof TEXT_SOURCE_METHODS)[number];

/** What the gateway hands a provider that can transcribe: the bytes, their type, and a ceiling. */
export type TranscriptionInput = {
  model: string;
  /** One of DOCUMENT_MIMES; the gateway checks before asking. */
  mime: string;
  bytes: Uint8Array;
  language: AiLanguage;
  /** The text is cut here (LIMITS.MAX_DOCUMENT_CHARS) and marked truncated, never refused after paying. */
  maxChars: number;
};

export type TranscriptionOutput = {
  text: string;
  usage: AiUsage;
  /** The model stopped at its output ceiling, or the text was cut at maxChars. */
  truncated: boolean;
};

export const SEGMENT_CLASSES = [
  "record_fact",
  "general_info",
  "ai_interpretation",
  "unknown",
] as const;
export type SegmentClass = (typeof SEGMENT_CLASSES)[number];

/** The classes each provider may emit. A class no provider may emit cannot appear. */
export const PROVIDER_CLASS_ALLOWLIST: Record<ProviderId, readonly SegmentClass[]> = {
  synthetic: ["record_fact", "general_info", "unknown"],
  vertex: ["record_fact", "general_info", "ai_interpretation", "unknown"],
};

/* ------------------------------------------------------------- context -- */

/**
 * A record as the provider may see it. `ref` is a per-request alias (r1, r2…)
 * — never the row id — so a provider cannot join a person's requests across
 * calls. `dateLabel` is the one rendering of the date a fact may quote.
 */
export type ContextRecord = {
  ref: string;
  kind: string;
  display: string;
  valueNum: number | null;
  valueUnit: string | null;
  /** Only for the target of explain_record; scrubbed and capped. */
  valueText: string | null;
  /** YYYY-MM-DD. */
  effectiveDay: string;
  /** e.g. "14 Mar 2026". */
  dateLabel: string;
  source: string;
};

export type ContextDocument = {
  ref: string;
  kind: string;
  title: string;
  mime: string;
  sizeBytes: number;
  /** YYYY-MM-DD of capture (or of upload): the date a candidate falls back to. */
  capturedDay: string;
  /** Only for classify/extract; scrubbed and capped; null when no text source exists. */
  text: string | null;
};

export type AiContext = {
  task: AiTask;
  language: AiLanguage;
  records: ContextRecord[];
  documents: ContextDocument[];
  /** Scrubbed, capped, injection-checked. Null for every task but answer_question. */
  question: string | null;
};

export const EXCLUSION_REASONS = [
  "injection_suspected",
  "obfuscation_suspected",
  "over_limit",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type ExcludedItem = { id: string; field: string; reason: ExclusionReason };

/** The fields a context may carry, by name, so the manifest can list what a task saw. */
export const CONTEXT_FIELDS = [
  "kind",
  "display",
  "valueNum",
  "valueUnit",
  "valueText",
  "effectiveDay",
  "dateLabel",
  "source",
  "question",
  "documentKind",
  "title",
  "mime",
  "sizeBytes",
  "capturedDay",
  "text",
] as const;
export type ContextField = (typeof CONTEXT_FIELDS)[number];

/** What is audited and stored: ids and counts, never content. */
export type ContextManifest = {
  task: AiTask;
  language: AiLanguage;
  /** Position i is alias r{i+1}. */
  recordIds: string[];
  /** Position i is alias d{i+1}. */
  documentIds: string[];
  categories: string[];
  fields: ContextField[];
  charCount: number;
  estimatedInputTokens: number;
  redactions: number;
  excluded: ExcludedItem[];
  truncated: boolean;
  /** Extraction proceeds under this flag; model-bound tasks drop the field instead. */
  injectionSuspected: boolean;
  /** Phase 3b: how a document's text was obtained; null for record tasks and for no text at all. */
  readMethod?: TextSourceMethod | null;
  /** True only when the document's BYTES were sent to the provider (a transcription). */
  documentSent?: boolean;
  /** Pages the PDF text layer reported, when it was read here. */
  pages?: number | null;
  /** The transcription's own usage, kept apart so the receipt can show both calls. */
  transcription?: { inputTokens: number; outputTokens: number; truncated: boolean } | null;
};

export const LIMITS = {
  MAX_CONTEXT_TOKENS: 6000,
  MAX_RECORDS: 30,
  MAX_PRIOR_SAME_KIND: 5,
  MAX_QUESTION_MATCHES: 20,
  MAX_DOCUMENT_CHARS: 20000,
  MAX_EXCERPT_CHARS: 2000,
  MAX_QUESTION_CHARS: 500,
  MAX_NOTE_CHARS: 500,
  MAX_DISPLAY_CHARS: 120,
  MAX_UNIT_CHARS: 24,
  MAX_SEGMENT_CHARS: 600,
  MAX_SEGMENTS: 20,
  MAX_RESPONSE_CHARS: 4000,
  MAX_CITATIONS_PER_SEGMENT: 10,
  MAX_CANDIDATES: 40,
} as const;

/* ------------------------------------------------------------ response -- */

export const AI_RESPONSE_SCHEMA_VERSION = "health-ai-response/1";

/** What a provider may say when it declines to answer. Closed; the client maps to i18n. */
export const PROVIDER_REFUSAL_CODES = [
  "no_matching_records",
  "insufficient_context",
  "out_of_scope",
] as const;
export type ProviderRefusalCode = (typeof PROVIDER_REFUSAL_CODES)[number];

export type AiSegment = {
  class: SegmentClass;
  text: string;
  /** Aliases (r1…) as the provider cites them; the gateway maps them back to ids. */
  sourceRefs?: string[];
  confidence?: number;
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiResponse = {
  schemaVersion: typeof AI_RESPONSE_SCHEMA_VERSION;
  task: AiTask;
  provider: ProviderId;
  model: string;
  language: AiLanguage;
  segments: AiSegment[];
  refusals: ProviderRefusalCode[];
  usage: AiUsage;
  costUsd: number;
};

/** The same response, as the client receives it: ids instead of aliases, and what was left out. */
export type ClientAiResponse = Omit<AiResponse, "segments"> & {
  segments: Array<Omit<AiSegment, "sourceRefs"> & { sourceRecordIds: string[] }>;
  /** The i18n KEY; the client renders the counsel-approved sentence in its language. */
  disclaimerKey: "health.ai.disclosure";
  excluded: { count: number; recordIds: string[] };
};

export type ClassificationResult = {
  kind: string;
  confidence: number;
  method: string;
};

export type CandidateRecord = {
  kind: string;
  /** The canonical analyte name from the closed table — never document text. */
  display: string;
  valueNum: number;
  valueUnit?: string;
  effectiveAt: string;
  confidence: number;
  code: { system: "ONIQ"; code: string; display: string };
};

export type ExtractionResult = {
  candidates: CandidateRecord[];
  method: string;
  textChars: number;
  /** How many candidates the extraction step put forward. A count, never a value. */
  proposed: number;
  /** How many of those the closed analyte table refused. A count, never a value. */
  unusable: number;
};

export type ProviderInput = {
  task: AiTask;
  model: string;
  context: AiContext;
  /** Counts only — the provider never sees ids. */
  counts: { records: number; documents: number };
};

export type ProviderOutput =
  | { kind: "response"; response: AiResponse }
  | { kind: "classification"; classification: ClassificationResult; usage: AiUsage }
  | { kind: "extraction"; extraction: ExtractionResult; usage: AiUsage };

/* ------------------------------------------------------------ refusals -- */

/**
 * Why the gateway refused, before or after the provider. Closed; stored and
 * audited as codes; every member has a sentence in en/hi/bn (`redact.test.ts`).
 */
export const AI_REFUSAL_REASONS = [
  "ai_disabled",
  "task_not_allowed",
  "provider_not_allowed",
  "model_not_allowed",
  "unpriced_model",
  "caps_unset",
  "region_blocked",
  "age_unverified",
  "minor_blocked",
  "synthetic_in_production",
  "ai_consent_required",
  "consent_required",
  "question_rejected",
  "not_found",
  "no_text",
  "text_too_long",
  "quota_user",
  "quota_house",
  "output_rejected",
  "provider_error",
] as const;
export type AiRefusalReason = (typeof AI_REFUSAL_REASONS)[number];

/**
 * Why the contract refused a provider's output. Closed; the only thing stored
 * about a bad output. The last four cover the two non-response kinds: a
 * classification is rebuilt from a closed shape, and every candidate must be
 * an entry of the analyte table — a provider cannot store a word of its own.
 */
export const CONTRACT_REFUSAL_CODES = [
  "not_an_object",
  "schema_version",
  "task_mismatch",
  "provider_mismatch",
  "model_mismatch",
  "language_unsupported",
  "no_segments",
  "too_many_segments",
  "response_too_long",
  "refusals_shape",
  "bad_refusal_code",
  "usage_shape",
  "cost_shape",
  "segment_shape",
  "segment_class",
  "class_not_allowed",
  "segment_empty",
  "segment_too_long",
  "too_many_citations",
  "forbidden_dose",
  "forbidden_prescribe",
  "forbidden_med_change",
  "forbidden_diagnosis",
  "forbidden_impersonation",
  "forbidden_care_avoidance",
  "forbidden_off_app",
  "identifier_in_output",
  "obfuscated_output",
  "disclaimer_in_output",
  "citation_outside_manifest",
  "fact_without_source",
  "citation_mismatch",
  "ungrounded_number",
  "general_info_cites",
  "general_info_second_person",
  "unknown_cites",
  "unknown_has_number",
  "interpretation_without_source",
  "confidence_range",
  "fact_advises_reader",
  "classification_shape",
  "extraction_shape",
  "too_many_candidates",
  "candidate_outside_table",
] as const;
export type ContractRefusalCode = (typeof CONTRACT_REFUSAL_CODES)[number];

/** The i18n key of the sentence the gateway attaches. The provider never writes it. */
export const AI_DISCLAIMER_KEY = "health.ai.disclosure" as const;
