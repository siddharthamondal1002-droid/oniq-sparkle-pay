import { geminiOutputTokens } from "./searchBudget.ts";
import { TEXT_DIRECT_HEAVY, TEXT_DIRECT_STANDARD } from "./modelRegistry.ts";
import { readGrounding, requireGroundingEvidence, translateSearchTools } from "./geminiSearch.ts";
import {
  captureGatewaySpend,
  settleGatewaySpend,
  tokensFromUsage,
  type GatewayRpc,
} from "./gatewayLedger.ts";

/** What a caller must know to book its own gateway text call. See gatewayLedger.ts. */
export type GatewaySpendBinding = {
  rpc: GatewayRpc | null;
  requestId: string;
  jobId?: string | null;
  attempt?: number | null;
  userId?: string | null;
};

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
  igcse:
    "IGCSE (follows Cambridge International; use British spelling and Cambridge-style problem framing).",
  college: "College-level (Indian UG/PG; align with standard Indian university syllabi).",
  jee: "JEE (Joint Entrance Examination) aspirant — NCERT foundation with JEE-level application, multi-concept problem-solving, and speed/accuracy focus.",
  neet: "NEET aspirant — NCERT-based, MCQ exam pattern, precise factual recall alongside conceptual understanding, especially in Biology.",
  clat: "CLAT / law entrance aspirant — legal reasoning through principle-and-fact application, reading comprehension, current affairs awareness, logical and quantitative reasoning at entrance-exam level.",
  govt_exam:
    "General competitive/government exam aspirant — this covers COMMON foundational ground shared across most Indian competitive exams (general knowledge & current affairs, quantitative aptitude, reasoning, English) at a prelims/tier-1 level. Be explicit when relevant that specific exams (UPSC/SSC/Banking/Railways/State PSCs etc.) have their own detailed official syllabi and specialized paper patterns beyond this general scope — do not claim to replicate any single exam's complete syllabus.",
  govt_railway:
    "Railway Recruitment (RRB) aspirant — General Awareness, elementary Mathematics, General Intelligence & Reasoning, and General Science, in the pattern of RRB NTPC/Group-D style exams. Specific RRB notifications vary by post and year — this is common foundational prep.",
  govt_banking:
    "Banking exam (IBPS/SBI PO & Clerk style) aspirant — Quantitative Aptitude, Reasoning Ability, English Language, Banking & General Awareness, and basic Computer Knowledge. Specific bank exams vary in pattern — this is common foundational prep.",
  govt_police:
    "Police recruitment (Constable/Sub-Inspector style) aspirant — General Knowledge & Current Affairs, Reasoning, Numerical/Quantitative Ability, and General English/Hindi. State police exam patterns vary — this is common foundational prep, not a substitute for physical efficiency tests or state-specific rules.",
  govt_judiciary:
    "Judicial Services (State Civil Judge exam) aspirant — a LAW GRADUATE-level track: Constitutional Law, Civil Procedure Code (CPC), Criminal Procedure Code (CrPC), IPC/Bharatiya Nyaya Sanhita, Evidence Act, Contract Law, and current legal affairs, at entry-level judiciary depth. Each state's Judicial Service exam (via its High Court/PSC) has its own specific syllabus and pattern — this is common legal foundational prep, not a replication of any one state's official syllabus.",
  govt_ssc:
    "SSC (CGL/CHSL/MTS style) aspirant — General Awareness, Quantitative Aptitude, English Language & Comprehension, and General Intelligence & Reasoning. Specific SSC tiers/patterns vary by year — this is common foundational prep.",
  govt_psc:
    "State Public Service Commission (PSC) aspirant — General Studies, current affairs, and reasoning/aptitude at a UPSC-adjacent state civil services level. Each state PSC (and UPSC itself) has its own syllabus, prelims/mains structure, and optional subjects — this is common foundational prep, not a replication of any specific state's official syllabus.",
  nios: "National Institute of Open Schooling — the national open-schooling board, offering Secondary (Class 10) and Senior Secondary (Class 12) via distance/open learning, broadly aligned to NCF and comparable in recognition to CBSE. Content should track standard NCERT-equivalent depth unless the student's specific NIOS subject material genuinely diverges.",
  up_board:
    "Uttar Pradesh Madhyamik Shiksha Parishad (UPMSP) — state board for Uttar Pradesh, increasingly NCERT-aligned textbooks.",
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
  maharashtra_board:
    "Maharashtra State Board of Secondary and Higher Secondary Education (MSBSHSE) — distinct state textbooks (Balbharati); transitioning toward NCERT-aligned pattern from 2025-26.",
  tn_board:
    "Tamil Nadu State Board (Directorate of Government Examinations) — distinct state textbooks (Tamil Nadu Textbook Corporation), covers both Class 10 (Secondary) and Class 12 (Higher Secondary) under one directorate.",
  kerala_board:
    "Kerala state board — Class 10 (SSLC) administered by the Kerala Board of Public Examinations/Pareeksha Bhavan, Class 12 by the Directorate of Higher Secondary Education (DHSE). Distinct state textbooks (Kerala SCERT). When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  wb_board:
    "West Bengal state board — Class 10 (Madhyamik) administered by WBBSE, Class 12 by WBCHSE. Distinct state textbooks. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  gujarat_board:
    "Gujarat Secondary and Higher Secondary Education Board (GSEB) — distinct state textbooks (GCERT), Gujarati/English medium, NCERT-influenced.",
  karnataka_board:
    "Karnataka School Examination and Assessment Board (KSEAB) — administers SSLC (Class 10) and 2nd PUC (Class 12), own textbooks, NCERT-influenced.",
  ap_board:
    "Andhra Pradesh state board — Class 10 (SSC) administered by BSEAP, Class 12 by BIEAP (Board of Intermediate Education). Distinct AP SCERT textbooks. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  telangana_board:
    "Telangana state board — Class 10 (SSC) administered by BSE Telangana, Class 12 by TSBIE (Board of Intermediate Education). Distinct SCERT textbooks for classes 6-10, NCERT for 11-12. When asked for a specific class, use the correctly-administering body's actual syllabus for that class.",
  ib: "International Baccalaureate — MYP (Middle Years Programme, roughly grades 6-10) and DP (Diploma Programme, grades 11-12). Distinct international curriculum, not NCERT-based. Map the requested class level to the appropriate IB programme content.",
};

