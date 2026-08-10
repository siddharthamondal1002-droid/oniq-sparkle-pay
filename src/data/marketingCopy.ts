// ONIQ — public marketing copy, in code so it can be tested.
//
// WHY THIS IS A DATA FILE AND NOT JSX
//
// Three surfaces make claims about ONIQ: the website, the Play listing, and
// the app itself. They drift. Twice now a feature was removed and its
// marketing stayed — Watch was advertised on the landing page after the
// surface was deleted, and before that the site sold "live TV" for a week
// after the streams came out. Both times the copy was buried in JSX where
// nothing could check it.
//
// So the copy lives here, every card names the route it maps to, and the tests
// in src/data/__tests__/marketingCopy.test.ts assert that the route exists.
// Deleting a surface now breaks the build until its copy goes too.
//
// THE RULE
//
// Every claim maps to a shipped, reachable feature. Anything else is
// explicitly `status: "soon"` or absent entirely. No live TV. No third-party
// logos. No "guaranteed", "official", "endorsed" or "ATS-optimised".

import { LANGUAGE_COUNT } from "@/data/languages";

export type CardStatus = "live" | "soon";

export type FeatureCard = {
  title: string;
  copy: string;
  status: CardStatus;
  /**
   * The route this card promises. Tested to exist for every `live` card — a
   * card that leads nowhere is the failure mode this file exists to prevent.
   * `null` only for `soon` cards, which promise nothing yet.
   */
  route: string | null;
  /** Rendered on the card itself, not only enforced inside the app. */
  adultOnly?: boolean;
};

export const HERO = {
  badge: "Now in early access",
  titleTop: "ONE APP.",
  titleBottom: "EVERY WORLD.",
  body: "Chat with voice and video, study for your boards, compare rides and travel, learn a language, and ask an AI that actually knows what's happening now. One beautifully fast app.",
  primaryCta: "Create your account",
  secondaryCta: "Explore worlds",
  returning: "Already have an account?",
} as const;

/**
 * Every number here is counted, not inherited.
 *
 * "12 worlds" survived two surface removals unchanged, which is how a stat
 * becomes a lie by attrition. WORLDS_LIVE is derived from FEATURE_CARDS below
 * rather than typed, so it cannot drift again.
 */
export const COUNTRIES_SUPPORTED = 7;

/**
 * Derived, not typed. This said a flat 25 while the picker offered 25 — but
 * the AI could only answer in 13 of them, and when the list grew the number
 * would have been wrong in the other direction. It now counts the registry.
 */
export const SCOUT_LANGUAGES = LANGUAGE_COUNT;

export const FEATURE_CARDS: FeatureCard[] = [
  // ---- Live ---------------------------------------------------------------
  {
    title: "Chat",
    copy: "Real-time messaging with voice and video calls.",
    status: "live",
    route: "/app/chat",
  },
  {
    title: "Moments",
    copy: "A private social feed for you and your circle.",
    status: "live",
    route: "/app/chat/moments",
  },
  {
    title: "Mast",
    copy: "Short videos in a swipeable feed.",
    status: "live",
    route: "/app/chat/reels",
  },
  {
    title: "Study",
    copy: "Question papers for your board and class, ready to print.",
    status: "live",
    route: "/app/study",
  },
  {
    title: "Campus",
    copy: "Admissions routes, deadlines, and study notes for IELTS, TOEFL and PTE.",
    status: "live",
    route: "/app/university",
  },
  {
    title: "Rides",
    copy: "Compare ride prices across providers before you book.",
    status: "live",
    route: "/app/rides",
  },
  {
    title: "Wanderlust",
    copy: "Compare buses, trains, flights and hotels in one hub.",
    status: "live",
    route: "/app/travel",
  },
  {
    title: "Ting AI",
    copy: "A live-web assistant that actually answers what's happening now.",
    status: "live",
    route: "/app/ai",
  },
  {
    title: "Scout",
    copy: `A ${LANGUAGE_COUNT}-language translator, plus Bengali lessons in ONIQ Learn.`,
    status: "live",
    route: "/app/learn",
  },
  {
    title: "Blessed",
    copy: "Daily readings, festivals and calendars for your tradition.",
    status: "live",
    route: "/app/faith",
  },
  {
    title: "Vitals",
    copy: "Sleep, mood and cycle tracking, readable only by you.",
    status: "live",
    route: "/app/vitals",
  },
  {
    title: "Plug",
    copy: "The apps you actually need — different in every country.",
    status: "live",
    route: "/app/miniapps",
  },
  {
    title: "Pulse",
    copy: "Headlines from your country, straight to the source.",
    status: "live",
    route: "/app/news",
  },
  {
    title: "Official",
    copy: "Government services and visa portals. Verified links only.",
    status: "live",
    route: "/app/official",
  },
  { title: "Earn", copy: "Ways to earn, listed by country.", status: "live", route: "/app/earn" },
  // The copy deck marked Jobs and Campus "coming soon". Both ship: Jobs is on
  // the home grid behind the 18+ gate with the CV builder and the job & gig
  // directory as tabs, and Campus carries the admissions routes plus the new
  // English-test notes. Listing them as soon would break the deck's own rule
  // that the site, the listing and the app must agree — the app would be
  // offering a feature the site says is not out yet. So they are live here.
  {
    title: "Jobs",
    copy: "Tailor your CV to a role and find where to apply.",
    status: "live",
    route: "/app/jobs",
    adultOnly: true,
  },

  // ---- Coming soon --------------------------------------------------------
  // These must LOOK different — dimmed, badged, not clickable. A card that
  // looks live and isn't is worse than no card, and worst of all for payments.
  //
  {
    title: "Scan & Pay",
    copy: "Scan any UPI QR — payments run through your own UPI apps.",
    status: "live",
    route: "/app/upi",
  },
  {
    title: "Receive",
    copy: "Show your own QR and get paid.",
    status: "live",
    route: "/app/upi",
  },
];

