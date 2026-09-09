/**
 * ONIQ HEALTH AI — the gateway. Every AI request goes through this function
 * and nothing else calls a provider.
 *
 *   gate (flags, task, provider, price, caps, region, age, environment)
 *     → consents (read once; the categories they cover decide what is READ)
 *     → context (minimum data, aliased, scrubbed, quarantined, capped)
 *     → consent (purpose × every category the context touched × recipient)
 *     → RESERVATION: caps (house, then per person per task; counts never
 *       filter on status) and the RECEIPT (health_ai_requests row) in ONE
 *       locked transaction, before the provider runs
 *     → provider.run(structured input)
 *     → contract (refuse, never trim)
 *     → persist (classification / candidates)
 *     → receipt completed → audit → result
 *
 * THE STORE IS BOUND TO THE PERSON. No method takes a user id: the function
 * that implements it closes over the id the JWT proved, so a request naming
 * another person's record or document answers `not_found` — the same word
 * as "absent" — because the store cannot see it. `aiGateway.test.ts` seeds
 * two users and proves it; `aiWiring.test.ts` reads the real implementation
 * and counts the ownership filter by effect.
 *
 * NOTHING A PROVIDER RETURNS IS STORED VERBATIM. The receipt carries
 * `storableManifest()` — a whitelist, like `auditDetail()` — and a refusal
 * is a closed code. A provider's text reaches the person only after the
 * contract accepted it, and reaches no row at all. That holds for ALL THREE
 * output kinds: a response is validated segment by segment and rebuilt from
 * named fields for the client; a classification is rebuilt from a closed
 * shape; a candidate is admitted only as an entry of the analyte table.
 * The first version validated the response kind alone and spread the other
 * two into rows (red-teamed 2026-09-08).
 *
 * AN AUDIT FAILURE AFTER THE RECEIPT IS SETTLED PROPAGATES. The receipt is
 * never rewritten as a provider error to cover an audit row that could not
 * be written; the caller answers `audit_failed`, as health-api does.
 */
import {
  AI_DISCLAIMER_KEY,
  AI_LANGUAGES,
  AI_TASKS,
  CONTEXT_FIELDS,
  EXCLUSION_REASONS,
  LIMITS,
  PROVIDER_CLASS_ALLOWLIST,
  type AiLanguage,
  type AiRefusalReason,
  type AiResponse,
  type AiTask,
  type CandidateRecord,
  type ClassificationResult,
  type ClientAiResponse,
  type ContextField,
  type ContextManifest,
  type ContractRefusalCode,
  type ExcludedItem,
  type ExclusionReason,
  TEXT_SOURCE_METHODS,
  type TextSourceMethod,
} from "./types.ts";
import { checkConsent, checkGate, consentedCategories, type Environment } from "./policy.ts";
import { buildMinimumContext, categoryOf, type DocRow, type RecordRow } from "./context.ts";
import { validateAiResponse, validateClassification, validateExtraction } from "./contract.ts";
import { providerFor as defaultProviderFor, type HealthAIProvider } from "./provider.ts";
import type { DocumentTextSource } from "./textSource.ts";
import { costEstimateUsd } from "./cost.ts";
import { isProviderError } from "./vertex.ts";
import { groundCandidates } from "./grounding.ts";
import { findCovering, type ConsentLike } from "../consent.ts";
import type { HealthFlags } from "../flags.ts";
import {
  CATEGORY_FOR_KIND,
  DATA_CATEGORIES,
  RECORD_KINDS,
  type AuditAction,
  type AuditObjectType,
  type RecordKind,
} from "../domain.ts";

/** The deployed body is CLOSED: these keys and no others (`parseAiRequest`). */
export type AiRequest = {
  task: AiTask;
  recordId?: string | null;
  documentId?: string | null;
  question?: string | null;
  language?: AiLanguage;
};

