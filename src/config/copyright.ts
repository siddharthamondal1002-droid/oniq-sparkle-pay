// Copyright / safe-harbour configuration.
//
// Separate from src/config/privacy.ts on purpose: that file is the DPDP
// grievance channel and is frozen. This one is the copyright channel, which is
// a different legal regime, a different statutory clock, and — in the US — a
// different named agent.
//
// ONIQ is an information-location tool: it stores pointers, not content. That
// is what the three harbours below are written for.

/**
 * US — 17 U.S.C. §512(c)(2).
 *
 * READ THIS BEFORE CHANGING `registeredWithCopyrightOffice`.
 *
 * Safe harbour requires an agent designated **with the U.S. Copyright Office**
 * at dmca.copyright.gov ($6, renewable every 3 years). Nothing else counts. A
 * third-party "DMCA compliant" badge from a private vendor such as dmca.com is
 * a deterrent product, not a designation, and confers no §512 protection —
 * a provider that never registered has no harbour no matter how good its
 * policy is (BWP Media v. Hollywood Fan Sites; Oppenheimer v. Allvoices).
 *
 * While this is false, the policy page says so plainly rather than implying a
 * protection ONIQ does not have.
 */
export const DMCA_AGENT = {
  registeredWithCopyrightOffice: false,
  /** Set when the Copyright Office registration completes. */
  registrationDate: null as string | null,
  /** §512 designations lapse after 3 years. An expired one voids immunity. */
  renewalDueDate: null as string | null,
  name: "ONIQ Copyright Agent",
  email: "copyright@oniqhub.com",
  directoryUrl: "https://dmca.copyright.gov/osp/",
} as const;

/**
 * §512(i)(1)(A) conditions the harbour on a repeat-infringer policy that is
 * "reasonably implemented" — courts have denied safe harbour to services that
 * published a policy and never applied it (Capitol Records v. Escape Media;
 * BMG v. Cox). The counter below is enforced in the database, not just here.
 */
export const REPEAT_INFRINGER = {
  /** Substantiated, un-retracted strikes before termination. */
  strikesBeforeTermination: 3,
  /** Strikes older than this stop counting toward termination. */
  strikeWindowDays: 365,
} as const;

/** India — IT Act s.79 read with the IT Rules 2021. Both clocks are statutory. */
export const IN_INTERMEDIARY = {
  acknowledgeWithinHours: 24,
  resolveWithinDays: 15,
  /** Rule 3(1)(j): removed content and its records are kept 180 days. */
  takedownRetentionDays: 180,
  /**
   * Significant Social Media Intermediary threshold. Above 50 lakh registered
   * users a much heavier compliance regime attaches (Chief Compliance Officer,
   * nodal contact, monthly reporting). ONIQ is far below it; the count is
   * instrumented so the crossing is never a surprise.
   */
  ssmiUserThreshold: 5_000_000,
} as const;

/** UK — reg. 19 of the E-Commerce Regulations 2002 (hosting defence). */
export const UK_HOSTING = {
  /** No general monitoring duty; the defence turns on acting once on notice. */
  proactiveMonitoring: false,
} as const;

/** Service-provider identifying information (UK reg. 6 requires it published). */
export const SERVICE_PROVIDER = {
  serviceName: "ONIQ",
  site: "https://oniqhub.com",
  contactEmail: "hello@oniqhub.com",
} as const;
