// health-api — ONIQ Health, Phase 1. DARK: answers 503 until health_config
// says otherwise. Owner brief 2026-09-08; design in docs/health/02-architecture.md.
//
// THE PIPELINE, in the order the code below runs it:
//   flags (missing row = off) -> JWT -> per-action flag -> region signal ->
//   consent -> ownership filter -> the action -> audit -> a redacted log line
//
// THE OWNERSHIP FILTER IS THE WHOLE AUTHORIZATION. `admin` is the service
// role and bypasses RLS, so `.eq("user_id", user.id)` on every read and write
// is what keeps one person out of another's records. "Not yours" and "not
// there" answer the same 404 so ids cannot be probed.
//
// NOTHING HERE CALLS A MODEL OR GOOGLE. This function has no AI and no
// Healthcare API; `adapterFor` returns the null adapter and the isolation test
// fails if a provider host or a model helper appears in this file. Phase 2's
// AI lives in health-ai; what arrived HERE with Phase 2 is the record side of
// it — candidates a person confirms or rejects, the AI consent pair, the
// receipts in export and purge, and `status.aiAvailable`.
//
// NO CONTENT IN LOGS OR AUDIT. The one log line goes through redactForLog and
// every audit detail through auditDetail — both whitelists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readHealthConfig, type HealthFlags } from "../_shared/health/flags.ts";
import {
  CATEGORY_FOR_KIND,
  CONSENT_TERMS_VERSIONS,
  DATA_CATEGORIES,
  EXT_FOR_MIME,
  isGrantable,
  validateDocumentInput,
  validateRecordInput,
  type AuditAction,
  type AuditObjectType,
  type ConsentPurpose,
  type DataCategory,
} from "../_shared/health/domain.ts";
import { RECIPIENT_FOR_PROVIDER, type ProviderId } from "../_shared/health/ai/types.ts";
import { isProviderId } from "../_shared/health/ai/provider.ts";
import { resolveEnvironment } from "../_shared/health/ai/policy.ts";
import { findCovering, nextVersion } from "../_shared/health/consent.ts";
import { redactForLog } from "../_shared/health/redact.ts";
import { expiryFor, type RetentionPolicyLike } from "../_shared/health/retention.ts";
import { appendAudit, type AuditOutcome } from "../_shared/health/audit.ts";
import { adapterFor } from "../_shared/health/adapter.ts";

const BUCKET = "health-documents";
/** Storage is by ONIQ, always: the store_records consent names no one else. */
const STORAGE_RECIPIENT = "oniq";
const SIGNED_READ_SECONDS = 60;
const RATE_PER_MINUTE = 60;
const TIMELINE_LIMIT = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The REGION axis of the UAE rule, for a server-mediated write. The database
 * trigger enforces the HOME axis (profiles.country_code) on every insert
 * whoever makes it; the region axis reads cf-ipcountry off the request, and a
 * service-role request from this function carries the function's headers,
 * not the person's. So the person's own header is read here and a positive
 * blocked signal refuses the write — the same fail-closed-on-positive rule as
 * healthWritesAllowed() in src/lib/healthGuard.ts. Agreement with the country
 * registry is pinned by src/health/__tests__/isolation.test.ts.
 */
const HEALTH_BLOCKED_REGIONS = ["AE"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logSafe(fields: Record<string, unknown>): void {
  console.log(JSON.stringify(redactForLog({ fn: "health-api", ...fields })));
}

const rlBuckets = new Map<string, number[]>();
function rateLimited(id: string): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= RATE_PER_MINUTE) {
    rlBuckets.set(id, arr);
    return true;
  }
  arr.push(now);
  rlBuckets.set(id, arr);
  return false;
}

// deno-lint-ignore no-explicit-any
type Admin = any;

type Ctx = {
  admin: Admin;
  userId: string;
  flags: HealthFlags;
  environment: string;
  /** The raw health_config row (null = none), for the AI columns status reads. */
  config: Record<string, unknown> | null;
  requestId: string;
  now: string;
  regionBlocked: boolean;
  policies: RetentionPolicyLike[];
};

type Refusal = { status: number; reason: string; extra?: Record<string, unknown> };

function refuse(ctx: Ctx, r: Refusal): Response {
  return json(
    { ok: false, reason: r.reason, requestId: ctx.requestId, ...(r.extra ?? {}) },
    r.status,
  );
}

function ok(ctx: Ctx, data: unknown): Response {
  return json({ ok: true, data, requestId: ctx.requestId }, 200);
}

