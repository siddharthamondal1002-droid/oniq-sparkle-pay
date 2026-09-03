/**
 * ONIQ — Watch: the other places to watch.
 *
 * OWNER DIRECTIVE, 2026-09-03: "add vimeo and all other free video hosting
 * platforms like youtube in watch".
 *
 * WHAT THIS IS. A directory of the free video platforms a person in ONIQ's
 * markets can open and watch for nothing. Each entry is a name, ONIQ's own
 * one-line description, and the platform's own front door. Tapping one opens
 * that platform in the in-app browser (openInApp) — the same shape as the
 * "also on YouTube" link-outs on the Watch screen and every mini-app hand-off.
 *
 * WHAT THIS IS NOT, deliberately. Nothing here plays inside ONIQ. YouTube
 * plays in-app through YouTube's own embeddable player under an owner
 * directive (2026-08-16), a CSP frame-src grant, and a Play data declaration
 * for the automatic request the frame makes. Framing another platform's
 * player is the same class of decision — their player, their ads, their
 * trackers, a new frame-src origin and a new THIRD_PARTY_REQUESTS entry each
 * — and it is the owner's to make per platform, not something a directory
 * entry may imply. A link reaches nobody until the user taps it, which is why
 * no host below is declared as an automatic request: a destination the user
 * chooses is not a request ONIQ makes. src/data/__tests__/watchPlatforms.test.ts
 * holds both halves of that line.
 *
 * WHICH PLATFORMS, and which not. "Free video hosting platform like YouTube"
 * was read as: free to watch, carried by what its users upload or stream, and
 * with a front door worth opening.
 *
 *   In:  Vimeo, Dailymotion, Twitch, the Internet Archive's film library,
 *        Facebook Watch, Instagram Reels, and the two Indian short-video
 *        platforms that grew after 2020, Moj and Josh.
 *   Out: TikTok — banned in India since 2020, and Watch is India-gated in
 *        countryRegistry, so listing it would show an Indian user a door that
 *        does not open. Rumble, Odysee, BitChute and Kick — free, but their
 *        content posture is the kind Play asks an app about, and ONIQ's own
 *        content rules would be lending them a listing. Streamable and
 *        PeerTube — nothing to browse at a front door. Vevo lives on
 *        YouTube. MX Player, JioCinema and Hotstar are OTT services with free
 *        tiers, not hosting platforms.
 *
 * Extend the list with a URL read off the platform's own front page, an
 * ONIQ-written description, and nothing fetched from the destination.
 *
 * NO LOGOS. Cards carry a glyph, the same rule as the rest of Watch: every
 * platform's mark stays on its own site, and NOT_AFFILIATED_NOTICE is shown
 * beside the names (src/config/playCompliance.ts).
 */
import type { Country } from "@/data/appRegistry";

export type WatchPlatformKind = "video" | "short" | "live" | "archive";

export type WatchPlatform = {
  id: string;
  name: string;
  /** The platform's own front door. Read off its site; never a deep link. */
  url: string;
  /** ONIQ's own line, never copied from the destination. */
  description: string;
  kind: WatchPlatformKind;
  /** A glyph in place of the artwork Watch deliberately never fetches. */
  emoji: string;
  /** Relevance ONLY, the same rule as watchDirectoryFor. */
  countries: Country[] | "*";
};

/** What each kind reads as on a card. */
export const PLATFORM_KIND_LABEL: Record<WatchPlatformKind, string> = {
  video: "video",
  short: "short video",
  live: "live streams",
  archive: "film archive",
};

export const WATCH_PLATFORMS: WatchPlatform[] = [
  {
    id: "vimeo",
    name: "Vimeo",
    url: "https://vimeo.com/watch",
    description: "Short films, documentaries and creator work, picked by Vimeo's staff.",
    kind: "video",
    emoji: "🎞️",
    countries: "*",
  },
  {
    id: "dailymotion",
    name: "Dailymotion",
    url: "https://www.dailymotion.com/",
    description: "News clips, sport and entertainment from publishers worldwide.",
    kind: "video",
    emoji: "📼",
    countries: "*",
  },
  {
    id: "twitch",
    name: "Twitch",
    url: "https://www.twitch.tv/",
    description: "Live gaming, music and talk streams, with the chat alongside.",
    kind: "live",
    emoji: "🎮",
    countries: "*",
  },
  {
    id: "internet-archive",
    name: "Internet Archive",
    url: "https://archive.org/details/movies",
    description: "Public-domain films, classic cartoons and old newsreels, free to keep.",
    kind: "archive",
    emoji: "🏛️",
    countries: "*",
  },
  {
    id: "facebook-watch",
    name: "Facebook Watch",
    url: "https://www.facebook.com/watch/",
    description: "Video from the pages and creators you follow, plus live broadcasts.",
    kind: "video",
    emoji: "📘",
    countries: "*",
  },
  {
    id: "instagram-reels",
    name: "Instagram Reels",
    url: "https://www.instagram.com/reels/",
    description: "Short vertical video from creators and friends.",
    kind: "short",
    emoji: "📸",
    countries: "*",
  },
  {
    id: "moj",
    name: "Moj",
    url: "https://mojapp.in/",
    description: "Indian short video in your own language, from ShareChat.",
    kind: "short",
    emoji: "💃",
    countries: ["IN"],
  },
  {
    id: "josh",
    name: "Josh",
    // The apex domain: www.myjosh.in answered 502 on 2026-09-03; myjosh.in
    // and share.myjosh.in both served the app's own page.
    url: "https://myjosh.in/",
    description: "Indian short video, music and dance, from VerSe.",
    kind: "short",
    emoji: "🕺",
    countries: ["IN"],
  },
];

/** The honest label for a tap that leaves the app: "Opens in Vimeo". */
export function opensIn(name: string): string {
  return `Opens in ${name}`;
}

/**
 * RELEVANCE ONLY, exactly as watchDirectoryFor: an unknown region sees the
 * whole list, a known one sees what is likely to be useful there. Not a legal
 * gate — a link needs no territorial basis, and the destination applies its
 * own rules when the user arrives.
 */
export function watchPlatformsFor(region: Country | null): WatchPlatform[] {
  return WATCH_PLATFORMS.filter((p) => {
    if (p.countries === "*") return true;
    if (!region) return true;
    return p.countries.includes(region);
  });
}
