// study-paper-resume — find the most-recent in-progress paper for a
// (profile_id, subject) pair (kind='marks') OR the most-recent in-progress
// mock (kind='mock') for a profile, and return it in the SAME sanitized
// shape study-paper-generate/study-paper-mock returns (paper_id, subject,
// total_marks, questions WITHOUT answer keys) plus the saved draft_answers
// map. For mock papers, also returns kind + started_at + duration_seconds
// so the client can anchor its countdown to server time.
//
// JWT-gated, ownership verified via learner_profiles.user_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";

type StoredMCQ = { id: string; type: "mcq"; marks: number; question: string; options: string[]; correct_index: number; explanation: string; subject?: string };
type StoredWritten = { id: string; type: "short" | "long"; marks: number; question: string; model_answer: string; rubric_points: string[] };
type StoredQ = StoredMCQ | StoredWritten;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });

  let userId = "";
  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
    userId = data.user.id;
  } catch {
    return json(401, { error: "unauthorized" });
  }

  let body: { profile_id?: string; subject?: string; kind?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const profileId = String(body.profile_id ?? "").trim();
  const kind = body.kind === "mock" ? "mock" : "marks";
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  if (!profileId) return json(200, { found: false, reason: "missing fields" });
  if (kind === "marks" && !subject) return json(200, { found: false, reason: "missing fields" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { data: prof, error: profErr } = await admin
      .from("learner_profiles")
      .select("user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profErr || !prof || (prof as { user_id: string }).user_id !== userId) {
      return json(403, { error: "forbidden" });
    }
  } catch {
    return json(200, { found: false, reason: "auth check failed" });
  }

  try {
    let q = admin
      .from("study_papers")
      .select("id, subject, total_marks, questions, draft_answers, updated_at, kind, started_at, duration_seconds")
      .eq("profile_id", profileId)
      .eq("status", "in_progress")
      .eq("kind", kind)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (kind === "marks") q = q.eq("subject", subject);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return json(200, { found: false });

    const row = data as {
      id: string;
      subject: string;
      total_marks: number;
      questions: StoredQ[];
      draft_answers: Record<string, unknown> | null;
      updated_at: string;
      kind: string;
      started_at: string | null;
      duration_seconds: number | null;
    };

    const clientQuestions = (row.questions ?? []).map((qq) => {
      if (qq.type === "mcq") {
        const mcq = qq as StoredMCQ;
        const base: Record<string, unknown> = { id: mcq.id, type: "mcq", marks: mcq.marks, question: mcq.question, options: mcq.options };
        if (mcq.subject) base.subject = mcq.subject;
        return base;
      }
      return { id: qq.id, type: qq.type, marks: qq.marks, question: qq.question };
    });

    return json(200, {
      found: true,
      source: "paper",
      paper_id: row.id,
      subject: row.subject,
      total_marks: row.total_marks,
      questions: clientQuestions,
      draft_answers: row.draft_answers ?? {},
      updated_at: row.updated_at,
      kind: row.kind,
      started_at: row.started_at,
      duration_seconds: row.duration_seconds,
    });
  } catch (e) {
    console.warn("study-paper-resume: exception", (e as Error).message);
    return json(200, { found: false });
  }
});
