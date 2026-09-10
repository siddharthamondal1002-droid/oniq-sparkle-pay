// health-ai — ONIQ Health. Phase 2 (owner brief 2026-09-08 §83) built the
// gateway with a synthetic provider; Phase 3 (owner directive 2026-09-09)
// put the real one behind it. Answers 503 until health_config says
// otherwise. Design in docs/health/05-phase2-ai-gateway.md §17.
//
// THE PIPELINE, in the order the code below runs it:
//   flags (missing row = off) -> JWT -> rate -> CLOSED body -> actor
//   (is_admin, date of birth, region) -> the gateway (gate, consents,
//   context, receipt, provider, contract, audit) -> one redacted log line
//
// THIS FILE STILL OPENS NO SOCKET. The one place a health byte leaves ONIQ
// is the registry's vertex provider (_shared/health/ai/vertex.ts), reached
// only through the gateway after every gate above it; this file imports only
// ./-relative health modules and the Supabase client, invokes no other
// function, and aiIsolation.test.ts fails the moment any of that changes.
//
// PHASE 3b (owner directive 2026-09-09, "A, B and C"): the gateway's text
// source is the STORED DOCUMENT. `loadDocumentBytes` reads the person's own
// file from the private bucket — the row filtered by the id the JWT proved,
// like every other chain here — and the seam (_shared/health/ai/textSource.ts)
// reads a PDF's text layer on ONIQ's side (pdfText.ts) or hands the bytes
// back for the provider to transcribe, which the gateway does only after the
// caps and the receipt. This is the one whole-file read in the health tree,
// and it is a read of a file the person uploaded for exactly this purpose.
//
// THE STORE IS BOUND TO THE PERSON. `makeStore` closes over the id the JWT
// proved and no method takes a user id, so a request naming another person's
// record answers not_found — the same word as "absent". Every health-table
// query below carries the ownership filter; aiWiring.test.ts counts them by
// effect. The one deliberate exception is the HOUSE cap count, which is the
// whole app's and is checked by name.
//
// NO CONTENT IN LOGS, RECEIPTS OR AUDIT. The receipt carries a whitelisted
// manifest, every audit detail goes through auditDetail, and the one log line
// through redactForLog.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readHealthConfig } from "../_shared/health/flags.ts";
import { redactForLog } from "../_shared/health/redact.ts";
import { appendAudit } from "../_shared/health/audit.ts";
import { expiryFor, type RetentionPolicyLike } from "../_shared/health/retention.ts";
import {
  CATEGORY_FOR_KIND,
  DOCUMENT_MIMES,
  MAX_DOCUMENT_BYTES,
  type RecordKind,
} from "../_shared/health/domain.ts";
import { StoredDocumentSource, type LoadedDocument } from "../_shared/health/ai/textSource.ts";
import { pdfText } from "../_shared/health/ai/pdfText.ts";
import {
  parseAiRequest,
  runHealthAi,
  type AiConfig,
  type CandidateProvenance,
  type GatewayAuditInput,
  type ReceiptPatch,
  type ReceiptRow,
  type ReserveWindow,
  type Store,
} from "../_shared/health/ai/gateway.ts";
import { capForTask, resolveEnvironment } from "../_shared/health/ai/policy.ts";
import type { DocRow, RecordRow } from "../_shared/health/ai/context.ts";
import type { AiRefusalReason, CandidateRecord } from "../_shared/health/ai/types.ts";
import type { ConsentLike } from "../_shared/health/consent.ts";

const RATE_PER_MINUTE = 10;
/** Same set as health-api's; isolation.test.ts pins both to the country registry. */
const HEALTH_BLOCKED_REGIONS = ["AE"];
/** The same private bucket health-api registers uploads into. */
const BUCKET = "health-documents";
/** The statuses a stored document may be read in — the same set the Store filters on. */
const READABLE_DOCUMENT_STATUSES = ["stored", "processing", "ready"];

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
  console.log(JSON.stringify(redactForLog({ fn: "health-ai", ...fields })));
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

