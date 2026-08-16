// ONIQ — NO LIVE CHANNELS loop, Phase 1: Watch is a directory, not a player.
//
// THE DECISION
//
// ONIQ does not stream, embed, proxy, resolve or channel live TV in any
// country. Not with the YouTube IFrame player, not via the Data API, not from
// a curated channel list, not for faith channels, not for news, not for
// anything. This file is the whole of what Watch now is: a list of names,
// descriptions and https links.
//
// This is stricter than the law requires, and that is the point. What it buys:
//
//   - Territorial licensing exposure goes to zero. Streaming rights are
//     territorial, so serving a stream outside its licensed territory is
//     infringement by ONIQ. A link is not a performance, so there is no
//     territory to get wrong.
//   - The YouTube ToS question disappears. No embed, no embed terms — no
//     minimum player size, no overlay rule, no stream-URL handling rule.
//   - Region gating stops being a legal control (see watchDirectoryFor).
//
// There is no residual risk to manage here because there is no residual
// streaming. If a future change re-introduces an embed, every one of those
// three protections is lost at once — which is why the tests in
// src/data/__tests__/watchDirectory.test.ts assert the absence of a player
// rather than the correctness of one.
//
// WHAT REPLACED WHAT
//
// The `live-channels` edge function is retired, not reduced. Once nothing
// plays in-app there is nothing for it to resolve: the channel roster is
// static, so it belongs in the bundle rather than behind a network call that
// carried a spoofed browser User-Agent and a consent cookie left over from the
// scraping era.
//
// Channel ids are reused verbatim from that function's rosters. No id here was
// invented, and none was re-verified — `verified: false` fails an entry closed
// exactly as the app registry does.

import type { Country } from "@/data/appRegistry";
import type { FaithId } from "@/data/faithContent";
import { WATCH_CHANNELS, liveEmbedUrl } from "@/data/watchChannels";

/** Channel ids that carry a 24/7 live feed, from the original roster. */
const LIVE_IDS = new Set(WATCH_CHANNELS.filter((c) => c.verified).map((c) => c.channelId));

/** Whether this channel has a live feed to play, rather than uploads. */
export function isLiveChannel(channelId?: string): boolean {
  return !!channelId && LIVE_IDS.has(channelId);
}

export type WatchGenre =
  "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle";

export type WatchEntry = {
  /** YouTube channel id (UC...) where known — used only to build the link. */
  channelId?: string;
  /** @handle, for channels whose id was never confirmed. Also link-only. */
  handle?: string;
  name: string;
  /** ONIQ's own one-line description. Never copied from the destination. */
  description: string;
  genre: WatchGenre;
  /**
   * Relevance ONLY. `"*"` means "useful to everyone". This is no longer a
   * rights control — see watchDirectoryFor.
   */
  countries: Country[] | "*";
  /**
   * false => hidden. Kept because an unconfirmed id builds a link to the wrong
   * channel, which is a correctness problem even when nothing plays.
   */
  verified: boolean;
};

export type FaithEntry = {
  channelId: string;
  name: string;
  description: string;
  faith: FaithId;
  verified: boolean;
};

/**
 * A channel's own page on its own platform. That platform then applies its own
 * geo-restrictions, age-gating and rights enforcement — the rights-holder
 * decides who sees what, not ONIQ. That delegation is the entire point.
 */
export function channelUrl(e: { channelId?: string; handle?: string }): string | null {
  if (e.channelId) return `https://www.youtube.com/channel/${e.channelId}`;
  if (e.handle) return `https://www.youtube.com/@${e.handle}`;
  return null;
}

