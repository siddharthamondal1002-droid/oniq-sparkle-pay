/**
 * ONIQ — Watch: the other platforms' OWN players.
 *
 * OWNER DIRECTIVE, 2026-09-03 (afternoon): "make them just like we have
 * youtube in watch, also include them in watch tab of home screen". Earlier
 * the same day the other platforms reached Watch as link-outs; this makes
 * four of them PLAY in Watch and on the Home watch face, in the shape YouTube
 * already uses — the platform's own embeddable player, in a frame.
 *
 * FOUR PLATFORMS PLAY; FOUR STAY LINKS. Vimeo, Dailymotion, Twitch and the
 * Internet Archive each publish a player meant to be framed on other sites.
 * Facebook Watch and Instagram Reels embed single posts only, never a feed or
 * a channel, and Moj and Josh have no web player at all — those four keep
 * their front-door cards (src/data/watchPlatforms.ts) and nothing more.
 *
 * THE LINE THAT HAS NOT MOVED. Each player is the platform's own: their
 * bytes, their ads, their geo and age rules. ONIQ resolves, stores and
 * proxies no stream URL for any of them, and loads none of their SDK scripts:
 * end-of-video events arrive over the players' documented postMessage
 * channels, so script-src is untouched. Only frame-src widens, by exactly the
 * four hosts in EMBED_HOSTS, and each is declared as an automatic request in
 * src/config/playCompliance.ts. src/data/__tests__/watchEmbeds.test.ts holds
 * every part of that.
 *
 * NO LOOKUPS AT RUNTIME. A directory entry carries the platform's own id for
 * the thing it plays — a Twitch channel name, a Dailymotion video or playlist
 * id, an Internet Archive item identifier, a Vimeo video id — read off the
 * platform's public page or API by hand and recorded in watchDirectory.ts.
 * Nothing fetches a platform to find out what to play; a pasted link is
 * parsed, never resolved.
 */

export type EmbedPlatform = "vimeo" | "dailymotion" | "twitch" | "archive";

/** What a card from another platform plays, in that platform's own terms. */
export type EmbedRef =
  | { platform: "vimeo"; video: string }
  /** `live`: a 24/7 feed published as a video, e.g. a broadcaster's live stream. */
  | { platform: "dailymotion"; video: string; live?: boolean }
  | { platform: "dailymotion"; playlist: string }
  | { platform: "twitch"; channel: string }
  | { platform: "twitch"; video: string }
  | { platform: "archive"; item: string };

/** The only hosts a frame may point at. frame-src in public/_headers mirrors this. */
export const EMBED_HOSTS: Record<EmbedPlatform, string> = {
  vimeo: "player.vimeo.com",
  dailymotion: "www.dailymotion.com",
  twitch: "player.twitch.tv",
  archive: "archive.org",
};

/**
 * Every host a player frame may END UP on, redirects included. A CSP checks
 * each hop of a frame's redirect chain, not only the URL the page asked for.
 *
 * Measured 2026-09-03 with the production CSP one day old: every Dailymotion
 * embed URL answers 301 to geo.dailymotion.com/player.html, which frame-src
 * did not name, so the browser refused the frame and the owner saw a black
 * player with the Android WebView's broken-content icon on every Dailymotion
 * card. The three other players answer their embed URL directly.
 */
export const EMBED_FRAME_HOSTS: readonly string[] = [
  ...Object.values(EMBED_HOSTS),
  "geo.dailymotion.com",
];

export const EMBED_PLATFORM_NAME: Record<EmbedPlatform, string> = {
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  twitch: "Twitch",
  archive: "Internet Archive",
};

/** The id shapes the platforms issue. A malformed id is a guess, and a guess is refused. */
const ID = {
  vimeo: /^\d{6,12}$/,
  dailymotion: /^[a-z0-9]{5,12}$/i,
  twitchChannel: /^[a-z0-9_]{3,25}$/i,
  twitchVideo: /^\d{6,14}$/,
  archive: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,99}$/,
};

