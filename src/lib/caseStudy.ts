// Phase 1.3 — the case-study generator.
//
// This is the format that targets the actual national weakness, and it is the
// one most easily faked. A "case study" whose answer is sitting in the third
// sentence of its own passage tests whether a student can find a sentence. It
// looks like a competency item, it is marked like a competency item, and it
// measures reading speed.
//
// So the central rule is enforced, not requested: THE ANSWER MAY NEVER APPEAR
// VERBATIM IN THE PASSAGE. It has to be extracted and combined with a syllabus
// concept, or the item does not ship.
//
// SCAFFOLDING IS A CLAIM ABOUT DOK, SO IT IS CHECKED
//
// Sub-parts run from lower to higher Depth of Knowledge. A set that opens with
// "evaluate" and closes with "state" is not scaffolded, it is shuffled, and
// the student meets the hardest part while still working out what the passage
// says. validate() rejects a non-ascending DOK sequence.
//
// DELIBERATE NON-ESSENTIAL DATA
//
// Real interpretation means deciding what matters, so scenarios carry facts
// the question does not need. That is a feature — but it is also a trap for
// the key derivation, which must not quietly depend on a number the author
// considered decorative. Hence `distractorFacts`: labelled internally, so a
// derivation that references one is a bug the validator can see.

import { containsAsPhrase } from "@/lib/itemLint";

export type DataRow = Record<string, string | number>;

export type Scenario = {
  id: string;
  /** For paper-level regional variety; see lintPaperDiversity. */
  region: "north" | "south" | "east" | "west" | "none";
  setting: string;
  /** 50–120 words. Long enough to interpret, short enough to read under time. */
  passage: string;
  data?: { caption: string; rows: DataRow[] };
  /** Facts a sub-part is allowed to depend on. */
  essentialFacts: string[];
  /**
   * Facts deliberately present and deliberately not needed. Labelled so a key
   * derivation that leans on one is caught rather than shipped.
   */
  distractorFacts: string[];
};

export type SubPart = {
  id: string;
  question: string;
  /** Webb's DOK. Must not decrease across a scenario's sub-parts. */
  dokLevel: 1 | 2 | 3 | 4;
  marks: number;
  /** MCQ options, where the sub-part has them. */
  options?: string[];
  keyIndex?: number;
  /** The answer, as text. For a written sub-part this is the model answer. */
  key: string;
  /** How the answer is COMPUTED from the scenario. Never "the answer is X". */
  keyDerivation: string;
  /** One named misconception per distractor. */
  distractorRationales?: string[];
};

