// MCQ option ordering — shared between the edge generator and the item lint.
//
// WHY THIS FILE IS HERE AND NOT IN src/
//
// Deno functions cannot import from src/, and the languages registry solved
// that by keeping a copy plus a drift test. That is not needed here: this
// module is pure — no Deno globals, no imports — so the edge function and the
// vitest suite can both import the SAME file, and there is no copy to drift.
//
// WHAT IT FIXES
//
// A CBSE Class 9 Maths paper generated in production had eight of its ten MCQs
// with options in scrambled order: 27, 9, 12, 243. Numeric options out of
// sequence are a documented item-writing fault — the student has to scan
// rather than read down a ladder, which adds construct-irrelevant work — and
// the generation prompt said nothing about it.
//
// A prompt instruction alone would not be enough. Models comply with option
// ordering unreliably, and there is no reason to leave it to chance when the
// correct order is computable. So the prompt asks, and this sorts.
//
// THE DANGEROUS PART
//
// Reordering options means the answer key moves. Sorting four options and
// forgetting to remap correct_index turns every right key into a wrong one —
// precisely the Rule 4 catastrophe, delivered at scale and silently. So the
// remap is the thing this module is really about, and it is expressed as
// "find where the key's TEXT ended up" rather than as index arithmetic, which
// is the form that cannot drift out of step with the sort.

export type ParsedOption = { value: number; unit: string };

/**
 * Read an option as a number plus an optional unit.
 *
 * Exam options are not JavaScript numbers: they carry the Unicode MINUS SIGN
 * (U+2212), degree signs, units like "cm²", and thousands separators.
 * Number() returns NaN for all of those, which is how an ordering check comes
 * to pass a misordered set without complaining.
 */
export function numericOption(raw: string): ParsedOption | null {
  const s = raw.trim().replace(/[−–]/g, "-").replace(/,/g, "");
  const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].trim();
  // A unit is a short symbol run — cm², °, %, km/h — never arbitrary prose.
  // Accepting anything without a digit would read "18 or more" as the quantity
  // 18, and a range expression is not a quantity.
  if (unit && !/^[\p{L}°%²³/]{1,6}$/u.test(unit)) return null;
  return { value, unit };
}

/** Are these options a uniform set of quantities that can be put in order? */
export function isOrderableNumericSet(options: string[]): boolean {
  if (options.length < 3) return false;
  const parsed = options.map(numericOption);
  if (parsed.some((p) => p === null)) return false;
  // Mixed units have no single ordering worth imposing.
  return new Set(parsed.map((p) => p!.unit)).size === 1;
}

export type OrderedMcq = {
  options: string[];
  correctIndex: number;
  /** True when the sort actually moved something. */
  reordered: boolean;
};

/**
 * Put numeric options into ascending order and move the key with them.
 *
 * Text options are returned untouched. There is no natural order for "in the
 * third quadrant" versus "on the x-axis", and imposing alphabetical order on
 * prose would be a cue of its own.
 *
 * Returns the input unchanged rather than throwing on a bad key index: this
 * runs inside paper generation, and refusing to reorder is always safe while
 * throwing would lose a paper the student is waiting for.
 */
export function orderMcqOptions(options: string[], correctIndex: number): OrderedMcq {
  const unchanged: OrderedMcq = { options, correctIndex, reordered: false };

  if (!Array.isArray(options) || options.length < 3) return unchanged;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return unchanged;
  }
  if (!isOrderableNumericSet(options)) return unchanged;

  // Duplicate option text would make "find the key by its text" ambiguous.
  // Duplicates are already a lint rejection; here it just means do nothing.
  if (new Set(options).size !== options.length) return unchanged;

  const keyText = options[correctIndex];
  const sorted = [...options].sort((a, b) => numericOption(a)!.value - numericOption(b)!.value);

  // The remap, stated as a search rather than as arithmetic. Index maths that
  // has to stay in step with a comparator is exactly how a key silently
  // detaches from its option.
  const newIndex = sorted.indexOf(keyText);
  if (newIndex < 0) return unchanged;

  return {
    options: sorted,
    correctIndex: newIndex,
    reordered: sorted.some((o, i) => o !== options[i]),
  };
}
