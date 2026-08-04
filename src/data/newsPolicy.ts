// ONIQ — Free & Legal Surfaces loop, Phase 3: Pulse.
//
// Pulse is publisher-provided RSS, rendered as headline + snippet + source +
// link out. Never the article body, never an ONIQ-written summary of the
// article's claims. A publisher that publishes an open feed is offering it for
// syndication; combined with link-out protection (Crookes v Newton, Svensson)
// that is the lawful backbone of this surface. Restating the claims would be
// adoption, and adoption costs the intermediary position.
//
// THE AXIS
//
// Current Region by default — the news that matters is where you are standing —
// with a Home toggle for diaspora users, who are the reason the toggle exists.
// Both are country codes; neither is a coordinate.
//
// THE ONE HARD BLOCK
//
// The UAE gets NO news feed, in either axis. The 2023/24 Media Law reaches
// foreign apps serving content into the UAE, penalties run to AED 1 million,
// and there is no intermediary safe harbour there to fall back on. Every other
// jurisdiction in this file is a "ship it carefully" call. This one is not:
// for a solo founder the downside is uninsurable, so the capability is simply
// off and the surface says so honestly.

import type { Country } from "@/data/appRegistry";

export type NewsPolicy = {
  /** false => Pulse renders no feed for this country, in either axis. */
  feedEnabled: boolean;
  /** Shown in place of the feed. Honest, not a shrug. */
  unavailableReason?: string;
  /**
   * A statutory correction/removal channel. Singapore's POFMA can direct a
   * correction notice; having the hook already wired is the difference between
   * complying in an hour and complying in a week.
   */
  correctionHook?: { name: string; url: string };
  /** Why this country ships the way it does — kept next to the decision. */
  note: string;
};

export const NEWS_POLICY: Record<Country, NewsPolicy> = {
  IN: {
    feedEnabled: true,
    note:
      "Link-out only, minimal curation. Heavy editorial framing risks pulling ONIQ into the IT Rules 2021 'news aggregator' Ethics Code.",
  },
  US: {
    feedEnabled: true,
    note: "Ships. Bargaining-code style rules target platforms orders of magnitude larger.",
  },
  GB: {
    feedEnabled: true,
    note: "Ships. Press-publisher rights target Google/Meta-scale designations.",
  },
  CA: {
    feedEnabled: true,
    note: "Ships. The Online News Act designation thresholds are far above ONIQ.",
  },
  AU: {
    feedEnabled: true,
    note: "Ships. The News Media Bargaining Code applies to designated platforms only.",
  },
  SG: {
    feedEnabled: true,
    correctionHook: {
      name: "POFMA Office",
      url: "https://www.pofmaoffice.gov.sg",
    },
    note:
      "Ships link-out only. The licensing scheme needs BOTH >=1 SG news article per week AND >=50,000 SG unique IPs per month. Never publishing an ONIQ-authored SG current-affairs article keeps the first limb false permanently.",
  },
  AE: {
    feedEnabled: false,
    unavailableReason:
      "ONIQ doesn't carry a news feed in the UAE. Local media rules reach apps that serve news here, so we'd rather show you nothing than something we can't stand behind.",
    note:
      "HARD OFF. 2023/24 Media Law reaches foreign apps serving content into the UAE, penalties to AED 1M, no intermediary safe harbour. Do not enable without counsel.",
  },
};

/** Whether Pulse may render a feed for a country. Unknown country => allowed. */
export function newsFeedAllowed(country: Country | null | undefined): boolean {
  if (!country) return true;
  return NEWS_POLICY[country]?.feedEnabled ?? true;
}

export function newsUnavailableReason(country: Country | null | undefined): string | null {
  if (!country) return null;
  const p = NEWS_POLICY[country];
  return p && !p.feedEnabled ? (p.unavailableReason ?? "Not available here.") : null;
}

/** Countries where Pulse is switched off. Kept as a list so tests can assert it. */
export const NEWS_BLOCKED_COUNTRIES = (Object.keys(NEWS_POLICY) as Country[]).filter(
  (c) => !NEWS_POLICY[c].feedEnabled,
);
