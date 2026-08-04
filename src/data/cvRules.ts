// ONIQ CV rules registry — Phase 4 of the Education & Careers loop.
//
// Pure data + pure helpers. No React, no network, no database.
//
// SCOPE RULE (one-way door): everything here is CANDIDATE-SIDE. It describes
// how a person should present their OWN CV in a given country. There is no
// ranking, no scoring, no comparison of one candidate against another and no
// employer-facing view anywhere in this module or anything that imports it.
// Candidate-side writing tools sit outside NYC LL144, Illinois HB3773 and the
// EU AI Act Annex III employment provisions (whose high-risk obligations were
// postponed to 2 December 2027) precisely because they never screen anyone.
//
// Sourcing note: these are conventions, not law. Where official guidance
// exists it is named in `why`. Nothing here claims a CV will "pass" or "beat"
// an applicant tracking system — see ATS_RULES below for why that language is
// banned in this codebase.

import type { Country } from "@/data/appRegistry";

/**
 * How strongly a country's convention treats a field.
 *   expected     — leave it out and the CV looks incomplete locally
 *   common       — widely included, not required
 *   sometimes    — situational
 *   discouraged  — usually a mistake, not a legal problem
 *   avoid/never  — do not put it on the document
 */
export type FieldStance = "expected" | "common" | "sometimes" | "discouraged" | "avoid" | "never";

export type FieldRule = {
  stance: FieldStance;
  /** One user-facing sentence. Must be accurate, never scare-copy. */
  note: string;
};

export type ReferencesMode =
  /** Leave references off entirely — and do not print the phrase either. */
  | "omit"
  /** "References available on request" is still normal here. */
  | "on_request"
  /** Genuinely split convention — ask the user which they want. */
  | "user_choice";

export type CvLength = {
  min: number;
  max: number;
  note: string;
};

export type CvSpelling = "en-IN" | "en-US" | "en-GB" | "en-CA" | "en-AU";

export type CvRules = {
  country: Country;
  photo: FieldRule;
  dobAge: FieldRule;
  maritalReligion: FieldRule;
  nationality: FieldRule;
  workStatus: FieldRule;
  nationalId: FieldRule;
  salary: FieldRule;
  noticePeriod: FieldRule;
  length: CvLength;
  spelling: CvSpelling;
  references: ReferencesMode;
  referencesNote: string;
  /** Extra country context worth showing the user, each a full sentence. */
  context: string[];
  /** Structured extras the surface may offer for this country only. */
  specials: CvSpecial[];
};

export type CvSpecial =
  | "au_public_sector_star"
  | "ca_canadian_experience"
  | "in_psu_category"
  | "sg_nric_warning"
  | "in_ctc_channel";

/** Fields the CV composer can carry. Order is the on-document order. */
export type CvSensitiveField =
  | "photo"
  | "dobAge"
  | "maritalReligion"
  | "nationality"
  | "workStatus"
  | "nationalId"
  | "salary"
  | "noticePeriod";

export const SENSITIVE_FIELDS: CvSensitiveField[] = [
  "photo",
  "dobAge",
  "maritalReligion",
  "nationality",
  "workStatus",
  "nationalId",
  "salary",
  "noticePeriod",
];

