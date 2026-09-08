/**
 * ONIQ HEALTH AI — normalisation, scrubbing and the injection detector.
 *
 * ONE NORMALISER FOR EVERY PATTERN. `normalizeForMatch` runs before the
 * scrubber, the detector and the contract validator: NFKC, format characters
 * stripped (zero-width, soft hyphen, BOM, bidi marks), C0/C1 controls
 * stripped except newline, case-folded, whitespace collapsed, Devanagari,
 * Bengali and Arabic-Indic digits mapped to ASCII. A full-width "take", a
 * zero-width-joined "take" and a Bengali "500" all match the ASCII rule.
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

const DIGIT_MAP: Record<string, string> = {};
for (const zero of [0x0966, 0x09e6, 0x0660, 0x06f0]) {
  for (let i = 0; i < 10; i++) DIGIT_MAP[String.fromCharCode(zero + i)] = String(i);
}

/** Format characters and controls that hide text from a pattern. Newline is kept. */
const FORMAT_CHARS = /[\p{Cf}\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const NON_ASCII_DIGITS = /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF]/g;

export function normalizeForMatch(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(FORMAT_CHARS, "")
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
    re: /\b(pichle|pichhle|purane|saare|sab|upar ke|ager|purono|agher)\b.{0,20}\b(instructions?|nirdesh|niyam|rules?|prompt)\b.{0,20}\b(ignore|bhool|bhul|bhule|bhulo|chhod|chod|bad de|baad de|chere dao)\b/,
  },
  {
    id: "override",
    re: /\b(ab se|ekhon theke)\s{1,3}(tum|aap|tumi|apni)\b|\b(tum|aap|tumi) (ab|ekhon)\b.{0,8}\b(ho|bano|hao|hobe)\b|\b(doctor|daktar)\b.{0,3}\b(ban ?jao|bano|ki tarah|hoye|hisebe)\b/,
  },
  { id: "steering", re: /\b(sirf|keval|shudhu|kebol)\b.{0,16}\b(jawab|uttar|reply|answer)\b/ },
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

export const INJECTION_PATTERNS: Record<AiLanguage, readonly InjectionGroup[]> = {
  en: EN,
  hi: nfkc(HI),
  bn: nfkc(BN),
};

export type InjectionResult = { suspected: boolean; matched: string[]; obfuscation: boolean };

/** English runs on every language (code-switching is the norm); the language's own list runs too. */
export function detectInjection(
  input: string | null | undefined,
  language: AiLanguage = "en",
): InjectionResult {
  if (!input) return { suspected: false, matched: [], obfuscation: false };
  const obfuscation = hasObfuscation(input);
  const text = normalizeForMatch(input);
  const groups = language === "en" ? EN : [...EN, ...INJECTION_PATTERNS[language]];
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