/** Twitch paths that are pages, not channels. */
const TWITCH_PAGES = new Set([
  "directory",
  "videos",
  "p",
  "settings",
  "downloads",
  "jobs",
  "turbo",
  "search",
  "login",
  "signup",
  "friends",
  "inventory",
  "subscriptions",
  "wallet",
  "drops",
  "prime",
]);

export function isValidEmbedRef(e: EmbedRef): boolean {
  switch (e.platform) {
    case "vimeo":
      return ID.vimeo.test(e.video);
    case "dailymotion":
      return ID.dailymotion.test("video" in e ? e.video : e.playlist);
    case "twitch":
      return "channel" in e
        ? ID.twitchChannel.test(e.channel) && !TWITCH_PAGES.has(e.channel.toLowerCase())
        : ID.twitchVideo.test(e.video);
    case "archive":
      return ID.archive.test(e.item);
  }
}

/** A stable string for React keys and effect dependencies. */
export function embedKey(e: EmbedRef): string {
  switch (e.platform) {
    case "vimeo":
      return `vimeo:${e.video}`;
    case "dailymotion":
      return "video" in e ? `dailymotion:v:${e.video}` : `dailymotion:p:${e.playlist}`;
    case "twitch":
      return "channel" in e ? `twitch:c:${e.channel}` : `twitch:v:${e.video}`;
    case "archive":
      return `archive:${e.item}`;
  }
}

/** A Twitch channel is a live feed, as is a Dailymotion video flagged live; everything else is on demand. */
export function isLiveEmbed(e: EmbedRef): boolean {
  if (e.platform === "twitch") return "channel" in e;
  if (e.platform === "dailymotion") return "video" in e && e.live === true;
  return false;
}

export type EmbedSrcOptions = {
  autoplay: boolean;
  muted: boolean;
  /** window.location.hostname — Twitch's player refuses to load without the embedding host as `parent`. */
  host: string;
  /** Resume position in seconds, where the player supports one (Vimeo, Dailymotion, Twitch videos, Archive). */
  startSeconds?: number;
};

const enc = encodeURIComponent;

/**
 * The frame's src — THE one place a platform player URL is built. Every
 * option is the platform's own documented parameter; nothing here is a
 * stream URL, and none of these hosts serves ONIQ a video file.
 */
export function embedSrc(e: EmbedRef, o: EmbedSrcOptions): string {
  const a = o.autoplay ? "1" : "0";
  const m = o.muted ? "1" : "0";
  const start = o.startSeconds && o.startSeconds > 0 ? Math.floor(o.startSeconds) : 0;
  switch (e.platform) {
    case "vimeo":
      // dnt=1 is Vimeo's own Do-Not-Track flag: no session cookie, no
      // analytics on the viewer. title/byline/portrait off keeps the frame a
      // player rather than a card. #t= is Vimeo's own resume fragment.
      return `https://player.vimeo.com/video/${enc(e.video)}?autoplay=${a}&muted=${m}&playsinline=1&dnt=1&title=0&byline=0&portrait=0${start ? `#t=${start}s` : ""}`;
    case "dailymotion": {
      const path = "video" in e ? `video/${enc(e.video)}` : `playlist/${enc(e.playlist)}`;
      // api=postMessage: the player reports `event=ended` and `timeupdate` to
      // the page, which is what the loop and progress ride. No SDK script.
      return `https://www.dailymotion.com/embed/${path}?autoplay=${a}&mute=${m}&queue-autoplay-next=1&queue-enable=0&ui-logo=0&api=postMessage${start && "video" in e ? `&start=${start}` : ""}`;
    }
    case "twitch": {
      const what = "channel" in e ? `channel=${enc(e.channel)}` : `video=${enc(e.video)}`;
      const auto = o.autoplay ? "true" : "false";
      const mute = o.muted ? "true" : "false";
      const at = start && "video" in e ? `&time=${start}s` : "";
      return `https://player.twitch.tv/?${what}&parent=${enc(o.host)}&autoplay=${auto}&muted=${mute}${at}`;
    }
    case "archive":
      // The Archive's player has no mute parameter, and an unmuted autoplay
      // is refused by every browser, so an archive item waits for a tap.
      return `https://archive.org/embed/${enc(e.item)}${start ? `?start=${start}` : ""}`;
  }
}

