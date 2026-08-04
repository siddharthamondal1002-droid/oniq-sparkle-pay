/**
 * The anti-fabrication check must flag invented facts and ONLY invented facts.
 *
 * Regression origin: a real CV on 2026-08-04 was blocked with
 * `"Class 12" is not in your qualifications.` The user had typed "Class12"
 * (no space); the model tidied it to "Class 12", exactly as the prompt asks it
 * to. The comparator was trim+lowercase, so "class12" !== "class 12" and a
 * correct CV was reported as fabricated. The fix folds away case, spacing and
 * punctuation for COMPARISON only — never for display.
 */
import { describe, expect, it } from "vitest";
import { emptyDeclared, validateGenerated, type CvDeclared } from "@/lib/cvValidation";

function declaredWith(over: Partial<CvDeclared>): CvDeclared {
  return { ...emptyDeclared(), ...over };
}

const role = (title: string, employer: string) => ({
  title,
  employer,
  start: "2012-12",
  end: "",
  bullets: [] as string[],
});

describe("validateGenerated — cosmetic tidying is not fabrication", () => {
  it("accepts a qualification the model spaced out (Class12 -> Class 12)", () => {
    const report = validateGenerated(
      { summary: "", roles: [], skills: [], credentials: [{ name: "Class 12", issuer: "WBBHSE", year: "2005" }] },
      declaredWith({ credentials: [{ name: "Class12", issuer: "Wbbhse", year: "2005" }] }),
      "IN",
    );
    expect(report.flags).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("accepts punctuation and casing differences (b.sc physics -> BSc Physics)", () => {
    const report = validateGenerated(
      { summary: "", roles: [], skills: [], credentials: [{ name: "BSc Physics", issuer: "", year: "" }] },
      declaredWith({ credentials: [{ name: "b.sc physics", issuer: "", year: "" }] }),
      "IN",
    );
    expect(report.flags).toEqual([]);
  });

  it("accepts collapsed double spaces in an employer name", () => {
    const report = validateGenerated(
      { summary: "", roles: [role("Officer", "State Bank of India")], skills: [], credentials: [] },
      declaredWith({ roles: [role("Officer", "State  Bank  of  India")] }),
      "IN",
    );
    expect(report.flags).toEqual([]);
  });
});

describe("validateGenerated — real fabrication is still caught", () => {
  it("flags a qualification that differs by more than separators", () => {
    const report = validateGenerated(
      { summary: "", roles: [], skills: [], credentials: [{ name: "Class 10", issuer: "", year: "" }] },
      declaredWith({ credentials: [{ name: "Class 12", issuer: "", year: "" }] }),
      "IN",
    );
    expect(report.flags.map((f) => f.kind)).toContain("credential");
    expect(report.ok).toBe(false);
  });

  it("flags an employer the user never entered", () => {
    const report = validateGenerated(
      { summary: "", roles: [role("Officer", "Infosys")], skills: [], credentials: [] },
      declaredWith({ roles: [role("Officer", "State Bank of India")] }),
      "IN",
    );
    expect(report.flags.map((f) => f.kind)).toContain("employer");
  });

  it("flags a job title the user never entered", () => {
    const report = validateGenerated(
      { summary: "", roles: [role("Chief Executive Officer", "State Bank of India")], skills: [], credentials: [] },
      declaredWith({ roles: [role("Officer", "State Bank of India")] }),
      "IN",
    );
    expect(report.flags.map((f) => f.kind)).toContain("title");
  });

  it("flags an invented qualification when the user declared none", () => {
    const report = validateGenerated(
      { summary: "", roles: [], skills: [], credentials: [{ name: "MBA", issuer: "", year: "" }] },
      declaredWith({ credentials: [] }),
      "IN",
    );
    expect(report.flags.map((f) => f.kind)).toContain("credential");
  });
});
