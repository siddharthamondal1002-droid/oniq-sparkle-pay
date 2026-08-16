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
  // DO NOT restore the old wording here: "On-device health data — health
  // readings never leave the device." That was false, and falsest in the place
  // it mattered most. app.vitals.tsx writes mood, sleep and cycle logs to the
  // health_profiles, health_checkins and cycle_logs tables, and there is real
  // data in them in production. Health data IS collected and MUST be declared
  // as such in Play Data safety. The safety plan is the only genuinely
  // device-only health surface (localStorage, oniq.safetyplan.v1).
  "Health tracking with a two-axis UAE block enforced in the database — health_data_allowed() combines the home-country check with a cf-ipcountry region check read off the request itself, so a client that lies about its region still cannot persist a reading.",
  "Row-level security on every health table: a user can read and write only their own rows, enforced in Postgres rather than in the UI.",
  "A safety plan that is genuinely device-only — held in localStorage and wiped whenever health data becomes barred.",
  "Hash-chained, append-only consent and audit ledgers with cryptographic verification.",
  "DPDP age gate: is_adult_18 enforced in RESTRICTIVE row-level security, not just in the UI.",
  "Data-subject-request handling with a 30-day SLA, soft delete and a 30-day grace hard purge.",
  "CV builder with anti-fabrication validation against the user's own declared facts.",
  "Country-aware exam-paper generation with vector PDF export.",
  "Real-time chat with WebRTC voice and video.",
  // RESURFACED. `oniq-upi` is visible in the registry again and the site lists
  // Scan & Pay as live, so a reviewer can reach it — which is what this entry
  // needed before it could be cited without qualification.
  //
  // One functional caveat, recorded because a reviewer may hit it: PhonePe and
  // GPay refuse third-party P2P intents, so paying a PERSON can be declined by
  // the receiving app. Scanning a merchant QR is unaffected.
  "UPI scan-and-pay through the user's own payment apps.",
  // Card and netbanking checkout for FOOD ORDERS, via Razorpay. Physical goods
  // and services only — Play permits a third-party processor for those and
  // requires Play Billing for digital content, so this is deliberately wired
  // to `orders` and to nothing digital. Payment status is written only by an
  // edge function that has verified an HMAC; no client path can set it.
  "Card and netbanking payment for food orders through Razorpay.",
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
  {
    id: "cv_ai_output",
    screen: "Jobs — CV builder",
    file: "src/routes/_authenticated/app.jobs.tsx",
  },
  {
    id: "study_ai_output",
    screen: "Study Buddy tutor",
    file: "src/routes/_authenticated/app.study.tsx",
  },
  { id: "ting_ai_output", screen: "Ting assistant", file: "src/routes/_authenticated/app.ai.tsx" },
  {
    id: "lores_ai_output",
    screen: "Lores — ONIQ Originals",
    file: "src/routes/_authenticated/app.lores.tsx",
  },
  {
    // The Stories tab under Lores. A user's OWN prompt drives this one, which
    // makes the label more necessary rather than less: the output is generated
    // whoever wrote the prompt, and a video someone made themselves is exactly
    // the one they are most likely to pass off as filmed.
    id: "stories_ai_output",
    screen: "Lores — Stories studio",
    file: "src/components/stories/StoryStudio.tsx",
  },
  {
    // "Your videos" — the library where a finished Story is watched and saved.
    // A SEPARATE SURFACE FROM THE STUDIO, because it is where the generated
    // video is actually WATCHED. The studio only ever shows a progress line;
    // this is the screen someone could screenshot and pass off as filmed, which
    // is precisely what the label is for.
    id: "stories_library_output",
    screen: "Lores — Your videos",
    file: "src/components/stories/YourVideos.tsx",
  },
  {
    id: "runway_admin_output",
    screen: "Admin — Runway video tool (internal)",
    file: "src/routes/_authenticated/app.admin.video.tsx",
  },
  {
    // The Home loop's Originals face — the same generated season, autoplaying
    // on the app's front door, which is exactly where the label matters most.
    id: "home_originals_loop",
    screen: "Home — Originals loop",
    file: "src/routes/_authenticated/app.index.tsx",
  },
] as const;