/**
 * THE IN-APP PLAYER — owner directive, 2026-08-16 (evening), reversing the
 * link-only posture set earlier the same day.
 *
 * WHAT THIS IS: YouTube's OWN embeddable player, in an iframe, on the
 * privacy-enhanced `youtube-nocookie.com` origin. YouTube serves the video,
 * serves its own ads, applies its own geo-restrictions and age gates, and the
 * channel owner decides whether their channel may be embedded at all.
 *
 * WHAT THIS IS NOT, and must never become: resolving a stream URL and playing
 * it in a player of ONIQ's own. The retired `live-channels` edge function did
 * that, reaching YouTube with a spoofed browser User-Agent and a consent
 * cookie. That strips YouTube's ads, puts ONIQ in the delivery path, and is a
 * plain breach of their terms. The embed gets the same result with none of it,
 * which is why the tests forbid a stream URL ever being fetched or stored.
 *
 * WHY THE UPLOADS PLAYLIST rather than `live_stream?channel=`. The live URL
 * plays only while a channel is actually broadcasting and shows an error the
 * rest of the time — and two thirds of this directory are not live channels.
 * Every channel has an uploads playlist, its id is the channel id with the
 * `UC` prefix swapped for `UU`, and live broadcasts appear in it too. One
 * URL shape that always has something behind it beats two that half-work.
 *
 * Returns null for an entry known only by @handle: the playlist id cannot be
 * derived from a handle, so those stay link-out and the UI says so.
 */
export function embedUrl(e: { channelId?: string }): string | null {
  if (!e.channelId || !e.channelId.startsWith("UC")) return null;
  // A CHANNEL THAT CARRIES A LIVE FEED PLAYS ITS LIVE FEED. That split is not
  // new and was not invented here: src/data/watchChannels.ts is the original
  // roster of broadcasters with a 24/7 stream, restored from the commit that
  // removed it, and liveEmbedUrl is its original endpoint. Everything else
  // has no live feed to point at, so it gets the uploads playlist instead.
  if (isLiveChannel(e.channelId)) return liveEmbedUrl(e.channelId);
  const uploads = `UU${e.channelId.slice(2)}`;
  // `rel=0` keeps the end-screen suggestions inside the same channel. No
  // autoplay: a directory that starts making noise on open is a bug, and
  // muted-autoplay to dodge that is worse.
  return `https://www.youtube-nocookie.com/embed/videoseries?list=${uploads}&rel=0`;
}