async function audit(
  ctx: Ctx,
  action: AuditAction,
  objectType: AuditObjectType,
  outcome: AuditOutcome,
  fields: {
    objectId?: string | null;
    purpose?: string | null;
    consentId?: string | null;
    detail?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await appendAudit(ctx.admin, {
    userId: ctx.userId,
    actor: ctx.userId,
    action,
    objectType,
    objectId: fields.objectId ?? null,
    purpose: fields.purpose ?? null,
    consentId: fields.consentId ?? null,
    requestId: ctx.requestId,
    outcome,
    detail: fields.detail,
  });
}

/* ------------------------------------------------------------- consent -- */

type ConsentRow = {
  id: string;
  purpose: string;
  data_categories: string[];
  recipient: string;
  status: string;
  start_time: string;
  expiry_time: string | null;
  version: number;
  source: string;
  revoked_at: string | null;
  created_at: string;
  terms_version: string;
  notice_locale: string;
  jurisdiction: string;
};

const CONSENT_COLUMNS =
  "id, purpose, data_categories, recipient, status, start_time, expiry_time, version, source, revoked_at, created_at, terms_version, notice_locale, jurisdiction";

async function loadConsents(ctx: Ctx): Promise<ConsentRow[]> {
  const { data } = await ctx.admin
    .from("health_consents")
    .select(CONSENT_COLUMNS)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ConsentRow[];
}

function asConsentLike(c: ConsentRow) {
  return {
    purpose: c.purpose,
    dataCategories: c.data_categories,
    recipient: c.recipient,
    status: c.status,
    startTime: c.start_time,
    expiryTime: c.expiry_time,
    termsVersion: c.terms_version,
  };
}

/** The covering consent for a purpose+category+recipient, or a refusal naming purpose and category. */
async function requireConsent(
  ctx: Ctx,
  purpose: ConsentPurpose,
  category: DataCategory,
  recipient: string = STORAGE_RECIPIENT,
): Promise<{ consent: ConsentRow } | { refusal: Refusal }> {
  const rows = await loadConsents(ctx);
  const hit = findCovering(
    rows.map((r) => ({ row: r, ...asConsentLike(r) })),
    { purpose, category, recipient },
    ctx.now,
  );
  if (!hit) {
    return {
      refusal: { status: 403, reason: "consent_required", extra: { purpose, category } },
    };
  }
  return { consent: hit.row };
}

function consentOut(c: ConsentRow) {
  return {
    consentId: c.id,
    purpose: c.purpose,
    dataCategories: c.data_categories,
    source: c.source,
    recipient: c.recipient,
    startTime: c.start_time,
    expiryTime: c.expiry_time,
    status: c.status,
    revokedAt: c.revoked_at,
    createdAt: c.created_at,
    version: c.version,
    termsVersion: c.terms_version,
    noticeLocale: c.notice_locale,
    jurisdiction: c.jurisdiction,
  };
}

/* ------------------------------------------------------------- actions -- */

/**
 * Whether health-ai would answer THIS caller today, computed the way the
 * gateway's gate computes it: both flags, a registered provider, caps set,
 * and — because the only provider is synthetic — not production unless the
 * caller is an admin and the row allows admin verification. A screen offers
 * an AI section on this field, never on the client constant alone.
 */
async function aiAvailability(ctx: Ctx, url: string | undefined) {
  const row = ctx.config ?? {};
  const providerId = isProviderId(row.ai_provider) ? (row.ai_provider as ProviderId) : null;
  const capUser = Number(row.ai_daily_cap_per_user ?? 0);
  const capHouse = Number(row.ai_daily_cap_house ?? 0);
  const environment = resolveEnvironment(row.environment, url);
  let isAdmin = false;
  if (ctx.flags["health.ai.enabled"]) {
    const { data } = await ctx.admin.rpc("is_admin", { _uid: ctx.userId });
    isAdmin = data === true;
  }
  const adminVerification = isAdmin && row.ai_admin_verification_enabled === true;
  const available =
    ctx.flags["health.ai.enabled"] &&
    providerId !== null &&
    capUser > 0 &&
    capHouse > 0 &&
    (environment !== "production" || adminVerification);
  return {
    aiAvailable: available,
    aiRecipient: providerId ? RECIPIENT_FOR_PROVIDER[providerId] : null,
    environment,
  };
}

async function actStatus(ctx: Ctx): Promise<Response> {
  const count = async (table: string, extra: (q: Admin) => Admin) => {
    const q = extra(ctx.admin.from(table).select("id", { count: "exact", head: true }));
    const { count: n } = await q.eq("user_id", ctx.userId);
    return n ?? 0;
  };
  const [records, documents, consents] = await Promise.all([
    count("health_records", (q) => q.eq("status", "active")),
    count("health_documents", (q) => q.neq("status", "deleted")),
    count("health_consents", (q) => q.eq("status", "active")),
  ]);
  const rows = await loadConsents(ctx);
  const store = rows.find((r) => r.purpose === "store_records" && r.status === "active");
  const ai = await aiAvailability(ctx, Deno.env.get("SUPABASE_URL"));
  const aiConsent = rows.find(
    (r) =>
      r.purpose === "ai_interpretation" && r.status === "active" && r.recipient === ai.aiRecipient,
  );
  return ok(ctx, {
    flags: ctx.flags,
    environment: ai.environment,
    counts: { records, documents, consents },
    storeConsent: { active: !!store, categories: store?.data_categories ?? [] },
    aiConsent: { active: !!aiConsent, categories: aiConsent?.data_categories ?? [] },
    aiAvailable: ai.aiAvailable,
  });
}

async function actTimeline(ctx: Ctx): Promise<Response> {
  const { data, error } = await ctx.admin
    .from("health_records")
    .select(
      "id, kind, display, code_system, code, value_num, value_unit, value_text, effective_at, recorded_at, provenance, document_id, expires_at",
    )
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .order("effective_at", { ascending: false })
    .limit(TIMELINE_LIMIT);
  if (error) return refuse(ctx, { status: 500, reason: "failed" });
  const now = Date.parse(ctx.now);
  const rows = (data ?? [])
    .filter((r: Record<string, unknown>) => !r.expires_at || Date.parse(String(r.expires_at)) > now)
    .map((r: Record<string, unknown>) => ({
      id: r.id,
      kind: r.kind,
      display: r.display,
      code: r.code ? { system: r.code_system, code: r.code, display: r.display } : null,
      valueNum: r.value_num === null ? null : Number(r.value_num),
      valueUnit: r.value_unit,
      valueText: r.value_text,
      effectiveAt: r.effective_at,
      recordedAt: r.recorded_at,
      provenance: r.provenance,
      documentId: r.document_id,
    }));
  return ok(ctx, rows);
}

async function actRecordsCreate(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  if (ctx.regionBlocked) return refuse(ctx, { status: 403, reason: "region_blocked" });
  const v = validateRecordInput(body.record);
  if (!v.ok) return refuse(ctx, { status: 400, reason: "bad_input", extra: { detail: v.reason } });
  const category = CATEGORY_FOR_KIND[v.value.kind];
  const gate = await requireConsent(ctx, "store_records", category);
  if ("refusal" in gate) {
    await audit(ctx, "records.create", "record", "refused", {
      purpose: "store_records",
      detail: { kind: v.value.kind, category, reason: "consent_required" },
    });
    return refuse(ctx, gate.refusal);
  }
  const provenance = { source: "user_entry", capturedAt: ctx.now, method: "manual" };
  const { data, error } = await ctx.admin
    .from("health_records")
    .insert({
      user_id: ctx.userId,
      kind: v.value.kind,
      display: v.value.display,
      value_num: v.value.valueNum ?? null,
      value_unit: v.value.valueUnit ?? null,
      value_text: v.value.valueText ?? null,
      effective_at: v.value.effectiveAt,
      provenance,
      expires_at: expiryFor(category, ctx.now, ctx.policies),
    })
    .select("id")
    .single();
  if (error || !data) {
    const blocked = /not available in your country/i.test(String(error?.message ?? ""));
    return refuse(ctx, {
      status: blocked ? 403 : 500,
      reason: blocked ? "region_blocked" : "failed",
    });
  }
  // The mirror never blocks a user write: the Postgres row stands whatever
  // the adapter says, and today the adapter is the null one.
  await adapterFor(ctx.flags).putRecord({
    id: data.id,
    userId: ctx.userId,
    kind: v.value.kind,
    valueNum: v.value.valueNum,
    valueUnit: v.value.valueUnit,
    valueText: v.value.valueText,
    effectiveAt: v.value.effectiveAt,
    recordedAt: ctx.now,
    status: "active",
    provenance: { source: "user_entry", capturedAt: ctx.now, method: "manual" },
  });
  await audit(ctx, "records.create", "record", "ok", {
    objectId: data.id,
    purpose: "store_records",
    consentId: gate.consent.id,
    detail: { kind: v.value.kind, category },
  });
  return ok(ctx, { id: data.id });
}

async function actRecordsDelete(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data } = await ctx.admin
    .from("health_records")
    .update({ status: "deleted", deleted_at: ctx.now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .neq("status", "deleted")
    .select("id, kind")
    .maybeSingle();
  if (!data) return refuse(ctx, { status: 404, reason: "not_found" });
  await adapterFor(ctx.flags).deleteRecord(id, ctx.userId);
  await audit(ctx, "records.delete", "record", "ok", {
    objectId: id,
    detail: { kind: data.kind },
  });
  return ok(ctx, { id });
}

/* ---------------------------------------------------------- candidates -- */

const CANDIDATE_COLUMNS =
  "id, kind, code_system, code, display, value_num, value_unit, effective_at, recorded_at, confidence, provenance, document_id, created_at";

function candidateOut(r: Record<string, unknown>) {
  return {
    id: r.id,
    kind: r.kind,
    display: r.display,
    code: r.code ? { system: r.code_system, code: r.code, display: r.display } : null,
    valueNum: r.value_num === null ? null : Number(r.value_num),
    valueUnit: r.value_unit,
    effectiveAt: r.effective_at,
    confidence: r.confidence === null ? null : Number(r.confidence),
    provenance: r.provenance,
    documentId: r.document_id,
    createdAt: r.created_at,
  };
}

/** What the extractor read and the person has not yet decided on. Above every AI gate. */
async function actRecordsCandidates(ctx: Ctx): Promise<Response> {
  const { data, error } = await ctx.admin
    .from("health_records")
    .select(CANDIDATE_COLUMNS)
    .eq("user_id", ctx.userId)
    .eq("status", "candidate")
    .order("created_at", { ascending: false })
    .limit(TIMELINE_LIMIT);
  if (error) return refuse(ctx, { status: 500, reason: "failed" });
  return ok(ctx, (data ?? []).map(candidateOut));
}

/**
 * Reject sits ABOVE the AI gate, beside delete: a person whose AI switch was
 * turned off (rollback) must still be able to clear what it suggested.
 */
async function actRecordsReject(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data } = await ctx.admin
    .from("health_records")
    .update({ status: "rejected", deleted_at: ctx.now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("status", "candidate")
    .select("id, kind")
    .maybeSingle();
  if (!data) return refuse(ctx, { status: 404, reason: "not_found" });
  await audit(ctx, "records.reject", "record", "ok", {
    objectId: id,
    detail: { kind: data.kind },
  });
  return ok(ctx, { id });
}

/**
 * Confirm creates an ACTIVE, AI-labelled row, so it is gated on the AI flag,
 * on the region axis, on the storage consent for the row's category, and on
 * the same validation a typed record meets. The provenance keeps
 * `document_extraction` (the label follows the origin) and gains
 * `verifiedBy: "user"`.
 */
async function actRecordsConfirm(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  if (!ctx.flags["health.ai.enabled"]) return refuse(ctx, { status: 503, reason: "ai_disabled" });
  if (ctx.regionBlocked) return refuse(ctx, { status: 403, reason: "region_blocked" });
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data: row } = await ctx.admin
    .from("health_records")
    .select(CANDIDATE_COLUMNS)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("status", "candidate")
    .maybeSingle();
  if (!row) return refuse(ctx, { status: 404, reason: "not_found" });
  const v = validateRecordInput({
    kind: row.kind,
    display: row.display,
    valueNum: row.value_num === null ? undefined : Number(row.value_num),
    valueUnit: row.value_unit ?? undefined,
    effectiveAt: row.effective_at,
  });
  if (!v.ok) return refuse(ctx, { status: 400, reason: "bad_input", extra: { detail: v.reason } });
  const category = CATEGORY_FOR_KIND[v.value.kind];
  const gate = await requireConsent(ctx, "store_records", category);
  if ("refusal" in gate) {
    await audit(ctx, "records.confirm", "record", "refused", {
      objectId: id,
      purpose: "store_records",
      detail: { kind: v.value.kind, category, reason: "consent_required" },
    });
    return refuse(ctx, gate.refusal);
  }
  const provenance = { ...(row.provenance ?? {}), verifiedBy: "user" };
  const { data: updated } = await ctx.admin
    .from("health_records")
    .update({ status: "active", recorded_at: ctx.now, provenance })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("status", "candidate")
    .select("id")
    .maybeSingle();
  if (!updated) return refuse(ctx, { status: 404, reason: "not_found" });
  await adapterFor(ctx.flags).putRecord({
    id,
    userId: ctx.userId,
    kind: v.value.kind,
    valueNum: v.value.valueNum,
    valueUnit: v.value.valueUnit,
    effectiveAt: v.value.effectiveAt,
    recordedAt: ctx.now,
    status: "active",
    provenance,
  });
  await audit(ctx, "records.confirm", "record", "ok", {
    objectId: id,
    purpose: "store_records",
    consentId: gate.consent.id,
    detail: { kind: v.value.kind, category, method: "user_confirm" },
  });
  return ok(ctx, { id });
}

function documentOut(r: Record<string, unknown>) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    mime: r.mime,
    sizeBytes: r.size_bytes,
    status: r.status,
    capturedAt: r.captured_at,
    createdAt: r.created_at,
    provenance: r.provenance,
  };
}

