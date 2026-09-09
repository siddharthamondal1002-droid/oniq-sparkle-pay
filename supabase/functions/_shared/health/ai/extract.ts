/**
 * ONIQ HEALTH AI — candidate records from report text, by rules.
 *
 * Finds the analytes a lab report names, the number beside each, and the
 * unit if one is printed, and turns each into a CANDIDATE — status
 * `candidate`, provenance `document_extraction`, a confidence — that the
 * person confirms or rejects. Nothing here enters the timeline on its own.
 *
 * THE DISPLAY IS THE TABLE'S, NEVER THE DOCUMENT'S. A candidate's name comes
 * from the closed analyte list below, so injected or garbled report text
 * cannot become a record's label; only the number and, when it matches a
 * known pattern, the unit come from the page. There is no `valueText`
 * candidate at all — a free-text candidate would be the document talking.
 *
 * CODES ARE ONIQ'S OWN, NOT LOINC. A LOINC code typed from memory into a
 * candidate would travel into a FHIR export unverified (Phase 4). The
 * analyte ids below are internal; the LOINC mapping is a Phase 4 table
 * written from the LOINC download, not from recall.
 *
 * EVERY PATTERN HAS BOUNDED GAPS (`aiRegexSafety.test.ts`): the text can be
 * 20,000 attacker-chosen characters.
 */
import { LIMITS, type CandidateRecord, type ExtractionResult } from "./types.ts";

export const EXTRACT_METHOD = "rules:v1";

type Analyte = { id: string; display: string; re: RegExp; units: readonly RegExp[] };

const U = {
  gdl: /^g\/dl$/i,
  gl: /^g\/l$/i,
  mgdl: /^mg\/dl$/i,
  mmoll: /^mmol\/l$/i,
  pct: /^%$/,
  uiu: /^(?:[µu]iu\/ml|miu\/l)$/i,
  ngml: /^ng\/ml$/i,
  ngdl: /^ng\/dl$/i,
  ugdl: /^[µu]g\/dl$/i,
  pgml: /^pg\/ml$/i,
  ul: /^(?:u\/l|iu\/l)$/i,
  mgl: /^mg\/l$/i,
  mmhr: /^mm\/(?:hr|h|1st hr)$/i,
  count:
    /^(?:(?:x\s?)?10\^?[39]\/(?:[µu]l|l)|\/(?:[µu]l|cumm|cu\.?mm)|lakhs?\/cumm|cells\/(?:[µu]l|cumm))$/i,
  meq: /^meq\/l$/i,
};

