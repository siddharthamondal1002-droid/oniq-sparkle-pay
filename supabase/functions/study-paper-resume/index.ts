// study-paper-resume — find the most-recent in-progress paper for a
// (profile_id, subject) pair and return it in the SAME sanitized shape
// study-paper-generate returns (paper_id, subject, total_marks, questions
// WITHOUT answer keys) plus the saved draft_answers map.
//
// JWT-gated, ownership verified via learner_profiles.user_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";

type StoredQ =
  | { id: string; type: "mcq"; marks: number; question: string; options: string[]; correct_index: number; explanation: string }
  | { id: string; type: "short" | "long"; marks: number; question: string; model_answer: string; rubric_points: string[] };

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

  let body: { profile_id?: string; subject?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const profileId = String(body.profile_id ?? "").trim();
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  if (!profileId || !subject) return json(200, { found: false, reason: "missing fields" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Ownership: only resume if this learner_profile belongs to the caller.
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
    const { data, error } = await admin
      .from("study_papers")
      .select("id, subject, total_marks, questions, draft_answers, updated_at")
      .eq("profile_id", profileId)
      .eq("subject", subject)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return json(200, { found: false });

    const row = data as {
      id: string;
      subject: string;
      total_marks: number;
      questions: StoredQ[];
      draft_answers: Record<string, unknown> | null;
      updated_at: string;
    };
    const clientQuestions = (row.questions ?? []).map((q) => {
      if (q.type === "mcq") {
        return { id: q.id, type: "mcq" as const, marks: q.marks, question: q.question, options: q.options };
      }
      return { id: q.id, type: q.type, marks: q.marks, question: q.question };
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
    });
  } catch (e) {
    console.warn("study-paper-resume: exception", (e as Error).message);
    return json(200, { found: false });
  }
});
