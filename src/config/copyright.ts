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
 * The policy page tracks this flag in both directions: while it is false it
 * says plainly that ONIQ has no such designation rather than implying a
 * protection it does not have, and while it is true it publishes the agent
 * block below. Neither state is allowed to be vague.
 *
 * STATE AS OF 2026-08-05 — ACTIVE
 *
 * Registration number DMCA-1077456, Pay.gov tracking 284QU5S7, fee paid, and
 * the directory now reports Status: Active, Effective August 5 2026 to
 * Present. Active is the Office's word for "the service provider's current
 * designation" — the record is in the public directory. So the flag is true,
 * and leaving it false would have understated ONIQ's position rather than
 * overstating it, which is the opposite error but still an inaccurate page.
 *
 * TWO DEFECTS ON THE REGISTER ITSELF, NOT YET AMENDED
 *
 * Both are confirmed by the Office's own confirmation email, not only by the
 * directory's rendering, so neither is a misread.
 *
 *  1. The agent's phone is recorded as "+7980732371". 7980732371 is a valid
 *     ten-digit Indian mobile with the +91 dropped, and written with a bare
 *     "+" it parses as a RUSSIAN number. Anyone dialling it reaches nothing.
 *     This file publishes the reachable form, +917980732371, because
 *     publishing an unreachable number to satisfy a byte-match with a typo
 *     would serve nobody. Amend the register so the two agree.
 *
 *     This is the urgent one. The confirmation email states that everything
 *     EXCEPT the service provider's phone and email is publicly viewable —
 *     so the agent's number is precisely the one a rights-holder sees, and
 *     it is the broken one.
 *
 *  2. The service provider's phone, "+91877825152", carries nine digits after
 *     the country code where an Indian number has ten. Not published by the
 *     Office and not published here — §512(c)(2) asks for the AGENT's number
 *     — so it is a records defect rather than a reachability one.
 *
 * Also worth amending: the register's alternate names are only "Oniq" and
 * "oniqhub.com". A name not listed is not covered, so the name the app is
 * published under on Google Play belongs in that list too.
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
  registeredWithCopyrightOffice: true,
  /** Effective date of the original designation. */
  registrationDate: "2026-08-05" as string | null,
  /**
   * Effective date of the most recent AMENDMENT, or null if never amended.
   *
   * This is not bookkeeping. The three-year renewal period runs from when the
   * designation was most recently submitted OR amended, and the directory
   * models an amendment as a new dated version — the old one becomes Inactive
   * and the new one becomes Active from its own effective date. So an
   * amendment moves the deadline, and pinning renewal to the original
   * registration date would put the diary entry too early at best and, if a
   * later amendment were ever mistaken for the original, too late.
   *
   * Too late is the one that matters: a lapsed designation voids the harbour
   * and the Office does not warn you.
   */
  lastAmendedDate: null as string | null,
  /** §512 designations lapse after 3 years. An expired one voids immunity. */
  renewalDueDate: "2029-08-05" as string | null,
  /** As issued by the Office. */
  registrationNumber: "DMCA-1077456" as string | null,

  // The four items §512(c)(2)(A) requires to be published, taken from the
  // register. The guard test refuses a claim of registration that leaves any
  // of them unset — an incomplete published block is the failure it exists
  // to prevent, and filing the register entry is exactly the moment this half
  // feels already done.
  /** The agent's name as it appears on the register. */
  agentName: "Pooja Biswas" as string | null,
  /** The agent's postal address as it appears on the register. */
  agentAddress:
    "Oniqhub.com, Sarsuna Housing Estate (near Sarsuna College), H2/44, Kolkata 700061, India" as
      string | null,
  /**
   * E.164, country code included.
   *
   * The register records "+7980732371" — the same digits with +91 dropped,
   * which reads as a Russian number and reaches nobody. Published here in the
   * reachable form. This is the one field that does not byte-match the
   * register, and it is deliberate: amend the register, do not break this.
   */
  agentPhone: "+917980732371" as string | null,

  /**
   * The agent mailbox ON THE REGISTER. Published verbatim, because a
   * rights-holder comparing the site against the register must find the same
   * answer.
   *
   * It is an ALIAS of `email` below, with forwarding active — not a separate
   * personal inbox. So the usual objection to a named-individual address on a
   * §512 register does not apply here: notices do not depend on one person
   * reading their own mail, and they survive a staffing change, because they
   * land in the role mailbox either way. No amendment to the register is
   * needed on this account.
   *
   * The obligation that DOES follow: this alias must stay alive and forwarding
   * for as long as the register names it. A §512 designation that points at a
   * dead address is worse than no designation, because the Office's directory
   * will keep telling rights-holders to write there. If the alias is ever
   * retired, amend the register in the same change.
   */
  agentEmail: "poojabiswas@oniqhub.com" as string | null,

  /**
   * ONIQ's operational notice mailbox, and the destination the alias above
   * forwards to. This is what the rest of the page tells people to write to.
   *
   * Both are published: the register's address so the two records agree, and
   * this one because it is the durable, role-based way in. They are the same
   * mailbox, which is why the page can say a notice to either reaches the
   * agent without that being a hopeful claim.
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
