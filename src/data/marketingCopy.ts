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
import { APP_REGISTRY } from "@/data/appRegistry";

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
  badge: "Get it on Google Play",
  /**
   * The app published to Google Play on 18 Aug 2026, so "Now in early access"
   * became false the moment it shipped. The badge now links to the listing.
   */
  playUrl: "https://play.google.com/store/apps/details?id=com.oniqhub.app",
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
 * Counted from the registry, minus entries that are present in data but never
 * rendered. The site said "25+" while the registry held far more — an
 * understatement is still an uncounted number.
 *
 * This count moves on its own when a `hidden` flag flips, which is the whole
 * design: unhiding `oniq-upi` on 2026-09-06 raised it by one without anybody
 * editing a number. The previous version of this comment named oniq-upi as the
 * hidden entry and went stale the moment that changed — so it names none now.
 */
export const MINI_APPS_LIVE = APP_REGISTRY.filter((a) => !a.hidden).length;

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
    // VERIFIED 2026-08-19: estimate-fares returns low–high ranges from a
    // static rate card, not live provider quotes, and booking is a hand-off to
    // the provider's own app. "Compare ride prices" claimed live pricing.
    copy: "Fare estimates across providers, then open the right app to book.",
    status: "live",
    route: "/app/rides",
  },
  {
    title: "Wanderlust",
    // VERIFIED 2026-08-19: only hotels are price-compared live (hotel-scout
    // web search). Buses, trains, flights and ferries are a curated directory
    // of provider links plus deep-link search hand-offs.
    copy: "Live hotel price comparison, plus bus, train and flight sites in one hub.",
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

  // SCAN & PAY IS OFF THE DECK — owner directive, 2026-09-06 (evening): "hide
  // upi". It reverses that morning's "make upi active again", and the flag has
  // now moved four times.
  //
  // REMOVED RATHER THAN MARKED "soon", because "soon" would be a lie in the
  // other direction. The screen exists and works; what fails is the hand-off
  // to the UPI app, measured across PhonePe, Google Pay and Paytm. A card
  // saying "coming soon" advertises a thing that is already built, and this
  // deck's whole rule is that the site, the listing and the app agree about
  // what a person can actually do. Absent is the only honest status, and
  // `CardStatus` has no third value by design.
  //
  // `marketingCopy.test.ts` derives `siteOffers` from this card's status, so
  // removing it makes that false and the symmetry with `oniq-upi`'s
  // `hidden: true` holds with no edit to the agreement test itself.

  // ---- Coming soon --------------------------------------------------------
  // These must LOOK different — dimmed, badged, not clickable. A card that
  // looks live and isn't is worse than no card, and worst of all for payments.
  //
  // STILL NO "Receive" CARD, and that is not an oversight. There is no receive
  // route — `src/routes/_authenticated/` holds `app.upi.tsx` and `app.scan.tsx`
  // and nothing else — and a card for a screen that does not exist is exactly
  // what this file exists to catch. It went out alongside Scan & Pay in August
  // and does not come back with it.
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
  // CORRECTED 2026-09-03. This line used to say Watch was removed entirely,
  // which stopped being true on 2026-08-16 (owner directive: the channel
  // player came back, India only) and is further from true now that Watch
  // carries a personal library — saved references across YouTube, Vimeo,
  // Nebula and the Internet Archive with progress, collections, threads and
  // notes (owner mission, 2026-09-03). What is still true, and still the
  // rule: Watch is NOT advertised on the listing. No card, no screenshot, no
  // live-TV or streaming wording, no claim about anybody else's catalogue.
  // ONIQ is an independent organisation layer over links people save;
  // playback is each platform's own player, and the listing says nothing
  // that a reviewer could read as ONIQ offering third-party video.
  "Watch — in the app for India only, and deliberately NOT advertised: no card, no screenshot, no live-TV or streaming wording. It is a personal library over links the person saves, played in each platform's own player; the listing makes no claim about third-party video.",
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

/**
 * AI DISCLOSURE.
 *
 * The site sold Ting and Scout without ever saying an AI was involved, while
 * the app itself labels generated output and carries a report control. The
 * four clauses below each map to something shipped: Ting's live web search,
 * the AI label and in-app report control on every declared AI surface (see
 * src/config/playCompliance.ts), and the reports table behind them.
 */
export const AI_DISCLOSURE = {
  heading: "Where AI is involved",
  points: [
    "Ting answers using live web search, and shows its sources.",
    "AI-generated media in the app is labelled as AI-generated.",
    "You can report any AI answer or generated item from the screen it appears on.",
    "AI can be wrong. Check anything that matters — money, health, law or exams.",
  ],
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

GET AROUND — Fare estimates across ride providers before you open their app, and Wanderlust for live hotel price comparison plus bus, train and flight sites in one hub.

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
    "No Watch player, channel grid or library screenshot — Watch is India-only and not advertised; a screenshot of another platform's player in ONIQ reads as ONIQ offering that platform's video.",
    "No Glance card — the surface is gone.",
    "NO Scan & Pay screenshot, and no Receive tile — owner directive 2026-09-06 (evening) hid UPI again after all three UPI apps declined the hand-off. A screenshot of a payment tile the app no longer opens is exactly what once shipped on the live listing. This rule has now flipped four times; check src/data/appRegistry.ts (whether oniq-upi carries hidden) for what is true on the day rather than trusting this sentence.",
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
    "Data safety must NOT declare Financial info, and UPI coming back does not change that — which is the point worth understanding rather than re-deriving. ONIQ COLLECTS nothing financial: the UPI hand-off builds an intent URL and gives it to the user's own GPay/PhonePe/Paytm, so the payment happens entirely inside that app and no card number, VPA balance or purchase history ever reaches ONIQ. Razorpay for food orders is likewise a hosted checkout in its own frame. Declaring Financial info would put the listing in Play's payments bucket for data ONIQ does not hold. If a future change ever stores a VPA, an amount or a transaction record, this line stops being true and Data safety must be updated first.",
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
  // Watch library, 2026-09-03: claims that would read as infringement or as
  // ONIQ offering other platforms' catalogues. ONIQ downloads nothing and
  // hosts nothing; it organises links the person saves.
  "download any video",
  "download youtube videos",
  "watch anything for free",
  "free movies from anywhere",
  "access paid content for free",
  "guaranteed",
  "ats-optimised",
  "ats-optimized",
  "is endorsed by",
  "officially endorsed",
  "officially approved",
  "official partner",
] as const;
