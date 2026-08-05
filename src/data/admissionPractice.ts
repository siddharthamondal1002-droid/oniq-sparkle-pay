// Campus — practice question sets for admission tests.
//
// ============================================================================
// LEGAL POSITION — the same boundary as src/data/englishTests.ts
// ============================================================================
//
// "Add some practice sets / question sets if legally viable." It is viable in
// exactly one shape, and the shape is narrow enough to be worth restating here
// rather than pointing at another file, because this is the file somebody will
// be editing when they are tempted to paste in "a few real questions".
//
// SAFE
//
//   - The STRUCTURE of a test is fact: how many sections, how long, how it is
//     scored, what a question type is called. Facts are not copyrightable.
//   - NAMING a test to say which test a set rehearses is nominative fair use.
//   - QUESTIONS ONIQ WROTE, in the same FORM as the real ones. Form is not
//     protected; particular expression is. Every item below was written for
//     ONIQ, from scratch, against a published description of the task type.
//
// NOT SAFE — and therefore absent
//
//   - Real, retired, leaked or "remembered" exam questions. Several of these
//     boards pursue item leakage aggressively and treat items as trade
//     secrets as well as copyright. This is the bright line. No exceptions,
//     including "I only changed the numbers" — a numerically altered copy of
//     a protected item is a derivative work.
//   - Official passages, diagrams, answer keys, rubrics or score converters.
//   - Anything implying endorsement, official status, or a predicted score.
//
// A NOTE ON SUBJECT MATTER
//
// Aptitude items are the safest possible ground: an arithmetic word problem or
// a logical-reasoning stem tests a skill, and the skill is not owned by
// anybody. Where an item needs a passage, ONIQ writes the passage too. Nothing
// here quotes a source that a board also quotes.

export type PracticeQuestion = {
  id: string;
  /** ONIQ's own stem. Never a real, retired or reconstructed item. */
  question: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  /** Why it is right — the teaching, which is the point of a practice set. */
  explanation: string;
};

export type PracticeSet = {
  id: string;
  /** The test this rehearses. Named nominatively, text only. */
  test: string;
  owner: string;
  /** The task type as the test publishes it — a factual label. */
  section: string;
  title: string;
  /** What the section is actually testing, in ONIQ's words. */
  skill: string;
  minutes: number;
  questions: PracticeQuestion[];
  /** Where to find the authoritative format and register. */
  officialUrl: string;
  /** Countries this test is usually taken for. Relevance ordering only. */
  relevantTo: string[];
  verifiedOn: string;
};

export const PRACTICE_SET_DISCLAIMER =
  "Every question here was written by ONIQ. None is a real, retired or reconstructed exam question, and none is reproduced from any official or commercial preparation material. ONIQ is not affiliated with, endorsed by or approved by any test owner, and nothing here is scored or predicts a result.";