async function actDocumentsList(ctx: Ctx): Promise<Response> {
  const { data, error } = await ctx.admin
    .from("health_documents")
    .select("id, kind, title, mime, size_bytes, status, captured_at, created_at, provenance")
    .eq("user_id", ctx.userId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(TIMELINE_LIMIT);
  if (error) return refuse(ctx, { status: 500, reason: "failed" });
  return ok(ctx, (data ?? []).map(documentOut));
}

async function actDocumentsRegister(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  if (!ctx.flags["health.uploads.enabled"]) {
    return refuse(ctx, { status: 503, reason: "uploads_disabled" });
  }
  if (ctx.regionBlocked) return refuse(ctx, { status: 403, reason: "region_blocked" });
  const v = validateDocumentInput(body.document);
  if (!v.ok) {
    const reason = v.reason === "too_large" || v.reason === "bad_mime" ? v.reason : "bad_input";
    return refuse(ctx, { status: 400, reason, extra: { detail: v.reason } });
  }
  const gate = await requireConsent(ctx, "store_records", "documents");
  if ("refusal" in gate) {
    await audit(ctx, "documents.register", "document", "refused", {
      purpose: "store_records",
      detail: { documentKind: v.value.kind, reason: "consent_required" },
    });
    return refuse(ctx, gate.refusal);
  }
  const path = `${ctx.userId}/health/${crypto.randomUUID()}.${EXT_FOR_MIME[v.value.mime]}`;
  const { data, error } = await ctx.admin
    .from("health_documents")
    .insert({
      user_id: ctx.userId,
      kind: v.value.kind,
      title: v.value.title,
      mime: v.value.mime,
      size_bytes: v.value.sizeBytes,
      storage_path: path,
      status: "pending_upload",
      captured_at: v.value.capturedAt ?? null,
      provenance: {
        source: "document_upload",
        capturedAt: v.value.capturedAt ?? ctx.now,
        method: "client_upload",
      },
      expires_at: expiryFor("documents", ctx.now, ctx.policies),
    })
    .select("id")
    .single();
  if (error || !data) {
    const blocked = /not available in your country/i.test(String(error?.message ?? ""));
    return refuse(ctx, {
      status: blocked ? 403 : 500,
      reason: blocked ? "region_blocked" : "failed",
    });
  }
  const signed = await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token) {
    await ctx.admin
      .from("health_documents")
      .update({ status: "deleted", deleted_at: ctx.now, storage_path: null })
      .eq("id", data.id)
      .eq("user_id", ctx.userId);
    return refuse(ctx, { status: 500, reason: "failed" });
  }
  await audit(ctx, "documents.register", "document", "ok", {
    objectId: data.id,
    purpose: "store_records",
    consentId: gate.consent.id,
    detail: { documentKind: v.value.kind, mime: v.value.mime, sizeBytes: v.value.sizeBytes },
  });
  return ok(ctx, { id: data.id, bucket: BUCKET, path, token: signed.data.token });
}

