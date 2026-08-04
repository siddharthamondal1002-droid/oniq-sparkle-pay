// ONIQ Education & Careers loop — Phase 7: attributions.
//
// Attribution is a LICENCE CONDITION, not a courtesy. A missing or
// paraphrased notice is a breach of the licence, not a politeness lapse.
// Every `requiredNotice` below is reproduced verbatim; do not reword one.

export type Attribution = {
  id: string;
  /** What ONIQ actually uses it for — be specific, not generic. */
  usedFor: string;
  source: string; // human name of the dataset/body
  licence: string; // licence name
  licenceUrl: string;
  /** The EXACT text the licence requires, verbatim, or null if none. */
  requiredNotice: string | null;
  /** Real carve-outs within an otherwise-permissive licence. */
  exclusions: string[];
  sourceUrl: string;
  notes?: string;
};

/** Shown prominently on the attributions screen. Never soften this. */
export const INDEPENDENCE_DISCLAIMER =
  "ONIQ is independent. It is not affiliated with, endorsed by, or approved by any examination board, awarding body, university, or government department.";

/** ONIQ's own content — credited honestly, claimed for nothing more. */
export const ONIQ_OWN_CONTENT =
  "The education-system structural facts, command-word explanations, admissions-route explainers, CV guidance and every generated practice question in ONIQ are ONIQ's own original content. None of it is reproduced from an examination authority's materials, and none of it is a past paper.";

export const ATTRIBUTIONS: Attribution[] = [
  // ---- Open Government Licence family -------------------------------------
  {
    id: "uk-national-curriculum",
    usedFor:
      "The structure of the England National Curriculum used by the Study screen: key stages, year groups and subject lists behind country-aware practice-paper generation.",
    source: "National Curriculum in England (Department for Education)",
    licence: "Open Government Licence v3.0",
    licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    requiredNotice:
      "Contains public sector information licensed under the Open Government Licence v3.0.",
    exclusions: [],
    sourceUrl: "https://www.gov.uk/government/collections/national-curriculum",
    notes: "Commercial use is permitted under the OGL v3.0.",
  },
  {
    id: "aishe",
    usedFor:
      "Indian higher-education institution facts cross-checked while building the university registry.",
    source: "All India Survey on Higher Education (AISHE), Ministry of Education, via data.gov.in",
    licence: "Government Open Data Licence – India (GODL)",
    licenceUrl: "https://www.data.gov.in/government-open-data-license-india",
    requiredNotice: null,
    exclusions: [],
    sourceUrl: "https://www.data.gov.in/catalog/all-india-survey-higher-education-aishe",
    notes:
      "Commercial use is permitted. GODL attribution must name the dataset, its date of publication and the source URL or DOI — those details are recorded alongside any AISHE-derived row. Not currently the source of any shipped institution row.",
  },
  {
    id: "data-gov-au",
    usedFor:
      "Australian higher-education reference data consulted while building the university registry.",
    source: "data.gov.au (Australian Government open data portal)",
    licence: "Per-dataset — see each dataset's own metadata record",
    licenceUrl: "https://data.gov.au/",
    requiredNotice: null,
    exclusions: [
      "CC BY 4.0 is the Australian Government's recommended default, but it is not a blanket licence for the portal.",
      "The licence shown on an individual dataset's metadata record governs that dataset, and may be more restrictive.",
    ],
    sourceUrl: "https://data.gov.au/",
    notes:
      "Licensing here is per dataset, not blanket CC BY. It is not currently the source of any shipped institution row; if one is added, the specific dataset and its own licence must be named here.",
  },
  {
    id: "data-gov-sg",
    usedFor:
      "Singapore higher-education reference data consulted while building the university registry.",
    source: "data.gov.sg",
    licence: "Singapore Open Data Licence v1.0",
    licenceUrl: "https://data.gov.sg/open-data-licence",
    requiredNotice: null,
    exclusions: [],
    sourceUrl: "https://data.gov.sg/",
    notes:
      "Commercial use is permitted. The licence requires a conspicuous attribution notice together with a link to the licence — both are on this screen. Not currently the source of any shipped institution row.",
  },
  {
    id: "statcan",
    usedFor:
      "Canadian institution facts (city, public/private status, U15 membership) in the university registry.",
    source: "Statistics Canada",
    licence: "Statistics Canada Open Licence",
    licenceUrl: "https://www.statcan.gc.ca/en/reference/licence",
    requiredNotice: null,
    exclusions: [
      "The licence requires that Statistics Canada is not represented as endorsing the use or the resulting product.",
    ],
    sourceUrl: "https://www.statcan.gc.ca/",
    notes: "Reproduction for commercial purposes is permitted with acknowledgement of the source.",
  },

  // ---- Creative Commons attribution family --------------------------------
  {
    id: "acara",
    usedFor:
      "The structure of the Australian Curriculum used by the Study screen: learning areas, year levels and stage model behind country-aware practice-paper generation.",
    source: "Australian Curriculum, Assessment and Reporting Authority (ACARA)",
    licence: "CC BY 4.0 for the bulk of the material — with the carve-outs below",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    requiredNotice: null,
    exclusions: [
      "Excluded Materials as defined by ACARA — personal and non-commercial use only.",
      "The National Literacy Learning Progressions — licensed CC BY-NC 4.0, non-commercial use only.",
      "Third-party content included with permission, which carries its own separate terms.",
      "The ACARA, Australian Curriculum, Australian Government and Education Services Australia (ESA) logos and trade marks.",
    ],
    sourceUrl: "https://www.australiancurriculum.edu.au/copyright-and-terms-of-use/",
    notes:
      "Not a blanket CC BY grant. ONIQ uses only the structural facts outside the excluded categories, and reproduces no excluded material.",
  },
  {
    id: "hesa-discover-uni",
    usedFor:
      "UK institution facts (name, location, Russell Group membership) in the university registry.",
    source: "HESA / Discover Uni",
    licence: "CC BY 4.0",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    requiredNotice: "HESA, www.hesa.ac.uk",
    exclusions: [],
    sourceUrl: "https://www.hesa.ac.uk/",
    notes: "The attribution string above is the exact form HESA requires.",
  },
  {
    id: "college-scorecard",
    usedFor:
      "US institution reference data cross-checked while building the university registry.",
    source: "College Scorecard, US Department of Education",
    licence: "CC BY (per its own catalog record)",
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
    requiredNotice: null,
    exclusions: [],
    sourceUrl: "https://collegescorecard.ed.gov/data/",
    notes:
      "Deliberately attributed rather than treated as public domain: its catalog record is tagged CC BY, inconsistently with the underlying federal data, so ONIQ credits it either way. Not currently the source of any shipped institution row.",
  },

  // ---- Public domain / CC0 family -----------------------------------------
  {
    id: "ror",
    usedFor:
      "Canonical organisation identifiers (ROR IDs) recorded against institutions, only where verified.",
    source: "Research Organization Registry (ROR)",
    licence: "CC0 1.0 (public domain dedication)",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    requiredNotice: null,
    exclusions: [
      "Registry data is CC0, but content on the ror.org website is CC BY 4.0.",
      "The ROR logo is CC BY-ND 4.0 and is not reproduced here.",
    ],
    sourceUrl: "https://ror.org/",
    notes:
      "No attribution is legally required for the registry data. ROR asks to be cited as a courtesy, and this credit is that courtesy — not a licence condition. ROR is not currently the source of any shipped institution row; only individually verified ROR IDs are recorded.",
  },
  {
    id: "wikidata",
    usedFor:
      "Cross-checking institution names and locations while building the university registry.",
    source: "Wikidata",
    licence: "CC0 1.0 for structured data",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    requiredNotice: null,
    exclusions: [
      "CC0 covers the main, Property, Lexeme and EntitySchema namespaces; other namespaces are CC BY-SA and are not used here.",
    ],
    sourceUrl: "https://www.wikidata.org/",
    notes: "No attribution is legally required. Not currently the source of any shipped row.",
  },
  {
    id: "ipeds",
    usedFor:
      "US institution facts (name, city, Carnegie classification, public/private status) in the university registry.",
    source: "IPEDS, US National Center for Education Statistics",
    licence: "US public domain (17 U.S.C. §105, work of the US federal government)",
    licenceUrl: "https://www.law.cornell.edu/uscode/text/17/105",
    requiredNotice: null,
    exclusions: [],
    sourceUrl: "https://nces.ed.gov/ipeds/",
    notes: "Genuinely public domain — no attribution is legally required. Credited anyway.",
  },

  // ---- Verbatim-only licences ---------------------------------------------
  {
    id: "common-core",
    usedFor:
      "The structure of US state standards used by the Study screen: grade bands and subject strands behind country-aware practice-paper generation.",
    source:
      "Common Core State Standards — National Governors Association Center for Best Practices and Council of Chief State School Officers",
    licence: "Public Licence — verbatim reproduction only",
    licenceUrl: "https://www.thecorestandards.org/public-license/",
    requiredNotice:
      "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.",
    exclusions: [
      "The standards text may not be edited, altered or recast.",
      "The standards text may not be sold.",
      "The licence may not be sublicensed.",
      "The NGA Center and CCSSO names and logos may not be used without permission.",
    ],
    sourceUrl: "https://www.thecorestandards.org/",
    notes:
      "The notice requirement is waived for US states that formally adopted the standards. ONIQ's own generated practice content is original and does not reproduce the standards text, so it does not trigger the notice — the notice is reproduced here regardless, because the structural references do.",
  },
];

