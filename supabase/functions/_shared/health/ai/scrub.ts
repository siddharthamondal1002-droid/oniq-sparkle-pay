/**
 * ONIQ HEALTH AI — normalisation, scrubbing and the injection detector.
 *
 * ONE NORMALISER FOR EVERY PATTERN. `normalizeForMatch` runs before the
 * scrubber, the detector and the contract validator: NFKC, format characters
 * stripped (zero-width, soft hyphen, BOM, bidi marks), C0/C1 controls
 * stripped except newline, combining marks stripped off LATIN letters (a
 * grapheme joiner, a variation selector or an accent inside "take" is not a
 * different word — Indic matras are kept, they ARE the word), case-folded,
 * whitespace collapsed, and the digits of every Indic script, Thai, Lao,
 * Tibetan, Myanmar, Khmer and Arabic mapped to ASCII. A full-width "take",
 * a zero-width-joined "take", "t\u00e1ke" and a Gujarati "500" all match
 * the ASCII rule. Red-teamed 2026-09-08: the first version mapped four
 * scripts and stripped no combining marks, so "ig\u034fnore" and "\u0aef\u0aef\u0aef"
 * walked past every pattern.
 *
 * SCRUBBING IS A FLOOR, NOT A GUARANTEE. Emails, phones, 12-digit ids, PAN,
 * URLs and ABHA addresses are removed from every string field that enters a
 * context. Names, dates of birth and addresses are NOT — that needs a
 * document-level DLP pass or a stricter context, and it is an owner decision
 * before any non-synthetic provider is registered (docs/health/05 §4).
 *
 * THE DETECTOR IS A FALSE-POSITIVE-BOUNDED HEURISTIC, NOT THE BOUNDARY. The
 * boundary is structured provider input plus the contract validator. A
 * flagged field is dropped from model-bound context (and the person is told
 * what was left out); for regex-bound extraction it only raises a flag.
 * `injectionCorpus.ts` carries the positives that must trip it and the
 * benign clinical sentences that must not, so tightening it has a cost.
 *
 * EVERY PATTERN HAS BOUNDED GAPS. No `.*`, no `.+`, no quantified group:
 * attacker-controlled text of 20,000 characters must not pin the isolate.
 * `aiRegexSafety.test.ts` greps this file for the banned shapes and times
 * every pattern against adversarial inputs.
 */
import type { AiLanguage } from "./types.ts";

/**
 * The ZERO of every decimal-digit block a person in ONIQ's markets might
 * type: Arabic-Indic, Extended Arabic-Indic, NKo, Devanagari, Bengali,
 * Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala,
 * Thai, Lao, Tibetan, Myanmar, Khmer, Mongolian. NFKC already folds the
 * superscript, full-width, circled and mathematical forms.
 */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810,
] as const;
const DIGIT_MAP: Record<string, string> = {};
for (const zero of DIGIT_ZEROS) {
  for (let i = 0; i < 10; i++) DIGIT_MAP[String.fromCharCode(zero + i)] = String(i);
}

