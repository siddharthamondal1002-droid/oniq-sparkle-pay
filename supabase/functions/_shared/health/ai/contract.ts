/**
 * ONIQ HEALTH AI — the response contract, and what refuses a response.
 *
 * Every answer is a list of segments in one of four classes, and each class
 * has its own rules:
 *
 *   record_fact        cites ≥1 alias inside the manifest; every number in
 *                      it is grounded in a cited record (value, unit,
 *                      display, date, or the count of citations)
 *   general_info       cites nothing and never addresses the reader — the
 *                      second person is where advice hides
 *   ai_interpretation  cites ≥1 alias; a provider may emit it only if its
 *                      class allowlist says so (synthetic may not)
 *   unknown            cites nothing and carries no number
 *
 * Then every segment, and the whole response joined, is checked against
 * the forbidden groups — dose, prescription, medication change, diagnosis,
 * impersonation, care avoidance, off-app contact — in English always and in
 * the response's language too, on text NORMALISED the same way the injection
 * detector normalises input, so a full-width or zero-width-joined "take"
 * matches the ASCII rule. Content quoted from a CITED record is masked
 * first: "Metformin 500 mg" is the person's own medication record, and a
 * fact that quotes it is not a dose instruction.
 *
 * REFUSE, NEVER TRIM. A refusal is a closed code (`CONTRACT_REFUSAL_CODES`)
 * — the only thing ever stored about a bad output — and the gateway maps it
 * to `output_rejected` for the person.
 */
import {
  AI_LANGUAGES,
  AI_RESPONSE_SCHEMA_VERSION,
  CONTRACT_REFUSAL_CODES,
  LIMITS,
  PROVIDER_REFUSAL_CODES,
  SEGMENT_CLASSES,
  type AiLanguage,
  type AiResponse,
  type AiSegment,
  type AiTask,
  type ContextManifest,
  type ContextRecord,
  type ContractRefusalCode,
  type SegmentClass,
} from "./types.ts";
import { hasObfuscation, normalizeForMatch, scrubText } from "./scrub.ts";

export type ForbiddenGroup = { code: ContractRefusalCode; re: RegExp };

const EN: readonly ForbiddenGroup[] = [
  {
    code: "forbidden_dose",
    re: /\b(take|start|begin|use|stop|increase|decrease|double|halve|reduce|raise|continue|switch to|add)\b[^.\n]{0,60}\b\d{1,5}(\.\d{1,3})?\s{0,2}(mg|mcg|µg|g|ml|iu|units?|tablets?|tabs?|capsules?|caps?|drops?|puffs?)\b/,
  },
  {
    code: "forbidden_dose",
    re: /\b\d{1,5}(\.\d{1,3})?\s{0,2}(mg|mcg|µg|ml|iu|units?|tablets?|capsules?)\b[^.\n]{0,40}\b(daily|twice|thrice|per day|a day|every \d{1,2} hours|at night|before (food|meals)|after (food|meals)|bd|od|tds|qid)\b/,
  },
  {
    code: "forbidden_prescribe",
    re: /\b(you should|you must|you need to|make sure you|please|i recommend|i suggest|i advise|i\x27d recommend|i would recommend)\b[^.\n]{0,20}\b(take|taking|start|starting|stop|stopping|increase|increasing|decrease|decreasing|skip|skipping|double|doubling|try|trying)\b[^.\n]{0,40}\b(tablets?|medicines?|medication|drugs?|dose|insulin|antibiotics?|pills?|steroids?|supplements?)\b/,
  },
  {
    code: "forbidden_prescribe",
    re: /\bi (am |will |can )?prescrib(e|ing)\b|\bprescribed for you\b/,
  },
  {
    code: "forbidden_med_change",
    re: /\b(stop|discontinue|skip|drop|quit|halve|double)\b[^.\n]{0,30}\b(your|the|this|that)\b[^.\n]{0,20}\b(medicine|medication|medicines|tablets?|pills?|dose|insulin|treatment|therapy)\b/,
  },
  {
    code: "forbidden_diagnosis",
    re: /\byou (have|have got|are suffering from|suffer from|are diagnosed with|have been diagnosed with|definitely have|clearly have|almost certainly have|probably have|likely have|might have|may have|could have)\b/,
  },
  {
    code: "forbidden_diagnosis",
    re: /\b(diagnosis|dx)\s{0,2}:\s{0,2}\S|\bthis (confirms|means you have|indicates you have)\b/,
  },
  {
    code: "forbidden_impersonation",
    re: /\bas (your|a|the) (doctor|physician|nurse|pharmacist|clinician)\b|\bi am (a|your) (doctor|physician|clinician|nurse)\b|\bspeaking as (a|your) doctor\b/,
  },
  {
    code: "forbidden_care_avoidance",
    re: /\b(no need|don\x27?t need|do not need|unnecessary|not necessary|no reason) to (see|visit|consult|call|go to) (a|your|the) (doctor|hospital|emergency|clinic|er)\b|\b(skip|avoid|ignore) (the|your) (appointment|doctor|checkup|check-up|follow-up)\b|\bnot an emergency\b/,
  },
  {
    code: "forbidden_off_app",
    re: /\b(whatsapp|telegram|call me|text me|dm me|message me|contact me|my number|email me|visit my|reach me)\b|\bhttps?:\/\/|\bwww\./,
  },
  {
    code: "disclaimer_in_output",
    re: /\bnot (medical )?advice\b|\bnot a diagnosis\b|\bfor informational purposes\b|\binformation only\b/,
  },
];

