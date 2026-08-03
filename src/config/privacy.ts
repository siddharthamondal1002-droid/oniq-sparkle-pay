// Privacy contacts — configuration, never hardcoded inside a component.
// Change the officer here and every surface (notice, Settings → Privacy,
// grievance form) updates.

export const GRIEVANCE_OFFICER = {
  name: "Pooja Biswas",
  role: "Grievance Officer & Data Protection Officer",
  // DPDP requires a MEANS OF CONTACT, not just a name. This monitored role
  // address is that means; it must stay reachable.
  email: "grievance@oniqhub.com",
  /** E.164 — the dialable value behind every tel: link. */
  phone: "+917980732371",
  /** Human-readable rendering of the same number. Latin digits in every locale. */
  phoneDisplay: "+91 79807 32371",
} as const;

/** Regulator of last resort for the DPDP Act, 2023. */
export const DATA_PROTECTION_BOARD = {
  name: "Data Protection Board of India",
  url: "https://www.meity.gov.in/data-protection-framework",
  note: "You may complain to the Board if ONIQ does not resolve your grievance.",
} as const;