/**
 * Modules whose CONTENT is AI-generated. Any screen rendering one of these is
 * a generative surface and must appear in AI_SURFACES above.
 *
 * This list exists because the "none missed" guard could not see Lores.
 * That guard looks for files which already render <AiOutputReport /> but are
 * undeclared — so it catches a stale list, and is blind to the failure its own
 * comment names: a surface that renders NO label at all imports nothing to
 * match on. Lores shipped a hub of entirely Runway-generated video and the
 * guard had nothing to grep for.
 *
 * Naming the data modules fixes the direction. A generative surface has to get
 * its content from somewhere, and that somewhere is far easier to enumerate
 * than every way a screen might render it.
 *
 * `@/data/ep3Shots` is the episode 3 shot list — sixty prompts that produce
 * sixty generated video clips. Nothing renders it today; it is declared anyway,
 * because the entire point of enumerating sources is that the declaration
 * exists BEFORE the screen does. That ordering is what Lores got wrong.
 */
export const AI_CONTENT_MODULES = [
  "@/data/lores",
  "@/data/originals",
  "@/data/ep3Shots",
  // Episode 4's shot list — declared before anything renders it, which is the
  // ordering Lores originally got wrong and this list exists to enforce.
  "@/data/ep4Shots",
] as const;

/**
 * DATA SAFETY — WHAT ONIQ ACTUALLY COLLECTS, as the Play form, in code.
 *
 * The declaration must match reality. Data that never leaves the device is not
 * "collected" — but anything that does leave has to be listed, including
 * third-party requests made by decorative elements, which is the part people
 * forget.
 *
 * This exists because the form was about to be filled in from a false premise.
 * NATIVE_CAPABILITIES used to claim health readings never left the device,
 * which would have become a "no health data collected" declaration while
 * health_profiles, health_checkins and cycle_logs held real rows.
 *
 * A wrong Data safety declaration is not a paperwork error. Play treats it as
 * a policy violation in its own right, independently of whatever the app does
 * — you can be removed for declaring incorrectly even where the underlying
 * processing would have been fine if declared.
 *
 * So: declare it, then say honestly what protects it. The protections here are
 * real and checkable, which is the only kind worth listing.
 */
export type CollectedData = {
  category: string;
  /** Play's own taxonomy word, so the form can be filled straight from this. */
  playType: string;
  what: string;
  /** Why it leaves the device at all. */
  purpose: string;
  /** True where the user can use ONIQ without providing it. */
  optional: boolean;
  /** The controls that actually apply. No aspirations. */
  protection: string;
};

