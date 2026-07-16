// study-quiz — generate a 5-question board/class-aware quiz for a learner.
// JWT-gated; reuses shared callClaude. Returns HTTP 200 always.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callClaude, corsHeaders, gradeString, json } from "../_shared/llm.ts";

const QUIZ_TOOL = {
  name: "generate_quiz",
  description: "Return a 5-question multiple-choice practice quiz.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "string" },
            },
            correct_index: { type: "integer", minimum: 0, maximum: 3 },
            explanation: { type: "string" },
          },
          required: ["question", "options", "correct_index", "explanation"],
        },
      },
    },
    required: ["questions"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
  } catch {
    return json(401, { error: "unauthorized" });
  }

  let body: {
    profile?: { board?: string; classLevel?: string };
    subject?: string;
    topic?: string;
  } = {};
  try { body = await req.json(); } catch { /* keep {} */ }

  const boardKey = String(body.profile?.board ?? "").toLowerCase();
  const board = BOARD_LABEL[boardKey] ? boardKey : "cbse";
  const classLevel = (VALID_CLASS_LEVELS as readonly string[]).includes(String(body.profile?.classLevel ?? ""))
    ? String(body.profile?.classLevel) : "8";
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  const topic = String(body.topic ?? "").trim().slice(0, 120) || subject;
  if (!subject) return json(200, { source: "unavailable", reason: "subject required" });

  const boardLabel = BOARD_LABEL[board];
  const cur = BOARD_CURRICULUM[board];
  const gradeStr = gradeString(classLevel);

  const system = [
    `You write short practice quizzes for ${gradeStr} studying under ${boardLabel} in India. ${cur}`,
    `Subject: ${subject}. Topic: ${topic}.`,
    "",
    "Rules:",
    "- Produce exactly 5 multiple-choice questions with 4 options each and exactly one correct answer.",
    "- Test understanding, not trick or ambiguous phrasing. No trivia gotchas.",
    "- Age-appropriate language; avoid anything scary, political, religious, or adult.",
    "- Keep options plausible; the wrong ones should reflect common mistakes at this level.",
    "- Explanations must be 1–2 short sentences, warm and encouraging, never condescending.",
    "- Honesty: never invent facts, dates, or formulas. If uncertain about specifics for this level, stay with safely-known material for the topic.",
    "- Do not include the student's name or any personal info.",
    "- Return ONLY via the generate_quiz tool.",
  ].join("\n");

  const res = await callClaude({
    system,
    messages: [{ role: "user", content: `Please generate the 5-question quiz on ${subject} — ${topic}.` }],
    tools: [QUIZ_TOOL],
    toolChoice: { type: "tool", name: "generate_quiz" },
    maxTokens: 1400,
    timeoutMs: 25000,
  });

  if (!res.ok) return json(200, { source: "unavailable", reason: res.reason });

  try {
    const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
    const toolUse = blocks.find((b: { type?: string }) => b?.type === "tool_use") as
      | { input?: { questions?: unknown } } | undefined;
    const raw = toolUse?.input?.questions;
    if (!Array.isArray(raw)) return json(200, { source: "unavailable", reason: "no questions" });

    const questions = raw.slice(0, 5).map((q) => {
      const qq = q as {
        question?: unknown; options?: unknown; correct_index?: unknown; explanation?: unknown;
      };
      const options = Array.isArray(qq.options) ? qq.options.slice(0, 4).map((o) => String(o)) : [];
      const ci = Number(qq.correct_index);
      return {
        question: String(qq.question ?? "").trim(),
        options,
        correct_index: Number.isInteger(ci) && ci >= 0 && ci <= 3 ? ci : 0,
        explanation: String(qq.explanation ?? "").trim(),
      };
    }).filter((q) => q.question && q.options.length === 4);

    if (questions.length < 5) return json(200, { source: "unavailable", reason: "malformed" });

    return json(200, { source: "quiz", questions });
  } catch (e) {
    return json(200, { source: "unavailable", reason: (e as Error).message.slice(0, 100) });
  }
});