/** Which HTTP status a gateway refusal answers with. */
const STATUS_FOR_REASON: Record<AiRefusalReason, number> = {
  ai_disabled: 503,
  task_not_allowed: 400,
  provider_not_allowed: 503,
  model_not_allowed: 503,
  unpriced_model: 503,
  caps_unset: 503,
  region_blocked: 403,
  age_unverified: 403,
  minor_blocked: 403,
  synthetic_in_production: 403,
  ai_consent_required: 403,
  consent_required: 403,
  question_rejected: 400,
  not_found: 404,
  no_text: 409,
  // 422: the document is there and readable, and ONIQ will not describe it
  // (its text reads as an instruction). Not a 400 — the caller's request was
  // well formed — and not a 409, which says "not yet".
  document_rejected: 422,
  text_too_long: 400,
  quota_user: 429,
  quota_house: 429,
  output_rejected: 502,
  provider_error: 502,
};

const CONSENT_COLUMNS =
  "id, purpose, data_categories, recipient, status, start_time, expiry_time, terms_version";
const RECORD_COLUMNS =
  "id, kind, display, value_num, value_unit, value_text, effective_at, status, provenance";
const DOCUMENT_COLUMNS = "id, kind, title, mime, size_bytes, captured_at, created_at, status";

/**
 * The Store, closed over the person the JWT proved. `userId` is captured
 * once here and never passed in, so the gateway cannot name anyone else.
 */