export const DATA_COLLECTED: CollectedData[] = [
  {
    category: "Health and fitness",
    playType: "Health info",
    what: "Mood, sleep, energy, water and exercise check-ins, and cycle logs.",
    purpose:
      "Rendering the user's own history back to them. Never used for advertising, never sold, never shared with a third party.",
    optional: true,
    protection:
      "Row-level security: readable and writable only by the account that created it. A two-axis UAE block enforced in Postgres by health_data_allowed() refuses the write outright where the data would be generated in the UAE. Included in data export and account deletion.",
  },
  {
    category: "Personal identifiers",
    playType: "Personal info",
    what: "Display name, username, avatar, country, and date of birth where given.",
    purpose: "Account identity, the 18+ gate, and country-correct content.",
    optional: false,
    protection:
      "Date of birth is write-once and drives is_adult_18, which is enforced in RESTRICTIVE row-level security rather than only in the UI.",
  },
  {
    category: "Messages",
    playType: "Messages",
    what: "Chat messages, call metadata and any media the user attaches.",
    purpose: "Delivering the conversation.",
    optional: true,
    protection:
      "Readable only by conversation participants. WebRTC voice and video are peer-to-peer and are not recorded.",
  },
  {
    category: "User content",
    playType: "Photos and videos",
    what: "Moments, clips and profile images the user uploads.",
    purpose: "Showing them to the audience the user chose.",
    optional: true,
    protection: "Deleted with the account; reportable in-app.",
  },
  {
    // PRECISE, not approximate. The manifest declares ACCESS_FINE_LOCATION and
    // the code asks for it: miniapps.ts and app.learn.tsx both call
    // getCurrentPosition with enableHighAccuracy:true and read
    // coords.latitude/longitude. Declaring this as merely "approximate" was
    // wrong, and Play's 15 July 2026 announcement specifically called out
    // precise-versus-approximate disclosure as an area it is tightening.
    category: "Precise location",
    playType: "Precise location",
    what: "Exact latitude and longitude, read only when the user taps to use their current location for a ride, delivery or nearby lookup.",
    purpose:
      "Setting a pickup point or finding what is nearby. Never used for advertising, never sold, never stored on ONIQ's servers.",
    optional: true,
    protection:
      "Requested at the moment of use, not at launch. The coordinates go to the geocoder to resolve a place and are not persisted by ONIQ.",
  },
  {
    category: "Approximate location",
    playType: "Approximate location",
    what: "A typed address, and the country-level region signal.",
    purpose: "Turning a place name into coordinates, and showing country-correct content.",
    optional: true,
    protection:
      "The country-level signal comes from the Cloudflare edge header, is used for the decision and discarded, and is never stored.",
  },
  {
    // READ_CONTACTS is in the manifest and getNativeContacts() uses it. It was
    // undeclared, which is the same class of error as the health claim.
    category: "Contacts",
    playType: "Contacts",
    what: "Phone numbers from the device address book, when the user chooses to find friends already on ONIQ.",
    purpose: "Matching contacts to existing ONIQ accounts.",
    optional: true,
    protection:
      "Only on an explicit tap — never read at launch or in the background. Numbers are normalised and matched, and the address book is not uploaded wholesale or retained as a contact graph.",
  },
  {
    // Play's 15 July 2026 clarification: the User Data policy applies to
    // third-party AI integrations, and the developer stays responsible for
    // limited use, disclosure and consent. ONIQ's generative surfaces send
    // user input to Anthropic. That has to be disclosed like any other
    // third-party processing, because it is.
    category: "AI processing",
    playType: "App activity / user-generated content",
    what: "What the user types into Ting, Study Buddy, or the CV builder — including the facts they enter about themselves for a CV — is sent to Anthropic's API to generate a response.",
    purpose:
      "Producing the answer, the practice paper or the CV the user asked for. Not used to train a model, not used for advertising, not sold.",
    optional: true,
    protection:
      "Health data is never sent to any AI surface. Output is labelled AI-generated and reportable in-app. Disclosed in the privacy notice.",
  },
];

/** Health data IS collected. Anything claiming otherwise is a bug — see the test. */
export const HEALTH_DATA_IS_COLLECTED = true;

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
  {
    // BACK, because the player is back (owner directive, 2026-08-16 evening).
    //
    // This entry was removed earlier the same day when Watch became a list of
    // links, on the reasoning that a destination the user taps is not a
    // request ONIQ makes. That reasoning still holds for the LIST — no row
    // contacts Google until it is tapped — but stops holding the moment a
    // frame renders, so the declaration comes back with it.
    //
    // Narrower than the version that was removed, and the difference is worth
    // keeping: the old embed was on a screen that could autoplay into it, so
    // the request was effectively automatic. This one fires only after a
    // deliberate tap on a named channel, and the directory itself still loads
    // no thumbnails, no artwork and no scripts from Google.
    host: "www.youtube-nocookie.com",
    triggeredBy:
      "Tapping a channel in Watch (src/routes/_authenticated/app.watch.tsx). Never on load — the directory list itself contacts nothing.",
    sends:
      "IP address and user-agent, plus the playlist id being watched. The -nocookie origin means no viewing history is written to a Google advertising profile unless playback starts.",
    purpose:
      "Plays the channel in YouTube's own player. ONIQ resolves no stream URL and proxies no video; YouTube serves the content, its ads, and its own geo and age restrictions.",
    avoidable: true,
  },
  // One entry that used to sit here is deliberately still gone.
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
      'Legacy weather screen (src/lib/weather.functions.ts). Currently DEAD — OPENWEATHER_API_KEY is unset, so the screen renders "Weather isn\'t configured yet" and no request is ever made.',
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
