/**
 * ONIQ HEALTH AI — the response contract, and what refuses a response.
 *
 * Every answer is a list of segments in one of four classes, and each class
 * has its own rules:
 *
 *   record_fact        cites ≥1 alias inside the manifest; every number in
 *                      it is grounded in a cited record (its value, the
 *                      digits of its display, unit or note). The date is
 *                      quotable ONLY as the record's own `dateLabel`, which
 *                      is stripped before the numbers are read — a day of
 *                      month, a year or the count of citations is not a
 *                      value a fact may state (red-teamed 2026-09-08:
 *                      "HbA1c was recorded as 14" passed on the 14th).
 *                      It never advises the reader: "you should", "you
 *                      must", "you need to" in a fact is advice wearing a
 *                      citation.
 *   general_info       cites nothing and never addresses the reader — the
 *                      second person is where advice hides, and "u", "ur"
 *                      and "thou" are the second person too
 *   ai_interpretation  cites ≥1 alias; a provider may emit it only if its
 *                      class allowlist says so (synthetic may not)
 *   unknown            cites nothing and carries no number
 *
 * Then every segment, and the whole response joined, is checked against
 * the forbidden groups — dose, prescription, medication change, diagnosis,
 * impersonation, care avoidance, off-app contact — in English always and in
 * the response's language too, on text NORMALISED the same way the injection
 * detector normalises input, so a full-width or zero-width-joined "take"
 * matches the ASCII rule; number words are digitised first ("fifty mg" is
 * "50 mg") and a sentence boundary is not a gap a schedule can hide behind
 * ("500 mg. Twice a day" is one dose).
 *
 * CITED CONTENT IS MASKED, AND THEN CHECKED AGAIN UNMASKED. "Metformin
 * 500 mg" is the person's own medication record, and a fact that quotes it
 * is not a dose instruction — so the cited record's own words are blanked
 * before the groups run. But masking alone let a provider WRAP a cited
 * fragment in an instruction ("Take Metformin 500 mg twice a day" citing
 * "Metformin 500 mg" masked to "take twice a day"), so the unmasked text is
 * checked too, and a hit there is tolerated only when a cited record's own
 * field trips the same group by itself — the person wrote the instruction,
 * and is being shown their own record.
 *
 * REFUSE, NEVER TRIM. A refusal is a closed code (`CONTRACT_REFUSAL_CODES`)
 * — the only thing ever stored about a bad output — and the gateway maps it
 * to `output_rejected` for the person. The two non-response kinds have the
 * same rule: `validateClassification` rebuilds a classification from a
 * closed shape and `validateExtraction` admits a candidate only when it is an
 * entry of the analyte table (`CANDIDATE_TABLE`) with a unit that table
 * allows — nothing a provider writes is stored, and over MAX_CANDIDATES is a
 * refusal, not a slice.
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
  type AiUsage,
  type CandidateRecord,
  type ClassificationResult,
  type ContextManifest,
  type ContextRecord,
  type ContractRefusalCode,
  type ExtractionResult,
  type SegmentClass,
} from "./types.ts";
import { hasObfuscation, normalizeForMatch, scrubText } from "./scrub.ts";
import { CANDIDATE_TABLE } from "./extract.ts";
import { DOCUMENT_KINDS } from "../domain.ts";

export type ForbiddenGroup = { code: ContractRefusalCode; re: RegExp };

const EN: readonly ForbiddenGroup[] = [
  {
    code: "forbidden_dose",
    re: /\b(take|taking|swallow|ingest|consume|apply|inject|inhale|start|begin|use|stop|increase|decrease|double|halve|reduce|raise|continue|switch to|add)\b[^.\n]{0,60}\b\d{1,5}(\.\d{1,3})?\s{0,2}(mg|mcg|µg|g|ml|iu|units?|tablets?|tabs?|capsules?|caps?|drops?|puffs?)\b/,
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
    // The negations are the modal ones ("should not see", "need not visit",
    // "no point in seeing"); "do not" and "never" are left out on purpose,
    // because "do not delay seeing a doctor" is the sentence a health
    // assistant SHOULD say, and the lookahead keeps even a modal off it.
    re: /\b(no need|don\x27?t need|do not need|unnecessary|not necessary|no reason|no point( in)?|need ?not|needn\x27?t|should ?not|shouldn\x27?t|must ?not|mustn\x27?t|not bother)(?! (delay|wait|hesitate|postpone|put off|put it off|ignore|avoid|skip|miss))\b[^.\n]{0,16}\b(see|seeing|visit|visiting|consult|consulting|call|calling|go to|going to|bother)\b[^.\n]{0,16}\b(doctor|physician|hospital|emergency|clinic|er|appointment|checkup|check-up|follow-up)\b|\b(skip|avoid|ignore|cancel|miss) (the|your) (appointment|doctor|checkup|check-up|follow-up)\b|\bnot an emergency\b/,
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
  // "u" is second person unless it is a unit ("u/l"); the lookahead keeps ALT in U/L.
  en: /\b(you|your|yours|yourself|you\x27re|you\x27ve|you\x27ll|you\x27d|ur|urself|thou|thee|thy|thine|yall|y\x27all)\b|\bu\b(?!\/)/,
  hi: new RegExp(HI_SECOND.source.normalize("NFKC"), "u"),
  bn: new RegExp(BN_SECOND.source.normalize("NFKC"), "u"),
};

/**
 * Advice addressed to the reader, which a record_fact (or an interpretation)
 * may not carry whatever it cites: a modal on the second person. Possessives
 * stay allowed — "your HbA1c on 14 Mar was 6.1" is a fact.
 */