async function actDocumentsConfirm(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data: row } = await ctx.admin
    .from("health_documents")
    .select("id, storage_path, size_bytes, kind")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("status", "pending_upload")
    .maybeSingle();
  if (!row?.storage_path) return refuse(ctx, { status: 404, reason: "not_found" });
  const slash = row.storage_path.lastIndexOf("/");
  const dir = row.storage_path.slice(0, slash);
  const name = row.storage_path.slice(slash + 1);
  const listed = await ctx.admin.storage.from(BUCKET).list(dir, { limit: 1, search: name });
  const obj = (listed.data ?? []).find((o: { name: string }) => o.name === name);
  if (!obj) return refuse(ctx, { status: 409, reason: "not_uploaded" });
  const size = Number(obj?.metadata?.size ?? 0);
  if (size > 0 && size !== Number(row.size_bytes)) {
    // The bytes that arrived are not the bytes that were declared. Refuse
    // and remove them rather than store a document whose size lies.
    await ctx.admin.storage.from(BUCKET).remove([row.storage_path]);
    await ctx.admin
      .from("health_documents")
      .update({ status: "deleted", deleted_at: ctx.now, storage_path: null })
      .eq("id", id)
      .eq("user_id", ctx.userId);
    await audit(ctx, "documents.confirm", "document", "refused", {
      objectId: id,
      detail: { documentKind: row.kind, reason: "size_mismatch" },
    });
    return refuse(ctx, { status: 400, reason: "bad_input", extra: { detail: "size_mismatch" } });
  }
  await ctx.admin
    .from("health_documents")
    .update({ status: "stored" })
    .eq("id", id)
    .eq("user_id", ctx.userId);
  await audit(ctx, "documents.confirm", "document", "ok", {
    objectId: id,
    detail: { documentKind: row.kind, sizeBytes: Number(row.size_bytes) },
  });
  return ok(ctx, { id, status: "stored" });
}

