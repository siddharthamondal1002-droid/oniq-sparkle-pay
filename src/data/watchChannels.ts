// ONIQ — Free & Legal Surfaces loop, Phase 2: Watch.
//
// TWO PROBLEMS THIS FIXES, AND WHY THEY WERE WORSE TOGETHER
//
// 1. `live-channels` resolved a channel's current live video by fetching
//    https://www.youtube.com/channel/<id>/live and regex-ing the HTML. That
//    breaches YouTube's ToS, which require the Data API.
// 2. Watch had no territorial axis at all. Streaming rights are territorial,
//    so serving a stream to a viewer outside its licensed territory is
//    infringement by ONIQ, not by the viewer.
//
// Compounded, ONIQ was sourcing streams by a forbidden method AND serving them
// with no idea what territory the resolved stream was licensed for — the scrape
// returns whatever happens to be live, which for a broadcaster is routinely a
// geo-restricted feed.
//
// HOW THE LIVE STREAM IS RESOLVED NOW: IT ISN'T.
//
// YouTube publishes an official embed endpoint that plays whatever a channel is
// currently streaming:
//
//     https://www.youtube.com/embed/live_stream?channel=<CHANNEL_ID>
//
// No scrape. No Data API call. **Zero quota.** YouTube resolves the live video
// itself, server-side, applying its own geo-restrictions — so a stream the
// viewer is not entitled to simply does not play, rather than ONIQ serving it.
//
// This is deliberately NOT the channels.list/videos.list route. That costs ~1
// unit per call, which is affordable, but it still means ONIQ resolving a video
// id and then deciding what to show — and there is no YouTube API key
// configured on this project at all, so it would also need a new credential.
// The live_stream embed needs neither. It also makes the search.list trap
// (100 units, would drain the 10,000/day free quota and tempt someone straight
// back into scraping) structurally impossible: there is no quota to drain.
//
// THE AXIS IS CURRENT REGION. NOT HOME.
//
// This is the one surface where the wrong axis creates direct copyright
// liability. A user whose Home is GB but who is standing in Dubai is not
// licensed for a UK stream. Contrast market link-outs, which
// follow HOME precisely because an Indian user in Dubai still wants the Nifty.

import type { Country } from "@/data/appRegistry";

export type WatchChannel = {
  /** YouTube channel id (UC...). The only identifier we need. */
  channelId: string;
  name: string;
  /**
   * `"*"` means the broadcaster publishes a free stream worldwide — the
   * public-service broadcasters below say so on their own channels. Anything
   * else is an explicit territory list.
   */
  countries: Country[] | "*";
  /** Public-service broadcasters carry the free-to-air global streams. */
  kind: "psb" | "news";
  /**
   * false => never embedded, only linked out. Same fail-closed idea as the app
   * registry's `verified`: an unconfirmed channel id embeds an empty player at
   * best and the wrong broadcaster at worst.
   */
  verified: boolean;
};

/**
 * Channel ids are reused verbatim from the pre-existing `live-channels` news
 * list, which already carried confirmed ids — no id here was invented.
 */
export const WATCH_CHANNELS: WatchChannel[] = [
  // Public-service and international broadcasters that publish a free global
  // live stream on their own YouTube channel. These are the ones that are
  // genuinely safe everywhere.
  { channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg", name: "Al Jazeera English", countries: "*", kind: "psb", verified: true },
  { channelId: "UCknLrEdhRCp1aegoMqRaCZg", name: "DW News", countries: "*", kind: "psb", verified: true },
  { channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg", name: "France 24 English", countries: "*", kind: "psb", verified: true },

  // Territory-scoped. Listed only where the broadcaster serves that market.
  { channelId: "UCoMdktPbSTixAyNGwb-UYkQ", name: "Sky News", countries: ["GB"], kind: "news", verified: true },
  { channelId: "UC83jt4dlz1Gjl58fzQrrKZg", name: "CNA", countries: ["SG"], kind: "news", verified: true },
  { channelId: "UC_gUM8rL-Lrg6O3adPW9K1g", name: "WION", countries: ["IN"], kind: "news", verified: true },
  { channelId: "UCZFMm1mMw0F81Z37aaEzTUA", name: "NDTV 24x7", countries: ["IN"], kind: "news", verified: true },
  { channelId: "UCYPvAwZP8pZhSMW8qs7cVCw", name: "India Today", countries: ["IN"], kind: "news", verified: true },
];

/**
 * The official channel-live embed. Zero API quota, no scraping, and YouTube
 * applies its own geo-restrictions server-side.
 *
 * `enablejsapi` lets the IFrame Player API drive it. No `autoplay`: unattended
 * playback of a broadcaster's stream is not something to start on the user's
 * behalf.
 */
export function liveEmbedUrl(channelId: string, origin?: string): string {
  const p = new URLSearchParams({ channel: channelId, enablejsapi: "1", rel: "0" });
  if (origin) p.set("origin", origin);
  return `https://www.youtube.com/embed/live_stream?${p.toString()}`;
}

/**
 * Channels embeddable for a viewer physically in `region`.
 *
 * Fails CLOSED on an unknown region: no region signal means no territorial
 * basis, so only the worldwide public-service streams are offered. Showing
 * everything would be the licence breach.
 */
export function watchChannelsFor(region: Country | null): WatchChannel[] {
  return WATCH_CHANNELS.filter((c) => {
    if (!c.verified) return false;
    if (c.countries === "*") return true;
    if (!region) return false;
    return c.countries.includes(region);
  });
}

/**
 * YouTube's embed terms, the parts that are easy to break later:
 *  - the official IFrame player only,
 *  - nothing rendered in front of ANY part of it, controls included,
 *  - at least 200x200px of viewport,
 *  - no caching, downloading or extracting of stream URLs.
 * Enforced by src/data/__tests__/watchChannels.test.ts.
 */
export const YT_MIN_PLAYER_PX = 200;

export const WATCH_NOTICE =
  "Live streams play in YouTube's own player. Availability is set by the broadcaster in your current region, not by ONIQ.";
