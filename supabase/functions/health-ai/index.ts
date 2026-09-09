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
import { CATEGORY_FOR_KIND, type RecordKind } from "../_shared/health/domain.ts";
import {
  parseAiRequest,
  runHealthAi,
  type AiConfig,
  type CandidateProvenance,
  type GatewayAuditInput,
  type ReceiptPatch,
  type ReceiptRow,
  type Store,
} from "../_shared/health/ai/gateway.ts";
import { capForTask, resolveEnvironment } from "../_shared/health/ai/policy.ts";
import type { DocRow, RecordRow } from "../_shared/health/ai/context.ts";
import type { AiRefusalReason, CandidateRecord } from "../_shared/health/ai/types.ts";
import type { ConsentLike } from "../_shared/health/consent.ts";

const RATE_PER_MINUTE = 10;
/** Same set as health-api's; isolation.test.ts pins both to the country registry. */
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
    async countUserSince(sinceIso, task) {
      // The person's own window, for THIS task (caps are per task). No status
      // filter: a refused request is a request.
      const { count } = await admin
        .from("health_ai_requests")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("task", task)
        .gte("created_at", sinceIso);
      return count ?? 0;
    },
    async countHouseSince(sinceIso) {
      // THE HOUSE CAP: the whole app's window, deliberately unscoped, and
      // again with no status filter.
      const { count } = await admin
        .from("health_ai_requests")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      return count ?? 0;
    },
    async beginReceipt(row: ReceiptRow) {
      const { data, error } = await admin
        .from("health_ai_requests")
        .insert({ user_id: userId, ...row })
        .select("id")
        .single();
      if (error || !data) throw new Error("receipt_failed");
      return String(data.id);
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
        status: "candidate",
        confidence: c.confidence,
        provenance: { ...base, confidence: c.confidence },
        document_id: documentId,
        expires_at: expiryFor(
          CATEGORY_FOR_KIND[c.kind as RecordKind] ?? "labs",
          base.capturedAt,
          policies,
        ),
      }));
      const { data, error } = await admin.from("health_records").insert(rows).select("id");
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
  try {
    const result = await runHealthAi(
      {
        store: makeStore(admin, user.id, requestId, policies),
        now,
        requestId,
        // Phase 2 registers no text source: extraction answers no_text for
        // everyone, and that refusal's audit row (ai.refused, reason no_text)
        // is the proof the pipeline ran — a refusal before the receipt is
        // audited, not receipted.
        textSource: null,
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
    status: res.status,
    ms: Date.now() - started,
    requestId,
    outcome,
  });
  return res;
});