/** The thing's own page on its own platform — the "open on Vimeo" link. */
export function embedPageUrl(e: EmbedRef): string {
  switch (e.platform) {
    case "vimeo":
      return `https://vimeo.com/${enc(e.video)}`;
    case "dailymotion":
      return "video" in e
        ? `https://www.dailymotion.com/video/${enc(e.video)}`
        : `https://www.dailymotion.com/playlist/${enc(e.playlist)}`;
    case "twitch":
      return "channel" in e
        ? `https://www.twitch.tv/${enc(e.channel)}`
        : `https://www.twitch.tv/videos/${enc(e.video)}`;
    case "archive":
      return `https://archive.org/details/${enc(e.item)}`;
  }
}

/**
 * A pasted link into what it plays — WITHOUT asking the platform.
 *
 * The id is in the URL or the paste is unusable; a Twitch page path, a
 * Vimeo channel page or a Dailymotion user page returns null and the caller
 * says what to paste instead. YouTube links are parseYouTube's job.
 */
export function parseEmbedLink(raw: string): EmbedRef | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  let ref: EmbedRef | null = null;

  if (host === "vimeo.com") {
    // vimeo.com/<id>, vimeo.com/channels/<name>/<id>, vimeo.com/<user>/<slug>?  — only a numeric id counts.
    const id = parts.find((p) => ID.vimeo.test(p));
    if (id) ref = { platform: "vimeo", video: id };
  } else if (host === "player.vimeo.com") {
    if (parts[0] === "video" && parts[1]) ref = { platform: "vimeo", video: parts[1] };
  } else if (host === "dailymotion.com") {
    const idOf = (p: string) => p.split("_")[0];
    if (parts[0] === "video" && parts[1]) ref = { platform: "dailymotion", video: idOf(parts[1]) };
    else if (parts[0] === "playlist" && parts[1])
      ref = { platform: "dailymotion", playlist: idOf(parts[1]) };
    else if (parts[0] === "embed" && parts[1] === "video" && parts[2])
      ref = { platform: "dailymotion", video: parts[2] };
    else if (parts[0] === "embed" && parts[1] === "playlist" && parts[2])
      ref = { platform: "dailymotion", playlist: parts[2] };
  } else if (host === "dai.ly") {
    if (parts[0]) ref = { platform: "dailymotion", video: parts[0] };
  } else if (host === "twitch.tv" || host === "m.twitch.tv") {
    if (parts[0] === "videos" && parts[1]) ref = { platform: "twitch", video: parts[1] };
    else if (parts.length === 1) ref = { platform: "twitch", channel: parts[0].toLowerCase() };
  } else if (host === "player.twitch.tv") {
    const c = u.searchParams.get("channel");
    const v = u.searchParams.get("video");
    if (c) ref = { platform: "twitch", channel: c.toLowerCase() };
    else if (v) ref = { platform: "twitch", video: v.replace(/^v/, "") };
  } else if (host === "archive.org") {
    if ((parts[0] === "details" || parts[0] === "embed") && parts[1])
      ref = { platform: "archive", item: parts[1] };
  }

  return ref && isValidEmbedRef(ref) ? ref : null;
}

const VIMEO_ORIGIN = "https://player.vimeo.com";
const DAILYMOTION_ORIGIN = "https://www.dailymotion.com";

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Hear a player say ENDED, so a loop can move on — over postMessage, which
 * is what the platforms' own SDKs use underneath, minus the SDK. Twitch and
 * the Archive offer no such channel; a live feed never ends anyway, and the
 * Home auto-tour moves the card along regardless.
 *
 * Returns the function that detaches the listener.
 */
