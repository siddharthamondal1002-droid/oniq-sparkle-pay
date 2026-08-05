// Shared Anthropic (Claude) client for ONIQ edge functions.
// Reuses the same secret + model that the ting function already relies on.
// Never throws; always returns a discriminated union.

// Language names the AI can be instructed to answer in.
//
// MIRROR OF src/data/languages.ts — keep them identical. Deno edge functions
// cannot import from src/, so this is a copy by necessity, and
// src/data/__tests__/languages.test.ts fails the build if the two drift.
//
// This map used to hold English plus twelve Indian languages only. Every other
// language Scout offered — Arabic, Spanish, French, Chinese, all of them —
// fell through langInstruction()'s `if (!name) return ""` and produced NO
// instruction, so the model silently answered in English. The picker offered
// languages the AI had never been told to speak, and nothing logged it.
export const SUPPORTED_LANGS: Record<string, string> = {
  as: "Assamese",
  bn: "Bengali",
  brx: "Bodo",
  doi: "Dogri",
  gu: "Gujarati",
  hi: "Hindi",
  kn: "Kannada",
  ks: "Kashmiri",
  kok: "Konkani",
  mai: "Maithili",
  ml: "Malayalam",
  mni: "Manipuri (Meitei)",
  mr: "Marathi",
  ne: "Nepali",
  or: "Odia",
  pa: "Punjabi",
  sa: "Sanskrit",
  sat: "Santali",
  sd: "Sindhi",
  ta: "Tamil",
  te: "Telugu",
  ur: "Urdu",
  en: "English",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ms: "Malay",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  it: "Italian",
  tr: "Turkish",
  id: "Indonesian",
  vi: "Vietnamese",
  th: "Thai",
  fil: "Filipino",
  fa: "Persian (Farsi)",
  he: "Hebrew",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
  el: "Greek",
  sv: "Swedish",
  sw: "Swahili",
  am: "Amharic",
  ha: "Hausa",
  ro: "Romanian",
  cs: "Czech",
  hu: "Hungarian",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
};

export function langInstruction(lang?: string | null): string {
  if (!lang || typeof lang !== "string") return "";
  const code = lang.toLowerCase().trim();
  if (!code || code === "en") return "";
  const name = SUPPORTED_LANGS[code];
  if (!name) return "";
  return `\n\nRespond in ${name}. Use the ${name} script. Keep these UNCHANGED and untranslated: brand names, retailer names, place names, app names, currency symbols, and all numbers/prices. If the user writes in English, still reply in ${name}.`;
}

// ---------- Shared board / class-level framing ----------
// Used by study-tutor, study-quiz, and study-paper-generate so curriculum
// wording never drifts across functions.
export const BOARD_LABEL: Record<string, string> = {
  cbse: "CBSE",
  icse: "ICSE",
  igcse: "IGCSE",
  college: "College",
  jee: "JEE",
  neet: "NEET",
  clat: "CLAT",
  govt_exam: "Govt Exams — General",
  govt_railway: "Railways 🚆",
  govt_banking: "Banking 🏦",
  govt_police: "Police 👮",
  govt_judiciary: "Judiciary ⚖️",
  govt_ssc: "SSC 📝",
  govt_psc: "PSC 🏛️",
  nios: "NIOS 🏫",
  up_board: "UP Board 🗺️",
  bihar_board: "Bihar Board 🗺️",
  rajasthan_board: "Rajasthan Board 🗺️",
  mp_board: "MP Board 🗺️",
  haryana_board: "Haryana Board 🗺️",
  punjab_board: "Punjab Board 🗺️",
  uttarakhand_board: "Uttarakhand Board 🗺️",
  himachal_board: "Himachal Board 🗺️",
  jk_board: "J&K Board 🗺️",
  jharkhand_board: "Jharkhand Board 🗺️",
  chhattisgarh_board: "Chhattisgarh Board 🗺️",
  maharashtra_board: "Maharashtra Board 🗺️",
  tn_board: "Tamil Nadu Board 🗺️",
  kerala_board: "Kerala Board 🗺️",
  wb_board: "West Bengal Board 🗺️",
  gujarat_board: "Gujarat Board 🗺️",
  karnataka_board: "Karnataka Board 🗺️",
  ap_board: "Andhra Pradesh Board 🗺️",
  telangana_board: "Telangana Board 🗺️",
  ib: "IB 🌐",
};