export const CV_RULES: Record<Country, CvRules> = {
  IN: {
    country: "IN",
    photo: { stance: "common", note: "A plain passport-style photo is common on Indian CVs." },
    dobAge: { stance: "common", note: "Date of birth is commonly included, especially for government and PSU roles." },
    maritalReligion: {
      stance: "common",
      note: "Marital status and similar personal details still appear on the older biodata format.",
    },
    nationality: { stance: "sometimes", note: "Usually only when applying outside your home state or abroad." },
    workStatus: { stance: "sometimes", note: "Worth stating if you hold a visa for another country." },
    nationalId: {
      stance: "avoid",
      note: "Never print your Aadhaar number. Employers who need it ask after an offer.",
    },
    salary: {
      stance: "common",
      note: "Current and expected CTC are normal to disclose — but usually in the Naukri profile, the recruiter form or the screening call rather than on the document.",
    },
    noticePeriod: {
      stance: "expected",
      note: "Recruiters ask for it early. Keep it ready; it more often belongs in the application form than in the CV body.",
    },
    length: {
      min: 1,
      max: 3,
      note: "One page for freshers — treat that as non-negotiable. Two pages is standard once you have experience, three only for 15+ years or academic histories.",
    },
    spelling: "en-IN",
    references: "on_request",
    referencesNote: "\"References available on request\" is still normal in India.",
    context: [
      "Government and PSU applications follow their own prescribed form — the conventions below are for private-sector CVs.",
    ],
    specials: ["in_psu_category", "in_ctc_channel"],
  },
  US: {
    country: "US",
    photo: {
      stance: "never",
      note: "US resumes do not carry photos. Employers are advised by the EEOC not to solicit them, because the information becomes evidence they knew of protected-class membership.",
    },
    dobAge: {
      stance: "never",
      note: "Leave age and date of birth off. Pre-employment questions about age are not themselves prohibited in the US, but the risk to you is real and there is no upside.",
    },
    maritalReligion: { stance: "never", note: "Marital status, religion and family details never appear on a US resume." },
    nationality: { stance: "never", note: "Not included. State work authorisation only if the posting asks." },
    workStatus: { stance: "never", note: "Only mention it if the posting explicitly asks about sponsorship." },
    nationalId: { stance: "never", note: "Never put a Social Security Number on a resume." },
    salary: { stance: "never", note: "Salary history is off the document, and asking for it is restricted in several states." },
    noticePeriod: { stance: "never", note: "Not a US concept on the resume. Discuss availability in the conversation." },
    length: {
      min: 1,
      max: 2,
      note: "One page early career (roughly under five years), two pages once you are experienced. Two pages is not a problem for parsers or recruiters.",
    },
    spelling: "en-US",
    references: "omit",
    referencesNote: "Leave references out entirely — and do not print \"References available on request\" either. Keep them in a separate document.",
    context: [],
    specials: [],
  },
  GB: {
    country: "GB",
    photo: {
      stance: "never",
      note: "UK CVs carry no photo. Acas and ICO recruitment guidance advise employers not to collect one.",
    },
    dobAge: { stance: "never", note: "Date of birth and age are left off UK CVs." },
    maritalReligion: { stance: "never", note: "Personal details of this kind do not belong on a UK CV." },
    nationality: { stance: "never", note: "Not included as standard." },
    workStatus: { stance: "never", note: "Only state right-to-work if the posting asks." },
    nationalId: { stance: "never", note: "Never include a National Insurance number." },
    salary: { stance: "never", note: "Salary is a conversation, not a CV line." },
    noticePeriod: { stance: "never", note: "Raise it at offer stage rather than on the CV." },
    length: { min: 2, max: 2, note: "Two pages is the UK standard." },
    spelling: "en-GB",
    references: "omit",
    referencesNote: "Omit references and the phrase \"References available on request\" — UK guidance treats it as redundant filler.",
    context: [],
    specials: [],
  },
  AE: {
    country: "AE",
    photo: { stance: "expected", note: "A professional headshot is expected on a UAE CV." },
    dobAge: { stance: "common", note: "Date of birth is commonly included in the UAE." },
    maritalReligion: { stance: "sometimes", note: "Marital status appears on some UAE CVs; it is optional." },
    nationality: { stance: "expected", note: "Nationality is expected on a UAE CV." },
    workStatus: {
      stance: "expected",
      note: "Be specific: visa type and status, and whether you hold an NOC or need sponsorship transfer.",
    },
    nationalId: {
      stance: "sometimes",
      note: "Emirates ID is shared after an offer, not on the CV itself.",
    },
    salary: {
      stance: "expected",
      note: "Current and expected salary are expected, as a monthly AED range — e.g. \"Expected Salary: AED 18,000–22,000\" or \"Negotiable based on full package\".",
    },
    noticePeriod: { stance: "expected", note: "State it plainly — \"Immediate\" or \"30 days\"." },
    length: { min: 2, max: 2, note: "Two pages is the UAE norm." },
    spelling: "en-GB",
    references: "on_request",
    referencesNote: "\"References available on request\" is normal in the UAE.",
    context: [],
    specials: [],
  },
  CA: {
    country: "CA",
    photo: {
      stance: "never",
      note: "No photo. The Ontario Human Rights Commission advises employers not to ask for one, and Code s.23(2) restricts such questions on applications.",
    },
    dobAge: { stance: "never", note: "Age and date of birth are left off Canadian resumes." },
    maritalReligion: { stance: "never", note: "Marital status, religion and family details are not included." },
    nationality: { stance: "never", note: "Not included; state work eligibility only if asked." },
    workStatus: { stance: "never", note: "Mention eligibility to work only where the posting asks." },
    nationalId: { stance: "never", note: "Never include a Social Insurance Number." },
    salary: { stance: "never", note: "Salary is not a resume field in Canada." },
    noticePeriod: { stance: "never", note: "Handled in conversation, not on the resume." },
    length: { min: 1, max: 2, note: "One to two pages." },
    spelling: "en-CA",
    references: "omit",
    referencesNote: "Omit references and the phrase — Indeed Canada lists \"References available on request\" as outdated.",
    context: [
      "The \"Canadian experience\" barrier is real. The Ontario Human Rights Commission's 2013 Policy on Removing the Canadian Experience Barrier treats a strict Canadian-experience requirement as prima facie discrimination. Present your international experience fully — do not hide it.",
    ],
    specials: ["ca_canadian_experience"],
  },
  AU: {
    country: "AU",
    photo: { stance: "never", note: "Australian CVs do not carry photos." },
    dobAge: { stance: "never", note: "Date of birth and age are left off." },
    maritalReligion: { stance: "never", note: "Personal details of this kind are not included." },
    nationality: { stance: "never", note: "Not included as standard." },
    workStatus: { stance: "never", note: "State work rights only where the posting asks." },
    nationalId: { stance: "never", note: "Never include a Tax File Number." },
    salary: { stance: "never", note: "Salary is not a CV field in Australia." },
    noticePeriod: { stance: "never", note: "Discussed at offer stage." },
    length: {
      min: 1,
      max: 2,
      note: "SEEK, Australia's dominant job board, says one to two pages. Three or more is accepted for senior, academic or unusually long histories.",
    },
    spelling: "en-AU",
    references: "user_choice",
    referencesNote:
      "Australia is genuinely split: some CVs list two or three referees in full, others write \"contact details available on request\". Pick whichever you prefer.",
    context: [
      "Australian public-sector roles usually require separate written responses to selection criteria, commonly in STAR format (Situation, Task, Action, Result).",
    ],
    specials: ["au_public_sector_star"],
  },
  SG: {
    country: "SG",
    photo: { stance: "discouraged", note: "Photos are discouraged on Singapore CVs." },
    dobAge: { stance: "never", note: "Leave date of birth and age off." },
    maritalReligion: { stance: "never", note: "Not included on a Singapore CV." },
    nationality: { stance: "expected", note: "Nationality or pass status is expected — e.g. Citizen, PR, EP holder." },
    workStatus: { stance: "expected", note: "State your pass type and whether you need a new pass." },
    nationalId: {
      stance: "never",
      note: "Never put your NRIC on a CV. TAFEP guidance: \"If you require an applicant's NRIC number for specific purposes, you should request for it at the point of job offer, or state your reasons clearly.\" The year-prefixed serial also discloses your age.",
    },
    salary: { stance: "never", note: "Salary belongs in the application form, not the CV." },
    noticePeriod: { stance: "sometimes", note: "Sometimes included; equally fine to raise at interview." },
    length: { min: 1, max: 2, note: "One to two pages." },
    spelling: "en-GB",
    references: "on_request",
    referencesNote: "\"References available on request\" is acceptable in Singapore.",
    context: [],
    specials: ["sg_nric_warning"],
  },
};

