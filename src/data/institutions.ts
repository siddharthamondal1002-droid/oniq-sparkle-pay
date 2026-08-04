// ONIQ Education & Careers loop — Phase 3, part 2: institution registry.
//
// SCOPE: a CURATED SEED, not an exhaustive catalogue. Roughly 15–25
// institutions per country. Any surface rendering this data MUST say plainly
// that it is a starting selection — see INSTITUTIONS_DISCLAIMER below.
//
// HARD RULES
// 1. NO RANKINGS, ever. QS / THE / US News / ARWU positions are proprietary
//    and trademarked. `signals` carries only factual, reusable membership or
//    classification facts (Russell Group, Group of Eight, U15, Carnegie
//    class, NAAC grade, branch-campus status, public/private).
// 2. NO GUESSED IDENTIFIERS. `rorId` is omitted wherever it was not verified
//    in-session against ROR — a wrong ROR ID silently corrupts a canonical
//    identifier, which is worse than an absent one. The same applies to NAAC
//    grades and Carnegie classes: present only where confident, omitted
//    otherwise. A sparse-but-correct row beats a complete-looking wrong one.
// 3. NO SCRAPING of the UAE CAA institution list ("All rights reserved", no
//    API, no open licence) — the UAE rows are hand-curated.
//
// LICENSING of the `source` union (verified for commercial use):
//   ROR — CC0. IPEDS — US public domain. College Scorecard — attribute it
//   rather than claiming public domain (its catalog record is inconsistently
//   tagged CC BY). HESA Discover Uni — CC BY 4.0, attribution exactly
//   "HESA, www.hesa.ac.uk". AISHE — GODL. data.gov.sg — ODL v1.0.
//   data.gov.au — licensing is PER-DATASET, not a blanket CC BY, so any row
//   sourced there must name the dataset in `notes`.

import type { Country } from "@/data/appRegistry";
import { COUNTRY_ROUTE, type AdmissionRoute } from "@/data/admissionRoutes";

export type InstitutionSource =
  | "ROR"
  | "IPEDS"
  | "College Scorecard"
  | "HESA Discover Uni"
  | "AISHE"
  | "StatCan"
  | "data.gov.au"
  | "data.gov.sg"
  | "hand-curated";

export type Institution = {
  id: string;
  /** ROR ID — present ONLY where verified. Never guessed. */
  rorId?: string;
  name: string;
  country: Country;
  city?: string;
  route: AdmissionRoute;
  /** Factual, reusable signals ONLY. Never a ranking position. */
  signals: {
    naacGrade?: string;
    carnegieClass?: string;
    russellGroup?: boolean;
    groupOfEight?: boolean;
    u15?: boolean;
    isBranchCampus?: boolean;
    publicOrPrivate?: "public" | "private";
  };
  websiteUrl: string;
  source: InstitutionSource;
  notes?: string;
};

export const INSTITUTIONS_DISCLAIMER =
  "A curated starting selection of institutions — not every institution in the country, and not ordered by quality. ONIQ does not publish rankings.";

/** Attribution strings owed per source when its rows are displayed. */
export const SOURCE_ATTRIBUTION: Partial<Record<InstitutionSource, string>> = {
  "HESA Discover Uni": "HESA, www.hesa.ac.uk",
  "College Scorecard": "US Department of Education, College Scorecard",
  AISHE: "AISHE, Ministry of Education (Government Open Data Licence — India)",
  "data.gov.sg": "data.gov.sg (Open Data Licence v1.0)",
  ROR: "Research Organization Registry (ROR), CC0",
  IPEDS: "IPEDS, US National Center for Education Statistics (public domain)",
};

const R1 = "R1: Doctoral Universities — Very High Research Activity";