export const VALID_CLASS_LEVELS = [
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "ug",
  "pg",
  "drop",
  "aspirant",
] as const;

export function gradeString(classLevel: string): string {
  if (classLevel === "ug") return "an undergraduate (UG) student";
  if (classLevel === "pg") return "a postgraduate (PG) student";
  if (classLevel === "drop") return "a drop-year aspirant (dedicated entrance-exam prep year)";
  if (classLevel === "aspirant")
    return "an aspirant preparing for competitive exams (not tied to a school class)";
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
  // Optional Anthropic model override. When absent, defaults to "claude-opus-5"
  // (see callClaude below and modelRegistry TEXT_TOOLS) — the model story-plot
  // and the other no-override callers actually run on. Callers that want the
  // sonnet baseline pass model:"claude-sonnet-4-6" explicitly (translate,
  // health-scan). The Gemini fallback path ignores this flag.
  model?: string;
  // Optional LOVABLE GATEWAY model id, used only by callGatewayText. A THIRD
  // field for a third namespace, for exactly the reason the comment below
  // gives: these opts travel between engines, and one shared `model` would
  // eventually post a Claude id to the gateway. The gateway namespaces its ids
  // by vendor (`google/…`, and per POST verification `openai/…`), so this is
  // also where "OpenAI through Lovable" is named — credits the owner already
  // buys rather than a second metered provider bill. Absent, the TIER decides,
  // which is what every existing caller relies on.
  gatewayModel?: string;
  // Optional GOOGLE model id, used only by callGemini. Deliberately separate
  // from `model`: callGeminiFallback forwards an Anthropic caller's whole opts
  // object to callGemini, so honouring `model` there would post a Claude id to
  // Google. Absent, callGemini uses GEMINI_FALLBACK_MODEL as before.
  geminiModel?: string;
  // Set true when the caller CANNOT accept an answer from model memory — a
  // price scout, a stay scout. callGemini then refuses unless a real search
  // tool made it through translation.
  requireSearch?: boolean;
  // When true, make EXACTLY ONE attempt: skip the built-in retry on a
  // timeout/network error and on a retryable 5xx. Default (undefined) keeps the
  // retry for every existing caller. Set by a caller that owns its own retry
  // orchestration and must not have this layer double its per-attempt budget —
  // story-plot's plan orchestrator (owner P0, 2026-08-21), where a 45s spine
  // silently became a ~90s spine here and starved the fallback engine.
  noRetry?: boolean;
  // Set false to FORBID the Gemini billing-exhaustion fallback. Default
  // (undefined) keeps the fallback for every existing caller.
  //
  // Two reasons a caller turns it off, both of which apply to the search
  // scouts. First, translateToolsToGemini SKIPS Anthropic server tools, so a
  // web_search request silently becomes a no-search request — the model then
  // answers a "find live prices" prompt from memory and fills in
  // `verified: true` source domains that were never consulted. Second, Gemini
  // bills a DIFFERENT key at rates this codebase does not price, so a spend
  // reservation taken against Anthropic rates no longer describes the spend.
  allowFallback?: boolean;
};

