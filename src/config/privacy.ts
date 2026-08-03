// Privacy contacts — configuration, never hardcoded inside a component.
// Change the officer here and every surface (notice, Settings → Privacy,
// grievance form) updates.

export const GRIEVANCE_OFFICER = {
  name: "Pooja Biswas",
  role: "Grievance Officer & Data Protection Officer",
  // DPDP requires a MEANS OF CONTACT, not just a name. This monitored role
  // address is that means; it must stay reachable.
  email: "grievance@oniqhub.com",
  // TODO(legal): replace with the officer's real published telephone number.
  // DPDP is satisfied by the email above, so this is not a compliance gap —
  // but until a number is filled in, do not present this string as a phone
  // contact anywhere in the UI.
  phone: "+91 — available on written request",
  address: "ONIQ Hub, India",
} as const;

/** Regulator of last resort for the DPDP Act, 2023. */
export const DATA_PROTECTION_BOARD = {
  name: "Data Protection Board of India",
  url: "https://www.meity.gov.in/data-protection-framework",
  note: "You may complain to the Board if ONIQ does not resolve your grievance.",
} as const;
