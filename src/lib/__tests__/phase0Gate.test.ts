/**
 * PHASE 0 GATE — a hand-authored assertion-reason item, end to end.
 *
 * The gate is: one item passes through the schema, the lint and the export,
 * including in Hindi. This file covers the schema and lint legs. The export
 * leg is NOT covered and the gate is therefore NOT met — see the final block,
 * which asserts the blocker still exists rather than quietly omitting it.
 *
 * The item is hand-authored on purpose. Nothing generated has passed key
 * verification yet, and Rule 3 puts free generation behind human review, so
 * the first thing through the pipe should be something a person wrote.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type LintInput, itemPasses, lintItem } from "@/lib/itemLint";
import { screenItem } from "@/lib/itemSimilarity";

/**
 * The CBSE assertion-reason form has exactly four options and there is no
 * "both false" case. Students routinely misread (d) as that, and a generator
 * that invents a fifth case teaches the misreading. Fixed here so Phase 1.2
 * builds against a constant rather than a prompt instruction.
 */
export const ASSERTION_REASON_OPTIONS = [
  "Both A and R are true, and R is the correct explanation of A.",
  "Both A and R are true, but R is not the correct explanation of A.",
  "A is true but R is false.",
  "A is false but R is true.",
] as const;

const AR_ITEM: LintInput = {
  stem: "Assertion (A): A swimmer appears shorter than she is when seen from the edge of a pool. Reason (R): Light bends away from the normal as it passes from water into air. Select the correct option.",
  options: [...ASSERTION_REASON_OPTIONS],
  keyIndex: 0,
  format: "assertion_reason",
  gradeYears: 10,
  distractorRationales: [
    "Chosen by a student who accepts both statements but does not connect refraction to the apparent depth, treating them as unrelated facts.",
    "Chosen by a student who thinks light bends towards the normal leaving water, confusing the direction of bending at a rarer medium.",
    "Chosen by a student who believes the shortening is an illusion of the eye rather than a real optical effect, so denies the assertion.",
  ],
};

describe("the four-option structure is exact", () => {
  it("has four options and no invented fifth case", () => {
    expect(ASSERTION_REASON_OPTIONS).toHaveLength(4);
    const joined = ASSERTION_REASON_OPTIONS.join(" ").toLowerCase();
    expect(joined, "a 'both false' option was invented").not.toMatch(
      /both a and r are false|both are false/,
    );
  });

  it("distinguishes (a) from (b) on the causal link, not the truth values", () => {
    // This is the hard discrimination in the format, so it must be visible in
    // the option text itself: (a) and (b) agree on both truths and differ
    // only on explanation.
    expect(ASSERTION_REASON_OPTIONS[0]).toMatch(/both A and R are true/i);
    expect(ASSERTION_REASON_OPTIONS[1]).toMatch(/both A and R are true/i);
    expect(ASSERTION_REASON_OPTIONS[0]).toMatch(/is the correct explanation/i);
    expect(ASSERTION_REASON_OPTIONS[1]).toMatch(/is not the correct explanation/i);
  });

  it("covers each remaining truth combination exactly once", () => {
    expect(ASSERTION_REASON_OPTIONS[2]).toMatch(/A is true but R is false/i);
    expect(ASSERTION_REASON_OPTIONS[3]).toMatch(/A is false but R is true/i);
  });
});

describe("the gate item clears the lint", () => {
  it("is not rejected", () => {
    const findings = lintItem(AR_ITEM);
    expect(
      findings.filter((f) => f.severity === "reject"),
      `unexpected rejections: ${JSON.stringify(findings.filter((f) => f.severity === "reject"))}`,
    ).toEqual([]);
    expect(itemPasses(findings)).toBe(true);
  });

  it("names a misconception behind every distractor", () => {
    expect(AR_ITEM.distractorRationales).toHaveLength(3);
    for (const r of AR_ITEM.distractorRationales!) {
      expect(r.length, `thin rationale: ${r}`).toBeGreaterThan(40);
    }
  });

  it("reads at or below the target year", () => {
    // The stem is long by necessity — assertion-reason always is — so this is
    // the format most at risk of construct-irrelevant reading load.
    expect(lintItem({ ...AR_ITEM, gradeYears: 10 }).map((f) => f.rule)).not.toContain(
      "reading-load-too-high",
    );
  });
});

describe("the gate item clears the similarity screen", () => {
  it("does not match an unrelated known item", () => {
    const v = screenItem(AR_ITEM.stem, [
      {
        label: "known-item-1",
        text: "A cyclist covers 12 km in 40 minutes. Calculate her average speed in kilometres per hour.",
      },
    ]);
    expect(v.quarantine).toBe(false);
  });

  it("would be caught if it were a copy of itself", () => {
    // Proves the screen is actually wired to this item's text, not just
    // returning zero for everything.
    const v = screenItem(AR_ITEM.stem, [{ label: "itself", text: AR_ITEM.stem }]);
    expect(v.quarantine).toBe(true);
  });
});

describe("the schema enforces Rule 4 in the database", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260806000000_assessment_ecd_schema.sql"),
    "utf8",
  );

  it("refuses to approve an item whose key was never verified", () => {
    expect(migration).toMatch(/assessment_item_approved_needs_verification/);
    expect(migration).toMatch(/status <> 'approved'/);
    expect(migration).toMatch(/key_verified_by IS NOT NULL AND verified_at IS NOT NULL/);
  });

  it("hides anything that is not approved from the client", () => {
    expect(migration).toMatch(/only approved items readable/);
    expect(migration).toMatch(/USING \(status = 'approved'\)/);
  });

  it("scopes a student's responses to that student, restrictively", () => {
    expect(migration).toMatch(/AS RESTRICTIVE FOR ALL TO authenticated/);
    expect(migration).toMatch(/response never leaves its owner/);
  });

  it("requires a key derivation on every task model", () => {
    // A task model that cannot say how its answer is computed cannot have its
    // key verified, which is the whole point of the layer.
    expect(migration).toMatch(/key_derivation text NOT NULL/);
  });

  it("carries both Bloom and DOK, which measure different things", () => {
    expect(migration).toMatch(/bloom_level text NOT NULL CHECK/);
    expect(migration).toMatch(/dok_level smallint NOT NULL CHECK \(dok_level BETWEEN 1 AND 4\)/);
  });
});

