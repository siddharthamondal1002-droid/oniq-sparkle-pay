import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  INSTITUTIONS,
  expectedRouteFor,
  getInstitution,
  institutionsFor,
} from "@/data/institutions";
import { ADMISSIONS_CALENDAR, calendarFor } from "@/data/admissionsCalendar";
import { COUNTRY_ROUTE, ROUTE_EXPLAINERS } from "@/data/admissionRoutes";
import { checkEligibility } from "@/lib/eligibility";

/** ROR IDs: full URL form or the bare ID. Catches a fabricated identifier. */
const ROR_RE = /^(https:\/\/ror\.org\/)?0[a-hj-km-np-tv-z0-9]{6}\d{2}$/;

const RANKING_TERMS = [
  "qs ",
  "times higher",
  "us news",
  "arwu",
  "rank",
  "ranking",
  "#1",
  "top 10",
];

describe("institution registry (Phase 3)", () => {
  it("ids are unique and every row is structurally sound", () => {
    const ids = INSTITUTIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INSTITUTIONS) {
      expect(i.name.length, i.id).toBeGreaterThan(0);
      expect(i.websiteUrl, i.id).toMatch(/^https:\/\/[^\s]+$/);
      expect(i.source.length, i.id).toBeGreaterThan(0);
      expect(getInstitution(i.id), i.id).toBe(i);
    }
  });

  it("every institution's route matches its country's expected route", () => {
    for (const i of INSTITUTIONS) {
      expect(i.route, i.id).toBe(expectedRouteFor(i.country));
    }
  });

  it("every rorId present matches ROR's real format", () => {
    for (const i of INSTITUTIONS) {
      if (i.rorId !== undefined) expect(i.rorId, i.id).toMatch(ROR_RE);
    }
  });

  it("contains no ranking data anywhere", () => {
    const blob = JSON.stringify(INSTITUTIONS).toLowerCase();
    for (const term of RANKING_TERMS) {
      expect(blob.includes(term), `ranking term "${term}" found in institutions`).toBe(false);
    }
  });

  it("every country has at least one institution and one calendar entry", () => {
    for (const c of ALL_COUNTRIES) {
      expect(institutionsFor(c).length, c).toBeGreaterThan(0);
      expect(calendarFor(c).length, c).toBeGreaterThan(0);
    }
  });

  it("every calendar entry is dated and sourced", () => {
    const ids = ADMISSIONS_CALENDAR.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ADMISSIONS_CALENDAR) {
      expect(e.window.length, e.id).toBeGreaterThan(0);
      expect(e.sourceUrl, e.id).toMatch(/^https:\/\//);
      expect(e.lastVerified, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (e.exactDate !== undefined) expect(e.exactDate, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("each country resolves to its documented admission route with explainer copy", () => {
    const expected = {
      IN: "exam_first",
      US: "holistic",
      GB: "centralised_ucas",
      CA: "provincial_grade",
      AU: "atar",
      SG: "multi_track",
      AE: "direct_branch_campus",
    } as const;
    for (const c of ALL_COUNTRIES) {
      expect(COUNTRY_ROUTE[c], c).toBe(expected[c]);
      const ex = ROUTE_EXPLAINERS[COUNTRY_ROUTE[c]];
      expect(ex.howItWorks.length, c).toBeGreaterThan(80);
      expect(ex.documents.length, c).toBeGreaterThan(1);
      expect(ex.officialUrl, c).toMatch(/^https:\/\//);
    }
  });
});

describe("eligibility checker is bounded", () => {
  it("never issues a determination", () => {
    for (const c of ALL_COUNTRIES) {
      const r = checkEligibility({
        destination: c,
        qualification: "secondary_complete",
        hasRouteAssessment: true,
        needsStudentVisa: true,
        hasLanguageEvidence: true,
      });
      const blob = [r.headline, ...r.considerations, r.disclaimer].join(" ").toLowerCase();
      expect(blob).not.toContain("you are eligible");
      expect(blob).not.toContain("you qualify");
      expect(blob).not.toContain("you will be admitted");
      expect(r.officialUrl).toMatch(/^https:\/\//);
      for (const p of r.policies) expect(p.lastVerified.length).toBeGreaterThan(0);
    }
  });

  it("says so when inputs are insufficient", () => {
    const r = checkEligibility({ destination: "IN" });
    expect(r.missingInputs.length).toBeGreaterThan(0);
    expect(r.headline.toLowerCase()).toContain("not enough information");
  });
});
