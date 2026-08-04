import { describe, expect, it } from "vitest";
import { DOB_REASON, DOB_PROMPT_TITLE } from "@/lib/dobNotice";

/**
 * The DOB purpose notice is a DPDP plain-language requirement, so its wording
 * is pinned by tests: it must name the real purpose and must never drift into
 * "personalise" / "serve you better" framing.
 */
describe("date-of-birth purpose notice", () => {
  it("exists in English and Hindi", () => {
    expect(DOB_REASON.en.length).toBeGreaterThan(40);
    expect(DOB_REASON.hi.length).toBeGreaterThan(40);
    expect(DOB_PROMPT_TITLE.en).toBeTruthy();
    expect(DOB_PROMPT_TITLE.hi).toBeTruthy();
  });

  it("names the actual purpose: age-restricted features and parental consent", () => {
    expect(DOB_REASON.en).toMatch(/age-restricted/i);
    expect(DOB_REASON.en).toMatch(/Jobs/);
    expect(DOB_REASON.en).toMatch(/parent'?s consent/i);
    expect(DOB_REASON.en).toMatch(/under 18/i);
    expect(DOB_REASON.hi).toMatch(/जन्म तिथि/);
    expect(DOB_REASON.hi).toMatch(/सहमति/);
    expect(DOB_REASON.hi).toMatch(/18/);
  });

  it("never uses obscuring framing", () => {
    for (const text of [DOB_REASON.en, DOB_REASON.hi]) {
      expect(text.toLowerCase()).not.toContain("personalise");
      expect(text.toLowerCase()).not.toContain("personalize");
      expect(text.toLowerCase()).not.toContain("serve you better");
      expect(text.toLowerCase()).not.toContain("better experience");
    }
  });

  it("is written in Devanagari for hi", () => {
    expect(/[\u0900-\u097F]/.test(DOB_REASON.hi)).toBe(true);
  });
});