/** Counted from the cards, so the stat can never outlive the feature. */
export const WORLDS_LIVE = FEATURE_CARDS.filter((c) => c.status === "live").length;

/**
 * SHOP is deliberately absent.
 *
 * It was a card in the copy deck, but there is no Shop surface — shopping,
 * beauty and fashion are categories inside Plug, not a destination. A card
 * promising a screen that does not exist is exactly what this file is for
 * catching, so it is not listed rather than listed and stubbed.
 */
export const DELIBERATELY_ABSENT = [
  "Shop — a Plug category, not a surface of its own.",
  "Watch — removed from the app entirely. Not 'coming soon': there is no narrower version planned, and a permanent coming-soon card is a promise nobody is keeping.",
  "Glance — removed from the app entirely.",
] as const;

/**
 * THE PRIVACY BAND.
 *
 * The version in the copy deck said health logs were "encrypted on your device.
 * Not on our servers." That was false: app.vitals.tsx writes mood, sleep and
 * cycle logs to Postgres, and those tables hold real rows. Shipping it would
 * have put a false statement about sensitive personal data on the front page,
 * and a matching false Play Data safety declaration behind it.
 *
 * Every clause below is checkable. The safety plan really is device-only
 * (localStorage, oniq.safetyplan.v1). Row-level security really is enforced in
 * Postgres. The export and deletion deadline really is 30 days and really is
 * instrumented. See src/config/playCompliance.ts → DATA_COLLECTED.
 */
export const PRIVACY_BAND = {
  heading: "YOUR HEALTH DATA IS YOURS ALONE.",
  body: "Row-level security means nobody but you can read your sleep, mood and cycle logs — enforced in the database, not just the interface. Your safety plan never leaves your phone at all. And you can export or delete everything, with a 30-day deadline we hold ourselves to.",
} as const;

export const NOT_AFFILIATED =
  "ONIQ is not affiliated with, endorsed by, or sponsored by any third-party app, board, university, exchange or bank named in this app. All trademarks belong to their owners.";

/**
 * THE PLAY STORE LISTING.
 *
 * A separate surface with a separate review — Google reviews against the
 * listing, not the website — but it must say the same thing. It lives here so
 * the two cannot drift, and so the tests can hold it to the same banned-claims
 * list as the site.
 *
 * Nothing in the repo publishes this. There is no fastlane config, no
 * metadata/android directory and no Play publishing step in CI: the listing is
 * hand-edited in Play Console. So this is copy to paste, and the screenshots
 * still have to be checked by a human.
 */
