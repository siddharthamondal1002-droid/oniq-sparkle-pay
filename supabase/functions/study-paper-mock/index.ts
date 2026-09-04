// study-paper-mock — build a timed, MCQ-only mock test spanning MULTIPLE
// subjects (govt-family competitive-exam prep). Reuses the same MCQ tool-use
// pattern proven in study-paper-generate: deterministic counts (never let
// the model decide), one parallel call per subject, service-role-only write
// of the full record (with correct_index). Returns a sanitized paper +
// started_at / duration_seconds so the client can anchor its countdown to
// server time.
//
// JWT-gated. Ownership verified via learner_profiles.user_id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callText, corsHeaders, gradeString, json } from "../_shared/llm.ts";

const MCQ_ITEM_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
    correct_index: { type: "integer", minimum: 0, maximum: 3 },
    explanation: { type: "string" },
  },
  required: ["question", "options", "correct_index", "explanation"],
};
const MCQ_SECTION_SCHEMA = {
  type: "object",
  properties: { mcq: { type: "array", items: MCQ_ITEM_SCHEMA } },
  required: ["mcq"],
};

const DURATION_TO_TOTAL: Record<number, number> = {
  30: 50,
  60: 100,
  90: 150,
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

  let body: {
    profile?: { board?: string; classLevel?: string; id?: string };
    profileId?: string;
    subjects?: string[];
    durationMinutes?: number;
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const boardKey = String(body.profile?.board ?? "").toLowerCase();
  if (!boardKey.startsWith("govt") || !BOARD_LABEL[boardKey]) {
    return json(200, { source: "unavailable", reason: "mock test is only for govt-family boards" });
  }
  const board = boardKey;
  const classLevel = (VALID_CLASS_LEVELS as readonly string[]).includes(String(body.profile?.classLevel ?? ""))
    ? String(body.profile?.classLevel) : "aspirant";
  const profileId = String(body.profileId ?? body.profile?.id ?? "").trim();
  if (!profileId) return json(200, { source: "unavailable", reason: "profile id required" });

  const durationMinutes = Number(body.durationMinutes);
  if (!(durationMinutes === 30 || durationMinutes === 60 || durationMinutes === 90)) {
    return json(200, { source: "unavailable", reason: "durationMinutes must be 30, 60, or 90" });
  }
  const totalQuestions = DURATION_TO_TOTAL[durationMinutes];

  const rawSubjects = Array.isArray(body.subjects) ? body.subjects : [];
  const subjects = rawSubjects
    .map((s) => String(s ?? "").trim().slice(0, 80))
    .filter((s) => s.length > 0)
    .slice(0, 8);
  if (subjects.length === 0) {
    return json(200, { source: "unavailable", reason: "subjects required" });
  }

  // Distribute totalQuestions evenly across subjects; remainder goes to the
  // first few subjects so total sums exactly.
  const base = Math.floor(totalQuestions / subjects.length);
  const remainder = totalQuestions - base * subjects.length;
  const perSubject: { subject: string; count: number }[] = subjects.map((s, i) => ({
    subject: s,
    count: base + (i < remainder ? 1 : 0),
  }));
  const structSum = perSubject.reduce((a, s) => a + s.count, 0);
  if (structSum !== totalQuestions) {
    return json(200, { source: "unavailable", reason: "invalid mock structure" });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Ownership check.
  try {
    const { data: prof, error: profErr } = await admin
      .from("learner_profiles")
      .select("id, user_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profErr || !prof || (prof as { user_id: string }).user_id !== userId) {
      return json(403, { error: "forbidden" });
    }
  } catch {
    return json(500, { source: "unavailable", reason: "profile check failed" });
  }

  const boardLabel = BOARD_LABEL[board];
  const cur = BOARD_CURRICULUM[board];
  const gradeStr = gradeString(classLevel);

  const baseSystem = [
    `You are writing a real timed mock-test section for ${gradeStr} preparing for ${boardLabel} in India. ${cur}`,
    "",
    "Rules:",
    "- Age/level-appropriate, syllabus-aligned, non-trivial but fair. Test understanding, not tricks.",
    "- Spread across the subject's key topics for this exam pattern. Don't cluster around one narrow topic.",
    "- Honesty: never invent facts, dates, formulas, chapter references, or past-paper citations. If unsure, use safely-known content.",
    "- No personal data, no politics, no religion, no adult content.",
    "- Every question is 1 mark, no negative marking. Exactly 4 options, exactly one correct answer. Wrong options should be plausible common mistakes.",
    "- Keep each question concise — this is a speed-and-accuracy test.",
  ].join("\n");

  async function genSubject(
    subject: string,
    count: number,
  ): Promise<{ ok: true; items: unknown[] } | { ok: false; reason: string }> {
    // Generous per-subject budget: MCQ-only content. Floor of 4000, ~220
    // tokens per question — comfortably above what genuine MCQs need,
    // learning from the earlier long-section truncation issue.
    const maxTokens = Math.max(4000, count * 220);
    const instr = `Produce EXACTLY ${count} multiple-choice questions for the "${subject}" section of this mock test, 1 mark each. Keep each question concise (a single short sentence or two). 4 options, exactly one correct.`;
    const toolName = "return_mcq";
    const userMsg = `Generate the ${subject} MCQs for a ${boardLabel} ${gradeStr} timed mock test.`;

    const r = await callText({
      system: baseSystem + "\n\n" + instr + `\nReturn ONLY via the ${toolName} tool.`,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ name: toolName, description: "Return the MCQ section.", input_schema: MCQ_SECTION_SCHEMA }],
      toolChoice: { type: "tool", name: toolName },
      maxTokens,
      timeoutMs: 90000,
    });
    if (!r.ok) return { ok: false, reason: `${subject}: ${r.reason}` };
    const blocks = Array.isArray(r.data?.content) ? r.data.content : [];
    const toolUse = blocks.find((b: { type?: string }) => b?.type === "tool_use") as
      | { input?: Record<string, unknown> } | undefined;
    const arr = toolUse?.input?.mcq;
    if (!Array.isArray(arr)) {
      const stopReason = (r.data as { stop_reason?: unknown } | undefined)?.stop_reason;
      const textBlock = blocks.find((b: { type?: string }) => b?.type === "text") as { text?: string } | undefined;
      const textPreview = typeof textBlock?.text === "string" ? textBlock.text.slice(0, 150) : "";
      console.warn(`study-paper-mock: subject no-items subject="${subject}" stop_reason=${String(stopReason)} text_preview="${textPreview}"`);
      return { ok: false, reason: `${subject}: no items` };
    }
    return { ok: true, items: arr };
  }

  const results = await Promise.all(
    perSubject.map((p) => genSubject(p.subject, p.count).then((r) => ({ ...p, r }))),
  );

  type MCQIn = { question?: unknown; options?: unknown; correct_index?: unknown; explanation?: unknown };
  type StoredQ = {
    id: string;
    type: "mcq";
    marks: 1;
    subject: string;
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  };

  const stored: StoredQ[] = [];
  let idxAll = 0;
  for (const p of results) {
    if (!p.r.ok) {
      console.warn(`study-paper-mock: section fail duration=${durationMinutes} subject="${p.subject}" reason="${p.r.reason}"`);
      return json(200, { source: "unavailable", reason: p.r.reason });
    }
    const raw = p.r.items as MCQIn[];
    if (raw.length < p.count) {
      console.warn(`study-paper-mock: short section subject="${p.subject}" got=${raw.length}/${p.count}`);
      return json(200, { source: "unavailable", reason: `${p.subject}: not enough questions` });
    }
    for (let i = 0; i < p.count; i++) {
      const q = raw[i];
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map((o) => String(o)) : [];
      const ci = Number(q.correct_index);
      if (!q.question || options.length !== 4 || !Number.isInteger(ci) || ci < 0 || ci > 3) {
        console.warn(`study-paper-mock: bad mcq item subject="${p.subject}" i=${i}`);
        return json(200, { source: "unavailable", reason: `${p.subject}: bad mcq item` });
      }
      stored.push({
        id: `mock-${idxAll++}`,
        type: "mcq",
        marks: 1,
        subject: p.subject,
        question: String(q.question).trim(),
        options,
        correct_index: ci,
        explanation: String(q.explanation ?? "").trim(),
      });
    }
  }

  const startedAt = new Date();
  const durationSeconds = durationMinutes * 60;
  // Use a distinctive "subject" so quiz_attempts + resume logic can still
  // distinguish these rows from real subject-specific papers.
  const paperSubject = `Mock Test (${durationMinutes}m)`;

  try {
    const { data: inserted, error: insErr } = await admin
      .from("study_papers")
      .insert({
        profile_id: profileId,
        subject: paperSubject,
        total_marks: totalQuestions,
        questions: stored,
        status: "in_progress",
        kind: "mock",
        started_at: startedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .select("id, started_at, duration_seconds")
      .single();
    if (insErr || !inserted) {
      console.warn("study-paper-mock: insert failed", insErr?.message);
      return json(200, { source: "unavailable", reason: "storage failed" });
    }

    const clientQuestions = stored.map((q) => ({
      id: q.id,
      type: q.type,
      marks: q.marks,
      subject: q.subject,
      question: q.question,
      options: q.options,
    }));

    const row = inserted as { id: string; started_at: string; duration_seconds: number };
    console.warn(`study-paper-mock: SUCCESS duration=${durationMinutes} subjects=${subjects.length} questions=${clientQuestions.length}`);
    return json(200, {
      source: "paper",
      paper_id: row.id,
      subject: paperSubject,
      total_marks: totalQuestions,
      questions: clientQuestions,
      kind: "mock",
      started_at: row.started_at,
      duration_seconds: row.duration_seconds,
    });
  } catch (e) {
    console.warn(`study-paper-mock: exception duration=${durationMinutes} err="${(e as Error).message.slice(0, 200)}"`);
    return json(200, { source: "unavailable", reason: (e as Error).message.slice(0, 100) });
  }
});