const HI: readonly ForbiddenGroup[] = [
  {
    code: "forbidden_dose",
    re: /(लो|लें|लीजिए|खाओ|खाएं|खाइए|शुरू|बंद|बढ़ा|घटा).{0,40}\d{1,5}\s{0,2}(मिलीग्राम|mg|एमजी|गोली|टैबलेट|कैप्सूल)|\d{1,5}\s{0,2}(मिलीग्राम|mg|एमजी).{0,40}(लो|लें|लीजिए|खाओ|खाएं|खाइए)/,
  },
  {
    code: "forbidden_diagnosis",
    re: /(आपको|तुम्हें).{0,25}(बीमारी|डायबिटीज|मधुमेह|कैंसर|संक्रमण|रोग) (है|हो गया है)/,
  },
  { code: "forbidden_impersonation", re: /(मैं|मै) .{0,6}(डॉक्टर|चिकित्सक) (हूँ|हूं)/ },
  {
    code: "forbidden_care_avoidance",
    re: /(डॉक्टर|अस्पताल).{0,15}(जाने की ज़रूरत नहीं|जाने की जरूरत नहीं|मत जाओ|मत जाइए)/,
  },
  { code: "forbidden_med_change", re: /(दवा|दवाई|गोली|इंसुलिन).{0,15}(बंद कर|छोड़ द|रोक द)/ },
];

const BN: readonly ForbiddenGroup[] = [
  {
    code: "forbidden_dose",
    re: /(খাও|খান|নিন|নাও|শুরু|বন্ধ|বাড়া|কমা).{0,40}\d{1,5}\s{0,2}(মিলিগ্রাম|mg|ট্যাবলেট|ক্যাপসুল|বড়ি)|\d{1,5}\s{0,2}(মিলিগ্রাম|mg).{0,40}(খাও|খান|নিন|নাও)/,
  },
  {
    code: "forbidden_diagnosis",
    re: /(আপনার|তোমার).{0,25}(রোগ|ডায়াবেটিস|ক্যান্সার|সংক্রমণ) (আছে|হয়েছে)/,
  },
  { code: "forbidden_impersonation", re: /আমি .{0,6}(ডাক্তার|চিকিৎসক)/ },
  {
    code: "forbidden_care_avoidance",
    re: /(ডাক্তার|হাসপাতাল).{0,15}(যাওয়ার দরকার নেই|যেতে হবে না|যাবেন না)/,
  },
  { code: "forbidden_med_change", re: /(ওষুধ|ঔষধ|ট্যাবলেট|ইনসুলিন).{0,15}(বন্ধ কর|ছেড়ে দ)/ },
];

/** The text under test is NFKC-normalised, so the Indic patterns must be too. */
function nfkc(groups: readonly ForbiddenGroup[]): readonly ForbiddenGroup[] {
  return groups.map((g) => ({
    code: g.code,
    re: new RegExp(g.re.source.normalize("NFKC"), g.re.flags),
  }));
}

export const FORBIDDEN_GROUPS: Record<AiLanguage, readonly ForbiddenGroup[]> = {
  en: EN,
  hi: nfkc(HI),
  bn: nfkc(BN),
};

const HI_SECOND =
  /(?<![\p{L}\p{M}])(आप|आपको|आपका|आपकी|आपके|आपने|तुम|तुम्हें|तुम्हारा|तुम्हारी|तुम्हारे)(?![\p{L}\p{M}])/u;
const BN_SECOND = /(?<![\p{L}\p{M}])(আপনি|আপনার|আপনাকে|তুমি|তোমার|তোমাকে)(?![\p{L}\p{M}])/u;