export type CaseStudyTaskModel = {
  id: string;
  competency: string;
  scenario: Scenario;
  subParts: SubPart[];
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type CaseStudyError = { field: string; message: string };

export function validateCaseStudy(m: CaseStudyTaskModel): CaseStudyError[] {
  const errs: CaseStudyError[] = [];
  const add = (field: string, message: string) => errs.push({ field, message });

  // -- The passage --------------------------------------------------------

  const words = wordCount(m.scenario.passage);
  if (words < 50 || words > 120) {
    add("scenario.passage", `Passage is ${words} words; the format wants 50–120.`);
  }

  if (!m.scenario.essentialFacts.length) {
    add("scenario.essentialFacts", "No essential facts listed — nothing to interpret.");
  }

  // -- Sub-parts ----------------------------------------------------------

  if (m.subParts.length < 3 || m.subParts.length > 4) {
    add("subParts", `${m.subParts.length} sub-parts; the format wants 3–4.`);
  }

  // Scaffolding: DOK must not decrease. Equal is fine — two DOK 2 parts in a
  // row is a reasonable ramp — but going back down means the student meets
  // the hardest part before they have finished reading.
  for (let i = 1; i < m.subParts.length; i++) {
    if (m.subParts[i].dokLevel < m.subParts[i - 1].dokLevel) {
      add(
        `subParts[${i}].dokLevel`,
        `DOK drops from ${m.subParts[i - 1].dokLevel} to ${m.subParts[i].dokLevel}; sub-parts must scaffold upward.`,
      );
    }
  }

  // The whole point of the format — with one carve-out, and it is worth
  // explaining because the first version of this check did not have it.
  //
  // The rule is that the passage must not ANSWER the question. A blunt "no
  // token of the answer may appear in the passage" is not that rule, and it
  // outlaws the ordinary DOK 1 opener: "which day stands apart?" has to be
  // answered with one of the days the passage names, and the passage nowhere
  // says that day is the outlier. The student still compares five numbers.
  //
  // What is never acceptable is a MULTI-WORD answer sitting intact in the
  // passage — that is genuinely copyable — or a single token lifted while the
  // sub-part claims DOK 2 or above, because reading a word off the page is not
  // application by any definition.
  for (const [i, sp] of m.subParts.entries()) {
    const key = sp.key.trim();
    if (!key || !containsAsPhrase(m.scenario.passage, key)) continue;
    const singleToken = key.split(/\s+/).length === 1;
    if (!singleToken) {
      add(
        `subParts[${i}].key`,
        `The answer "${key}" appears word-for-word in the passage. That is a retrieval task, not a competency item.`,
      );
    } else if (sp.dokLevel > 1) {
      add(
        `subParts[${i}].key`,
        `The answer "${key}" is lifted straight from the passage, but the sub-part claims DOK ${sp.dokLevel}. Reading a word off the page is DOK 1 at most.`,
      );
    }
  }

  // A derivation that leans on a fact the author labelled decorative means
  // one of the two labels is wrong, and either way the item is not understood.
  for (const [i, sp] of m.subParts.entries()) {
    for (const d of m.scenario.distractorFacts) {
      if (d.trim() && containsAsPhrase(sp.keyDerivation, d)) {
        add(
          `subParts[${i}].keyDerivation`,
          `Derivation depends on "${d}", which is listed as non-essential data.`,
        );
      }
    }
  }

  for (const [i, sp] of m.subParts.entries()) {
    if (sp.keyDerivation.trim().length < 25) {
      add(`subParts[${i}].keyDerivation`, "No derivation — the key cannot be verified.");
    }
    if (sp.marks <= 0) add(`subParts[${i}].marks`, "Marks must be positive.");
    if (sp.options) {
      if (sp.keyIndex === undefined || !sp.options[sp.keyIndex]) {
        add(`subParts[${i}].keyIndex`, "Options given but no valid key index.");
      }
      const needed = sp.options.length - 1;
      if ((sp.distractorRationales?.length ?? 0) < needed) {
        add(
          `subParts[${i}].distractorRationales`,
          `${needed} distractors, ${sp.distractorRationales?.length ?? 0} named misconceptions.`,
        );
      }
    }
  }

  // Sub-part ids must be distinct so responses attribute correctly.
  const ids = m.subParts.map((s) => s.id);
  if (new Set(ids).size !== ids.length) add("subParts", "Duplicate sub-part ids.");

  return errs;
}

export type CaseStudyItem = {
  taskModelId: string;
  passage: string;
  data?: { caption: string; rows: DataRow[] };
  subParts: { id: string; question: string; options?: string[]; marks: number; dokLevel: number }[];
  totalMarks: number;
};

/** Render a validated model. Throws rather than emitting a broken case study. */
export function instantiateCaseStudy(m: CaseStudyTaskModel): CaseStudyItem {
  const errs = validateCaseStudy(m);
  if (errs.length) {
    throw new Error(`${m.id}: ${errs.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  }
  return {
    taskModelId: m.id,
    passage: m.scenario.passage,
    data: m.scenario.data,
    subParts: m.subParts.map((s) => ({
      id: s.id,
      question: s.question,
      options: s.options,
      marks: s.marks,
      dokLevel: s.dokLevel,
    })),
    totalMarks: m.subParts.reduce((a, s) => a + s.marks, 0),
  };
}

/**
 * The scenario library.
 *
 * Neutral and dignified: a household budget, a monsoon, a metro timetable. No
 * character's caste, religion or poverty is scenery, and names and regions
 * rotate so no student reads the paper as written for somebody else. The bias
 * lint is run over every one of these in the test, which is what stops that
 * being an aspiration.
 */
export const SCENARIO_LIBRARY: Scenario[] = [
  {
    id: "metro-timetable",
    region: "north",
    setting: "Metro timetable",
    passage:
      "The Delhi Metro publishes a timetable for the Blue Line. On weekdays a train leaves Dwarka every 4 minutes between 8 am and 11 am, and every 9 minutes outside those hours. The journey to Noida Sector 62 takes 71 minutes end to end. The line has 50 stations and carries about 1.4 million passengers a day. A commuter arrives at Dwarka at 8.42 am and needs to reach Sector 62 for a meeting that starts at 10 am.",
    essentialFacts: [
      "trains every 4 minutes between 8 am and 11 am",
      "journey takes 71 minutes",
      "arrives 8.42 am",
      "meeting at 10 am",
    ],
    distractorFacts: ["50 stations", "1.4 million passengers a day", "every 9 minutes outside"],
  },
  {
    id: "monsoon-rainfall",
    region: "west",
    setting: "Monsoon and agriculture",
    passage:
      "A farmer near Nashik records rainfall each week during the monsoon. Week one brought 60 mm, week two 145 mm, week three 30 mm and week four 165 mm. Her grape vines need at least 100 mm a week; below that she irrigates from a tank holding 40,000 litres. Her plot covers 2 hectares, and 1 mm of rain over 1 hectare is 10,000 litres. She also keeps twelve goats.",
    essentialFacts: [
      "week one 60 mm",
      "week three 30 mm",
      "needs at least 100 mm a week",
      "1 mm over 1 hectare is 10,000 litres",
      "plot covers 2 hectares",
    ],
    distractorFacts: ["twelve goats", "tank holding 40,000 litres"],
  },
  {
    id: "clinic-waiting",
    region: "south",
    setting: "Public health data",
    passage:
      "A primary health centre in Kochi logged its outpatient waiting times over five days. The median wait was 22 minutes on Monday, 25 on Tuesday, 48 on Wednesday, 24 on Thursday and 26 on Friday. On Wednesday one of the two duty doctors was away at a training session. The centre sees roughly 180 patients a day and opens at 8 am. A visiting officer concludes that waiting times at the centre are rising.",
    essentialFacts: [
      "median wait 22 25 48 24 26",
      "Wednesday one of the two duty doctors was away",
      "officer concludes waiting times are rising",
    ],
    distractorFacts: ["180 patients a day", "opens at 8 am"],
  },
  {
    id: "household-budget",
    region: "east",
    setting: "Household budget",
    passage:
      "Ananya keeps a monthly record of what her household spends. Rent takes 8,000 rupees, food 6,500, transport 2,200, electricity 1,300 and everything else 3,000. Her income is 24,000 rupees a month and she wants to save at least a fifth of it. Electricity was 900 rupees in the same month last year. The family of four lives on the second floor of a building in Kolkata with no lift.",
    essentialFacts: [
      "rent 8,000",
      "food 6,500",
      "transport 2,200",
      "electricity 1,300",
      "everything else 3,000",
      "income is 24,000",
      "save at least a fifth",
    ],
    distractorFacts: ["second floor", "no lift", "family of four"],
  },
  {
    id: "satellite-orbit",
    region: "none",
    setting: "Space mission",
    passage:
      "A weather satellite is placed in a circular orbit 36,000 km above the equator, where it completes one revolution in exactly 24 hours. Because that matches the rotation of the Earth, the satellite stays above the same point on the ground. Its instruments return an image every 30 minutes, and the mission is planned to run for 10 years. A ground station receives the images and forwards them to forecasters.",
    essentialFacts: [
      "36,000 km above the equator",
      "one revolution in exactly 24 hours",
      "matches the rotation of the Earth",
    ],
    distractorFacts: ["image every 30 minutes", "10 years", "ground station"],
  },
];
