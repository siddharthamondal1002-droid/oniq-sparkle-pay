/**
 * MCQ option ordering, and the key remap that makes it safe.
 *
 * Sorting options is trivial. Sorting them WITHOUT moving the answer key is a
 * catastrophe: it turns every correct key into a wrong one, silently, on every
 * paper, and a student is told the wrong answer with the authority of a right
 * one. That is the single worst outcome this whole assessment loop is written
 * to prevent, so the remap gets an exhaustive check rather than a sample.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOrderableNumericSet,
  numericOption,
  orderMcqOptions,
} from "../../../supabase/functions/_shared/mcqOrder.ts";

describe("the key always follows its own option text", () => {
  it("remaps correctly for every key position, on every permutation of a set", () => {
    // Exhaustive rather than sampled: 4! orderings x 4 key positions = 96
    // cases, and the property must hold for all of them. The invariant is the
    // only one that matters — the option text under the key before the sort
    // must be the option text under the key after it.
    const base = ["9", "27", "12", "243"];
    const perms: string[][] = [];
    const permute = (arr: string[], acc: string[]) => {
      if (!arr.length) return void perms.push(acc);
      arr.forEach((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)], [...acc, x]));
    };
    permute(base, []);
    expect(perms).toHaveLength(24);

    let checked = 0;
    for (const options of perms) {
      for (let k = 0; k < options.length; k++) {
        const keyTextBefore = options[k];
        const out = orderMcqOptions(options, k);
        expect(out.options[out.correctIndex], `${options.join(",")} key=${k}`).toBe(keyTextBefore);
        // …and the result is genuinely sorted.
        const vals = out.options.map((o) => numericOption(o)!.value);
        expect(vals, `${options.join(",")} not sorted`).toEqual([...vals].sort((a, b) => a - b));
        checked += 1;
      }
    }
    expect(checked).toBe(96);
  });

  it("holds for negatives written with a Unicode minus", () => {
    const options = ["−5", "−11", "−1", "3"];
    for (let k = 0; k < 4; k++) {
      const out = orderMcqOptions(options, k);
      expect(out.options[out.correctIndex]).toBe(options[k]);
      expect(out.options).toEqual(["−11", "−5", "−1", "3"]);
    }
  });

  it("holds for quantities carrying units", () => {
    const options = ["616 cm²", "308 cm²", "1232 cm²", "154 cm²"];
    const out = orderMcqOptions(options, 0);
    expect(out.options).toEqual(["154 cm²", "308 cm²", "616 cm²", "1232 cm²"]);
    expect(out.options[out.correctIndex]).toBe("616 cm²");
  });
});

describe("it leaves alone what it should", () => {
  it("does not reorder text options", () => {
    // No natural order for prose, and alphabetising it would be a cue.
    const options = [
      "in the third quadrant",
      "on the x-axis",
      "on the y-axis, below the origin",
      "in the fourth quadrant",
    ];
    const out = orderMcqOptions(options, 2);
    expect(out.options).toEqual(options);
    expect(out.correctIndex).toBe(2);
    expect(out.reordered).toBe(false);
  });

  it("does not reorder a mixed set", () => {
    const options = ["√(16/25)", "0.272727...", "√7", "22/7"];
    expect(orderMcqOptions(options, 2).reordered).toBe(false);
  });

  it("does not reorder when units disagree", () => {
    expect(isOrderableNumericSet(["5 cm", "10 kg", "15 cm"])).toBe(false);
    expect(orderMcqOptions(["5 cm", "10 kg", "15 cm"], 0).reordered).toBe(false);
  });

  it("reports reordered=false when the set was already in order", () => {
    const out = orderMcqOptions(["9", "12", "27", "243"], 1);
    expect(out.reordered).toBe(false);
    expect(out.correctIndex).toBe(1);
  });
});

describe("it refuses rather than throwing, because a paper is waiting", () => {
  it("passes through a bad key index untouched", () => {
    for (const bad of [-1, 4, 1.5, Number.NaN]) {
      const out = orderMcqOptions(["9", "12", "27", "243"], bad);
      expect(out.correctIndex).toBe(bad);
      expect(out.reordered).toBe(false);
    }
  });

  it("passes through duplicates untouched", () => {
    // Finding the key by text is ambiguous with duplicates. Duplicates are
    // already a lint rejection; here the safe move is to do nothing.
    const out = orderMcqOptions(["9", "9", "27", "243"], 0);
    expect(out.reordered).toBe(false);
    expect(out.options).toEqual(["9", "9", "27", "243"]);
  });

  it("passes through short or empty lists", () => {
    expect(orderMcqOptions([], 0).reordered).toBe(false);
    expect(orderMcqOptions(["1", "2"], 0).reordered).toBe(false);
  });
});

describe("the generator actually uses it", () => {
  const gen = readFileSync(
    join(process.cwd(), "supabase/functions/study-paper-generate/index.ts"),
    "utf8",
  );

  it("imports the shared sorter rather than keeping a copy", () => {
    expect(gen).toMatch(/import \{ orderMcqOptions \} from "\.\.\/_shared\/mcqOrder\.ts"/);
  });

  it("applies it to the stored options AND the stored key", () => {
    // Applying it to the options alone would be the catastrophe.
    expect(gen).toMatch(/const ordered = orderMcqOptions\(options, ci\)/);
    expect(gen).toMatch(/options: ordered\.options/);
    expect(gen).toMatch(/correct_index: ordered\.correctIndex/);
    expect(gen, "the raw key is still being stored").not.toMatch(/correct_index: ci,/);
  });

  it("asks the model for ascending order too", () => {
    // Belt and braces: the sort guarantees it, but a model that produces
    // ordered options in the first place also tends to produce better
    // distractors, and the instruction costs nothing.
    expect(gen).toMatch(/ASCENDING NUMERICAL ORDER/);
  });

  it("tells the model not to park the answer in one position", () => {
    expect(gen).toMatch(/not place the correct answer in a consistent position/i);
  });
});

describe("the live paper that prompted this", () => {
  // The eight scrambled sets from the production Class 9 Maths paper. Each
  // must now come out ordered with its key intact.
  const LIVE: { options: string[]; key: number; expect: string }[] = [
    { options: ["27", "9", "12", "243"], key: 0, expect: "27" },
    { options: ["−5", "−11", "−1", "3"], key: 1, expect: "−11" },
    { options: ["2", "−2", "4", "1"], key: 0, expect: "2" },
    { options: ["1", "3", "−1", "2"], key: 0, expect: "1" },
    { options: ["60°", "120°", "110°", "130°"], key: 1, expect: "120°" },
    { options: ["70°", "20°", "110°", "140°"], key: 2, expect: "110°" },
    { options: ["616 cm²", "308 cm²", "1232 cm²", "154 cm²"], key: 0, expect: "616 cm²" },
    { options: ["12", "14", "13", "22"], key: 1, expect: "14" },
  ];

  it("orders all eight and keeps every key on its own answer", () => {
    for (const c of LIVE) {
      const out = orderMcqOptions(c.options, c.key);
      expect(out.reordered, `${c.options.join(",")} was not reordered`).toBe(true);
      expect(out.options[out.correctIndex], c.options.join(",")).toBe(c.expect);
      const vals = out.options.map((o) => numericOption(o)!.value);
      expect(vals).toEqual([...vals].sort((a, b) => a - b));
    }
  });

  it("clears the ordering lint afterwards", async () => {
    const { lintItem } = await import("@/lib/itemLint");
    for (const c of LIVE) {
      const out = orderMcqOptions(c.options, c.key);
      const findings = lintItem({
        stem: "A question with enough words in it to clear the thin-stem check.",
        options: out.options,
        keyIndex: out.correctIndex,
        format: "mcq",
        gradeYears: 9,
        distractorRationales: ["a placeholder rationale", "another one here", "and a third one"],
      });
      expect(
        findings.map((f) => f.rule),
        c.options.join(","),
      ).not.toContain("options-unordered");
    }
  });
});
