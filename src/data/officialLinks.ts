// ONIQ "Official" tile — government & visa directory. HIGHEST-RISK surface:
// a wrong domain here is a phishing vector, not a bug.
//
// HARD RULES (enforced by isAllowedGovHost + the registry test suite):
//  - Government rows may only link hosts on GOV_HOST_ALLOWLIST.
//  - Outsourcing partners (VFS/TLScontact/CGI Federal) are NEVER badged as
//    government — they render in their own clearly-labelled section.
//  - BLOCKLISTED_HOSTS are refused outright (e.g. australianetaapp.com,
//    which impersonates Australia's official ETA app).
//  - No State Emblem / Ashoka Chakra / government logos — text + neutral
//    icons only (State Emblem of India (Prohibition of Improper Use) Act 2005).
//  - Links open in a Custom Tab / system browser, never framed in a WebView.

import type { Country } from "@/data/appRegistry";

export type OfficialCategory =
  | "visa"
  | "national"
  | "digitalid"
  | "tax"
  | "passport"
  | "driving"
  | "health"
  | "welfare"
  | "business"
  | "police"
  | "consumer"
  | "elections"
  | "education";

export type OfficialLink = {
  id: string;
  name: string;
  desc: string;
  url: string;
  country: Country;
  category: OfficialCategory;
  kind: "gov" | "partner"; // partner = appointed outsourcer, NOT government
};

export const OFFICIAL_CATEGORY_LABELS: { id: OfficialCategory; label: string; labelHi: string }[] =
  [
    { id: "visa", label: "Visa & Immigration", labelHi: "वीज़ा और आप्रवासन" },
    { id: "national", label: "National Portal", labelHi: "राष्ट्रीय पोर्टल" },
    { id: "digitalid", label: "Digital ID", labelHi: "डिजिटल पहचान" },
    { id: "tax", label: "Tax", labelHi: "कर" },
    { id: "passport", label: "Passport", labelHi: "पासपोर्ट" },
    { id: "driving", label: "Driving & Vehicle", labelHi: "वाहन और लाइसेंस" },
    { id: "health", label: "Health", labelHi: "स्वास्थ्य" },
    { id: "welfare", label: "Welfare", labelHi: "कल्याण" },
    { id: "business", label: "Business", labelHi: "व्यापार" },
    { id: "police", label: "Police & Cybercrime", labelHi: "पुलिस और साइबर अपराध" },
    { id: "consumer", label: "Consumer Grievance", labelHi: "उपभोक्ता शिकायत" },
    { id: "elections", label: "Elections", labelHi: "चुनाव" },
    { id: "education", label: "Education", labelHi: "शिक्षा" },
  ];

/** Only these TLD families / exact hosts may carry the government badge. */
const GOV_HOST_SUFFIXES = [
  ".gov.in",
  ".gov",
  ".gov.uk",
  ".gov.ae",
  ".canada.ca",
  ".gc.ca",
  ".gov.au",
  ".gov.sg",
  ".nic.in",
];
const GOV_HOST_EXACT = ["canada.ca", "gov.uk", "gov.in", "gov.sg"];

export const BLOCKLISTED_HOSTS = [
  "australianetaapp.com", // impersonates the official Australian ETA app
];

/** Validate the RESOLVED host of a URL against the government allowlist. */
export function isAllowedGovHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (BLOCKLISTED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) return false;
    if (GOV_HOST_EXACT.includes(host)) return true;
    return GOV_HOST_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Emergency & fraud helplines, tap-to-call. */
export const HELPLINES: Record<Country, { label: string; number: string }[]> = {
  IN: [
    { label: "Emergency", number: "112" },
    { label: "Cyber fraud (report within hours)", number: "1930" },
    { label: "Consumer helpline", number: "1915" },
  ],
  US: [{ label: "Emergency", number: "911" }],
  GB: [{ label: "Emergency", number: "999" }],
  AE: [{ label: "Police / Emergency", number: "999" }],
  CA: [{ label: "Emergency", number: "911" }],
  AU: [{ label: "Emergency", number: "000" }],
  SG: [
    { label: "Police / Emergency", number: "999" },
    { label: "ICA (immigration)", number: "1799" },
  ],
};