const ANALYTES: readonly Analyte[] = [
  {
    id: "hb",
    display: "Haemoglobin",
    re: /\b(?:haemoglobin|hemoglobin|hb)\b/i,
    units: [U.gdl, U.gl],
  },
  { id: "hba1c", display: "HbA1c", re: /\bhba1c\b/i, units: [U.pct, U.mmoll] },
  {
    id: "glucose_fasting",
    display: "Fasting glucose",
    re: /\b(?:fasting (?:blood |plasma )?(?:glucose|sugar)|fbs|fbg)\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "glucose_pp",
    display: "Post-prandial glucose",
    re: /\b(?:post[- ]?prandial (?:blood |plasma )?(?:glucose|sugar)|ppbs|ppbg)\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "glucose_random",
    display: "Random glucose",
    re: /\b(?:random (?:blood |plasma )?(?:glucose|sugar)|rbs)\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "cholesterol_total",
    display: "Total cholesterol",
    re: /\b(?:total cholesterol|cholesterol,? total|serum cholesterol)\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "ldl",
    display: "LDL cholesterol",
    re: /\bldl(?: cholesterol)?\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "hdl",
    display: "HDL cholesterol",
    re: /\bhdl(?: cholesterol)?\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "triglycerides",
    display: "Triglycerides",
    re: /\btriglycerides?\b/i,
    units: [U.mgdl, U.mmoll],
  },
  {
    id: "creatinine",
    display: "Creatinine",
    re: /\b(?:serum )?creatinine\b/i,
    units: [U.mgdl, U.mmoll],
  },
  { id: "urea", display: "Urea", re: /\b(?:blood |serum )?urea\b/i, units: [U.mgdl, U.mmoll] },
  {
    id: "uric_acid",
    display: "Uric acid",
    re: /\b(?:serum )?uric acid\b/i,
    units: [U.mgdl, U.mmoll],
  },
  { id: "calcium", display: "Calcium", re: /\b(?:serum )?calcium\b/i, units: [U.mgdl, U.mmoll] },
  { id: "tsh", display: "TSH", re: /\btsh\b/i, units: [U.uiu] },
  { id: "t3", display: "T3 (total)", re: /\b(?:total )?t3\b/i, units: [U.ngdl, U.ngml] },
  { id: "t4", display: "T4 (total)", re: /\b(?:total )?t4\b/i, units: [U.ugdl, U.ngdl] },
  { id: "esr", display: "ESR", re: /\b(?:esr|erythrocyte sedimentation rate)\b/i, units: [U.mmhr] },
  { id: "crp", display: "CRP", re: /\b(?:crp|c[- ]reactive protein)\b/i, units: [U.mgl, U.mgdl] },
  {
    id: "vitd",
    display: "Vitamin D (25-OH)",
    re: /\bvitamin d(?:3)?\b|\b25[- ]?oh\b/i,
    units: [U.ngml],
  },
  { id: "b12", display: "Vitamin B12", re: /\bvitamin b12\b|\bb12\b/i, units: [U.pgml] },
  {
    id: "platelets",
    display: "Platelet count",
    re: /\bplatelets?(?: count)?\b/i,
    units: [U.count],
  },
  {
    id: "wbc",
    display: "WBC count",
    re: /\b(?:wbc|total leu[ck]ocyte count|tlc)\b/i,
    units: [U.count],
  },
  { id: "rbc", display: "RBC count", re: /\brbc(?: count)?\b/i, units: [U.count] },
  {
    id: "sodium",
    display: "Sodium",
    re: /\b(?:serum )?sodium\b|\bna\+\b/i,
    units: [U.meq, U.mmoll],
  },
  {
    id: "potassium",
    display: "Potassium",
    re: /\b(?:serum )?potassium\b|\bk\+\b/i,
    units: [U.meq, U.mmoll],
  },
  { id: "alt", display: "ALT (SGPT)", re: /\b(?:alt|sgpt)\b/i, units: [U.ul] },
  { id: "ast", display: "AST (SGOT)", re: /\b(?:ast|sgot)\b/i, units: [U.ul] },
  {
    id: "bilirubin_total",
    display: "Total bilirubin",
    re: /\b(?:total )?bilirubin\b/i,
    units: [U.mgdl],
  },
];

export type CandidateEntry = {
  kind: "lab" | "vital";
  display: string;
  codeDisplay: string;
  units: readonly RegExp[];
};

const MMHG = /^mmhg$/i;

/**
 * THE CLOSED TABLE A CANDIDATE MUST COME FROM, keyed by ONIQ code. The
 * extractor below builds candidates from it, and `validateExtraction` in
 * contract.ts admits nothing that is not in it — a provider that returns
 * document text as a display, a code or a unit is refused, never stored.
 */
export const CANDIDATE_TABLE: Readonly<Record<string, CandidateEntry>> = Object.freeze(
  Object.fromEntries([
    ...ANALYTES.map((a): [string, CandidateEntry] => [
      a.id,
      { kind: "lab", display: a.display, codeDisplay: a.display, units: a.units },
    ]),
    [
      "bp_sys",
      {
        kind: "vital",
        display: "Blood pressure (systolic)",
        codeDisplay: "Systolic blood pressure",
        units: [MMHG],
      } satisfies CandidateEntry,
    ],
    [
      "bp_dia",
      {
        kind: "vital",
        display: "Blood pressure (diastolic)",
        codeDisplay: "Diastolic blood pressure",
        units: [MMHG],
      } satisfies CandidateEntry,
    ],
  ]),
);

