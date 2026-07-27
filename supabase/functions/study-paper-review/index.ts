// study-paper-review — answer sheets for COMPLETED papers only.
// JWT-gated; ownership verified via learner_profiles.user_id (study_papers
// has default-deny RLS). Model answers / correct options live only in the
// service-role-readable questions jsonb and are revealed here strictly
// after completion, so an in-progress paper can never leak its key.
//   { action: "list" }              -> completed papers for this user
//   { action: "get", paper_id }     -> full answer sheet for one paper
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";

type StoredQ = {
  id: string;
  type: "mcq" | "short" | "long";
  marks: number;
  question: string;
  subject?: string;
  options?: string[];
  correct_index?: number;
  model_answer?: string;
  rubric_points?: string[];
};

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

  let body: { action?: string; paper_id?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body.action ?? "list").trim();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Profiles owned by this user — papers hang off learner_profiles.
  let profileIds: string[] = [];
  try {
    const { data, error } = await admin
      .from("learner_profiles")
      .select("id")
      .eq("user_id", userId);
    if (error) throw error;
    profileIds = (data ?? []).map((r: { id: string }) => r.id);
  } catch {
    return json(200, { source: "unavailable", reason: "profiles load failed" });
  }
  if (profileIds.length === 0) return json(200, { papers: [] });

  if (action === "list") {
    try {
      const { data, error } = await admin
        .from("study_papers")
        .select("id, profile_id, subject, total_marks, marks_scored, created_at")
        .in("profile_id", profileIds)
        .eq("status", "completed")
        .not("answer_sheet", "is", null)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return json(200, { papers: data ?? [] });
    } catch {
      return json(200, { source: "unavailable", reason: "list failed" });
    }
  }

  if (action !== "get") return json(200, { source: "unavailable", reason: "unknown action" });
  const paperId = String(body.paper_id ?? "").trim();
  if (!paperId) return json(200, { source: "unavailable", reason: "missing paper_id" });

  try {
    const { data, error } = await admin
      .from("study_papers")
      .select("id, profile_id, subject, total_marks, marks_scored, status, questions, answer_sheet, created_at")
      .eq("id", paperId)
      .maybeSingle();
    if (error || !data) return json(200, { source: "unavailable", reason: "paper not found" });
    const paper = data as {
      id: string; profile_id: string; subject: string; total_marks: number;
      marks_scored: number | null; status: string; questions: StoredQ[];
      answer_sheet: Record<string, unknown> | null; created_at: string;
    };
    if (!profileIds.includes(paper.profile_id)) return json(403, { error: "forbidden" });
    if (paper.status !== "completed") return json(200, { source: "unavailable", reason: "paper not completed" });

    const sheet = paper.answer_sheet ?? {};
    const questions = (Array.isArray(paper.questions) ? paper.questions : []).map((q) => ({
      id: q.id,
      type: q.type,
      marks: q.marks,
      question: q.question,
      subject: q.subject ?? null,
      options: q.options ?? null,
      correct_index: typeof q.correct_index === "number" ? q.correct_index : null,
      model_answer: q.model_answer ?? null,
      rubric_points: q.rubric_points ?? null,
      student: (sheet as Record<string, unknown>)[q.id] ?? null,
    }));

    return json(200, {
      paper: {
        id: paper.id,
        subject: paper.subject,
        total_marks: paper.total_marks,
        marks_scored: paper.marks_scored,
        created_at: paper.created_at,
      },
      questions,
    });
  } catch {
    return json(200, { source: "unavailable", reason: "load failed" });
  }
});
