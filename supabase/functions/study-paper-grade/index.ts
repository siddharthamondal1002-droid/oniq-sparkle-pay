// study-paper-grade — grade a single answer against the server-stored key.
// JWT-gated. Uses service role to read the answer key + verify ownership.
// Accepts either a typed answer (`answer`) or a photo of a handwritten
// answer (`answer_image`) for short/long questions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, corsHeaders, json } from "../_shared/llm.ts";

type StoredQ =
  | { id: string; type: "mcq"; marks: number; question: string; options: string[]; correct_index: number; explanation: string }
  | { id: string; type: "short" | "long"; marks: number; question: string; model_answer: string; rubric_points: string[] };

const GRADE_TOOL = {
  name: "grade_answer",
  description: "Grade the student's written answer (or photo of a handwritten answer) against the model answer and rubric.",
  input_schema: {
    type: "object",
    properties: {
      awarded_marks: { type: "integer", minimum: 0 },
      feedback: { type: "string" },
      transcript: {
        type: "string",
        description: "If the answer was given as a photo of handwritten work, your best reading of what the student wrote. Empty string if answer was typed or nothing legible was found.",
      },
    },
    required: ["awarded_marks", "feedback", "transcript"],
  },
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
    paper_id?: string;
    question_id?: string;
    answer?: string | number;
    answer_image?: { mime?: string; data?: string };
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const paperId = String(body.paper_id ?? "").trim();
  const questionId = String(body.question_id ?? "").trim();
  if (!paperId || !questionId) return json(200, { source: "unavailable", reason: "missing ids" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Load paper + verify ownership via learner_profiles.
  let paper: { id: string; profile_id: string; questions: StoredQ[] } | null = null;
  try {
    const { data, error } = await admin
      .from("study_papers")
      .select("id, profile_id, questions")
      .eq("id", paperId)
      .maybeSingle();
    if (error || !data) return json(200, { source: "unavailable", reason: "paper not found" });
    paper = data as { id: string; profile_id: string; questions: StoredQ[] };
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

  const q = (paper.questions ?? []).find((x) => x?.id === questionId);
  if (!q) return json(200, { source: "unavailable", reason: "question not found" });

  // -------- MCQ: deterministic --------
  if (q.type === "mcq") {
    const idx = Number(body.answer);
    const awarded = Number.isInteger(idx) && idx === q.correct_index ? q.marks : 0;
    return json(200, {
      awarded_marks: awarded,
      max_marks: q.marks,
      feedback: awarded > 0
        ? "nice — that's the one ✨"
        : `not quite — the correct choice is highlighted. ${q.explanation || ""}`.trim(),
      correct_index: q.correct_index,
    });
  }

  // -------- Written / photo: LLM-graded --------
  const img = body.answer_image;
  const hasImage = !!(img && typeof img.data === "string" && img.data.length > 0 && typeof img.mime === "string" && img.mime.startsWith("image/"));
  const studentAnswer = String(body.answer ?? "").trim();

  if (!hasImage && !studentAnswer) {
    return json(200, {
      awarded_marks: 0,
      max_marks: q.marks,
      feedback: "no answer submitted — write or snap something for me to grade next time 🌱",
      transcript: "",
    });
  }

  const system = [
    "You are a fair, encouraging exam grader for an Indian school student.",
    `This is a ${q.type === "long" ? "long-answer" : "short-answer"} question worth ${q.marks} marks maximum.`,
    "",
    "You will be given the question, the model answer, the rubric points, and the student's answer.",
    "The student's answer may be typed text OR a photo of a handwritten answer.",
    "If given a photo of a handwritten answer, first read it carefully, then grade the CONTENT against the rubric exactly as you would typed text. If the handwriting is genuinely illegible or the photo doesn't contain a relevant answer, award 0 and explain why in feedback, with transcript reflecting what (if anything) you could make out.",
    "Award a WHOLE-NUMBER score from 0 to the maximum marks. Partial credit is allowed and encouraged when the student shows partial understanding of the rubric points.",
    "Do not add criteria beyond the rubric. Do not penalise for style or handwriting neatness if content is correct.",
    "Feedback: 1–2 short sentences, warm and specific (mention what worked and what to add), never condescending, age-appropriate.",
    "Never invent facts, corrections, or citations that aren't in the model answer.",
    "Return ONLY via the grade_answer tool. Always include a `transcript` field — the student's typed answer as-is when text was given, your best reading of the handwriting when a photo was given, or empty string if nothing legible.",
  ].join("\n");

  const contextText = [
    `Question: ${q.question}`,
    "",
    `Model answer: ${q.model_answer}`,
    "",
    `Rubric points to check:\n- ${q.rubric_points.join("\n- ")}`,
    "",
    `Maximum marks: ${q.marks}`,
  ].join("\n");

  let userContent: unknown;
  if (hasImage) {
    userContent = [
      { type: "image", source: { type: "base64", media_type: img!.mime, data: img!.data } },
      { type: "text", text: `${contextText}\n\nThe student's answer is in the attached photo (handwritten). Read it carefully, then grade.` },
    ];
  } else {
    userContent = `${contextText}\n\nStudent's answer:\n${studentAnswer.slice(0, 6000)}`;
  }

  const res = await callClaude({
    system,
    // deno-lint-ignore no-explicit-any
    messages: [{ role: "user", content: userContent as any }],
    tools: [GRADE_TOOL],
    toolChoice: { type: "tool", name: "grade_answer" },
    maxTokens: 700,
    timeoutMs: 30000,
  });

  if (!res.ok) return json(200, { source: "unavailable", reason: res.reason });

  try {
    const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
    const tu = blocks.find((b: { type?: string }) => b?.type === "tool_use") as
      | { input?: { awarded_marks?: unknown; feedback?: unknown; transcript?: unknown } } | undefined;
    const rawAwarded = Number(tu?.input?.awarded_marks);
    if (!Number.isFinite(rawAwarded)) return json(200, { source: "unavailable", reason: "no score" });
    const awarded = Math.max(0, Math.min(q.marks, Math.round(rawAwarded)));
    const feedback = String(tu?.input?.feedback ?? "").trim().slice(0, 600) || "graded — keep going 🌿";
    const transcript = String(tu?.input?.transcript ?? "").trim().slice(0, 4000);
    return json(200, { awarded_marks: awarded, max_marks: q.marks, feedback, transcript });
  } catch (e) {
    return json(200, { source: "unavailable", reason: (e as Error).message.slice(0, 100) });
  }
});