// `provider` says which engine actually answered. It exists because the
// fallback used to be invisible to callers: a Gemini answer and an Anthropic
// answer came back in the same shape, and nothing downstream could tell that
// the web_search tool had been dropped on the way.
export type CallClaudeResult =
  | { ok: true; data: any; provider: "anthropic" | "gemini" }
  /**
   * `reason` is what callers pattern-match on and must stay stable.
   * `fallbackReason` is why the GEMINI fallback failed, when one ran — kept
   * separate precisely so it cannot disturb that matching.
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
const GEMINI_FALLBACK_MODEL = "gemini-3.6-flash";

/**
 * Extra output tokens allowed on Gemini to cover thinking.
 *
 * SIZED FROM REPORTED BEHAVIOUR, not from a guess. Google's own trackers
 * (googleapis/python-genai#782, #811) document that on 2.5+ and 3.x:
 *
 *   - thinking is ON by default and thoughts are drawn from maxOutputTokens;
 *   - MAX_TOKENS fires when thoughts + output exceed it;
 *   - when it fires the response comes back EMPTY, so a forced tool call is
 *     not truncated, it is absent entirely;
 *   - thoughts reach ~6k tokens even on simple tasks.
 */
export const GEMINI_THINKING_HEADROOM_TOKENS = 8192;

/**
 * A floor under the Gemini output ceiling, regardless of what the caller asked.
 *
 * TWO REPORTED FAILURES MEET HERE. Thoughts alone can take ~6k, and separately
 * (googleapis/js-genai#1619) Flash models generate LARGE function-call
 * arguments unreliably — MAX_TOKENS with partial output, or
 * MALFORMED_FUNCTION_CALL with nothing exposed. study-paper-generate asks for a
 * whole exam section in a single call: twenty MCQs with four options and an
 * explanation each.
 *
 * A CEILING IS NOT A SPEND. Google bills tokens produced, not tokens allowed,
 * and settlement reads actual usage through geminiOutputTokens — so a generous
 * bound costs nothing and an ungenerous one costs the whole answer.
 *
 * `thinkingConfig: { thinkingBudget: 0 }` is deliberately NOT used instead:
 * python-genai#782 reports it is not reliably honoured — thoughts still arrive
 * — and the knob is spelled differently across generations, so sending the
 * wrong one is a 400 on the fallback path.
 */
export const GEMINI_MIN_OUTPUT_TOKENS = 16384;

/** The output ceiling to send Gemini for a caller that asked for `wanted`. */
export function geminiOutputCeiling(wanted: number | undefined): number {
  const asked = typeof wanted === "number" && wanted > 0 ? wanted : 1024;
  return Math.max(asked + GEMINI_THINKING_HEADROOM_TOKENS, GEMINI_MIN_OUTPUT_TOKENS);
}

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
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "definitions",
    "additionalProperties",
    "additionalItems",
    "patternProperties",
    "exclusiveMinimum",
    "exclusiveMaximum",
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

