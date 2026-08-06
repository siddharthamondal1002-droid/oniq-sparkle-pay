/**
 * Phase 1.3 and 1.4 — case studies and retrieval practice.
 *
 * Verification item 7 asks for ten case studies with the answer never verbatim
 * in the passage, sub-parts scaffolding by DOK, and reading load matching the
 * grade. The ten are built from the scenario library here rather than pasted,
 * because the library is the thing under test.
 */
import { describe, expect, it } from "vitest";
import {
  type CaseStudyTaskModel,
  type Scenario,
  SCENARIO_LIBRARY,
  instantiateCaseStudy,
  validateCaseStudy,
  wordCount,
} from "@/lib/caseStudy";
import {
  type PracticeItem,
  MissingMisconceptionError,
  allDistractorFeedback,
  feedbackFor,
  itemsToRevisit,
  summarise,
} from "@/lib/retrievalPractice";
import { itemPasses, lintItem, lintPaperDiversity } from "@/lib/itemLint";

// ---------------------------------------------------------------------------
// The scenario library itself
// ---------------------------------------------------------------------------

describe("the scenario library is usable and dignified", () => {
  it("every passage is 50–120 words", () => {
    for (const s of SCENARIO_LIBRARY) {
      const w = wordCount(s.passage);
      expect(w, `${s.id} is ${w} words`).toBeGreaterThanOrEqual(50);
      expect(w, `${s.id} is ${w} words`).toBeLessThanOrEqual(120);
    }
  });

  it("every scenario carries deliberate non-essential data", () => {
    // Real interpretation means deciding what matters, so there has to be
    // something present that does not.
    for (const s of SCENARIO_LIBRARY) {
      expect(s.distractorFacts.length, `${s.id} has no non-essential data`).toBeGreaterThan(0);
      expect(s.essentialFacts.length, s.id).toBeGreaterThan(0);
    }
  });

  it("no passage trips the bias lint", () => {
    for (const s of SCENARIO_LIBRARY) {
      const findings = lintItem({
        stem: `${s.passage} What does the data show?`,
        format: "case_study",
        gradeYears: 10,
      });
      const bias = findings.filter((f) =>
        ["gender-stereotype", "economic-stereotype", "social-category-in-scenario"].includes(
          f.rule,
        ),
      );
      expect(bias, `${s.id}: ${JSON.stringify(bias)}`).toEqual([]);
    }
  });

  it("the library spreads across regions rather than one city", () => {
    expect(lintPaperDiversity(SCENARIO_LIBRARY.map((s) => s.passage))).toEqual([]);
    const regions = new Set(SCENARIO_LIBRARY.map((s) => s.region));
    expect(regions.size).toBeGreaterThanOrEqual(4);
  });

  it("has distinct ids", () => {
    const ids = SCENARIO_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Ten generated case studies
// ---------------------------------------------------------------------------

function byId(id: string): Scenario {
  const s = SCENARIO_LIBRARY.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

/**
 * Two competencies per scenario across the five-scenario library, giving ten.
 * Every key is computed from the passage rather than stated in it.
 */
const TEN: CaseStudyTaskModel[] = [
  {
    id: "metro-a",
    competency: "Combine a timetable with a duration to plan an arrival",
    scenario: byId("metro-timetable"),
    subParts: [
      {
        id: "metro-a-1",
        question: "At what time does the next train leave after the commuter arrives?",
        dokLevel: 1,
        marks: 1,
        key: "8.44 am",
        keyDerivation:
          "Trains leave every 4 minutes from 8 am, so departures fall at 8.40 and 8.44. Arriving at 8.42 misses the first.",
      },
      {
        id: "metro-a-2",
        question: "What time does that train reach Sector 62?",
        dokLevel: 2,
        marks: 1,
        key: "9.55 am",
        keyDerivation: "Add the 71 minute journey to the 8.44 departure.",
      },
      {
        id: "metro-a-3",
        question: "How much time is left before the meeting, and is that comfortable?",
        dokLevel: 3,
        marks: 2,
        key: "Five minutes, which leaves no margin for a delay",
        keyDerivation:
          "Subtract the 9.55 arrival from the 10 am meeting, then judge the margin against the possibility of a delay.",
      },
    ],
  },
  {
    id: "metro-b",
    competency: "Judge whether a stated frequency is relevant to a specific journey",
    scenario: byId("metro-timetable"),
    subParts: [
      {
        id: "metro-b-1",
        question: "Which piece of information in the passage does this journey not need?",
        dokLevel: 2,
        marks: 1,
        key: "The number of stations on the line",
        keyDerivation:
          "The journey time is given end to end, so the count of intermediate stops changes nothing.",
      },
      {
        id: "metro-b-2",
        question: "Explain why the off-peak interval does not affect this commuter.",
        dokLevel: 3,
        marks: 2,
        key: "The whole journey falls inside the peak window",
        keyDerivation:
          "Departure and arrival both fall between 8 am and 11 am, so the peak interval applies throughout.",
      },
      {
        id: "metro-b-3",
        question: "If the meeting moved to 9.50 am, what would the commuter have to change?",
        dokLevel: 3,
        marks: 1,
        key: "Leave on an earlier train, at 8.36 or before",
        keyDerivation:
          "Work backwards: arrival must be before 9.50, so departure must be before 8.39, and the prior departure is 8.36.",
      },
    ],
  },
  {
    id: "monsoon-a",
    competency: "Convert rainfall depth into a volume over an area",
    scenario: byId("monsoon-rainfall"),
    subParts: [
      {
        id: "monsoon-a-1",
        question: "In which weeks did rainfall fall short of what the vines need?",
        dokLevel: 1,
        marks: 1,
        key: "Weeks one and three",
        keyDerivation: "Compare each weekly figure against the 100 mm requirement.",
      },
      {
        id: "monsoon-a-2",
        question: "How many litres of irrigation would week three have required?",
        dokLevel: 2,
        marks: 2,
        key: "1,400,000 litres",
        keyDerivation:
          "Shortfall is 70 mm; at 10,000 litres per mm per hectare over 2 hectares that is 70 x 10,000 x 2.",
      },
      {
        id: "monsoon-a-3",
        question: "Comment on whether irrigation was a realistic option that week.",
        dokLevel: 3,
        marks: 1,
        key: "No, the requirement is many times the tank capacity",
        keyDerivation:
          "Compare the computed requirement against the stated tank capacity and judge the gap.",
      },
    ],
  },
  {
    id: "monsoon-b",
    competency: "Distinguish a total from an average when both are available",
    scenario: byId("monsoon-rainfall"),
    subParts: [
      {
        id: "monsoon-b-1",
        // Asks for the TOTAL, not the mean. The mean is 100 mm, and "100 mm"
        // is stated in the passage as the weekly requirement — so a student
        // could read the answer off without computing anything. The validator
        // caught that, and the fix is to move the question rather than to
        // loosen the rule.
        question: "What was the total rainfall over the four weeks?",
        dokLevel: 2,
        marks: 1,
        key: "400 mm",
        keyDerivation: "Sum the four weekly figures.",
      },
      {
        id: "monsoon-b-2",
        question: "The mean meets the requirement. Why is that misleading here?",
        dokLevel: 3,
        marks: 2,
        key: "The vines need it weekly, and two weeks fell short regardless of the average",
        keyDerivation:
          "The requirement is stated per week, so a mean across weeks cannot satisfy it; identify the two deficient weeks.",
      },
      {
        id: "monsoon-b-3",
        question: "Suggest one further measurement that would improve the farmer's planning.",
        dokLevel: 4,
        marks: 1,
        key: "Daily rather than weekly totals, to reveal dry runs inside a wet week",
        keyDerivation:
          "Reason from the weakness identified above: weekly aggregation hides the distribution within a week.",
      },
    ],
  },
  {
    id: "clinic-a",
    competency: "Evaluate whether data supports a stated conclusion",
    scenario: byId("clinic-waiting"),
    subParts: [
      {
        id: "clinic-a-1",
        question: "Which day stands apart from the rest?",
        dokLevel: 1,
        marks: 1,
        key: "Wednesday",
        keyDerivation: "Compare each median against the others; one is roughly double the rest.",
      },
      {
        id: "clinic-a-2",
        question: "What in the passage explains that day?",
        dokLevel: 2,
        marks: 1,
        key: "Half the duty doctors were absent",
        keyDerivation:
          "Link the outlying day to the staffing note given for the same day in the passage.",
      },
      {
        id: "clinic-a-3",
        question: "Is the visiting officer's conclusion supported? Justify your answer.",
        dokLevel: 4,
        marks: 2,
        key: "No — four of five days are stable and the fifth has a known cause",
        keyDerivation:
          "Set aside the explained outlier, observe the remaining four values are flat, and test the claim of a rise against them.",
      },
    ],
  },
  {
    id: "clinic-b",
    competency: "Choose an appropriate summary statistic",
    scenario: byId("clinic-waiting"),
    subParts: [
      {
        id: "clinic-b-1",
        question: "Calculate the mean of the five medians.",
        dokLevel: 2,
        marks: 1,
        key: "29 minutes",
        keyDerivation: "Sum the five values and divide by five.",
      },
      {
        id: "clinic-b-2",
        question: "Why does that mean overstate a typical day?",
        dokLevel: 3,
        marks: 2,
        key: "One extreme day pulls it above four of the five values",
        keyDerivation:
          "Compare the mean against the individual values and note how many lie below it.",
      },
      {
        id: "clinic-b-3",
        question: "Which summary would represent a typical day better, and why?",
        dokLevel: 4,
        marks: 1,
        key: "The median of the five, because it is unaffected by the single extreme",
        keyDerivation:
          "Reason from the sensitivity of each statistic to an outlier identified in the previous part.",
      },
    ],
  },
  {
    id: "budget-a",
    competency: "Test a savings goal against actual spending",
    scenario: byId("household-budget"),
    subParts: [
      {
        id: "budget-a-1",
        question: "What does the household spend in total each month?",
        dokLevel: 1,
        marks: 1,
        key: "21,000 rupees",
        keyDerivation: "Add the five spending categories listed.",
      },
      {
        id: "budget-a-2",
        question: "Is the savings goal being met?",
        dokLevel: 2,
        marks: 1,
        key: "No — 3,000 saved against a 4,800 target",
        keyDerivation:
          "Subtract total spending from income, then compare against one fifth of income.",
      },
      {
        id: "budget-a-3",
        question: "Suggest one change that would meet the goal, and state its effect.",
        dokLevel: 3,
        marks: 2,
        key: "Reduce discretionary spending by 1,800 rupees",
        keyDerivation:
          "Compute the shortfall between actual saving and the target, then attribute it to a category that can absorb it.",
      },
    ],
  },
  {
    id: "budget-b",
    competency: "Express a change as a percentage of the correct base",
    scenario: byId("household-budget"),
    subParts: [
      {
        id: "budget-b-1",
        question: "By how much has the electricity bill risen since last year?",
        dokLevel: 1,
        marks: 1,
        key: "400 rupees",
        keyDerivation: "Subtract last year's figure from this year's.",
      },
      {
        id: "budget-b-2",
        question: "Express that rise as a percentage.",
        dokLevel: 2,
        marks: 2,
        key: "About 44 per cent",
        keyDerivation:
          "Divide the increase by the ORIGINAL figure, not the new one, and convert to a percentage.",
      },
      {
        id: "budget-b-3",
        // Was "what share of income does electricity take" — DOK 2, which
        // left this case study topping out at comprehension. A case study
        // that never passes DOK 2 is a reading exercise wearing the format.
        question:
          "Electricity is the fastest-rising cost. Explain why cutting it is still a poor way to close the savings gap.",
        dokLevel: 3,
        marks: 1,
        key: "Even removing it entirely leaves the household short of the target",
        keyDerivation:
          "Compare the whole electricity figure against the savings shortfall computed from income and total spending, and judge whether the one can cover the other.",
      },
    ],
  },
  {
    id: "satellite-a",
    competency: "Relate orbital period to apparent position",
    scenario: byId("satellite-orbit"),
    subParts: [
      {
        id: "satellite-a-1",
        question: "Why does the satellite appear stationary from the ground?",
        dokLevel: 2,
        marks: 1,
        key: "Its period equals one rotation of the Earth",
        keyDerivation:
          "Connect the stated period to the rotation period, so the ground track does not move.",
      },
      {
        id: "satellite-a-2",
        question: "What would happen if its period were 23 hours instead?",
        dokLevel: 3,
        marks: 2,
        key: "It would drift steadily westward relative to the ground",
        keyDerivation:
          "A shorter period means the satellite completes its circuit before the ground does, so the difference accumulates each day.",
      },
      {
        id: "satellite-a-3",
        question: "Explain why such an orbit must lie above the equator.",
        dokLevel: 4,
        marks: 1,
        key: "Any inclined orbit crosses the equator and traces a figure of eight",
        keyDerivation:
          "Reason that a stationary ground track requires the orbital plane to contain the rotation axis' equator.",
      },
    ],
  },
  {
    id: "satellite-b",
    competency: "Separate essential from decorative data",
    scenario: byId("satellite-orbit"),
    subParts: [
      {
        id: "satellite-b-1",
        question: "Which figures in the passage are irrelevant to why it stays overhead?",
        dokLevel: 2,
        marks: 1,
        key: "The imaging interval and the mission length",
        keyDerivation:
          "Identify which quantities enter the period-versus-rotation comparison and which do not.",
      },
      {
        id: "satellite-b-2",
        question: "How many images does it return in one full orbit?",
        dokLevel: 2,
        marks: 1,
        key: "48",
        keyDerivation: "Divide the 24 hour period by the imaging interval expressed in hours.",
      },
      {
        id: "satellite-b-3",
        question: "Why can one such satellite not photograph the poles well?",
        dokLevel: 4,
        marks: 2,
        key: "It sits over the equator, so the poles are at a grazing angle",
        keyDerivation:
          "Reason from the equatorial position to the viewing geometry at high latitude.",
      },
    ],
  },
];

describe("ten generated case studies", () => {
  it("generated exactly ten", () => {
    expect(TEN).toHaveLength(10);
  });

  it("every one validates", () => {
    for (const m of TEN) {
      expect(validateCaseStudy(m), `${m.id}: ${JSON.stringify(validateCaseStudy(m))}`).toEqual([]);
    }
  });

  it("no answer appears verbatim in its passage", () => {
    // The rule the whole format rests on. An answer sitting in the passage
    // makes the item a sentence hunt.
    for (const m of TEN) {
      const errs = validateCaseStudy(m).filter((e) => e.message.includes("word-for-word"));
      expect(errs, m.id).toEqual([]);
    }
  });

  it("sub-parts scaffold upward by DOK, never downward", () => {
    for (const m of TEN) {
      const doks = m.subParts.map((s) => s.dokLevel);
      for (let i = 1; i < doks.length; i++) {
        expect(doks[i], `${m.id} drops from ${doks[i - 1]} to ${doks[i]}`).toBeGreaterThanOrEqual(
          doks[i - 1],
        );
      }
    }
  });

  it("reaches DOK 3 or 4 somewhere in every case study", () => {
    // A case study that tops out at DOK 2 is a comprehension exercise.
    for (const m of TEN) {
      expect(Math.max(...m.subParts.map((s) => s.dokLevel)), m.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("carries 3–4 sub-parts and typically four marks", () => {
    for (const m of TEN) {
      expect(m.subParts.length, m.id).toBeGreaterThanOrEqual(3);
      expect(m.subParts.length, m.id).toBeLessThanOrEqual(4);
      const total = m.subParts.reduce((a, s) => a + s.marks, 0);
      expect(total, `${m.id} totals ${total}`).toBe(4);
    }
  });

  it("no key derivation leans on data marked non-essential", () => {
    for (const m of TEN) {
      const errs = validateCaseStudy(m).filter((e) => e.message.includes("non-essential"));
      expect(errs, m.id).toEqual([]);
    }
  });

  it("reading load matches the grade for every passage", () => {
    for (const m of TEN) {
      const findings = lintItem({
        stem: m.subParts[0].question,
        passage: m.scenario.passage,
        format: "case_study",
        gradeYears: 10,
      });
      expect(itemPasses(findings), `${m.id}: ${JSON.stringify(findings)}`).toBe(true);
    }
  });

  it("instantiates into an item with the right total", () => {
    const item = instantiateCaseStudy(TEN[0]);
    expect(item.totalMarks).toBe(4);
    expect(item.subParts).toHaveLength(3);
    expect(item.passage).toBe(TEN[0].scenario.passage);
  });
});

describe("the case-study validator catches what it is for", () => {
  const base = TEN[0];

  it("rejects an answer quoted in the passage", () => {
    const bad: CaseStudyTaskModel = {
      ...base,
      id: "bad-verbatim",
      subParts: [
        { ...base.subParts[0], key: "The journey to Noida Sector 62 takes 71 minutes" },
        base.subParts[1],
        base.subParts[2],
      ],
    };
    expect(validateCaseStudy(bad).some((e) => e.message.includes("word-for-word"))).toBe(true);
    expect(() => instantiateCaseStudy(bad)).toThrow();
  });

  it("still rejects a single passage token when the sub-part claims DOK 2+", () => {
    // The verbatim rule has a carve-out: a one-word answer lifted from the
    // passage is allowed at DOK 1, because "which day stands apart?" must be
    // answered with a day the passage names and the passage never says which
    // day it is. That carve-out is the kind that quietly swallows the rule, so
    // both of its edges are pinned. Claiming DOK 2 while reading a word off
    // the page is not application by any definition.
    const bad: CaseStudyTaskModel = {
      ...base,
      id: "bad-token-dok",
      subParts: [
        { ...base.subParts[0], key: "Dwarka", dokLevel: 2 },
        { ...base.subParts[1], dokLevel: 2 },
        base.subParts[2],
      ],
    };
    expect(validateCaseStudy(bad).some((e) => e.message.includes("DOK 2"))).toBe(true);
  });

  it("allows a single passage token at DOK 1, which is the whole carve-out", () => {
    const ok: CaseStudyTaskModel = {
      ...base,
      id: "ok-token-dok1",
      subParts: [
        { ...base.subParts[0], key: "Dwarka", dokLevel: 1 },
        base.subParts[1],
        base.subParts[2],
      ],
    };
    expect(validateCaseStudy(ok).filter((e) => e.field.includes("key"))).toEqual([]);
  });

  it("still rejects a multi-word answer sitting in the passage, at any DOK", () => {
    for (const dok of [1, 2, 3, 4] as const) {
      const bad: CaseStudyTaskModel = {
        ...base,
        id: `bad-phrase-${dok}`,
        subParts: [
          { ...base.subParts[0], key: "every 4 minutes", dokLevel: dok },
          { ...base.subParts[1], dokLevel: 4 },
          { ...base.subParts[2], dokLevel: 4 },
        ],
      };
      expect(
        validateCaseStudy(bad).some((e) => e.message.includes("word-for-word")),
        `a multi-word passage answer slipped through at DOK ${dok}`,
      ).toBe(true);
    }
  });

  it("rejects sub-parts that go backwards in DOK", () => {
    const bad: CaseStudyTaskModel = {
      ...base,
      id: "bad-dok",
      subParts: [
        { ...base.subParts[0], dokLevel: 4 },
        { ...base.subParts[1], dokLevel: 2 },
        base.subParts[2],
      ],
    };
    expect(validateCaseStudy(bad).some((e) => e.field.includes("dokLevel"))).toBe(true);
  });

  it("rejects a derivation leaning on decorative data", () => {
    const bad: CaseStudyTaskModel = {
      ...base,
      id: "bad-derivation",
      subParts: [
        {
          ...base.subParts[0],
          keyDerivation:
            "Count the 50 stations and divide the journey time between them to find the gap.",
        },
        base.subParts[1],
        base.subParts[2],
      ],
    };
    expect(validateCaseStudy(bad).some((e) => e.message.includes("non-essential"))).toBe(true);
  });

  it("rejects a passage outside 50–120 words", () => {
    const bad: CaseStudyTaskModel = {
      ...base,
      id: "bad-length",
      scenario: { ...base.scenario, passage: "Too short." },
    };
    expect(validateCaseStudy(bad).some((e) => e.field === "scenario.passage")).toBe(true);
  });

  it("rejects too few sub-parts", () => {
    const bad: CaseStudyTaskModel = { ...base, id: "bad-count", subParts: [base.subParts[0]] };
    expect(validateCaseStudy(bad).some((e) => e.field === "subParts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1.4 Retrieval practice
// ---------------------------------------------------------------------------

const ITEM: PracticeItem = {
  id: "speed-1",
  stem: "A cyclist travels 12 km in 40 minutes at a steady speed. What is the speed in km/h?",
  options: ["9", "15", "18", "24"],
  keyIndex: 2,
  explanation: "40 minutes is two thirds of an hour, so 12 divided by two thirds gives 18 km/h.",
  misconceptions: {
    0: "9 comes from treating 40 minutes as 80 minutes — check which way the conversion goes.",
    1: "15 comes from reading 40 minutes as 0.8 of an hour rather than two thirds.",
    3: "24 comes from doubling the distance instead of scaling the time.",
  },
};

describe("feedback names the misconception, never just 'incorrect'", () => {
  it("says what produced the wrong choice", () => {
    const f = feedbackFor(ITEM, 1);
    expect(f.correct).toBe(false);
    expect(f.misconception).toMatch(/0\.8 of an hour/);
    expect(f.message).toContain("18 is right");
    // The thing this module exists to prevent.
    expect(f.message.toLowerCase()).not.toBe("incorrect");
    expect(f.message.length).toBeGreaterThan(30);
  });

  it("still explains the key when the student was right", () => {
    const f = feedbackFor(ITEM, 2);
    expect(f.correct).toBe(true);
    expect(f.explanation).toMatch(/two thirds/);
  });

  it("explains every distractor, not only the chosen one", () => {
    const all = allDistractorFeedback(ITEM);
    expect(all).toHaveLength(3);
    for (const a of all) expect(a.why.length).toBeGreaterThan(20);
  });

  it("throws rather than degrading to 'incorrect' when a rationale is missing", () => {
    // Deliberately not defensive. A silent fallback would let an item with
    // filler distractors reach a student looking perfectly fine.
    const broken: PracticeItem = { ...ITEM, misconceptions: { 0: "short" } };
    expect(() => feedbackFor(broken, 0)).toThrow(MissingMisconceptionError);
    expect(() => allDistractorFeedback(broken)).toThrow(MissingMisconceptionError);
  });
});

describe("a practice set produces revision, not a grade", () => {
  const items = [ITEM, { ...ITEM, id: "speed-2" }];
  const competencyOf = (id: string) => (id === "speed-1" ? "unit conversion" : "rates");

  it("returns what to look at again", () => {
    const out = summarise(items, { "speed-1": 1, "speed-2": 2 }, competencyOf);
    expect(out.answered).toBe(2);
    expect(out.correct).toBe(1);
    expect(out.revisit).toEqual(["unit conversion"]);
    expect(itemsToRevisit(out)).toEqual(["speed-1"]);
  });

  it("skips unanswered items rather than marking them wrong", () => {
    const out = summarise(items, { "speed-1": 2 }, competencyOf);
    expect(out.answered).toBe(1);
    expect(out.revisit).toEqual([]);
  });

  it("exposes no score, percentage, streak or ranking", () => {
    const out = summarise(items, { "speed-1": 1, "speed-2": 2 }, competencyOf);
    const keys = Object.keys(out);
    for (const banned of ["score", "percent", "percentage", "grade", "streak", "rank"]) {
      expect(keys, `summary exposes "${banned}"`).not.toContain(banned);
    }
    // `correct` is a count for the review screen, deliberately not a ratio —
    // a percentage off two items reads as a grade to a fourteen-year-old.
    expect(typeof out.correct).toBe("number");
  });

  it("names no other student anywhere in the outcome", () => {
    const out = summarise(items, { "speed-1": 1 }, competencyOf);
    const blob = JSON.stringify(out).toLowerCase();
    for (const banned of ["average", "class", "peer", "percentile", "compared"]) {
      expect(blob, `outcome mentions "${banned}"`).not.toContain(banned);
    }
  });
});
