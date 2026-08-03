// Privacy contacts — configuration, never hardcoded inside a component.
// Change the officer here and every surface (notice, Settings → Privacy,
// grievance form) updates.

export const GRIEVANCE_OFFICER = {
  name: "Siddhartha Mondal",
  role: "Grievance Officer & Data Protection Officer",
  email: "grievance@oniqhub.com",
  phone: "+91 — available on written request",
  address: "ONIQ Hub, India",
} as const;

/** Regulator of last resort for the DPDP Act, 2023. */
export const DATA_PROTECTION_BOARD = {
  name: "Data Protection Board of India",
  url: "https://www.meity.gov.in/data-protection-framework",
  note: "You may complain to the Board if ONIQ does not resolve your grievance.",
} as const;
