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

/**
 * One turn of a conversation.
 *
 * `content` IS NOT ALWAYS A STRING, and typing it as one is what caused a
 * production outage. Anthropic accepts either a plain string or an array of
 * content blocks — `[{ type: "image", source: {...} }, { type: "text", text }]`
 * — and two callers genuinely send the array form: study-paper-grade when a
 * student photographs a handwritten answer, and study-tutor when a message
 * carries an image or PDF attachment. Both had to write `as any` at the call
 * site to get past this type, which is exactly the signal that the type was
 * wrong rather than the callers.
 *
 * The declared string then hid the bug from tsc, and the array reached Gemini's
 * `parts[].text` verbatim: `Unknown name "text" at 'contents[0].parts[0]':
 * Proto field is not repeating, cannot start list.` Anything crossing to Gemini
 * must go through normalizeGeminiText().
 */
export type ClaudeMessage = { role: "user" | "assistant"; content: string | unknown[] };

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
  /**
   * `reason` is what callers pattern-match on and must stay stable.
   * `fallbackReason` is why the GEMINI fallback failed, when one ran — kept
   * separate precisely so it cannot disturb that matching. Absent when no
   * fallback was attempted.
   */
  | { ok: false; reason: string; fallbackReason?: string };

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

/**
 * The fallback model. PINNED, and verified by POST rather than by ListModels.
 *
 * THIS WAS `gemini-2.5-flash` AND IT HAD NEVER WORKED ON THIS KEY. Every call
 * through here returned:
 *
 *   404 "This model models/gemini-2.5-flash is no longer available to new
 *        users. Please update your code to use a newer model."
 *
 * So the fallback was dead on arrival for every caller — Ting included. Any
 * time Anthropic was unavailable, Ting had no second engine at all; it just
 * failed. Nobody noticed because the fallback only runs during an outage, which
 * is exactly when nobody is reading logs.
 *
 * LISTMODELS CANNOT VALIDATE A NAME. `gemini-2.5-flash` is still in the
 * ListModels output for this key, with `generateContent` in its
 * supportedGenerationMethods — ListModels returns the global catalogue, not
 * what a given key is permitted to call. The 2.x text line is retired for keys
 * issued after the cutoff, and this key is one of them. Only a POST tells the
 * truth. Measured on this key, same body shape as below:
 *
 *   gemini-2.5-flash        404  no longer available to new users
 *   gemini-2.5-flash-lite   404  no longer available to new users
 *   gemini-2.5-pro          404  no longer available to new users
 *   gemini-2.0-flash        404  fully retired
 *   gemini-3.6-flash        200
 *   gemini-3.5-flash        200
 *   gemini-3-flash-preview  200
 *   gemini-flash-latest     200
 *
 * The image and TTS variants were never affected, which is why story-still and
 * story-voice kept working on this same key while the text model 404'd — and
 * why "the Gemini key is fine" looked true for months.
 *
 * NOT `gemini-flash-latest`, though it works. A moving alias under a fallback
 * is the worst place for one: it changes silently, and the only time anyone
 * finds out is mid-outage, when the primary is already down.
 */
/**
 * Extra output tokens allowed on Gemini to cover thinking.
 *
 * Not a guess at how much a model thinks — a floor generous enough that a
 * forced tool call is not truncated before it is emitted. Costs nothing when
 * unused.
 */
export const GEMINI_THINKING_HEADROOM_TOKENS = 4096;

const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";

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

/**
 * Anything a caller may put in `content`, flattened to a Gemini-safe string.
 *
 * GEMINI'S `parts[].text` IS A SCALAR PROTO FIELD. Handing it an array is not a
 * type coercion Google forgives — it is HTTP 400, "Proto field is not
 * repeating, cannot start list", and it took down every Gemini fallback for
 * attachment-bearing requests.
 *
 * WHAT IT KEEPS AND WHAT IT DROPS. Text blocks are extracted and joined; image
 * and document blocks are dropped, because Gemini's inlineData is a different
 * shape from Anthropic's `source.base64` and inventing a translation here would
 * be guessing at a format on a path that only runs when Anthropic is already
 * failing. Dropping the image is lossy and it is the honest lossy: the model
 * answers the text it can see instead of the whole request 400ing. The prompt
 * text that accompanies an attachment is precisely what used to be lost.
 *
 * EXPORTED FOR ITS TESTS. It is pure — no clock, no network, no env — so the
 * regression suite can assert the one property that matters directly.
 */
export function normalizeGeminiText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
        // An image, a document, a tool_use — no text to carry over.
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // null and undefined become empty rather than the strings "null"/"undefined",
  // which would otherwise be fed to a model as if a user had typed them.
  if (content == null) return "";

  return String(content);
}