export function getAttribution(id: string): Attribution | undefined {
  return ATTRIBUTIONS.find((a) => a.id === id);
}

/** Rough grouping for the screen — legal families, not marketing sections. */
export const LICENCE_FAMILIES: { title: string; blurb: string; ids: string[] }[] = [
  {
    title: "Government open licences",
    blurb:
      "Public sector information, reusable commercially, on condition that the notice below appears where the information is used.",
    ids: ["uk-national-curriculum", "aishe", "data-gov-au", "data-gov-sg", "statcan"],
  },
  {
    title: "Creative Commons — attribution required",
    blurb: "Reusable, including commercially, only while the credit is given exactly as specified.",
    ids: ["acara", "hesa-discover-uni", "college-scorecard"],
  },
  {
    title: "Public domain and CC0",
    blurb:
      "No attribution is legally owed. Credited anyway, so you can see where the facts came from.",
    ids: ["ror", "wikidata", "ipeds"],
  },
  {
    title: "Verbatim-only licences",
    blurb: "Usable only exactly as published — no editing, no recasting, no sale.",
    ids: ["common-core"],
  },
];

/**
 * Reconciliation with Phase 3's institution registry: every external
 * `InstitutionSource` value maps to an attributions entry. "hand-curated"
 * is ONIQ's own work and owes no third-party credit.
 */
export const INSTITUTION_SOURCE_TO_ATTRIBUTION: Record<string, string | null> = {
  ROR: "ror",
  IPEDS: "ipeds",
  "College Scorecard": "college-scorecard",
  "HESA Discover Uni": "hesa-discover-uni",
  AISHE: "aishe",
  StatCan: "statcan",
  "data.gov.au": "data-gov-au",
  "data.gov.sg": "data-gov-sg",
  "hand-curated": null,
};
