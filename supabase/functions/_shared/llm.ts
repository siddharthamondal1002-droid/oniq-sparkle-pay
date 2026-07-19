// Shared Anthropic (Claude) client for ONIQ edge functions.
// Reuses the same secret + model that the ting function already relies on.
// Never throws; always returns a discriminated union.

export const SUPPORTED_LANGS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  te: "Telugu",
  mr: "Marathi",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
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
};

export type CallClaudeResult =
  | { ok: true; data: any }
  | { ok: false; reason: string };

export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    console.warn(`callClaude: missing ANTHROPIC_API_KEY (${mask(key)})`);
    return { ok: false, reason: "not configured" };
  }

  const payload: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
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
      return { ok: true, data: r.body };
    }
    const snippet = (r.text ?? "").slice(0, 200);
    console.warn(`callClaude: http ${r.status} key=${mask(key)} body=${snippet}`);
    return { ok: false, reason: `http ${r.status}` };
  }
  return { ok: false, reason: "unknown" };
}
