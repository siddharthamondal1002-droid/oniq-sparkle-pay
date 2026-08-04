// ONIQ Education & Careers loop — Phase 3, part 4: policy watch.
//
// Study-abroad rules move faster than any static page can keep up with, so
// EVERY row carries a `lastVerified` date and the UI must render it. A visa
// rule without a verification date is exactly the failure mode this surface
// exists to prevent.
//
// The five rows below were independently verified as of 2026-08-03. They are
// stated as verified — neither softened nor embellished — and where the
// underlying evidence is genuinely a range (Canadian refusal rates), the
// range is presented as a range with its caveat rather than one number
// stated as fact.

import type { Country } from "@/data/appRegistry";

export type PolicyStatus =
  | "in_force"
  | "finalised_not_yet_effective"
  | "announced"
  | "proposed";

export type PolicyItem = {
  id: string;
  title: string;
  country: Country;
  status: PolicyStatus;
  summary: string;
  /** Human-readable effective date, or an honest description of one. */
  effectiveDate: string;
  lastVerified: string;
  sourceUrl: string;
};

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  in_force: "In force",
  finalised_not_yet_effective: "Finalised — not yet effective",
  announced: "Announced",
  proposed: "Proposed",
};

const V = "2026-08-03";

export const POLICY_WATCH: PolicyItem[] = [
  {
    id: "us-f1-fixed-admission-period",
    title: "F-1/J-1 fixed admission period replaces duration of status",
    country: "US",
    status: "finalised_not_yet_effective",
    summary:
      "DHS published a Final Rule on 17 July 2026 replacing 'duration of status' with a fixed admission period tied to the programme length shown on the I-20, capped at four years. There is a 30-day grace period on arrival and a 30-day departure grace period. It applies retroactively to students already in the US on duration of status. Staying beyond the fixed period requires filing an extension of stay with USCIS.",
    effectiveDate: "2026-09-15",
    lastVerified: V,
    sourceUrl: "https://www.federalregister.gov",
  },
  {
    id: "gb-graduate-route-18-months",
    title: "Graduate Route shortened to 18 months",
    country: "GB",
    status: "announced",
    summary:
      "Confirmed government policy via the Statement of Changes of 14 October 2025. From 1 January 2027, undergraduate and master's graduates receive 18 months on the Graduate Route instead of two years. PhD graduates keep three years. The change applies to those applying on or after 1 January 2027 — applying before that date keeps the current two years.",
    effectiveDate: "2027-01-01",
    lastVerified: V,
    sourceUrl: "https://www.gov.uk/government/collections/immigration-rules-statement-of-changes",
  },
  {
    id: "ca-study-permit-cap-refusals",
    title: "Study permit cap and rising refusal rates",
    country: "CA",
    status: "in_force",
    summary:
      "The 2026 cap allows up to 408,000 total study permits (roughly 155,000 new plus 253,000 extensions), about 7% below the 2025 target, with PAL/TAL allocations capping new permits at up to 180,000. Refusal rates have risen sharply and are reported between roughly 40% and 65% depending on the dataset and period, with Indian applicants reported around 74% in 2025 — treat that as a reported range, not a single settled figure.",
    effectiveDate: "2026 calendar year",
    lastVerified: V,
    sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship.html",
  },
  {
    id: "au-student-visa-fee-rise",
    title: "Student visa application fee increase",
    country: "AU",
    status: "in_force",
    summary:
      "From 1 July 2026 the subclass 500 student visa application charge rose from AUD 2,000 to AUD 2,500, and the subclass 485 temporary graduate visa charge rose from AUD 4,600 to AUD 5,750. ELICOS and non-award applicants pay AUD 2,050. The charge is non-refundable if the application is refused.",
    effectiveDate: "2026-07-01",
    lastVerified: V,
    sourceUrl: "https://immi.homeaffairs.gov.au",
  },
  {
    id: "us-test-optional-reversal",
    title: "Standardised-test requirements returning at highly selective institutions",
    country: "US",
    status: "in_force",
    summary:
      "Requiring SAT/ACT for 2026–27: Harvard, Yale, Dartmouth, Brown, Cornell, MIT, Caltech, Stanford and UPenn. Columbia reversed in June 2026 and requires scores from the 2027–28 cycle. Princeton is the last Ivy holdout — test-optional for one more cycle, then requiring from 2027–28. Important balance: more than 1,000 colleges on the Common App remain test-optional, so this is a pronounced trend at highly selective institutions, not a reversal across US higher education.",
    effectiveDate: "2026–27 admissions cycle (Columbia and Princeton from 2027–28)",
    lastVerified: V,
    sourceUrl: "https://www.commonapp.org",
  },
];

export function policiesFor(country: Country): PolicyItem[] {
  return POLICY_WATCH.filter((p) => p.country === country);
}