/** Format characters and controls that hide text from a pattern. Newline is kept. */
const FORMAT_CHARS = /[\p{Cf}\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const NON_ASCII_DIGITS = new RegExp(
  `[${DIGIT_ZEROS.map((z) => `\\u${z.toString(16).padStart(4, "0")}-\\u${(z + 9).toString(16).padStart(4, "0")}`).join("")}]`,
  "g",
);
/** A combining mark that follows a LATIN letter hides nothing but the letter. */
const LATIN_MARKS = /(?<=\p{Script=Latin})\p{M}+/gu;

export function normalizeForMatch(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(FORMAT_CHARS, "")
    .normalize("NFD")
    .replace(LATIN_MARKS, "")
    .normalize("NFKC")
    .replace(NON_ASCII_DIGITS, (d) => DIGIT_MAP[d] ?? d)
    .toLowerCase()
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** Text that hides letters: format characters, or Latin mixed with Cyrillic/Greek inside one word. */
export function hasObfuscation(input: string | null | undefined): boolean {
  if (!input) return false;
  if (/\p{Cf}/u.test(input)) return true;
  const controls = (input.match(CONTROL_CHARS) ?? []).length;
  if (controls > 0 && controls / Math.max(1, input.length) > 0.02) return true;
  for (const token of input.split(/\s+/)) {
    const latin = /\p{Script=Latin}/u.test(token);
    const other = /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(token);
    if (latin && other) return true;
  }
  return false;
}

/* --------------------------------------------------------------- scrub -- */

const SCRUB_PATTERNS: Array<{ token: string; re: RegExp }> = [
  { token: "[email]", re: /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,12}/gi },
  { token: "[abha]", re: /\b[a-z0-9._-]{2,40}@(?:abdm|sbx)\b/gi },
  { token: "[url]", re: /\bhttps?:\/\/[^\s<>\x22\x27]{1,200}|\bwww\.[^\s<>\x22\x27]{1,200}/gi },
  { token: "[id]", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g },
  { token: "[pan]", re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { token: "[phone]", re: /(?:\+\d{1,3}[ -]?)?\d{2,5}(?:[ -]?\d{2,5}){1,3}\b/g },
];

export type ScrubResult = { text: string; redactions: number };

export function scrubText(input: string | null | undefined): ScrubResult {
  if (!input) return { text: "", redactions: 0 };
  let text = input;
  let redactions = 0;
  for (const { token, re } of SCRUB_PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, (m) => {
      // A bare 4–7 digit number is a lab value far more often than a phone.
      if (token === "[phone]" && m.replace(/\D/g, "").length < 8) return m;
      redactions++;
      return token;
    });
  }
  return { text, redactions };
}

/* ----------------------------------------------------------- injection -- */

export type InjectionGroup = { id: string; re: RegExp };

const EN: readonly InjectionGroup[] = [
  {
    id: "override",
    re: /\b(ignore|disregard|forget|override)\b.{0,20}\b(previous|prior|above|earlier|all|any|your)\b.{0,20}\b(instruction|prompt|rule|guideline|context)/,
  },
  {
    id: "override",
    re: /\bnew (instructions|task|role)\b|\bfrom now on\b|\byou are now\b|\b(act|pose|pretend|roleplay) as\b|\bpretend\b.{0,12}\byou are\b|\byou are (the|a|my|their) (user\x27?s |patient\x27?s )?(doctor|physician|cardiologist|nurse|clinician|pharmacist)\b/,
  },
  { id: "role_marker", re: /^\s*(system|assistant|user|human|ai)\s*:/m },
  {
    id: "role_marker",
    re: /<\|im_(start|end)\|>|<\|endoftext\|>|\[\/?inst\]|<(system|assistant|instruction|prompt)>|^#{1,6}\s*(system|instruction)|```(system|prompt)/m,
  },
  {
    id: "steering",
    re: /\b(respond|reply|answer|output|print|return|say)\b.{0,15}\b(only|with|exactly|the following|in json)\b/,
  },
  {
    id: "steering",
    re: /\btell (the )?(user|patient|person)\b|\bdo not (tell|mention|show|inform) the (user|person|patient)\b/,
  },
  { id: "exfil", re: /https?:\/\/|\bcurl\b|\bwget\b|\bbase64\b|[a-z0-9+/=]{200}/ },
  {
    id: "medical_override",
    re: /\b(prescribe|recommend a dose|you are a doctor|as (a|the) doctor)\b/,
  },
  { id: "developer", re: /\bdeveloper (mode|message)\b|\bjailbreak\b|\bdan mode\b/ },
  // Romanised Hindi and Bengali (Hinglish/Banglish) — the way people actually
  // type on a phone. English runs on every language, so these live here.
  {
    id: "override",
    re: /\b(pichle|pichhle|purane|saare|sab|upar ke|ager|aagey|aage|purono|agher)\b.{0,20}\b(instructions?|nirdesh|niyam|rules?|prompt)\b.{0,20}\b(ignore|bhool|bhul|bhule|bhulo|chhod|chod|bad de|baad de|chere dao)\b/,
  },
  {
    id: "override",
    re: /\b(ab se|ekhon theke)\s{1,3}(tum|aap|tumi|apni)\b|\b(tum|aap|tumi) (ab|ekhon)\b.{0,8}\b(ho|bano|hao|hobe)\b|\b(doctor|daktar)\b.{0,3}\b(ban ?jao|bano|ki tarah|hoye|hisebe)\b/,
  },
  { id: "steering", re: /\b(sirf|keval|shudhu|kebol)\b.{0,16}\b(jawab|uttar|reply|answer)\b/ },
  {
    id: "override",
    re: /\bab (tum|aap|tu)\b.{0,12}\b(doctor|daktar)\b|\b(doctor|daktar)\b.{0,3}\b(ho|hai|ban ?jao|bano)\b/,
  },
];

/**
 * Scripts ONIQ does not answer in but a person can still type a record in —
 * Tamil, Urdu, Gujarati, Marathi (Devanagari, so it rides the hi list's
 * script but not its words). These run on EVERY language, like the English
 * list, because a display's script is not the request's language.
 */
const SCRIPTS: readonly InjectionGroup[] = [
  {
    id: "override",
    re: /(முந்தைய|முன்|மேலே).{0,12}(வழிமுறை|அறிவுறுத்தல்|விதி).{0,20}(புறக்கணி|மற|விடு)|(இப்போது|இனி) நீ.{0,8}(மருத்துவர்|டாக்டர்)/,
  },
  {
    id: "override",
    re: /(پچھلی|تمام|سابقہ|اوپر).{0,12}(ہدایات|ہدایت|احکامات|قواعد).{0,20}(نظر انداز|بھول|چھوڑ)|اب (آپ|تم).{0,8}(ڈاکٹر|معالج)/,
  },
  {
    id: "override",
    re: /(પાછલી|અગાઉની|ઉપરની|બધી).{0,12}(સૂચના|સૂચનાઓ|નિયમો).{0,20}(અવગણ|ભૂલી|છોડી)|હવે (તમે|તું).{0,8}(ડોક્ટર|ડૉક્ટર)/,
  },
  {
    id: "override",
    re: /(मागील|आधीच्या|वरील|सर्व).{0,12}(सूचना|आदेश|नियम).{0,20}(दुर्लक्ष|विसर|सोड)|आता (तू|तुम्ही).{0,8}(डॉक्टर|वैद्य)/,
  },
];

const HI: readonly InjectionGroup[] = [
  { id: "override", re: /(पिछले|पहले|ऊपर).{0,10}(निर्देश|आदेश|नियम).{0,15}(अनदेखा|भूल|छोड़)/ },
  { id: "override", re: /अब से तुम|अब तुम.{0,6}(हो|बनो)|(डॉक्टर|चिकित्सक) (की तरह|बनकर)/ },
  { id: "steering", re: /(सिर्फ|केवल).{0,20}(जवाब|उत्तर) (दो|दें)/ },
];

const BN: readonly InjectionGroup[] = [
  { id: "override", re: /(আগের|পূর্বের|উপরের).{0,10}(নির্দেশ|নিয়ম).{0,15}(উপেক্ষা|ভুলে|বাদ)/ },
  { id: "override", re: /এখন থেকে তুমি|তুমি এখন.{0,6}(হও|হবে)|(ডাক্তার|চিকিৎসক) (এর মতো|হয়ে)/ },
  { id: "steering", re: /(শুধু|কেবল).{0,20}(উত্তর|জবাব) (দাও|দিন)/ },
];

/** The text under test is NFKC-normalised, so the Indic patterns must be too. */
function nfkc(groups: readonly InjectionGroup[]): readonly InjectionGroup[] {
  return groups.map((g) => ({
    id: g.id,
    re: new RegExp(g.re.source.normalize("NFKC"), g.re.flags),
  }));
}

/**
 * EVERY LIST RUNS ON EVERY LANGUAGE (Phase 4, owner directive 2026-09-09 §6).
 * The first version ran the Hindi and Bengali lists only when the REQUEST
 * was in that language — and a document is read under the request's
 * language, so a Hindi instruction printed on a report opened from an
 * English phone walked past the detector (documentRedteam.test.ts, "A.
 * Hindi override"). A page's script is not the request's language, exactly
 * the argument SCRIPTS already made for Tamil, Urdu, Gujarati and Marathi.
 */
const EVERY: readonly InjectionGroup[] = [...EN, ...nfkc(SCRIPTS), ...nfkc(HI), ...nfkc(BN)];

export const INJECTION_PATTERNS: Record<AiLanguage, readonly InjectionGroup[]> = {
  en: EVERY,
  hi: nfkc(HI),
  bn: nfkc(BN),
};

export type InjectionResult = { suspected: boolean; matched: string[]; obfuscation: boolean };

/** The same groups whatever the language: the text decides, not the request. */
export function detectInjection(
  input: string | null | undefined,
  _language: AiLanguage = "en",
): InjectionResult {
  if (!input) return { suspected: false, matched: [], obfuscation: false };
  const obfuscation = hasObfuscation(input);
  const text = normalizeForMatch(input);
  const groups = EVERY;
  const matched = new Set<string>();
  for (const g of groups) if (g.re.test(text)) matched.add(g.id);
  if (obfuscation) matched.add("obfuscation");
  return { suspected: matched.size > 0, matched: [...matched], obfuscation };
}

export type CleanResult = {
  text: string;
  redactions: number;
  injection: InjectionResult;
  tooLong: boolean;
};

/** Scrub, then check on the scrubbed text. Over the cap is reported, never silently trimmed. */
export function cleanField(
  input: string | null | undefined,
  maxChars: number,
  language: AiLanguage = "en",
): CleanResult {
  const scrubbed = scrubText(input);
  return {
    text: scrubbed.text,
    redactions: scrubbed.redactions,
    injection: detectInjection(scrubbed.text, language),
    tooLong: scrubbed.text.length > maxChars,
  };
}
