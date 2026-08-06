// Item lint — the automated checks every generated item must pass.
//
// WHY THIS EXISTS AND WHY IT IS CHEAP
//
// Study's questions are produced by an LLM at request time. Most item-writing
// failures are not subtle judgements, they are known, nameable defects that a
// machine can spot: an "all of the above" option, a stem you cannot answer
// without reading the options, four distractors where three are filler, a
// reading level two grades above the student. Item-writing guidelines
// (Haladyna and colleagues) have catalogued these for decades. Checking them
// costs milliseconds and catches a large fraction of what makes an item
// invalid.
//
// TWO SEVERITIES, AND THE DISTINCTION MATTERS
//
//   reject — the item does not ship. Structural defects with no legitimate
//            use: an "all of the above" option, duplicate options, a numeric
//            set out of order.
//   review — a human decides. Things that are usually wrong but sometimes
//            correct: a negatively-worded stem is poor practice and is
//            occasionally the only honest way to ask ("which of these is NOT
//            conserved"). Auto-rejecting would push the generator toward
//            evasive phrasing, which is worse.
//
// Everything here is a heuristic over text. A lint cannot tell you an item is
// *good*; it tells you an item is not obviously broken. The key verification
// gate is what protects correctness — this protects everything else.

export type LintSeverity = "reject" | "review";

export type LintFinding = {
  /** Stable id, so a finding can be counted and suppressed deliberately. */
  rule: string;
  severity: LintSeverity;
  message: string;
};

export type ItemFormat = "mcq" | "assertion_reason" | "case_study" | "short" | "long" | "numeric";

export type LintInput = {
  stem: string;
  options?: string[];
  format: ItemFormat;
  /**
   * Notional school year, used for reading load and vocabulary. CBSE class 10
   * is 10. A UK Year 11 or US grade 10 maps to the same number.
   */
  gradeYears: number;
  /**
   * One named misconception per distractor, in the same order as `options`
   * minus the key. Rule: distractors are misconception-based, never filler —
   * so an absent rationale is itself a finding.
   */
  distractorRationales?: string[];
  /** Index into `options` of the correct answer, where there is one. */
  keyIndex?: number;
  /** Case-study passage, when the format has one. */
  passage?: string;
};

// ---------------------------------------------------------------------------
// Reading load
// ---------------------------------------------------------------------------

/**
 * Syllable estimate for an English word.
 *
 * Vowel-group counting with the common corrections. It is approximate — that
 * is inherent to every readability formula, all of which are regressions over
 * surface features — but it is stable and monotonic, which is what a threshold
 * needs.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Flesch–Kincaid grade level.
 *
 * Chosen because it outputs a school year directly, which is the unit the
 * decision is made in: an item for class 8 should not read at class 12.
 * Construct-irrelevant reading difficulty is a FAIRNESS failure — a student
 * who understands the physics but cannot parse the sentence is marked down for
 * the wrong thing — so this is not a difficulty dial.
 */
export function readingGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

/**
 * Devanagari and other Indic scripts have no syllable heuristic here, and
 * Flesch–Kincaid is not defined for them — it is a regression fitted on
 * English. Running it anyway would produce a confident meaningless number, so
 * reading-load checks are skipped and say so rather than guessing.
 */
export function isLatinScript(text: string): boolean {
  return !/[ऀ-ॿঀ-௿ఀ-ൿ؀-ۿ]/.test(text);
}

// ---------------------------------------------------------------------------
// Signals of copied provenance
//
// A generated item should never refer to a figure, an exercise number or a
// page — there is no figure, and there is no page. When one appears, the model
// is echoing the shape of source material, which is both a validity problem
// (the reference resolves to nothing) and a copyright signal worth catching
// early. This is a cheap complement to the similarity screen, not a substitute.
// ---------------------------------------------------------------------------
const COPIED_PROVENANCE = [
  /\bNCERT\b/i,
  /\bexercise\s+\d+(\.\d+)?/i,
  /\bfig(?:ure)?\.?\s*\d+(\.\d+)?/i,
  /\bin the (?:above|given|following) (?:figure|diagram|table|passage)\b/i,
  /\bas (?:discussed|shown|seen) in (?:the )?(?:previous|earlier|chapter)\b/i,
  /\bpage\s+\d+\b/i,
  /\brefer to\b/i,
  /\b(?:20\d\d)\s*(?:board|paper|exam)\b/i,
  /\bprevious year\b/i,
];