async function actDocumentsUrl(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data: row } = await ctx.admin
    .from("health_documents")
    .select("id, storage_path, kind")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .in("status", ["stored", "processing", "ready"])
    .maybeSingle();
  if (!row?.storage_path) return refuse(ctx, { status: 404, reason: "not_found" });
  const signed = await ctx.admin.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_READ_SECONDS);
  if (signed.error || !signed.data?.signedUrl)
    return refuse(ctx, { status: 500, reason: "failed" });
  await audit(ctx, "documents.read", "document", "ok", {
    objectId: id,
    detail: { documentKind: row.kind },
  });
  return ok(ctx, { url: signed.data.signedUrl, expiresIn: SIGNED_READ_SECONDS });
}

async function actDocumentsDelete(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.id ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data: row } = await ctx.admin
    .from("health_documents")
    .select("id, storage_path, kind")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .neq("status", "deleted")
    .maybeSingle();
  if (!row) return refuse(ctx, { status: 404, reason: "not_found" });
  // Row first, bytes second: a failed removal leaves an orphan in a private
  // bucket, which beats a listed row whose object 404s.
  await ctx.admin
    .from("health_documents")
    .update({ status: "deleted", deleted_at: ctx.now, storage_path: null })
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (row.storage_path) await ctx.admin.storage.from(BUCKET).remove([row.storage_path]);
  await adapterFor(ctx.flags).deleteDocumentReference(id, ctx.userId);
  await audit(ctx, "documents.delete", "document", "ok", {
    objectId: id,
    detail: { documentKind: row.kind },
  });
  return ok(ctx, { id });
}

