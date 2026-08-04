import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES, type Country } from "@/data/appRegistry";
import {
  ATS_HONESTY_LINE,
  ATS_RULES,
  CV_RULES,
  IN_PSU_CATEGORIES,
  countryPromptContract,
  cvRulesFor,
  excludedFields,
  fieldAllowed,
  promptedFields,
} from "@/data/cvRules";
import {
  applyCountryRules,
  emptyDeclared,
  screenInstruction,
  validateGenerated,
  yearsOfExperience,
  type CvDeclared,
} from "@/lib/cvValidation";

/** One realistic user, generated across all seven countries. */
function person(): CvDeclared {
  return {
    ...emptyDeclared(),
    fullName: "Aarti Menon",
    headline: "Operations analyst",
    email: "aarti@example.com",
    phone: "+91 90000 00000",
    location: "Kochi",
    summary: "Operations analyst working on supply reliability.",
    roles: [
      {
        employer: "Marico",
        title: "Operations Analyst",
        start: "2021-06",
        end: "2024-06",
        bullets: ["Cut stock-out incidents"],
      },
    ],
    credentials: [{ name: "B.Com", issuer: "CUSAT", year: "2021" }],
    skills: ["SQL", "Excel"],
    personal: {
      photo: "photo.jpg",
      dobAge: "1999-02-11",
      maritalReligion: "Single",
      nationality: "Indian",
      workStatus: "Needs sponsorship",
      nationalId: "XXXX",
      salary: "AED 18,000–22,000",
      noticePeriod: "30 days",
    },
  };
}

describe("country CV rules — corrected matrix", () => {
  it("covers every supported country", () => {
    for (const c of ALL_COUNTRIES) expect(CV_RULES[c].country).toBe(c);
  });

  it("photo: expected in AE, never in the West, discouraged in SG", () => {
    expect(cvRulesFor("AE").photo.stance).toBe("expected");
    expect(cvRulesFor("IN").photo.stance).toBe("common");
    expect(cvRulesFor("SG").photo.stance).toBe("discouraged");
    for (const c of ["US", "GB", "CA", "AU"] as Country[]) {
      expect(cvRulesFor(c).photo.stance).toBe("never");
    }
  });

  it("salary: UAE sits with India, not with the West", () => {
    expect(cvRulesFor("AE").salary.stance).toBe("expected");
    expect(cvRulesFor("AE").salary.note).toMatch(/AED/);
    expect(cvRulesFor("IN").salary.stance).toBe("common");
    for (const c of ["US", "GB", "CA", "AU", "SG"] as Country[]) {
      expect(cvRulesFor(c).salary.stance).toBe("never");
    }
  });

  it("length: US 1–2, AU 1–2, GB 2, IN 1–3", () => {
    expect([cvRulesFor("US").length.min, cvRulesFor("US").length.max]).toEqual([1, 2]);
    expect([cvRulesFor("AU").length.min, cvRulesFor("AU").length.max]).toEqual([1, 2]);
    expect(cvRulesFor("AU").length.note).toMatch(/SEEK/);
    expect([cvRulesFor("GB").length.min, cvRulesFor("GB").length.max]).toEqual([2, 2]);
    expect([cvRulesFor("IN").length.min, cvRulesFor("IN").length.max]).toEqual([1, 3]);
  });

  it("references: omitted in US/GB/CA, on request in IN/AE/SG, user choice in AU", () => {
    for (const c of ["US", "GB", "CA"] as Country[]) expect(cvRulesFor(c).references).toBe("omit");
    for (const c of ["IN", "AE", "SG"] as Country[]) expect(cvRulesFor(c).references).toBe("on_request");
    expect(cvRulesFor("AU").references).toBe("user_choice");
  });

  it("nationality and work status are expected in AE and SG only", () => {
    for (const c of ALL_COUNTRIES) {
      const expected = c === "AE" || c === "SG";
      expect(cvRulesFor(c).nationality.stance === "expected").toBe(expected);
      expect(cvRulesFor(c).workStatus.stance === "expected").toBe(expected);
    }
  });

  it("never puts a national ID on the document", () => {
    for (const c of ALL_COUNTRIES) {
      expect(fieldAllowed(c, "nationalId") && c !== "AE").toBe(false);
    }
    expect(cvRulesFor("SG").nationalId.stance).toBe("never");
    expect(cvRulesFor("SG").nationalId.note).toMatch(/point of job offer/);
    expect(cvRulesFor("IN").nationalId.note).toMatch(/Aadhaar/);
  });

  it("India PSU categories include EWS and OBC-NCL", () => {
    expect(IN_PSU_CATEGORIES).toEqual(["UR/General", "OBC-NCL", "SC", "ST", "EWS"]);
  });
});

