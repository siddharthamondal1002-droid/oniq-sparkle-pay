// DSR (Data Subject Request) handler — DPDP ss.11–13.
//
// Every write to public.dsr_requests happens here with the service role;
// the table has no client INSERT/UPDATE/DELETE policy (append-only-ticket
// pattern, same as legal_holds / takedown_orders / consent_records).
//
// Actions:
//   { action: "create", request_type, details? }  — JWT authenticated
//   { action: "cancel", id }                      — JWT authenticated
//   { action: "internal_purge", user_id }         — internal only, never
//       reachable with a user JWT: gated on the x-internal-secret header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { purgeUserData } from "../_shared/purgeUserData.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TYPES = ["access", "correction", "erasure", "portability"] as const;
type RequestType = (typeof TYPES)[number];
const TERMINAL = ["completed", "cancelled", "rejected", "purged"];

const HOLD_MESSAGE =
  "Account deletion is temporarily unavailable due to a legal preservation requirement. Contact grievance@oniqhub.com.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = String(body["action"] ?? "");

  // ---- internal_purge: shared-secret only, never a user JWT ----------------
  if (action === "internal_purge") {
    // Precedent: the process-email-queue cron authenticates with the
    // service_role key held in vault ('email_queue_service_role_key').
    // We reuse that exact mechanism rather than provisioning a second
    // secret the cron could not read — the header value IS the service key.
    const provided = req.headers.get("x-internal-secret") ?? "";
    if (!provided || provided !== serviceKey) return json({ error: "Forbidden" }, 403);
    const uid = String(body["user_id"] ?? "");
    if (!uid) return json({ error: "user_id required" }, 400);
    const res = await purgeUserData(admin, uid);
    return res.ok ? json({ ok: true }) : json({ error: res.error }, 500);
  }

  // ---- everything else is JWT authenticated (same shape as delete-account) -
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Unauthorized" }, 401);

  const { data: userRes, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);
  const uid = userRes.user.id;

  if (action === "cancel") {
    const id = String(body["id"] ?? "");
    if (!id) return json({ error: "id required" }, 400);
    const { data: row, error } = await admin
      .from("dsr_requests")
      .select("*")
      .eq("id", id)
      .eq("user_id", uid)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: "Not found" }, 404);
    if (row.status !== "received") return json({ error: "This request can no longer be cancelled." }, 409);
    if (
      row.request_type === "erasure" &&
      row.erasure_effective_at &&
      new Date(row.erasure_effective_at).getTime() <= Date.now()
    ) {
      return json({ error: "The 48-hour window has passed; contact grievance@oniqhub.com." }, 409);
    }
    const { error: upErr } = await admin
      .from("dsr_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", uid);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({ ok: true, id });
  }

  if (action !== "create") return json({ error: "Unknown action" }, 400);

  const requestType = String(body["request_type"] ?? "") as RequestType;
  if (!TYPES.includes(requestType)) return json({ error: "Invalid request_type" }, 400);
  const details = typeof body["details"] === "string" ? (body["details"] as string).slice(0, 2000) : null;

  // access / portability are instant, idempotent, side-effect-free reads: we
  // run the export FIRST and only then log an already-completed ticket, so a
  // failing export can never leave a stuck non-terminal row that blocks every
  // later attempt. No "one open ticket" guard for these two types.
  if (requestType === "access" || requestType === "portability") {
    // export_my_data() is scoped by auth.uid(), so it must run as the caller,
    // not as the service role.
    const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: exported, error: expErr } = await asUser.rpc("export_my_data");
    if (expErr) return json({ error: expErr.message }, 500);
    if (!exported) return json({ error: "The export returned no data." }, 500);
    const now = new Date().toISOString();
    const { data: done, error: insErr2 } = await admin
      .from("dsr_requests")
      .insert({
        user_id: uid,
        request_type: requestType,
        details,
        status: "completed",
        completed_at: now,
      })
      .select("*")
      .single();
    if (insErr2) return json({ error: insErr2.message }, 500);
    return json({ ok: true, request: done, export: exported });
  }

  // One open ticket per type — hand back the existing one instead of erroring.
  // Only meaningful for erasure / correction.
  const { data: existing } = await admin
    .from("dsr_requests")
    .select("id, status, created_at, sla_deadline, erasure_effective_at")
    .eq("user_id", uid)
    .eq("request_type", requestType)
    .not("status", "in", `(${TERMINAL.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) {
    return json({ ok: true, existing: true, request: existing[0] }, 200);
  }


  if (requestType === "erasure") {
    let held = false;
    try {
      const { data } = await admin.rpc("has_active_legal_hold", { _user_id: uid });
      held = data === true;
    } catch { /* fail open for the user's erasure right, as delete-account does */ }
    if (held) {
      await admin.from("dsr_requests").insert({
        user_id: uid,
        request_type: "erasure",
        status: "rejected",
        details: `Rejected: active legal preservation hold. ${details ?? ""}`.trim(),
      });
      return json({ error: HOLD_MESSAGE }, 409);
    }
  }

  const { data: inserted, error: insErr } = await admin
    .from("dsr_requests")
    .insert({ user_id: uid, request_type: requestType, details, status: "received" })
    .select("*")
    .single();
  if (insErr) return json({ error: insErr.message }, 500);

  if (requestType === "erasure") {
    // Best effort only. The transactional_emails queue has no proven consumer
    // wired up in this project yet, so the AUTHORITATIVE 48-hour notice is the
    // in-app banner the client renders from its own dsr_requests row.
    try {
      await admin.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          template: "dsr_erasure_notice",
          to: userRes.user.email,
          request_id: inserted.id,
          effective_at: inserted.erasure_effective_at,
        },
      });
    } catch { /* non-fatal by design */ }
    return json({ ok: true, request: inserted });
  }


  // correction: formal audit trail / escalation path only — never automated.
  return json({ ok: true, request: inserted });
});