const ADVICE: Record<AiLanguage, RegExp> = {
  en: /\byou (should|must|need to|ought to|have to|had better|shouldn\x27?t|mustn\x27?t|should ?not|must ?not|need ?not|needn\x27?t|can stop|may stop|can skip|may skip)\b/,
  hi: new RegExp(
    /(आप|आपको|तुम|तुम्हें).{0,30}(चाहिए|कीजिए|लीजिए|खाइए|करना होगा|मत )/.source.normalize("NFKC"),
    "u",
  ),
  bn: new RegExp(
    /(আপনি|আপনার|আপনাকে|তুমি|তোমার|তোমাকে).{0,30}(উচিত|করুন|নিন|খান|খাবেন না|করবেন না)/.source.normalize(
      "NFKC",
    ),
    "u",
  ),
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
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  lakh: 100000,
  lac: 100000,
  crore: 10000000,
  million: 1000000,
  billion: 1000000000,
  dozen: 12,
  half: 0.5,
  quarter: 0.25,
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
  बीस: 20,
  तीस: 30,
  चालीस: 40,
  पचास: 50,
  सौ: 100,
  हज़ार: 1000,
  हजार: 1000,
  लाख: 100000,
  करोड़: 10000000,
  आधा: 0.5,
  आधी: 0.5,
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
  বিশ: 20,
  ত্রিশ: 30,
  চল্লিশ: 40,
  পঞ্চাশ: 50,
  শত: 100,
  একশো: 100,
  হাজার: 1000,
  লাখ: 100000,
  কোটি: 10000000,
  অর্ধেক: 0.5,
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

/** Number words replaced by digits, token by token, so "fifty mg" reads as "50 mg". */
export function digitizeNumberWords(normText: string): string {
  return normText.replace(/[\p{L}\p{M}]+/gu, (token) =>
    Object.prototype.hasOwnProperty.call(NUMBER_WORDS_NFKC, token)
      ? String(NUMBER_WORDS_NFKC[token])
      : token,
  );
}

/** Sentence punctuation before a space or the end becomes a space; "6.1" is untouched. */
export function unpunctuate(normText: string): string {
  return normText.replace(/[.!?;:](?=\s|$)/g, " ");
}

/**
 * The numbers a fact citing these records is allowed to contain: each
 * record's value (at three roundings) and the digits inside its display,
 * unit and note. NOT the date — a fact quotes the date only as the record's
 * `dateLabel`, which `validateAiResponse` strips before reading numbers —
 * and NOT the count of citations.
 */
export function allowedNumbers(records: readonly ContextRecord[]): Set<string> {
  const allowed = new Set<string>();
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

function refuse(code: ContractRefusalCode): { ok: false; code: ContractRefusalCode } {
  return { ok: false, code };
}

export function forbiddenIn(normText: string, language: AiLanguage): ContractRefusalCode | null {
  const groups = language === "en" ? EN : [...EN, ...FORBIDDEN_GROUPS[language]];
  const text = digitizeNumberWords(unpunctuate(normText));
  for (const g of groups) if (g.re.test(text)) return g.code;
  return null;
}

/**
 * ONE record as the person wrote it — display, value with unit, note — as a
 * single string. What one record says by itself may be echoed back to its
 * owner; what two records say only when combined, or what a provider adds
 * around one, may not.
 */
function ownText(r: ContextRecord): string {
  return [
    r.display,
    r.valueNum !== null ? `${r.valueNum} ${r.valueUnit ?? ""}` : (r.valueUnit ?? ""),
    r.valueText ?? "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
}

/** True when some cited record, by itself, trips this very group. */
function citedFieldTrips(
  cited: readonly ContextRecord[],
  code: ContractRefusalCode,
  language: AiLanguage,
): boolean {
  return cited.some((r) => forbiddenIn(normalizeForMatch(ownText(r)), language) === code);
}

function advises(norm: string, language: AiLanguage): boolean {
  return ADVICE.en.test(norm) || (language !== "en" && ADVICE[language].test(norm));
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
  const normAll: string[] = [];
  const citedAll: ContextRecord[] = [];
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
        if (advises(norm, language)) return refuse("fact_advises_reader");
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
        if (advises(norm, language)) return refuse("fact_advises_reader");
        break;
      }
    }

    // Text safety, on the masked text.
    if (hasObfuscation(s.text)) return refuse("obfuscated_output");
    const masked = maskCited(norm, cited);
    if (scrubText(masked).redactions > 0) return refuse("identifier_in_output");
    const forbidden = forbiddenIn(masked, language);
    if (forbidden) return refuse(forbidden);
    // Unmasked too: a cited fragment wrapped in an instruction is an
    // instruction, unless the person's own field IS the instruction.
    const unmasked = forbiddenIn(norm, language);
    if (unmasked && !citedFieldTrips(cited, unmasked, language)) return refuse(unmasked);
    maskedAll.push(masked);
    normAll.push(norm);
    for (const c of cited) if (!citedAll.includes(c)) citedAll.push(c);
  }

  if (total > LIMITS.MAX_RESPONSE_CHARS) return refuse("response_too_long");
  // Second pass over the join: a dose split across two segments is still a dose.
  const forbiddenJoined = forbiddenIn(maskedAll.join(" "), language);
  if (forbiddenJoined) return refuse(forbiddenJoined);
  const unmaskedJoined = forbiddenIn(normAll.join(" "), language);
  if (unmaskedJoined && !citedFieldTrips(citedAll, unmaskedJoined, language)) {
    return refuse(unmaskedJoined);
  }
  return { ok: true };
}