/** A Gemini part: either text, or an inline base64 blob. */
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * One message's content as Gemini parts — ATTACHMENTS INCLUDED.
 *
 * THIS EXISTS BECAUSE DROPPING THE IMAGE WAS NOT ACTUALLY HONEST. The first
 * version of this bridge flattened content to text and discarded image and
 * document blocks, on the reasoning that a chat answer to the surviving text
 * beats a 400. That reasoning does not survive contact with what actually
 * sends attachments:
 *
 *   study-paper-grade  a photograph of a student's handwritten answer, with
 *                      the prompt "the answer is in the attached photo, read
 *                      it carefully, then grade". Dropping the photo does not
 *                      degrade the grade — it produces a MARK FOR WORK THE
 *                      MODEL NEVER SAW.
 *   study-tutor        a homework photo or PDF the question refers to.
 *   health-scan        a medical report to summarise in plain language.
 *
 * In every one of those, an answer without the attachment is not a lesser
 * answer, it is a fabricated one. So the blob crosses properly: Anthropic's
 * `{type:"image"|"document", source:{type:"base64", media_type, data}}` becomes
 * Gemini's `{inlineData:{mimeType, data}}`, which is the same bytes in the
 * other provider's spelling.
 *
 * WHAT STILL CANNOT CROSS is counted rather than ignored — a URL-sourced image
 * has no inline equivalent here — so a caller can refuse instead of answering
 * blind. Silence is what caused this.
 */
/**
 * What Gemini will actually accept as inlineData.
 *
 * NOT THE SAME SET AS ANTHROPIC, which is the trap. Both Ting and Study offer
 * `image/gif` in their file pickers and Anthropic takes it happily; Gemini does
 * not accept GIF at all. Sending one across would have turned a working
 * Anthropic request into a hard Gemini 400 — the fallback failing on exactly
 * the request that needed it. An unsupported type is treated as uncrossable
 * rather than posted and rejected.
 */
const GEMINI_INLINE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

export function geminiPartsFor(content: unknown): { parts: GeminiPart[]; dropped: number } {
  if (typeof content === "string") return { parts: [{ text: content }], dropped: 0 };
  if (content == null) return { parts: [{ text: "" }], dropped: 0 };
  if (!Array.isArray(content)) return { parts: [{ text: String(content) }], dropped: 0 };

  const parts: GeminiPart[] = [];
  let dropped = 0;
  const text: string[] = [];

  for (const block of content) {
    if (typeof block === "string") {
      if (block) text.push(block);
      continue;
    }
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;

    if (typeof b.text === "string") {
      if (b.text) text.push(b.text);
      continue;
    }

    if (b.type === "image" || b.type === "document") {
      const src = (b.source ?? {}) as Record<string, unknown>;
      if (
        src.type === "base64" &&
        typeof src.media_type === "string" &&
        GEMINI_INLINE_MIME.has(src.media_type) &&
        typeof src.data === "string" &&
        src.data.length > 0
      ) {
        parts.push({ inlineData: { mimeType: src.media_type, data: src.data } });
      } else {
        // A URL source, or a shape we do not recognise. It cannot be inlined,
        // and pretending it was is how a model ends up grading a blank page.
        dropped++;
      }
      continue;
    }
    // tool_use, tool_result and anything else: no text, nothing to carry.
  }

  // Text last, matching how the Anthropic callers order their blocks: the
  // instruction refers to the attachment above it.
  if (text.length > 0 || parts.length === 0) parts.push({ text: text.join("\n") });
  return { parts, dropped };
}

/**
 * Exported for tests; the shape Gemini's `contents` expects, plus a count of
 * attachments that could NOT be carried across.
 *
 * The count is returned rather than merely logged because callGemini refuses on
 * it. Every function in this codebase that sends an attachment sends it because
 * the question is ABOUT the attachment — grade this photo, summarise this
 * report, what is this product. An answer produced without it is not a degraded
 * answer, it is a confident answer to a question the model was never shown.
 */