export const BOARD_CURRICULUM: Record<string, string> = {
  cbse: "CBSE (follows NCERT textbooks and syllabus).",
  icse: "ICSE (follows the CISCE syllabus; expect broader English + humanities depth).",
  igcse: "IGCSE (follows Cambridge International; use British spelling and Cambridge-style problem framing).",
  college: "College-level (Indian UG/PG; align with standard Indian university syllabi).",
  jee: "JEE (Joint Entrance Examination) aspirant — NCERT foundation with JEE-level application, multi-concept problem-solving, and speed/accuracy focus.",
  neet: "NEET aspirant — NCERT-based, MCQ exam pattern, precise factual recall alongside conceptual understanding, especially in Biology.",
  clat: "CLAT / law entrance aspirant — legal reasoning through principle-and-fact application, reading comprehension, current affairs awareness, logical and quantitative reasoning at entrance-exam level.",
  govt_exam: "General competitive/government exam aspirant — this covers COMMON foundational ground shared across most Indian competitive exams (general knowledge & current affairs, quantitative aptitude, reasoning, English) at a prelims/tier-1 level. Be explicit when relevant that specific exams (UPSC/SSC/Banking/Railways/State PSCs etc.) have their own detailed official syllabi and specialized paper patterns beyond this general scope — do not claim to replicate any single exam's complete syllabus.",
  govt_railway: "Railway Recruitment (RRB) aspirant — General Awareness, elementary Mathematics, General Intelligence & Reasoning, and General Science, in the pattern of RRB NTPC/Group-D style exams. Specific RRB notifications vary by post and year — this is common foundational prep.",
  govt_banking: "Banking exam (IBPS/SBI PO & Clerk style) aspirant — Quantitative Aptitude, Reasoning Ability, English Language, Banking & General Awareness, and basic Computer Knowledge. Specific bank exams vary in pattern — this is common foundational prep.",
  govt_police: "Police recruitment (Constable/Sub-Inspector style) aspirant — General Knowledge & Current Affairs, Reasoning, Numerical/Quantitative Ability, and General English/Hindi. State police exam patterns vary — this is common foundational prep, not a substitute for physical efficiency tests or state-specific rules.",
  govt_judiciary: "Judicial Services (State Civil Judge exam) aspirant — a LAW GRADUATE-level track: Constitutional Law, Civil Procedure Code (CPC), Criminal Procedure Code (CrPC), IPC/Bharatiya Nyaya Sanhita, Evidence Act, Contract Law, and current legal affairs, at entry-level judiciary depth. Each state's Judicial Service exam (via its High Court/PSC) has its own specific syllabus and pattern — this is common legal foundational prep, not a replication of any one state's official syllabus.",
  govt_ssc: "SSC (CGL/CHSL/MTS style) aspirant — General Awareness, Quantitative Aptitude, English Language & Comprehension, and General Intelligence & Reasoning. Specific SSC tiers/patterns vary by year — this is common foundational prep.",
  govt_psc: "State Public Service Commission (PSC) aspirant — General Studies, current affairs, and reasoning/aptitude at a UPSC-adjacent state civil services level. Each state PSC (and UPSC itself) has its own syllabus, prelims/mains structure, and optional subjects — this is common foundational prep, not a replication of any specific state's official syllabus.",
  nios: "National Institute of Open Schooling — the national open-schooling board, offering Secondary (Class 10) and Senior Secondary (Class 12) via distance/open learning, broadly aligned to NCF and comparable in recognition to CBSE. Content should track standard NCERT-equivalent depth unless the student's specific NIOS subject material genuinely diverges.",
  up_board: "Uttar Pradesh Madhyamik Shiksha Parishad (UPMSP) — state board for Uttar Pradesh, increasingly NCERT-aligned textbooks.",
  bihar_board: "Bihar School Examination Board (BSEB) — largely NCERT-based textbooks.",
  rajasthan_board: "Board of Secondary Education, Rajasthan (RBSE/BSER) — largely NCERT-aligned.",
  mp_board: "Madhya Pradesh Board of Secondary Education (MPBSE) — largely NCERT-aligned.",
  haryana_board: "Board of School Education Haryana (BSEH) — largely NCERT-aligned.",
  punjab_board: "Punjab School Education Board (PSEB) — follows NCERT syllabus.",
  uttarakhand_board: "Uttarakhand Board of School Education (UBSE) — largely NCERT-aligned.",
  himachal_board: "Himachal Pradesh Board of School Education (HPBOSE) — largely NCERT-aligned.",
  jk_board: "Jammu and Kashmir Board of School Education (JKBOSE) — largely NCERT-aligned.",
  jharkhand_board: "Jharkhand Academic Council (JAC) — largely NCERT-aligned.",
  chhattisgarh_board: "Chhattisgarh Board of Secondary Education (CGBSE) — largely NCERT-aligned.",
  maharashtra_board: "Maharashtra State Board of Secondary and Higher Secondary Education (MSBSHSE) — distinct state textbooks (Balbharati); transitioning toward NCERT-aligned pattern from 2025-26.",
  tn_board: "Tamil Nadu State Board (Directorate of Government Examinations) — distinct state textbooks (Tamil Nadu Textbook Corporation), covers both Class 10 (Secondary) and Class 12 (Higher Secondary) under one directorate.",
  kerala_board: "Kerala state board — Class 10 (SSLC) administered by the Kerala Board of Public Examinations/Pareeksha Bhavan, Class 12 by the Directorate of Higher Secondary Education (DHSE). Distinct state textbooks (Kerala SCERT). When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  wb_board: "West Bengal state board — Class 10 (Madhyamik) administered by WBBSE, Class 12 by WBCHSE. Distinct state textbooks. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  gujarat_board: "Gujarat Secondary and Higher Secondary Education Board (GSEB) — distinct state textbooks (GCERT), Gujarati/English medium, NCERT-influenced.",
  karnataka_board: "Karnataka School Examination and Assessment Board (KSEAB) — administers SSLC (Class 10) and 2nd PUC (Class 12), own textbooks, NCERT-influenced.",
  ap_board: "Andhra Pradesh state board — Class 10 (SSC) administered by BSEAP, Class 12 by BIEAP (Board of Intermediate Education). Distinct AP SCERT textbooks. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  telangana_board: "Telangana state board — Class 10 (SSC) administered by BSE Telangana, Class 12 by TSBIE (Board of Intermediate Education). Distinct SCERT textbooks for classes 6-10, NCERT for 11-12. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  ib: "International Baccalaureate — MYP (Middle Years Programme, roughly grades 6-10) and DP (Diploma Programme, grades 11-12). Distinct international curriculum, not NCERT-based. Map the requested class level to the appropriate IB programme content.",
};