/**
 * THE UNIT IS THE EVIDENCE THAT A NUMBER IS A RESULT — and the old rule had
 * it the other way round, which is how a wrong value could reach a timeline.
 *
 * MEASURED 2026-09-09, against report LAYOUTS rather than the tidy one-line
 * fixtures this repo had invented for itself. The old rule took the FIRST
 * number after the analyte name, within 24 characters and no newline, and
 * treated the unit as decoration that merely raised the confidence:
 *
 *     "Haemoglobin   13.0 - 17.0   13.2  g/dL"  ->  Haemoglobin = 13.0  WRONG
 *     "Haemoglobin   Male 18-60 yrs 13.2 g/dL"  ->  Haemoglobin = 18    WRONG
 *     "Haemoglobin   Sample 4471    13.2 g/dL"  ->  Haemoglobin = 4471  WRONG
 *
 * A reference-range bound, an age band and a sample id, each stored as
 * somebody's blood result. GROUNDING CANNOT CATCH ONE OF THEM: every such
 * number IS printed on the page, which is all grounding checks. And since the
 * owner's 2026-09-09 directive removed the per-value confirm step, nothing
 * stands between that number and the person's timeline.
 *
 * The same 24-character no-newline window ALSO found nothing at all on
 * ordinary shapes — a padded label column, or a method/specimen column
 * between the name and the value — which is why the owner's own 8-page,
 * 14,780-character report produced `count: 0`, twice, with `dropped: 0`.
 *
 * So the rule is inverted: scan the analyte's OWN ROW for the first number
 * followed by a unit that analyte is measured in, and take that one. A number
 * with no unit after it is not a result; a number on one side of a dash from
 * another number is a range bound, not a result. The false positives and the
 * false negatives are the same fix, because both came from believing the
 * first number.
 *
 * WHAT IS GIVEN UP, stated rather than glossed: a report printing no unit for
 * an analyte now yields nothing for it, where it used to yield a number that
 * was probably not the result. Zero is the safe direction; a wrong lab value
 * in a medical timeline is not.
 *
 * STILL NOT READ, deliberately: a value on a DIFFERENT LINE from its label,
 * which is how some PDF text layers emit a table. Crossing a newline means
 * guessing which row a number belongs to, and guessing wrong files one
 * analyte's number under another's name — the exact failure this change ends.
 * That needs real report samples, not more fixtures invented here.
 */
/**
 * THE UNIT IS CAPTURED AS TWO TOKENS AND TESTED BOTH WAYS, because a
 * single greedy group swallowed the next word: on
 * "Haemoglobin 12.1 g/dL take 2 tablets daily" it captured "g/dL take", which
 * matches no unit, and the whole reading was lost. Two tokens exist at all
 * for counts written "x 10^3/µL".
 *
 * AND THE NUMBER CARRIES NO SIGN. A leading "-" was being read as a minus,
 * so "Haemoglobin (13.0-17.0 g/dL)" returned a haemoglobin of MINUS 17 — the
 * range's upper bound, negated by the dash that separated it. None of the
 * analytes here can be negative, so a "-" is a range separator, and dropping
 * the sign is what lets RANGE_BEFORE see it.
 */
const NUMBER_THEN_UNIT =
  /(\d{1,6}(?:\.\d{1,3})?)\s{0,12}([A-Za-z%µ][A-Za-z0-9%µ^./]{0,10})(?:\s([A-Za-z0-9][A-Za-z0-9%µ^./]{0,8}))?/g;
/** A number a dash away from another number is a range bound. */
const RANGE_BEFORE = /\d\s{0,2}[-–—]\s{0,2}$/;
const RANGE_AFTER = /^\s{0,2}[-–—]\s{0,2}\d/;
/** How far along its own row a result may sit, and the bounds that keep the scan linear. */
const ROW_TAIL = 160;
const MAX_NAME_HITS = 20;
const MAX_ROW_NUMBERS = 20;

