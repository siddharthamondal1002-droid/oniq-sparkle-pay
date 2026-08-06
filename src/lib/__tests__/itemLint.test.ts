/**
 * Every lint rule, proved against a deliberately bad item.
 *
 * A lint nobody has watched fail is a lint that might do nothing. Each rule
 * below gets an item built to trip it and an item built to pass it, so the
 * suite fails both when a rule stops firing and when it starts firing on
 * innocent input — a false-positive lint is worse than none, because the
 * generator learns to write around it.
 */
import { describe, expect, it } from "vitest";
import {
  type LintInput,
  itemPasses,
  lintItem,
  lintPaperDiversity,
  numericOption,
  readingGrade,
  syllables,
} from "@/lib/itemLint";

/** A clean class-10 item. Every test below is a single mutation away from it. */
const GOOD: LintInput = {
  stem: "A cyclist travels 12 km in 40 minutes at a steady speed. What is the speed in km/h?",
  options: ["9", "15", "18", "24"],
  keyIndex: 2,
  format: "mcq",
  gradeYears: 10,
  distractorRationales: [
    "Divides distance by minutes without converting to hours.",
    "Treats 40 minutes as 0.8 of an hour rather than two thirds.",
    "Doubles the distance instead of scaling the time.",
  ],
};

const rules = (i: LintInput) => lintItem(i).map((f) => f.rule);
const rejects = (i: LintInput) =>
  lintItem(i)
    .filter((f) => f.severity === "reject")
    .map((f) => f.rule);

describe("the baseline item is clean", () => {
  it("passes with no rejections", () => {
    expect(lintItem(GOOD).filter((f) => f.severity === "reject")).toEqual([]);
    expect(itemPasses(lintItem(GOOD))).toBe(true);
  });
});

describe("Haladyna structural rules", () => {
  it("rejects all-of-the-above and none-of-the-above", () => {
    for (const bad of ["All of the above", "none of these", "Both A and B"]) {
      const f = rejects({
        ...GOOD,
        options: ["9", "15", "18", bad],
        distractorRationales: GOOD.distractorRationales,
      });
      expect(f, `"${bad}" was allowed`).toContain("banned-option");
    }
  });

  it("rejects a stem that carries no question", () => {
    expect(rejects({ ...GOOD, stem: "Which of the following is correct?" })).toContain(
      "stem-carries-no-question",
    );
  });

  it("rejects duplicate options", () => {
    expect(rejects({ ...GOOD, options: ["9", "15", "15", "24"] })).toContain("duplicate-options");
  });

  it("rejects numeric options that are not in order", () => {
    expect(rejects({ ...GOOD, options: ["9", "24", "15", "18"] })).toContain("options-unordered");
    // …and accepts descending, which is equally ordered.
    expect(rejects({ ...GOOD, options: ["24", "18", "15", "9"] })).not.toContain(
      "options-unordered",
    );
  });

  it("flags a negative stem for review without rejecting it", () => {
    const f = lintItem({
      ...GOOD,
      stem: "Which quantity is NOT conserved in an inelastic collision?",
    });
    expect(f.map((x) => x.rule)).toContain("negative-stem");
    // Deliberate: sometimes the negative is the only honest phrasing, and
    // auto-rejecting teaches the generator to write evasively instead.
    expect(f.find((x) => x.rule === "negative-stem")!.severity).toBe("review");
  });

  it("flags a length cue", () => {
    expect(
      rules({
        ...GOOD,
        options: [
          "9",
          "15",
          "18 km/h, obtained by converting forty minutes into two thirds of an hour first",
          "24",
        ],
      }),
    ).toContain("option-length-cue");
  });

  it("flags options that are not independent", () => {
    expect(rules({ ...GOOD, options: ["9", "15", "18", "18 or more"] })).toContain(
      "options-not-independent",
    );
  });

  it("flags a stem with two objectives", () => {
    expect(
      rules({ ...GOOD, stem: "What is the speed in km/h? How far would it travel in 3 hours?" }),
    ).toContain("multiple-objectives");
  });
});

