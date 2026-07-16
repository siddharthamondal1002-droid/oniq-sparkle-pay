// study-paper-save-draft — autosave a per-question draft answer during a
// long paper session. JWT-gated. Same ownership pattern as study-paper-grade/
// finish. Best-effort: always returns HTTP 200, never throws to the client.
//
// Body: { paper_id, question_id, draft: null | {kind:"text", value:string} | {kind:"photo", attached:true} }
// Photo bytes are intentionally NOT persisted (too heavy for jsonb) — we only
// store a lightweight {kind:"photo", attached:true} marker so the resume flow
// can prompt the student to reattach the photo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";

type DraftIn =
  | null
  | { kind: "text"; value: string }
  | { kind: "photo"; attached: true };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(200, { ok: false, reason: "unauthorized" });

  let userId = "";
  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return json(200, { ok: false, reason: "unauthorized" });
    userId = data.user.id;
  } catch {
    return json(200, { ok: false, reason: "unauthorized" });
  }

  let body: { paper_id?: string; question_id?: string; draft?: DraftIn | { kind?: string; value?: unknown; attached?: unknown } } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const paperId = String(body.paper_id ?? "").trim();
  const questionId = String(body.question_id ?? "").trim();
  if (!paperId || !questionId) return json(200, { ok: false, reason: "missing ids" });

  // Normalize incoming draft into the sanitized shape we persist.
  let normalized: DraftIn = null;
  const raw = body.draft as { kind?: string; value?: unknown; attached?: unknown } | null | undefined;
  if (raw && typeof raw === "object") {
    if (raw.kind === "text" && typeof raw.value === "string") {
      const v = raw.value.slice(0, 8000);
      if (v.length > 0) normalized = { kind: "text", value: v };
    } else if (raw.kind === "photo") {
      normalized = { kind: "photo", attached: true };
    }
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Ownership check via learner_profiles.
  let profileId = "";
  try {
    const { data, error } = await admin
      .from("study_papers")
      .select("profile_id")
      .eq("id", paperId)
      .maybeSingle();
    if (error || !data) return json(200, { ok: false, reason: "paper not found" });
    profileId = (data as { profile_id: string }).profile_id;
  } catch {
    return json(200, { ok: false, reason: "load failed" });
  }
  try {
    const { data: prof, error: profErr } = await admin
      .from("learner_profiles")
      .select("user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profErr || !prof || (prof as { user_id: string }).user_id !== userId) {
      return json(200, { ok: false, reason: "forbidden" });
    }
  } catch {
    return json(200, { ok: false, reason: "auth check failed" });
  }

  // Merge into draft_answers at the question_id key (or delete if null).
  try {
    if (normalized === null) {
      // Remove that key using jsonb - operator.
      const { error: upErr } = await admin.rpc as unknown as never; // fallback if rpc unavailable
      // Simpler path: read-modify-write via service role.
      const { data: cur } = await admin
        .from("study_papers")
        .select("draft_answers")
        .eq("id", paperId)
        .maybeSingle();
      const map = (cur && (cur as { draft_answers?: Record<string, unknown> }).draft_answers) || {};
      if (Object.prototype.hasOwnProperty.call(map, questionId)) {
        delete (map as Record<string, unknown>)[questionId];
      }
      const { error: upErr2 } = await admin
        .from("study_papers")
        .update({ draft_answers: map, updated_at: new Date().toISOString() })
        .eq("id", paperId);
      if (upErr || upErr2) {
        console.warn("study-paper-save-draft: delete failed", (upErr2 || upErr as unknown as Error)?.message ?? "");
      }
    } else {
      // Merge single key using read-modify-write (jsonb || operator would
      // require a raw SQL exec; keep this portable through supabase-js).
      const { data: cur } = await admin
        .from("study_papers")
        .select("draft_answers")
        .eq("id", paperId)
        .maybeSingle();
      const map = ((cur && (cur as { draft_answers?: Record<string, unknown> }).draft_answers) || {}) as Record<string, unknown>;
      map[questionId] = normalized;
      const { error: upErr } = await admin
        .from("study_papers")
        .update({ draft_answers: map, updated_at: new Date().toISOString() })
        .eq("id", paperId);
      if (upErr) console.warn("study-paper-save-draft: update failed", upErr.message);
    }
  } catch (e) {
    console.warn("study-paper-save-draft: exception", (e as Error).message);
    return json(200, { ok: false, reason: "write failed" });
  }

  return json(200, { ok: true });
});
