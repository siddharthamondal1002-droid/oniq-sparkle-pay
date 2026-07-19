// study-chapters — return the canonical chapter list for (board, class, subject).
// Cache-first: reads from public.chapters; on miss, asks Claude for the standard
// textbook TOC and writes it once via service role. Never regenerates for the
// same combo. JWT-gated like study-tutor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callClaude, corsHeaders, gradeString, json } from "../_shared/llm.ts";

type ChapterRow = { chapter_number: number; chapter_title: string; source_note?: string };

function normSubject(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth gate
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

  let body: { board?: string; classLevel?: string; subject?: string } = {};
  try { body = await req.json(); } catch { /* keep {} */ }

  const board = String(body.board ?? "").toLowerCase().trim();
  const classLevel = String(body.classLevel ?? "").trim();
  const subject = normSubject(String(body.subject ?? ""));

  if (!BOARD_LABEL[board]) return json(200, { source: "unavailable", chapters: [], reason: "invalid board" });
  if (!(VALID_CLASS_LEVELS as readonly string[]).includes(classLevel)) {
    return json(200, { source: "unavailable", chapters: [], reason: "invalid classLevel" });
  }
  if (subject.length < 2) return json(200, { source: "unavailable", chapters: [], reason: "invalid subject" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json(200, { source: "unavailable", chapters: [], reason: "backend not configured" });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const logDebug = async (fields: { source: string; reason?: string | null; stop_reason?: string | null; blocks_snippet?: string | null; http_reason?: string | null }) => {
    try {
      await admin.from("study_chapters_debug").insert({
        board, class_level: classLevel, subject,
        source: fields.source,
        reason: fields.reason ?? null,
        stop_reason: fields.stop_reason ?? null,
        blocks_snippet: fields.blocks_snippet ?? null,
        http_reason: fields.http_reason ?? null,
      });
    } catch { /* best effort */ }
  };

  // 1) Cache check
  try {
    const { data: rows, error } = await admin
      .from("chapters")
      .select("chapter_number, chapter_title, source_note")
      .eq("board", board)
      .eq("class_level", classLevel)
      .eq("subject", subject)
      .order("chapter_number", { ascending: true });
    if (!error && rows && rows.length > 0) {
      await logDebug({ source: "cache" });
      return json(200, { source: "cache", chapters: rows });
    }
    if (error) console.warn("study-chapters: cache read error", error.message);
  } catch (e) {
    console.warn("study-chapters: cache read exception", (e as Error).message);
  }

  // 2) Generate via Claude (tool-forced)
  const boardLabel = BOARD_LABEL[board];
  const curriculum = BOARD_CURRICULUM[board] ?? BOARD_CURRICULUM.cbse;
  const gradeStr = gradeString(classLevel);

  const system = [
    `You are a curriculum reference for Indian students. You will output the STANDARD, REAL chapter list (textbook table of contents) for a specific board, class, and subject.`,
    ``,
    `Context: ${boardLabel} — ${curriculum} The student is ${gradeStr}. Subject as requested: "${subject}".`,
    ``,
    `RULES:`,
    `- Use the actual, widely-recognized textbook structure. For CBSE use current NCERT TOC. For ICSE use the CISCE-prescribed structure (Selina/Frank-style; note ICSE splits Physics, Chemistry and Biology as SEPARATE subjects from class 9 onwards). For IGCSE use Cambridge International. For JEE/NEET/CLAT/Govt tracks use the standard reference syllabus. For College use standard Indian UG/PG syllabi.`,
    `- Return chapters in TEXTBOOK ORDER with their real, recognizable titles. Do NOT paraphrase, translate, reword, invent, or reorder.`,
    `- SUBJECT-NAME MISMATCH: If the requested subject name isn't exactly how this board labels the subject at this class level (different bundling or naming), STILL return the real chapter list for the closest matching real subject grouping this board uses at this class. Do NOT return an empty list because of a naming mismatch — always resolve to the nearest real subject.`,
    `- If genuinely uncertain of exact count/titles, return a conservative best-effort list — do NOT pad with invented chapters.`,
    `- Never return zero chapters unless the combo is truly nonsensical (e.g. "class 3 Judiciary").`,
    `- Use the list_chapters tool ONLY. No prose.`,
  ].join("\n");

  const tool = {
    name: "list_chapters",
    description: "Return the standard textbook chapter list for the given board/class/subject.",
    input_schema: {
      type: "object",
      properties: {
        chapters: {
          type: "array",
          minItems: 1,
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              chapter_number: { type: "integer", minimum: 1 },
              chapter_title: { type: "string", minLength: 2, maxLength: 200 },
            },
            required: ["chapter_number", "chapter_title"],
          },
        },
      },
      required: ["chapters"],
    },
  };

  const userMsg = `List the standard chapters (real textbook TOC, in order) for:\n- Board: ${boardLabel}\n- Class/Level: ${classLevel}\n- Subject: ${subject}\n\nReturn via the list_chapters tool. If "${subject}" is not exactly how ${boardLabel} labels it at class ${classLevel}, resolve to the closest real subject grouping this board uses and return THOSE chapters — never return an empty list for a naming mismatch.`;

  const res = await callClaude({
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [tool],
    toolChoice: { type: "tool", name: "list_chapters" },
    maxTokens: 2000,
    timeoutMs: 45000,
  });

  if (!res.ok) {
    console.warn(`study-chapters: callClaude failed board=${board} class=${classLevel} subject="${subject}" reason=${res.reason}`);
    await logDebug({ source: "callClaude_failed", reason: res.reason, http_reason: res.reason });
    return json(200, {
      source: "unavailable",
      chapters: [],
      reason: res.reason,
      debug: { httpReason: res.reason, stopReason: null, blocksSnippet: null },
    });
  }

  const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
  const toolUse = blocks.find((b: { type?: string }) => b?.type === "tool_use");
  const input = toolUse?.input;
  const rawList = input && typeof input === "object" ? (input as { chapters?: unknown }).chapters : null;
  const stopReason = (res.data as { stop_reason?: string })?.stop_reason ?? null;
  const blocksSnippet = JSON.stringify(blocks).slice(0, 300);
  if (!Array.isArray(rawList) || rawList.length === 0) {
    console.warn(`study-chapters: empty tool_use board=${board} class=${classLevel} subject="${subject}" stop=${stopReason ?? "?"} blocks=${blocksSnippet}`);
    return json(200, {
      source: "unavailable",
      chapters: [],
      reason: "no chapters returned",
      debug: { httpReason: null, stopReason, blocksSnippet },
    });
  }

  const cleaned: ChapterRow[] = [];
  const seenNums = new Set<number>();
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const n = Number((item as { chapter_number?: unknown }).chapter_number);
    const t = String((item as { chapter_title?: unknown }).chapter_title ?? "").trim();
    if (!Number.isInteger(n) || n < 1 || n > 100) continue;
    if (!t || t.length < 2 || t.length > 200) continue;
    if (seenNums.has(n)) continue;
    seenNums.add(n);
    cleaned.push({ chapter_number: n, chapter_title: t });
  }
  cleaned.sort((a, b) => a.chapter_number - b.chapter_number);

  if (cleaned.length === 0) {
    return json(200, {
      source: "unavailable",
      chapters: [],
      reason: "no valid chapters after cleaning",
      debug: { httpReason: null, stopReason, blocksSnippet },
    });
  }

  // 3) Persist (one-time cache write). Use upsert on the unique constraint to
  // survive races where two callers generate the same combo concurrently.
  try {
    const rows = cleaned.map((c) => ({
      board,
      class_level: classLevel,
      subject,
      chapter_number: c.chapter_number,
      chapter_title: c.chapter_title,
    }));
    const { error: insErr } = await admin
      .from("chapters")
      .upsert(rows, { onConflict: "board,class_level,subject,chapter_number", ignoreDuplicates: true });
    if (insErr) console.warn("study-chapters: insert error", insErr.message);
  } catch (e) {
    console.warn("study-chapters: insert exception", (e as Error).message);
  }

  return json(200, { source: "generated", chapters: cleaned });
});
