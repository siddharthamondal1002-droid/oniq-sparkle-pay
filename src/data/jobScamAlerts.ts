// ONIQ — Free & Legal Surfaces loop, Phase 4: job-scam alerts.
//
// The strongest surface in this loop. Every market has an authoritative
// government source, factual public-interest safety guidance is reusable with
// attribution, and there is no licence to buy anywhere in it.
//
// WHAT IS AND IS NOT COPIED
//
// The warnings below are ONIQ's own words, written from official advisories.
// Government datasets are NOT re-hosted — several are not openly licensed, and
// re-hosting is the one thing that would move ONIQ from referencing to
// republishing. Each warning carries the source it was written from and a link
// to it, so a reader can check ONIQ against the original.
//
// AXIS: CURRENT REGION. A reporting number has to be the one that works from
// where the user is standing. An Indian user in Dubai who is being scammed
// needs Dubai Police eCrime, not 1930 — 1930 will not help them today.
// Contrast markets, which follow Home.

import type { Country } from "@/data/appRegistry";

export type ReportingChannel = {
  name: string;
  /** Tap-to-call. Digits only, no spaces — same convention as crisisLines. */
  phone?: string;
  url?: string;
  note?: string;
};

export type ScamSource = {
  /** The authority the warning was written from. */
  authority: string;
  url: string;
};

/**
 * The single most useful sentence on the surface. Every task-scam and
 * advance-fee job scam breaks this rule, and it is short enough to remember
 * at the moment it matters.
 */
export const LEAD_WARNING = "No legitimate employer ever charges you to get paid.";

export type ScamPattern = {
  id: string;
  title: string;
  /** Ordered — this is how the scam actually unfolds. */
  steps: string[];
  tell: string;
};

/**
 * Task scams went from effectively zero in 2020 to roughly 20,000 reports in
 * the first half of 2024 alone, and they target exactly this age group. The
 * steps are the sequence, in order, because recognising step 3 is what saves
 * someone at step 5.
 */
export const SCAM_PATTERNS: ScamPattern[] = [
  {
    id: "task-scam",
    title: "The “task” or “product boosting” job",
    steps: [
      "An unsolicited WhatsApp or Telegram message from a “recruiter” you never contacted.",
      "Vague work — “app optimisation”, “product boosting”, “review tasks”. Nobody explains what the job actually is.",
      "A dashboard shows your earnings climbing. The numbers are not real.",
      "You are paid a small amount early on, so the next ask feels safe.",
      "Then you must deposit your own money — often crypto — to “unlock” a withdrawal. That money is gone.",
    ],
    tell: "The moment you are asked to pay to get paid, it is a scam. Stop and report it.",
  },
  {
    id: "fake-offer-fee",
    title: "The offer that needs a fee first",
    steps: [
      "A job offer arrives without a real interview, or after a chat-only “interview”.",
      "Before you start, there is a fee: registration, training, a security deposit, equipment, a visa or a background check.",
      "You are pushed to pay quickly, often to a personal account or UPI ID.",
    ],
    tell: "Employers pay you. Recruitment fees are illegal in most of these markets.",
  },
  {
    id: "identity-harvest",
    title: "The “onboarding” that only wants your documents",
    steps: [
      "You are hired fast, with no real assessment.",
      "“Onboarding” asks for your ID, bank details, PAN/SSN/NRIC or a selfie holding your ID — before any contract.",
      "The employer cannot be found at a real registered address or on any official register.",
    ],
    tell: "Give documents to an employer you have verified, never to one that found you.",
  },
];

/**
 * Where to report, per country. These are the channels that actually act.
 * Numbers are digits-only for tap-to-call.
 */
export const REPORTING: Record<Country, ReportingChannel[]> = {
  IN: [
    { name: "Cybercrime helpline", phone: "1930", note: "financial fraud · act fast, the first hours matter" },
    { name: "National Cyber Crime Reporting Portal", url: "https://cybercrime.gov.in" },
  ],
  US: [
    { name: "FTC — ReportFraud", url: "https://reportfraud.ftc.gov" },
    { name: "FBI IC3", url: "https://www.ic3.gov" },
  ],
  GB: [
    { name: "Action Fraud", url: "https://www.actionfraud.police.uk" },
    { name: "Action Fraud phone", phone: "03001232040" },
  ],
  CA: [
    { name: "Canadian Anti-Fraud Centre", url: "https://antifraudcentre-centreantifraude.ca" },
    { name: "Canadian Anti-Fraud Centre phone", phone: "18884953501" },
  ],
  AU: [{ name: "Scamwatch (NASC)", url: "https://www.scamwatch.gov.au" }],
  SG: [
    { name: "ScamShield helpline", phone: "1799" },
    { name: "ScamShield", url: "https://www.scamshield.gov.sg" },
  ],
  AE: [
    { name: "Dubai Police eCrime", url: "https://www.ecrime.ae" },
    { name: "Abu Dhabi Aman", phone: "8002626" },
  ],
};

/** The advisory each country's guidance was written from. Attribution, not decoration. */
export const SOURCES: Record<Country, ScamSource> = {
  IN: { authority: "Indian Cyber Crime Coordination Centre (I4C)", url: "https://cybercrime.gov.in" },
  US: { authority: "US Federal Trade Commission", url: "https://consumer.ftc.gov/articles/job-scams" },
  GB: { authority: "Action Fraud (City of London Police)", url: "https://www.actionfraud.police.uk" },
  CA: { authority: "Canadian Anti-Fraud Centre", url: "https://antifraudcentre-centreantifraude.ca" },
  AU: { authority: "Scamwatch, National Anti-Scam Centre", url: "https://www.scamwatch.gov.au" },
  SG: { authority: "ScamShield / Singapore Police Force", url: "https://www.scamshield.gov.sg" },
  AE: { authority: "Dubai Police eCrime", url: "https://www.ecrime.ae" },
};

/**
 * Reporting channels for where the user physically is. Falls back to `home`
 * when the region is unknown — an out-of-date number is worse than a
 * home-country one, but no number at all is worst.
 */
export function reportingFor(region: Country | null, home: Country | null): ReportingChannel[] {
  const c = region ?? home;
  return c ? (REPORTING[c] ?? []) : [];
}

export function sourceFor(region: Country | null, home: Country | null): ScamSource | null {
  const c = region ?? home;
  return c ? (SOURCES[c] ?? null) : null;
}
