// study-chapter-notes — readable study notes for one chapter.
// Cache-first from public.chapter_notes; on miss, generate via Claude and
// service-role upsert. JWT-gated. Mirrors study-chapters' shape.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callClaude, corsHeaders, gradeString, json, langInstruction } from "../_shared/llm.ts";

const SOURCE_NOTE = "AI-generated study notes — verify against your exact textbook edition";

function norm(s: string, max: number): string {
  return s.trim().replace(/\s+/g, " ").slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
  } catch {
    return json(401, { error: "unauthorized" });
  }

  let body: { board?: string; classLevel?: string; subject?: string; chapter?: string; lang?: string } = {};
  try { body = await req.json(); } catch { /* keep {} */ }

  const board = String(body.board ?? "").toLowerCase().trim();
  const classLevel = String(body.classLevel ?? "").trim();
  const subject = norm(String(body.subject ?? ""), 80);
  const chapter = norm(String(body.chapter ?? ""), 200);
  const langCode = String(body.lang ?? "").toLowerCase().trim();
  const isLocalised = langCode && langCode !== "en";

  if (!BOARD_LABEL[board]) return json(200, { source: "unavailable", content: "", reason: "invalid board" });
  if (!(VALID_CLASS_LEVELS as readonly string[]).includes(classLevel)) {
    return json(200, { source: "unavailable", content: "", reason: "invalid classLevel" });
  }
  if (subject.length < 2) return json(200, { source: "unavailable", content: "", reason: "invalid subject" });
  if (chapter.length < 2) return json(200, { source: "unavailable", content: "", reason: "invalid chapter" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(200, { source: "unavailable", content: "", reason: "backend not configured" });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1) Cache check — English-only; localised responses bypass cache.
  if (!isLocalised) try {
    const { data: row, error } = await admin
      .from("chapter_notes")
      .select("content, source_note")
      .eq("board", board)
      .eq("class_level", classLevel)
      .eq("subject", subject)
      .eq("chapter", chapter)
      .maybeSingle();
    if (!error && row && row.content) {
      return json(200, { source: "cache", content: row.content, source_note: row.source_note ?? SOURCE_NOTE });
    }
  } catch (e) {
    console.warn("study-chapter-notes: cache read exception", (e as Error).message);
  }

  // 2) Generate via Claude
  const boardLabel = BOARD_LABEL[board];
  const curriculum = BOARD_CURRICULUM[board] ?? BOARD_CURRICULUM.cbse;
  const gradeStr = gradeString(classLevel);

  const system = [
    `You are writing clear, readable STUDY NOTES for one chapter of an Indian school/exam textbook. This is reference reading a student can sit with — NOT a chat reply, NOT quiz questions.`,
    ``,
    `Context: ${boardLabel} — ${curriculum} The student is ${gradeStr}. Subject: "${subject}". Chapter: "${chapter}".`,
    ``,
    `RULES:`,
    `- Explain the actual content of THIS chapter genuinely and plainly — key concepts, important definitions, formulas, and (for maths/science/econ-style chapters) at least one worked example.`,
    `- Structure with clear section breaks using markdown headers exactly like:`,
    `  ## Overview`,
    `  ## Key Concepts`,
    `  ## Important Definitions / Formulas`,
    `  ## Example`,
    `  ## Quick Recap`,
    `  Adapt sections to what the chapter needs (an English literature chapter won't have formulas — replace with "Themes" or "Characters" as appropriate).`,
    `- Use **bold** sparingly for the most important terms. Use bullet lists (- item) where it aids readability.`,
    `- Do NOT invent facts. Do NOT cite fake textbook page numbers or fabricated sources. If the chapter has widely-recognized formulas/theorems/dates, use the standard ones; if you are uncertain about a specific figure, phrase it generally rather than inventing.`,
    `- Length: thorough but not padded. Aim ~400-900 words depending on how content-heavy the chapter is. A dense Physics chapter deserves the upper end; a short English poem the lower end.`,
    `- Output plain markdown text only. No code fences, no preamble like "Here are your notes", no closing sign-off.`,
  ].join("\n") + langInstruction(body.lang);

  const userMsg = `Write study notes for this chapter:\n- Board: ${boardLabel}\n- Class/Level: ${classLevel}\n- Subject: ${subject}\n- Chapter: ${chapter}\n\nBegin directly with the first "## " section header.`;

  const res = await callClaude({
    system,
    messages: [{ role: "user", content: userMsg }],
    maxTokens: 2400,
    timeoutMs: 60000,
  });

  if (!res.ok) {
    console.warn(`study-chapter-notes: callClaude failed board=${board} class=${classLevel} subject="${subject}" chapter="${chapter}" reason=${res.reason}`);
    return json(200, { source: "unavailable", content: "", reason: res.reason });
  }

  const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
  const textBlock = blocks.find((b: { type?: string; text?: string }) => b?.type === "text" && typeof b.text === "string");
  const content = String((textBlock as { text?: string })?.text ?? "").trim();
  if (content.length < 80) {
    return json(200, { source: "unavailable", content: "", reason: "empty generation" });
  }

  // 3) Persist (one-time cache write; English only to keep cache stable).
  if (!isLocalised) try {
    const { error: insErr } = await admin
      .from("chapter_notes")
      .upsert(
        [{ board, class_level: classLevel, subject, chapter, content, source_note: SOURCE_NOTE }],
        { onConflict: "board,class_level,subject,chapter", ignoreDuplicates: true },
      );
    if (insErr) console.warn("study-chapter-notes: insert error", insErr.message);
  } catch (e) {
    console.warn("study-chapter-notes: insert exception", (e as Error).message);
  }

  return json(200, { source: "generated", content, source_note: SOURCE_NOTE });
});
