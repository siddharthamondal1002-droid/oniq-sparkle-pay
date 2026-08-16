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
 * TWO PATHS, because the roster has two kinds of channel:
 *   - a live broadcaster (src/data/watchChannels.ts) gets a raw frame on
 *     youtube.com/embed/live_stream, with the API attached to it afterwards
 *     purely to hear onError. It is NOT autoplayed: a 24/7 news feed starting
 *     itself is a different thing from a playlist looping, and liveEmbedUrl
 *     has never carried autoplay=1.
 *   - everything else gets its uploads playlist through YT.Player, which is
 *     what loops, and which autoplays MUTED — the only kind of autoplay a
 *     browser will honour.
 */
import { useEffect, useId, useRef } from "react";
import { liveEmbedUrl } from "@/data/watchChannels";
import { isLiveChannel, uploadsPlaylistId, type WatchEntry } from "@/data/watchDirectory";

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
};

export function WatchPlayer({
  entry,
  autoplay = true,
  controls = true,
  onAdvance,
  onReady,
  className = "h-full w-full",
}: {
  entry: WatchEntry;
  /** Muted autoplay. Ignored for a live feed, which never starts itself. */
  autoplay?: boolean;
  /** YouTube's own controls. Off only for the Home tile, which has its own. */
  controls?: boolean;
  /** Called when the current item ends or fails, so the caller can rotate. */
  onAdvance?: (reason: AdvanceReason) => void;
  /** Handed the player once it exists, for mute/pause buttons outside the frame. */
  onReady?: (handle: WatchPlayerHandle | null) => void;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  // Held in refs so a changed callback identity does not tear the player down
  // and restart the video mid-play.
  const advanceRef = useRef(onAdvance);
  const readyRef = useRef(onReady);
  useEffect(() => {
    advanceRef.current = onAdvance;
    readyRef.current = onReady;
  }, [onAdvance, onReady]);

  const hostId = `yt-${useId().replace(/[:]/g, "")}`;
  const channelId = entry.channelId;
  const live = isLiveChannel(channelId);
  const list = uploadsPlaylistId(entry);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!channelId) return;
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
    if (live) {
      const frame = document.createElement("iframe");
      frame.src = liveEmbedUrl(channelId, window.location.origin);
      frame.title = entry.name;
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

    // PLAYLIST PATH. This is the loop.
    if (!list) return;
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
          playerVars: {
            list,
            listType: "playlist",
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
                e.target.getIframe?.()?.setAttribute("title", entry.name);
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
            },
          },
        });
      } catch {
        /* noop — the caller's empty state covers it */
      }
    });

    return teardown;
    // hostId is stable for the component's life; entry.name only labels the
    // frame. Re-creating the player on either would restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, live, list, autoplay, controls]);

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
  };
}