export const VALID_CLASS_LEVELS = ["5","6","7","8","9","10","11","12","ug","pg","drop","aspirant"] as const;

export function gradeString(classLevel: string): string {
  if (classLevel === "ug") return "an undergraduate (UG) student";
  if (classLevel === "pg") return "a postgraduate (PG) student";
  if (classLevel === "drop") return "a drop-year aspirant (dedicated entrance-exam prep year)";
  if (classLevel === "aspirant") return "an aspirant preparing for competitive exams (not tied to a school class)";
  return `a class ${classLevel} student`;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mask(k: string | undefined): string {
  if (!k) return "<empty>";
  return `****${k.slice(-4)}`;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 529]);

export type ClaudeMessage = { role: "user" | "assistant"; content: string };

export type CallClaudeOpts = {
  system: string;
  messages: ClaudeMessage[];
  tools?: unknown[];
  toolChoice?: unknown;
  maxTokens?: number;
  timeoutMs?: number;
  // When true, send `system` as a cache_control:ephemeral block so Anthropic
  // caches the system prompt across calls. Only enable on callers whose
  // system prompt genuinely exceeds ~1024 tokens (Claude Sonnet minimum) and
  // gets reused — caching a shorter prompt is silently ignored. The Gemini
  // fallback path ignores this flag (caching is Anthropic-specific).
  cacheSystem?: boolean;
  // Optional Anthropic model override. When absent, defaults to the shared
  // "claude-sonnet-4-6" baseline every existing caller has relied on. The
  // Gemini fallback path ignores this (fallback model is Gemini-specific).
  model?: string;
};

export type CallClaudeResult =
  | { ok: true; data: any }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Gemini fallback — used ONLY when Anthropic returns a specific billing/credit
// exhaustion error (HTTP 400, error.type "invalid_request_error", message
// mentioning "credit balance"). Every other Anthropic failure keeps its
// existing behavior so genuine bugs stay visible.
//
// The fallback translates the request into Gemini's generateContent format
// and translates the response back into Anthropic's shape so every caller
// (ting, smart-scout, study-*, ride-genie, loan-rates, market-ticker, ...)
// keeps working with zero changes.
// ---------------------------------------------------------------------------

const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash";

