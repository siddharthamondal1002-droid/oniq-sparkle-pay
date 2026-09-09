// Privacy contacts — configuration, never hardcoded inside a component.
// Change the officer here and every surface (notice, Settings → Privacy,
// grievance form) updates.

export const GRIEVANCE_OFFICER = {
  name: "Pooja Biswas",
  role: "Grievance Officer & Data Protection Officer",
  // DPDP requires a MEANS OF CONTACT, not just a name. This monitored role
  // address is that means; it must stay reachable.
  email: "grievance@oniqhub.com",
  // DPDP's "means of contacting" requirement is satisfied by the email alone.
  // No phone number is published by choice — fewer public contact points, and
  // the role address survives the officer changing hands.
} as const;

/** Regulator of last resort for the DPDP Act, 2023. */
export const DATA_PROTECTION_BOARD = {
  name: "Data Protection Board of India",
  url: "https://www.meity.gov.in/data-protection-framework",
  note: "You may complain to the Board if ONIQ does not resolve your grievance.",
} as const;

/**
 * The health-AI sentences of the public privacy notice — owner directive,
 * 2026-09-09, verbatim. They replaced "Health data is never sent to any AI
 * feature", which Phase 2's synthetic gateway did not contradict but the
 * Health AI pathway will. The notice renders the text INLINE so it stays in
 * the privacy route chunk the bundle check reads; this constant is what the
 * tests, the health consent screen's default text and
 * scripts/health-bundle-markers.ts compare against, and
 * src/health/__tests__/privacyDisclosure.test.ts pins every copy equal.
 *
 * This is the privacy DISCLOSURE. It is not the consent sentence: the
 * `ai_interpretation` consent text (`health.consent.ai` in src/health/i18n.ts,
 * terms version `health-ai-terms-v1`) stays a counsel-review placeholder
 * (docs/health/04 D3), and nothing here claims legal approval for it.
 */
export const HEALTH_AI_PRIVACY_SENTENCES = [
  "Health data may be processed by ONIQ's AI-assisted health features when you choose to use them and provide the required consent.",
  "AI-assisted features are subject to ONIQ's privacy, security, consent, audit, and safety controls.",
] as const;
export const HEALTH_AI_PRIVACY_STATEMENT = HEALTH_AI_PRIVACY_SENTENCES.join(" ");
