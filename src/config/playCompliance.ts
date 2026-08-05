// Google Play policy positions, kept in code so they can be tested rather
// than remembered.
//
// Play is the nearest-term risk in this whole loop — faster and blunter than
// any regulator, and a removal is not appealable on a useful timescale. The
// three policies that actually bite an app shaped like ONIQ are Minimum
// Functionality, AI-Generated Content, and Data safety.

/**
 * MINIMUM FUNCTIONALITY.
 *
 * A directory of links is exactly the shape Play removes as webview spam.
 * ONIQ's defence is that the link-outs sit inside an app that does substantial
 * native work of its own — these are the things that are not links.
 */
export const NATIVE_CAPABILITIES = [
  "Two-axis country model: home country drives identity, currency and legal regime; current region drives emergency numbers, crisis lines and territorial availability.",
  "On-device health data with a region gate — health readings never leave the device.",
  "Hash-chained, append-only consent and audit ledgers with cryptographic verification.",
  "DPDP age gate: is_adult_18 enforced in RESTRICTIVE row-level security, not just in the UI.",
  "Data-subject-request handling with a 30-day SLA, soft delete and a 30-day grace hard purge.",
  "CV builder with anti-fabrication validation against the user's own declared facts.",
  "Country-aware exam-paper generation with vector PDF export.",
  "Real-time chat with WebRTC voice and video.",
  "UPI scan-and-pay through the user's own payment apps.",
  "Job-scam alerts with region-correct reporting channels.",
] as const;

/**
 * AI-GENERATED CONTENT.
 *
 * Play requires generative output to be labelled AND reportable from inside
 * the app. An email address on a policy page does not satisfy it. Every
 * surface here renders AI_OUTPUT_LABEL and an <AiOutputReport />.
 */
export const AI_SURFACES = [
  { id: "cv_ai_output", screen: "Jobs — CV builder", file: "src/routes/_authenticated/app.jobs.tsx" },
  { id: "study_ai_output", screen: "Study Buddy tutor", file: "src/routes/_authenticated/app.study.tsx" },
  { id: "ting_ai_output", screen: "Ting assistant", file: "src/routes/_authenticated/app.ai.tsx" },
] as const;

/**
 * DATA SAFETY.
 *
 * The declaration must match reality. Data that never leaves the device is not
 * "collected" — but anything that does leave has to be listed, including
 * third-party requests made by decorative elements, which is the part people
 * forget.
 */
export type ThirdPartyRequest = {
  host: string;
  triggeredBy: string;
  sends: string;
  purpose: string;
  avoidable: boolean;
};

export const THIRD_PARTY_REQUESTS: ThirdPartyRequest[] = [
  {
    host: "images.dmca.com",
    triggeredBy: "The DMCA.com protection badge in the landing-page footer.",
    sends: "IP address and user-agent, on every landing-page view.",
    purpose:
      "Renders the badge. Hotlinked deliberately — dmca.com serves it against the protection ID so it cannot be faked or outlive a lapsed subscription.",
    avoidable: true,
  },
  // Two entries used to sit here and both are deliberately gone.
  //
  // YouTube: Watch embedded the IFrame player, so every viewer's IP and
  // user-agent reached Google the moment a stream opened, with no user
  // decision involved — a declarable automatic request. Watch is now a list of
  // links: nothing contacts YouTube until the user taps a row and leaves the
  // app, and a destination the user chooses to visit is not a request ONIQ
  // makes. See src/data/watchDirectory.ts.
  //
  // date.nager.at and api.frankfurter.dev: both were Glance's, and Glance was
  // removed from the app. Nothing calls either host now.
  // The three below send LOCATION, not just an IP, which is a different and
  // heavier Data safety category. They were undeclared until the compliance
  // test went looking for automatic requests rather than link destinations.
  {
    host: "nominatim.openstreetmap.org",
    triggeredBy:
      "Address search and reverse geocoding in the mini-apps launcher (src/lib/miniapps.ts).",
    sends:
      "A typed search string, or latitude and longitude on reverse lookup, plus the IP address. Approximate location leaves the device.",
    purpose: "Turning a place name into coordinates and back, for ride and delivery hand-offs.",
    avoidable: false,
  },
  {
    host: "places.googleapis.com",
    triggeredBy: "Place autocomplete and place details (src/lib/places.functions.ts).",
    sends:
      "The partial address the user is typing and the selected place id, from the SERVER — the key never reaches the device. Google receives ONIQ's server IP, not the user's.",
    purpose: "Address autocomplete.",
    avoidable: false,
  },
  {
    host: "api.openweathermap.org",
    triggeredBy:
      "Legacy weather screen (src/lib/weather.functions.ts). Currently DEAD — OPENWEATHER_API_KEY is unset, so the screen renders \"Weather isn't configured yet\" and no request is ever made.",
    sends:
      "Would send latitude and longitude, or a city name, from the server. Sends nothing today.",
    purpose: "Was the weather forecast. No weather source survived the licence review.",
    avoidable: true,
  },
];

/**
 * NO THIRD-PARTY LOGOS. Publisher, broadcaster, exchange, board and app names
 * are text only, with the standing not-affiliated disclaimer. The one
 * exception is the DMCA.com badge, which is a vendor mark ONIQ subscribes to
 * and displays deliberately.
 */
export const ALLOWED_REMOTE_IMAGE_HOSTS = ["images.dmca.com"] as const;

export const NOT_AFFILIATED_NOTICE =
  "Names are used to tell you where a link goes. ONIQ is not affiliated with, endorsed by, or sponsored by any of them.";
