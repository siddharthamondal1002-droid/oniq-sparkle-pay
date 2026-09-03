/**
 * The Watch loop player — restored, not reinvented.
 *
 * Owner directive, 2026-08-16 (evening): "loop player in home screen toggle
 * like before with autoplay". `loadYouTubeApi` below and the two-path player
 * construction are lifted from the component this replaces,
 * src/components/landing/LiveNewsSection.tsx as it stood at d879305b^, which
 * is where both shapes were worked out originally.
 *
 * WHAT THE IFRAME PLAYER API BUYS, and why it is back after being deliberately
 * kept out earlier the same day. A plain <iframe> can show a video; it cannot
 * tell the page that the video ENDED or ERRORED. A loop needs both — that is
 * the whole of a loop — and autoplay needs `playVideo()` on ready because the
 * URL parameter alone is unreliable inside a WebView. So script-src carries
 * www.youtube.com and s.ytimg.com again (public/_headers), and the tests that
 * asserted the API stays out now assert the opposite for the same reason.
 *
 * WHAT IT STILL DOES NOT BUY, and this is the line that matters: the API
 * OPERATES YouTube's player. It does not hand ONIQ the video. No stream URL is
 * resolved, stored or proxied anywhere in this file — YouTube serves the
 * content, its ads, and its own geo and age restrictions, exactly as before.
 * src/data/__tests__/watchDirectory.test.ts fails if that ever changes.
 *
 * THREE PATHS, one per Playable kind (see src/data/watchDirectory.ts):
 *   - `live` — a broadcaster from src/data/watchChannels.ts gets a raw frame
 *     on youtube.com/embed/live_stream, with the API attached to it afterwards
 *     purely to hear onError. It is NOT autoplayed: a 24/7 news feed starting
 *     itself is a different thing from a playlist looping, and liveEmbedUrl
 *     has never carried autoplay=1.
 *   - `playlist` — a channel's uploads, or a playlist the user pasted, through
 *     YT.Player. This is what loops.
 *   - `video` — a single video the user pasted into a genre of their own.
 *     Same player, same events; the caller's rotation moves it along.
 * The last two autoplay MUTED, the only kind of autoplay a browser honours.
 *
 * The player is deliberately blind to WHERE a Playable came from — directory,
 * My TV, or a user's own genre all arrive in the same shape.
 *
 * A FOURTH PATH, 2026-09-03 (owner directive, afternoon: "make them just like
 * we have youtube in watch"):
 *   - `embed` — another platform's OWN player (Vimeo, Dailymotion, Twitch,
 *     the Internet Archive) in a plain frame whose src is built in exactly
 *     one place, src/data/watchEmbeds.ts. No SDK script is loaded for any of
 *     them: ENDED arrives over the players' documented postMessage channels
 *     where one exists, and the transport buttons speak the same channel.
 *     Same rule as YouTube's — the platform serves the video, its ads and
 *     its own restrictions; ONIQ operates the player and never touches the
 *     stream.
 */
import { useEffect, useId, useRef } from "react";
import { liveEmbedUrl } from "@/data/watchChannels";
import type { Playable } from "@/data/watchDirectory";
import {
  embedKey,
  embedSrc,
  listenForEmbedEnded,
  listenForEmbedTime,
  sendEmbedCommand,
  type EmbedRef,
} from "@/data/watchEmbeds";

const YT_API_SRC = "https://www.youtube.com/iframe_api";

/** The reason a loop moved on, so a caller can count errors without counting ends. */
export type AdvanceReason = "error" | "ended";

// The API is a global with no types shipped; `any` is the honest annotation.
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Load YouTube's IFrame Player API once per page, whoever asks first.
 *
 * Verbatim from d879305b^ apart from the return type. The two things it is
 * careful about are both load-order bugs that have bitten this file before:
 * a second caller must not inject a second <script>, and a caller that
 * arrives after the API is already up must resolve immediately rather than
 * wait for an `onYouTubeIframeAPIReady` that has already fired.
 */