async function actConsentsList(ctx: Ctx): Promise<Response> {
  const rows = await loadConsents(ctx);
  return ok(ctx, rows.map(consentOut));
}

/** The person's home country, the jurisdiction a consent is recorded under. */
async function jurisdictionOf(ctx: Ctx): Promise<string> {
  const { data } = await ctx.admin
    .from("profiles")
    .select("country_code")
    .eq("id", ctx.userId)
    .maybeSingle();
  const cc = String(data?.country_code ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : "IN";
}

/** The ISO 27560 ledger every ONIQ consent already lands in. */
async function ledgerConsent(
  ctx: Ctx,
  purpose: ConsentPurpose,
  categories: string[],
  state: "granted" | "withdrawn",
  locale: string,
  jurisdiction: string,
): Promise<void> {
  await ctx.admin.from("consent_records").insert({
    user_id: ctx.userId,
    purpose_id: `health.${purpose}`,
    purpose_desc: `ONIQ Health: ${purpose}`,
    data_categories: categories,
    notice_version: CONSENT_TERMS_VERSIONS[purpose],
    notice_locale: locale,
    consent_state: state,
    jurisdiction,
  });
}

async function actConsentsGrant(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  if (ctx.regionBlocked) return refuse(ctx, { status: 403, reason: "region_blocked" });
  const purpose = String(body.purpose ?? "") as ConsentPurpose;
  const recipient = String(body.recipient ?? STORAGE_RECIPIENT);
  if (!isGrantable(purpose, recipient)) {
    return refuse(ctx, {
      status: 400,
      reason: "bad_input",
      extra: { detail: "purpose_not_offered" },
    });
  }
  // The AI consent names the REGISTERED provider's recipient and no other:
  // a consent for "oniq" is what the synthetic provider needs, and the day a
  // provider that leaves ONIQ is registered, this line refuses the old pair.
  if (purpose === "ai_interpretation") {
    const providerId = ctx.config?.ai_provider;
    if (!isProviderId(providerId) || RECIPIENT_FOR_PROVIDER[providerId] !== recipient) {
      return refuse(ctx, {
        status: 400,
        reason: "bad_input",
        extra: { detail: "recipient_not_offered" },
      });
    }
  }
  const requested = Array.isArray(body.dataCategories) ? body.dataCategories.map(String) : null;
  const categories = requested ?? [...DATA_CATEGORIES];
  if (
    categories.length === 0 ||
    categories.some((c) => !(DATA_CATEGORIES as readonly string[]).includes(c))
  ) {
    return refuse(ctx, { status: 400, reason: "bad_input", extra: { detail: "bad_categories" } });
  }
  const locale = ["en", "hi", "bn"].includes(String(body.noticeLocale))
    ? String(body.noticeLocale)
    : "en";
  const jurisdiction = await jurisdictionOf(ctx);
  const existing = await loadConsents(ctx);
  const version = nextVersion(existing, purpose, recipient);
  await ctx.admin
    .from("health_consents")
    .update({ status: "revoked", revoked_at: ctx.now })
    .eq("user_id", ctx.userId)
    .eq("purpose", purpose)
    .eq("recipient", recipient)
    .eq("status", "active");
  const { data, error } = await ctx.admin
    .from("health_consents")
    .insert({
      user_id: ctx.userId,
      purpose,
      data_categories: categories,
      source: "app.health.consent",
      recipient,
      start_time: ctx.now,
      expiry_time: null,
      status: "active",
      version,
      terms_version: CONSENT_TERMS_VERSIONS[purpose],
      notice_locale: locale,
      jurisdiction,
    })
    .select(CONSENT_COLUMNS)
    .single();
  if (error || !data) {
    const blocked = /not available in your country/i.test(String(error?.message ?? ""));
    return refuse(ctx, {
      status: blocked ? 403 : 500,
      reason: blocked ? "region_blocked" : "failed",
    });
  }
  await ledgerConsent(ctx, purpose, categories, "granted", locale, jurisdiction);
  await audit(ctx, "consents.grant", "consent", "ok", {
    objectId: data.id,
    purpose,
    consentId: data.id,
    detail: { purpose, recipient, version, count: categories.length },
  });
  return ok(ctx, consentOut(data as ConsentRow));
}

async function actConsentsRevoke(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const id = String(body.consentId ?? "");
  if (!UUID_RE.test(id)) return refuse(ctx, { status: 400, reason: "bad_input" });
  const { data } = await ctx.admin
    .from("health_consents")
    .update({ status: "revoked", revoked_at: ctx.now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .select("id, purpose, data_categories, recipient, version, notice_locale, jurisdiction")
    .maybeSingle();
  if (!data) return refuse(ctx, { status: 404, reason: "not_found" });
  await ledgerConsent(
    ctx,
    data.purpose as ConsentPurpose,
    data.data_categories,
    "withdrawn",
    data.notice_locale,
    String(data.jurisdiction ?? "IN"),
  );
  await audit(ctx, "consents.revoke", "consent", "ok", {
    objectId: id,
    purpose: data.purpose,
    consentId: id,
    detail: { purpose: data.purpose, recipient: data.recipient, version: data.version },
  });
  return ok(ctx, { consentId: id, status: "revoked" });
}

async function actExport(ctx: Ctx): Promise<Response> {
  const [records, documents, consents, auditRows, receipts] = await Promise.all([
    ctx.admin
      .from("health_records")
      .select(
        "id, kind, code_system, code, display, value_num, value_unit, value_text, effective_at, recorded_at, status, provenance, document_id, expires_at, deleted_at, created_at",
      )
      .eq("user_id", ctx.userId)
      .order("effective_at", { ascending: false }),
    ctx.admin
      .from("health_documents")
      .select(
        "id, kind, title, mime, size_bytes, sha256, status, captured_at, provenance, expires_at, deleted_at, created_at",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false }),
    loadConsents(ctx),
    ctx.admin
      .from("health_audit")
      .select(
        "seq, action, object_type, object_id, purpose, consent_id, request_id, outcome, detail, created_at",
      )
      .eq("user_id", ctx.userId)
      .order("seq", { ascending: true }),
    ctx.admin
      .from("health_ai_requests")
      .select(
        "id, request_id, task, purpose, provider, model, consent_id, manifest, status, refusal_reason, contract_code, input_tokens, output_tokens, cost_usd, created_at, completed_at, purged_at",
      )
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false }),
  ]);
  const out = {
    exportedAt: ctx.now,
    records: records.data ?? [],
    documents: documents.data ?? [],
    consents: consents.map(consentOut),
    audit: auditRows.data ?? [],
    aiRequests: receipts.data ?? [],
  };
  await audit(ctx, "export", "account", "ok", {
    detail: { count: out.records.length + out.documents.length },
  });
  return ok(ctx, out);
}