export const INSTITUTIONS: Institution[] = [
  // ── India (exam_first) ───────────────────────────────────────────────
  { id: "in-iisc", name: "Indian Institute of Science", country: "IN", city: "Bengaluru", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://iisc.ac.in", source: "hand-curated" },
  { id: "in-iit-bombay", name: "Indian Institute of Technology Bombay", country: "IN", city: "Mumbai", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitb.ac.in", source: "hand-curated", notes: "Entry via JEE Advanced." },
  { id: "in-iit-delhi", name: "Indian Institute of Technology Delhi", country: "IN", city: "New Delhi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://home.iitd.ac.in", source: "hand-curated" },
  { id: "in-iit-madras", name: "Indian Institute of Technology Madras", country: "IN", city: "Chennai", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitm.ac.in", source: "hand-curated" },
  { id: "in-iit-kanpur", name: "Indian Institute of Technology Kanpur", country: "IN", city: "Kanpur", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitk.ac.in", source: "hand-curated" },
  { id: "in-iit-kharagpur", name: "Indian Institute of Technology Kharagpur", country: "IN", city: "Kharagpur", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitkgp.ac.in", source: "hand-curated" },
  { id: "in-iit-roorkee", name: "Indian Institute of Technology Roorkee", country: "IN", city: "Roorkee", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitr.ac.in", source: "hand-curated" },
  { id: "in-iit-guwahati", name: "Indian Institute of Technology Guwahati", country: "IN", city: "Guwahati", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iitg.ac.in", source: "hand-curated" },
  { id: "in-du", name: "University of Delhi", country: "IN", city: "New Delhi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.du.ac.in", source: "hand-curated", notes: "Undergraduate entry via CUET-UG." },
  { id: "in-jnu", name: "Jawaharlal Nehru University", country: "IN", city: "New Delhi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.jnu.ac.in", source: "hand-curated" },
  { id: "in-bhu", name: "Banaras Hindu University", country: "IN", city: "Varanasi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.bhu.ac.in", source: "hand-curated" },
  { id: "in-jamia", name: "Jamia Millia Islamia", country: "IN", city: "New Delhi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.jmi.ac.in", source: "hand-curated" },
  { id: "in-amu", name: "Aligarh Muslim University", country: "IN", city: "Aligarh", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.amu.ac.in", source: "hand-curated" },
  { id: "in-aiims-delhi", name: "All India Institute of Medical Sciences, New Delhi", country: "IN", city: "New Delhi", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.aiims.edu", source: "hand-curated", notes: "Medical entry via NEET-UG." },
  { id: "in-nls", name: "National Law School of India University", country: "IN", city: "Bengaluru", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.nls.ac.in", source: "hand-curated", notes: "Entry via CLAT." },
  { id: "in-iim-ahmedabad", name: "Indian Institute of Management Ahmedabad", country: "IN", city: "Ahmedabad", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.iima.ac.in", source: "hand-curated", notes: "Postgraduate entry via CAT." },
  { id: "in-bits-pilani", name: "Birla Institute of Technology and Science, Pilani", country: "IN", city: "Pilani", route: "exam_first", signals: { publicOrPrivate: "private" }, websiteUrl: "https://www.bits-pilani.ac.in", source: "hand-curated", notes: "Entry via its own BITSAT." },
  { id: "in-vit", name: "Vellore Institute of Technology", country: "IN", city: "Vellore", route: "exam_first", signals: { publicOrPrivate: "private" }, websiteUrl: "https://vit.ac.in", source: "hand-curated" },
  { id: "in-manipal", name: "Manipal Academy of Higher Education", country: "IN", city: "Manipal", route: "exam_first", signals: { publicOrPrivate: "private" }, websiteUrl: "https://manipal.edu", source: "hand-curated" },
  { id: "in-anna", name: "Anna University", country: "IN", city: "Chennai", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.annauniv.edu", source: "hand-curated" },
  { id: "in-savitribai", name: "Savitribai Phule Pune University", country: "IN", city: "Pune", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.unipune.ac.in", source: "hand-curated" },
  { id: "in-calcutta", name: "University of Calcutta", country: "IN", city: "Kolkata", route: "exam_first", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.caluniv.ac.in", source: "hand-curated" },

  // ── United States (holistic) ─────────────────────────────────────────
  { id: "us-harvard", name: "Harvard University", country: "US", city: "Cambridge, MA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.harvard.edu", source: "IPEDS" },
  { id: "us-mit", name: "Massachusetts Institute of Technology", country: "US", city: "Cambridge, MA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.mit.edu", source: "IPEDS" },
  { id: "us-stanford", name: "Stanford University", country: "US", city: "Stanford, CA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.stanford.edu", source: "IPEDS" },
  { id: "us-yale", name: "Yale University", country: "US", city: "New Haven, CT", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.yale.edu", source: "IPEDS" },
  { id: "us-princeton", name: "Princeton University", country: "US", city: "Princeton, NJ", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.princeton.edu", source: "IPEDS" },
  { id: "us-columbia", name: "Columbia University in the City of New York", country: "US", city: "New York, NY", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.columbia.edu", source: "IPEDS" },
  { id: "us-upenn", name: "University of Pennsylvania", country: "US", city: "Philadelphia, PA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.upenn.edu", source: "IPEDS" },
  { id: "us-cornell", name: "Cornell University", country: "US", city: "Ithaca, NY", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.cornell.edu", source: "IPEDS" },
  { id: "us-brown", name: "Brown University", country: "US", city: "Providence, RI", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.brown.edu", source: "IPEDS" },
  { id: "us-dartmouth", name: "Dartmouth College", country: "US", city: "Hanover, NH", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://home.dartmouth.edu", source: "IPEDS" },
  { id: "us-caltech", name: "California Institute of Technology", country: "US", city: "Pasadena, CA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.caltech.edu", source: "IPEDS" },
  { id: "us-uc-berkeley", name: "University of California, Berkeley", country: "US", city: "Berkeley, CA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.berkeley.edu", source: "IPEDS" },
  { id: "us-ucla", name: "University of California, Los Angeles", country: "US", city: "Los Angeles, CA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.ucla.edu", source: "IPEDS" },
  { id: "us-umich", name: "University of Michigan–Ann Arbor", country: "US", city: "Ann Arbor, MI", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://umich.edu", source: "IPEDS" },
  { id: "us-uiuc", name: "University of Illinois Urbana-Champaign", country: "US", city: "Urbana, IL", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://illinois.edu", source: "IPEDS" },
  { id: "us-utaustin", name: "University of Texas at Austin", country: "US", city: "Austin, TX", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.utexas.edu", source: "IPEDS" },
  { id: "us-gatech", name: "Georgia Institute of Technology", country: "US", city: "Atlanta, GA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.gatech.edu", source: "IPEDS" },
  { id: "us-purdue", name: "Purdue University", country: "US", city: "West Lafayette, IN", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.purdue.edu", source: "IPEDS" },
  { id: "us-uw", name: "University of Washington", country: "US", city: "Seattle, WA", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.washington.edu", source: "IPEDS" },
  { id: "us-nyu", name: "New York University", country: "US", city: "New York, NY", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "private" }, websiteUrl: "https://www.nyu.edu", source: "IPEDS" },
  { id: "us-asu", name: "Arizona State University", country: "US", city: "Tempe, AZ", route: "holistic", signals: { carnegieClass: R1, publicOrPrivate: "public" }, websiteUrl: "https://www.asu.edu", source: "IPEDS" },
  { id: "us-cuny-hunter", name: "Hunter College, City University of New York", country: "US", city: "New York, NY", route: "holistic", signals: { publicOrPrivate: "public" }, websiteUrl: "https://hunter.cuny.edu", source: "IPEDS", notes: "Carnegie class omitted — not verified for this campus." },

  // ── United Kingdom (centralised_ucas) ────────────────────────────────
  { id: "gb-oxford", name: "University of Oxford", country: "GB", city: "Oxford", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ox.ac.uk", source: "HESA Discover Uni", notes: "Earlier UCAS deadline than most courses." },
  { id: "gb-cambridge", name: "University of Cambridge", country: "GB", city: "Cambridge", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.cam.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-imperial", name: "Imperial College London", country: "GB", city: "London", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.imperial.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-ucl", name: "University College London", country: "GB", city: "London", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ucl.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-lse", name: "London School of Economics and Political Science", country: "GB", city: "London", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.lse.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-kcl", name: "King's College London", country: "GB", city: "London", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.kcl.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-manchester", name: "University of Manchester", country: "GB", city: "Manchester", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.manchester.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-edinburgh", name: "University of Edinburgh", country: "GB", city: "Edinburgh", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ed.ac.uk", source: "HESA Discover Uni", notes: "Scotland — school qualifications differ (SQA); ONIQ does not yet model the SQA system." },
  { id: "gb-glasgow", name: "University of Glasgow", country: "GB", city: "Glasgow", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.gla.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-bristol", name: "University of Bristol", country: "GB", city: "Bristol", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.bristol.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-warwick", name: "University of Warwick", country: "GB", city: "Coventry", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://warwick.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-leeds", name: "University of Leeds", country: "GB", city: "Leeds", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.leeds.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-sheffield", name: "University of Sheffield", country: "GB", city: "Sheffield", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.sheffield.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-nottingham", name: "University of Nottingham", country: "GB", city: "Nottingham", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.nottingham.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-birmingham", name: "University of Birmingham", country: "GB", city: "Birmingham", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.birmingham.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-southampton", name: "University of Southampton", country: "GB", city: "Southampton", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.southampton.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-durham", name: "Durham University", country: "GB", city: "Durham", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.durham.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-queens-belfast", name: "Queen's University Belfast", country: "GB", city: "Belfast", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.qub.ac.uk", source: "HESA Discover Uni", notes: "Northern Ireland." },
  { id: "gb-cardiff", name: "Cardiff University", country: "GB", city: "Cardiff", route: "centralised_ucas", signals: { russellGroup: true, publicOrPrivate: "public" }, websiteUrl: "https://www.cardiff.ac.uk", source: "HESA Discover Uni", notes: "Wales." },
  { id: "gb-bath", name: "University of Bath", country: "GB", city: "Bath", route: "centralised_ucas", signals: { russellGroup: false, publicOrPrivate: "public" }, websiteUrl: "https://www.bath.ac.uk", source: "HESA Discover Uni" },
  { id: "gb-st-andrews", name: "University of St Andrews", country: "GB", city: "St Andrews", route: "centralised_ucas", signals: { russellGroup: false, publicOrPrivate: "public" }, websiteUrl: "https://www.st-andrews.ac.uk", source: "HESA Discover Uni", notes: "Scotland." },
  { id: "gb-lancaster", name: "Lancaster University", country: "GB", city: "Lancaster", route: "centralised_ucas", signals: { russellGroup: false, publicOrPrivate: "public" }, websiteUrl: "https://www.lancaster.ac.uk", source: "HESA Discover Uni" },

  // ── Canada (provincial_grade) ────────────────────────────────────────
  { id: "ca-toronto", name: "University of Toronto", country: "CA", city: "Toronto, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.utoronto.ca", source: "StatCan", notes: "Ontario applicants apply through OUAC." },
  { id: "ca-ubc", name: "University of British Columbia", country: "CA", city: "Vancouver, BC", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ubc.ca", source: "StatCan" },
  { id: "ca-mcgill", name: "McGill University", country: "CA", city: "Montréal, QC", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.mcgill.ca", source: "StatCan", notes: "Québec applicants typically enter after CEGEP." },
  { id: "ca-montreal", name: "Université de Montréal", country: "CA", city: "Montréal, QC", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.umontreal.ca", source: "StatCan" },
  { id: "ca-alberta", name: "University of Alberta", country: "CA", city: "Edmonton, AB", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ualberta.ca", source: "StatCan" },
  { id: "ca-calgary", name: "University of Calgary", country: "CA", city: "Calgary, AB", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ucalgary.ca", source: "StatCan" },
  { id: "ca-mcmaster", name: "McMaster University", country: "CA", city: "Hamilton, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.mcmaster.ca", source: "StatCan" },
  { id: "ca-waterloo", name: "University of Waterloo", country: "CA", city: "Waterloo, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://uwaterloo.ca", source: "StatCan" },
  { id: "ca-western", name: "Western University", country: "CA", city: "London, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.uwo.ca", source: "StatCan" },
  { id: "ca-queens", name: "Queen's University", country: "CA", city: "Kingston, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.queensu.ca", source: "StatCan" },
  { id: "ca-ottawa", name: "University of Ottawa", country: "CA", city: "Ottawa, ON", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.uottawa.ca", source: "StatCan" },
  { id: "ca-laval", name: "Université Laval", country: "CA", city: "Québec City, QC", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.ulaval.ca", source: "StatCan" },
  { id: "ca-dalhousie", name: "Dalhousie University", country: "CA", city: "Halifax, NS", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.dal.ca", source: "StatCan" },
  { id: "ca-manitoba", name: "University of Manitoba", country: "CA", city: "Winnipeg, MB", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://umanitoba.ca", source: "StatCan" },
  { id: "ca-saskatchewan", name: "University of Saskatchewan", country: "CA", city: "Saskatoon, SK", route: "provincial_grade", signals: { u15: true, publicOrPrivate: "public" }, websiteUrl: "https://www.usask.ca", source: "StatCan" },
  { id: "ca-simon-fraser", name: "Simon Fraser University", country: "CA", city: "Burnaby, BC", route: "provincial_grade", signals: { u15: false, publicOrPrivate: "public" }, websiteUrl: "https://www.sfu.ca", source: "StatCan" },
  { id: "ca-victoria", name: "University of Victoria", country: "CA", city: "Victoria, BC", route: "provincial_grade", signals: { u15: false, publicOrPrivate: "public" }, websiteUrl: "https://www.uvic.ca", source: "StatCan" },
  { id: "ca-york", name: "York University", country: "CA", city: "Toronto, ON", route: "provincial_grade", signals: { u15: false, publicOrPrivate: "public" }, websiteUrl: "https://www.yorku.ca", source: "StatCan" },
  { id: "ca-concordia", name: "Concordia University", country: "CA", city: "Montréal, QC", route: "provincial_grade", signals: { u15: false, publicOrPrivate: "public" }, websiteUrl: "https://www.concordia.ca", source: "StatCan" },
  { id: "ca-carleton", name: "Carleton University", country: "CA", city: "Ottawa, ON", route: "provincial_grade", signals: { u15: false, publicOrPrivate: "public" }, websiteUrl: "https://carleton.ca", source: "StatCan" },

  // ── Australia (atar) ─────────────────────────────────────────────────
  { id: "au-melbourne", name: "University of Melbourne", country: "AU", city: "Melbourne, VIC", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.unimelb.edu.au", source: "hand-curated", notes: "Victorian applicants apply through VTAC." },
  { id: "au-sydney", name: "University of Sydney", country: "AU", city: "Sydney, NSW", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.sydney.edu.au", source: "hand-curated", notes: "NSW applicants apply through UAC." },
  { id: "au-anu", name: "Australian National University", country: "AU", city: "Canberra, ACT", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.anu.edu.au", source: "hand-curated" },
  { id: "au-unsw", name: "UNSW Sydney", country: "AU", city: "Sydney, NSW", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.unsw.edu.au", source: "hand-curated" },
  { id: "au-uq", name: "University of Queensland", country: "AU", city: "Brisbane, QLD", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.uq.edu.au", source: "hand-curated", notes: "Queensland applicants apply through QTAC." },
  { id: "au-monash", name: "Monash University", country: "AU", city: "Melbourne, VIC", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.monash.edu", source: "hand-curated" },
  { id: "au-uwa", name: "University of Western Australia", country: "AU", city: "Perth, WA", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.uwa.edu.au", source: "hand-curated" },
  { id: "au-adelaide", name: "University of Adelaide", country: "AU", city: "Adelaide, SA", route: "atar", signals: { groupOfEight: true, publicOrPrivate: "public" }, websiteUrl: "https://www.adelaide.edu.au", source: "hand-curated" },
  { id: "au-uts", name: "University of Technology Sydney", country: "AU", city: "Sydney, NSW", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.uts.edu.au", source: "hand-curated" },
  { id: "au-rmit", name: "RMIT University", country: "AU", city: "Melbourne, VIC", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.rmit.edu.au", source: "hand-curated" },
  { id: "au-deakin", name: "Deakin University", country: "AU", city: "Geelong, VIC", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.deakin.edu.au", source: "hand-curated" },
  { id: "au-macquarie", name: "Macquarie University", country: "AU", city: "Sydney, NSW", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.mq.edu.au", source: "hand-curated" },
  { id: "au-qut", name: "Queensland University of Technology", country: "AU", city: "Brisbane, QLD", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.qut.edu.au", source: "hand-curated" },
  { id: "au-curtin", name: "Curtin University", country: "AU", city: "Perth, WA", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.curtin.edu.au", source: "hand-curated" },
  { id: "au-griffith", name: "Griffith University", country: "AU", city: "Gold Coast, QLD", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.griffith.edu.au", source: "hand-curated" },
  { id: "au-latrobe", name: "La Trobe University", country: "AU", city: "Melbourne, VIC", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.latrobe.edu.au", source: "hand-curated" },
  { id: "au-wollongong", name: "University of Wollongong", country: "AU", city: "Wollongong, NSW", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.uow.edu.au", source: "hand-curated" },
  { id: "au-tasmania", name: "University of Tasmania", country: "AU", city: "Hobart, TAS", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.utas.edu.au", source: "hand-curated" },
  { id: "au-newcastle", name: "University of Newcastle", country: "AU", city: "Newcastle, NSW", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.newcastle.edu.au", source: "hand-curated" },
  { id: "au-flinders", name: "Flinders University", country: "AU", city: "Adelaide, SA", route: "atar", signals: { groupOfEight: false, publicOrPrivate: "public" }, websiteUrl: "https://www.flinders.edu.au", source: "hand-curated" },

  // ── Singapore (multi_track) ──────────────────────────────────────────
  { id: "sg-nus", name: "National University of Singapore", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.nus.edu.sg", source: "hand-curated", notes: "University track." },
  { id: "sg-ntu", name: "Nanyang Technological University", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.ntu.edu.sg", source: "hand-curated", notes: "University track." },
  { id: "sg-smu", name: "Singapore Management University", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.smu.edu.sg", source: "hand-curated", notes: "University track." },
  { id: "sg-sutd", name: "Singapore University of Technology and Design", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.sutd.edu.sg", source: "hand-curated", notes: "University track." },
  { id: "sg-sit", name: "Singapore Institute of Technology", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.singaporetech.edu.sg", source: "hand-curated", notes: "University track, applied degrees." },
  { id: "sg-suss", name: "Singapore University of Social Sciences", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.suss.edu.sg", source: "hand-curated", notes: "University track, part-time pathways." },
  { id: "sg-np", name: "Ngee Ann Polytechnic", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.np.edu.sg", source: "hand-curated", notes: "Polytechnic track." },
  { id: "sg-sp", name: "Singapore Polytechnic", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.sp.edu.sg", source: "hand-curated", notes: "Polytechnic track." },
  { id: "sg-tp", name: "Temasek Polytechnic", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.tp.edu.sg", source: "hand-curated", notes: "Polytechnic track." },
  { id: "sg-nyp", name: "Nanyang Polytechnic", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.nyp.edu.sg", source: "hand-curated", notes: "Polytechnic track." },
  { id: "sg-rp", name: "Republic Polytechnic", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.rp.edu.sg", source: "hand-curated", notes: "Polytechnic track." },
  { id: "sg-ite", name: "Institute of Technical Education", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.ite.edu.sg", source: "hand-curated", notes: "ITE track." },
  { id: "sg-nafa", name: "Nanyang Academy of Fine Arts", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "private" }, websiteUrl: "https://www.nafa.edu.sg", source: "hand-curated", notes: "Arts institution — portfolio/audition entry." },
  { id: "sg-lasalle", name: "LASALLE College of the Arts", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "private" }, websiteUrl: "https://www.lasalle.edu.sg", source: "hand-curated", notes: "Arts institution — portfolio/audition entry." },
  { id: "sg-duke-nus", name: "Duke-NUS Medical School", country: "SG", city: "Singapore", route: "multi_track", signals: { publicOrPrivate: "public" }, websiteUrl: "https://www.duke-nus.edu.sg", source: "hand-curated", notes: "Graduate-entry medicine; partnership with Duke University." },

  // ── United Arab Emirates (direct_branch_campus) — hand-curated only ──
  { id: "ae-uaeu", name: "United Arab Emirates University", country: "AE", city: "Al Ain", route: "direct_branch_campus", signals: { publicOrPrivate: "public", isBranchCampus: false }, websiteUrl: "https://www.uaeu.ac.ae", source: "hand-curated" },
  { id: "ae-ku", name: "Khalifa University", country: "AE", city: "Abu Dhabi", route: "direct_branch_campus", signals: { publicOrPrivate: "public", isBranchCampus: false }, websiteUrl: "https://www.ku.ac.ae", source: "hand-curated" },
  { id: "ae-aus", name: "American University of Sharjah", country: "AE", city: "Sharjah", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: false }, websiteUrl: "https://www.aus.edu", source: "hand-curated" },
  { id: "ae-aud", name: "American University in Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: false }, websiteUrl: "https://www.aud.edu", source: "hand-curated" },
  { id: "ae-zayed", name: "Zayed University", country: "AE", city: "Dubai / Abu Dhabi", route: "direct_branch_campus", signals: { publicOrPrivate: "public", isBranchCampus: false }, websiteUrl: "https://www.zu.ac.ae", source: "hand-curated" },
  { id: "ae-hct", name: "Higher Colleges of Technology", country: "AE", city: "Multiple emirates", route: "direct_branch_campus", signals: { publicOrPrivate: "public", isBranchCampus: false }, websiteUrl: "https://www.hct.ac.ae", source: "hand-curated" },
  { id: "ae-sharjah", name: "University of Sharjah", country: "AE", city: "Sharjah", route: "direct_branch_campus", signals: { publicOrPrivate: "public", isBranchCampus: false }, websiteUrl: "https://www.sharjah.ac.ae", source: "hand-curated" },
  { id: "ae-nyuad", name: "NYU Abu Dhabi", country: "AE", city: "Abu Dhabi", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://nyuad.nyu.edu", source: "hand-curated", notes: "Portal campus of New York University (parent institution)." },
  { id: "ae-sorbonne-ad", name: "Sorbonne University Abu Dhabi", country: "AE", city: "Abu Dhabi", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.sorbonne.ae", source: "hand-curated", notes: "Branch campus of Sorbonne University, Paris (parent institution)." },
  { id: "ae-heriot-watt-dubai", name: "Heriot-Watt University Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.hw.ac.uk/dubai", source: "hand-curated", notes: "Branch campus of Heriot-Watt University, Edinburgh (parent institution)." },
  { id: "ae-wollongong-dubai", name: "University of Wollongong in Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.uowdubai.ac.ae", source: "hand-curated", notes: "Branch campus of the University of Wollongong, Australia (parent institution)." },
  { id: "ae-birmingham-dubai", name: "University of Birmingham Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.birmingham.ac.uk/dubai", source: "hand-curated", notes: "Branch campus of the University of Birmingham, UK (parent institution)." },
  { id: "ae-middlesex-dubai", name: "Middlesex University Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.mdx.ac.ae", source: "hand-curated", notes: "Branch campus of Middlesex University, London (parent institution)." },
  { id: "ae-bits-dubai", name: "BITS Pilani, Dubai Campus", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.bits-pilani.ac.in/dubai/", source: "hand-curated", notes: "Branch campus of BITS Pilani, India (parent institution)." },
  { id: "ae-manipal-dubai", name: "Manipal Academy of Higher Education, Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.manipaldubai.com", source: "hand-curated", notes: "Branch campus of Manipal Academy of Higher Education, India (parent institution)." },
  { id: "ae-amity-dubai", name: "Amity University Dubai", country: "AE", city: "Dubai", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: true }, websiteUrl: "https://www.amityuniversity.ae", source: "hand-curated", notes: "Branch campus of Amity University, India (parent institution)." },
  { id: "ae-ajman", name: "Ajman University", country: "AE", city: "Ajman", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: false }, websiteUrl: "https://www.ajman.ac.ae", source: "hand-curated" },
  { id: "ae-abu-dhabi-university", name: "Abu Dhabi University", country: "AE", city: "Abu Dhabi", route: "direct_branch_campus", signals: { publicOrPrivate: "private", isBranchCampus: false }, websiteUrl: "https://www.adu.ac.ae", source: "hand-curated" },
];

const BY_ID = new Map(INSTITUTIONS.map((i) => [i.id, i]));

export function getInstitution(id: string): Institution | undefined {
  return BY_ID.get(id);
}

export function institutionsFor(country: Country): Institution[] {
  return INSTITUTIONS.filter((i) => i.country === country);
}

/** The route ONIQ models for a country — institutions must agree with it. */
export function expectedRouteFor(country: Country): AdmissionRoute {
  return COUNTRY_ROUTE[country];
}