export function cvRulesFor(country: Country): CvRules {
  return CV_RULES[country] ?? CV_RULES.IN;
}

/** True when the field may appear on the document for this country. */
export function fieldAllowed(country: Country, field: CvSensitiveField): boolean {
  const stance = cvRulesFor(country)[field].stance;
  return stance === "expected" || stance === "common" || stance === "sometimes";
}

/** Fields the surface should actively prompt the user to supply. */
export function promptedFields(country: Country): CvSensitiveField[] {
  const rules = cvRulesFor(country);
  return SENSITIVE_FIELDS.filter((f) => rules[f].stance === "expected");
}

/** Fields that must be stripped before the document is produced. */
export function excludedFields(country: Country): CvSensitiveField[] {
  return SENSITIVE_FIELDS.filter((f) => !fieldAllowed(country, f));
}

export const SPELLING_INSTRUCTION: Record<CvSpelling, string> = {
  "en-IN": "Use Indian English conventions (colour, organise, lakh/crore where natural).",
  "en-US": "Use American English spelling (color, organize, analyze).",
  "en-GB": "Use British English spelling (colour, organise, analyse).",
  "en-CA": "Use Canadian English spelling (colour, organize, analyze).",
  "en-AU": "Use Australian English spelling (colour, organise, analyse).",
};

