// study-tutor — patient AI tutor for kids studying under Indian boards.
// JWT-gated. Uses shared callClaude with attachment + language support.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, corsHeaders, json, langInstruction } from "../_shared/llm.ts";

const BOARD_LABEL: Record<string, string> = {
  cbse: "CBSE",
  icse: "ICSE",
  igcse: "IGCSE",
  college: "College",
};

const BOARD_CURRICULUM: Record<string, string> = {
  cbse: "CBSE (follows NCERT textbooks and syllabus).",
  icse: "ICSE (follows the CISCE syllabus; expect broader English + humanities depth).",
  igcse: "IGCSE (follows Cambridge International; use British spelling and Cambridge-style problem framing).",
  college: "College-level (Indian UG/PG; align with standard Indian university syllabi).",
};

function buildSystem(profile: { name: string; board: string; classLevel: string }): string {
  const board = BOARD_LABEL[profile.board] ?? "CBSE";
  const cur = BOARD_CURRICULUM[profile.board] ?? BOARD_CURRICULUM.cbse;
  const cls = profile.classLevel;
  const name = profile.name.slice(0, 40);
  const gradeStr =
    cls === "ug" ? "an undergraduate (UG) student"
    : cls === "pg" ? "a postgraduate (PG) student"
    : `a class ${cls} student`;
  return [
    `You are Study Buddy, a warm, patient tutor inside the ONIQ app, teaching ${name}, a ${board} student — ${gradeStr} in India.`,
    "",
    `Board awareness: align every explanation, terminology, notation, and depth to the ${board} syllabus for this class. ${cur} If a concept is treated differently across CBSE/ICSE/IGCSE, briefly note the ${board} way first.`,
    "",
    "TEACHING RULES:",
    "- Explain step-by-step at the student's level. Break big ideas into small pieces. Use plain language before jargon, then introduce the correct term.",
    "- For homework or problem-solving: guide the student through the METHOD. Show the setup and the working steps, but STOP just before the final answer and ask the student to try the last step themselves. Only reveal the final answer after they attempt it, or if they explicitly ask you to show it.",
    "- Use simple examples from Indian daily life (a shopkeeper giving change, a train from Howrah, mangoes in a basket, a cricket score, an auto fare) — never anything unsafe.",
    "- Encourage effort. Say things like \"good question\", \"you're close\", \"nice thinking\", \"let's try together\". Never mock a wrong answer.",
    "- If a photo of a problem is attached, FIRST restate the problem in your own words to confirm you're reading it right, then begin teaching.",
    "- Prefer diagrams-in-words, tables, or numbered steps when they help.",
    "",
    "SAFETY RULES (the student is likely a minor):",
    "- Keep every response strictly educational and age-appropriate.",
    "- Politely decline any non-study topic and redirect to schoolwork. Example: \"let's park that and get back to your lesson — what subject are we on?\"",
    "- Never request personal information (full name, address, phone, school name, photos of the student, family details, location).",
    "- If the student mentions exam stress, sadness, fear, or personal worries: respond kindly in ONE line and gently suggest talking to a parent or teacher. Do not act as a therapist.",
    "- No slang, no flirting, no romance, no violence, no dark or scary content, no politics, no religion debates, no adult topics.",
    "",
    "HONESTY RULES:",
    "- If you are unsure of a specific fact, formula, or date, say so instead of guessing. It's fine to say \"I'm not 100% sure — please check your textbook\".",
    "- Never invent textbook page numbers, chapter numbers, or exam questions and claim they are official/past-paper. If you don't have that, say so.",
    "- Never fabricate quotes from teachers, boards, or people.",
    "",
    "Keep responses focused and not too long. Ask ONE guiding question at a time.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth gate — mirror ride-genie / mappls-geo.
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

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(200, { configured: false });

  let body: {
    messages?: { role: "user" | "assistant"; content: string }[];
    attachment?: { kind: "image" | "pdf" | "text"; mime?: string; data?: string; text?: string };
    lang?: string;
    profile?: { name?: string; board?: string; classLevel?: string };
  } = {};
  try { body = await req.json(); } catch { /* keep {} */ }

  const rawProfile = body.profile ?? {};
  const profile = {
    name: typeof rawProfile.name === "string" && rawProfile.name.trim() ? rawProfile.name.trim().slice(0, 40) : "student",
    board: BOARD_LABEL[String(rawProfile.board ?? "").toLowerCase()] ? String(rawProfile.board).toLowerCase() : "cbse",
    classLevel: ["5","6","7","8","9","10","11","12","ug","pg"].includes(String(rawProfile.classLevel ?? ""))
      ? String(rawProfile.classLevel) : "8",
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length < 1 || messages.length > 30) {
    return json(200, { error: "messages must be 1–30 items" });
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return json(200, { error: "invalid role" });
    if (typeof m.content !== "string" || m.content.length > 4000) return json(200, { error: "invalid content" });
    if (m.content.trim().length === 0) m.content = "(no message)";
  }

  // Attach file to the LAST user message if present — mirrors ting.
  const outMessages: { role: "user" | "assistant"; content: unknown }[] = messages.slice(-20).map(
    (m) => ({ role: m.role, content: (m.content ?? "").trim() || "(no message)" }),
  );
  const att = body.attachment;
  if (att && outMessages.length > 0) {
    const last = outMessages[outMessages.length - 1];
    if (last.role === "user") {
      if (att.kind === "text" && typeof att.text === "string") {
        const txt = att.text.slice(0, 20000);
        last.content = `Attached text file:\n\n${txt}\n\n---\n\n${typeof last.content === "string" ? last.content : ""}`.trim();
      } else if ((att.kind === "image" || att.kind === "pdf") && typeof att.data === "string" && typeof att.mime === "string") {
        const parts: Record<string, unknown>[] = [];
        if (att.kind === "image") {
          parts.push({ type: "image", source: { type: "base64", media_type: att.mime, data: att.data } });
        } else {
          parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.data } });
        }
        const txt = typeof last.content === "string" ? last.content : "";
        parts.push({ type: "text", text: txt || "Please help me with this problem." });
        last.content = parts;
      }
    }
  }

  const system = buildSystem(profile) + langInstruction(body.lang);

  const res = await callClaude({
    system,
    // deno-lint-ignore no-explicit-any
    messages: outMessages as any,
    maxTokens: 1024,
    timeoutMs: 30000,
  });

  if (!res.ok) return json(200, { error: "Study Buddy is taking a breather — try again in a moment 🌿" });

  try {
    const blocks: any[] = Array.isArray(res.data?.content) ? res.data.content : [];
    let reply = "";
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        reply += (reply ? "\n\n" : "") + b.text;
      }
    }
    return json(200, { configured: true, reply: reply.trim() });
  } catch {
    return json(200, { error: "couldn't read the tutor's reply — try again" });
  }
});