// ---------------------------------------------------------------------------
// Bias lint
//
// Scope note, so nobody over-reads what this can do: these are surface
// patterns. They catch the crude cases, which is worth doing because the crude
// cases are the ones a generator actually produces. They do not certify an
// item as unbiased, and no automated check can.
// ---------------------------------------------------------------------------

/**
 * Caste and religion have no place in a practice question's *scenario*. This
 * is not a list of slurs — it is a list of category markers that simply should
 * not be assigned to a character in an arithmetic word problem. A student's
 * community is not a variable in a physics question.
 *
 * Flagged for review rather than rejected, because a Civics or History item
 * may legitimately need to discuss caste or religion as subject matter.
 */
const SOCIAL_CATEGORY = [
  /\b(?:brahmin|kshatriya|vaishya|shudra|dalit|harijan)\b/i,
  /\b(?:scheduled\s+(?:caste|tribe)|\bOBC\b|upper[- ]caste|lower[- ]caste)\b/i,
  /\b(?:hindu|muslim|sikh|christian|jain|buddhist|parsi)\s+(?:boy|girl|family|man|woman|student|shopkeeper|farmer)\b/i,
];

/** Occupational and domestic roles pinned to a gender. */
const GENDER_STEREOTYPE = [
  /\b(?:mother|mrs\.?|aunt|sister|wife)\b[^.?!]{0,40}\b(?:cooks?|cooking|kitchen|cleans?|cleaning|sews?|washing)\b/i,
  /\b(?:father|mr\.?|uncle|brother|husband)\b[^.?!]{0,40}\b(?:earns?|salary|office|drives?|business|engineer|doctor)\b/i,
  /\b(?:boys are|girls are)\b/i,
  /\bwoman driver\b/i,
];

/** Framing that makes a child's economic position part of the scenery. */
const ECONOMIC_STEREOTYPE = [
  /\b(?:poor|illiterate|backward)\s+(?:boy|girl|child|student|family|village|farmer)\b/i,
  /\b(?:servant|maid|slum dweller|beggar)\b/i,
];

/**
 * Region markers, used for the paper-level diversity check rather than
 * per-item rejection. One item set in Chennai is fine; ten in a row is a
 * paper that reads as though written for one city.
 */
export const REGION_MARKERS: Record<string, RegExp> = {
  north: /\b(?:delhi|jaipur|lucknow|chandigarh|punjab|haryana|rajasthan)\b/i,
  south: /\b(?:chennai|bengaluru|bangalore|hyderabad|kochi|kerala|tamil nadu|karnataka|andhra)\b/i,
  east: /\b(?:kolkata|patna|bhubaneswar|guwahati|bengal|bihar|odisha|assam)\b/i,
  west: /\b(?:mumbai|pune|ahmedabad|surat|nagpur|maharashtra|gujarat|goa)\b/i,
};

// ---------------------------------------------------------------------------
// The lint
// ---------------------------------------------------------------------------

/** Escape a string for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `haystack` contain `needle` as a whole phrase?
 *
 * Word-bounded on both ends where the edge characters are word characters, so
 * "18" is found in "18 or more" but not inside "180", and "2 km" is not found
 * inside "12 km". Plain substring matching gets both of those wrong, and both
 * are the cases these checks actually run on.
 */
export function containsAsPhrase(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  const lead = /^\w/.test(n) ? "\\b" : "";
  const tail = /\w$/.test(n) ? "\\b" : "";
  return new RegExp(`${lead}${escapeRe(n)}${tail}`, "i").test(haystack);
}

const OPTION_BANNED = [
  /^all of the above\.?$/i,
  /^none of the above\.?$/i,
  /^both [ab] and [bcd]\.?$/i,
  /^all of these\.?$/i,
  /^none of these\.?$/i,
];