const REQUEST_KEYS = ["action", "task", "recordId", "documentId", "question", "language"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unknown keys, a text field, a non-string id: all `bad_input` before the gate. */
export function parseAiRequest(body: unknown): { ok: true; request: AiRequest } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (!REQUEST_KEYS.includes(key)) return { ok: false };
  // Exact strings from the closed lists — never an array or an object whose
  // String() happens to be one.
  if (typeof b.task !== "string" || !(AI_TASKS as readonly string[]).includes(b.task)) {
    return { ok: false };
  }
  const request: AiRequest = { task: b.task as AiTask };
  for (const key of ["recordId", "documentId"] as const) {
    const v = b[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || !UUID.test(v)) return { ok: false };
    request[key] = v;
  }
  if (b.question !== undefined && b.question !== null) {
    if (typeof b.question !== "string" || b.question.length > LIMITS.MAX_QUESTION_CHARS * 4) {
      return { ok: false };
    }
    request.question = b.question;
  }
  if (b.language !== undefined) {
    if (
      typeof b.language !== "string" ||
      !(AI_LANGUAGES as readonly string[]).includes(b.language)
    ) {
      return { ok: false };
    }
    request.language = b.language as AiLanguage;
  }
  return { ok: true, request };
}

export type GatewayActor = { isAdmin: boolean; isAdult: boolean | null; regionBlocked: boolean };

export type AiConfig = {
  flags: HealthFlags;
  environment: Environment;
  provider: unknown;
  model: unknown;
  /** The cap for this request's TASK, per person per day; the caller resolves it from the row. */
  capPerUser: number;
  capHouse: number;
  adminVerificationEnabled: boolean;
};

export type ReceiptRow = {
  request_id: string;
  task: AiTask;
  purpose: string;
  provider: string;
  model: string;
  consent_id: string | null;
  manifest: StorableManifest;
  status: "started";
};

export type ReceiptPatch = {
  status: "ok" | "refused" | "error";
  refusal_reason?: AiRefusalReason | null;
  contract_code?: ContractRefusalCode | null;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  completed_at: string;
  /** A receipt begun before the context existed (a transcription) is completed with the real manifest. */
  manifest?: StorableManifest;
  consent_id?: string | null;
};

/** What the gateway asks the store to audit; the store adds who and which request. */
export type GatewayAuditInput = {
  action: AuditAction;
  objectType: AuditObjectType;
  objectId?: string | null;
  purpose?: string | null;
  consentId?: string | null;
  outcome: "ok" | "refused" | "error";
  detail?: Record<string, unknown>;
};

export type CandidateProvenance = {
  source: "document_extraction";
  sourceRef: string;
  capturedAt: string;
  method: string;
};

/** The rolling window and the two caps a reservation is checked against. */
export type ReserveWindow = {
  /** ISO instant: receipts created at or after this count. */
  since: string;
  capHouse: number;
  /** THIS task's per-person cap (`capForTask`), never a total. */
  capPerUser: number;
};

export type ReserveResult =
  { ok: true; id: string } | { ok: false; reason: "quota_house" | "quota_user" | "caps_unset" };

export interface Store {
  loadConsents(): Promise<(ConsentLike & { id: string })[]>;
  loadRecord(id: string): Promise<RecordRow | null>;
  loadActiveRecords(kinds: readonly string[], limit: number): Promise<RecordRow[]>;
  loadDocument(id: string): Promise<DocRow | null>;
  /**
   * THE CAPS AND THE RECEIPT IN ONE STEP (Phase 4). Counts the house window
   * (every task, every person) and then the person's window for the row's
   * task — neither filtered on status — and writes the STARTED receipt only
   * if both are under their cap, all inside one locked transaction, so two
   * requests arriving together cannot both pass on the same count. The
   * deployed implementation is the SQL function health_ai_reserve_request();
   * a zero cap on either side is refused there too (caps_unset).
   */
  reserveReceipt(row: ReceiptRow, window: ReserveWindow): Promise<ReserveResult>;
  completeReceipt(id: string, patch: ReceiptPatch): Promise<void>;
  insertCandidates(
    documentId: string,
    candidates: CandidateRecord[],
    provenance: CandidateProvenance,
  ): Promise<number>;
  updateDocument(id: string, patch: Record<string, unknown>): Promise<void>;
  recordAudit(input: GatewayAuditInput): Promise<void>;
}