export function listenForEmbedEnded(
  e: EmbedRef,
  frame: HTMLIFrameElement,
  onEnded: () => void,
): () => void {
  const subscribeVimeo = () => {
    frame.contentWindow?.postMessage(
      JSON.stringify({ method: "addEventListener", value: "ended" }),
      VIMEO_ORIGIN,
    );
  };
  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow) return;
    if (e.platform === "vimeo" && ev.origin === VIMEO_ORIGIN) {
      const d = (typeof ev.data === "string" ? safeJson(ev.data) : ev.data) as {
        event?: string;
      } | null;
      if (!d || typeof d !== "object") return;
      if (d.event === "ready") subscribeVimeo();
      if (d.event === "ended") onEnded();
      return;
    }
    if (e.platform === "dailymotion" && ev.origin === DAILYMOTION_ORIGIN) {
      const s = typeof ev.data === "string" ? ev.data : "";
      if (/(^|&)event=(ended|video_end)(&|$)/.test(s)) onEnded();
    }
  };
  const onLoad = () => {
    if (e.platform === "vimeo") subscribeVimeo();
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", onLoad);
  return () => {
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("load", onLoad);
  };
}

/**
 * Hear a player report its POSITION, for resume and the Continue surface —
 * the same postMessage channel as ENDED. Vimeo posts `timeupdate` with
 * seconds and duration once subscribed; Dailymotion posts
 * `event=timeupdate&time=…&duration=…`. Twitch and the Archive report
 * nothing, and the person marks a position by hand instead.
 */
export function listenForEmbedTime(
  e: EmbedRef,
  frame: HTMLIFrameElement,
  onTime: (seconds: number, duration: number | null) => void,
): () => void {
  const subscribeVimeo = () => {
    frame.contentWindow?.postMessage(
      JSON.stringify({ method: "addEventListener", value: "timeupdate" }),
      VIMEO_ORIGIN,
    );
  };
  const onMessage = (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow) return;
    if (e.platform === "vimeo" && ev.origin === VIMEO_ORIGIN) {
      const d = (typeof ev.data === "string" ? safeJson(ev.data) : ev.data) as {
        event?: string;
        data?: { seconds?: number; duration?: number };
      } | null;
      if (!d || typeof d !== "object") return;
      if (d.event === "ready") subscribeVimeo();
      if (d.event === "timeupdate" && typeof d.data?.seconds === "number") {
        onTime(d.data.seconds, typeof d.data.duration === "number" ? d.data.duration : null);
      }
      return;
    }
    if (e.platform === "dailymotion" && ev.origin === DAILYMOTION_ORIGIN) {
      const s = typeof ev.data === "string" ? ev.data : "";
      if (!/(^|&)event=timeupdate(&|$)/.test(s)) return;
      const params = new URLSearchParams(s);
      const t = Number(params.get("time"));
      const dur = Number(params.get("duration"));
      if (Number.isFinite(t)) onTime(t, Number.isFinite(dur) && dur > 0 ? dur : null);
    }
  };
  const onLoad = () => {
    if (e.platform === "vimeo") subscribeVimeo();
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", onLoad);
  return () => {
    window.removeEventListener("message", onMessage);
    frame.removeEventListener("load", onLoad);
  };
}

export type EmbedCommand = "play" | "pause" | "mute" | "unmute";

/**
 * Best-effort transport over the same postMessage channel. Twitch's and the
 * Archive's players take no commands this way; their own controls sit inside
 * the frame, which is where a user of those platforms expects them.
 */
export function sendEmbedCommand(e: EmbedRef, frame: HTMLIFrameElement, cmd: EmbedCommand): void {
  const w = frame.contentWindow;
  if (!w) return;
  if (e.platform === "vimeo") {
    const msg =
      cmd === "play"
        ? { method: "play" }
        : cmd === "pause"
          ? { method: "pause" }
          : { method: "setMuted", value: cmd === "mute" };
    w.postMessage(JSON.stringify(msg), VIMEO_ORIGIN);
  } else if (e.platform === "dailymotion") {
    const msg =
      cmd === "play"
        ? "play"
        : cmd === "pause"
          ? "pause"
          : cmd === "mute"
            ? "muted=true"
            : "muted=false";
    w.postMessage(msg, DAILYMOTION_ORIGIN);
  }
}
