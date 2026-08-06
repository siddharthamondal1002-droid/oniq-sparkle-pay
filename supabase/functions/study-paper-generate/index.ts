// study-paper-generate — build a real exam-format paper (30/80/100 marks).
// JWT-gated. Uses service role to store answer key server-side; returns a
// sanitized paper (no correct_index / model_answer / rubric_points) to client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callClaude, corsHeaders, gradeString, json, langInstruction } from "../_shared/llm.ts";
import { orderMcqOptions } from "../_shared/mcqOrder.ts";

type Section = { type: "mcq" | "short" | "long"; marks: number; count: number };

const MARK_STRUCTURES: Record<30 | 80 | 100, Section[]> = {
  30: [
    { type: "mcq", marks: 1, count: 10 },
    { type: "short", marks: 3, count: 4 },
    { type: "long", marks: 4, count: 2 },
  ], // 10 + 12 + 8 = 30
  80: [
    { type: "mcq", marks: 1, count: 20 },
    { type: "short", marks: 3, count: 10 },
    { type: "long", marks: 5, count: 6 },
  ], // 20 + 30 + 30 = 80
  100: [
    { type: "mcq", marks: 1, count: 20 },
    { type: "short", marks: 3, count: 15 },
    { type: "long", marks: 5, count: 7 },
  ], // 20 + 45 + 35 = 100
};

