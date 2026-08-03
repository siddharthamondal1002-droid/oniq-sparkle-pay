// ONIQ education-system registry — Phase 1 of the Education & Careers loop.
// Pure data + pure helpers; no React, no side effects, no database.
//
// HARD RULE (Rule 2 of the mission): ingest nothing, generate everything,
// link out. Nothing in this file is copied from an examination authority's
// syllabus prose, past papers or textbooks. Every "fact" here (stage names,
// subject lists, grading model, command words) is ONIQ's own structural
// description of a system, which copyright does not protect.
//
// Generating ORIGINAL exam-style questions "in the style of" a system is
// always allowed — copyright protects the expression of a specific question,
// not the topic, format or mark scheme. What is never allowed is storing,
// displaying or training on an authority's OWN text. canRenderSystemSourceContent()
// below is the tripwire for the former case only.
//
// PERMANENT EXCLUSION: College Board (AP/SAT) content is never sourced,
// stored, displayed or fed to generation, anywhere in ONIQ. Their written
// policy forbids use of their content with generative AI and forbids training
// on it. There is deliberately no College Board entry in this registry and
// there must never be one.
// Comparable commercial-reproduction restrictions are confirmed for AQA
// (explicit "no use of its material in apps"), Pearson, OCR, SQA, Cambridge,
// IB and Singapore SEAB — hence every entry touching those systems is scoped
// to ONIQ's own structural facts only.

import type { Country } from "@/data/appRegistry";

export type SystemType =
  // CBSE, CISCE, Indian state boards
  | "SCHOOL_BOARD"
  // US state standards AND Canadian provincial curricula. The type is
  // deliberately reused: in both countries there is no national curriculum
  // body, and sub-national jurisdictions set curricula in the same
  // structural way. Modelling Canada separately would duplicate the shape
  // with no behavioural difference.
  | "STATE_STANDARDS"
  // England NC, ACARA, Singapore MOE, UAE MOE
  | "NATIONAL_CURRICULUM"
  // GCSE, A-Level, IB DP, IGCSE
  | "QUALIFICATION"
  // exam_first | holistic | ucas | atar | provincial | multi_track |
  // direct_branch_campus — Phase 3 will use this; nothing is seeded here yet.
  | "UNIVERSITY_ROUTE"
  // IB, Cambridge — country-independent
  | "CROSS_CUTTING";

export type EduLicence = {
  name: string;
  url: string;
  attributionRequired: boolean;
  commercialOk: boolean;
  /** What EXACTLY is licensed this way — never leave this implicit. */
  scope: string;
  /** Real carve-outs/exclusions within an otherwise-permissive licence. Empty array = no known exclusions. */
  exclusions: string[];
  /** Verbatim notice text that MUST be displayed if this content is shown. Null if none required. */
  requiredNotice: string | null;
};

export type EduSystem = {
  id: string;
  countries: Country[];
  type: SystemType;
  authority: string;
  stageModel: {
    unitName: "Class" | "Grade" | "Year" | "Form" | "KeyStage" | "Primary" | "Secondary";
    stages: string[];
  };
  subjects: string[];
  gradingModel:
    | "MARKS"
    | "LETTER_GPA"
    | "BAND"
    | "NUMERIC_9_1"
    | "ATAR"
    | "POINTS"
    | "CLASSIFICATION";
  paperFormat?: {
    unit: "marks" | "points";
    commandWords: string[];
    terminator: string;
    spelling: "en-GB" | "en-US" | "en-AU" | "en-CA" | "en-IN";
  };
  licence: EduLicence;
  sourceUrl: string;
  /** Free-text caveats for future maintainers. */
  notes?: string;
};

/**
 * The ONLY sanctioned way to check whether an EduSystem's own sourced
 * content (not AI-generated original content) may be rendered. An entry
 * with licence.commercialOk === false must never have its authority-sourced
 * text displayed, stored, or fed to any generation pipeline. This is a
 * tripwire against a future data-entry mistake, not a statement that any
 * system currently seeded here is restricted — none of them are, because
 * none of them are populated from restricted source text (see Rule 2 in
 * the mission: ingest nothing, generate everything, link out).
 */
export function canRenderSystemSourceContent(sys: EduSystem): boolean {
  return sys.licence.commercialOk === true;
}

/** Licence used wherever the only content is ONIQ's own structural description. */
function ownFactsLicence(scope: string): EduLicence {
  return {
    name: "ONIQ original content",
    url: "https://oniqhub.com/terms",
    attributionRequired: false,
    commercialOk: true,
    scope,
    exclusions: [],
    requiredNotice: null,
  };
}

const COMMON_CORE_NOTICE =
  "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.";

