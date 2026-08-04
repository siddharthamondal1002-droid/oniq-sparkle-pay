import { describe, expect, it } from "vitest";
import {
  POLICY_STATUS_LABEL,
  POLICY_WATCH,
  policiesFor,
  type PolicyStatus,
} from "@/data/policyWatch";

const VALID_STATUSES: PolicyStatus[] = [
  "in_force",
  "finalised_not_yet_effective",
  "announced",
  "proposed",
];

const RANKING_TERMS = ["qs ", "times higher", "us news", "arwu", "ranking", "#1", "top 10"];

describe("policy watch (Phase 3)", () => {
  it("every row is dated, sourced and validly statused", () => {
    const ids = POLICY_WATCH.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of POLICY_WATCH) {
      expect(p.title.length, p.id).toBeGreaterThan(0);
      expect(p.summary.length, p.id).toBeGreaterThan(40);
      expect(p.effectiveDate.length, p.id).toBeGreaterThan(0);
      expect(p.lastVerified, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\//);
      expect(VALID_STATUSES, p.id).toContain(p.status);
      expect(POLICY_STATUS_LABEL[p.status].length, p.id).toBeGreaterThan(0);
    }
  });

  it("contains no ranking data", () => {
    const blob = JSON.stringify(POLICY_WATCH).toLowerCase();
    for (const term of RANKING_TERMS) {
      expect(blob.includes(term), `ranking term "${term}" found in policy watch`).toBe(false);
    }
  });

  it("the five verified 2026-08-03 policies are present with their exact facts", () => {
    const byId = new Map(POLICY_WATCH.map((p) => [p.id, p]));

    const f1 = byId.get("us-f1-fixed-admission-period")!;
    expect(f1.status).toBe("finalised_not_yet_effective");
    expect(f1.effectiveDate).toBe("2026-09-15");
    expect(f1.summary).toContain("17 July 2026");
    expect(f1.summary).toContain("four years");

    const grad = byId.get("gb-graduate-route-18-months")!;
    expect(grad.status).toBe("announced");
    expect(grad.effectiveDate).toBe("2027-01-01");
    expect(grad.summary).toContain("18 months");
    expect(grad.summary).toContain("PhD graduates keep three years");

    const ca = byId.get("ca-study-permit-cap-refusals")!;
    expect(ca.status).toBe("in_force");
    expect(ca.summary).toContain("408,000");
    expect(ca.summary).toContain("40%");
    expect(ca.summary).toContain("65%");

    const au = byId.get("au-student-visa-fee-rise")!;
    expect(au.status).toBe("in_force");
    expect(au.effectiveDate).toBe("2026-07-01");
    expect(au.summary).toContain("2,500");
    expect(au.summary).toContain("5,750");

    const test = byId.get("us-test-optional-reversal")!;
    expect(test.status).toBe("in_force");
    expect(test.summary).toContain("Princeton");
    expect(test.summary).toContain("1,000 colleges");

    for (const p of [f1, grad, ca, au, test]) expect(p.lastVerified).toBe("2026-08-03");
  });

  it("filters by country", () => {
    expect(policiesFor("US").length).toBe(2);
    expect(policiesFor("GB").length).toBe(1);
    expect(policiesFor("IN").length).toBe(0);
  });
});