describe("option parsing, as taught by a real generated paper", () => {
  // Every case below is lifted from a CBSE Class 9 Maths paper this app
  // generated in production. The first version of the ordering check used
  // Number(), which returns NaN for all of them, so it stood down silently on
  // eight of the paper's ten items — including one whose options really were
  // −5, −11, −1, 3. A check that cannot read the options is not a check.
  it("reads a Unicode minus sign as a negative number", () => {
    expect(numericOption("−11")).toEqual({ value: -11, unit: "" });
    expect(numericOption("–7")).toEqual({ value: -7, unit: "" });
    expect(numericOption("-3")).toEqual({ value: -3, unit: "" });
  });

  it("reads a quantity with a unit", () => {
    expect(numericOption("120°")).toEqual({ value: 120, unit: "°" });
    expect(numericOption("616 cm²")).toEqual({ value: 616, unit: "cm²" });
    expect(numericOption("1,232")).toEqual({ value: 1232, unit: "" });
  });

  it("refuses prose that merely begins with a number", () => {
    // "18 or more" was read as the quantity 18 with unit "or more" by the
    // first attempt, which then exempted it from the independence check.
    expect(numericOption("18 or more")).toBeNull();
    expect(numericOption("22/7")).toBeNull();
    expect(numericOption("0.272727...")).toBeNull();
    expect(numericOption("in the third quadrant")).toBeNull();
  });

  it("catches misordered options written with a Unicode minus", () => {
    expect(rejects({ ...GOOD, options: ["−5", "−11", "−1", "3"] })).toContain("options-unordered");
    expect(rejects({ ...GOOD, options: ["−11", "−5", "−1", "3"] })).not.toContain(
      "options-unordered",
    );
  });

  it("catches misordered options carrying units", () => {
    expect(rejects({ ...GOOD, options: ["60°", "120°", "110°", "130°"] })).toContain(
      "options-unordered",
    );
    expect(
      rejects({ ...GOOD, options: ["154 cm²", "308 cm²", "616 cm²", "1232 cm²"] }),
    ).not.toContain("options-unordered");
  });

  it("does not call two signed numbers non-independent", () => {
    // A word boundary sits between "−" and "2", so a naive containment check
    // finds "2" inside "−2" and flags a perfectly ordinary option pair.
    expect(rules({ ...GOOD, options: ["−2", "1", "2", "4"] })).not.toContain(
      "options-not-independent",
    );
  });

  it("flags options that mix units", () => {
    expect(rules({ ...GOOD, options: ["5 cm", "10 kg", "15 cm", "20 cm"] })).toContain(
      "options-not-homogeneous",
    );
  });
});

describe("distractors must be misconception-based, never filler", () => {
  it("rejects an item whose distractors carry no rationale", () => {
    expect(rejects({ ...GOOD, distractorRationales: [] })).toContain(
      "distractor-without-misconception",
    );
  });

  it("rejects a partial set — one unexplained distractor is still filler", () => {
    expect(rejects({ ...GOOD, distractorRationales: ["Divides distance by minutes."] })).toContain(
      "distractor-without-misconception",
    );
  });

  it("flags a rationale too thin to name a misconception", () => {
    expect(
      rules({ ...GOOD, distractorRationales: ["wrong", "also wrong", "bad maths here"] }),
    ).toContain("distractor-rationale-thin");
  });
});

describe("copied-provenance signals", () => {
  it("rejects references to material that does not exist here", () => {
    for (const bad of [
      "As shown in Fig. 5.2, what is the speed of the cyclist over the whole trip?",
      "Solve Exercise 4.3: a cyclist travels 12 km in 40 minutes. What is the speed?",
      "From the NCERT chapter on motion, what is the cyclist's speed in km/h?",
      "Refer to the table above and state the cyclist's speed in km/h please.",
      "In the 2019 board paper, a cyclist travels 12 km in 40 min. What is the speed?",
    ]) {
      expect(rejects({ ...GOOD, stem: bad }), bad).toContain("copied-provenance");
    }
  });

  it("does not fire on an ordinary stem", () => {
    expect(rejects(GOOD)).not.toContain("copied-provenance");
  });
});