describe("same user, seven countries — fields appear and vanish", () => {
  it("US output carries no photo and no date of birth (hard fail if it does)", () => {
    const doc = applyCountryRules({ personal: person().personal }, "US");
    expect(doc.personal?.photo).toBeUndefined();
    expect(doc.personal?.dobAge).toBeUndefined();
    expect(doc.personal?.salary).toBeUndefined();
    expect(doc.personal?.maritalReligion).toBeUndefined();
  });

  it("UAE output keeps photo, salary, nationality, visa status and notice period", () => {
    const doc = applyCountryRules({ personal: person().personal }, "AE");
    expect(doc.personal?.photo).toBeTruthy();
    expect(doc.personal?.salary).toBeTruthy();
    expect(doc.personal?.nationality).toBeTruthy();
    expect(doc.personal?.workStatus).toBeTruthy();
    expect(doc.personal?.noticePeriod).toBeTruthy();
  });

  it("a UAE CV missing salary or visa status is prompted for both", () => {
    expect(promptedFields("AE")).toEqual(
      expect.arrayContaining(["photo", "nationality", "workStatus", "salary", "noticePeriod"]),
    );
  });

  it("SG output keeps pass status but never NRIC", () => {
    const doc = applyCountryRules({ personal: person().personal }, "SG");
    expect(doc.personal?.nationality).toBeTruthy();
    expect(doc.personal?.nationalId).toBeUndefined();
    expect(doc.personal?.photo).toBeUndefined();
  });

  it("the prompt contract names the forbidden fields per country", () => {
    expect(countryPromptContract("US")).toMatch(/NEVER include these on the document: photo, dobAge/);
    expect(countryPromptContract("AE")).toMatch(/expected locally.*salary/s);
    for (const c of ALL_COUNTRIES) {
      expect(countryPromptContract(c)).toContain("Single column.");
    }
  });

  it("excluded fields are the complement of allowed fields", () => {
    for (const c of ALL_COUNTRIES) {
      for (const f of excludedFields(c)) expect(fieldAllowed(c, f)).toBe(false);
    }
  });
});

describe("anti-fabrication", () => {
  const declared = person();

  it("refuses an unheld degree", () => {
    const r = screenInstruction("add an MBA from IIM Bangalore", declared);
    expect(r.allowed).toBe(false);
  });

  it("refuses an employer never listed", () => {
    const r = screenInstruction("say I worked at Google as a manager", declared);
    expect(r.allowed).toBe(false);
  });

  it("refuses an inflated years-of-experience figure", () => {
    const r = screenInstruction("put 12 years of experience in the summary", declared);
    expect(r.allowed).toBe(false);
  });

  it("allows ordinary rewriting", () => {
    expect(screenInstruction("make the summary punchier", declared).allowed).toBe(true);
    expect(screenInstruction("reorder my skills", declared).allowed).toBe(true);
  });

  it("computes years of experience from declared dates, or nothing", () => {
    expect(yearsOfExperience(declared.roles)).toBe(3);
    expect(yearsOfExperience([])).toBeNull();
  });

  it("flags invented entities in generated output", () => {
    const report = validateGenerated(
      {
        summary: "Operations analyst with 12 years of experience.",
        roles: [
          { employer: "Google", title: "Director", start: "2015-01", end: "2020-01", bullets: [] },
        ],
        credentials: [{ name: "MBA", issuer: "IIMB", year: "2019" }],
        skills: ["SQL"],
      },
      declared,
      "IN",
    );
    expect(report.ok).toBe(false);
    expect(report.flags.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["employer", "title", "date", "credential", "years"]),
    );
  });

  it("passes clean output through untouched", () => {
    const report = validateGenerated(
      {
        summary: "Operations analyst focused on supply reliability.",
        roles: [
          {
            employer: "Marico",
            title: "Operations Analyst",
            start: "2021-06",
            end: "2024-06",
            bullets: ["Cut stock-out incidents"],
          },
        ],
        credentials: [{ name: "B.Com", issuer: "CUSAT", year: "2021" }],
        skills: ["SQL", "Excel"],
      },
      declared,
      "IN",
    );
    expect(report).toEqual({ ok: true, flags: [] });
  });

  it("flags a forbidden field that slipped into generated output", () => {
    const report = validateGenerated(
      { summary: "", roles: [], credentials: [], skills: [], personal: { photo: "x" } },
      declared,
      "US",
    );
    expect(report.flags[0]?.kind).toBe("forbidden_field");
  });
});

describe("honest claims", () => {
  it("never promises ATS outcomes", () => {
    const corpus = [
      ...ATS_RULES,
      ATS_HONESTY_LINE,
      ...Object.values(CV_RULES).flatMap((r) => [
        r.length.note,
        r.referencesNote,
        ...r.context,
        ...Object.values(r)
          .filter((v): v is { stance: string; note: string } => typeof v === "object" && v !== null && "note" in v)
          .map((v) => v.note),
      ]),
    ].join(" ");
    for (const banned of ["ATS-optimised", "ATS-optimized", "guaranteed", "beat the ATS", "88%", "75%"]) {
      expect(corpus.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("does not claim employers commonly discard CVs with photos", () => {
    const corpus = Object.values(CV_RULES)
      .map((r) => r.photo.note + r.dobAge.note)
      .join(" ");
    expect(corpus.toLowerCase()).not.toContain("discard");
  });
});