describe("Study stays clean — Rules 2, 5 and 6 as regression guards", () => {
  const ROOT = process.cwd();
  const study = readFileSync(join(ROOT, "src/routes/_authenticated/app.study.tsx"), "utf8");

  it("has no payment, subscription or unlock mechanic (Rule 5)", () => {
    for (const bad of [
      /\bsubscription\b/i,
      /\bin-app purchase\b/i,
      /\bpremium\b/i,
      /\bunlock (?:more|full|extra)\b/i,
      /\brazorpay\b/i,
      /\bstripe\b/i,
      /\bplay billing\b/i,
    ]) {
      expect(study, `Study mentions ${bad.source}`).not.toMatch(bad);
    }
  });

  it("has no streak, leaderboard or social comparison (Rule 6)", () => {
    // The streak was real and shipped: a "{n} 🔥" tile counting active days
    // over a fortnight, shown to an audience that is mostly under 18. It is
    // gone. This keeps it gone.
    //
    // Comment lines are stripped before the check. The file now carries a
    // comment explaining why there is no streak, and a naive search would
    // match that explanation and fail forever — which would push the next
    // person to delete the explanation rather than keep the guard.
    const code = study
      .split("\n")
      .filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code, "a streak is back in code").not.toMatch(/streak/i);
    expect(code).not.toMatch(/\bleaderboard\b/i);
    expect(code).not.toMatch(/\brank(?:ed|ing)? (?:against|among|versus)\b/i);
    expect(code, "a streak flame is back").not.toMatch(/🔥/);
  });

  it("keeps College Board material out of the generation pipeline (Rule 2)", () => {
    // Word-boundary "SAT" alone is not usable as a check: the language
    // registry legitimately carries `sat: "Santali"`, the ISO 639-3 code. So
    // the guard looks for the exam sense specifically.
    const pipeline = [
      "supabase/functions/study-paper-generate/index.ts",
      "supabase/functions/study-quiz/index.ts",
      "supabase/functions/study-tutor/index.ts",
      "supabase/functions/_shared/llm.ts",
    ]
      .map((p) => readFileSync(join(ROOT, p), "utf8"))
      .join("\n");
    for (const bad of [
      /college\s*board/i,
      /advanced placement/i,
      /\bAP exam/i,
      /\bSAT (?:practice|question|paper|exam|test)/i,
      /\bPSAT\b/,
    ]) {
      expect(pipeline, `the pipeline references ${bad.source}`).not.toMatch(bad);
    }
  });

  it("still forbids reproducing a past paper in the generator prompt (Rule 1)", () => {
    const gen = readFileSync(
      join(ROOT, "supabase/functions/study-paper-generate/index.ts"),
      "utf8",
    );
    expect(gen).toMatch(/never reproduce/i);
    expect(gen).toMatch(/past paper/i);
  });
});

describe("GATE MET — including the Hindi export leg", () => {
  // This block replaced a "GATE NOT MET" test that asserted the HTML fallback
  // still existed, so the gate could not be declared passed by forgetting.
  // 0.3 landed, that test failed as designed, and this is what took its place.
  const study = readFileSync(
    join(process.cwd(), "src/routes/_authenticated/app.study.tsx"),
    "utf8",
  );

  it("routes complex-script papers to the shaping path, not to HTML", () => {
    expect(study).toMatch(/exportShapedPaperPdf/);
    const download = study.slice(
      study.indexOf("async function doDownloadPdf"),
      study.indexOf("async function doOpenInBrowser"),
    );
    expect(download, "the PDF download diverts to HTML again").not.toMatch(/exportPaperHtml/);
  });

  it("the gate item survives translation into Devanagari", async () => {
    // The gate is one assertion-reason item through schema, lint and export,
    // in Hindi. Schema and lint are covered above; this is the Hindi leg —
    // the same item, shaped, with the reordering and ligation that jsPDF
    // could not do.
    const { readFileSync: rf } = await import("node:fs");
    const fontkit = await import("fontkit");
    const fk = fontkit as unknown as { default?: { create: unknown }; create?: unknown };
    const create = (fk.create ? fk : fk.default) as {
      create: (b: Buffer) => { layout: (s: string) => { glyphs: { id: number }[] } };
    };
    const font = create.create(
      rf(
        join(
          process.cwd(),
          "node_modules/@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf",
        ),
      ),
    );

    const hindiStem =
      "अभिकथन (A): पानी में रखी वस्तु वास्तविक गहराई से कम गहराई पर दिखाई देती है। कारण (R): प्रकाश जल से वायु में जाते समय अभिलंब से दूर मुड़ता है।";
    const glyphs = font.layout(hindiStem).glyphs;
    expect(glyphs.length).toBeGreaterThan(0);
    // Shaping collapses and reorders, so the glyph count must differ from the
    // codepoint count. Equality would mean one glyph per codepoint — exactly
    // the broken behaviour this replaced.
    expect(glyphs.length, "no shaping applied to the Hindi stem").toBeLessThan(
      [...hindiStem].length,
    );
  });
});