export function loadYouTubeApi(): Promise<any> {
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (w.__ytApiPromise) return w.__ytApiPromise;
  w.__ytApiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") {
        try {
          prev();
        } catch {
          /* noop */
        }
      }
      resolve(w.YT);
    };
    if (!document.querySelector(`script[src="${YT_API_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = YT_API_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
  return w.__ytApiPromise;
}

export type WatchPlayerHandle = {
  play: () => void;
  pause: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  /** Where playback is, in seconds, or null when the player does not say. */
  currentTime: () => number | null;
};

/** How often a playing YouTube video reports its position to onProgress. */
const PROGRESS_POLL_MS = 5000;

export function WatchPlayer({
  item,
  autoplay = true,
  controls = true,
  onAdvance,
  onReady,
  startSeconds,
  onProgress,
  className = "h-full w-full",
}: {
  item: Playable;
  /** Muted autoplay. Ignored for a live feed, which never starts itself. */
  autoplay?: boolean;
  /** YouTube's own controls. Off only for the Home tile, which has its own. */
  controls?: boolean;
  /** Called when the current item ends or fails, so the caller can rotate. */
  onAdvance?: (reason: AdvanceReason) => void;
  /** Handed the player once it exists, for mute/pause buttons outside the frame. */
  onReady?: (handle: WatchPlayerHandle | null) => void;
  /**
   * Resume here (owner mission, 2026-09-03: the Watch library's Continue).
   * Honoured by YouTube videos, Vimeo, Dailymotion videos, Twitch videos and
   * the Archive; a live feed or a playlist ignores it.
   */
  startSeconds?: number;
  /**
   * Playback position, as the player reports it — YouTube polled every few
   * seconds while playing, Vimeo and Dailymotion over postMessage. Twitch
   * and the Archive report nothing.
   */
  onProgress?: (seconds: number, duration: number | null) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  // Held in refs so a changed callback identity does not tear the player down
  // and restart the video mid-play.
  const advanceRef = useRef(onAdvance);
  const readyRef = useRef(onReady);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    advanceRef.current = onAdvance;
    readyRef.current = onReady;
    progressRef.current = onProgress;
  }, [onAdvance, onReady, onProgress]);
  // The start position is read once, when the player mounts; a later change
  // must not rebuild the player mid-play.
  const startRef = useRef(startSeconds ?? 0);

  const hostId = `yt-${useId().replace(/[:]/g, "")}`;
  const kind = item.kind;
  const name = item.name;
  // Flattened out of the union so the effect's dep array is primitives, not a
  // fresh object literal every render — which would rebuild the player each
  // time the parent re-rendered and restart the video mid-play.
  const ref =
    item.kind === "live"
      ? item.channelId
      : item.kind === "playlist"
        ? item.list
        : item.kind === "embed"
          ? embedKey(item.embed)
          : item.videoId;
  // The embed path needs the whole ref inside the effect; `ref` above is its
  // stable key, so a changed EmbedRef always changes `ref` too.
  const embedRef = useRef<EmbedRef | null>(item.kind === "embed" ? item.embed : null);
  useEffect(() => {
    embedRef.current = item.kind === "embed" ? item.embed : null;
  }, [item]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const teardown = () => {
      cancelled = true;
      readyRef.current?.(null);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      playerRef.current = null;
      host.innerHTML = "";
    };

    // LIVE PATH. A raw frame first so the stream shows even if the API never
    // loads, then the API attached to that same frame just to hear onError.
    if (kind === "live") {
      const frame = document.createElement("iframe");
      frame.src = liveEmbedUrl(ref, window.location.origin);
      frame.title = name;
      frame.allow = "encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      // 200px is the minimum player size the embed grant requires; see
      // YT_MIN_PLAYER_PX in src/data/watchChannels.ts.
      frame.style.cssText =
        "width:100%;height:100%;border:0;min-width:200px;min-height:200px;position:absolute;inset:0";
      host.innerHTML = "";
      host.appendChild(frame);
      loadYouTubeApi().then((YT) => {
        if (cancelled || !YT?.Player) return;
        try {
          playerRef.current = new YT.Player(frame, {
            events: {
              onReady: (e: any) => readyRef.current?.(handleOf(e.target)),
              onError: () => advanceRef.current?.("error"),
            },
          });
        } catch {
          /* the frame is already showing; the loop just loses its error signal */
        }
      });
      return teardown;
    }

    // EMBED PATH. Another platform's own player in a plain frame. The src is
    // built in src/data/watchEmbeds.ts and nowhere else; ENDED and the
    // transport ride that module's postMessage helpers. Muted autoplay, the
    // same as the YouTube paths, where the platform's player supports it.
    if (kind === "embed") {
      const embed = embedRef.current;
      if (!embed) return;
      const frame = document.createElement("iframe");
      frame.src = embedSrc(embed, {
        autoplay,
        muted: true,
        host: window.location.hostname,
        startSeconds: startRef.current,
      });
      frame.title = name;
      frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.style.cssText =
        "width:100%;height:100%;border:0;min-width:200px;min-height:200px;position:absolute;inset:0";
      host.innerHTML = "";
      host.appendChild(frame);
      let mutedFlag = true;
      let lastTime: number | null = null;
      readyRef.current?.({
        play: () => sendEmbedCommand(embed, frame, "play"),
        pause: () => sendEmbedCommand(embed, frame, "pause"),
        mute: () => {
          sendEmbedCommand(embed, frame, "mute");
          mutedFlag = true;
        },
        unMute: () => {
          sendEmbedCommand(embed, frame, "unmute");
          mutedFlag = false;
        },
        isMuted: () => mutedFlag,
        currentTime: () => lastTime,
      });
      const stop = listenForEmbedEnded(embed, frame, () => advanceRef.current?.("ended"));
      const stopTime = listenForEmbedTime(embed, frame, (seconds, duration) => {
        lastTime = seconds;
        progressRef.current?.(seconds, duration);
      });
      return () => {
        stop();
        stopTime();
        teardown();
      };
    }

    // PLAYLIST / VIDEO PATH. The playlist case is what loops; a single video
    // ends and the caller's rotation moves it on. Same player either way.
    let progressTimer: number | null = null;
    const div = document.createElement("div");
    div.id = hostId;
    div.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    host.innerHTML = "";
    host.appendChild(div);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT?.Player) return;
      try {
        playerRef.current = new YT.Player(div.id, {
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          ...(kind === "video" ? { videoId: ref } : {}),
          playerVars: {
            ...(kind === "playlist" ? { list: ref, listType: "playlist" } : {}),
            ...(kind === "video" && startRef.current > 0
              ? { start: Math.floor(startRef.current) }
              : {}),
            autoplay: autoplay ? 1 : 0,
            // MUTED, always. An unmuted autoplay is refused by every browser
            // and by the Android WebView, so this is what autoplay means —
            // the speaker button next to the frame is how sound gets turned on.
            mute: 1,
            playsinline: 1,
            rel: 0,
            controls: controls ? 1 : 0,
            modestbranding: 1,
            cc_load_policy: 1,
            cc_lang_pref: "en",
          },
          events: {
            onReady: (e: any) => {
              try {
                e.target.getIframe?.()?.setAttribute("title", name);
                e.target.mute();
                if (autoplay) e.target.playVideo();
              } catch {
                /* noop */
              }
              readyRef.current?.(handleOf(e.target));
            },
            onError: () => advanceRef.current?.("error"),
            onStateChange: (e: any) => {
              if (e?.data === 0) advanceRef.current?.("ended");
              // PROGRESS. Polled only while PLAYING (state 1) so a paused or
              // ended video reports nothing; the timer clears itself otherwise.
              if (progressTimer) {
                window.clearInterval(progressTimer);
                progressTimer = null;
              }
              if (e?.data === 1 && progressRef.current) {
                progressTimer = window.setInterval(() => {
                  try {
                    const p = playerRef.current;
                    const t = p?.getCurrentTime?.();
                    const d = p?.getDuration?.();
                    if (typeof t === "number") {
                      progressRef.current?.(t, typeof d === "number" && d > 0 ? d : null);
                    }
                  } catch {
                    /* noop */
                  }
                }, PROGRESS_POLL_MS);
              }
            },
          },
        });
      } catch {
        /* noop — the caller's empty state covers it */
      }
    });

    return () => {
      if (progressTimer) window.clearInterval(progressTimer);
      teardown();
    };
    // hostId is stable for the component's life; `name` only labels the frame.
    // Re-creating the player on either would restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ref, autoplay, controls]);

  return <div ref={hostRef} className={className} data-testid="watch-embed" />;
}

function handleOf(p: any): WatchPlayerHandle {
  return {
    play: () => {
      try {
        p.playVideo?.();
      } catch {
        /* noop */
      }
    },
    pause: () => {
      try {
        p.pauseVideo?.();
      } catch {
        /* noop */
      }
    },
    mute: () => {
      try {
        p.mute?.();
      } catch {
        /* noop */
      }
    },
    unMute: () => {
      try {
        p.unMute?.();
      } catch {
        /* noop */
      }
    },
    isMuted: () => {
      try {
        return typeof p.isMuted === "function" ? !!p.isMuted() : true;
      } catch {
        return true;
      }
    },
    currentTime: () => {
      try {
        const t = p.getCurrentTime?.();
        return typeof t === "number" && Number.isFinite(t) ? t : null;
      } catch {
        return null;
      }
    },
  };
}