/* --------------------------------------------- the non-response kinds -- */

const METHOD = /^[a-z0-9][a-z0-9:_.-]{0,31}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function usageOk(usage: unknown): usage is AiUsage {
  const u = usage as Partial<AiUsage> | null;
  return (
    !!u &&
    typeof u === "object" &&
    typeof u.inputTokens === "number" &&
    typeof u.outputTokens === "number" &&
    Number.isFinite(u.inputTokens) &&
    Number.isFinite(u.outputTokens) &&
    u.inputTokens >= 0 &&
    u.outputTokens >= 0
  );
}

function unit01(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

export type ClassificationVerdict =
  | { ok: true; value: ClassificationResult; usage: AiUsage }
  | { ok: false; code: ContractRefusalCode };

/** A classification rebuilt from exactly {kind ∈ DOCUMENT_KINDS, confidence ∈ [0,1], method}. */
export function validateClassification(raw: unknown, usage: unknown): ClassificationVerdict {
  if (!usageOk(usage)) return refuse("usage_shape");
  if (!raw || typeof raw !== "object") return refuse("classification_shape");
  const c = raw as Partial<ClassificationResult>;
  if (typeof c.kind !== "string" || !(DOCUMENT_KINDS as readonly string[]).includes(c.kind)) {
    return refuse("classification_shape");
  }
  if (!unit01(c.confidence)) return refuse("classification_shape");
  if (typeof c.method !== "string" || !METHOD.test(c.method)) return refuse("classification_shape");
  return {
    ok: true,
    value: { kind: c.kind, confidence: c.confidence, method: c.method },
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

export type ExtractionVerdict =
  { ok: true; value: ExtractionResult; usage: AiUsage } | { ok: false; code: ContractRefusalCode };

/**
 * Every candidate must be an entry of `CANDIDATE_TABLE` — display, code and
 * kind the table's, the unit one the table allows — with a finite value, a
 * confidence in [0,1] and an ISO instant. Over MAX_CANDIDATES is a refusal.
 * The value returned is REBUILT from those fields; the provider's object is
 * never stored.
 */
/** A count from a provider: a non-negative integer, or 0. Never trusted raw. */
function countOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

export function validateExtraction(raw: unknown, usage: unknown): ExtractionVerdict {
  if (!usageOk(usage)) return refuse("usage_shape");
  if (!raw || typeof raw !== "object") return refuse("extraction_shape");
  const e = raw as Partial<ExtractionResult>;
  if (!Array.isArray(e.candidates)) return refuse("extraction_shape");
  if (e.candidates.length > LIMITS.MAX_CANDIDATES) return refuse("too_many_candidates");
  if (typeof e.method !== "string" || !METHOD.test(e.method)) return refuse("extraction_shape");
  if (
    typeof e.textChars !== "number" ||
    !Number.isInteger(e.textChars) ||
    e.textChars < 0 ||
    e.textChars > LIMITS.MAX_DOCUMENT_CHARS
  ) {
    return refuse("extraction_shape");
  }
  const candidates: CandidateRecord[] = [];
  for (const c of e.candidates as Partial<CandidateRecord>[]) {
    if (!c || typeof c !== "object") return refuse("extraction_shape");
    const code = c.code;
    if (
      !code ||
      typeof code !== "object" ||
      code.system !== "ONIQ" ||
      typeof code.code !== "string"
    ) {
      return refuse("candidate_outside_table");
    }
    if (!Object.prototype.hasOwnProperty.call(CANDIDATE_TABLE, code.code)) {
      return refuse("candidate_outside_table");
    }
    const entry = CANDIDATE_TABLE[code.code];
    if (
      c.kind !== entry.kind ||
      c.display !== entry.display ||
      code.display !== entry.codeDisplay
    ) {
      return refuse("candidate_outside_table");
    }
    if (typeof c.valueNum !== "number" || !Number.isFinite(c.valueNum)) {
      return refuse("extraction_shape");
    }
    let valueUnit: string | undefined;
    if (c.valueUnit !== undefined) {
      if (
        typeof c.valueUnit !== "string" ||
        c.valueUnit.length === 0 ||
        c.valueUnit.length > LIMITS.MAX_UNIT_CHARS ||
        !entry.units.some((u) => u.test(c.valueUnit as string))
      ) {
        return refuse("candidate_outside_table");
      }
      valueUnit = c.valueUnit;
    }
    if (!unit01(c.confidence)) return refuse("extraction_shape");
    if (
      typeof c.effectiveAt !== "string" ||
      !ISO_INSTANT.test(c.effectiveAt) ||
      Number.isNaN(Date.parse(c.effectiveAt))
    ) {
      return refuse("extraction_shape");
    }
    candidates.push({
      kind: entry.kind,
      display: entry.display,
      valueNum: c.valueNum,
      valueUnit,
      effectiveAt: new Date(c.effectiveAt).toISOString(),
      confidence: c.confidence,
      code: { system: "ONIQ", code: code.code, display: entry.codeDisplay },
    });
  }
  return {
    ok: true,
    value: {
      candidates,
      method: e.method,
      textChars: e.textChars,
      proposed: countOf(e.proposed),
      unusable: countOf(e.unusable),
    },
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

export function isContractCode(code: unknown): code is ContractRefusalCode {
  return typeof code === "string" && (CONTRACT_REFUSAL_CODES as readonly string[]).includes(code);
}
