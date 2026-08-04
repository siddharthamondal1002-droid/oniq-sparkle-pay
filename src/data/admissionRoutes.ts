// ONIQ Education & Careers loop — Phase 3, part 1: admission route types.
//
// A "route" is the SHAPE of an admissions system, not a ranking of it.
// Every explainer below is ONIQ's own descriptive writing about how a system
// works structurally — nothing is copied from an admissions body, a
// prospectus, or a government page. (Rule 2: ingest nothing, generate
// everything, link out.)
//
// Nothing here states an eligibility determination. Copy is written so it can
// only ever be read as orientation, with the authoritative link alongside.

import type { Country } from "@/data/appRegistry";

export type AdmissionRoute =
  | "exam_first" // IN — JEE/NEET/CUET score gates entry
  | "holistic" // US — essays, activities, recommendations alongside scores
  | "centralised_ucas" // GB — one UCAS application, up to 5 choices, personal statement
  | "provincial_grade" // CA — provincial grade averages, per-province
  | "atar" // AU — single ATAR rank drives offers
  | "multi_track" // SG — separate polytechnic / JC / ITE / university tracks
  | "direct_branch_campus"; // AE — apply direct to each institution, many are branch campuses

export type RouteExplainer = {
  route: AdmissionRoute;
  label: string;
  /** ONIQ's own description of how the system works. */
  howItWorks: string;
  /** Document types that typically matter on this route. */
  documents: string[];
  /** Where the authoritative rules actually live. */
  officialUrl: string;
  officialLabel: string;
};

export const ROUTE_EXPLAINERS: Record<AdmissionRoute, RouteExplainer> = {
  exam_first: {
    route: "exam_first",
    label: "Entrance-exam first",
    howItWorks:
      "Entry is decided mainly by a national or state entrance exam score, with school board marks acting as an eligibility floor rather than the deciding factor. Candidates sit the exam, receive a score and rank, and then enter a centralised counselling or seat-allocation round where choices are filled in rank order. Different faculties use different exams, so the exam you sit effectively chooses your field before you choose your institution.",
    documents: [
      "Entrance exam scorecard and rank letter",
      "Class 12 board marksheet and passing certificate",
      "Category / domicile certificate where a reservation is claimed",
      "Photo ID matching the exam registration exactly",
    ],
    officialUrl: "https://www.nta.ac.in",
    officialLabel: "National Testing Agency",
  },
  holistic: {
    route: "holistic",
    label: "Holistic review",
    howItWorks:
      "Each institution reviews the whole application: transcript and course rigour, essays, recommendation letters, activities, and — at a growing number of selective institutions — standardised test scores. There is no central allocation: you apply to each institution (often through a shared application platform), and each makes its own decision. Deadlines are tiered, with early rounds typically in autumn and a regular round in winter.",
    documents: [
      "High-school transcript",
      "Personal essay plus institution-specific supplements",
      "One to three recommendation letters",
      "SAT/ACT scores where the institution requires or accepts them",
      "Financial aid forms where applicable",
    ],
    officialUrl: "https://studentaid.gov",
    officialLabel: "US Federal Student Aid",
  },
  centralised_ucas: {
    route: "centralised_ucas",
    label: "Centralised (UCAS)",
    howItWorks:
      "One application carries up to five course choices across institutions, with a single personal statement and one academic reference. Offers are usually conditional on specific results, and applicants then hold one firm and one insurance choice. Medicine, dentistry, veterinary science and the Oxford/Cambridge courses run on an earlier deadline than everything else.",
    documents: [
      "Predicted and achieved qualification grades",
      "Personal statement",
      "Academic reference",
      "Admissions-test results where the course requires one",
    ],
    officialUrl: "https://www.ucas.com",
    officialLabel: "UCAS",
  },
  provincial_grade: {
    route: "provincial_grade",
    label: "Provincial grade average",
    howItWorks:
      "Admission is driven by an average of specified senior secondary courses, calculated per province and per programme, with prerequisite courses that must be present regardless of the average. Ontario applicants apply through a provincial centre; other provinces apply directly to institutions. Supplementary essays or portfolios appear only for specific programmes.",
    documents: [
      "Senior secondary transcript with prerequisite courses",
      "Provincial application reference number where applicable",
      "English or French language evidence for applicants schooled elsewhere",
    ],
    officialUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada.html",
    officialLabel: "IRCC — Study in Canada",
  },
  atar: {
    route: "atar",
    label: "ATAR rank",
    howItWorks:
      "Senior secondary results are converted into a single rank between 0 and 99.95 that expresses position relative to the cohort, not a percentage mark. Applications go through a state or territory admissions centre, which makes offers in rounds against each course's published cut-off. Some courses add prerequisites, auditions, portfolios or an aptitude test on top of the rank.",
    documents: [
      "Senior secondary certificate and ATAR notification",
      "State admissions-centre application reference",
      "Portfolio, audition or aptitude-test evidence where the course requires it",
    ],
    officialUrl: "https://www.studyaustralia.gov.au",
    officialLabel: "Study Australia",
  },
  multi_track: {
    route: "multi_track",
    label: "Multi-track",
    howItWorks:
      "Post-secondary study is split into distinct tracks — junior college, polytechnic, institutes of technical education, and the autonomous universities — each with its own intake exercise, timeline and entry criteria. The track entered after secondary school shapes but does not close off later university entry, since polytechnic diplomas carry their own university admission pathway.",
    documents: [
      "National examination results slip",
      "Track-specific intake exercise registration",
      "Aptitude-based admission portfolio where a track offers one",
    ],
    officialUrl: "https://www.moe.gov.sg",
    officialLabel: "Singapore MOE",
  },
  direct_branch_campus: {
    route: "direct_branch_campus",
    label: "Direct application",
    howItWorks:
      "There is no central clearing house: each institution runs its own application, deadlines and entry criteria, and many institutions are branch campuses of a parent university abroad, awarding the parent's degree. Applicants typically also need their school qualification attested, and free-zone versus federally licensed institutions can differ in how a qualification is recognised.",
    documents: [
      "School leaving qualification with attestation",
      "Equivalency certificate where the qualification was earned abroad",
      "Passport and residency documents",
      "English language evidence where the programme requires it",
    ],
    officialUrl: "https://www.moe.gov.ae",
    officialLabel: "UAE Ministry of Education",
  },
};

/** The dominant route for each country ONIQ supports. */
export const COUNTRY_ROUTE: Record<Country, AdmissionRoute> = {
  IN: "exam_first",
  US: "holistic",
  GB: "centralised_ucas",
  CA: "provincial_grade",
  AU: "atar",
  SG: "multi_track",
  AE: "direct_branch_campus",
};

export function routeExplainer(route: AdmissionRoute): RouteExplainer {
  return ROUTE_EXPLAINERS[route];
}