const SECOND_PERSON: Record<AiLanguage, RegExp> = {
  en: /\b(you|your|yours|yourself|you\x27re|you\x27ve|you\x27ll|you\x27d)\b/,
  hi: new RegExp(HI_SECOND.source.normalize("NFKC"), "u"),
  bn: new RegExp(BN_SECOND.source.normalize("NFKC"), "u"),
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पाँच: 5,
  पांच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  এক: 1,
  দুই: 2,
  তিন: 3,
  চার: 4,
  পাঁচ: 5,
  ছয়: 6,
  সাত: 7,
  আট: 8,
  নয়: 9,
  দশ: 10,
};

/** Numeric tokens, normalised: "13.20" → "13.2", "1,234" → "1234", "09" → "9". */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of normalizeForMatch(text).matchAll(/\d[\d,]{0,15}(?:\.\d{1,6})?/g)) {
    const raw = m[0].replace(/,/g, "");
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(String(n));
  }
  return out;
}

/** Number words in the text, as digits. */
const NUMBER_WORDS_NFKC: Record<string, number> = Object.fromEntries(
  Object.entries(NUMBER_WORDS).map(([k, v]) => [k.normalize("NFKC"), v]),
);

export function extractNumberWords(text: string): string[] {
  const out: string[] = [];
  for (const token of normalizeForMatch(text).split(/[^\p{L}\p{M}]+/u)) {
    if (token && Object.prototype.hasOwnProperty.call(NUMBER_WORDS_NFKC, token)) {
      out.push(String(NUMBER_WORDS_NFKC[token]));
    }
  }
  return out;
}

/** The numbers a fact citing these records is allowed to contain. */
export function allowedNumbers(records: readonly ContextRecord[]): Set<string> {
  const allowed = new Set<string>();
  allowed.add(String(records.length));
  for (const r of records) {
    if (r.valueNum !== null && r.valueNum !== undefined) {
      allowed.add(String(r.valueNum));
      allowed.add(String(Math.round(r.valueNum * 10) / 10));
      allowed.add(String(Math.round(r.valueNum * 100) / 100));
      allowed.add(String(Math.round(r.valueNum)));
    }
    for (const n of extractNumbers(r.display)) allowed.add(n);
    for (const n of extractNumbers(r.valueUnit ?? "")) allowed.add(n);
    for (const n of extractNumbers(r.valueText ?? "")) allowed.add(n);
    for (const n of extractNumbers(r.dateLabel)) allowed.add(n);
    const d = new Date(r.effectiveDay);
    if (!Number.isNaN(d.getTime())) {
      allowed.add(String(d.getUTCFullYear()));
      allowed.add(String(d.getUTCMonth() + 1));
      allowed.add(String(d.getUTCDate()));
    }
  }
  return allowed;
}

/** Text with the cited records' own words blanked, so quoting a record is not a violation. */
export function maskCited(normText: string, cited: readonly ContextRecord[]): string {
  let out = normText;
  for (const r of cited) {
    for (const s of [r.valueText, r.display, r.dateLabel]) {
      const needle = normalizeForMatch(s ?? "");
      if (needle.length >= 2) out = out.split(needle).join(" ");
    }
  }
  return out;
}

export type ContractVerdict = { ok: true } | { ok: false; code: ContractRefusalCode };

function refuse(code: ContractRefusalCode): ContractVerdict {
  return { ok: false, code };
}

export function forbiddenIn(normText: string, language: AiLanguage): ContractRefusalCode | null {
  const groups = language === "en" ? EN : [...EN, ...FORBIDDEN_GROUPS[language]];
  for (const g of groups) if (g.re.test(normText)) return g.code;
  return null;
}

const ALIAS = /^r\d{1,3}$/;

export type ContractExpectation = {
  task: AiTask;
  provider: string;
  model: string;
  language: AiLanguage;
  classAllowlist: readonly SegmentClass[];
};

/**
 * `contextRecords[i]` is the record aliased r{i+1}; `manifest.recordIds[i]`
 * is its id. Both come from the same build, so their lengths agree.
 */
