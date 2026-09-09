/**
 * WHAT A REPORT ACTUALLY LOOKS LIKE, and what the extractor used to do to it.
 *
 * Every other fixture in this repo writes a lab line the way a person would
 * type one — `Haemoglobin 13.2 g/dL`, label and value a single space apart.
 * Real reports are TABLES: a padded label column, a method column, a
 * reference range, an age band, a sample id. Measured 2026-09-09 against the
 * old rule (first number within 24 non-newline characters, unit optional):
 *
 *     layout                          old            new
 *     tight, one space                13.2 g/dL      13.2 g/dL
 *     padded label column             NOTHING        13.2 g/dL
 *     method/specimen column          NOTHING        13.2 g/dL
 *     range column before the result  13.0  WRONG    13.2 g/dL
 *     age band before the result      18    WRONG    13.2 g/dL
 *     sample id before the result     4471  WRONG    13.2 g/dL
 *     the range carries the unit      13.0  WRONG    nothing (ambiguous)
 *     value on the next line          NOTHING        NOTHING (known limit)
 *
 * The three WRONG rows are why this file exists. Grounding cannot catch any
 * of them — a range bound, an age and a sample id are all printed on the page,
 * which is the whole of what grounding checks — and since the owner's
 * 2026-09-09 directive removed the per-value confirm step, such a number went
 * to the timeline with nobody in between.
 *
 * The owner's own report is the evidence that the NOTHING rows are just as
 * real: 8 pages, 14,780 characters of extracted text, `count: 0` with
 * `dropped: 0` (production audit, 2026-09-09 10:40 and 17:32).
 */
import { describe, expect, it } from "vitest";
import { extractCandidates } from "../../../../supabase/functions/_shared/health/ai/extract";

const DAY = "2026-09-09";
const hb = (text: string) =>
  extractCandidates(text, DAY).candidates.filter((c) => c.code.code === "hb");

describe("report layouts the extractor has to survive", () => {
  it("reads the result, not the reference range printed before it", () => {
    expect(hb("Haemoglobin   13.0 - 17.0   13.2  g/dL")).toMatchObject([
      { valueNum: 13.2, valueUnit: "g/dL" },
    ]);
    expect(hb("Haemoglobin   13.0-17.0   13.2  g/dL")).toMatchObject([{ valueNum: 13.2 }]);
  });

  it("reads the result, not an age band or a sample id", () => {
    expect(hb("Haemoglobin  Male 18-60 yrs  13.2 g/dL")).toMatchObject([{ valueNum: 13.2 }]);
    expect(hb("Haemoglobin  Sample 4471  13.2 g/dL")).toMatchObject([{ valueNum: 13.2 }]);
  });

  it("reads a padded label column and a method column, which used to yield nothing", () => {
    expect(hb("Haemoglobin                              13.2   g/dL")).toMatchObject([
      { valueNum: 13.2 },
    ]);
    expect(hb("Haemoglobin   Photometric, Whole Blood EDTA   13.2 g/dL")).toMatchObject([
      { valueNum: 13.2 },
    ]);
  });

  it("still reads the ordinary shapes", () => {
    expect(hb("Haemoglobin 13.2 g/dL")).toMatchObject([{ valueNum: 13.2 }]);
    expect(hb("Haemoglobin  13.2  g/dL  13.0 - 17.0")).toMatchObject([{ valueNum: 13.2 }]);
    expect(hb("Haemoglobin 13.2 g/dL 13.0 – 17.0")).toMatchObject([{ valueNum: 13.2 }]);
  });

  it("never returns a negative reading — a dash is a range, not a minus", () => {
    // This returned MINUS 17 while the fix was being written: the range's
    // upper bound, with the separating dash read as its sign.
    for (const c of extractCandidates("Haemoglobin (13.0-17.0 g/dL) 13.2", DAY).candidates) {
      expect(c.valueNum).toBeGreaterThan(0);
    }
    expect(hb("Haemoglobin (13.0-17.0 g/dL) 13.2")).toHaveLength(0);
  });

  it("refuses rather than guesses when only the range carries a unit", () => {
    expect(hb("Haemoglobin  g/dL  13.0 - 17.0  13.2")).toHaveLength(0);
  });

  it("does not cross a newline to find a value — the stated limit, pinned", () => {
    // A value on its own line is not read. That is deliberate: guessing which
    // row a number belongs to files one analyte's number under another's name.
    // If this ever starts returning a candidate, it was not a free win.
    expect(hb("Haemoglobin\n13.2\ng/dL")).toHaveLength(0);
  });

  it("a unit belonging to another analyte is not this analyte's result", () => {
    expect(hb("Haemoglobin  6.1 %")).toHaveLength(0);
  });

  it("keeps a two-token unit, and does not swallow the following word", () => {
    // "g/dL take" matched no unit and lost the whole reading.
    expect(hb("Haemoglobin 12.1 g/dL take 2 tablets daily")).toMatchObject([
      { valueNum: 12.1, valueUnit: "g/dL" },
    ]);
    const plt = extractCandidates("Platelet count 2.1 lakhs/cumm", DAY).candidates;
    expect(plt).toMatchObject([{ valueNum: 2.1, valueUnit: "lakhs/cumm" }]);
  });

  it("reads the units that genuinely contain a space", () => {
    // These are the reason the second token exists at all, and nothing
    // covered them: dropping it left every one of these silently unread.
    // "x 10^3/µL" also needed the second token to be allowed to start with a
    // DIGIT — it began with a letter, so this common CBC unit read as nothing.
    expect(extractCandidates("WBC 6.2 x 10^3/µL", DAY).candidates).toMatchObject([
      { valueNum: 6.2, valueUnit: "x 10^3/µL" },
    ]);
    expect(extractCandidates("ESR 12 mm/1st hr", DAY).candidates).toMatchObject([
      { valueNum: 12, valueUnit: "mm/1st hr" },
    ]);
  });
});