export function lintItem(input: LintInput): LintFinding[] {
  const out: LintFinding[] = [];
  const add = (rule: string, severity: LintSeverity, message: string) =>
    out.push({ rule, severity, message });

  const stem = input.stem.trim();
  const opts = input.options ?? [];
  const full = `${input.passage ?? ""} ${stem}`.trim();

  // -- Stem ----------------------------------------------------------------

  if (stem.length < 15) {
    add("stem-too-thin", "reject", "The stem is too short to pose a question.");
  }

  // Central idea in the stem: a student should be able to attempt an answer
  // from the stem alone. "Which of the following is correct?" carries no
  // question at all — the options are doing the work, which turns the item
  // into a reading-comparison task rather than an assessment of the
  // competency.
  if (
    opts.length > 0 &&
    /^which (?:of the following|one) (?:is|are)?\s*(?:correct|true|right)?\s*\??$/i.test(stem)
  ) {
    add(
      "stem-carries-no-question",
      "reject",
      "The stem poses no question — the central idea must be in the stem, not spread across the options.",
    );
  }

  // One objective per item.
  const questionMarks = (stem.match(/\?/g) ?? []).length;
  if (questionMarks > 1) {
    add("multiple-objectives", "review", "The stem asks more than one question.");
  }
  if (/\b(?:and also|;\s*also|as well as explain)\b/i.test(stem)) {
    add("multiple-objectives", "review", "The stem appears to bundle two tasks.");
  }

  // Negative wording: flagged, never auto-rejected. Sometimes the honest
  // phrasing genuinely is a negative, and rejecting outright teaches the
  // generator to write evasively instead.
  if (/\b(?:NOT|EXCEPT|never|incorrect|false|cannot)\b/.test(stem)) {
    add(
      "negative-stem",
      "review",
      "Negatively-worded stem — confirm the negative is emphasised and unavoidable.",
    );
  }

  // -- Copied provenance ---------------------------------------------------

  for (const re of COPIED_PROVENANCE) {
    if (re.test(full)) {
      add(
        "copied-provenance",
        "reject",
        `Refers to source material that does not exist here (${re.source}). This is both a dangling reference and a copying signal.`,
      );
      break;
    }
  }

  // -- Options -------------------------------------------------------------

  if (opts.length) {
    for (const o of opts) {
      if (OPTION_BANNED.some((re) => re.test(o.trim()))) {
        add(
          "banned-option",
          "reject",
          `"${o}" — all/none-of-the-above options test test-wiseness, not the competency.`,
        );
        break;
      }
    }

    const trimmed = opts.map((o) => o.trim().toLowerCase());
    if (new Set(trimmed).size !== trimmed.length) {
      add("duplicate-options", "reject", "Two options are identical.");
    }

    // Non-independence: one option wholly containing another means picking
    // between them is a reading exercise.
    //
    // Matched on word boundaries rather than raw substring. A minimum-length
    // guard was the first attempt and it was wrong in exactly the case that
    // matters: the classic non-independent pair is numeric ("18" versus "18 or
    // more"), and a guard long enough to suppress noise also suppressed every
    // numeric option. Boundaries do the job instead — "18" does not match
    // inside "180", so short options are safe to check.
    outer: for (let i = 0; i < trimmed.length; i++) {
      if (!trimmed[i]) continue;
      for (let j = 0; j < trimmed.length; j++) {
        if (i === j || trimmed[j].length <= trimmed[i].length) continue;
        if (containsAsPhrase(trimmed[j], trimmed[i])) {
          add(
            "options-not-independent",
            "review",
            `Option "${opts[i]}" is contained in "${opts[j]}".`,
          );
          break outer;
        }
      }
    }

    // Length cue: the longest option being far longer than the rest is the
    // oldest tell in multiple choice, and test-wise students exploit it.
    const lens = opts.map((o) => o.trim().length).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)];
    const longest = lens[lens.length - 1];
    if (median > 0 && longest > median * 2.5 && longest - median > 25) {
      add(
        "option-length-cue",
        "review",
        "One option is much longer than the others — a length cue to the answer.",
      );
    }

    // Homogeneity and ordering for numeric options.
    const nums = opts.map((o) => Number(o.trim().replace(/[,\s]/g, "")));
    const allNumeric = nums.every((n) => Number.isFinite(n));
    if (allNumeric && nums.length > 2) {
      const asc = nums.every((n, i) => i === 0 || n >= nums[i - 1]);
      const desc = nums.every((n, i) => i === 0 || n <= nums[i - 1]);
      if (!asc && !desc) {
        add(
          "options-unordered",
          "reject",
          "Numeric options must be in ascending or descending order.",
        );
      }
    } else if (!allNumeric && nums.some((n) => Number.isFinite(n))) {
      add(
        "options-not-homogeneous",
        "review",
        "Options mix numbers and text — they should be the same kind of thing.",
      );
    }

    // Distractors must be misconception-based. A missing rationale is a
    // finding in itself: it means nobody can say what wrong thinking the
    // option represents, which is the definition of filler.
    const distractorCount = input.keyIndex === undefined ? opts.length : opts.length - 1;
    const rationales = input.distractorRationales ?? [];
    if (rationales.length < distractorCount) {
      add(
        "distractor-without-misconception",
        "reject",
        `${distractorCount - rationales.length} distractor(s) carry no named misconception — a distractor nobody can justify is filler.`,
      );
    }
    if (rationales.some((r) => r.trim().length < 12)) {
      add(
        "distractor-rationale-thin",
        "review",
        "A distractor rationale is too short to name a misconception.",
      );
    }
  }

  // -- Reading load and vocabulary ----------------------------------------

  if (isLatinScript(full)) {
    const grade = readingGrade(full);
    // Two years of headroom. Below that a threshold fires on ordinary
    // sentence-length variation rather than on genuine difficulty.
    if (grade > input.gradeYears + 2) {
      add(
        "reading-load-too-high",
        "reject",
        `Reads at grade ${grade.toFixed(1)} for a year-${input.gradeYears} student. Construct-irrelevant reading difficulty is a fairness failure, not a difficulty setting.`,
      );
    }
    const words = full.split(/\s+/).filter(Boolean);
    const hard = words.filter((w) => syllables(w) >= 5);
    if (hard.length > Math.max(2, words.length * 0.06)) {
      add(
        "vocabulary-above-grade",
        "review",
        `Unusually dense vocabulary (${hard.length} long words): ${hard.slice(0, 4).join(", ")}.`,
      );
    }
  }

  // -- Bias ----------------------------------------------------------------

  for (const re of SOCIAL_CATEGORY) {
    if (re.test(full)) {
      add(
        "social-category-in-scenario",
        "review",
        "Caste or religion appears in the scenario. Legitimate in Civics or History; never as scenery in an arithmetic problem.",
      );
      break;
    }
  }
  for (const re of GENDER_STEREOTYPE) {
    if (re.test(full)) {
      add("gender-stereotype", "reject", "A role is pinned to a gender.");
      break;
    }
  }
  for (const re of ECONOMIC_STEREOTYPE) {
    if (re.test(full)) {
      add("economic-stereotype", "reject", "A character's economic position is used as scenery.");
      break;
    }
  }

  // -- Case study ----------------------------------------------------------

  if (input.format === "case_study" && input.passage) {
    // The answer must never be stated verbatim in the passage, or the item
    // measures locating a sentence rather than applying a concept — which is
    // exactly the competency this format exists to test.
    //
    // Phrase-matched, and with no minimum length. A length threshold was the
    // first attempt and it silently exempted the commonest case: the answer to
    // a case-study sub-part is usually a short quantity like "18 km/h", which
    // is exactly the thing that must not already be sitting in the passage.
    const keyText =
      input.keyIndex !== undefined && opts[input.keyIndex] ? opts[input.keyIndex] : "";
    if (keyText.trim() && containsAsPhrase(input.passage, keyText)) {
      add(
        "answer-verbatim-in-passage",
        "reject",
        "The correct answer appears word-for-word in the passage — this is a retrieval task, not a competency item.",
      );
    }
  }

  return out;
}

/** An item ships only if nothing rejected it. Reviews are a queue, not a block. */
export function itemPasses(findings: LintFinding[]): boolean {
  return !findings.some((f) => f.severity === "reject");
}

/**
 * Paper-level diversity. Per-item checks cannot see that every scenario is set
 * in the same city — that only shows up across a set.
 */
export function lintPaperDiversity(stems: string[]): LintFinding[] {
  if (stems.length < 4) return [];
  const counts: Record<string, number> = {};
  for (const s of stems) {
    for (const [region, re] of Object.entries(REGION_MARKERS)) {
      if (re.test(s)) counts[region] = (counts[region] ?? 0) + 1;
    }
  }
  const placed = Object.values(counts).reduce((a, b) => a + b, 0);
  if (placed < 3) return [];
  const dominant = Math.max(...Object.values(counts));
  if (dominant / placed > 0.75) {
    const region = Object.entries(counts).find(([, n]) => n === dominant)?.[0];
    return [
      {
        rule: "region-concentration",
        severity: "review",
        message: `${dominant} of ${placed} placed scenarios are in the ${region}. Vary regions so no group reads the paper as written for somebody else.`,
      },
    ];
  }
  return [];
}