/**
 * ATS formatting rules. Deliberately modest claims: verified recruiter
 * surveys find roughly 92% of applicant tracking systems do NOT auto-reject —
 * they rank and sort for a human to read. The often-quoted auto-rejection
 * figure is a debunked 2012 vendor claim from a company that closed in 2013.
 * This
 * codebase never says "ATS-optimised", "beats the ATS" or "guaranteed".
 */
export const ATS_RULES: string[] = [
  "Single column. No tables, text boxes, graphics or skill-bar charts used for layout.",
  "Put your contact details in the body of the document, never in a page header or footer — roughly a quarter of parsers miss them there.",
  "Standard section headings (Experience, Education, Skills) and a standard font.",
  "Export as DOCX unless the posting asks for something else.",
];

export const ATS_HONESTY_LINE =
  "This layout is formatted to parse cleanly. No tool can guarantee how a particular employer's system will read it.";

export const CV_DEFAULT_FORMAT = "DOCX";

/**
 * The country block of the generation system prompt. Pure string building so
 * the same text can be asserted in tests and reused by the edge function.
 */
export function countryPromptContract(country: Country): string {
  const r = cvRulesFor(country);
  const include = promptedFields(country);
  const exclude = excludedFields(country);
  const lines = [
    `Target country: ${country}.`,
    SPELLING_INSTRUCTION[r.spelling],
    `Length: ${r.length.min}–${r.length.max} page(s). ${r.length.note}`,
    exclude.length
      ? `NEVER include these on the document: ${exclude.join(", ")}.`
      : "No fields are forbidden for this country.",
    include.length
      ? `These are expected locally and should be present if the user supplied them: ${include.join(", ")}.`
      : "No extra personal fields are expected locally.",
    `References: ${r.referencesNote}`,
    ...ATS_RULES,
  ];
  return lines.join("\n");
}

/** India PSU/government category values, current as of 2019's EWS addition. */
export const IN_PSU_CATEGORIES = ["UR/General", "OBC-NCL", "SC", "ST", "EWS"] as const;

export const STAR_STEPS = [
  { key: "situation", label: "Situation", hint: "What was going on?" },
  { key: "task", label: "Task", hint: "What were you responsible for?" },
  { key: "action", label: "Action", hint: "What did you actually do?" },
  { key: "result", label: "Result", hint: "What changed because of it?" },
] as const;