function isAnthropicBillingExhaustion(status: number, body: any): boolean {
  if (status !== 400) return false;
  const err = body?.error;
  if (!err || typeof err !== "object") return false;
  if (err.type !== "invalid_request_error") return false;
  const msg = typeof err.message === "string" ? err.message : "";
  return /credit balance/i.test(msg);
}

// Anthropic tool → Gemini functionDeclaration. Skips Anthropic-native
// server tools (web_search, computer_use, etc.) which have no Gemini
// equivalent in this bridged path.
function translateToolsToGemini(tools: unknown[] | undefined): {
  tools?: unknown[];
  allowedFunctionNames?: string[];
} {
  if (!Array.isArray(tools) || tools.length === 0) return {};
  const decls: Array<{ name: string; description?: string; parameters?: unknown }> = [];
  for (const t of tools) {
    if (!t || typeof t !== "object") continue;
    const tt = t as Record<string, unknown>;
    // Anthropic-native server tools (e.g. type "web_search_20250305") have no
    // direct Gemini equivalent while also using functionDeclarations. Skip.
    if (typeof tt.type === "string" && tt.type !== "custom") continue;
    if (typeof tt.name !== "string") continue;
    const params = (tt.input_schema ?? tt.parameters) as unknown;
    decls.push({
      name: tt.name,
      description: typeof tt.description === "string" ? tt.description : undefined,
      parameters: sanitizeJsonSchemaForGemini(params),
    });
  }
  if (decls.length === 0) return {};
  return {
    tools: [{ functionDeclarations: decls }],
    allowedFunctionNames: decls.map((d) => d.name),
  };
}

// Gemini rejects some JSON-Schema fields Anthropic accepts. Strip conservatively.
function sanitizeJsonSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchemaForGemini);
  const out: Record<string, unknown> = {};
  const skip = new Set([
    "$schema", "$id", "$ref", "$defs", "definitions",
    "additionalProperties", "additionalItems", "patternProperties",
    "exclusiveMinimum", "exclusiveMaximum",
  ]);
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (skip.has(k)) continue;
    out[k] = sanitizeJsonSchemaForGemini(v);
  }
  return out;
}

function translateToolChoiceToGemini(
  toolChoice: unknown,
  allowedFunctionNames: string[] | undefined,
): unknown | undefined {
  if (!toolChoice || typeof toolChoice !== "object") return undefined;
  const tc = toolChoice as Record<string, unknown>;
  const type = typeof tc.type === "string" ? tc.type : "";
  if (type === "any") {
    return { functionCallingConfig: { mode: "ANY", allowedFunctionNames } };
  }
  if (type === "tool" && typeof tc.name === "string") {
    return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tc.name] } };
  }
  if (type === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  return { functionCallingConfig: { mode: "AUTO" } };
}