export type GatewayDeps = {
  store: Store;
  now: string;
  requestId: string;
  /** Null in production (Phase 2 registers no source); the tests inject one. */
  textSource: DocumentTextSource | null;
  providerFor?: (id: unknown) => HealthAIProvider;
};

export type GatewayResult =
  | {
      ok: true;
      receiptId: string;
      manifest: ContextManifest;
      result:
        | { kind: "response"; response: ClientAiResponse }
        | { kind: "classification"; classification: ClassificationResult }
        | {
            kind: "extraction";
            candidates: number;
            method: string;
            textChars: number;
            /** Phase 3b: how the text was obtained, and whether the file itself left ONIQ. */
            readMethod: TextSourceMethod | null;
            documentSent: boolean;
          };
    }
  | {
      ok: false;
      reason: AiRefusalReason;
      detail?: Record<string, string>;
      manifest?: ContextManifest;
    };

/* ------------------------------------------------------------ storage -- */

export type StorableManifest = {
  task: AiTask;
  language: AiLanguage;
  recordIds: string[];
  documentIds: string[];
  categories: string[];
  fields: ContextField[];
  charCount: number;
  estimatedInputTokens: number;
  redactions: number;
  truncated: boolean;
  injectionSuspected: boolean;
  excluded: ExcludedItem[];
  /** Phase 3b: a closed method or null; whether the document's bytes left ONIQ; the paid step's own usage. */
  readMethod: TextSourceMethod | null;
  documentSent: boolean;
  pages: number | null;
  transcription: { inputTokens: number; outputTokens: number; truncated: boolean } | null;
};

const FIELD_NAME = /^[a-zA-Z]{1,24}$/;

/**
 * A whitelist over the manifest, the way `auditDetail()` is a whitelist over
 * a detail: ids that are ids, names from closed lists, numbers and booleans.
 * A future field holding text cannot reach the row without an edit here.
 */
export function storableManifest(m: ContextManifest): StorableManifest {
  const ids = (xs: unknown) =>
    Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && UUID.test(x)) : [];
  const names = (xs: unknown, allowed: readonly string[]) =>
    Array.isArray(xs)
      ? xs.filter((x): x is string => typeof x === "string" && allowed.includes(x))
      : [];
  const num = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const excluded: ExcludedItem[] = Array.isArray(m.excluded)
    ? m.excluded
        .filter(
          (e) =>
            e &&
            typeof e.id === "string" &&
            UUID.test(e.id) &&
            typeof e.field === "string" &&
            FIELD_NAME.test(e.field) &&
            (EXCLUSION_REASONS as readonly string[]).includes(e.reason),
        )
        .map((e) => ({ id: e.id, field: e.field, reason: e.reason as ExclusionReason }))
    : [];
  return {
    task: (AI_TASKS as readonly string[]).includes(m.task) ? m.task : "summarize_timeline",
    language: (AI_LANGUAGES as readonly string[]).includes(m.language) ? m.language : "en",
    recordIds: ids(m.recordIds),
    documentIds: ids(m.documentIds),
    categories: names(m.categories, DATA_CATEGORIES),
    fields: names(m.fields, CONTEXT_FIELDS) as ContextField[],
    charCount: num(m.charCount),
    estimatedInputTokens: num(m.estimatedInputTokens),
    redactions: num(m.redactions),
    truncated: m.truncated === true,
    injectionSuspected: m.injectionSuspected === true,
    excluded,
    readMethod:
      typeof m.readMethod === "string" &&
      (TEXT_SOURCE_METHODS as readonly string[]).includes(m.readMethod)
        ? m.readMethod
        : null,
    documentSent: m.documentSent === true,
    pages: typeof m.pages === "number" && Number.isFinite(m.pages) ? num(m.pages) : null,
    transcription:
      m.transcription && typeof m.transcription === "object"
        ? {
            inputTokens: num(m.transcription.inputTokens),
            outputTokens: num(m.transcription.outputTokens),
            truncated: m.transcription.truncated === true,
          }
        : null,
  };
}

/**
 * Aliases back to ids, and what was left out, for the client — built from
 * NAMED fields, never a spread, so a key the provider invented (a prompt,
 * an echo of its input) cannot reach the wire.
 */
