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
 *
 * STATE AS OF 2026-08-05
 *
 * A designation has been SUBMITTED — registration number DMCA-1077456, fee
 * paid — but the directory reports its status as "Payment Processing", not
 * "Active". The Office's own explanation of that field is unambiguous: only
 * "Active" means the record "is currently available in the public directory".
 * Card payments clear in minutes, ACH in up to seven days. Until the status
 * reads Active there is no public designation, so the flag below stays false.
 *
 * THE SECOND HALF OF §512(c)(2), WHICH IS EASY TO MISS
 *
 * The statute requires the agent's details to be available in TWO places:
 * on the Copyright Office register AND "through its service, including on its
 * website in a location accessible to the public". And it names four items —
 * "the name, address, phone number, and electronic mail address of the agent".
 * Publishing only an email satisfies neither the list nor the second half.
 *
 * So the fields below are what /dmca publishes, and they must match the
 * register entry exactly. A rights-holder who finds one address on the
 * register and a different one on the site has been given two answers to a
 * question the statute expects one answer to.
 */
export const DMCA_AGENT = {
  registeredWithCopyrightOffice: false,
  /** Set when the Copyright Office registration completes. */
  registrationDate: null as string | null,
  /** §512 designations lapse after 3 years. An expired one voids immunity. */
  renewalDueDate: null as string | null,
  /** As issued by the Office, e.g. "DMCA-1077456". Recorded once Active. */
  registrationNumber: null as string | null,

  // The four items §512(c)(2)(A) requires to be published. Each stays null
  // until the designation is Active, and the guard test refuses a claim of
  // registration that leaves any of them unset — an incomplete published
  // block is the failure this is here to prevent.
  /** The agent's name exactly as it appears on the register. */
  agentName: null as string | null,
  /** The agent's postal address exactly as it appears on the register. */
  agentAddress: null as string | null,
  /** E.164, country code included. A bare national number is not reachable. */
  agentPhone: null as string | null,

  /**
   * The published agent mailbox. This must be the address ON THE REGISTER.
   *
   * A role address is preferable to a personal one: the designation outlives
   * whoever currently holds the role, and §512 notices must keep arriving
   * after a staffing change. If the register carries a personal mailbox,
   * amend the register rather than repointing this at an individual.
   */
  email: "copyright@oniqhub.com",
  directoryUrl: "https://dmca.copyright.gov/osp/",
} as const;

/**
 * The DMCA.com subscription — a REAL service, and a different thing entirely.
 *
 * This is deliberately a separate constant from DMCA_AGENT, because conflating
 * the two is the exact mistake the badge invites. Naming it
 * `registeredWithCopyrightOffice` over there and `vendorProtection` here makes
 * it hard to read one as the other.
 *
 * What the subscription actually buys: monitoring for copies of ONIQ's own
 * pages, takedown assistance when one is found, and a hosted case record.
 * ONIQ is the *rights-holder* in that arrangement — it is a tool for
 * protecting ONIQ's material from other people.
 *
 * What it does not buy, and cannot: §512(c) safe harbour. That runs the other
 * way round — it protects a service provider from liability for material its
 * *users* point to — and it comes only from a designation on the Copyright
 * Office register. A private vendor cannot confer it. See DMCA_AGENT.
 */
export const DMCA_PROTECTION = {
  vendorProtection: true,
  vendor: "DMCA.com",
  plan: "Pro",
  /** The public status page the footer badge links to. */
  statusUrl: "https://www.dmca.com/Protection/Status.aspx?ID=1cdf7ab8-a10a-404c-a1f9-7f651e746222",
  /** Verification of site ownership only. Not a §512 designation. */
  siteVerified: true,
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
