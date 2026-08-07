/**
 * Why "couldn't build that paper" happened, and what stops it recurring.
 *
 * THE INCIDENT (7 Aug 2026)
 *
 * A user reported exams not loading. The database showed FOURTEEN papers
 * generated in seven minutes, all for one profile, in bursts of five and six
 * completing within two seconds of each other — and the UI showing an error
 * throughout. The edge logs explained both halves:
 *
 *   genSection no-items kind=long stop_reason=tool_use text_preview=""
 *   section fail totalMarks=30 subject="Maths" reason="long: no items"
 *
 * stop_reason=tool_use means the model answered. Roughly a third of attempts
 * returned a long section the parser would not accept, and ONE bad section
 * discarded the whole paper — including the mcq and short sections, which had
 * generated perfectly, in the same request.
 *
 * Then the client made it worse. Every tap of "try again" started another
 * generation with nothing to stop it, so one failure became seven concurrent
 * runs, each billing three model calls and writing a row nobody would open.
 *
 * Not caused by the option-ordering change deployed the day before: that
 * touched the mcq branch only, and the failures are all in the long section.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describePayload, extractItems } from "../../../supabase/functions/_shared/toolPayload.ts";

const ROOT = process.cwd();
const gen = readFileSync(join(ROOT, "supabase/functions/study-paper-generate/index.ts"), "utf8");
const study = readFileSync(join(ROOT, "src/routes/_authenticated/app.study.tsx"), "utf8");

describe("extractItems accepts what the model actually sends", () => {
  it("takes the schema key when it is there", () => {
    expect(extractItems({ long: [1, 2] }, "long")).toEqual([1, 2]);
  });

  it("takes the only array when the key is unexpected", () => {
    // The model answered — it just named the field something else. Binning a
    // good section over a key name would be perverse.
    expect(extractItems({ questions: [1, 2] }, "long")).toEqual([1, 2]);
    expect(extractItems({ items: [{ q: 1 }] }, "short")).toEqual([{ q: 1 }]);
  });

  it("refuses to guess when more than one array is present", () => {
    // Guessing could put the wrong content in front of a student, so
    // ambiguity is a retry, not a coin flip.
    expect(extractItems({ long: undefined, a: [1], b: [2] }, "long")).toBeNull();
  });

  it("prefers the exact key even when other arrays exist", () => {
    expect(extractItems({ long: [1], other: [2, 3] }, "long")).toEqual([1]);
  });

  it("handles the empty and missing cases without throwing", () => {
    expect(extractItems({}, "long")).toBeNull();
    expect(extractItems(undefined, "long")).toBeNull();
    expect(extractItems(null, "long")).toBeNull();
    expect(extractItems({ long: "not an array" }, "long")).toBeNull();
  });

  it("returns an empty array as an empty array, not as null", () => {
    // The caller decides what an empty section means; the extractor's job is
    // only to say what was there.
    expect(extractItems({ long: [] }, "long")).toEqual([]);
  });
});

describe("describePayload says what was actually in the payload", () => {
  it("names each key with its shape", () => {
    expect(describePayload({ long: [1, 2, 3], note: "x" })).toBe("long[3]|note:string");
  });

  it("distinguishes an empty object from a missing one", () => {
    // The old log said only "no items" for both, and the difference decides
    // whether the fix is a retry or a parser change.
    expect(describePayload({})).toBe("(empty input object)");
    expect(describePayload(undefined)).toBe("(no tool_use block)");
  });
});

describe("the generator retries a failed section instead of losing the paper", () => {
  it("attempts each section up to three times", () => {
    expect(gen).toMatch(/for \(let attempt = 1; attempt <= 3; attempt\+\+\)/);
  });

  it("only gives up after the loop, never inside it", () => {
    // The bug was a single `return { ok: false }` on the first miss. If a
    // bare early return comes back, one transient blip discards the paper
    // again.
    const body = gen.slice(
      gen.indexOf("async function genSection("),
      gen.indexOf("const [mcqRes,"),
    );
    const loopStart = body.indexOf("for (let attempt");
    const loopBody = body.slice(
      loopStart,
      body.lastIndexOf("return { ok: false, reason: lastReason }"),
    );
    expect(loopBody, "a failure path returns from inside the retry loop").not.toMatch(
      /return \{ ok: false/,
    );
    // The success path must still return early — retrying after success would
    // burn three model calls per section.
    expect(loopBody).toMatch(/return \{ ok: true, items: arr \}/);
  });

  it("tells the model what went wrong on a retry", () => {
    expect(gen).toMatch(/previous attempt returned no items/i);
  });

  it("backs off between attempts", () => {
    expect(gen).toMatch(/setTimeout\(res, 400 \* attempt\)/);
  });

  it("uses the shared extractor rather than a bare key lookup", () => {
    expect(gen).toMatch(/extractItems\(toolUse\?\.input, kind\)/);
    expect(gen, "the rigid lookup is back").not.toMatch(/const arr = toolUse\?\.input\?\.\[kind\]/);
  });

  it("logs the attempt number and the payload shape", () => {
    expect(gen).toMatch(/attempt=\$\{attempt\}\/3/);
    expect(gen).toMatch(/input_keys=/);
  });
});

describe("the client cannot start seven generations at once", () => {
  it("guards generateFresh with a ref, not with state", () => {
    // State is captured by the useCallback and would be stale on a rapid
    // second call — which is precisely the case that matters.
    expect(study).toMatch(/const generating = useRef\(false\)/);
    expect(study).toMatch(/if \(generating\.current\) return;/);
    expect(study).toMatch(/generating\.current = true;/);
  });

  it("releases the guard in finally, so a failure cannot wedge it shut", () => {
    // If the guard leaked on the error path, one failed paper would disable
    // generation for the rest of the session — worse than the bug it fixes.
    const fn = study.slice(
      study.indexOf("const generateFresh = useCallback"),
      study.indexOf("// Revoke object URLs on unmount"),
    );
    const finallyBlock = fn.slice(fn.indexOf("} finally {"), fn.indexOf("setLoading(false);") + 30);
    expect(finallyBlock).toMatch(/generating\.current = false/);
  });
});
