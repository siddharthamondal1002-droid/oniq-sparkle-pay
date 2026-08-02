// Ting guardrails — Ting is a general assistant, never a health or crisis
// counsellor. Detection runs on the raw user text of EVERY turn, so
// rephrasing, roleplay or "hypothetically" framing still trips it: the words
// are matched wherever they appear, regardless of the frame around them.
//
// crisis  → do NOT call the model at all; show warmth + the country crisis
//           card. Hard-coded, not model-mediated.
// health  → the model may answer as general wellness information, but the
//           reply is always framed with a "not medical advice" notice.

const CRISIS_PATTERNS: RegExp[] = [
  // explicit
  /suicid/i,
  /kill(?:ing)?\s+myself/i,
  /\bend(?:ing)?\s+(?:my|his|her|their|its)\s+(?:own\s+)?(?:life|life\s+all|everything)\b/i,
  /wants?\s+to\s+end\s+(?:his|her|their|my|its?)\s+life/i,
  /take\s+my\s+(?:own\s+)?life/i,
  /self[\s-]?harm/i,
  /hurt(?:ing)?\s+myself/i,
  /wants?\s+to\s+die/i,
  /better\s+off\s+dead/i,
  // indirect — the phrasing detection systems usually miss
  /don'?t\s+want\s+to\s+(?:live\s+(?:any\s*more|anymore)|be\s+here|exist|wake\s+up)(?!\s+(?:in|with|at|near|alone\s+in))/i,
  /don'?t\s+want\s+to\s+live\b(?!\s+(?:in|with|at|near|on|by|abroad|alone|like|here\s+in))/i,
  /no\s+(?:reason|point)\s+(?:to|in)\s+liv/i,
  /sleep\s+forever/i,
  /never\s+wake\s+up/i,
  /want\s+to\s+disappear/i,
  /every(?:one|body)\s+(?:would\s+be\s+)?better\s+off\s+without\s+me/i,
  /would\s+anyone\s+(?:even\s+)?(?:notice|care)\s+if\s+i\s+(?:was\s+)?(?:gone|disappeared)/i,
  /tired\s+of\s+(?:living|being\s+alive|existing)/i,
  /can'?t\s+(?:go|do)\s+(?:on|this)\s+anymore/i,
  /give\s+up\s+on\s+life/i,
  // Hindi / Hinglish
  /khudkushi/i,
  /aatmahatya/i,
  /आत्महत्या/,
  /मरना\s*चाहत/,
  /जीना\s*नहीं/,
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

export function guardTingPrompt(text: string): TingGuardVerdict {
  const t = text.trim();
  if (!t) return null;
  if (CRISIS_PATTERNS.some((r) => r.test(t))) return "crisis";
  if (HEALTH_PATTERNS.some((r) => r.test(t))) return "health";
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