function makeStore(
  admin: Admin,
  userId: string,
  requestId: string,
  policies: RetentionPolicyLike[],
): Store {
  return {
    async loadConsents() {
      const { data } = await admin
        .from("health_consents")
        .select(CONSENT_COLUMNS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      return ((data ?? []) as Record<string, unknown>[]).map(
        (c) =>
          ({
            id: String(c.id),
            purpose: String(c.purpose),
            dataCategories: (c.data_categories as string[]) ?? [],
            recipient: String(c.recipient),
            status: String(c.status),
            startTime: String(c.start_time),
            expiryTime: (c.expiry_time as string | null) ?? null,
            termsVersion: String(c.terms_version ?? ""),
          }) as ConsentLike & { id: string },
      );
    },
    async loadRecord(id) {
      const { data } = await admin
        .from("health_records")
        .select(RECORD_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      return (data ?? null) as RecordRow | null;
    },
    async loadActiveRecords(kinds, limit) {
      const { data } = await admin
        .from("health_records")
        .select(RECORD_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "active")
        .in("kind", [...kinds])
        .order("effective_at", { ascending: false })
        .limit(limit);
      return (data ?? []) as RecordRow[];
    },
    async loadDocument(id) {
      const { data } = await admin
        .from("health_documents")
        .select(DOCUMENT_COLUMNS)
        .eq("id", id)
        .eq("user_id", userId)
        .in("status", ["stored", "processing", "ready"])
        .maybeSingle();
      return (data ?? null) as DocRow | null;
    },
    async reserveReceipt(row: ReceiptRow, window: ReserveWindow) {
      // THE CAPS AND THE RECEIPT IN ONE LOCKED TRANSACTION (Phase 4). The SQL
      // function counts the HOUSE window (every task, every person — the one
      // deliberately unscoped read in this file) and then the person's window
      // for THIS task, neither filtered on status, and inserts the started
      // receipt only when both are under their cap. The person's id is the
      // one this store closed over; the row never names one.
      const { data, error } = await admin.rpc("health_ai_reserve_request", {
        _user_id: userId,
        _request_id: row.request_id,
        _task: row.task,
        _purpose: row.purpose,
        _provider: row.provider,
        _model: row.model,
        _consent_id: row.consent_id,
        _manifest: row.manifest,
        _cap_house: window.capHouse,
        _cap_user: window.capPerUser,
        _since: window.since,
      });
      if (error) throw new Error("receipt_failed");
      const first = (Array.isArray(data) ? data[0] : data) as
        { receipt_id?: unknown; refusal?: unknown } | null | undefined;
      const refusal = first?.refusal;
      if (refusal === "quota_house" || refusal === "quota_user" || refusal === "caps_unset") {
        return { ok: false as const, reason: refusal };
      }
      if (typeof first?.receipt_id !== "string" || refusal) throw new Error("receipt_failed");
      return { ok: true as const, id: first.receipt_id };
    },
    async completeReceipt(id, patch: ReceiptPatch) {
      await admin.from("health_ai_requests").update(patch).eq("id", id).eq("user_id", userId);
    },
    async insertCandidates(documentId, candidates: CandidateRecord[], base: CandidateProvenance) {
      if (candidates.length === 0) return 0;
      const rows = candidates.map((c) => ({
        user_id: userId,
        kind: c.kind,
        code_system: c.code.system,
        code: c.code.code,
        display: c.display,
        value_num: c.valueNum,
        value_unit: c.valueUnit ?? null,
        value_text: null,
        effective_at: c.effectiveAt,
        // STRAIGHT INTO THE TIMELINE (owner directive 2026-09-09, "make it
        // simple"): a report reaches the timeline in one action, so a value
        // the page states is stored as an ordinary record rather than waiting
        // on a per-value confirm tap. It carries provenance
        // document_extraction, which isAiDerived() reads, so every one of
        // these rows renders with the AI-assisted label and a one-tap delete.
        // Only values PRINTED on the page get this far (ai/grounding.ts).
        status: "active",
        confidence: c.confidence,
        provenance: { ...base, confidence: c.confidence },
        document_id: documentId,
        expires_at: expiryFor(
          CATEGORY_FOR_KIND[c.kind as RecordKind] ?? "labs",
          base.capturedAt,
          policies,
        ),
      }));
      // RE-READING A DOCUMENT MUST NOT DUPLICATE ITS READINGS. "Analyse" is
      // back on every stored document (owner report 2026-09-09, "analysis is
      // gone"), so the same report can be read twice — by a retry after a
      // failure, or by a second tap. Nothing else stops that: the insert has
      // no unique constraint, and the client must never be the authority on
      // it. A candidate already stored for THIS document, unchanged in code,
      // value, unit and date, is skipped; two separate uploads of the same
      // report stay two documents with their own rows, which is what the
      // person did.
      const dedupeKey = (r: {
        code_system: string;
        code: string;
        value_num: number | null;
        value_unit: string | null;
        effective_at: string;
      }) => {
        const t = Date.parse(r.effective_at);
        const when = Number.isNaN(t) ? r.effective_at : new Date(t).toISOString();
        return [r.code_system, r.code, String(r.value_num), r.value_unit ?? "", when].join("|");
      };
      const { data: already } = await admin
        .from("health_records")
        .select("code_system, code, value_num, value_unit, effective_at")
        .eq("user_id", userId)
        .eq("document_id", documentId)
        .eq("status", "active");
      const seen = new Set((already ?? []).map(dedupeKey));
      const fresh = rows.filter((r) => !seen.has(dedupeKey(r)));
      if (fresh.length === 0) return 0;
      const { data, error } = await admin.from("health_records").insert(fresh).select("id");
      if (error) return 0;
      return (data ?? []).length;
    },
    async updateDocument(id, patch) {
      await admin.from("health_documents").update(patch).eq("id", id).eq("user_id", userId);
    },
    async recordAudit(input: GatewayAuditInput) {
      await appendAudit(admin, {
        userId,
        actor: userId,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId ?? null,
        purpose: input.purpose ?? null,
        consentId: input.consentId ?? null,
        requestId,
        outcome: input.outcome,
        detail: input.detail,
      });
    },
  };
}

function capFrom(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * The bytes of the person's OWN document (Phase 3b). The row is read with the
 * ownership filter and only in a readable status, its type and size are
 * checked against the same rules the upload met, and only then is the object
 * downloaded from the private bucket. Null for anything else — the seam
 * answers no_text, the same word as "absent".
 */
async function loadDocumentBytes(
  admin: Admin,
  userId: string,
  documentId: string,
): Promise<LoadedDocument | null> {
  const { data } = await admin
    .from("health_documents")
    .select("storage_path, mime, size_bytes")
    .eq("id", documentId)
    .eq("user_id", userId)
    .in("status", READABLE_DOCUMENT_STATUSES)
    .maybeSingle();
  const path = typeof data?.storage_path === "string" ? data.storage_path : "";
  const mime = String(data?.mime ?? "");
  if (!path || !(DOCUMENT_MIMES as readonly string[]).includes(mime)) return null;
  if (Number(data?.size_bytes ?? 0) > MAX_DOCUMENT_BYTES) return null;
  const dl = await admin.storage.from(BUCKET).download(path);
  if (dl.error || !dl.data) return null;
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
  return { bytes, mime };
}

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

  // FLAGS BEFORE IDENTITY. While either switch is off nothing about the
  // caller is read — not the JWT, not the body.
  const { flags, row } = await readHealthConfig(admin);
  if (!flags["health.enabled"]) {
    return json({ ok: false, reason: "health_disabled", requestId }, 503);
  }
  if (!flags["health.ai.enabled"])
    return json({ ok: false, reason: "ai_disabled", requestId }, 503);

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

  // THE BODY IS CLOSED. Unknown keys — a pasted `text`, anything — are refused
  // before the gate, so no field can grow into a paste-to-model path.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_input", requestId }, 400);
  }
  const parsed = parseAiRequest(body);
  if (!parsed.ok) return json({ ok: false, reason: "bad_input", requestId }, 400);

  // THE ACTOR. Admin from the same rpc every admin tool uses; age from the
  // private profile — no date of birth is "unverified", which the policy
  // refuses separately from "under 18", so the person is told what to add.
  const [{ data: isAdmin }, { data: dob }] = await Promise.all([
    admin.rpc("is_admin", { _uid: user.id }),
    admin.from("profiles_private").select("date_of_birth").eq("user_id", user.id).maybeSingle(),
  ]);
  let isAdult: boolean | null = null;
  if (dob?.date_of_birth) {
    const { data: adult } = await admin.rpc("is_adult_18", { _uid: user.id });
    isAdult = adult === true;
  }
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

  const config: AiConfig = {
    flags,
    environment: resolveEnvironment(row?.environment, url),
    provider: row?.ai_provider,
    model: row?.ai_model,
    capPerUser: capForTask(row?.ai_daily_caps, parsed.request.task),
    capHouse: capFrom(row?.ai_daily_cap_house),
    adminVerificationEnabled: row?.ai_admin_verification_enabled === true,
  };

  const now = new Date().toISOString();
  let res: Response;
  let outcome = "ok";
  // The CLOSED code behind a refusal, when there is one: a provider failure's
  // (vertex_timeout, vertex_http_429_resource_exhausted) or the contract's
  // (forbidden_dose). Read from the gateway's detail, which carries codes only.
  let code: string | undefined;
  try {
    const result = await runHealthAi(
      {
        store: makeStore(admin, user.id, requestId, policies),
        now,
        requestId,
        // Phase 3b: the stored document itself. A PDF's text layer is read
        // here; a photo, a scan or a text-less PDF is handed back as bytes
        // for the provider to transcribe — after the caps and the receipt,
        // inside the gateway, never here.
        textSource: new StoredDocumentSource({
          loadBytes: (documentId: string) => loadDocumentBytes(admin, user.id, documentId),
          pdfText,
        }),
      },
      config,
      {
        isAdmin: isAdmin === true,
        isAdult,
        regionBlocked: HEALTH_BLOCKED_REGIONS.includes(region),
      },
      parsed.request,
    );
    if (result.ok) {
      res = json({ ok: true, data: result.result, receiptId: result.receiptId, requestId }, 200);
    } else {
      outcome = result.reason;
      code = typeof result.detail?.code === "string" ? result.detail.code : undefined;
      res = json(
        { ok: false, reason: result.reason, requestId, ...(result.detail ?? {}) },
        STATUS_FOR_REASON[result.reason] ?? 403,
      );
    }
  } catch (e) {
    outcome = e instanceof Error && e.message === "audit_failed" ? "audit_failed" : "error";
    res = json(
      { ok: false, reason: outcome === "audit_failed" ? "audit_failed" : "failed", requestId },
      500,
    );
  }
  logSafe({
    task: parsed.request.task,
    provider: String(config.provider),
    model: String(config.model),
    status: res.status,
    ms: Date.now() - started,
    requestId,
    outcome,
    code,
  });
  return res;
});