export const PRACTICE_SETS: PracticeSet[] = [
  {
    id: "sat-math-linear",
    test: "SAT",
    owner: "College Board",
    section: "Math — Algebra",
    title: "Linear equations in one variable",
    skill:
      "Turning a sentence into an equation and solving it. Most marks lost here are lost in the translation, not the algebra.",
    minutes: 8,
    questions: [
      {
        id: "sat-m-1",
        // Units are spelled out rather than symbolised. The currency fence is
        // right to fire on a symbol here: these strings are question text, not
        // a formatted amount, so moneyIn() would be the wrong tool — and a
        // symbol would also pin an otherwise portable problem to one market.
        question:
          "A delivery service charges a flat fee of 40 dollars plus 12 dollars for each mile. A delivery cost 136 dollars. How many miles was it?",
        options: ["6", "8", "10", "12"],
        answer: 1,
        explanation:
          "40 + 12m = 136, so 12m = 96 and m = 8. The flat fee is the constant; the per-unit charge is the coefficient. Setting it up correctly is the whole question.",
      },
      {
        id: "sat-m-2",
        question: "If 3(x − 4) = 2x + 5, what is the value of x?",
        options: ["7", "11", "17", "19"],
        answer: 2,
        explanation:
          "3x − 12 = 2x + 5, so x = 17. Distribute before collecting terms — skipping the distribution is the usual slip.",
      },
      {
        id: "sat-m-3",
        question: "A line passes through (2, 5) and (6, 13). What is its slope?",
        options: ["1/2", "2", "3", "4"],
        answer: 1,
        explanation:
          "(13 − 5) / (6 − 2) = 8 / 4 = 2. Keep the point order consistent in numerator and denominator; reversing one and not the other flips the sign.",
      },
      {
        id: "sat-m-4",
        question: "The sum of three consecutive even integers is 84. What is the largest?",
        options: ["26", "28", "30", "32"],
        answer: 2,
        explanation:
          "n + (n+2) + (n+4) = 84 gives 3n = 78, n = 26, so the integers are 26, 28, 30. The question asks for the largest, not for n — read the final line twice.",
      },
    ],
    officialUrl: "https://satsuite.collegeboard.org",
    relevantTo: ["US", "CA"],
    verifiedOn: "2026-08-05",
  },
  {
    id: "sat-reading-evidence",
    test: "SAT",
    owner: "College Board",
    section: "Reading and Writing — Command of Evidence",
    title: "Which detail supports the claim",
    skill:
      "Separating a statement that merely sounds relevant from one that actually supports the specific claim made.",
    minutes: 6,
    questions: [
      {
        id: "sat-r-1",
        question:
          "ONIQ's own passage: 'A city removed parking from its central square in 2019. Footfall in the surrounding shops rose 14% over the following two years, while footfall citywide fell 3%.' Which finding would most strengthen the claim that removing the parking caused the rise?",
        options: [
          "The square is a popular meeting point.",
          "Comparable squares that kept their parking saw footfall fall over the same period.",
          "Shopkeepers said they preferred the square without cars.",
          "The city spent money promoting the square in 2020.",
        ],
        answer: 1,
        explanation:
          "A control group is what turns a correlation into evidence of cause. Option 4 actively weakens it by offering a rival explanation, and options 1 and 3 are opinion rather than measurement.",
      },
      {
        id: "sat-r-2",
        question: "In the same passage, which choice most undermines the causal claim?",
        options: [
          "The 3% citywide fall was driven entirely by one district.",
          "A large office block opened beside the square in 2019.",
          "The square has been pedestrianised before.",
          "Footfall was measured by the same method throughout.",
        ],
        answer: 1,
        explanation:
          "A new office block supplies an alternative cause for the rise. Option 4 strengthens the study by holding measurement constant; option 1 is about the comparison figure, not the square.",
      },
      {
        id: "sat-r-3",
        question:
          "ONIQ's own sentence: 'The results were significant, ___ the sample was small enough that the authors urged caution.' Which choice best completes it?",
        options: ["therefore", "although", "because", "moreover"],
        answer: 1,
        explanation:
          "The two halves pull in opposite directions, so the connector must be concessive. 'Although' is the only contrast on offer.",
      },
    ],
    officialUrl: "https://satsuite.collegeboard.org",
    relevantTo: ["US", "CA"],
    verifiedOn: "2026-08-05",
  },
  {
    id: "ucat-decision-making",
    test: "UCAT",
    owner: "UCAT Consortium",
    section: "Decision Making",
    title: "Logical deduction from a short brief",
    skill:
      "Holding several constraints at once and reading only what follows from them — not what is merely plausible.",
    minutes: 7,
    questions: [
      {
        id: "ucat-1",
        question:
          "Four clinics — P, Q, R and S — open on exactly one day each, Monday to Thursday, no two on the same day. Q opens before R. S opens on Thursday. P opens the day after Q. Which day does R open?",
        options: ["Monday", "Tuesday", "Wednesday", "Cannot be determined"],
        answer: 2,
        explanation:
          "S takes Thursday. Q and P are consecutive, so they are Mon–Tue, leaving Wednesday for R. Q before R holds. Test each arrangement rather than reasoning from the first that feels right.",
      },
      {
        id: "ucat-2",
        question:
          "'All the ward's night staff are trained in resuscitation. Some of the ward's staff are not trained in resuscitation.' Which conclusion follows?",
        options: [
          "Some night staff are untrained.",
          "Some staff who are not night staff are untrained.",
          "Most staff are untrained.",
          "No conclusion follows.",
        ],
        answer: 1,
        explanation:
          "Untrained staff exist, and no night staff can be untrained, so the untrained ones must be non-night staff. Option 3 imports a quantity the statements never give.",
      },
      {
        id: "ucat-3",
        question:
          "A trial reports that a drug 'reduced the risk of relapse by 50%'. Baseline relapse risk was 4%. What is the absolute reduction?",
        options: [
          "50 percentage points",
          "4 percentage points",
          "2 percentage points",
          "Cannot be determined",
        ],
        answer: 2,
        explanation:
          "Halving 4% gives 2%, so the absolute reduction is 2 percentage points. Relative and absolute risk are routinely conflated, and the distinction is the point of the item.",
      },
    ],
    officialUrl: "https://www.ucat.ac.uk",
    relevantTo: ["GB", "AU"],
    verifiedOn: "2026-08-05",
  },
  {
    id: "gre-quant-ratio",
    test: "GRE",
    owner: "Educational Testing Service (ETS)",
    section: "Quantitative Reasoning",
    title: "Ratios, rates and percentage change",
    skill:
      "Working with proportions without dropping the units, and noticing when a percentage is taken of a different base.",
    minutes: 8,
    questions: [
      {
        id: "gre-q-1",
        question:
          "A lab's sample count rises from 250 to 320. What is the percentage increase, to the nearest whole number?",
        options: ["22%", "26%", "28%", "70%"],
        answer: 2,
        explanation:
          "(320 − 250) / 250 = 70/250 = 0.28, so 28%. The base is the ORIGINAL value. Dividing by 320 gives 22%, which is the trap answer.",
      },
      {
        id: "gre-q-2",
        question: "A price rises 20%, then falls 20%. Compared with the start, the final price is:",
        options: ["Unchanged", "4% lower", "4% higher", "2% lower"],
        answer: 1,
        explanation:
          "1.20 × 0.80 = 0.96, so 4% lower. The fall is taken on a larger base than the rise, which is why successive percentage changes never cancel.",
      },
      {
        id: "gre-q-3",
        question:
          "Two machines fill bottles. Alone, one takes 6 hours and the other 12 hours. Working together, how long?",
        options: ["3 hours", "4 hours", "8 hours", "9 hours"],
        answer: 1,
        explanation:
          "Rates add: 1/6 + 1/12 = 1/4, so 4 hours. Add rates, never times — averaging the two durations to 9 is the standard error.",
      },
    ],
    officialUrl: "https://www.ets.org/gre",
    relevantTo: ["US", "CA", "GB", "AU", "SG"],
    verifiedOn: "2026-08-05",
  },
];

export function practiceSetsFor(country: string): PracticeSet[] {
  // Relevance ordering only — every set stays visible, because a student in
  // India may well be applying to the US, and hiding a set they need is worse
  // than showing one they do not.
  return [...PRACTICE_SETS].sort((a, b) => {
    const aRel = a.relevantTo.includes(country) ? 0 : 1;
    const bRel = b.relevantTo.includes(country) ? 0 : 1;
    return aRel - bRel;
  });
}

export function practiceSetById(id: string): PracticeSet | null {
  return PRACTICE_SETS.find((s) => s.id === id) ?? null;
}