describe("bias lint", () => {
  it("rejects a gendered role", () => {
    expect(
      rejects({
        ...GOOD,
        stem: "Ravi's mother cooks for 40 minutes while he cycles 12 km. What is his speed in km/h?",
      }),
    ).toContain("gender-stereotype");
  });

  it("rejects economic framing used as scenery", () => {
    expect(
      rejects({
        ...GOOD,
        stem: "A poor boy cycles 12 km in 40 minutes to reach school. What is his speed in km/h?",
      }),
    ).toContain("economic-stereotype");
  });

  it("flags caste or religion in a scenario", () => {
    expect(
      rules({
        ...GOOD,
        stem: "A Brahmin shopkeeper cycles 12 km in 40 minutes to open his shop. Find the speed.",
      }),
    ).toContain("social-category-in-scenario");
    // Review, not reject: a Civics item may legitimately need the subject.
    expect(
      lintItem({
        ...GOOD,
        stem: "A Brahmin shopkeeper cycles 12 km in 40 minutes to open his shop. Find the speed.",
      }).find((f) => f.rule === "social-category-in-scenario")!.severity,
    ).toBe("review");
  });

  it("leaves an ordinary named character alone", () => {
    expect(
      rules({
        ...GOOD,
        stem: "Meera cycles 12 km in 40 minutes at a steady speed. Find the speed in km/h.",
      }),
    ).not.toContain("gender-stereotype");
  });

  it("flags a paper concentrated in one region", () => {
    const f = lintPaperDiversity([
      "A train leaves Chennai at 9 am carrying 240 passengers.",
      "A bus in Bengaluru covers 18 km in half an hour on a busy road.",
      "In Hyderabad, a tank fills at 12 litres per minute from one tap.",
      "A cyclist in Kochi rides 12 km in 40 minutes along the backwaters.",
    ]);
    expect(f.map((x) => x.rule)).toContain("region-concentration");
  });

  it("accepts a paper that moves around", () => {
    expect(
      lintPaperDiversity([
        "A train leaves Chennai at 9 am carrying 240 passengers.",
        "A bus in Jaipur covers 18 km in half an hour.",
        "In Kolkata, a tank fills at 12 litres per minute.",
        "A cyclist in Pune rides 12 km in 40 minutes.",
      ]),
    ).toEqual([]);
  });
});

describe("reading load is a fairness check, not a difficulty dial", () => {
  it("counts syllables plausibly", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("cycling")).toBe(2);
    expect(syllables("velocity")).toBe(4);
    expect(syllables("")).toBe(0);
  });

  it("grades a simple sentence low and a dense one high", () => {
    expect(readingGrade("The cat sat on the mat. The dog ran.")).toBeLessThan(4);
    expect(
      readingGrade(
        "The instantaneous velocity attributable to the aforementioned displacement necessitates differentiation of the positional function.",
      ),
    ).toBeGreaterThan(14);
  });

  it("rejects an item pitched years above the student", () => {
    const f = rejects({
      ...GOOD,
      gradeYears: 6,
      stem: "Determine the instantaneous velocity attributable to the aforementioned displacement, presupposing uniform acceleration throughout the specified interval of observation.",
    });
    expect(f).toContain("reading-load-too-high");
  });

  it("does not punish an age-appropriate stem", () => {
    expect(rejects({ ...GOOD, gradeYears: 10 })).not.toContain("reading-load-too-high");
  });

  it("skips reading load for Devanagari rather than inventing a number", () => {
    // Flesch–Kincaid is a regression fitted on English. Running it on Hindi
    // would produce a confident meaningless grade, so the check stands down.
    const f = rules({
      ...GOOD,
      stem: "एक साइकिल चालक 40 मिनट में 12 किलोमीटर की दूरी तय करता है। उसकी चाल किलोमीटर प्रति घंटा में क्या है?",
      gradeYears: 4,
    });
    expect(f).not.toContain("reading-load-too-high");
    expect(f).not.toContain("vocabulary-above-grade");
  });
});

describe("case study — the answer may never be sitting in the passage", () => {
  const passage =
    "A cyclist recorded her rides for a week. On Monday she covered 12 km in 40 minutes. On Tuesday she rode 15 km in an hour. Her average speed on Monday was 18 km/h and she felt it was her fastest.";

  it("rejects an item whose key is quoted verbatim in the passage", () => {
    expect(
      rejects({
        stem: "What was her average speed on Monday?",
        passage,
        options: ["12 km/h", "15 km/h", "18 km/h", "20 km/h"],
        keyIndex: 2,
        format: "case_study",
        gradeYears: 10,
        distractorRationales: [
          "Reads the distance as the speed without converting.",
          "Takes Tuesday's distance instead of Monday's.",
          "Rounds the time to 36 minutes rather than 40.",
        ],
      }),
    ).toContain("answer-verbatim-in-passage");
  });

  it("accepts one that requires combining the passage with a concept", () => {
    expect(
      rejects({
        stem: "How much further would she have travelled on Monday at Tuesday's speed?",
        passage,
        options: ["2 km", "3 km", "4 km", "6 km"],
        keyIndex: 0,
        format: "case_study",
        gradeYears: 10,
        distractorRationales: [
          "Subtracts the distances instead of recomputing at the new speed.",
          "Uses Monday's speed for Tuesday.",
          "Doubles the difference.",
        ],
      }),
    ).not.toContain("answer-verbatim-in-passage");
  });
});
