/**
 * English tests — the legal boundary, as tests.
 *
 * The thing that makes TOEFL/IELTS notes shippable is narrow: format facts and
 * ONIQ's own prompts are fine, real exam items and official rubrics are not,
 * and nothing may imply endorsement or predict a score. That boundary is easy
 * to cross by accident later — someone pastes in "a really good sample answer"
 * or a band descriptor table and it looks like an improvement.
 *
 * So the boundary is asserted here rather than left to the comment at the top
 * of the data file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENGLISH_TESTS,
  PRACTICE_DISCLAIMER,
  TEST_DISCLAIMER,
  testById,
  testsForDestination,
} from "@/data/englishTests";

const ROOT = process.cwd();
const campus = readFileSync(join(ROOT, "src/routes/_authenticated/app.university.tsx"), "utf8");

describe("nothing here claims to be official or to predict a result", () => {
  it("never calls itself official, approved or endorsed", () => {
    const blob = JSON.stringify(ENGLISH_TESTS).toLowerCase();
    // "officialUrl" and "the official page" are the link OUT to the owner —
    // that is the opposite of claiming officialness, so match on the claim
    // shapes rather than the bare word.
    for (const bad of [
      "official practice",
      "official test",
      "officially approved",
      "endorsed by",
      "approved by ets",
      "in partnership with",
    ]) {
      expect(blob, `claims "${bad}"`).not.toContain(bad);
    }
  });

  it("promises no score, band or outcome", () => {
    const blob = JSON.stringify(ENGLISH_TESTS).toLowerCase();
    for (const bad of ["guarantee", "guaranteed", "your predicted", "we score", "score you"]) {
      expect(blob, `promises "${bad}"`).not.toContain(bad);
    }
  });

  it("carries the not-affiliated disclaimer, and the UI renders it", () => {
    expect(TEST_DISCLAIMER).toMatch(/not affiliated/i);
    expect(TEST_DISCLAIMER).toMatch(/written by ONIQ/i);
    expect(TEST_DISCLAIMER).toMatch(/not.*scored|nothing here is scored/i);
    expect(campus, "Campus does not render TEST_DISCLAIMER").toMatch(/TEST_DISCLAIMER/);
    expect(campus, "Campus does not render PRACTICE_DISCLAIMER").toMatch(/PRACTICE_DISCLAIMER/);
  });

  it("says every prompt is ONIQ's own", () => {
    expect(PRACTICE_DISCLAIMER).toMatch(/ONIQ wrote these/i);
    expect(PRACTICE_DISCLAIMER).toMatch(/not any actual question/i);
  });
});

describe("no third-party imagery or marks beyond the name", () => {
  it("stores no logo, image or brand asset for any test", () => {
    const blob = JSON.stringify(ENGLISH_TESTS);
    expect(blob).not.toMatch(/\.png|\.jpg|\.jpeg|\.svg|logo|wordmark/i);
  });

  it("links only to each owner's own site", () => {
    for (const t of ENGLISH_TESTS) {
      expect(t.officialUrl, `${t.name}`).toMatch(/^https:\/\//);
    }
  });

  it("names the owner of every mark it uses", () => {
    for (const t of ENGLISH_TESTS) {
      expect(t.owner.length, `${t.name} has no owner attributed`).toBeGreaterThan(5);
    }
  });
});

describe("format facts are dated, because formats change", () => {
  it("every test records when its structure was last checked", () => {
    for (const t of ENGLISH_TESTS) {
      expect(t.verifiedOn, `${t.name}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(Date.parse(t.verifiedOn))).toBe(true);
    }
  });

  it("the UI shows the date and defers to the official page", () => {
    expect(campus).toMatch(/verifiedOn/);
    expect(campus).toMatch(/official page is the authority/i);
  });

  it("carries the post-2023 TOEFL format, not the retired one", () => {
    // The independent essay was replaced by the academic-discussion task and
    // the test was cut to under two hours. Getting this wrong would have
    // someone revising for a task that no longer exists.
    const toefl = testById("toefl-ibt")!;
    expect(toefl.totalMinutes).toMatch(/under 2 hours/i);
    expect(JSON.stringify(toefl)).toMatch(/academic discussion/i);
    expect(toefl.sections.map((s) => s.name)).toEqual([
      "Reading",
      "Listening",
      "Speaking",
      "Writing",
    ]);
  });

  it("carries the IELTS nine-band scale and both variants", () => {
    const ielts = testById("ielts-academic")!;
    expect(ielts.scoring).toMatch(/0–9|0-9/);
    expect(JSON.stringify(ielts)).toMatch(/General Training/);
  });
});

describe("the notes are usable, not filler", () => {
  it("gives every test structure, notes and practice", () => {
    expect(ENGLISH_TESTS.length).toBeGreaterThanOrEqual(4);
    for (const t of ENGLISH_TESTS) {
      expect(t.sections.length, `${t.name} has no sections`).toBeGreaterThan(0);
      expect(t.notes.length, `${t.name} has no notes`).toBeGreaterThanOrEqual(3);
      expect(t.practice.length, `${t.name} has no practice`).toBeGreaterThan(0);
      for (const n of t.notes) expect(n.length).toBeGreaterThan(40);
    }
  });

  it("every prompt says what a strong answer does, and how long to spend", () => {
    for (const t of ENGLISH_TESTS) {
      for (const p of t.practice) {
        expect(p.prompt.length, `${p.id} prompt too thin`).toBeGreaterThan(40);
        expect(p.lookFor.length, `${p.id} has no guidance`).toBeGreaterThan(40);
        expect(p.minutes, `${p.id} has no timing`).toBeGreaterThan(0);
      }
    }
  });

  it("has no duplicate prompt ids", () => {
    const ids = ENGLISH_TESTS.flatMap((t) => t.practice.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("destination ordering is relevance, never exclusion", () => {
  it("returns every test for every destination, only reordered", () => {
    for (const c of ["IN", "US", "GB", "AE", "CA", "AU", "SG", "ZZ"]) {
      const got = testsForDestination(c);
      expect(got.length, `${c} dropped a test`).toBe(ENGLISH_TESTS.length);
    }
  });

  it("leads with TOEFL for the US and IELTS for the UK", () => {
    expect(testsForDestination("US")[0].id).toBe("toefl-ibt");
    expect(testsForDestination("GB")[0].id).toBe("ielts-academic");
  });

  it("warns that Duolingo acceptance is not universal", () => {
    const det = testById("duolingo-english-test")!;
    expect(det.acceptedFor).toMatch(/not universal|confirm|check/i);
  });
});
