/**
 * ONIQ HEALTH AI — the gateway. Every AI request goes through this function
 * and nothing else calls a provider.
 *
 *   gate (flags, task, provider, price, caps, region, age, environment)
 *     → consents (read once; the categories they cover decide what is READ)
 *     → context (minimum data, aliased, scrubbed, quarantined, capped)
 *     → consent (purpose × every category the context touched × recipient)
 *     → caps (per person, house; counts never filter on status)
 *     → RECEIPT (health_ai_requests row, before the provider runs)
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
} from "./types.ts";
import { checkConsent, checkGate, consentedCategories, type Environment } from "./policy.ts";
import { buildMinimumContext, categoryOf, type DocRow, type RecordRow } from "./context.ts";
import { validateAiResponse, validateClassification, validateExtraction } from "./contract.ts";
import { providerFor as defaultProviderFor, type HealthAIProvider } from "./provider.ts";
import type { DocumentTextSource } from "./textSource.ts";
import { costEstimateUsd } from "./cost.ts";
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

export interface Store {
  loadConsents(): Promise<(ConsentLike & { id: string })[]>;
  loadRecord(id: string): Promise<RecordRow | null>;
  loadActiveRecords(kinds: readonly string[], limit: number): Promise<RecordRow[]>;
  loadDocument(id: string): Promise<DocRow | null>;
  /** The person's receipts for THIS task in the window — caps are per task (B11). */
  countUserSince(sinceIso: string, task: AiTask): Promise<number>;
  countHouseSince(sinceIso: string): Promise<number>;
  beginReceipt(row: ReceiptRow): Promise<string>;
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
        | { kind: "extraction"; candidates: number; method: string; textChars: number };
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
      },
    });
    return { ok: false, reason, detail, manifest };
  };

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
    documentText = deps.textSource ? await deps.textSource.text(document.id) : null;
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
  if (!built.ok) return refusedWith(built.reason, built.detail);
  const { context, manifest } = built;

  // 4. CONSENT, for every category the context touched, naming this provider.
  const consent = checkConsent(consents, manifest.categories, recipient, now);
  if (!consent.allowed) return refusedWith(consent.reason, consent.detail, manifest);
  const consentId = consent.consentIds[0] ?? null;

  // 5. CAPS. Counts do not filter on status: a refused request is still a request.
  const since = new Date(Date.parse(now) - DAY_MS).toISOString();
  if ((await store.countHouseSince(since)) >= config.capHouse) {
    return refusedWith("quota_house", undefined, manifest);
  }
  if ((await store.countUserSince(since, task)) >= config.capPerUser) {
    return refusedWith("quota_user", undefined, manifest);
  }

  // 6. THE RECEIPT, before the provider runs.
  const receiptId = await store.beginReceipt({
    request_id: requestId,
    task,
    purpose: consent.purpose,
    provider: providerId,
    model,
    consent_id: consentId,
    manifest: storableManifest(manifest),
    status: "started",
  });

  const baseDetail = {
    task,
    purpose: consent.purpose,
    provider: providerId,
    model,
    count: manifest.recordIds.length,
    method: gate.adminVerification ? "admin_verification" : "user",
  };

  // Once the receipt is settled (ok, refused or error) a throw is no longer
  // the provider's: it is an audit row that could not be written, and that
  // propagates rather than rewriting the receipt.
  let settled = false;
  const settle = async (patch: ReceiptPatch) => {
    await store.completeReceipt(receiptId, patch);
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
    } catch {
      await settle({ status: "error", refusal_reason: "provider_error", completed_at: now });
      return refusedWith("provider_error", undefined, manifest);
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
        receiptId,
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
        receiptId,
        manifest,
        result: { kind: "classification", classification: verdict.value },
      };
    }

    // extraction — every candidate an entry of the table, or none is stored.
    const raw = out as { extraction?: unknown; usage?: unknown };
    const verdict = validateExtraction(raw.extraction, raw.usage);
    if (!verdict.ok) return rejectOutput(verdict.code);
    const { candidates, method, textChars } = verdict.value;
    const cost = costEstimateUsd(model, verdict.usage);
    const inserted = await store.insertCandidates(doc.id, candidates, {
      source: "document_extraction",
      sourceRef: doc.id,
      capturedAt: now,
      method,
    });
    await store.updateDocument(doc.id, {
      extraction_status: inserted > 0 ? "candidates" : "empty",
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
      detail: { ...baseDetail, count: inserted },
    });
    return {
      ok: true,
      receiptId,
      manifest,
      result: { kind: "extraction", candidates: inserted, method, textChars },
    };
  } catch {
    // Nothing after the receipt may leave it "started": a throw before it is
    // settled lands here, completes it as an error, and answers as a
    // refusal. A throw AFTER it is settled can only be the audit row (it is
    // the last thing that runs), so it is answered as one — the receipt
    // stands as written, and nothing of the thrown object travels.
    if (settled) throw new Error("audit_failed");
    try {
      await store.completeReceipt(receiptId, {
        status: "error",
        refusal_reason: "provider_error",
        completed_at: now,
      });
    } catch {
      /* the receipt could not be completed either; the audit row below still records the failure */
    }
    return refusedWith("provider_error", undefined, manifest);
  }
}