/** The first number on the analyte's own row that carries one of its units. */
function resultOnRow(src: string, a: Analyte): { valueNum: number; unit: string } | null {
  const name = new RegExp(a.re.source, "gi");
  let hits = 0;
  for (let m = name.exec(src); m !== null && hits < MAX_NAME_HITS; m = name.exec(src)) {
    hits += 1;
    const from = m.index + m[0].length;
    const newline = src.indexOf("\n", from);
    const rowEnd = Math.min(newline === -1 ? src.length : newline, from + ROW_TAIL);
    const row = src.slice(from, rowEnd);
    NUMBER_THEN_UNIT.lastIndex = 0;
    let seen = 0;
    for (
      let n = NUMBER_THEN_UNIT.exec(row);
      n !== null && seen < MAX_ROW_NUMBERS;
      n = NUMBER_THEN_UNIT.exec(row)
    ) {
      seen += 1;
      const valueNum = Number(n[1]);
      if (!Number.isFinite(valueNum)) continue;
      const one = n[2].trim();
      const two = n[3] ? `${one} ${n[3].trim()}` : null;
      const unit = a.units.some((u) => u.test(one))
        ? one
        : two && a.units.some((u) => u.test(two))
          ? two
          : null;
      if (unit === null) continue;
      const before = row.slice(Math.max(0, n.index - 8), n.index);
      const after = row.slice(n.index + n[1].length, n.index + n[1].length + 8);
      if (RANGE_BEFORE.test(before) || RANGE_AFTER.test(after)) continue;
      return { valueNum, unit };
    }
  }
  return null;
}

const DATE =
  /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b|\b(\d{1,2})\s{1,2}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,7}\.?\s{1,2}(\d{4})\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The first date printed on the report, as YYYY-MM-DD, or null. */
export function reportDay(text: string): string | null {
  const m = DATE.exec(text);
  if (!m) return null;
  let iso: string | null = null;
  if (m[1]) iso = m[1];
  else if (m[2] && m[3] && m[4]) iso = `${m[4]}-${m[3].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  else if (m[5] && m[6] && m[7]) {
    const mo = MONTHS.indexOf(m[6].slice(0, 3).toLowerCase()) + 1;
    iso = `${m[7]}-${String(mo).padStart(2, "0")}-${m[5].padStart(2, "0")}`;
  }
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

function noonUtc(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/**
 * `fallbackDay` is the document's captured day (or its upload day) — never
 * the epoch and never a record from somewhere else: a candidate with no date
 * printed on the page is dated to the page.
 */
export function extractCandidates(text: string, fallbackDay: string): ExtractionResult {
  const candidates: CandidateRecord[] = [];
  const src = (text ?? "").slice(0, LIMITS.MAX_DOCUMENT_CHARS);
  const effectiveAt = noonUtc(reportDay(src) ?? fallbackDay);
  for (const a of ANALYTES) {
    if (candidates.length >= LIMITS.MAX_CANDIDATES) break;
    const hit = resultOnRow(src, a);
    if (!hit) continue;
    candidates.push({
      kind: "lab",
      display: a.display,
      valueNum: hit.valueNum,
      valueUnit: hit.unit.slice(0, LIMITS.MAX_UNIT_CHARS),
      effectiveAt,
      confidence: 0.8,
      code: { system: "ONIQ", code: a.id, display: a.display },
    });
  }
  const bp = /\b(?:bp|blood pressure)\b[^\d\n]{0,12}(\d{2,3})\s{0,2}\/\s{0,2}(\d{2,3})\b/i.exec(
    src,
  );
  if (bp && candidates.length + 2 <= LIMITS.MAX_CANDIDATES) {
    candidates.push(
      {
        kind: "vital",
        display: "Blood pressure (systolic)",
        valueNum: Number(bp[1]),
        valueUnit: "mmHg",
        effectiveAt,
        confidence: 0.75,
        code: { system: "ONIQ", code: "bp_sys", display: "Systolic blood pressure" },
      },
      {
        kind: "vital",
        display: "Blood pressure (diastolic)",
        valueNum: Number(bp[2]),
        valueUnit: "mmHg",
        effectiveAt,
        confidence: 0.75,
        code: { system: "ONIQ", code: "bp_dia", display: "Diastolic blood pressure" },
      },
    );
  }
  // The rules extractor builds straight from the closed table, so nothing it
  // proposes can be refused by it: `unusable` is 0 by construction here, and
  // the number that matters on this path is how many it found at all.
  return {
    candidates,
    method: EXTRACT_METHOD,
    textChars: src.length,
    proposed: candidates.length,
    unusable: 0,
  };
}