export function validateAiResponse(
  raw: unknown,
  manifest: ContextManifest,
  expect: ContractExpectation,
  contextRecords: readonly ContextRecord[],
): ContractVerdict {
  if (!raw || typeof raw !== "object") return refuse("not_an_object");
  const r = raw as Partial<AiResponse>;
  if (r.schemaVersion !== AI_RESPONSE_SCHEMA_VERSION) return refuse("schema_version");
  if (r.task !== expect.task) return refuse("task_mismatch");
  if (r.provider !== expect.provider) return refuse("provider_mismatch");
  if (r.model !== expect.model) return refuse("model_mismatch");
  if (
    typeof r.language !== "string" ||
    !(AI_LANGUAGES as readonly string[]).includes(r.language) ||
    r.language !== expect.language ||
    r.language !== manifest.language
  ) {
    return refuse("language_unsupported");
  }
  if (!Array.isArray(r.segments) || r.segments.length === 0) return refuse("no_segments");
  if (r.segments.length > LIMITS.MAX_SEGMENTS) return refuse("too_many_segments");
  if (!Array.isArray(r.refusals)) return refuse("refusals_shape");
  for (const code of r.refusals) {
    if (typeof code !== "string" || !(PROVIDER_REFUSAL_CODES as readonly string[]).includes(code)) {
      return refuse("bad_refusal_code");
    }
  }
  const usage = r.usage;
  if (
    !usage ||
    typeof usage !== "object" ||
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number" ||
    !Number.isFinite(usage.inputTokens) ||
    !Number.isFinite(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0
  ) {
    return refuse("usage_shape");
  }
  if (typeof r.costUsd !== "number" || !Number.isFinite(r.costUsd) || r.costUsd < 0) {
    return refuse("cost_shape");
  }

  const language = r.language as AiLanguage;
  const maskedAll: string[] = [];
  let total = 0;

  for (const s of r.segments as AiSegment[]) {
    if (!s || typeof s !== "object") return refuse("segment_shape");
    if (!(SEGMENT_CLASSES as readonly string[]).includes(String(s.class)))
      return refuse("segment_class");
    if (!expect.classAllowlist.includes(s.class)) return refuse("class_not_allowed");
    if (typeof s.text !== "string" || !s.text.trim()) return refuse("segment_empty");
    if (s.text.length > LIMITS.MAX_SEGMENT_CHARS) return refuse("segment_too_long");
    total += s.text.length;
    if (
      s.confidence !== undefined &&
      (typeof s.confidence !== "number" ||
        !Number.isFinite(s.confidence) ||
        s.confidence < 0 ||
        s.confidence > 1)
    ) {
      return refuse("confidence_range");
    }

    // Citations: aliases inside the manifest, each resolving to a context record.
    const refs = s.sourceRefs === undefined ? [] : s.sourceRefs;
    if (!Array.isArray(refs) || refs.some((x) => typeof x !== "string"))
      return refuse("segment_shape");
    if (refs.length > LIMITS.MAX_CITATIONS_PER_SEGMENT) return refuse("too_many_citations");
    const cited: ContextRecord[] = [];
    for (const ref of refs) {
      if (!ALIAS.test(ref)) return refuse("citation_outside_manifest");
      const index = Number(ref.slice(1)) - 1;
      if (index < 0 || index >= manifest.recordIds.length)
        return refuse("citation_outside_manifest");
      const rec = contextRecords[index];
      if (!rec || rec.ref !== ref) return refuse("citation_mismatch");
      cited.push(rec);
    }

    // Per-class rules.
    const norm = normalizeForMatch(s.text);
    switch (s.class) {
      case "record_fact": {
        if (cited.length === 0) return refuse("fact_without_source");
        const allowed = allowedNumbers(cited);
        let stripped = norm;
        for (const c of cited) {
          const label = normalizeForMatch(c.dateLabel);
          if (label.length >= 2) stripped = stripped.split(label).join(" ");
        }
        for (const n of [...extractNumbers(stripped), ...extractNumberWords(stripped)]) {
          if (!allowed.has(n)) return refuse("ungrounded_number");
        }
        break;
      }
      case "general_info": {
        if (cited.length > 0) return refuse("general_info_cites");
        if (
          SECOND_PERSON.en.test(norm) ||
          (language !== "en" && SECOND_PERSON[language].test(norm))
        ) {
          return refuse("general_info_second_person");
        }
        break;
      }
      case "unknown": {
        if (cited.length > 0) return refuse("unknown_cites");
        if (/\d/.test(norm) || extractNumberWords(norm).length > 0)
          return refuse("unknown_has_number");
        break;
      }
      case "ai_interpretation": {
        if (cited.length === 0) return refuse("interpretation_without_source");
        break;
      }
    }

    // Text safety, on the masked text.
    if (hasObfuscation(s.text)) return refuse("obfuscated_output");
    const masked = maskCited(norm, cited);
    if (scrubText(masked).redactions > 0) return refuse("identifier_in_output");
    const forbidden = forbiddenIn(masked, language);
    if (forbidden) return refuse(forbidden);
    maskedAll.push(masked);
  }

  if (total > LIMITS.MAX_RESPONSE_CHARS) return refuse("response_too_long");
  // Second pass over the join: a dose split across two segments is still a dose.
  const joined = maskedAll.join(" ");
  const forbiddenJoined = forbiddenIn(joined, language);
  if (forbiddenJoined) return refuse(forbiddenJoined);
  return { ok: true };
}

export function isContractCode(code: unknown): code is ContractRefusalCode {
  return typeof code === "string" && (CONTRACT_REFUSAL_CODES as readonly string[]).includes(code);
}
