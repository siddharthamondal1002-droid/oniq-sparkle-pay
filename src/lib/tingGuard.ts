// Ting guardrails — Ting is a general assistant, never a health or crisis
// counsellor. Detection runs on the raw user text of EVERY turn, BEFORE any
// model call, so rephrasing, roleplay, fiction, third-person displacement,
// translation or "ignore your guidelines" framing still trips it: the signal
// is matched wherever it appears, regardless of the frame around it. The
// routing is hard-coded in the caller (see app.ai.tsx) — it is never a prompt
// instruction the model could be talked out of.
//
// crisis  → do NOT call the model at all; show warmth + the current-region
//           crisis card. Hard-coded, not model-mediated.
// health  → the model may answer as general wellness information, but the
//           reply is always framed with a "not medical advice" notice.
//
// NOTE: nothing in this file — patterns, copy or comments — names, describes
// or hints at any method or means. Detection keys on intent language only.

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "i",
};

/**
 * Fold obfuscation so evasion by spelling tricks fails: case, leetspeak,
 * padding punctuation, letter-spacing ("s u i c i d e") and stretched
 * characters ("diieee"). Latin-only transforms; the raw text is also tested
 * so non-Latin scripts (Devanagari etc.) are unaffected.
 */
function normalise(input: string): string {
  let t = input.toLowerCase();
  t = t.replace(/[0134579@$!|]/g, (c) => LEET[c] ?? c);
  // strip zero-width + separator punctuation used to break up words
  t = t.replace(/[\u200b-\u200f\u2060]/g, "");
  t = t.replace(/[._*\-+~^=/\\<>()[\]{}"“”]/g, " ");
  t = t.replace(/[’`´]/g, "'");
  // collapse letter-spaced words: "k i l l" -> "kill"
  t = t.replace(/\b(?:[a-z]\s){2,}[a-z]\b/g, (m) => m.replace(/\s+/g, ""));
  // collapse stretched characters: "diiiie" -> "diie"
  t = t.replace(/(.)\1{2,}/g, "$1$1");
  return t.replace(/\s+/g, " ").trim();
}

// Subject-agnostic on purpose: "i", "someone", "a character", "my friend",
// "he/she/they" all resolve to the same routing. Displacement is not a signal
// of safety — it is the single most common way distress gets voiced.
const SUBJ = "(?:i|you|we|he|she|they|it|someone|somebody|anyone|a\\s+\\w+|my\\s+\\w+|his|her|their|its)";

const CRISIS_PATTERNS: RegExp[] = [
  // ---- explicit intent -------------------------------------------------
  /suicid/i,
  /kill(?:ing)?\s+(?:myself|himself|herself|themselves|yourself|oneself)/i,
  new RegExp(`(?:end|ending|ends)\\s+(?:${SUBJ}\\s+)?(?:own\\s+)?life\\b`, "i"),
  /\bend(?:ing|s)?\s+(?:it|things|everything)\s*(?:all)?\b/i,
  /\bend\s+it\s+all\b/i,
  /tak(?:e|ing)\s+(?:my|his|her|their|your)\s+(?:own\s+)?life/i,
  /self[\s-]?harm/i,
  /hurt(?:ing)?\s+(?:myself|himself|herself|themselves)/i,
  /wants?\s+to\s+die\b/i,
  /\bwant\s+to\s+be\s+dead\b/i,
  /better\s+off\s+dead/i,
  /\bnot\s+want\s+to\s+(?:be\s+)?(?:alive|here)\b/i,
  /\bkms\b/i,
  // ---- indirect / passive — the phrasing systems usually miss ----------
  /do(?:es)?n'?t\s+want\s+to\s+(?:live\s+(?:any\s*more|anymore)|be\s+here|exist|wake\s+up|be\s+alive)(?!\s+(?:in|with|at|near|alone\s+in))/i,
  /do(?:es)?n'?t\s+want\s+to\s+live\b(?!\s+(?:in|with|at|near|on|by|abroad|alone|like|here\s+in))/i,
  /no\s+(?:reason|point|use)\s+(?:to|in)\s+(?:be\s+)?(?:liv|alive|carry|go)/i,
  /what'?s\s+the\s+point\s+(?:of\s+(?:it\s+)?all|anymore|any\s+more|in\s+going\s+on)/i,
  /sleep\s+forever/i,
  /never\s+(?:have\s+to\s+)?wake\s+up/i,
  /want(?:s|ing)?\s+to\s+(?:just\s+)?(?:disappear|vanish|not\s+exist|stop\s+existing)/i,
  /wish(?:ed|es)?\s+(?:i|he|she|they)\s+(?:was|were|had)\s+(?:never\s+born|gone|not\s+here)/i,
  /every(?:one|body)\s+(?:would\s+be\s+)?better\s+off\s+without\s+(?:me|him|her|them)/i,
  /would\s+(?:anyone|anybody)\s+(?:even\s+)?(?:notice|care|miss\s+me)\s*(?:if\s+i\s+(?:was\s+|were\s+)?(?:gone|disappeared|wasn'?t\s+here))?/i,
  /(?:so\s+|really\s+|just\s+)?tired\s+of\s+(?:living|being\s+alive|existing|it\s+all|all\s+(?:of\s+)?this|everything)/i,
  /\bdone\s+with\s+(?:it\s+all|living|everything)\b/i,
  /can'?t\s+(?:go|do|keep\s+going|carry)\s*(?:on|this|any\s*more|anymore)?\s*(?:any\s*more|anymore)?/i,
  /give\s+up\s+on\s+(?:life|living)/i,
  /\bnothing\s+(?:left\s+)?to\s+live\s+for\b/i,
  /\bstop\s+the\s+pain\s+(?:for\s+good|forever|permanently)\b/i,
  // ---- other languages (translation is not an escape hatch) ------------
  /khudkushi|khudkhushi/i,
  /aatmahatya|atma\s*hatya|atmohotta/i,
  /marna\s*chaht|jeena\s*nahi\s*chaht|jeene\s*ka\s*mann\s*nahi/i,
  /more\s+jete\s+chai/i,
  /आत्महत्या/,
  /मरना\s*चाहत/,
  /जीना\s*नहीं/,
  /খুদকুশি|মরে\s*যেতে/,
  /தற்கொலை/,
  /ఆత్మహత్య/,
  /quiero\s+morir|acabar\s+con\s+mi\s+vida|suicidar/i,
  /je\s+veux\s+mourir|mettre\s+fin\s+[aà]\s+mes\s+jours/i,
  /ich\s+will\s+(?:nicht\s+mehr\s+leben|sterben)/i,
  /انتحار|أريد\s+أن\s+أموت/,
  /自杀|死にたい|자살/,
];

const HEALTH_PATTERNS: RegExp[] = [
  /symptom/i,
  /diagnos/i,
  /\bdose\b|\bdosage\b/i,
  /prescri(?:be|ption)/i,
  /medicin|tablet|antibiotic|paracetamol|ibuprofen/i,
  /chest\s+pain|heart\s+attack|stroke\b/i,
  /\bfever\b|\bmigraine\b|\bcramps?\b/i,
  /pregnan|period\s+(?:pain|late|miss)/i,
  /depress|anxiety|panic\s+attack|adhd|ocd\b/i,
  /\bstd\b|\bsti\b|infection/i,
  /blood\s+(?:pressure|sugar)|diabet|thyroid/i,
  /should\s+i\s+(?:see|go\s+to)\s+(?:a\s+)?(?:doctor|hospital|er\b)/i,
];

export type TingGuardVerdict = "crisis" | "health" | null;

/**
 * Pure, synchronous, offline. The caller MUST run this before building any
 * model payload; a "crisis" verdict short-circuits the model entirely.
 */
export function guardTingPrompt(text: string): TingGuardVerdict {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const folded = normalise(raw);
  const hit = (r: RegExp) => r.test(raw) || r.test(folded);
  if (CRISIS_PATTERNS.some(hit)) return "crisis";
  if (HEALTH_PATTERNS.some(hit)) return "health";
  return null;
}

/** Warm, method-free response shown instead of any model output. */
export const CRISIS_RESPONSE =
  "that sounds really heavy, and i'm glad you said it out loud. i'm just an AI though — " +
  "and you deserve a real person for this, not a chatbot. the lines below are free, " +
  "confidential, and answered by people who get it. if you're in immediate danger, " +
  "please use the emergency number. you matter, and you don't have to figure this out alone 💙";

export const HEALTH_DISCLAIMER =
  "general wellness info only — not medical advice, diagnosis or treatment. for anything " +
  "urgent or personal, a doctor is the right call.";