/** Exported for tests; the shape Gemini's `contents` expects. */
export function translateMessagesToGemini(msgs: ClaudeMessage[]): unknown[] {
  return msgs.map((m) => {
    const { parts, dropped } = geminiPartsFor(m.content);
    if (dropped > 0) {
      console.warn(
        `translateMessagesToGemini: ${dropped} attachment block(s) could not be inlined for Gemini`,
      );
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

/**
 * Gemini candidates → Anthropic-shaped response body.
 *
 * `model` IS THE ID THAT WAS ACTUALLY CALLED, AND TAKING IT AS AN ARGUMENT IS
 * THE WHOLE POINT OF THIS PARAMETER. It used to stamp every reply with the
 * constant `gemini-fallback/${GEMINI_FALLBACK_MODEL}`, which this function
 * could compute without being told anything — because it never saw which model
 * answered. So a reply from the PINNED `gemini-3.1-flash-lite` came back
 * labelled `gemini-fallback/gemini-3.6-flash`: the retired model the September
 * bill blamed for 41.3% of spend, and the one the 2026-09-05 directive pinned
 * every call site away from. The pin was never broken; the label was.
 *
 * Measured 2026-09-11, from an OQCA tap through the deployed engine: 24 calls
 * on `gemini-3.1-flash-lite`, every one reporting `gemini-fallback/…`.
 *
 * IT COST MORE THAN A WRONG STRING, and that is why it is a parameter rather
 * than a corrected constant. Two callers read this field:
 *
 *   engine.ts   prices with it. `MODEL_RATES` carries no `gemini-fallback/*`
 *               entry, so `actualUsd` was null on every successful call and the
 *               ESTIMATE was charged instead — 4.7x the real figure on that
 *               tap ($0.006748 charged against $0.001440 of Google). Safe
 *               direction for a ceiling and wrong for a ledger.
 *   translate-message  writes it into `message_translations.engine`, i.e. into
 *               a column a future bill investigation would read. That table is
 *               empty today; the next one would have been pointed at the
 *               retired model by ONIQ's own records.
 *
 * A constant cannot report a variable. Anything that names who answered has to
 * be handed who answered.
 */
export function translateGeminiResponseToAnthropic(gem: any, model: string): any {
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
        input:
          p.functionCall.args && typeof p.functionCall.args === "object" ? p.functionCall.args : {},
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
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: usage.promptTokenCount ?? 0,
      // THINKING TOKENS ARE BILLED AS OUTPUT. Gemini 2.5 models think by
      // default and report `thoughtsTokenCount`; reading `candidatesTokenCount`
      // alone would settle a Gemini call BELOW what Google charged for it —
      // the under-counting defect this ledger exists to prevent, arriving from
      // the other side.
      //
      // `totalTokenCount - promptTokenCount` is right under either convention:
      // if thoughts sit outside candidates it picks them up, and if they are
      // already inside it equals candidates. The max() keeps candidates as the
      // floor for any response that omits a total.
      output_tokens: geminiOutputTokens(usage),
      // GROUNDED QUERIES ARE A BILLABLE UNIT AND GOOGLE DOES NOT COUNT THEM
      // FOR US. `usageMetadata` carries no search/grounding field at all —
      // verified against a real grounded response on 2026-08-25 — so the
      // count has to come from `webSearchQueries`, which lists the queries the
      // model actually ran. Reported in Anthropic's shape so the existing
      // settlement path prices it with no special case.
      server_tool_use: { web_search_requests: geminiGroundedQueryCount(cand) },
    },
    // NOT an Anthropic field. Anthropic returns its sources as
    // `web_search_tool_result` content blocks; Google returns them in
    // `groundingMetadata`, which has no equivalent here. Callers that must
    // validate a claimed source against a retrieved one need the retrieved
    // set, and dropping it would leave them with nothing to check against.
    _oniqGrounding: readGrounding(cand),
  };
}

/** Grounded queries Google reports running. Each one is separately billed. */
function geminiGroundedQueryCount(candidate: any): number {
  const q = candidate?.groundingMetadata?.webSearchQueries;
  return Array.isArray(q) ? q.length : 0;
}

export async function callGemini(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const geminiModel = opts.geminiModel ?? GEMINI_FALLBACK_MODEL;
  const timeoutMs = opts.timeoutMs ?? 12000;
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.warn("callGemini: GOOGLE_AI_API_KEY not set");
    return { ok: false, reason: "gemini not configured" };
  }

  // SEARCH TOOLS TRANSLATE, THEY DO NOT VANISH. `translateToolsToGemini`
  // below handles function declarations, and it SKIPS every Anthropic server
  // tool — which is how a "find live prices, cite your sources" request used
  // to reach Gemini with no search at all. `translateSearchTools` maps
  // web_search_20250305 onto Google's google_search, and refuses any other
  // server tool rather than dropping it.
  const search = translateSearchTools(opts.tools);
  if (!search.ok) {
    console.warn(`callGemini: refusing — ${search.reason}`);
    return { ok: false, reason: search.reason };
  }
  if (opts.requireSearch && !search.searchRequired) {
    // The fail-closed assertion. A caller that needs live sources must not be
    // answered from the model's memory.
    console.warn("callGemini: refusing — search required but no search tool present");
    return { ok: false, reason: "search-required-without-search-tool" };
  }

  const { tools, allowedFunctionNames } = translateToolsToGemini(opts.tools);
  const toolConfig = translateToolChoiceToGemini(opts.toolChoice, allowedFunctionNames);

  const body: Record<string, unknown> = {
    // Same scalar proto field as parts[].text, so the same normalisation. For
    // the string every caller actually passes this is the identity function;
    // it is here so a future caller that hands over blocks fails soft rather
    // than 400ing the whole request.
    systemInstruction: { parts: [{ text: normalizeGeminiText(opts.system) }] },
    contents: translateMessagesToGemini(opts.messages),
    generationConfig: { maxOutputTokens: geminiOutputCeiling(opts.maxTokens) },
  };
  // Google rejects google_search alongside functionDeclarations, so a request
  // that needs search sends search. ONIQ's scouts send no function tools.
  const merged = [...search.tools, ...(tools ?? [])];
  if (search.searchRequired) body.tools = search.tools;
  else if (merged.length > 0) body.tools = merged;
  if (toolConfig && !search.searchRequired) body.toolConfig = toolConfig;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(key)}`;

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
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep null */
    }
    if (!res.ok || !parsed) {
      console.warn(`callGemini: http ${res.status} body=${text.slice(0, 200)}`);
      return { ok: false, reason: `gemini http ${res.status}` };
    }
    const translated = translateGeminiResponseToAnthropic(parsed, geminiModel);

    // A FORCED TOOL CALL THAT DID NOT ARRIVE IS A FAILURE, NOT AN ANSWER.
    //
    // When the caller sets toolChoice {type:"tool"|"any"} it is not asking for
    // prose, it is asking for a structured payload it will parse. Returning
    // ok:true with a text block left study-paper-generate to discover the
    // emptiness itself and describe it as "mcq: no items" — the symptom, not
    // the cause. Naming it here puts the real reason on the caller's screen,
    // which is currently the only diagnostic channel that works.
    //
    // Conditioned on body.toolConfig — what was ACTUALLY sent — rather than on
    // caller intent, so it behaves the same however tools are wired above it.
    const choiceType = (opts.toolChoice as { type?: unknown } | undefined)?.type;
    const forcedTool = !!body.toolConfig && (choiceType === "tool" || choiceType === "any");
    if (forcedTool && !translated.content.some((b: { type?: string }) => b?.type === "tool_use")) {
      const finish =
        (Array.isArray(parsed?.candidates) ? parsed.candidates[0]?.finishReason : "") || "unknown";
      console.warn(`callGemini: forced tool produced no functionCall (finish=${finish})`);
      // MAX_TOKENS is the thinking-budget failure the ceiling above prevents;
      // MALFORMED_FUNCTION_CALL is js-genai#1619. Both must be tellable apart
      // from each other and from a model simply declining (STOP).
      return { ok: false, reason: `gemini-no-tool-call finish=${finish}` };
    }

    console.info(
      `callGemini: ok model=${geminiModel} stop_reason=${translated.stop_reason} blocks=${translated.content.length}`,
    );
    // FORCED-SEARCH GATE. A caller that needs live sources must not receive an
    // answer the model produced from memory. Measured across 9 real calls on
    // 3 models: only 3 issued any query at all, and 36 of 37 result rows named
    // a source that had never been retrieved. The models skip searching
    // precisely on the commodity items they "know" — most confident exactly
    // where most stale — and fill source_domain regardless.
    if (opts.requireSearch) {
      const candidate = Array.isArray((parsed as any)?.candidates)
        ? (parsed as any).candidates[0]
        : null;
      const evidence = requireGroundingEvidence(candidate);
      if (!evidence.ok) {
        console.warn(
          `callGemini: refusing an ungrounded answer to a search request (${evidence.reason})`,
        );
        return { ok: false, reason: evidence.reason };
      }
    }
    return { ok: true, data: translated, provider: "gemini" };
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
  // "http 400" — Anthropic's status — no matter why Gemini failed, so a
  // timeout, an ungrounded refusal, a missing key and a real Gemini 400 all
  // arrived at the caller as the same four characters. smart-scout maps
  // /http 400/ to "AI credits exhausted — top up to keep scouting", so a user
  // can be told to spend money to fix something topping up may not fix.
  //
  // `reason` IS DELIBERATELY UNCHANGED, byte for byte. Callers pattern-match
  // it, and both scouts test /timeout/i BEFORE /http 400/, so folding the
  // Gemini reason into it would silently reroute a credit-exhaustion message
  // to "try a more specific query" whenever Gemini happened to time out. The
  // detail goes in its own field, where it cannot disturb an existing branch.
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

  const attempt = async (): Promise<
    { status: number; body: any; text?: string } | { error: string }
  > => {
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
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* keep null */
      }
      return { status: res.status, body, text };
    } catch (e) {
      return { error: (e as Error)?.name === "AbortError" ? "timeout" : String(e).slice(0, 120) };
    } finally {
      clearTimeout(t);
    }
  };

  let r = await attempt();
  // noRetry callers own their retry orchestration — one attempt, no doubling.
  if (!opts.noRetry && "error" in r) {
    console.warn(`callClaude: fetch failed (${r.error}) key=${mask(key)}`);
    // retry once on network/timeout too
    await new Promise((res) => setTimeout(res, 600));
    r = await attempt();
    if ("error" in r) return { ok: false, reason: r.error };
  }
  if ("error" in r) return { ok: false, reason: r.error };
  if (!opts.noRetry && "status" in r && RETRY_STATUSES.has(r.status)) {
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
      return { ok: true, data: r.body, provider: "anthropic" };
    }
    // Specific, detectable billing-exhaustion → Gemini fallback.
    if (opts.allowFallback === false && isAnthropicBillingExhaustion(r.status, r.body)) {
      console.warn(
        `callClaude: Anthropic billing exhausted and fallback is forbidden for this caller — failing instead of answering from a tool-less model key=${mask(key)}`,
      );
      return { ok: false, reason: `http ${r.status}` };
    }
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

/* -------------------------------------------------------------------------
 * THE TEXT ROUTER — Gemini serves, Claude catches.
 *
 * OWNER DIRECTIVE, 2026-09-04. Until this date text ran Claude-first with a
 * Gemini fallback that only woke on Anthropic billing exhaustion. The owner
 * mapped ONIQ's features onto Google models, put every one of them on the
 * LOVABLE GATEWAY (credits, not the metered Google key), and — asked directly
 * whether Claude should be kept or removed — chose to SWAP THE FAILOVER
 * DIRECTION rather than delete an engine. So the machinery below is the
 * machinery that was already here, pointing the other way: Gemini answers,
 * and Claude is what catches ONIQ when the credit pool runs dry.
 *
 * WHY A NEW ENTRY POINT AND NOT A REWRITE OF callClaude. `callClaude` calls
 * Claude and `callGemini` calls Google; both names stay true. A function
 * called callClaude that quietly posts to a gateway is the kind of lie this
 * file has been bitten by before. `callText` is the router, and it is the
 * only thing callers should reach for.
 *
 * THE ONE CLASS OF CALLER THAT DOES NOT COME HERE. The gateway's chat
 * endpoint is OpenAI-shaped. It carries no Anthropic server tools and no
 * Google Search grounding — there is no field for either. This file already
 * records what happens when a search-requiring prompt reaches an engine with
 * no search: the model answers "find live prices" from memory and fills in
 * `verified: true` domains it never consulted. So a caller that set
 * `requireSearch`, or that set `allowFallback: false` because it cannot
 * survive losing its tools, is routed to Claude UNCHANGED. Their engine is
 * not the owner's to trade for a cheaper token, because what is at stake is
 * not cost — it is whether ONIQ shows a user a source that does not exist.
 * The owner's "search grounding → Gemini 3" row is a separate integration
 * with its own evidence guards, and it is not this change.
 * ------------------------------------------------------------------------- */

/** OpenAI-compatible chat endpoint on the Lovable gateway. */
const GATEWAY_TEXT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * The two text tiers, POST-verified on the gateway 2026-09-04 before being
 * written here — the rule this file learned the hard way, one comment block
 * up, where a listed model 404'd on every real call for months.
 *
 *   google/gemini-3.1-flash-lite    200  usage {prompt 1, completion 0}
 *   google/gemini-3.1-pro-preview   200
 *
 * The owner named "Gemini 3.1 Pro"; the gateway carries only the -preview id,
 * so preview is what ONIQ can actually call. A preview can be withdrawn
 * without notice — which is a different and smaller risk than a moving alias
 * like `-latest`, whose contents change under you silently.
 */
export const GATEWAY_TEXT_MODEL = "google/gemini-3.1-flash-lite";
export const GATEWAY_TEXT_HEAVY_MODEL = "google/gemini-3.1-pro-preview";

/**
 * Gateway credit exhaustion, and nothing else.
 *
 * The mirror of isAnthropicBillingExhaustion, and deliberately just as narrow.
 * gatewayImage.ts measured this pool's exhaustion signal as 402/429, and the
 * lesson recorded there applies here too: the log has to say "credits", not
 * "the model refused". A 400 or a 500 is a bug to fix, not a bill to dodge,
 * and widening this predicate would hide one behind a silent engine switch.
 */
function isGatewayCreditsExhausted(status: number): boolean {
  return status === 402 || status === 429;
}

/** Anthropic tool shape -> OpenAI function shape. Server tools have no equivalent and are dropped. */
function translateToolsToOpenAI(tools: unknown[] | undefined): {
  tools: unknown[] | undefined;
  droppedServerTools: number;
} {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools: undefined, droppedServerTools: 0 };
  }
  const out: unknown[] = [];
  let droppedServerTools = 0;
  for (const t of tools) {
    const tool = t as {
      name?: unknown;
      description?: unknown;
      input_schema?: unknown;
      type?: unknown;
    };
    // Anthropic server tools (web_search and friends) carry a `type` and are
    // executed by Anthropic, not by us. There is no OpenAI equivalent to send,
    // so they are counted rather than silently discarded — callText refuses
    // the call rather than answering a search prompt without search.
    if (typeof tool?.type === "string" && tool.type.length > 0) {
      droppedServerTools += 1;
      continue;
    }
    if (typeof tool?.name !== "string") continue;
    out.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        parameters: tool.input_schema ?? { type: "object", properties: {} },
      },
    });
  }
  return { tools: out.length > 0 ? out : undefined, droppedServerTools };
}

/** Anthropic messages -> OpenAI messages, with `system` as the leading system turn. */
function translateMessagesToOpenAI(system: string, msgs: ClaudeMessage[]): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of msgs) {
    // normalizeGeminiText already exists to flatten Anthropic's block arrays
    // into plain text; the same flattening is what the OpenAI shape wants.
    out.push({ role: m.role, content: normalizeGeminiText(m.content) });
  }
  return out;
}

/** OpenAI chat response -> the Anthropic shape every caller in this codebase reads. */
function translateOpenAIResponseToAnthropic(oai: any, model: string): any {
  const choice = Array.isArray(oai?.choices) ? oai.choices[0] : null;
  const msg = choice?.message ?? {};
  const content: any[] = [];
  let sawToolUse = false;

  if (typeof msg?.content === "string" && msg.content.length > 0) {
    content.push({ type: "text", text: msg.content });
  }
  for (const call of Array.isArray(msg?.tool_calls) ? msg.tool_calls : []) {
    const fn = call?.function ?? {};
    if (typeof fn?.name !== "string") continue;
    sawToolUse = true;
    let input: unknown = {};
    try {
      input = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : (fn.arguments ?? {});
    } catch {
      // A tool call whose arguments do not parse is a failed tool call, not a
      // call with no arguments — an empty object would look like a valid one.
      input = {};
    }
    content.push({
      type: "tool_use",
      id:
        typeof call?.id === "string"
          ? call.id
          : `toolu_gw_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
      name: fn.name,
      input: input && typeof input === "object" ? input : {},
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : "";
  const stop_reason = sawToolUse ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";

  const usage = oai?.usage ?? {};
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const total = typeof usage.total_tokens === "number" ? usage.total_tokens : 0;
  return {
    id:
      typeof oai?.id === "string"
        ? oai.id
        : `msg_gw_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    type: "message",
    role: "assistant",
    model: `gateway/${model}`,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: prompt,
      // THINKING TOKENS ARE BILLED AS OUTPUT — the same rule the Gemini
      // translator above spells out, arriving through a different field name.
      // `total - prompt` catches reasoning tokens whether or not the gateway
      // folded them into completion_tokens; completion_tokens is the floor for
      // any response that omits a total.
      output_tokens: Math.max(completion, total > prompt ? total - prompt : 0),
      // No search on this path by construction — see the router's header.
      server_tool_use: { web_search_requests: 0 },
    },
  };
}

/** One call to the gateway's chat endpoint, in the Anthropic result shape. */
export async function callGatewayText(
  opts: CallClaudeOpts & {
    tier?: "standard" | "heavy";
    /**
     * CREDIT ACCOUNTING, opt-in and additive. Absent ⇒ nothing is recorded
     * and this function behaves exactly as it did. Present ⇒ the attempt is
     * captured before the request and settled after it, in CREDITS, in
     * `gateway_spend_ledger` — never in dollars and never against a USD cap.
     */
    gatewaySpend?: GatewaySpendBinding;
  },
): Promise<CallClaudeResult & { creditsExhausted?: boolean }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    console.warn(`callGatewayText: missing LOVABLE_API_KEY (${mask(key)})`);
    return { ok: false, reason: "not configured" };
  }

  // An explicit id at the CALL SITE beats a tier, which is the rule
  // `geminiModelPinned` enforces one engine over: a default is not a decision.
  const model =
    opts.gatewayModel ?? (opts.tier === "heavy" ? GATEWAY_TEXT_HEAVY_MODEL : GATEWAY_TEXT_MODEL);
  const { tools, droppedServerTools } = translateToolsToOpenAI(opts.tools);
  if (droppedServerTools > 0) {
    // Belt and braces: callText already refuses to send these callers here.
    console.warn(
      `callGatewayText: ${droppedServerTools} server tool(s) have no OpenAI equivalent — refusing rather than answering without them`,
    );
    return { ok: false, reason: "server tools unsupported on gateway" };
  }

  const payload: Record<string, unknown> = {
    model,
    messages: translateMessagesToOpenAI(opts.system, opts.messages),
    max_tokens: geminiOutputCeiling(opts.maxTokens),
  };
  if (tools) payload.tools = tools;
  if (opts.toolChoice) payload.tool_choice = translateToolChoiceToOpenAI(opts.toolChoice);

  // CAPTURED HERE, not at the top: everything above returns without reaching
  // the gateway, so a row written earlier would record a call that never
  // happened. The first line that can cost credits is the fetch below.
  const spend = opts.gatewaySpend;
  const spendRpc = spend?.rpc ?? null;
  if (spend) {
    await captureGatewaySpend(spendRpc, {
      requestId: spend.requestId,
      capability: "TEXT",
      model,
      unit: "tokens",
      jobId: spend.jobId ?? null,
      attempt: spend.attempt ?? null,
      userId: spend.userId ?? null,
    });
  }
  const settle = async (s: Parameters<typeof settleGatewaySpend>[2]) => {
    if (spend) await settleGatewaySpend(spendRpc, spend.requestId, s);
  };

  const timeoutMs = opts.timeoutMs ?? 12000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GATEWAY_TEXT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    if (res.status >= 200 && res.status < 300) {
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Served and billed regardless of our ability to read it.
        await settle({ outcome: "FAILED" });
        return { ok: false, reason: "unparseable gateway response" };
      }
      if (!body) {
        await settle({ outcome: "FAILED" });
        return { ok: false, reason: "empty gateway response" };
      }
      // TOKENS ARE ALL THE GATEWAY DISCLOSES. There is no price field, so
      // `chargedCredits` is deliberately absent and the row stays
      // PENDING_RECONCILIATION — a zero here would read as "this was free".
      await settle({ outcome: "ACCEPTED", unitsObserved: tokensFromUsage(body) });
      return {
        ok: true,
        data: translateOpenAIResponseToAnthropic(body, model),
        provider: "gemini",
      };
    }
    if (isGatewayCreditsExhausted(res.status)) {
      console.warn(
        `callGatewayText: gateway credits exhausted or rate limited (http ${res.status}) key=${mask(key)}`,
      );
      // A refusal at the door is the one non-2xx that certainly cost nothing.
      await settle({ outcome: "NOT_CALLED", detail: { refusedWith: res.status } });
      return { ok: false, reason: `http ${res.status}`, creditsExhausted: true };
    }
    console.warn(`callGatewayText: http ${res.status} key=${mask(key)} body=${text.slice(0, 200)}`);
    await settle({ outcome: "FAILED", detail: { status: res.status } });
    return { ok: false, reason: `http ${res.status}` };
  } catch (e) {
    const reason = (e as Error)?.name === "AbortError" ? "timeout" : String(e).slice(0, 120);
    // AMBIGUOUS, so it is recorded as spent. A timeout says nothing about
    // whether the gateway served the request.
    await settle({ outcome: "FAILED", detail: { reason } });
    return { ok: false, reason };
  } finally {
    clearTimeout(t);
  }
}

/** Anthropic tool_choice -> OpenAI tool_choice. */
function translateToolChoiceToOpenAI(choice: unknown): unknown {
  const c = choice as { type?: unknown; name?: unknown };
  if (c && typeof c === "object") {
    if (c.type === "tool" && typeof c.name === "string") {
      return { type: "function", function: { name: c.name } };
    }
    if (c.type === "any") return "required";
    if (c.type === "auto") return "auto";
  }
  return "auto";
}

/**
 * THE ENTRY POINT every text caller should use.
 *
 * OWNER DIRECTIVE, 2026-09-04b: "make images, Voice, music, documents direct
 * Gemini not via lovable". Text — which is what Document and AI run on — moves
 * from the Lovable gateway onto Google's own endpoint, on GOOGLE_AI_API_KEY.
 * Gemini DIRECT first; Claude when Google is unreachable or refuses, and when
 * the caller's tools mean Gemini cannot honestly serve it at all.
 *
 * The failover is unchanged in shape and direction — still Gemini serving and
 * Claude catching, per the 2026-09-04 directive. Only the road to Gemini moved,
 * and with it whose account pays for the ordinary case.
 */
export async function callText(
  opts: CallClaudeOpts & { tier?: "standard" | "heavy" },
): Promise<CallClaudeResult> {
  // Search-bound callers keep Claude and its server tools.
  //
  // NOTE THAT THE ORIGINAL REASON HAS WEAKENED. This gate was written because
  // the GATEWAY's chat endpoint carries no search tools at all, and a
  // search-less engine invents its sources. callGemini, the direct caller,
  // DOES translate web_search onto Google's google_search and fails closed
  // when it cannot. So the gate is now conservative rather than forced.
  // It stays as it is deliberately: which engine answers a "find live prices
  // and cite them" question is a quality decision about ONIQ's answers, not a
  // consequence of this plumbing change, and widening it is the owner's call.
  const needsServerTools =
    opts.requireSearch === true ||
    opts.allowFallback === false ||
    (Array.isArray(opts.tools) &&
      opts.tools.some((t) => typeof (t as { type?: unknown })?.type === "string"));
  if (needsServerTools) return callClaude(opts);

  // The tier ids, POST-verified direct 2026-09-04 (200s at 738 and 1,388
  // bytes). Unprefixed: the gateway's `google/…` ids 404 on this endpoint.
  const primary = await callGemini({
    ...opts,
    geminiModel: opts.tier === "heavy" ? TEXT_DIRECT_HEAVY.id : TEXT_DIRECT_STANDARD.id,
  });
  if (primary.ok) return primary;

  console.warn(`callText: direct Gemini failed (${primary.reason}) — falling back to Anthropic`);
  const secondary = await callClaude(opts);
  if (secondary.ok) return secondary;
  // Both engines are down. Report the PRIMARY failure, with the catcher's
  // reason alongside — the same shape the old direction used, so callers that
  // already read `fallbackReason` keep reading it.
  return { ok: false, reason: primary.reason, fallbackReason: secondary.reason };
}
