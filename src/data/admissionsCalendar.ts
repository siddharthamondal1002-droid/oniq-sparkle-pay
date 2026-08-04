// ONIQ Education & Careers loop — Phase 3, part 3: admissions calendar.
//
// Application windows and entrance-exam dates per country.
//
// HONESTY RULE: where a date genuinely moves year to year and the current
// year's date is not verified, the entry says "typically mid-January" in
// `window` and leaves `exactDate` undefined. An approximate honest answer
// beats a precise fabricated one. Every row carries `lastVerified` and a
// `sourceUrl`; the UI must show both.

import type { Country } from "@/data/appRegistry";

export type CalendarKind = "application" | "exam" | "offer_round" | "intake";

export type AdmissionEvent = {
  id: string;
  country: Country;
  kind: CalendarKind;
  title: string;
  /** Human, honest description of when this happens. */
  window: string;
  /** ISO date — ONLY where a specific date is verified. Usually undefined. */
  exactDate?: string;
  notes?: string;
  sourceUrl: string;
  lastVerified: string;
};

const V = "2026-08-03";

export const ADMISSIONS_CALENDAR: AdmissionEvent[] = [
  // ── India ────────────────────────────────────────────────────────────
  { id: "in-jee-main-s1", country: "IN", kind: "exam", title: "JEE Main — Session 1", window: "Typically late January; registration usually opens the preceding October–November", notes: "Two sessions per year; the better of the two scores is normally used.", sourceUrl: "https://jeemain.nta.nic.in", lastVerified: V },
  { id: "in-jee-main-s2", country: "IN", kind: "exam", title: "JEE Main — Session 2", window: "Typically early April", sourceUrl: "https://jeemain.nta.nic.in", lastVerified: V },
  { id: "in-jee-advanced", country: "IN", kind: "exam", title: "JEE Advanced", window: "Typically late May; open only to qualifying JEE Main candidates", notes: "Gateway to the IITs.", sourceUrl: "https://jeeadv.ac.in", lastVerified: V },
  { id: "in-neet-ug", country: "IN", kind: "exam", title: "NEET-UG", window: "Typically the first week of May", notes: "Single national medical/dental entrance exam.", sourceUrl: "https://neet.nta.nic.in", lastVerified: V },
  { id: "in-cuet-ug", country: "IN", kind: "exam", title: "CUET-UG", window: "Typically May–June, over a multi-day window", notes: "Undergraduate entry to many central universities.", sourceUrl: "https://cuet.nta.nic.in", lastVerified: V },
  { id: "in-clat", country: "IN", kind: "exam", title: "CLAT", window: "Typically the first or second Sunday of December, for the following academic year", sourceUrl: "https://consortiumofnlus.ac.in", lastVerified: V },
  { id: "in-cat", country: "IN", kind: "exam", title: "CAT", window: "Typically the last Sunday of November", notes: "Postgraduate management entry (IIMs and others).", sourceUrl: "https://iimcat.ac.in", lastVerified: V },
  { id: "in-josaa", country: "IN", kind: "offer_round", title: "JoSAA counselling rounds", window: "Typically June–July, in multiple seat-allocation rounds after JEE results", sourceUrl: "https://josaa.nic.in", lastVerified: V },

  // ── United States ────────────────────────────────────────────────────
  { id: "us-early-decision", country: "US", kind: "application", title: "Early Decision (binding)", window: "Typically 1 November, with some institutions using 15 November", notes: "Binding: an admitted applicant is expected to enrol and withdraw other applications.", sourceUrl: "https://www.commonapp.org", lastVerified: V },
  { id: "us-early-action", country: "US", kind: "application", title: "Early Action (non-binding)", window: "Typically 1 or 15 November", notes: "Restrictive/Single-Choice Early Action limits other early applications — check each institution.", sourceUrl: "https://www.commonapp.org", lastVerified: V },
  { id: "us-ed2", country: "US", kind: "application", title: "Early Decision II", window: "Typically early January, where an institution offers it", sourceUrl: "https://www.commonapp.org", lastVerified: V },
  { id: "us-regular-decision", country: "US", kind: "application", title: "Regular Decision", window: "Typically 1–15 January, varying by institution", sourceUrl: "https://www.commonapp.org", lastVerified: V },
  { id: "us-fafsa", country: "US", kind: "application", title: "FAFSA (federal financial aid)", window: "Opens in the autumn for the following academic year; institutional priority deadlines are usually earlier than the federal one", sourceUrl: "https://studentaid.gov/h/apply-for-aid/fafsa", lastVerified: V },
  { id: "us-decision-day", country: "US", kind: "offer_round", title: "National enrolment deadline", window: "1 May — the customary date by which admitted students confirm their place", sourceUrl: "https://www.nacacnet.org", lastVerified: V },

  // ── United Kingdom ───────────────────────────────────────────────────
  { id: "gb-ucas-early", country: "GB", kind: "application", title: "UCAS early deadline (Oxford, Cambridge, medicine, dentistry, veterinary)", window: "Mid-October, the year before entry", notes: "One deadline covering Oxbridge and the health-course group.", sourceUrl: "https://www.ucas.com/undergraduate/applying-university/ucas-undergraduate-when-apply", lastVerified: V },
  { id: "gb-ucas-equal", country: "GB", kind: "application", title: "UCAS equal-consideration deadline", window: "Late January, the year of entry", notes: "Applications received by this date are guaranteed equal consideration.", sourceUrl: "https://www.ucas.com/undergraduate/applying-university/ucas-undergraduate-when-apply", lastVerified: V },
  { id: "gb-ucas-extra", country: "GB", kind: "offer_round", title: "UCAS Extra", window: "Typically late February to early July, for applicants holding no offers", sourceUrl: "https://www.ucas.com", lastVerified: V },
  { id: "gb-results-day", country: "GB", kind: "offer_round", title: "A-level results day and Clearing", window: "Mid-August; Clearing runs from early July until October", sourceUrl: "https://www.ucas.com/undergraduate/results-confirmation-and-clearing", lastVerified: V },

  // ── Canada ───────────────────────────────────────────────────────────
  { id: "ca-ouac-101", country: "CA", kind: "application", title: "OUAC 101 (Ontario secondary school applicants)", window: "Typically mid-January, via the applicant's Ontario high school", sourceUrl: "https://www.ouac.on.ca", lastVerified: V },
  { id: "ca-ouac-105", country: "CA", kind: "application", title: "OUAC 105 (all other Ontario applicants)", window: "Programme-dependent; many programmes use a January or February date, some later", sourceUrl: "https://www.ouac.on.ca", lastVerified: V },
  { id: "ca-bc-direct", country: "CA", kind: "application", title: "British Columbia direct applications", window: "Typically opens in the autumn with deadlines from December to January for September entry", notes: "BC institutions are applied to directly, not via a provincial centre for all programmes.", sourceUrl: "https://www.educationplannerbc.ca", lastVerified: V },
  { id: "ca-quebec-cegep", country: "CA", kind: "application", title: "Québec — CEGEP and university entry", window: "CEGEP rounds typically open from late winter; university deadlines commonly fall between January and March", sourceUrl: "https://www.quebec.ca/en/education", lastVerified: V },
  { id: "ca-offer-rounds", country: "CA", kind: "offer_round", title: "Offers of admission", window: "Typically rolling from February to May, with confirmation deadlines around June", sourceUrl: "https://www.ouac.on.ca", lastVerified: V },

  // ── Australia ────────────────────────────────────────────────────────
  { id: "au-uac-timely", country: "AU", kind: "application", title: "UAC on-time application (NSW/ACT)", window: "Typically late September for the discounted on-time deadline; late applications accepted at a higher fee", sourceUrl: "https://www.uac.edu.au", lastVerified: V },
  { id: "au-vtac-timely", country: "AU", kind: "application", title: "VTAC timely application (Victoria)", window: "Typically late September to early October", sourceUrl: "https://www.vtac.edu.au", lastVerified: V },
  { id: "au-qtac", country: "AU", kind: "application", title: "QTAC application (Queensland)", window: "Opens around August, with major offer rounds from December to February", sourceUrl: "https://www.qtac.edu.au", lastVerified: V },
  { id: "au-atar-release", country: "AU", kind: "offer_round", title: "ATAR release and main offer round", window: "ATAR released in December; main offer rounds run from late December to January", sourceUrl: "https://www.uac.edu.au", lastVerified: V },
  { id: "au-mid-year", country: "AU", kind: "intake", title: "Mid-year (Semester 2) intake", window: "Typically applications from around April for a July start, where a course offers it", sourceUrl: "https://www.studyaustralia.gov.au", lastVerified: V },

  // ── Singapore ────────────────────────────────────────────────────────
  { id: "sg-jae", country: "SG", kind: "application", title: "Joint Admissions Exercise (JAE)", window: "Typically January, after O-Level results — for JC, Millennia Institute, polytechnic and ITE places", sourceUrl: "https://www.moe.gov.sg/post-secondary/admissions/jae", lastVerified: V },
  { id: "sg-jpae", country: "SG", kind: "application", title: "Joint Polytechnic Admissions Exercise (JPAE)", window: "Typically opens in the second half of the year for aptitude-based polytechnic admission", sourceUrl: "https://www.moe.gov.sg", lastVerified: V },
  { id: "sg-uni-apply", country: "SG", kind: "application", title: "Autonomous university applications", window: "Typically opens around October–November for the following August intake, with A-Level applicants applying after results in February–March", sourceUrl: "https://www.moe.gov.sg/post-secondary", lastVerified: V },
  { id: "sg-alevel-results", country: "SG", kind: "offer_round", title: "A-Level results and university offers", window: "Results typically in February; university offers follow in the months after", sourceUrl: "https://www.seab.gov.sg", lastVerified: V },
  { id: "sg-aug-intake", country: "SG", kind: "intake", title: "Main university intake", window: "August", sourceUrl: "https://www.moe.gov.sg", lastVerified: V },

  // ── United Arab Emirates ─────────────────────────────────────────────
  { id: "ae-fall-intake", country: "AE", kind: "intake", title: "Autumn (Fall) intake", window: "Main intake, typically starting September; applications commonly open the preceding autumn and close in spring or summer", notes: "Each institution sets its own deadline — there is no central clearing house.", sourceUrl: "https://www.moe.gov.ae", lastVerified: V },
  { id: "ae-spring-intake", country: "AE", kind: "intake", title: "Spring intake", window: "Typically January, offered by many but not all institutions", sourceUrl: "https://www.moe.gov.ae", lastVerified: V },
  { id: "ae-emsat", country: "AE", kind: "exam", title: "EmSAT Achieve", window: "Offered in multiple sittings across the school year; institutions set their own required scores", sourceUrl: "https://www.moe.gov.ae", lastVerified: V },
  { id: "ae-equivalency", country: "AE", kind: "application", title: "Certificate equivalency and attestation", window: "Best started months before the application deadline — processing time varies", notes: "Required where a school qualification was earned outside the UAE.", sourceUrl: "https://www.moe.gov.ae", lastVerified: V },
];

export function calendarFor(country: Country): AdmissionEvent[] {
  return ADMISSIONS_CALENDAR.filter((e) => e.country === country);
}