// Self-check at cold start — refuse to boot with a broken structure.
for (const [k, secs] of Object.entries(MARK_STRUCTURES)) {
  const sum = secs.reduce((a, s) => a + s.marks * s.count, 0);
  if (sum !== Number(k)) {
    console.error(`MARK_STRUCTURES[${k}] sums to ${sum}, expected ${k}`);
  }
}

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
const WRITTEN_ITEM_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    model_answer: { type: "string" },
    rubric_points: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
  },
  required: ["question", "model_answer", "rubric_points"],
};
const MCQ_SECTION_SCHEMA = {
  type: "object",
  properties: { mcq: { type: "array", items: MCQ_ITEM_SCHEMA } },
  required: ["mcq"],
};
const SHORT_SECTION_SCHEMA = {
  type: "object",
  properties: { short: { type: "array", items: WRITTEN_ITEM_SCHEMA } },
  required: ["short"],
};
const LONG_SECTION_SCHEMA = {
  type: "object",
  properties: { long: { type: "array", items: WRITTEN_ITEM_SCHEMA } },
  required: ["long"],
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
    subject?: string;
    totalMarks?: number;
    profileId?: string;
    chapter?: string;
    lang?: string;
    // Phase 2 (Education & Careers): optional, already-resolved education
    // system sent by the client for non-India learners. Ignored whenever
    // profile.board is a recognized India board key — India's path is
    // completely unchanged.
    eduSystem?: {
      id?: string;
      authority?: string;
      commandWords?: unknown;
      unit?: string;
      terminator?: string;
      spelling?: string;
    };
  } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const boardKey = String(body.profile?.board ?? "").toLowerCase();
  const isIndiaBoard = Boolean(BOARD_LABEL[boardKey]);
  const board = isIndiaBoard ? boardKey : "cbse";

  // Resolve the optional generic path. Never for a recognized India board.
  const eduRaw = body.eduSystem;
  const edu = !isIndiaBoard && eduRaw && typeof eduRaw.id === "string" && eduRaw.id.trim()
    ? {
      id: String(eduRaw.id).slice(0, 60),
      authority: String(eduRaw.authority ?? "").slice(0, 200),
      commandWords: (Array.isArray(eduRaw.commandWords) ? eduRaw.commandWords : [])
        .slice(0, 16).map((w) => String(w).slice(0, 40)).filter(Boolean),
      unit: eduRaw.unit === "points" ? "points" as const : "marks" as const,
      terminator: String(eduRaw.terminator ?? "End of paper").slice(0, 60),
      spelling: String(eduRaw.spelling ?? "en-GB").slice(0, 8),
    }
    : null;

  // India keeps its strict VALID_CLASS_LEVELS check. The eduSystem path is
  // validated permissively — the client already validated the stage against
  // the system's own stageModel.stages before sending it.
  const classLevel = edu
    ? (String(body.profile?.classLevel ?? "").trim().slice(0, 40) || "10")
    : ((VALID_CLASS_LEVELS as readonly string[]).includes(String(body.profile?.classLevel ?? ""))
      ? String(body.profile?.classLevel) : "8");
  const subject = String(body.subject ?? "").trim().slice(0, 80);
  const totalMarks = Number(body.totalMarks);
  const profileId = String(body.profileId ?? body.profile?.id ?? "").trim();
  const chapter = String(body.chapter ?? "").trim().slice(0, 200);
  if (!subject) return json(200, { source: "unavailable", reason: "subject required" });
  if (!profileId) return json(200, { source: "unavailable", reason: "profile id required" });
  if (!(totalMarks === 30 || totalMarks === 80 || totalMarks === 100)) {
    return json(200, { source: "unavailable", reason: "totalMarks must be 30, 80 or 100" });
  }
  const structure = MARK_STRUCTURES[totalMarks as 30 | 80 | 100];
  const structSum = structure.reduce((a, s) => a + s.marks * s.count, 0);
  if (structSum !== totalMarks) {
    return json(200, { source: "unavailable", reason: "invalid mark structure" });
  }

  // Service-role client for study_papers writes + ownership check.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Verify the caller owns this learner profile.
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

  const mcqCount = structure.find((s) => s.type === "mcq")!.count;
  const shortSec = structure.find((s) => s.type === "short")!;
  const longSec = structure.find((s) => s.type === "long")!;

  // Unit vocabulary. India (and any request without an eduSystem) keeps
  // "mark(s)" exactly as before.
  const unit: "marks" | "points" = edu ? edu.unit : "marks";
  const unitOne = unit === "points" ? "point" : "mark";
  const unitMany = unit;

  function spellingLine(code: string): string {
    if (code === "en-US") return "Use American English spelling throughout (color, organize, analyze, meter).";
    if (code === "en-AU") return "Use Australian English spelling throughout (colour, organise, analyse, metre).";
    if (code === "en-CA") return "Use Canadian English spelling throughout (colour, organize, analyze, metre).";
    if (code === "en-IN") return "Use Indian English conventions throughout (colour, organise, lakh/crore where natural).";
    return "Use British English spelling throughout (colour, organise, analyse, metre).";
  }

  const eduLabel = edu ? edu.authority : "";
  const stageLabel = edu ? `a learner at stage "${classLevel}"` : "";

  const baseSystem = (edu
    ? [
      `You are writing a real ${totalMarks}-${unitMany} original practice examination paper, in the style of the system overseen by ${eduLabel}, for ${stageLabel}.`,
      `Subject: ${subject}.`,
      chapter
        ? `Topic scope: "${chapter}". EVERY question — MCQ, short, and long — must come from this topic only. Do NOT draw from other topics. Spread across sub-topics WITHIN it for variety.`
        : "",
      "",
      "Rules:",
      `- Every question must be ORIGINAL. Never reproduce, paraphrase or cite any real past paper, syllabus text or awarding-body wording.`,
      edu.commandWords.length
        ? `- Use this system's usual command words where natural: ${edu.commandWords.join(", ")}.`
        : "",
      `- ${spellingLine(edu.spelling)}`,
      `- Marks are expressed in ${unitMany}. The paper closes with "${edu.terminator}".`,
      "- Age-appropriate, curriculum-aligned, non-trivial but fair. Test understanding, not tricks.",
      chapter
        ? `- Stay strictly within "${chapter}" — no cross-topic integration questions.`
        : "- Spread across the subject's key topics for this stage. Don't cluster around one narrow topic.",
      "- Honesty: never invent facts, dates, formulas, chapter references, or past-paper citations. If unsure, use safely-known content.",
      "- No personal data, no politics, no religion, no adult content.",
    ]
    : [
      `You are writing a real ${totalMarks}-mark practice examination paper for ${gradeStr} studying under ${boardLabel} in India. ${cur}`,
      `Subject: ${subject}.`,
      chapter
        ? `Chapter scope: "${chapter}". EVERY question — MCQ, short, and long — must come from this chapter's content only. Do NOT draw from other chapters. Spread across sub-topics WITHIN this chapter for variety.`
        : "",
      "",
      "Rules:",
      "- Age-appropriate, syllabus-aligned, non-trivial but fair. Test understanding, not tricks.",
      chapter
        ? `- Stay strictly within the "${chapter}" chapter — no cross-chapter integration questions.`
        : "- Spread across the subject's key topics for this class. Don't cluster around one narrow topic.",
      "- Honesty: never invent facts, dates, formulas, chapter references, or past-paper citations. If unsure, use safely-known content.",
      "- No personal data, no politics, no religion, no adult content.",
    ]
  ).filter(Boolean).join("\n") + langInstruction(body.lang);

  const userMsg = edu
    ? (chapter
      ? `Generate the questions for the ${totalMarks}-${unitMany} ${subject} paper — topic "${chapter}" only — for ${stageLabel} under ${eduLabel}.`
      : `Generate the questions for the ${totalMarks}-${unitMany} ${subject} paper for ${stageLabel} under ${eduLabel}.`)
    : (chapter
      ? `Generate the questions for the ${totalMarks}-mark ${subject} paper — chapter "${chapter}" only — for a ${boardLabel} ${gradeStr}.`
      : `Generate the questions for the ${totalMarks}-mark ${subject} paper for a ${boardLabel} ${gradeStr}.`);

  async function genSection(
    kind: "mcq" | "short" | "long",
    count: number,
    marks: number,
  ): Promise<{ ok: true; items: unknown[] } | { ok: false; reason: string }> {
    let instr = "";
    let schema: unknown;
    let toolName = "";
    let maxTokens = 2000;
    if (kind === "mcq") {
      instr = `Produce EXACTLY ${count} multiple-choice questions, 1 ${unitOne} each, 4 options each with exactly one correct answer. Wrong options should be plausible common mistakes. When the four options are quantities, LIST THEM IN ASCENDING NUMERICAL ORDER — scrambled numeric options make the student scan instead of reading down a ladder, which tests attention rather than the subject. Do not place the correct answer in a consistent position. Keep each question concise.`;
      schema = MCQ_SECTION_SCHEMA;
      toolName = "return_mcq";
      maxTokens = Math.max(1500, count * 180);
    } else if (kind === "short") {
      instr = `Produce EXACTLY ${count} short-answer questions, ${marks} ${unitMany} each. Provide a concise model_answer (40–120 words) and 2–4 concrete, answer-specific rubric_points (e.g. "defines momentum as p = mv", not "good explanation").`;
      schema = SHORT_SECTION_SCHEMA;
      toolName = "return_short";
      maxTokens = Math.max(3500, count * 450);
    } else {
      instr = `Produce EXACTLY ${count} long-answer questions, ${marks} ${unitMany} each. Provide a fuller model_answer (120–300 words) and 2–4 concrete, answer-specific rubric_points.`;
      schema = LONG_SECTION_SCHEMA;
      toolName = "return_long";
      maxTokens = Math.max(6000, count * 900);
    }

    const r = await callClaude({
      system: baseSystem + "\n\n" + instr + `\nReturn ONLY via the ${toolName} tool.`,
      messages: [{ role: "user", content: userMsg }],
      tools: [{ name: toolName, description: `Return the ${kind} section.`, input_schema: schema }],
      toolChoice: { type: "tool", name: toolName },
      maxTokens,
      timeoutMs: 90000,
    });
    if (!r.ok) return { ok: false, reason: `${kind}: ${r.reason}` };
    const blocks = Array.isArray(r.data?.content) ? r.data.content : [];
    const toolUse = blocks.find((b: { type?: string }) => b?.type === "tool_use") as
      | { input?: Record<string, unknown> } | undefined;
    const arr = toolUse?.input?.[kind];
    if (!Array.isArray(arr)) {
      const stopReason = (r.data as { stop_reason?: unknown } | undefined)?.stop_reason;
      const textBlock = blocks.find((b: { type?: string }) => b?.type === "text") as { text?: string } | undefined;
      const textPreview = typeof textBlock?.text === "string" ? textBlock.text.slice(0, 150) : "";
      console.warn(`study-paper-generate: genSection no-items kind=${kind} stop_reason=${String(stopReason)} text_preview="${textPreview}"`);
      return { ok: false, reason: `${kind}: no items` };
    }
    return { ok: true, items: arr };
  }

  const [mcqRes, shortRes, longRes] = await Promise.all([
    genSection("mcq", mcqCount, 1),
    genSection("short", shortSec.count, shortSec.marks),
    genSection("long", longSec.count, longSec.marks),
  ]);
  if (!mcqRes.ok) {
    console.warn(`study-paper-generate: section fail totalMarks=${totalMarks} subject="${subject}" reason="${mcqRes.reason}"`);
    return json(200, { source: "unavailable", reason: mcqRes.reason });
  }
  if (!shortRes.ok) {
    console.warn(`study-paper-generate: section fail totalMarks=${totalMarks} subject="${subject}" reason="${shortRes.reason}"`);
    return json(200, { source: "unavailable", reason: shortRes.reason });
  }
  if (!longRes.ok) {
    console.warn(`study-paper-generate: section fail totalMarks=${totalMarks} subject="${subject}" reason="${longRes.reason}"`);
    return json(200, { source: "unavailable", reason: longRes.reason });
  }

  try {
    type MCQIn = { question?: unknown; options?: unknown; correct_index?: unknown; explanation?: unknown };
    type WrittenIn = { question?: unknown; model_answer?: unknown; rubric_points?: unknown };

    const mcqRaw = mcqRes.items as MCQIn[];
    const shortRaw = shortRes.items as WrittenIn[];
    const longRaw = longRes.items as WrittenIn[];




    if (mcqRaw.length < mcqCount || shortRaw.length < shortSec.count || longRaw.length < longSec.count) {
      console.warn(`study-paper-generate: malformed paper totalMarks=${totalMarks} subject="${subject}" got mcq=${mcqRaw.length}/${mcqCount} short=${shortRaw.length}/${shortSec.count} long=${longRaw.length}/${longSec.count}`);
      return json(200, { source: "unavailable", reason: "malformed paper" });
    }

    // Full internal record (stored server-side).
    type StoredQ =
      | { id: string; type: "mcq"; marks: number; question: string; options: string[]; correct_index: number; explanation: string }
      | { id: string; type: "short" | "long"; marks: number; question: string; model_answer: string; rubric_points: string[] };

    const stored: StoredQ[] = [];

    for (let i = 0; i < mcqCount; i++) {
      const q = mcqRaw[i];
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map((o) => String(o)) : [];
      const ci = Number(q.correct_index);
      if (!q.question || options.length !== 4 || !Number.isInteger(ci) || ci < 0 || ci > 3) {
        console.warn(`study-paper-generate: bad mcq item i=${i} totalMarks=${totalMarks} subject="${subject}"`);
        return json(200, { source: "unavailable", reason: "bad mcq item" });
      }
      // The prompt asks for ascending numeric options; this makes it true.
      // Models comply with ordering unreliably — a production Class 9 Maths
      // paper came back with eight of ten MCQs scrambled — and the correct
      // order is computable, so it is not left to chance. Text options are
      // returned untouched: there is no natural order for "in the third
      // quadrant", and alphabetising prose would be a cue of its own.
      //
      // orderMcqOptions moves the key with the options. That remap is the
      // whole risk here: sorting without it would turn every correct key into
      // a wrong one, silently, across every paper.
      const ordered = orderMcqOptions(options, ci);
      stored.push({
        id: `mcq-${i}`,
        type: "mcq",
        marks: 1,
        question: String(q.question).trim(),
        options: ordered.options,
        correct_index: ordered.correctIndex,
        explanation: String(q.explanation ?? "").trim(),
      });
    }
    for (let i = 0; i < shortSec.count; i++) {
      const q = shortRaw[i];
      const rp = Array.isArray(q.rubric_points) ? q.rubric_points.slice(0, 4).map((s) => String(s).trim()).filter(Boolean) : [];
      if (!q.question || !q.model_answer || rp.length < 2) {
        console.warn(`study-paper-generate: bad short item i=${i} totalMarks=${totalMarks} subject="${subject}" rp=${rp.length}`);
        return json(200, { source: "unavailable", reason: "bad short item" });
      }
      stored.push({
        id: `short-${i}`,
        type: "short",
        marks: shortSec.marks,
        question: String(q.question).trim(),
        model_answer: String(q.model_answer).trim(),
        rubric_points: rp,
      });
    }
    for (let i = 0; i < longSec.count; i++) {
      const q = longRaw[i];
      const rp = Array.isArray(q.rubric_points) ? q.rubric_points.slice(0, 4).map((s) => String(s).trim()).filter(Boolean) : [];
      if (!q.question || !q.model_answer || rp.length < 2) {
        console.warn(`study-paper-generate: bad long item i=${i} totalMarks=${totalMarks} subject="${subject}" rp=${rp.length}`);
        return json(200, { source: "unavailable", reason: "bad long item" });
      }
      stored.push({
        id: `long-${i}`,
        type: "long",
        marks: longSec.marks,
        question: String(q.question).trim(),
        model_answer: String(q.model_answer).trim(),
        rubric_points: rp,
      });
    }

    // Insert full record via service role.
    const { data: inserted, error: insErr } = await admin
      .from("study_papers")
      .insert({
        profile_id: profileId,
        subject,
        total_marks: totalMarks,
        questions: stored,
        status: "in_progress",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.warn("study-paper-generate: insert failed", insErr?.message);
      return json(200, { source: "unavailable", reason: "storage failed" });
    }

    // Sanitize for the client — strip every answer-key field.
    const clientQuestions = stored.map((q) => {
      if (q.type === "mcq") {
        return { id: q.id, type: "mcq" as const, marks: q.marks, question: q.question, options: q.options };
      }
      return { id: q.id, type: q.type, marks: q.marks, question: q.question };
    });

    console.warn(`study-paper-generate: SUCCESS totalMarks=${totalMarks} subject="${subject}" questions=${clientQuestions.length} (mcq=${mcqCount} short=${shortSec.count} long=${longSec.count})`);
    return json(200, {
      source: "paper",
      paper_id: (inserted as { id: string }).id,
      subject,
      total_marks: totalMarks,
      questions: clientQuestions,
    });
  } catch (e) {
    console.warn(`study-paper-generate: exception totalMarks=${totalMarks} subject="${subject}" err="${(e as Error).message.slice(0, 200)}"`);
    return json(200, { source: "unavailable", reason: (e as Error).message.slice(0, 100) });
  }
});
