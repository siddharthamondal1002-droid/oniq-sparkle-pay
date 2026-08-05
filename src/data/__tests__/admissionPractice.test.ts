/**
 * Practice sets — the legal boundary, as tests.
 *
 * Same shape as the English-tests guard, and for the same reason: this is the
 * file somebody will be editing when they think "a few real questions would
 * make this much better". Real, retired or reconstructed items are the bright
 * line — several of these boards treat items as trade secrets as well as
 * copyright — so the boundary is asserted rather than left to a comment.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRACTICE_SETS,
  PRACTICE_SET_DISCLAIMER,
  practiceSetById,
  practiceSetsFor,
} from "@/data/admissionPractice";

const ROOT = process.cwd();
const campus = readFileSync(join(ROOT, "src/routes/_authenticated/app.university.tsx"), "utf8");

describe("nothing claims to be official, and nothing predicts a result", () => {
  const blob = JSON.stringify(PRACTICE_SETS).toLowerCase();

  it("makes no claim of officialness or endorsement", () => {
    for (const bad of [
      "official practice",
      "official question",
      "past paper",
      "actual exam question",
      "endorsed by",
      "approved by",
      "in partnership with",
    ]) {
      expect(blob, `claims "${bad}"`).not.toContain(bad);
    }
  });

  it("promises no score, percentile or outcome", () => {
    for (const bad of ["guarantee", "your score will", "predicted score", "percentile"]) {
      expect(blob, `promises "${bad}"`).not.toContain(bad);
    }
  });

  it("carries the disclaimer, and the UI renders it", () => {
    expect(PRACTICE_SET_DISCLAIMER).toMatch(/written by ONIQ/i);
    expect(PRACTICE_SET_DISCLAIMER).toMatch(/retired or reconstructed exam question/i);
    expect(PRACTICE_SET_DISCLAIMER).toMatch(/reproduced from any official or commercial/i);
    expect(PRACTICE_SET_DISCLAIMER).toMatch(/not affiliated/i);
    expect(campus, "Campus does not render PRACTICE_SET_DISCLAIMER").toMatch(
      /PRACTICE_SET_DISCLAIMER/,
    );
  });

  it("does not score the set, by design", () => {
    // A total would read as a prediction off four self-written questions.
    expect(campus).toMatch(/does not score this set/i);
    expect(campus, "a score total appeared").not.toMatch(/setScore|totalScore|scorePercent/);
  });

  it("attributes the owner of every mark it names", () => {
    for (const s of PRACTICE_SETS) {
      expect(s.owner.length, `${s.test} has no owner attributed`).toBeGreaterThan(5);
      expect(s.officialUrl).toMatch(/^https:\/\//);
    }
  });

  it("stores no imagery or brand asset", () => {
    expect(JSON.stringify(PRACTICE_SETS)).not.toMatch(/\.png|\.jpg|\.svg|logo|wordmark/i);
  });
});

describe("the questions are usable and self-consistent", () => {
  it("every set has questions, timing and a stated skill", () => {
    expect(PRACTICE_SETS.length).toBeGreaterThanOrEqual(4);
    for (const s of PRACTICE_SETS) {
      expect(s.questions.length, `${s.id} has no questions`).toBeGreaterThanOrEqual(3);
      expect(s.minutes, `${s.id} has no timing`).toBeGreaterThan(0);
      expect(s.skill.length, `${s.id} has no skill statement`).toBeGreaterThan(40);
    }
  });

  it("every answer index points at a real option", () => {
    for (const s of PRACTICE_SETS) {
      for (const q of s.questions) {
        expect(q.options.length, `${q.id} has too few options`).toBeGreaterThanOrEqual(3);
        expect(q.answer, `${q.id} answer index out of range`).toBeGreaterThanOrEqual(0);
        expect(q.answer, `${q.id} answer index out of range`).toBeLessThan(q.options.length);
      }
    }
  });

  it("every question explains itself — the explanation is the point", () => {
    for (const s of PRACTICE_SETS) {
      for (const q of s.questions) {
        expect(q.question.length, `${q.id} stem too thin`).toBeGreaterThan(30);
        expect(q.explanation.length, `${q.id} has no explanation`).toBeGreaterThan(40);
      }
    }
  });

  it("has no duplicate ids anywhere", () => {
    const setIds = PRACTICE_SETS.map((s) => s.id);
    expect(new Set(setIds).size).toBe(setIds.length);
    const qIds = PRACTICE_SETS.flatMap((s) => s.questions.map((q) => q.id));
    expect(new Set(qIds).size).toBe(qIds.length);
  });

  it("has no duplicate options within a question", () => {
    for (const s of PRACTICE_SETS) {
      for (const q of s.questions) {
        expect(new Set(q.options).size, `${q.id} repeats an option`).toBe(q.options.length);
      }
    }
  });

  it("spreads the correct answer around rather than parking it on one index", () => {
    // All-A is the classic tell of a hastily written set.
    const answers = PRACTICE_SETS.flatMap((s) => s.questions.map((q) => q.answer));
    expect(new Set(answers).size).toBeGreaterThan(1);
  });
});

describe("format facts are dated and defer to the owner", () => {
  it("every set records when it was checked", () => {
    for (const s of PRACTICE_SETS) {
      expect(s.verifiedOn, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the UI shows the date and points at the official page", () => {
    expect(campus).toMatch(/set\.verifiedOn/);
    expect(campus).toMatch(/authority on format/i);
  });
});

describe("destination ordering is relevance, never exclusion", () => {
  it("returns every set for every destination", () => {
    for (const c of ["IN", "US", "GB", "AE", "CA", "AU", "SG", "ZZ"]) {
      expect(practiceSetsFor(c).length, `${c} dropped a set`).toBe(PRACTICE_SETS.length);
    }
  });

  it("leads with a locally relevant set where one exists", () => {
    expect(practiceSetsFor("GB")[0].relevantTo).toContain("GB");
    expect(practiceSetsFor("US")[0].relevantTo).toContain("US");
  });

  it("resolves a set by id, and nothing by a bad id", () => {
    expect(practiceSetById(PRACTICE_SETS[0].id)).not.toBeNull();
    expect(practiceSetById("nope")).toBeNull();
  });
});