function translateMessagesToGemini(msgs: ClaudeMessage[]): unknown[] {
  return msgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// Gemini candidates → Anthropic-shaped response body.
function translateGeminiResponseToAnthropic(gem: any): any {
  const cand = Array.isArray(gem?.candidates) ? gem.candidates[0] : null;
  const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  const content: any[] = [];
  let sawToolUse = false;
  for (const p of parts) {
    if (p && typeof p === "object" && p.functionCall && typeof p.functionCall.name === "string") {
      sawToolUse = true;
      content.push({
        type: "tool_use",
        id: `toolu_gemini_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
        name: p.functionCall.name,
        input: (p.functionCall.args && typeof p.functionCall.args === "object") ? p.functionCall.args : {},
      });
    } else if (p && typeof p.text === "string" && p.text.length > 0) {
      content.push({ type: "text", text: p.text });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const finish = typeof cand?.finishReason === "string" ? cand.finishReason : "";
  let stop_reason: string;
  if (sawToolUse) stop_reason = "tool_use";
  else if (finish === "MAX_TOKENS") stop_reason = "max_tokens";
  else stop_reason = "end_turn";

  const usage = gem?.usageMetadata ?? {};
  return {
    id: `msg_gemini_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    type: "message",
    role: "assistant",
    model: `gemini-fallback/${GEMINI_FALLBACK_MODEL}`,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

export async function callGemini(
  opts: CallClaudeOpts,
): Promise<CallClaudeResult> {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.warn("callGemini: GOOGLE_AI_API_KEY not set");
    return { ok: false, reason: "gemini not configured" };
  }

  const { tools, allowedFunctionNames } = translateToolsToGemini(opts.tools);
  const toolConfig = translateToolChoiceToGemini(opts.toolChoice, allowedFunctionNames);

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: translateMessagesToGemini(opts.messages),
    generationConfig: { maxOutputTokens: opts.maxTokens ?? 1024 },
  };
  if (tools) body.tools = tools;
  if (toolConfig) body.toolConfig = toolConfig;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FALLBACK_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    if (!res.ok || !parsed) {
      console.warn(`callGemini: http ${res.status} body=${text.slice(0, 200)}`);
      return { ok: false, reason: `gemini http ${res.status}` };
    }
    const translated = translateGeminiResponseToAnthropic(parsed);
    console.info(
      `callGemini: ok model=${GEMINI_FALLBACK_MODEL} stop_reason=${translated.stop_reason} blocks=${translated.content.length}`,
    );
    return { ok: true, data: translated };
  } catch (e) {
    const reason = (e as Error)?.name === "AbortError" ? "timeout" : String(e).slice(0, 120);
    console.warn(`callGemini: fetch failed (${reason})`);
    return { ok: false, reason };
  } finally {
    clearTimeout(t);
  }
}

async function callGeminiFallback(
  opts: CallClaudeOpts,
  timeoutMs: number,
): Promise<CallClaudeResult> {
  const r = await callGemini({ ...opts, timeoutMs });
  if (r.ok) {
    console.info("callClaude: fell back to Gemini due to Anthropic billing exhaustion");
    return r;
  }
  return { ok: false, reason: "http 400" };
}

export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    console.warn(`callClaude: missing ANTHROPIC_API_KEY (${mask(key)})`);
    return { ok: false, reason: "not configured" };
  }

  const payload: Record<string, unknown> = {
    model: opts.model ?? "claude-opus-5",
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.cacheSystem
      ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
      : opts.system,
    messages: opts.messages,
  };
  if (opts.tools) payload.tools = opts.tools;
  if (opts.toolChoice) payload.tool_choice = opts.toolChoice;

  const timeoutMs = opts.timeoutMs ?? 12000;

  const attempt = async (): Promise<{ status: number; body: any; text?: string } | { error: string }> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text().catch(() => "");
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
      return { status: res.status, body, text };
    } catch (e) {
      return { error: (e as Error)?.name === "AbortError" ? "timeout" : String(e).slice(0, 120) };
    } finally {
      clearTimeout(t);
    }
  };

  let r = await attempt();
  if ("error" in r) {
    console.warn(`callClaude: fetch failed (${r.error}) key=${mask(key)}`);
    // retry once on network/timeout too
    await new Promise((res) => setTimeout(res, 600));
    r = await attempt();
    if ("error" in r) return { ok: false, reason: r.error };
  }
  if ("status" in r && RETRY_STATUSES.has(r.status)) {
    console.warn(`callClaude: http ${r.status} retrying key=${mask(key)}`);
    await new Promise((res) => setTimeout(res, 600));
    r = await attempt();
    if ("error" in r) return { ok: false, reason: r.error };
  }

  if ("status" in r) {
    if (r.status >= 200 && r.status < 300 && r.body) {
      // Log prompt-cache hit/miss when Anthropic reports it. Present only
      // when a cache_control block was sent and the prompt was large enough
      // to be genuinely cached — otherwise these fields are absent and we
      // stay silent.
      const usage = (r.body as { usage?: Record<string, unknown> })?.usage;
      const cw = usage?.cache_creation_input_tokens;
      const cr = usage?.cache_read_input_tokens;
      if (typeof cw === "number" || typeof cr === "number") {
        console.info(
          `callClaude: prompt-cache usage cache_creation=${cw ?? 0} cache_read=${cr ?? 0} input=${usage?.input_tokens ?? 0} output=${usage?.output_tokens ?? 0}`,
        );
      }
      return { ok: true, data: r.body };
    }
    // Specific, detectable billing-exhaustion → Gemini fallback.
    if (isAnthropicBillingExhaustion(r.status, r.body)) {
      console.warn(
        `callClaude: Anthropic billing exhausted (http 400 credit_balance) — falling back to Gemini key=${mask(key)}`,
      );
      const fb = await callGeminiFallback(opts, timeoutMs);
      if (fb.ok) return fb;
      // Fallback itself failed — surface the original Anthropic failure shape.
      return { ok: false, reason: `http ${r.status}` };
    }
    const snippet = (r.text ?? "").slice(0, 200);
    console.warn(`callClaude: http ${r.status} key=${mask(key)} body=${snippet}`);
    return { ok: false, reason: `http ${r.status}` };
  }
  return { ok: false, reason: "unknown" };
}