async function actPurge(ctx: Ctx): Promise<Response> {
  // A legal hold is the one thing that outranks the person's own delete; the
  // same rule delete-account already follows.
  const { data: held } = await ctx.admin.rpc("has_active_legal_hold", { _user_id: ctx.userId });
  if (held === true) {
    await audit(ctx, "purge", "account", "refused", { detail: { reason: "legal_hold" } });
    return refuse(ctx, { status: 423, reason: "legal_hold" });
  }
  const { data: docs } = await ctx.admin
    .from("health_documents")
    .select("id, storage_path")
    .eq("user_id", ctx.userId)
    .neq("status", "deleted");
  const paths = (docs ?? [])
    .map((d: { storage_path: string | null }) => d.storage_path)
    .filter((p: string | null): p is string => !!p);
  const { data: recs } = await ctx.admin
    .from("health_records")
    .update({ status: "deleted", deleted_at: ctx.now })
    .eq("user_id", ctx.userId)
    .neq("status", "deleted")
    .select("id");
  await ctx.admin
    .from("health_documents")
    .update({ status: "deleted", deleted_at: ctx.now, storage_path: null })
    .eq("user_id", ctx.userId)
    .neq("status", "deleted");
  if (paths.length > 0) await ctx.admin.storage.from(BUCKET).remove(paths);
  // Receipts are MARKED, never removed: they are the cap ledger and carry no
  // content. The manifest's record ids now point at deleted rows, so it is
  // blanked; the counts and codes stay.
  await ctx.admin
    .from("health_ai_requests")
    .update({ purged_at: ctx.now, manifest: {} })
    .eq("user_id", ctx.userId)
    .is("purged_at", null);
  const count = (recs ?? []).length + (docs ?? []).length;
  await audit(ctx, "purge", "account", "ok", { detail: { count } });
  return ok(ctx, { records: (recs ?? []).length, documents: (docs ?? []).length });
}