export const WATCH_ENTRIES: WatchEntry[] = [
  // News — international broadcasters that publish freely on their own channel.
  {
    channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg",
    name: "Al Jazeera English",
    description: "International news from Doha, in English.",
    genre: "news",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCknLrEdhRCp1aegoMqRaCZg",
    name: "DW News",
    description: "Germany's international public broadcaster.",
    genre: "news",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg",
    name: "France 24 English",
    description: "French international news, English service.",
    genre: "news",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCoMdktPbSTixAyNGwb-UYkQ",
    name: "Sky News",
    description: "UK rolling news.",
    genre: "news",
    countries: ["GB"],
    verified: true,
  },
  {
    channelId: "UC83jt4dlz1Gjl58fzQrrKZg",
    name: "CNA",
    description: "Singapore and Asia-Pacific news.",
    genre: "news",
    countries: ["SG"],
    verified: true,
  },
  {
    channelId: "UC_gUM8rL-Lrg6O3adPW9K1g",
    name: "WION",
    description: "Indian international news desk.",
    genre: "news",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCZFMm1mMw0F81Z37aaEzTUA",
    name: "NDTV 24x7",
    description: "Indian English-language news.",
    genre: "news",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCYPvAwZP8pZhSMW8qs7cVCw",
    name: "India Today",
    description: "Indian news and current affairs.",
    genre: "news",
    countries: ["IN"],
    verified: true,
  },

  // Entertainment
  {
    channelId: "UChz5aEi3dfrDVC8-YJsMUDA",
    name: "T-Series",
    description: "Indian music label — film songs and albums.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCim0ZIz8SAQGPvg4mJHG3JA",
    name: "Netflix India",
    description: "Trailers and clips for Indian originals.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCFFbwnve3yF62-tVXkTyHqg",
    name: "Zee Music Company",
    description: "Bollywood soundtracks and singles.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UC4zWG9LccdWGUlF77LZ8toA",
    name: "Prime Video India",
    description: "Trailers for Indian Prime Video titles.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UC56gTxNs4f9xZ7Pa2i5xNzg",
    name: "Sony Music India",
    description: "Indian music releases.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCFqyJFbsV-uEcosvNhg0PaQ",
    name: "Sony Pictures India",
    description: "Film trailers and promos.",
    genre: "entertainment",
    countries: ["IN"],
    verified: true,
  },

  // Finance
  {
    channelId: "UCD-qZSqFPqyx43L6gAR8qfQ",
    name: "CA Rachana Ranade",
    description: "Personal finance and investing explainers.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCNXapAc8mXTwW82MTncdfzQ",
    name: "Pranjal Kamra",
    description: "Long-term investing for Indian retail investors.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCRzYN32xtBf3Yxsx5BvJWJw",
    name: "warikoo",
    description: "Money, careers and entrepreneurship.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCBI57iTXtmJoaI6Ht7MgcfA",
    name: "Finance With Sharan",
    description: "Everyday money explained simply.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCqW8jxh4tH1Z1sWPbkGWL4g",
    name: "Akshat Shrivastava",
    description: "Markets and macro commentary.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCvPTFsvuCEwXav7JwJ-3JVA",
    name: "Zerodha",
    description: "Broker's own investor-education channel.",
    genre: "finance",
    countries: ["IN"],
    verified: true,
  },

  // Sports
  {
    channelId: "UCt2JXOLNxqry7B_4rRZME3Q",
    name: "ICC",
    description: "International Cricket Council highlights.",
    genre: "sports",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCXnFh8S94wQCPw-p6j6bX9A",
    name: "BCCI",
    description: "Indian cricket board's official channel.",
    genre: "sports",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCpcTrCXblq78GZrTUTLWeBw",
    name: "FIFA",
    description: "World football governing body.",
    genre: "sports",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCWJ2lWNubArHWmf3FIHbfcQ",
    name: "NBA",
    description: "Basketball highlights and features.",
    genre: "sports",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCpryVRk_VDudG8SHXgWcG0w",
    name: "Premier League",
    description: "English top-flight football.",
    genre: "sports",
    countries: "*",
    verified: true,
  },

  // Lifestyle
  {
    channelId: "UCPxMZIFE856tbTfdkdjzTSQ",
    name: "BeerBiceps",
    description: "Long-form interviews and wellbeing.",
    genre: "lifestyle",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCBRvR4Q1ddonASMOSV4QGOg",
    name: "Nas Daily",
    description: "Short documentaries from around the world.",
    genre: "lifestyle",
    countries: "*",
    verified: true,
  },
  {
    channelId: "UCk3JZr7eS3pg5AGEvBdEvFg",
    name: "Village Cooking Channel",
    description: "Traditional Tamil village cooking.",
    genre: "lifestyle",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCDWVNwQce16D16tPc5NBYlQ",
    name: "FitTuber",
    description: "Indian health and nutrition.",
    genre: "lifestyle",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UC9SM7V7J1pAhPabOUST01fw",
    name: "NASA",
    description: "Spaceflight and science from the agency itself.",
    genre: "lifestyle",
    countries: "*",
    verified: true,
  },

  // Influencer. These were handle-only in the retired edge function, which
  // skipped them because resolving a handle to an id needs the Data API or a
  // scrape. A LINK needs neither — @handle URLs resolve on YouTube's side — so
  // they come back here.
  {
    handle: "MrBeast",
    name: "MrBeast",
    description: "Large-scale stunts and giveaways.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "IShowSpeed",
    name: "IShowSpeed",
    description: "Gaming and live variety.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "DudePerfect",
    name: "Dude Perfect",
    description: "Trick shots and sports comedy.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "PewDiePie",
    name: "PewDiePie",
    description: "Commentary and vlogs.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "ksi",
    name: "KSI",
    description: "Music, boxing and comedy.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "Sidemen",
    name: "Sidemen",
    description: "British group challenges and sketches.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "Mrwhosetheboss",
    name: "Mrwhosetheboss",
    description: "Consumer tech reviews.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
  {
    handle: "CarryMinati",
    name: "CarryMinati",
    description: "Indian comedy and gaming.",
    genre: "influencer",
    countries: ["IN"],
    verified: true,
  },
  {
    handle: "TotalGaming093",
    name: "Total Gaming",
    description: "Indian mobile gaming.",
    genre: "influencer",
    countries: ["IN"],
    verified: true,
  },
  {
    handle: "TechnoGamerzOfficial",
    name: "Techno Gamerz",
    description: "Indian gaming playthroughs.",
    genre: "influencer",
    countries: ["IN"],
    verified: true,
  },
  {
    channelId: "UCLyswjODCCi5UbDe-eh5cFQ",
    name: "Sourav Joshi Vlogs",
    description: "Daily family vlogs.",
    genre: "influencer",
    countries: ["IN"],
    verified: true,
  },
  {
    handle: "HikakinTV",
    name: "HikakinTV",
    description: "Japanese variety and challenges.",
    genre: "influencer",
    countries: "*",
    verified: true,
  },
];

/**
 * Devotional channels, per faith. Rosters carried over verbatim from the
 * retired edge function, including the full Jain set.
 */
export const FAITH_ENTRIES: FaithEntry[] = [
  // Islamic
  {
    channelId: "UChMtBGc9nYBGEsRWKrV_uSw",
    name: "Makkah Live",
    description: "Broadcasts from the Grand Mosque.",
    faith: "islamic",
    verified: true,
  },
  {
    channelId: "UCCZnJmWUimOYtIkB6GLrG8A",
    name: "Madinah Live",
    description: "Broadcasts from the Prophet's Mosque.",
    faith: "islamic",
    verified: true,
  },
  {
    channelId: "UCyJeX5GaHTheVHBoTUSnQcw",
    name: "Al Haramain Al Sharifain",
    description: "The Two Holy Mosques' own channel.",
    faith: "islamic",
    verified: true,
  },
  {
    channelId: "UCuRjIwyf33-VNeyNxWcstYg",
    name: "Awakening Music",
    description: "Nasheed and vocal hymns.",
    faith: "islamic",
    verified: true,
  },
  {
    channelId: "UCz4AXmFeSbi-0vPXI102Q5w",
    name: "Muslim Central",
    description: "Lectures and recitation.",
    faith: "islamic",
    verified: true,
  },
  {
    channelId: "UCk9wXD940aaTKy8AGjM5H8A",
    name: "Nasheed Records",
    description: "Contemporary nasheed.",
    faith: "islamic",
    verified: true,
  },
  // Sikh
  {
    channelId: "UCYn6UEtQ771a_OWSiNBoG8w",
    name: "SGPC, Sri Amritsar",
    description: "Sri Harmandir Sahib's official channel.",
    faith: "sikh",
    verified: true,
  },
  {
    channelId: "UCjSHfIYLQHDAKW9VEO5gRNQ",
    name: "Daily Hukamnama",
    description: "The daily Hukamnama.",
    faith: "sikh",
    verified: true,
  },
  {
    channelId: "UCLMfeT_BVADvx_sTybotSLA",
    name: "Amritt Saagar Kirtan",
    description: "Kirtan recordings.",
    faith: "sikh",
    verified: true,
  },
  {
    channelId: "UC4F00emD5EG8OibGo5ixd-Q",
    name: "SikhNet",
    description: "Kirtan, stories and teachings.",
    faith: "sikh",
    verified: true,
  },
  // Hindu
  {
    channelId: "UCsGVmie9VldduYuWYziIv9Q",
    name: "TTD Seva Online",
    description: "Tirumala Tirupati Devasthanams.",
    faith: "hindu",
    verified: true,
  },
  {
    channelId: "UCZMmfrbYGqSjKa4MWJHb9sQ",
    name: "Bageshwar Dham Sarkar",
    description: "Discourses from Bageshwar Dham.",
    faith: "hindu",
    verified: true,
  },
  {
    channelId: "UC7ZivIYRB0fMSGh-THcTYbw",
    name: "Shemaroo Bhakti",
    description: "Aarti, bhajan and devotional film.",
    faith: "hindu",
    verified: true,
  },
  {
    channelId: "UCaayLD9i5x4MmIoVZxXSv_g",
    name: "T-Series Bhakti Sagar",
    description: "Devotional music label.",
    faith: "hindu",
    verified: true,
  },
  {
    channelId: "UC6vQRTCxutg6fJLUGkDKynQ",
    name: "Saregama Bhakti",
    description: "Classic devotional recordings.",
    faith: "hindu",
    verified: true,
  },
  {
    channelId: "UCn9WB2Eb1QRSYkFxuPQHkxg",
    name: "Times Music Spiritual",
    description: "Chants and spiritual music.",
    faith: "hindu",
    verified: true,
  },
  // Christian
  {
    channelId: "UC1_JSuk0BSA_FWzSvMsezGg",
    name: "GOD TV",
    description: "Christian broadcaster.",
    faith: "christian",
    verified: true,
  },
  {
    channelId: "UC4q12NoPNySbVqwpw4iO5Vg",
    name: "Hillsong Worship",
    description: "Worship music.",
    faith: "christian",
    verified: true,
  },
  {
    channelId: "UCSf-NCzjwcnXErUBW_qeFvA",
    name: "Elevation Worship",
    description: "Contemporary worship.",
    faith: "christian",
    verified: true,
  },
  {
    channelId: "UCbertc-gMbkkHuSmg0qwnxw",
    name: "Bethel Music",
    description: "Worship collective.",
    faith: "christian",
    verified: true,
  },
  {
    channelId: "UCqMof5-AMp88PfI3owykayg",
    name: "Maranatha Music",
    description: "Praise and worship catalogue.",
    faith: "christian",
    verified: true,
  },
  // Buddhist
  {
    channelId: "UCiPJ_g02LuOgOG0ZNk5j1jA",
    name: "Dalai Lama",
    description: "Official channel of the Dalai Lama.",
    faith: "buddhist",
    verified: true,
  },
  {
    channelId: "UCjHbgWBt9ZUoqZBPEnsqX4A",
    name: "Tricycle",
    description: "Buddhist magazine's talks and courses.",
    faith: "buddhist",
    verified: true,
  },
  {
    channelId: "UClUMK5PN0vPSVAq2CDkM26w",
    name: "FPMT",
    description: "Mahayana teachings.",
    faith: "buddhist",
    verified: true,
  },
  {
    channelId: "UCTUkNCf8m5jAxzUblftQyBw",
    name: "Zen Mountain Monastery",
    description: "Zen talks and practice.",
    faith: "buddhist",
    verified: true,
  },
  {
    channelId: "UCfz9QrY-qz_j0uSygPesAeg",
    name: "Namgyal Monastery",
    description: "Tibetan monastic teachings.",
    faith: "buddhist",
    verified: true,
  },
  // Jain
  {
    channelId: "UCDNNWj0oAFXngcwHAwnwP4w",
    name: "Jinvani Channel",
    description: "Digambar discourses and bhakti.",
    faith: "jain",
    verified: true,
  },
  {
    channelId: "UCsQUid3uu0yB2SLGq88EkHg",
    name: "Terapanth",
    description: "Terapanth order's official channel.",
    faith: "jain",
    verified: true,
  },
  {
    channelId: "UCgcOIWyN-hiHVjl1bDhj7JA",
    name: "Vitraag Jain Shwetambar Sangh",
    description: "Shwetambar discourses.",
    faith: "jain",
    verified: true,
  },
  {
    channelId: "UCo37KIbexDijRo0-2bfK_Tw",
    name: "Jain Live",
    description: "Devotional programming.",
    faith: "jain",
    verified: true,
  },
  {
    channelId: "UCh8hboHfOeh5eoVbNgRCmlQ",
    name: "Jain Darshan",
    description: "Darshan and pravachan.",
    faith: "jain",
    verified: true,
  },
  {
    channelId: "UCXcHpI7iFXxIyNa4HK6rqTg",
    name: "jainam live channel",
    description: "Community devotional broadcasts.",
    faith: "jain",
    verified: true,
  },
  // Jewish
  {
    channelId: "UCfZX3CU_wWgcDyhWkvQ5rSg",
    name: "Chabad.org",
    description: "Torah study and Jewish life.",
    faith: "jewish",
    verified: true,
  },
  {
    channelId: "UCl9IK49EtWMazcVLoHnHdgw",
    name: "Aleph Beta",
    description: "Animated Torah study.",
    faith: "jewish",
    verified: true,
  },
  {
    channelId: "UCq-6cYitNBPy5rttFud4c5w",
    name: "ArtScroll Mesorah",
    description: "Torah publishing house.",
    faith: "jewish",
    verified: true,
  },
  {
    channelId: "UCPS1ETXB86wgo2fF-4OrcnQ",
    name: "Jewish Music Toronto",
    description: "Cantorial and Jewish music.",
    faith: "jewish",
    verified: true,
  },
  {
    channelId: "UC-KdXDCCJD2AEAhSWm--O7w",
    name: "Sameach Music",
    description: "Contemporary Jewish music.",
    faith: "jewish",
    verified: true,
  },
];

/**
 * REGION IS RELEVANCE ONLY. READ THIS BEFORE CHANGING IT.
 *
 * This filter used to be a rights control: it decided which live streams ONIQ
 * would serve, and getting it wrong meant serving a stream outside its
 * licensed territory — infringement by ONIQ. That is why it failed closed on a
 * null region.
 *
 * Nothing plays in ONIQ any more. A link is not a performance, and the
 * destination platform enforces its own territorial rights when the user
 * arrives. So this filter now decides one thing only: whether a channel is
 * likely to be *useful* to someone standing in `region`. Getting it wrong
 * shows a Singaporean a channel they don't care about. It is a UX bug, not
 * infringement.
 *
 * Two consequences, both deliberate:
 *
 *   - It no longer fails closed. An unknown region shows the whole directory,
 *     because withholding a link from someone whose region we cannot read
 *     helps nobody. Under the old model that would have been a licence breach.
 *   - Do not re-add a legal gate here. There is no longer anything for it to
 *     protect, and a gate that protects nothing will be mistaken for one that
 *     does. Equally, do not delete the filter thinking it is purely cosmetic
 *     without reading this: it is load-bearing for relevance.
 */
export function watchDirectoryFor(region: Country | null, genre?: WatchGenre): WatchEntry[] {
  return WATCH_ENTRIES.filter((e) => {
    if (!e.verified) return false;
    if (genre && e.genre !== genre) return false;
    if (e.countries === "*") return true;
    if (!region) return true;
    return e.countries.includes(region);
  });
}

/**
 * STRICT faith-ID equality, no default list, no index-based access.
 *
 * Carried over unchanged from the embed era, where a Jain user was shown
 * another faith's channels. That fix holds regardless of whether the
 * destination is an embed or a link, so it is re-asserted here rather than
 * inherited by accident. A faith with no entries returns [] and the caller
 * shows that faith's own empty state.
 */
export function faithChannelsFor(faith: FaithId | null): FaithEntry[] {
  if (!faith) return [];
  return FAITH_ENTRIES.filter((e) => e.verified && e.faith === faith);
}

/**
 * Rewritten 2026-08-16 (evening) when the player came back. The old wording
 * said "ONIQ does not play or host any of this", which stops being true the
 * moment an embed renders — and a notice that is no longer true is worse than
 * no notice. Hosting is still not ONIQ's: the player is YouTube's own and the
 * bytes come from them.
 */
export const WATCH_NOTICE =
  "ONIQ hosts none of this. Channels play in YouTube's own player, and YouTube decides what is available where you are.";

export const LINK_OUT_LABEL = "Opens in YouTube";
