// ONIQ Education & Careers loop — Phase 3, part 5: indicative eligibility.
//
// HIGHEST-HARM SURFACE IN THE PHASE. Wrong visa or admissions guidance costs
// people money and opportunities, so this module is deliberately bounded:
//
//  - It NEVER outputs a determination. No "you are eligible", "you qualify",
//    "you will be admitted". Every result is orientation only.
//  - It ALWAYS returns the authoritative official link for the jurisdiction.
//  - It NEVER states a rule without the `lastVerified` date of the row it
//    came from.
//  - When inputs are insufficient it says so, instead of guessing.

import type { Country } from "@/data/appRegistry";
import { COUNTRY_ROUTE, ROUTE_EXPLAINERS } from "@/data/admissionRoutes";
import { policiesFor, type PolicyItem } from "@/data/policyWatch";

export type EligibilityInput = {
  /** Where the learner wants to study. */
  destination: Country;
  /** Highest qualification completed or in progress. */
  qualification?: "secondary_in_progress" | "secondary_complete" | "undergraduate" | "postgraduate";
  /** Has the learner sat the entrance exam / test the route usually expects? */
  hasRouteAssessment?: boolean;
  /** Does the learner have evidence of English language ability, if required? */
  hasLanguageEvidence?: boolean;
  /** Applying from outside the destination country (visa likely needed). */
  needsStudentVisa?: boolean;
};

export type EligibilityResult = {
  /** Always indicative — never a determination. */
  headline: string;
  /** What the answer is based on; empty when inputs were insufficient. */
  considerations: string[];
  /** What ONIQ could not assess from the given inputs. */
  missingInputs: string[];
  /** Policy rows relevant to this destination, each carrying lastVerified. */
  policies: PolicyItem[];
  officialUrl: string;
  officialLabel: string;
  /** Rendered verbatim next to every result. */
  disclaimer: string;
};

export const ELIGIBILITY_DISCLAIMER =
  "Indicative orientation only — not an assessment, decision, or legal or immigration advice. Rules change; always confirm with the official source below before acting.";

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const route = COUNTRY_ROUTE[input.destination];
  const explainer = ROUTE_EXPLAINERS[route];

  const considerations: string[] = [];
  const missingInputs: string[] = [];

  if (!input.qualification) {
    missingInputs.push("Highest qualification completed or in progress");
  } else {
    switch (input.qualification) {
      case "secondary_in_progress":
        considerations.push(
          `Applications on the ${explainer.label.toLowerCase()} route are normally made while secondary study is still in progress, with offers conditional on final results.`,
        );
        break;
      case "secondary_complete":
        considerations.push(
          "Completed secondary study is the usual starting point for undergraduate entry on this route.",
        );
        break;
      case "undergraduate":
      case "postgraduate":
        considerations.push(
          "Postgraduate entry usually runs on a separate timeline and separate criteria from the undergraduate route described here.",
        );
        break;
    }
  }

  if (input.hasRouteAssessment === undefined) {
    missingInputs.push(
      route === "exam_first"
        ? "Whether the relevant entrance exam has been sat"
        : "Whether the assessment this route usually expects has been completed",
    );
  } else if (input.hasRouteAssessment) {
    considerations.push("The assessment this route usually expects appears to be in hand.");
  } else {
    considerations.push(
      "This route usually expects a specific assessment or result set that is not yet in hand — check the official source for the current requirement and timing.",
    );
  }

  if (input.hasLanguageEvidence === false) {
    considerations.push(
      "Many programmes ask for English language evidence from applicants schooled in another language; the accepted tests and scores are set per institution.",
    );
  }

  if (input.needsStudentVisa) {
    considerations.push(
      "A student visa is likely to be needed, and visa rules are changing — the policy notes below each show the date ONIQ last verified them.",
    );
  } else if (input.needsStudentVisa === undefined) {
    missingInputs.push("Whether a student visa will be needed");
  }

  const enough = considerations.length > 0 && missingInputs.length === 0;

  return {
    headline: enough
      ? "Here is what typically matters on this route — this is orientation, not an assessment of your application."
      : "There is not enough information here to say anything useful yet. Fill in the missing details below, and treat anything shown as orientation only.",
    considerations,
    missingInputs,
    policies: policiesFor(input.destination),
    officialUrl: explainer.officialUrl,
    officialLabel: explainer.officialLabel,
    disclaimer: ELIGIBILITY_DISCLAIMER,
  };
}