export const EDU_SYSTEMS: EduSystem[] = [
  {
    id: "in-school-boards",
    // AE included: Indian-curriculum schools are widespread in the UAE.
    countries: ["IN", "AE"],
    type: "SCHOOL_BOARD",
    authority: "CBSE and state boards",
    stageModel: {
      unitName: "Class",
      stages: ["6", "7", "8", "9", "10", "11", "12"],
    },
    subjects: [
      "Mathematics",
      "Science",
      "Physics",
      "Chemistry",
      "Biology",
      "English",
      "Hindi",
      "Social Science",
      "History",
      "Geography",
      "Economics",
      "Computer Science",
      "Accountancy",
      "Business Studies",
    ],
    gradingModel: "MARKS",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "Define",
        "State",
        "Explain",
        "Describe",
        "Derive",
        "Prove",
        "Calculate",
        "Differentiate between",
        "Give reasons",
        "Draw a labelled diagram",
      ],
      terminator: "marks",
      spelling: "en-IN",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts about board/class/subject structure — no CBSE/state-board text is stored",
    ),
    sourceUrl: "https://www.cbse.gov.in",
    notes:
      "app.study.tsx already models Indian boards in detail via its own Board union; this entry is a lighter-weight summary for cross-system code, not a replacement. Phase 2 territory.",
  },
  {
    id: "us-state-standards",
    // AE included: American-curriculum schools are widespread in the UAE.
    countries: ["US", "AE"],
    type: "STATE_STANDARDS",
    authority: "State boards of education (no national board exists — do not invent one)",
    stageModel: {
      unitName: "Grade",
      stages: ["6", "7", "8", "9", "10", "11", "12"],
    },
    subjects: [
      "Mathematics",
      "Algebra I",
      "Geometry",
      "Algebra II",
      "Biology",
      "Chemistry",
      "Physics",
      "English Language Arts",
      "US History",
      "World History",
      "Government",
      "Economics",
      "Computer Science",
    ],
    gradingModel: "LETTER_GPA",
    paperFormat: {
      unit: "points",
      commandWords: [
        "Identify",
        "Explain",
        "Analyze",
        "Evaluate",
        "Compare",
        "Justify",
        "Solve",
        "Cite evidence",
      ],
      terminator: "points",
      spelling: "en-US",
    },
    licence: {
      name: "Common Core State Standards Public License",
      url: "https://corestandards.org/public-license/",
      attributionRequired: true,
      commercialOk: true,
      scope:
        "The Common Core State Standards text itself, usable verbatim only. ONIQ's own structural facts about grades and subjects are separate and unrestricted.",
      exclusions: [
        "editing/recasting the standards text",
        "sale of the standards text itself",
        "sublicensing",
      ],
      requiredNotice: COMMON_CORE_NOTICE,
    },
    sourceUrl: "https://corestandards.org",
    notes:
      "The required 2010 notice is only relevant if literal standards text is ever displayed verbatim (waived for US states that formally adopted the standards). Our own generated content is original and does not trigger it. No College Board (AP/SAT) content is ever used — permanent exclusion.",
  },
  {
    id: "gb-national-curriculum",
    // AE included: British-curriculum schools are the largest private sector in the UAE.
    countries: ["GB", "AE"],
    type: "NATIONAL_CURRICULUM",
    authority: "Department for Education (England)",
    stageModel: {
      unitName: "KeyStage",
      stages: ["KS1", "KS2", "KS3", "KS4", "KS5"],
    },
    subjects: [
      "Mathematics",
      "English",
      "Science",
      "Biology",
      "Chemistry",
      "Physics",
      "History",
      "Geography",
      "Computing",
      "Modern Foreign Languages",
    ],
    gradingModel: "NUMERIC_9_1",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "State",
        "Describe",
        "Explain",
        "Compare",
        "Evaluate",
        "Analyse",
        "Justify",
        "Calculate",
        "Suggest",
      ],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: {
      name: "Open Government Licence v3.0",
      url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
      attributionRequired: true,
      commercialOk: true,
      scope: "The England National Curriculum programmes of study published by the DfE.",
      exclusions: [],
      requiredNotice:
        "Contains public sector information licensed under the Open Government Licence v3.0.",
    },
    sourceUrl: "https://www.gov.uk/government/collections/national-curriculum",
    notes:
      "Applies to England. Scotland (Curriculum for Excellence / SQA) and, in part, Wales and Northern Ireland differ — see the GCSE entry.",
  },
  {
    id: "gb-gcse",
    countries: ["GB", "AE"],
    type: "QUALIFICATION",
    authority: "Ofqual-regulated awarding bodies (AQA, Pearson Edexcel, OCR, WJEC, CCEA)",
    stageModel: {
      unitName: "Year",
      stages: ["10", "11"],
    },
    subjects: [
      "Mathematics",
      "English Language",
      "English Literature",
      "Combined Science",
      "Biology",
      "Chemistry",
      "Physics",
      "History",
      "Geography",
      "Computer Science",
      "Business",
    ],
    gradingModel: "NUMERIC_9_1",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "State",
        "Describe",
        "Explain",
        "Compare",
        "Evaluate",
        "Analyse",
        "Justify",
        "Calculate",
        "Show that",
      ],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts about GCSE grades, subjects and question formats — no awarding-body syllabus prose or past-paper text is stored",
    ),
    sourceUrl: "https://www.gov.uk/what-different-qualification-levels-mean",
    notes:
      "GCSE covers England, Wales and Northern Ireland. Scotland uses National 5 / Higher / Advanced Higher via SQA — a separate entry is a deliberate FOLLOW-UP rather than a guess, because SQA's licensing has not been verified in this session. AQA has explicitly refused permission for use of its material in apps; Pearson/OCR have comparable commercial-reproduction restrictions. Nothing of theirs is ingested.",
  },
  {
    id: "uae-moe",
    countries: ["AE"],
    type: "NATIONAL_CURRICULUM",
    authority: "UAE MOE",
    stageModel: {
      unitName: "Grade",
      stages: ["6", "7", "8", "9", "10", "11", "12"],
    },
    subjects: [
      "Mathematics",
      "Science",
      "Physics",
      "Chemistry",
      "Biology",
      "Arabic",
      "English",
      "Islamic Studies",
      "Social Studies",
      "Computer Science",
    ],
    gradingModel: "MARKS",
    paperFormat: {
      unit: "marks",
      commandWords: ["Define", "State", "Explain", "Describe", "Calculate", "Compare"],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts only — no MOE syllabus text stored",
    ),
    sourceUrl: "https://www.moe.gov.ae",
    notes:
      "The UAE is modelled as a curriculum CHOOSER, not a single country page: AE users may follow the British (gb-*), American (us-state-standards), Indian (in-school-boards), IB or Cambridge systems, or the MOE curriculum here. No verification suggests UAE MOE materials are openly licensed, so this is treated exactly like CBSE/SEAB — facts we author ourselves, never their text.",
  },
  {
    id: "ca-ontario",
    countries: ["CA"],
    type: "STATE_STANDARDS",
    authority: "Provincial ministries of education",
    stageModel: {
      unitName: "Grade",
      // Ontario: Grades 1–8 elementary, Grades 9–12 secondary (OSSD at completion).
      stages: ["7", "8", "9", "10", "11", "12"],
    },
    subjects: [
      "Mathematics",
      "Science",
      "Biology",
      "Chemistry",
      "Physics",
      "English",
      "Français",
      "Canadian History",
      "Geography",
      "Computer Studies",
      "Business Studies",
    ],
    gradingModel: "LETTER_GPA",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "Identify",
        "Describe",
        "Explain",
        "Analyse",
        "Evaluate",
        "Compare",
        "Justify",
        "Calculate",
      ],
      terminator: "marks",
      spelling: "en-CA",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts about Ontario grade bands and subjects — no ministry curriculum text is stored",
    ),
    sourceUrl: "https://www.dcp.edu.gov.on.ca/en/",
    notes:
      "STATE_STANDARDS is reused for Canada on purpose: provinces set their own curricula the same structural way US states do, and there is no federal curriculum. Ontario grade bands (1–8 elementary, 9–12 secondary, OSSD on completion) per the Ontario Ministry of Education curriculum site (dcp.edu.gov.on.ca). Other provinces (BC, Alberta, Quebec CEGEP) are a follow-up.",
  },
  {
    id: "au-acara",
    countries: ["AU"],
    type: "NATIONAL_CURRICULUM",
    authority: "ACARA",
    stageModel: {
      unitName: "Year",
      stages: ["7", "8", "9", "10", "11", "12"],
    },
    subjects: [
      "Mathematics",
      "Science",
      "Biology",
      "Chemistry",
      "Physics",
      "English",
      "Humanities and Social Sciences",
      "History",
      "Geography",
      "Digital Technologies",
    ],
    gradingModel: "ATAR",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "Identify",
        "Describe",
        "Explain",
        "Analyse",
        "Evaluate",
        "Compare",
        "Justify",
        "Calculate",
      ],
      terminator: "marks",
      spelling: "en-AU",
    },
    licence: {
      name: "CC BY 4.0 (with ACARA exclusions)",
      url: "https://creativecommons.org/licenses/by/4.0/",
      attributionRequired: true,
      commercialOk: true,
      scope:
        "The bulk of Australian Curriculum text published by ACARA, excluding the carve-outs listed below.",
      exclusions: [
        "Excluded Materials (personal/non-commercial use only)",
        "National Literacy Learning Progressions (CC BY-NC 4.0, non-commercial only)",
        "third-party-permitted content",
        "ACARA/Australian Curriculum/Australian Government/ESA logos",
      ],
      requiredNotice: null,
    },
    sourceUrl: "https://v9.australiancurriculum.edu.au",
    notes:
      "Do NOT blanket-treat ACARA content as unconditionally commercial — the exclusions above are real. Senior secondary certification and ATAR are set by state authorities (VCAA, NESA, QCAA...), a follow-up.",
  },
  {
    id: "sg-moe",
    countries: ["SG"],
    type: "NATIONAL_CURRICULUM",
    authority: "MOE / SEAB",
    stageModel: {
      unitName: "Secondary",
      stages: ["Sec 1", "Sec 2", "Sec 3", "Sec 4", "Sec 5", "JC1", "JC2"],
    },
    subjects: [
      "Mathematics",
      "Additional Mathematics",
      "Science",
      "Physics",
      "Chemistry",
      "Biology",
      "English Language",
      "Mother Tongue",
      "Humanities",
      "Computing",
    ],
    gradingModel: "BAND",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "State",
        "Define",
        "Describe",
        "Explain",
        "Suggest",
        "Compare",
        "Calculate",
        "Deduce",
      ],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts only — MOE/SEAB syllabus and past-paper text is never stored or reproduced",
    ),
    sourceUrl: "https://www.moe.gov.sg",
    notes:
      "SEAB's actual materials carry commercial-reproduction restrictions; nothing of theirs is ingested. Singapore spelling follows en-GB.",
  },
  {
    id: "ib-dp",
    // Offered internationally; listed where ONIQ has country support and IB schools exist.
    countries: ["IN", "US", "GB", "AE", "CA", "AU", "SG"],
    type: "CROSS_CUTTING",
    authority: "International Baccalaureate Organization",
    stageModel: {
      unitName: "Year",
      stages: ["DP1", "DP2"],
    },
    subjects: [
      "Mathematics: Analysis and Approaches",
      "Mathematics: Applications and Interpretation",
      "Physics",
      "Chemistry",
      "Biology",
      "English A: Language and Literature",
      "History",
      "Economics",
      "Computer Science",
      "Theory of Knowledge",
    ],
    gradingModel: "POINTS",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "State",
        "Outline",
        "Describe",
        "Explain",
        "Discuss",
        "Evaluate",
        "Compare and contrast",
        "Determine",
      ],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts about the DP structure, subject groups and grading — never IB's own syllabus or past-paper text",
    ),
    sourceUrl: "https://www.ibo.org/programmes/diploma-programme/",
    notes:
      "IB materials are confirmed commercially restricted; nothing of theirs is ingested. Country list is where ONIQ operates and IB World Schools exist, not an exhaustive global list.",
  },
  {
    id: "cambridge-igcse",
    countries: ["IN", "US", "GB", "AE", "CA", "AU", "SG"],
    type: "CROSS_CUTTING",
    authority: "Cambridge Assessment International Education",
    stageModel: {
      unitName: "Year",
      stages: ["IGCSE Y10", "IGCSE Y11", "AS", "A2"],
    },
    subjects: [
      "Mathematics",
      "Additional Mathematics",
      "Physics",
      "Chemistry",
      "Biology",
      "English Language",
      "English Literature",
      "Economics",
      "Business Studies",
      "Computer Science",
    ],
    gradingModel: "BAND",
    paperFormat: {
      unit: "marks",
      commandWords: [
        "State",
        "Define",
        "Describe",
        "Explain",
        "Suggest",
        "Calculate",
        "Compare",
        "Justify",
      ],
      terminator: "marks",
      spelling: "en-GB",
    },
    licence: ownFactsLicence(
      "ONIQ's own structural facts about IGCSE/AS/A-Level structure and grading — never Cambridge's own syllabus or past-paper text",
    ),
    sourceUrl: "https://www.cambridgeinternational.org",
    notes:
      "Cambridge materials are confirmed commercially restricted; nothing of theirs is ingested.",
  },
];

const BY_ID = new Map(EDU_SYSTEMS.map((s) => [s.id, s]));

export function getEduSystem(id: string): EduSystem | undefined {
  return BY_ID.get(id);
}

/** Every system a user in this home country could plausibly be studying. */
export function eduSystemsFor(country: Country): EduSystem[] {
  return EDU_SYSTEMS.filter((s) => s.countries.includes(country));
}
