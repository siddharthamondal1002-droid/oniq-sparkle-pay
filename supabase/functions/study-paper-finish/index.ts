// study-paper-finish — mark a paper completed + record a quiz_attempts row.
// JWT-gated. Ownership verified in code (study_papers has no auth policies).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, json } from "../_shared/llm.ts";

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

  let body: { paper_id?: string; marks_scored?: number; total_marks?: number; subject?: string; action?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const paperId = String(body.paper_id ?? "").trim();
  const action = String(body.action ?? "complete").trim();
  const marksScored = Math.max(0, Math.round(Number(body.marks_scored ?? 0)));
  const totalMarks = Math.round(Number(body.total_marks ?? 0));
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  if (!paperId) return json(200, { source: "unavailable", reason: "missing fields" });
  if (action === "complete" && (!totalMarks || !subject)) {
    return json(200, { source: "unavailable", reason: "missing fields" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Load paper for ownership check.
  let paper: { profile_id: string; total_marks: number } | null = null;
  try {
    const { data, error } = await admin
      .from("study_papers")
      .select("profile_id, total_marks")
      .eq("id", paperId)
      .maybeSingle();
    if (error || !data) return json(200, { source: "unavailable", reason: "paper not found" });
    paper = data as { profile_id: string; total_marks: number };
  } catch {
    return json(200, { source: "unavailable", reason: "load failed" });
  }

  try {
    const { data: prof, error: profErr } = await admin
      .from("learner_profiles")
      .select("user_id")
      .eq("id", paper.profile_id)
      .maybeSingle();
    if (profErr || !prof || (prof as { user_id: string }).user_id !== userId) {
      return json(403, { error: "forbidden" });
    }
  } catch {
    return json(500, { source: "unavailable", reason: "auth check failed" });
  }

  const clampedMarks = Math.min(marksScored, paper.total_marks);

  try {
    const { error: upErr } = await admin
      .from("study_papers")
      .update({ status: "completed", marks_scored: clampedMarks })
      .eq("id", paperId);
    if (upErr) console.warn("study-paper-finish: update err", upErr.message);
  } catch (e) {
    console.warn("study-paper-finish: update exception", (e as Error).message);
  }

  try {
    const { error: insErr } = await admin.from("quiz_attempts").insert({
      profile_id: paper.profile_id,
      subject,
      topic: subject,
      total_questions: null,
      correct_count: null,
      total_marks: paper.total_marks,
      marks_scored: clampedMarks,
    });
    if (insErr) console.warn("study-paper-finish: attempts insert err", insErr.message);
  } catch (e) {
    console.warn("study-paper-finish: attempts exception", (e as Error).message);
  }

  return json(200, { ok: true });
});