export function toClientResponse(
  response: AiResponse,
  manifest: ContextManifest,
): ClientAiResponse {
  return {
    schemaVersion: response.schemaVersion,
    task: response.task,
    provider: response.provider,
    model: response.model,
    language: response.language,
    refusals: [...response.refusals],
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    },
    costUsd: response.costUsd,
    segments: response.segments.map((s) => ({
      class: s.class,
      text: s.text,
      ...(s.confidence === undefined ? {} : { confidence: s.confidence }),
      sourceRecordIds: (s.sourceRefs ?? [])
        .map((ref) => manifest.recordIds[Number(ref.slice(1)) - 1])
        .filter((id): id is string => typeof id === "string"),
    })),
    disclaimerKey: AI_DISCLAIMER_KEY,
    excluded: { count: manifest.excluded.length, recordIds: manifest.excluded.map((e) => e.id) },
  };
}

/* ------------------------------------------------------------ pipeline -- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The record kinds and categories extraction can WRITE; storage consent is needed for each. */
const EXTRACTABLE_CATEGORIES = ["labs", "vitals"] as const;

/** The same set the deployed Store filters on; a row carrying any other status is not a target. */
const READABLE_DOCUMENT_STATUSES = ["stored", "processing", "ready"];

/** Which output kind each task must come back as. */
function outputKindFor(task: AiTask): "response" | "classification" | "extraction" {
  if (task === "classify_document") return "classification";
  if (task === "extract_document") return "extraction";
  return "response";
}

