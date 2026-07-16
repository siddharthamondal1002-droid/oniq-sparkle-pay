// study-tutor — patient AI tutor for kids studying under Indian boards.
// JWT-gated. Uses shared callClaude with attachment + language support.
// Phase 2: ONIQ Study Vault — read via FTS before answering, write distilled
// original notes after answering. All vault ops are best-effort; any failure
// falls back to today's exact tutoring behaviour.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { BOARD_CURRICULUM, BOARD_LABEL, VALID_CLASS_LEVELS, callClaude, corsHeaders, gradeString, json, langInstruction } from "../_shared/llm.ts";

function buildSystem(profile: { name: string; board: string; classLevel: string }): string {
  const board = BOARD_LABEL[profile.board] ?? "CBSE";
  const cur = BOARD_CURRICULUM[profile.board] ?? BOARD_CURRICULUM.cbse;
  const name = profile.name.slice(0, 40);
  const gradeStr = gradeString(profile.classLevel);
  return [
    `You are Study Buddy, a warm, patient tutor inside the ONIQ app, teaching ${name}, a ${board} student — ${gradeStr} in India.`,
    "",
    `Curriculum context: ${cur} Align every explanation, terminology, notation, and depth to this context. If a concept is treated differently across boards/exams, briefly note the ${board} way first.`,
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

type VaultNote = { subject: string; topic: string; content: string };

// Extract latest user query text for FTS (ignore placeholder-only messages).
function latestUserQuery(messages: { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = (m.content ?? "").trim();
    if (!t) continue;
    if (t === "(no message)") continue;
    if (/^\(shared a (pdf|text file|image)\)$/i.test(t)) continue;
    return t.slice(0, 500);
  }
  return "";
}

async function vaultLookup(
  admin: ReturnType<typeof createClient>,
  board: string,
  classLevel: string,
  query: string,
): Promise<VaultNote[]> {
  if (!query || query.length < 3) return [];
  try {
    const { data, error } = await admin.rpc("__noop_never_called__" as never).then(
      () => ({ data: null, error: null }),
      () => ({ data: null, error: null }),
    ).catch(() => ({ data: null, error: null }));
    void data; void error;
    // Use textSearch on generated tsvector column
    const { data: rows, error: err } = await admin
      .from("study_notes")
      .select("subject, topic, content")
      .eq("board", board)
      .eq("class_level", classLevel)
      .textSearch("search", query, { type: "websearch", config: "english" })
      .limit(3);
    if (err) {
      console.warn("vaultLookup: query error", err.message);
      return [];
    }
    return ((rows ?? []) as VaultNote[]).map((r) => ({
      subject: String(r.subject ?? ""),
      topic: String(r.topic ?? ""),
      content: String(r.content ?? "").slice(0, 1500),
    }));
  } catch (e) {
    console.warn("vaultLookup: exception", (e as Error).message);
    return [];
  }
}

function vaultSystemAppendix(notes: VaultNote[]): string {
  if (!notes.length) return "";
  const body = notes.map((n) => `### ${n.subject} — ${n.topic}\n${n.content}`).join("\n\n");
  return `\n\nONIQ STUDY VAULT — reviewed notes from earlier lessons for this class. Prefer these for consistency and say 'from your ONIQ study notes 📚' when you draw on them:\n\n${body}`;
}

// Fire-and-forget: distill the just-taught lesson into an original note.
async function saveDistilledNote(
  admin: ReturnType<typeof createClient>,
  profile: { board: string; classLevel: string },
  userQuery: string,
  assistantReply: string,
): Promise<void> {
  try {
    const boardLabel = BOARD_LABEL[profile.board] ?? "CBSE";
    const level =
      profile.classLevel === "ug" ? "UG"
      : profile.classLevel === "pg" ? "PG"
      : profile.classLevel;
    const system = `Distill the lesson just given into a reusable study note for ${boardLabel} class ${level}. The note must be ORIGINAL: your own explanation in your own words. Never reproduce textbook text, never invent official references (page numbers, chapter numbers, past-paper citations), never include any personal details or names of the student. Include: a crisp definition, method or key steps, and one short worked example. Keep it compact (under ~350 words). Return via the save_study_note tool ONLY.`;

    const tool = {
      name: "save_study_note",
      description: "Save an original, reusable study note distilled from the lesson.",
      input_schema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Subject e.g. Maths, Physics, English" },
          topic: { type: "string", description: "Short topic, 3–8 words" },
          note_markdown: { type: "string", description: "Original study note in markdown" },
        },
        required: ["subject", "topic", "note_markdown"],
      },
    };

    const res = await callClaude({
      system,
      messages: [
        {
          role: "user",
          content: `Student asked: ${userQuery.slice(0, 800)}\n\nTutor's answer:\n${assistantReply.slice(0, 4000)}\n\nNow distill this into a reusable study note using the save_study_note tool.`,
        },
      ],
      tools: [tool],
      toolChoice: { type: "tool", name: "save_study_note" },
      maxTokens: 500,
      timeoutMs: 10000,
    });
    if (!res.ok) {
      console.warn("saveDistilledNote: callClaude failed", res.reason);
      return;
    }
    const blocks = Array.isArray(res.data?.content) ? res.data.content : [];
    const toolUse = blocks.find((b: { type?: string }) => b?.type === "tool_use");
    const input = toolUse?.input ?? null;
    if (!input || typeof input !== "object") {
      console.warn("saveDistilledNote: no tool_use block");
      return;
    }
    const subject = String((input as { subject?: unknown }).subject ?? "").trim().slice(0, 80);
    const topic = String((input as { topic?: unknown }).topic ?? "").trim().slice(0, 120);
    const note = String((input as { note_markdown?: unknown }).note_markdown ?? "").trim();
    if (!subject || !topic || note.length < 60) {
      console.warn("saveDistilledNote: invalid fields", { subject, topic, len: note.length });
      return;
    }
    const { error: insErr } = await admin.from("study_notes").insert({
      board: profile.board,
      class_level: profile.classLevel,
      subject,
      topic,
      content: note.slice(0, 8000),
      source: "tutor",
    });
    if (insErr) console.warn("saveDistilledNote: insert error", insErr.message);
  } catch (e) {
    console.warn("saveDistilledNote: exception", (e as Error).message);
  }
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

  // ---- Vault read path (best-effort) ----
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let admin: ReturnType<typeof createClient> | null = null;
  try {
    if (serviceRoleKey && supabaseUrl) {
      admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    }
  } catch (e) {
    console.warn("study-tutor: admin client init failed", (e as Error).message);
    admin = null;
  }

  const userQuery = latestUserQuery(messages);
  let vaultNotes: VaultNote[] = [];
  if (admin && userQuery) {
    vaultNotes = await vaultLookup(admin, profile.board, profile.classLevel, userQuery);
  }

  const system = buildSystem(profile) + vaultSystemAppendix(vaultNotes) + langInstruction(body.lang);

  const res = await callClaude({
    system,
    // deno-lint-ignore no-explicit-any
    messages: outMessages as any,
    maxTokens: 1024,
    timeoutMs: 30000,
  });

  if (!res.ok) return json(200, { error: "Study Buddy is taking a breather — try again in a moment 🌿" });

  try {
    const blocks: unknown[] = Array.isArray(res.data?.content) ? res.data.content : [];
    let reply = "";
    for (const b of blocks) {
      const bb = b as { type?: string; text?: string };
      if (bb?.type === "text" && typeof bb.text === "string") {
        reply += (reply ? "\n\n" : "") + bb.text;
      }
    }
    reply = reply.trim();

    const usedVault = vaultNotes.length > 0;
    const vaultTopics = vaultNotes.map((n) => n.topic);

    // ---- Vault write path (best-effort, non-blocking) ----
    try {
      if (
        admin &&
        !usedVault &&
        userQuery.length > 15 &&
        reply.length > 400
      ) {
        const writePromise = saveDistilledNote(admin, profile, userQuery, reply);
        // deno-lint-ignore no-explicit-any
        const g = globalThis as any;
        if (g?.EdgeRuntime?.waitUntil) {
          g.EdgeRuntime.waitUntil(writePromise);
        } else {
          writePromise.catch((e) => console.warn("saveDistilledNote: unhandled", (e as Error).message));
        }
      }
    } catch (e) {
      console.warn("study-tutor: write-path scheduling failed", (e as Error).message);
    }

    return json(200, { configured: true, reply, usedVault, vaultTopics });
  } catch {
    return json(200, { error: "couldn't read the tutor's reply — try again" });
  }
});