export function translateMessagesToGemini(msgs: ClaudeMessage[]): {
  contents: unknown[];
  dropped: number;
} {
  let dropped = 0;
  const contents = msgs.map((m) => {
    const r = geminiPartsFor(m.content);
    dropped += r.dropped;
    return { role: m.role === "assistant" ? "model" : "user", parts: r.parts };
  });
  return { contents, dropped };
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

  // ATTACHMENTS ARE LOAD-BEARING, SO A LOST ONE IS A REFUSAL. Every caller
  // that sends one is asking a question about it. Answering anyway would mean
  // grading a photo we did not send, or summarising a report we did not send —
  // the failure mode this whole bridge was rewritten to prevent.
  const translated = translateMessagesToGemini(opts.messages);
  if (translated.dropped > 0) {
    console.warn(
      `callGemini: refusing — ${translated.dropped} attachment(s) cannot cross to Gemini`,
    );
    return { ok: false, reason: "attachment-untranslatable" };
  }

  const body: Record<string, unknown> = {
    // Same scalar proto field as parts[].text, so the same normalisation. For
    // the string every caller actually passes this is the identity function;
    // it is here so a future caller that hands over blocks fails soft rather
    // than 400ing the whole request.
    systemInstruction: { parts: [{ text: normalizeGeminiText(opts.system) }] },
    contents: translated.contents,
    // THE CALLER'S TOKEN BUDGET DOES NOT MEAN THE SAME THING ON GEMINI.
    //
    // Anthropic's max_tokens bounds the ANSWER. Gemini 3.x models think by
    // default and their thoughts are drawn from maxOutputTokens as well —
    // this file already says so about billing ("THINKING TOKENS ARE BILLED AS
    // OUTPUT", in the usage translation below) and then passed the Anthropic
    // number straight through anyway.
    //
    // The consequence is not a smaller answer, it is NO answer: the response
    // finishes at MAX_TOKENS having spent the budget on thoughts, carrying no
    // functionCall at all. A forced-tool caller then sees an empty payload.
    // study-paper-generate reports exactly that — "mcq: no items", on every
    // one of its three attempts, for a section whose budget is 1,800 tokens.
    //
    // Headroom rather than a thinkingConfig, deliberately: the thinking knob
    // is spelled differently across Gemini generations (thinkingBudget on 2.5,
    // thinkingLevel on 3.x) and sending the wrong one is a 400 on the fallback
    // path, which is the worst place to be clever. Unused headroom is free —
    // Google bills tokens produced, not tokens allowed — and settlement reads
    // actual usage via geminiOutputTokens.
    generationConfig: {
      maxOutputTokens: (opts.maxTokens ?? 1024) + GEMINI_THINKING_HEADROOM_TOKENS,
    },
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

    // A FORCED TOOL CALL THAT DID NOT ARRIVE IS A FAILURE, NOT AN ANSWER.
    //
    // When the caller sets toolChoice {type:"tool"|"any"} it is not asking for
    // prose, it is asking for a structured payload it will parse. Returning
    // ok:true with a text block leaves the caller to discover the emptiness
    // itself and describe it in its own words — study-paper-generate says
    // "mcq: no items", which names the symptom and hides the cause. Naming it
    // here puts the real reason on the caller's screen: it is now the only
    // channel that works, the log pipeline having gone quiet.
    // Conditioned on WHAT WAS ACTUALLY SENT rather than on caller intent:
    // `body.toolConfig` is present only when a function tool really went out,
    // which is the same test in every version of this file regardless of how
    // search tools are wired above it.
    const choiceType = (opts.toolChoice as { type?: unknown } | undefined)?.type;
    const forcedTool = !!body.toolConfig && (choiceType === "tool" || choiceType === "any");
    if (forcedTool && !translated.content.some((b: { type?: string }) => b?.type === "tool_use")) {
      const finish =
        (Array.isArray(parsed?.candidates) ? parsed.candidates[0]?.finishReason : "") || "unknown";
      console.warn(`callGemini: forced tool produced no functionCall (finish=${finish})`);
      // MAX_TOKENS here is the thinking-budget failure the headroom above is
      // meant to prevent; anything else is a genuinely different problem and
      // deserves to be told apart from it.
      return { ok: false, reason: `gemini-no-tool-call finish=${finish}` };
    }

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

  // THE FALLBACK'S OWN FAILURE USED TO BE INVISIBLE. This returned a bare
  // "http 400" — the Anthropic status — no matter why Gemini failed, so a
  // timeout, an ungrounded refusal, a missing key and a real Gemini 400 all
  // arrived at the caller as the same four characters. smart-scout maps
  // /http 400/ to "AI credits exhausted — top up to keep scouting", which
  // means a user was told to spend money to fix a problem topping up may not
  // fix. Observed 2026-09-01, on a day the log pipeline was also returning no
  // rows, so this string was the only account of what happened.
  //
  // `reason` IS DELIBERATELY UNCHANGED, byte for byte. Every caller
  // pattern-matches it — smart-scout and hotel-scout test /timeout/i BEFORE
  // /http 400/ — so folding the Gemini reason into it would silently reroute
  // a credit-exhaustion message to "try a more specific query" whenever Gemini
  // happened to time out. The detail goes in its own field, where it can be
  // read without changing a single existing branch.
  console.warn(`callClaude: Gemini fallback failed (${r.reason}) after Anthropic http 400`);
  return { ok: false, reason: "http 400", fallbackReason: r.reason };
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