export async function runHealthAi(
  deps: GatewayDeps,
  config: AiConfig,
  actor: GatewayActor,
  req: AiRequest,
): Promise<GatewayResult> {
  const { store, now, requestId } = deps;
  const resolve = deps.providerFor ?? defaultProviderFor;
  const language: AiLanguage = req.language ?? "en";
  const audit = (input: GatewayAuditInput) => store.recordAudit(input);
  const refusedWith = async (
    reason: AiRefusalReason,
    detail?: Record<string, string>,
    manifest?: ContextManifest,
  ): Promise<GatewayResult> => {
    await audit({
      action: "ai.refused",
      objectType: "account",
      outcome: "refused",
      detail: {
        task: String(req.task),
        reason,
        provider: String(config.provider),
        model: String(config.model),
        count: manifest?.recordIds.length ?? 0,
        // A provider failure's CLOSED code (vertex_http_403_permission_denied,
        // vertex_timeout, …): the one diagnostic a refused call leaves
        // behind, readable from the audit table without any log. Never the
        // provider's sentence — that stays on the thrown object and dies here.
        ...(detail?.code ? { code: detail.code } : {}),
      },
    });
    return { ok: false, reason, detail, manifest };
  };
  /** The closed code of a provider failure, or nothing: a thrown object is never echoed. */
  const providerCode = (e: unknown): Record<string, string> | undefined =>
    isProviderError(e) ? { code: e.code } : undefined;

  // 0. THE LANGUAGE IS ONE OF THREE. parseAiRequest refuses anything else at
  //    the door; this is the same rule one layer down, so a caller that
  //    reaches the gateway by another road (a test, a future function) can
  //    never carry a language the templates and the contract do not know.
  if (!(AI_LANGUAGES as readonly string[]).includes(language)) {
    return refusedWith("question_rejected", { field: "language" });
  }

  // 1. THE GATE, before any row about the person is read.
  const gate = checkGate({
    flags: config.flags,
    environment: config.environment,
    actor: { isAdmin: actor.isAdmin, isAdult: actor.isAdult },
    adminVerificationEnabled: config.adminVerificationEnabled,
    regionBlocked: actor.regionBlocked,
    providerId: config.provider,
    model: config.model,
    task: req.task,
    capPerUser: config.capPerUser,
    capHouse: config.capHouse,
  });
  if (!gate.allowed) return refusedWith(gate.reason, gate.detail);
  const { task, providerId, model, recipient } = gate;

  // 2. CONSENTS FIRST, so the read is consent-driven: rows in a category the
  //    person has not consented to for AI are never loaded, let alone sent.
  const consents = await store.loadConsents();
  const covered = consentedCategories(consents, recipient, now, DATA_CATEGORIES);
  const uncovered = DATA_CATEGORIES.find((c) => !covered.includes(c)) ?? "vitals";
  const needsDocument = task === "classify_document" || task === "extract_document";

  let records: RecordRow[] = [];
  let document: DocRow | null = null;
  let documentText: string | null = null;
  // Phase 3b: how the document's text was obtained, and the paid step's own usage.
  let readMethod: TextSourceMethod | null = null;
  let documentSent = false;
  let pages: number | null = null;
  let textTruncated = false;
  let transcription: { inputTokens: number; outputTokens: number; truncated: boolean } | null =
    null;
  // A receipt begun BEFORE the context exists, for the one step that spends
  // before a context can be built — a transcription. Null until then.
  let receiptId: string | null = null;

  /**
   * The window every reservation is checked against: rolling 24h from `now`,
   * the house cap (the owner's ceiling, B11) and THIS task's per-person cap.
   * The check itself — house first, then the person, neither count filtered
   * on status — runs INSIDE the store's reservation, under one lock, in the
   * same transaction as the receipt it writes (Phase 4: a count followed by
   * an insert was two statements and one race).
   */
  const reserveWindow = (): ReserveWindow => ({
    since: new Date(Date.parse(now) - DAY_MS).toISOString(),
    capHouse: config.capHouse,
    capPerUser: config.capPerUser,
  });
  /** A manifest for a receipt written before anything was built: the id and closed names only. */
  const provisionalManifest = (doc: DocRow): ContextManifest => ({
    task,
    language,
    recordIds: [],
    documentIds: [doc.id],
    categories: ["documents"],
    fields: [],
    charCount: 0,
    estimatedInputTokens: 0,
    redactions: 0,
    excluded: [],
    truncated: false,
    injectionSuspected: false,
    readMethod: null,
    documentSent: true,
    pages: null,
    transcription: null,
  });
  /** Refuse, completing a provisional receipt first: nothing may stay "started". */
  const refusedReceipted = async (
    reason: AiRefusalReason,
    detail?: Record<string, string>,
    manifest?: ContextManifest,
  ): Promise<GatewayResult> => {
    if (receiptId !== null) {
      await store.completeReceipt(receiptId, {
        status: "refused",
        refusal_reason: reason,
        completed_at: now,
        ...(manifest ? { manifest: storableManifest(manifest) } : {}),
        ...(transcription
          ? {
              input_tokens: transcription.inputTokens,
              output_tokens: transcription.outputTokens,
              cost_usd: costEstimateUsd(model, transcription),
            }
          : {}),
      });
    }
    return refusedWith(reason, detail, manifest);
  };

  if (needsDocument) {
    if (!req.documentId) return refusedWith("not_found");
    document = await store.loadDocument(req.documentId);
    if (
      !document ||
      (document.status !== undefined && !READABLE_DOCUMENT_STATUSES.includes(document.status))
    ) {
      return refusedWith("not_found");
    }
    if (!covered.includes("documents")) {
      return refusedWith("ai_consent_required", {
        purpose: "ai_interpretation",
        category: "documents",
        recipient,
      });
    }
    if (task === "extract_document") {
      // Extraction WRITES candidate records, which is a storage act: the
      // storage consent must cover every category a candidate can land in.
      for (const category of EXTRACTABLE_CATEGORIES) {
        if (
          !findCovering(consents, { purpose: "store_records", category, recipient: "oniq" }, now)
        ) {
          return refusedWith("consent_required", { purpose: "store_records", category });
        }
      }
    }
    const read = deps.textSource ? await deps.textSource.read(document.id) : null;
    if (read?.kind === "text") {
      documentText = read.text;
      readMethod = read.method;
      pages = read.pages;
      textTruncated = read.truncated;
    } else if (read?.kind === "bytes") {
      // 2b. A PAID STEP BEFORE THE CONTEXT EXISTS (Phase 3b). The file has no
      //     text layer ONIQ can read, so the registered provider must
      //     transcribe it — the one call that sends a person's DOCUMENT, not
      //     fields, to Google. The caps are checked and the receipt written
      //     FIRST, exactly as steps 5 and 6 do for every other call; a provider
      //     that cannot transcribe (the synthetic) costs nothing and the seam
      //     answers no_text below.
      const provider = resolve(providerId);
      if (typeof provider.transcribe === "function") {
        const provisional = provisionalManifest(document);
        const reserved = await store.reserveReceipt(
          {
            request_id: requestId,
            task,
            purpose: "ai_interpretation",
            provider: providerId,
            model,
            consent_id: null,
            manifest: storableManifest(provisional),
            status: "started",
          },
          reserveWindow(),
        );
        if (!reserved.ok) return refusedWith(reserved.reason, undefined, provisional);
        receiptId = reserved.id;
        try {
          const t = await provider.transcribe({
            model,
            mime: read.mime,
            bytes: read.bytes,
            language,
            maxChars: LIMITS.MAX_DOCUMENT_CHARS,
          });
          documentText = t.text;
          readMethod = "vertex_transcription";
          documentSent = true;
          textTruncated = t.truncated;
          transcription = {
            inputTokens: t.usage.inputTokens,
            outputTokens: t.usage.outputTokens,
            truncated: t.truncated,
          };
        } catch (e) {
          await store.completeReceipt(receiptId, {
            status: "error",
            refusal_reason: "provider_error",
            completed_at: now,
          });
          return refusedWith("provider_error", providerCode(e), provisional);
        }
      }
    }
  } else if (task === "explain_record") {
    if (!req.recordId) return refusedWith("not_found");
    const target = await store.loadRecord(req.recordId);
    if (!target || (target.status !== undefined && target.status !== "active")) {
      return refusedWith("not_found");
    }
    const category = categoryOf(target.kind);
    if (!covered.includes(category)) {
      return refusedWith("ai_consent_required", {
        purpose: "ai_interpretation",
        category,
        recipient,
      });
    }
    // Enough rows of the kind that the context can find priors of the SAME
    // ANALYTE among them (context.ts filters on display).
    const prior = await store.loadActiveRecords([target.kind], LIMITS.MAX_RECORDS);
    records = [target, ...prior.filter((r) => r.id !== target.id)];
  } else {
    const kinds = RECORD_KINDS.filter((k) => covered.includes(CATEGORY_FOR_KIND[k as RecordKind]));
    if (kinds.length === 0) {
      return refusedWith("ai_consent_required", {
        purpose: "ai_interpretation",
        category: uncovered,
        recipient,
      });
    }
    records = await store.loadActiveRecords(kinds, LIMITS.MAX_RECORDS * 4);
  }

  // 3. THE CONTEXT — minimum data for this task.
  const built = buildMinimumContext({
    task,
    language,
    records,
    targetRecordId: req.recordId ?? null,
    document,
    documentText,
    question: req.question ?? null,
  });
  if (!built.ok) {
    return refusedReceipted(
      built.reason,
      built.detail,
      receiptId !== null && document ? provisionalManifest(document) : undefined,
    );
  }
  const { context, manifest } = built;
  manifest.readMethod = readMethod;
  manifest.documentSent = documentSent;
  manifest.pages = pages;
  manifest.transcription = transcription;
  if (textTruncated) manifest.truncated = true;

  // 4. CONSENT, for every category the context touched, naming this provider.
  const consent = checkConsent(consents, manifest.categories, recipient, now);
  if (!consent.allowed) return refusedReceipted(consent.reason, consent.detail, manifest);
  const consentId = consent.consentIds[0] ?? null;

  // 5+6. THE RESERVATION: the caps checked and the receipt written in ONE
  //    locked step, before the provider runs. Counts do not filter on
  //    status: a refused request is still a request. Already reserved when a
  //    transcription ran — that provisional receipt is what the settle below
  //    completes with the real manifest and consent.
  const provisional = receiptId !== null;
  if (receiptId === null) {
    const reserved = await store.reserveReceipt(
      {
        request_id: requestId,
        task,
        purpose: consent.purpose,
        provider: providerId,
        model,
        consent_id: consentId,
        manifest: storableManifest(manifest),
        status: "started",
      },
      reserveWindow(),
    );
    if (!reserved.ok) return refusedWith(reserved.reason, undefined, manifest);
    receiptId = reserved.id;
  }
  const receipt: string = receiptId;

  const baseDetail = {
    task,
    purpose: consent.purpose,
    provider: providerId,
    model,
    count: manifest.recordIds.length,
    method: gate.adminVerification ? "admin_verification" : "user",
    // Phase 3b: how a document's text was obtained; "none" for record tasks.
    readMethod: readMethod ?? "none",
    documentSent,
  };

  // Once the receipt is settled (ok, refused or error) a throw is no longer
  // the provider's: it is an audit row that could not be written, and that
  // propagates rather than rewriting the receipt.
  //
  // A transcription's usage rides on the same receipt as the call it fed:
  // one request, two provider calls, one line in the ledger with both.
  let settled = false;
  const settle = async (patch: ReceiptPatch) => {
    const full: ReceiptPatch = { ...patch };
    if (transcription) {
      full.input_tokens = (patch.input_tokens ?? 0) + transcription.inputTokens;
      full.output_tokens = (patch.output_tokens ?? 0) + transcription.outputTokens;
      full.cost_usd = costEstimateUsd(model, {
        inputTokens: full.input_tokens,
        outputTokens: full.output_tokens,
      });
    }
    if (provisional) {
      full.manifest = storableManifest(manifest);
      full.consent_id = consentId;
    }
    await store.completeReceipt(receipt, full);
    settled = true;
  };
  const rejectOutput = async (code: ContractRefusalCode): Promise<GatewayResult> => {
    await settle({
      status: "refused",
      refusal_reason: "output_rejected",
      contract_code: code,
      completed_at: now,
    });
    await audit({
      action: "ai.refused",
      objectType: "account",
      purpose: consent.purpose,
      consentId,
      outcome: "refused",
      detail: { ...baseDetail, reason: "output_rejected", code },
    });
    return { ok: false, reason: "output_rejected", detail: { code }, manifest };
  };

  try {
    // 7. THE PROVIDER.
    const provider = resolve(providerId);
    let output: unknown;
    try {
      output = await provider.run({
        task,
        model,
        context,
        counts: { records: context.records.length, documents: context.documents.length },
      });
    } catch (e) {
      await settle({ status: "error", refusal_reason: "provider_error", completed_at: now });
      return refusedWith("provider_error", providerCode(e), manifest);
    }

    // 8. THE CONTRACT, then persistence, then the completed receipt. The
    //    output kind must be the one this TASK produces: an extraction
    //    answering a record task would write rows nobody asked for.
    const out = (output ?? {}) as { kind?: unknown };
    if (!output || typeof output !== "object") return rejectOutput("not_an_object");
    if (out.kind !== outputKindFor(task)) return rejectOutput("task_mismatch");

    if (out.kind === "response") {
      const response = (out as { response?: unknown }).response;
      const verdict = validateAiResponse(
        response,
        manifest,
        {
          task,
          provider: providerId,
          model,
          language,
          classAllowlist: PROVIDER_CLASS_ALLOWLIST[providerId],
        },
        context.records,
      );
      if (!verdict.ok) return rejectOutput(verdict.code);
      const accepted = response as AiResponse;
      const cost = costEstimateUsd(model, accepted.usage);
      await settle({
        status: "ok",
        input_tokens: accepted.usage.inputTokens,
        output_tokens: accepted.usage.outputTokens,
        cost_usd: cost,
        completed_at: now,
      });
      // The audit names an object only when the request touched it: the
      // explained record, and only if it is in the manifest. An id riding
      // on a summary is not an audit fact.
      const objectId =
        task === "explain_record" && req.recordId && manifest.recordIds.includes(req.recordId)
          ? req.recordId
          : null;
      await audit({
        action: "ai.request",
        objectType: objectId ? "record" : "account",
        objectId,
        purpose: consent.purpose,
        consentId,
        outcome: "ok",
        detail: baseDetail,
      });
      return {
        ok: true,
        receiptId: receipt,
        manifest,
        result: {
          kind: "response",
          response: toClientResponse({ ...accepted, costUsd: cost }, manifest),
        },
      };
    }

    const doc = document!;
    if (out.kind === "classification") {
      const raw = out as { classification?: unknown; usage?: unknown };
      const verdict = validateClassification(raw.classification, raw.usage);
      if (!verdict.ok) return rejectOutput(verdict.code);
      const cost = costEstimateUsd(model, verdict.usage);
      await store.updateDocument(doc.id, {
        classification: {
          kind: verdict.value.kind,
          confidence: verdict.value.confidence,
          method: verdict.value.method,
          at: now,
          provider: providerId,
          model,
        },
      });
      await settle({
        status: "ok",
        input_tokens: verdict.usage.inputTokens,
        output_tokens: verdict.usage.outputTokens,
        cost_usd: cost,
        completed_at: now,
      });
      await audit({
        action: "documents.classify",
        objectType: "document",
        objectId: doc.id,
        purpose: consent.purpose,
        consentId,
        outcome: "ok",
        detail: { ...baseDetail, documentKind: verdict.value.kind },
      });
      return {
        ok: true,
        receiptId: receipt,
        manifest,
        result: { kind: "classification", classification: verdict.value },
      };
    }

    // extraction — every candidate an entry of the table, or none is stored.
    const raw = out as { extraction?: unknown; usage?: unknown };
    const verdict = validateExtraction(raw.extraction, raw.usage);
    if (!verdict.ok) return rejectOutput(verdict.code);
    const { method, textChars } = verdict.value;
    const cost = costEstimateUsd(model, verdict.usage);
    // THE PAGE IS THE AUTHORITY, NOT THE PROVIDER. A value is stored only if
    // it is PRINTED in the text the provider was given — a number a model
    // wrote under an instruction on the page, or invented, is dropped here.
    // Since 2026-09-09 these values go straight into the timeline with no
    // confirm tap, so this is the only thing between a sentence on a page and
    // a person's record. Counts only travel to the audit row.
    const grounded = groundCandidates(
      verdict.value.candidates,
      context.documents[0]?.text ?? "",
      context.documents[0]?.capturedDay ?? now.slice(0, 10),
      now,
    );
    const candidates = grounded.kept;
    const droppedCount = grounded.dropped.ungrounded + grounded.dropped.duplicate;
    const inserted = await store.insertCandidates(doc.id, candidates, {
      source: "document_extraction",
      sourceRef: doc.id,
      capturedAt: now,
      method,
    });
    await store.updateDocument(doc.id, {
      extraction_status: inserted > 0 ? "read" : "empty",
      text_chars: textChars,
    });
    await settle({
      status: "ok",
      input_tokens: verdict.usage.inputTokens,
      output_tokens: verdict.usage.outputTokens,
      cost_usd: cost,
      completed_at: now,
    });
    await audit({
      action: "documents.extract",
      objectType: "document",
      objectId: doc.id,
      purpose: consent.purpose,
      consentId,
      outcome: "ok",
      detail: { ...baseDetail, count: inserted, dropped: droppedCount },
    });
    return {
      ok: true,
      receiptId: receipt,
      manifest,
      result: {
        kind: "extraction",
        candidates: inserted,
        method,
        textChars,
        readMethod,
        documentSent,
      },
    };
  } catch (e) {
    // Nothing after the receipt may leave it "started": a throw before it is
    // settled lands here, completes it as an error, and answers as a
    // refusal. A throw AFTER it is settled can only be the audit row (it is
    // the last thing that runs), so it is answered as one — the receipt
    // stands as written, and nothing of the thrown object travels but a
    // provider's closed code.
    if (settled) throw new Error("audit_failed");
    try {
      await store.completeReceipt(receipt, {
        status: "error",
        refusal_reason: "provider_error",
        completed_at: now,
        ...(transcription
          ? {
              input_tokens: transcription.inputTokens,
              output_tokens: transcription.outputTokens,
              cost_usd: costEstimateUsd(model, transcription),
            }
          : {}),
      });
    } catch {
      /* the receipt could not be completed either; the audit row below still records the failure */
    }
    return refusedWith("provider_error", providerCode(e), manifest);
  }
}