/* ---------------------------------------------------------------- serve -- */

type Handler = (ctx: Ctx, body: Record<string, unknown>) => Promise<Response>;

const ACTIONS: Record<string, Handler> = {
  status: (ctx) => actStatus(ctx),
  timeline: (ctx) => actTimeline(ctx),
  "records.create": actRecordsCreate,
  "records.delete": actRecordsDelete,
  "records.candidates": (ctx) => actRecordsCandidates(ctx),
  "records.confirm": actRecordsConfirm,
  "records.reject": actRecordsReject,
  "documents.list": (ctx) => actDocumentsList(ctx),
  "documents.register": actDocumentsRegister,
  "documents.confirm": actDocumentsConfirm,
  "documents.url": actDocumentsUrl,
  "documents.delete": actDocumentsDelete,
  "consents.list": (ctx) => actConsentsList(ctx),
  "consents.grant": actConsentsGrant,
  "consents.revoke": actConsentsRevoke,
  export: (ctx) => actExport(ctx),
  purge: (ctx) => actPurge(ctx),
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);

  const started = Date.now();
  const requestId = crypto.randomUUID();
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anon) return json({ ok: false, reason: "failed", requestId }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // FLAGS BEFORE IDENTITY. While the row says off, nothing about the caller
  // is read — not the JWT, not the body.
  const { flags, environment, row: configRow } = await readHealthConfig(admin);
  if (!flags["health.enabled"])
    return json({ ok: false, reason: "health_disabled", requestId }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, reason: "unauthorized", requestId }, 401);
  }
  const asCaller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes } = await asCaller.auth.getUser();
  const user = userRes?.user;
  if (!user) return json({ ok: false, reason: "unauthorized", requestId }, 401);
  if (rateLimited(user.id)) return json({ ok: false, reason: "rate_limited", requestId }, 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: "bad_input", requestId }, 400);
  }
  const action = String(body?.action ?? "");
  const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
  if (!handler)
    return json({ ok: false, reason: "bad_input", requestId, detail: "unknown_action" }, 400);

  const region = (req.headers.get("cf-ipcountry") ?? "").trim().toUpperCase();
  const { data: policyRows } = await admin
    .from("health_retention_policies")
    .select("category, retention_days");
  const policies: RetentionPolicyLike[] = (policyRows ?? []).map(
    (p: { category: string; retention_days: number }) => ({
      category: p.category,
      retentionDays: Number(p.retention_days),
    }),
  );

  const ctx: Ctx = {
    admin,
    userId: user.id,
    flags,
    environment,
    config: configRow && typeof configRow === "object" ? configRow : null,
    requestId,
    now: new Date().toISOString(),
    regionBlocked: HEALTH_BLOCKED_REGIONS.includes(region),
    policies,
  };

  let res: Response;
  let outcome = "ok";
  try {
    res = await handler(ctx, body);
  } catch (e) {
    outcome = e instanceof Error && e.message === "audit_failed" ? "audit_failed" : "error";
    res = json(
      { ok: false, reason: outcome === "audit_failed" ? "audit_failed" : "failed", requestId },
      500,
    );
  }
  logSafe({ action, status: res.status, ms: Date.now() - started, requestId, outcome });
  return res;
});