export const PLAY_LISTING = {
  /** Play's cap is 80 characters. */
  shortDescription: "Chat, study, travel and ask an AI — one app for every world.",
  fullDescription: `ONIQ brings everyday life into one app.

CHAT — Real-time messaging with voice and video calls, plus Moments for your circle and Mast for short videos.

STUDY — Question papers for your board and class, ready to print. Campus adds admissions routes, deadlines and study notes for IELTS, TOEFL and PTE.

GET AROUND — Compare ride prices across providers before you book, and compare buses, trains, flights and hotels in Wanderlust.

ASK — Ting is a live-web AI assistant that answers what's happening now. Scout translates across ${SCOUT_LANGUAGES} languages.

EVERYDAY — Pulse for headlines straight to the source, Official for government services and visa portals, Blessed for daily readings and festivals, Plug for the apps that matter in your country, and Vitals for sleep, mood and cycle tracking.

YOUR DATA
Row-level security means nobody but you can read your health logs — enforced in the database, not just the interface. Your safety plan never leaves your phone. You can export or delete everything, and we hold ourselves to a 30-day deadline.

ONIQ works across ${COUNTRIES_SUPPORTED} countries and adapts to yours: currency, emergency numbers, government links and legal regime all follow where you are.

ONIQ is not affiliated with, endorsed by, or sponsored by any third-party app, board, university, exchange or bank named in the app. All trademarks belong to their owners.`,
  /**
   * Checked by a human before each release. Listed here because the screenshot
   * set is the part of the listing most likely to still show a removed
   * feature, and the least likely to be looked at.
   */
  screenshotChecklist: [
    "No Watch player or channel grid — the surface is gone.",
    "No Glance card — the surface is gone.",
    "Scan & Pay, Receive and the payment tile MAY now be shown — oniq-upi is visible and /app/upi is reachable. The old rule was the reverse; it changed when payments were resurfaced, and the screenshot must match whichever is true on the day.",
    "Any checkout screenshot showing a card or netbanking payment is Razorpay against a real-world order. Do not screenshot a payment for anything digital — Play requires Play Billing for that.",
    "No live-TV or streaming wording in any caption or feature graphic.",
    "Category is not Entertainment or Video Players & Editors.",
    "Data safety declares health info as collected — see DATA_COLLECTED in src/config/playCompliance.ts.",
  ],

  /**
   * The Console-side half of the listing — the fields no test can reach,
   * because they live in Play Console rather than in this repo.
   *
   * This exists because the live listing was audited on 2026-08-05 against the
   * declarations above and three things were wrong in Console while being
   * right here. A checklist in the repo is the only place that survives.
   */
  consoleChecklist: [
    "Data deletion: the account-deletion URL must be https://oniqhub.com/delete-account. On 2026-08-05 the store page showed only Play's generic 'developers can provide ways to remove data' boilerplate, which is what renders when no URL is declared — while the route existed and returned 200.",
    "Data safety must NOT declare Financial info. Nothing in this repo collects payment info or purchase history: there is no billing SDK, no Stripe, no Razorpay, no Play Billing, and the UPI surface is hidden. Over-declaring it puts the listing in Play's payments bucket and contradicts the withheld Scan & Pay position.",
    "Security practices: the form asks exactly two questions — encryption in transit, and whether users can request deletion. There is NO 'encrypted at rest' option; an earlier version of this checklist said to tick one, and it does not exist. Answering YES to the deletion question is what both surfaces the 'You can request that data be deleted' line on the listing and prompts for the deletion URL above, so that item and this one are the same form field, not two.",
    "Full description in Console must be pasted from PLAY_LISTING.fullDescription. The live one was older copy and read 'moments,clips' with no space.",
  ],
} as const;

/**
 * Claims that must never appear in public copy.
 *
 * These are AFFIRMATIVE forms on purpose. A first version listed bare
 * "endorsed by", which then flagged ONIQ's own disclaimer — "not affiliated
 * with, endorsed by, or sponsored by" — as a banned claim. Denying an
 * endorsement is the opposite of claiming one, and a check that cannot tell
 * them apart pushes you to delete the disclaimer to make the test pass.
 */
export const BANNED_CLAIMS = [
  "live tv",
  "tv genres",
  "watch live",
  "guaranteed",
  "ats-optimised",
  "ats-optimized",
  "is endorsed by",
  "officially endorsed",
  "officially approved",
  "official partner",
] as const;