export const OFFICIAL_LINKS: OfficialLink[] = [
  // ================= VISA & IMMIGRATION (exact entry points) =================
  {
    id: "in-evisa",
    name: "India e-Visa",
    desc: "Official Indian e-visa application",
    url: "https://indianvisaonline.gov.in/evisa/",
    country: "IN",
    category: "visa",
    kind: "gov",
  },
  {
    id: "us-ds160",
    name: "US DS-160 (CEAC)",
    desc: "Nonimmigrant visa application",
    url: "https://ceac.state.gov/genniv/",
    country: "US",
    category: "visa",
    kind: "gov",
  },
  {
    id: "us-esta",
    name: "US ESTA",
    desc: "Visa-waiver travel authorisation",
    url: "https://esta.cbp.dhs.gov",
    country: "US",
    category: "visa",
    kind: "gov",
  },
  {
    id: "gb-visa",
    name: "UK Visas & Immigration",
    desc: "All UK visa routes",
    url: "https://www.gov.uk/browse/visas-immigration",
    country: "GB",
    category: "visa",
    kind: "gov",
  },
  {
    id: "ae-icp",
    name: "UAE ICP (federal)",
    desc: "Federal identity, citizenship & visas",
    url: "https://icp.gov.ae",
    country: "AE",
    category: "visa",
    kind: "gov",
  },
  {
    id: "ae-gdrfa",
    name: "GDRFA Dubai",
    desc: "Dubai residency & foreign affairs",
    url: "https://gdrfad.gov.ae",
    country: "AE",
    category: "visa",
    kind: "gov",
  },
  {
    id: "ca-ircc",
    name: "IRCC Canada",
    desc: "Immigration, refugees & citizenship",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship.html",
    country: "CA",
    category: "visa",
    kind: "gov",
  },
  {
    id: "au-immi",
    name: "Australia Home Affairs",
    desc: "Visas & immigration (ETA only via the official AustralianETA app)",
    url: "https://immi.homeaffairs.gov.au",
    country: "AU",
    category: "visa",
    kind: "gov",
  },
  {
    id: "sg-ica",
    name: "Singapore ICA",
    desc: "Immigration & Checkpoints Authority",
    url: "https://www.ica.gov.sg",
    country: "SG",
    category: "visa",
    kind: "gov",
  },
  {
    id: "sg-arrival",
    name: "SG Arrival Card",
    desc: "FREE — never pay a third-party site for this",
    url: "https://eservices.ica.gov.sg/sgarrivalcard",
    country: "SG",
    category: "visa",
    kind: "gov",
  },

  // ================= OUTSOURCING PARTNERS (NOT government) =================
  {
    id: "vfs",
    name: "VFS Global",
    desc: "Appointed visa-application partner for many embassies",
    url: "https://visa.vfsglobal.com",
    country: "IN",
    category: "visa",
    kind: "partner",
  },
  {
    id: "tls",
    name: "TLScontact",
    desc: "Appointed visa-application partner (UK & Schengen routes)",
    url: "https://www.tlscontact.com",
    country: "IN",
    category: "visa",
    kind: "partner",
  },
  {
    id: "cgi",
    name: "CGI Federal (US visas)",
    desc: "Appointed partner for US visa appointments in India",
    url: "https://www.ustraveldocs.com",
    country: "IN",
    category: "visa",
    kind: "partner",
  },

  // ================= INDIA =================
  {
    id: "in-portal",
    name: "India.gov.in",
    desc: "All government services portal",
    url: "https://services.india.gov.in",
    country: "IN",
    category: "national",
    kind: "gov",
  },
  {
    id: "in-digilocker",
    name: "DigiLocker",
    desc: "Your documents, digital",
    url: "https://www.digilocker.gov.in",
    country: "IN",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "in-uidai",
    name: "Aadhaar (UIDAI)",
    desc: "Aadhaar services",
    url: "https://uidai.gov.in",
    country: "IN",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "in-itr",
    name: "Income Tax",
    desc: "File returns & track refunds",
    url: "https://www.incometax.gov.in",
    country: "IN",
    category: "tax",
    kind: "gov",
  },
  {
    id: "in-gst",
    name: "GST",
    desc: "GST portal",
    url: "https://www.gst.gov.in",
    country: "IN",
    category: "tax",
    kind: "gov",
  },
  {
    id: "in-passport",
    name: "Passport Seva",
    desc: "Apply & track passport",
    url: "https://www.passportindia.gov.in",
    country: "IN",
    category: "passport",
    kind: "gov",
  },
  {
    id: "in-parivahan",
    name: "Parivahan",
    desc: "Licence & vehicle services",
    url: "https://parivahan.gov.in",
    country: "IN",
    category: "driving",
    kind: "gov",
  },
  {
    id: "in-abha",
    name: "ABHA / NHA",
    desc: "Ayushman Bharat health account",
    url: "https://abha.abdm.gov.in",
    country: "IN",
    category: "health",
    kind: "gov",
  },
  {
    id: "in-epfo",
    name: "EPFO",
    desc: "Provident fund services",
    url: "https://www.epfindia.gov.in",
    country: "IN",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "in-mca",
    name: "MCA",
    desc: "Company registration & filings",
    url: "https://www.mca.gov.in",
    country: "IN",
    category: "business",
    kind: "gov",
  },
  {
    id: "in-cybercrime",
    name: "Cybercrime Portal",
    desc: "Report cyber fraud (also call 1930)",
    url: "https://cybercrime.gov.in",
    country: "IN",
    category: "police",
    kind: "gov",
  },
  {
    id: "in-consumer",
    name: "Consumer Helpline",
    desc: "Consumer complaints (also call 1915)",
    url: "https://consumerhelpline.gov.in",
    country: "IN",
    category: "consumer",
    kind: "gov",
  },
  {
    id: "in-pgportal",
    name: "CPGRAMS",
    desc: "File & track public grievances",
    url: "https://pgportal.gov.in",
    country: "IN",
    category: "consumer",
    kind: "gov",
  },
  {
    id: "in-eci",
    name: "Election Commission",
    desc: "Voter services (voters.eci.gov.in)",
    url: "https://voters.eci.gov.in",
    country: "IN",
    category: "elections",
    kind: "gov",
  },
  {
    id: "in-scholarships",
    name: "National Scholarship Portal",
    desc: "Central scholarships",
    url: "https://scholarships.gov.in",
    country: "IN",
    category: "education",
    kind: "gov",
  },
  {
    id: "in-ecourts",
    name: "eCourts",
    desc: "Case status online",
    url: "https://services.ecourts.gov.in",
    country: "IN",
    category: "national",
    kind: "gov",
  },
  {
    id: "in-wb",
    name: "West Bengal Govt",
    desc: "Government of West Bengal",
    url: "https://wb.gov.in",
    country: "IN",
    category: "national",
    kind: "gov",
  },

  // ================= UNITED STATES =================
  {
    id: "us-usagov",
    name: "USA.gov",
    desc: "US government services portal",
    url: "https://www.usa.gov",
    country: "US",
    category: "national",
    kind: "gov",
  },
  {
    id: "us-login",
    name: "Login.gov",
    desc: "One account for US government",
    url: "https://www.login.gov",
    country: "US",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "us-irs",
    name: "IRS",
    desc: "Federal taxes & refunds",
    url: "https://www.irs.gov",
    country: "US",
    category: "tax",
    kind: "gov",
  },
  {
    id: "us-passport",
    name: "US Passports (State Dept)",
    desc: "Apply & renew passports",
    url: "https://travel.state.gov",
    country: "US",
    category: "passport",
    kind: "gov",
  },
  {
    id: "us-medicare",
    name: "Medicare",
    desc: "Federal health coverage",
    url: "https://www.medicare.gov",
    country: "US",
    category: "health",
    kind: "gov",
  },
  {
    id: "us-ssa",
    name: "Social Security",
    desc: "SSA benefits & cards",
    url: "https://www.ssa.gov",
    country: "US",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "us-sba",
    name: "SBA",
    desc: "Small business administration",
    url: "https://www.sba.gov",
    country: "US",
    category: "business",
    kind: "gov",
  },
  {
    id: "us-ic3",
    name: "IC3",
    desc: "Report internet crime (FBI)",
    url: "https://www.ic3.gov",
    country: "US",
    category: "police",
    kind: "gov",
  },
  {
    id: "us-ftc",
    name: "FTC ReportFraud",
    desc: "Report fraud & scams",
    url: "https://reportfraud.ftc.gov",
    country: "US",
    category: "consumer",
    kind: "gov",
  },
  {
    id: "us-vote",
    name: "Vote.gov",
    desc: "Register to vote",
    url: "https://vote.gov",
    country: "US",
    category: "elections",
    kind: "gov",
  },
  {
    id: "us-studentaid",
    name: "Federal Student Aid",
    desc: "FAFSA & student loans",
    url: "https://studentaid.gov",
    country: "US",
    category: "education",
    kind: "gov",
  },

  // ================= UNITED KINGDOM =================
  {
    id: "gb-portal",
    name: "GOV.UK",
    desc: "All UK government services",
    url: "https://www.gov.uk",
    country: "GB",
    category: "national",
    kind: "gov",
  },
  {
    id: "gb-tax",
    name: "HMRC",
    desc: "Personal tax account",
    url: "https://www.gov.uk/personal-tax-account",
    country: "GB",
    category: "tax",
    kind: "gov",
  },
  {
    id: "gb-passport",
    name: "UK Passports",
    desc: "Apply & renew",
    url: "https://www.gov.uk/browse/citizenship/passports",
    country: "GB",
    category: "passport",
    kind: "gov",
  },
  {
    id: "gb-dvla",
    name: "DVLA",
    desc: "Driving licences & vehicles",
    url: "https://www.gov.uk/browse/driving",
    country: "GB",
    category: "driving",
    kind: "gov",
  },
  {
    id: "gb-nhs",
    name: "NHS",
    desc: "Health services (nhs.uk)",
    url: "https://www.gov.uk/health-services",
    country: "GB",
    category: "health",
    kind: "gov",
  },
  {
    id: "gb-benefits",
    name: "Benefits",
    desc: "Universal Credit & benefits",
    url: "https://www.gov.uk/browse/benefits",
    country: "GB",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "gb-companies",
    name: "Companies House",
    desc: "Register & file company info",
    url: "https://www.gov.uk/government/organisations/companies-house",
    country: "GB",
    category: "business",
    kind: "gov",
  },
  {
    id: "gb-phishing",
    name: "Report phishing & scams",
    desc: "GOV.UK reporting service",
    url: "https://www.gov.uk/report-suspicious-emails-websites-phishing",
    country: "GB",
    category: "police",
    kind: "gov",
  },
  {
    id: "gb-vote",
    name: "Register to vote",
    desc: "Electoral registration",
    url: "https://www.gov.uk/register-to-vote",
    country: "GB",
    category: "elections",
    kind: "gov",
  },
  {
    id: "gb-studentfinance",
    name: "Student Finance",
    desc: "Loans & grants",
    url: "https://www.gov.uk/student-finance",
    country: "GB",
    category: "education",
    kind: "gov",
  },

  // ================= UAE =================
  {
    id: "ae-uaepass",
    name: "UAE PASS",
    desc: "National digital identity",
    url: "https://icp.gov.ae/en/uae-pass/",
    country: "AE",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "ae-tax",
    name: "Federal Tax Authority",
    desc: "VAT & corporate tax",
    url: "https://tax.gov.ae",
    country: "AE",
    category: "tax",
    kind: "gov",
  },
  {
    id: "ae-moi",
    name: "Ministry of Interior",
    desc: "Police, traffic & vehicles",
    url: "https://moi.gov.ae",
    country: "AE",
    category: "driving",
    kind: "gov",
  },
  {
    id: "ae-health",
    name: "MOHAP",
    desc: "Ministry of Health",
    url: "https://mohap.gov.ae",
    country: "AE",
    category: "health",
    kind: "gov",
  },
  {
    id: "ae-ecrime",
    name: "Dubai Police eCrime",
    desc: "Report cybercrime",
    url: "https://www.dubaipolice.gov.ae",
    country: "AE",
    category: "police",
    kind: "gov",
  },
  {
    id: "ae-consumer",
    name: "Consumer Protection (MoE)",
    desc: "Consumer complaints",
    url: "https://www.moec.gov.ae",
    country: "AE",
    category: "consumer",
    kind: "gov",
  },

  // ================= CANADA =================
  {
    id: "ca-portal",
    name: "Canada.ca",
    desc: "All Canadian government services",
    url: "https://www.canada.ca",
    country: "CA",
    category: "national",
    kind: "gov",
  },
  {
    id: "ca-cra",
    name: "CRA",
    desc: "Canada Revenue Agency",
    url: "https://www.canada.ca/en/revenue-agency.html",
    country: "CA",
    category: "tax",
    kind: "gov",
  },
  {
    id: "ca-passport",
    name: "Canadian Passports",
    desc: "Apply & renew",
    url: "https://www.canada.ca/en/services/canadian-passports.html",
    country: "CA",
    category: "passport",
    kind: "gov",
  },
  {
    id: "ca-health",
    name: "Health Canada",
    desc: "Health services & coverage",
    url: "https://www.canada.ca/en/health-canada.html",
    country: "CA",
    category: "health",
    kind: "gov",
  },
  {
    id: "ca-benefits",
    name: "Benefits",
    desc: "EI, pensions & benefits finder",
    url: "https://www.canada.ca/en/services/benefits.html",
    country: "CA",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "ca-business",
    name: "Business Canada",
    desc: "Start & grow a business",
    url: "https://www.canada.ca/en/services/business.html",
    country: "CA",
    category: "business",
    kind: "gov",
  },

  // ================= AUSTRALIA =================
  {
    id: "au-portal",
    name: "Australia.gov.au",
    desc: "Australian government portal",
    url: "https://www.australia.gov.au",
    country: "AU",
    category: "national",
    kind: "gov",
  },
  {
    id: "au-mygov",
    name: "myGov",
    desc: "One login for government services",
    url: "https://my.gov.au",
    country: "AU",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "au-ato",
    name: "ATO",
    desc: "Australian Taxation Office",
    url: "https://www.ato.gov.au",
    country: "AU",
    category: "tax",
    kind: "gov",
  },
  {
    id: "au-passport",
    name: "Australian Passport Office",
    desc: "Apply & renew",
    url: "https://www.passports.gov.au",
    country: "AU",
    category: "passport",
    kind: "gov",
  },
  {
    id: "au-health",
    name: "Services Australia — Medicare",
    desc: "Health cover & claims",
    url: "https://www.servicesaustralia.gov.au/medicare",
    country: "AU",
    category: "health",
    kind: "gov",
  },
  {
    id: "au-centrelink",
    name: "Centrelink",
    desc: "Payments & services",
    url: "https://www.servicesaustralia.gov.au/centrelink",
    country: "AU",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "au-abr",
    name: "ABR",
    desc: "Australian Business Register",
    url: "https://www.abr.gov.au",
    country: "AU",
    category: "business",
    kind: "gov",
  },
  {
    id: "au-scamwatch",
    name: "Scamwatch",
    desc: "Report scams (ACCC)",
    url: "https://www.scamwatch.gov.au",
    country: "AU",
    category: "police",
    kind: "gov",
  },
  {
    id: "au-aec",
    name: "AEC",
    desc: "Australian Electoral Commission",
    url: "https://www.aec.gov.au",
    country: "AU",
    category: "elections",
    kind: "gov",
  },

  // ================= SINGAPORE =================
  {
    id: "sg-portal",
    name: "gov.sg",
    desc: "Singapore government portal",
    url: "https://www.gov.sg",
    country: "SG",
    category: "national",
    kind: "gov",
  },
  {
    id: "sg-singpass",
    name: "Singpass",
    desc: "National digital identity",
    url: "https://www.singpass.gov.sg",
    country: "SG",
    category: "digitalid",
    kind: "gov",
  },
  {
    id: "sg-iras",
    name: "IRAS",
    desc: "Inland Revenue Authority",
    url: "https://www.iras.gov.sg",
    country: "SG",
    category: "tax",
    kind: "gov",
  },
  {
    id: "sg-onemotoring",
    name: "OneMotoring (LTA)",
    desc: "Driving & vehicle services",
    url: "https://onemotoring.lta.gov.sg",
    country: "SG",
    category: "driving",
    kind: "gov",
  },
  {
    id: "sg-healthhub",
    name: "HealthHub",
    desc: "National health services",
    url: "https://www.healthhub.gov.sg",
    country: "SG",
    category: "health",
    kind: "gov",
  },
  {
    id: "sg-cpf",
    name: "CPF Board",
    desc: "Central Provident Fund",
    url: "https://www.cpf.gov.sg",
    country: "SG",
    category: "welfare",
    kind: "gov",
  },
  {
    id: "sg-acra",
    name: "ACRA",
    desc: "Business registration",
    url: "https://www.acra.gov.sg",
    country: "SG",
    category: "business",
    kind: "gov",
  },
  {
    id: "sg-police",
    name: "Singapore Police Force",
    desc: "Reports & e-services",
    url: "https://www.police.gov.sg",
    country: "SG",
    category: "police",
    kind: "gov",
  },
  {
    id: "sg-eld",
    name: "Elections Department",
    desc: "Voter services",
    url: "https://www.eld.gov.sg",
    country: "SG",
    category: "elections",
    kind: "gov",
  },
  {
    id: "sg-moe",
    name: "MOE",
    desc: "Ministry of Education",
    url: "https://www.moe.gov.sg",
    country: "SG",
    category: "education",
    kind: "gov",
  },
];
