/**
 * Watch — the screen it was, restored.
 *
 * Owner directive, 2026-08-16 (evening): channels PLAY here, and the loop
 * player is back "like before with autoplay". The shape below — genre tabs
 * across the top, the LIVE/NEW badge ABOVE the frame, the player, the
 * transport row, then the channel strip — is the layout of the component this
 * replaces, src/components/landing/LiveNewsSection.tsx at d879305b^. It is
 * recovered rather than redesigned.
 *
 * THE ONE DISTINCTION THE WHOLE SCREEN RESTS ON. Playing means an iframe
 * holding YOUTUBE'S OWN player: YouTube serves the video, serves its ads,
 * enforces its own geo-restrictions and age gates, and the channel owner
 * decides whether embedding is allowed at all. The IFrame Player API operates
 * that player — start, stop, mute, and the ended/error events a loop is built
 * out of. It never hands ONIQ the video.
 *
 * What it must never become is the retired `live-channels` shape: resolving a
 * stream URL server-side — with a spoofed browser User-Agent and a consent
 * cookie, as that function did — and feeding it to a player of ONIQ's own.
 * That strips YouTube's ads, puts ONIQ in the delivery path, and breaks their
 * terms. watchDirectory.test.ts fails if a stream URL is ever fetched, stored
 * or played, which is the line worth guarding rather than "no player".
 *
 * NOTHING IS DRAWN OVER THE FRAME. That is a condition of the embed grant and
 * it is the thing a later "improvement" breaks by accident, so the LIVE badge
 * sits above the player and the transport row sits below it — never on top.
 * The original carried this same note for the same reason.
 *
 * STILL NO THUMBNAILS FROM THE DESTINATION. An <img> on YouTube's thumbnail
 * host fires the moment the STRIP renders, for every channel, with no user
 * decision involved — further than the embed goes, which only loads once
 * somebody picks a channel. Hence the genre glyph on every card.
 *
 * INDIA-ONLY is enforced in src/data/countryRegistry.ts, not here, so the
 * Home tile and this route agree by construction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  LINK_OUT_LABEL,
  WATCH_NOTICE,
  channelUrl,
  embedUrl,
  isLiveChannel,
  watchDirectoryFor,
  type WatchEntry,
  type WatchGenre,
} from "@/data/watchDirectory";
import { WatchPlayer, type WatchPlayerHandle } from "@/components/watch/WatchPlayer";
import { openInApp } from "@/lib/miniapps";
import { isAvailable } from "@/data/countryRegistry";
import { useCountry } from "@/lib/country";
import { useMediaCoordinator } from "@/lib/MediaProvider";

export const Route = createFileRoute("/_authenticated/app/watch")({
  component: WatchPage,
});

/**
 * The genre glyph, standing in for artwork we deliberately do not fetch.
 * Order is the order of the tab row.
 */
const GENRES: { key: WatchGenre; label: string; emoji: string }[] = [
  { key: "news", label: "News", emoji: "📰" },
  { key: "sports", label: "Sports", emoji: "🏏" },
  { key: "entertainment", label: "Entertainment", emoji: "🎬" },
  { key: "finance", label: "Finance", emoji: "📈" },
  { key: "influencer", label: "Creators", emoji: "✨" },
  { key: "lifestyle", label: "Lifestyle", emoji: "🌿" },
];

const EMOJI_BY_GENRE = new Map(GENRES.map((g) => [g.key, g.emoji]));

/** Survives a tab away and back, the way the original's did. */
const LAST_CHANNEL_KEY = "oniq.watch.last";
const LAST_GENRE_KEY = "oniq.watch.lastGenre";

function keyOf(e: WatchEntry): string {
  return e.channelId ?? e.handle ?? e.name;
}

function WatchPage() {
  const [home] = useCountry();
  const media = useMediaCoordinator();
  const [genre, setGenre] = useState<WatchGenre | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const v = localStorage.getItem(LAST_GENRE_KEY);
      return GENRES.some((g) => g.key === v) ? (v as WatchGenre) : null;
    } catch {
      return null;
    }
  });
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dead, setDead] = useState(false);
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const failStreakRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const resumedRef = useRef(false);

  /**
   * The FULL verified roster, not the India slice.
   *
   * `watchDirectoryFor(null)` returns every verified entry; passing "IN" would
   * drop channels tagged for other markets. The owner gated the SURFACE to
   * India (2026-08-16), not the shelf — an Indian user can still open a
   * British or American channel, which is the whole point of a directory.
   */
  const all = useMemo(() => watchDirectoryFor(null), []);

  /** Only channels with something to play sit in the strip; the rest link out. */
  const playable = useMemo(() => all.filter((e) => embedUrl(e) !== null), [all]);
  const linkOnly = useMemo(() => all.filter((e) => embedUrl(e) === null), [all]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return playable.filter((e) => {
      if (genre && e.genre !== genre) return false;
      if (!needle) return true;
      return e.name.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle);
    });
  }, [playable, genre, q]);

  /** Counts come from the unfiltered roster, so a tab never reads "0" mid-search. */
  const countFor = useMemo(() => {
    const m = new Map<WatchGenre, number>();
    for (const e of playable) m.set(e.genre, (m.get(e.genre) ?? 0) + 1);
    return m;
  }, [playable]);

  const current = shown.length ? shown[idx % shown.length] : null;
  const live = isLiveChannel(current?.channelId);

  // Resume the last channel watched, once, on the first non-empty list.
  useEffect(() => {
    if (resumedRef.current || shown.length === 0) return;
    resumedRef.current = true;
    try {
      const last = localStorage.getItem(LAST_CHANNEL_KEY);
      if (last) {
        const found = shown.findIndex((e) => keyOf(e) === last);
        if (found >= 0) setIdx(found);
      }
    } catch {
      /* noop */
    }
  }, [shown]);

  // Persist channel + genre so Home and this screen restore the same state.
  useEffect(() => {
    try {
      if (current) localStorage.setItem(LAST_CHANNEL_KEY, keyOf(current));
      if (genre) localStorage.setItem(LAST_GENRE_KEY, genre);
      else localStorage.removeItem(LAST_GENRE_KEY);
    } catch {
      /* noop */
    }
  }, [current, genre]);

  // The loop. An ENDED playlist rolls to the next channel; an ERROR does too,
  // but errors are counted — once every channel in the tab has failed the
  // screen says so instead of spinning through them forever. Lifted from
  // advance() in the original component.
  const advance = useCallback(
    (reason: "error" | "ended") => {
      const total = shown.length;
      if (total === 0) {
        setDead(true);
        return;
      }
      if (reason === "error") failStreakRef.current += 1;
      if (failStreakRef.current >= total) {
        setDead(true);
        return;
      }
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = window.setTimeout(() => {
        setIdx((i) => (i + 1) % total);
      }, 500);
    },
    [shown.length],
  );

  useEffect(
    () => () => {
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    },
    [],
  );

  const bindPlayer = useCallback((h: WatchPlayerHandle | null) => {
    playerRef.current = h;
    setPaused(false);
    setMuted(true);
  }, []);

  const pick = (i: number) => {
    failStreakRef.current = 0;
    setDead(false);
    setPaused(false);
    setIdx(i);
  };

  const pickGenre = (g: WatchGenre | null) => {
    failStreakRef.current = 0;
    setDead(false);
    setPaused(false);
    setGenre(g);
    setIdx(0);
  };

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      // Unmuting is the user gesture, so this is where the single-audio-source
      // coordinator is told a new surface owns the speaker.
      media.register({ pause: () => p.pause(), mute: () => p.mute() });
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (paused) {
      p.play();
      setPaused(false);
    } else {
      p.pause();
      setPaused(true);
    }
  };

  // EVERY HOOK IS ABOVE THIS RETURN. rules-of-hooks is a release blocker in
  // this repo, and a country check is exactly the kind of early return that
  // tempts a hook underneath it.
  if (!isAvailable("watch", home)) {
    return (
      <div className="min-h-dvh bg-background pb-24 text-foreground">
        <Header />
        <div className="mx-auto max-w-2xl px-4">
          <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Watch isn&apos;t in ONIQ where you are yet 🌍
          </div>
        </div>
      </div>
    );
  }

  const url = current ? channelUrl(current) : null;

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      <Header />

      <div className="mx-auto max-w-2xl px-4">
        {/* TABS */}
        <div className="no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          <Chip active={genre === null} onClick={() => pickGenre(null)}>
            All {playable.length}
          </Chip>
          {GENRES.map((g) => (
            <Chip key={g.key} active={genre === g.key} onClick={() => pickGenre(g.key)}>
              {g.emoji} {g.label} {countFor.get(g.key) ?? 0}
            </Chip>
          ))}
        </div>

        {/*
          LIVE/NEW, ABOVE THE FRAME AND NOT OVER IT. This badge used to sit
          `absolute top-2 left-2 z-10` on top of the player, which voids the
          embed grant — YouTube forbids rendering anything in front of any
          part of the player, controls included. Enforced by
          src/data/__tests__/watchChannels.test.ts.
        */}
        {current && (
          <span
            className={`mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              live
                ? "border-red-500/50 bg-red-500/20 text-red-300"
                : "border-primary/50 bg-primary/20 text-primary"
            }`}
          >
            {live ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                </span>
                LIVE
              </>
            ) : (
              "LOOP"
            )}
          </span>
        )}

        {/* THE PLAYER. Nothing but the mount goes inside this box. */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
          {dead || !current ? (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
              {shown.length === 0
                ? "nothing here for that 🔍"
                : "streams are napping — try later 📺"}
            </div>
          ) : (
            <WatchPlayer
              key={keyOf(current)}
              entry={current}
              autoplay
              onAdvance={advance}
              onReady={bindPlayer}
              className="absolute inset-0 h-full w-full"
            />
          )}
        </div>

        {/* TRANSPORT, BELOW THE FRAME. */}
        {current && !dead && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
              <Ctrl label="Previous channel" onClick={() => pick(idx - 1 + shown.length)}>
                <SkipBack className="size-4" />
              </Ctrl>
              <Ctrl label={paused ? "Play" : "Pause"} onClick={togglePlay}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </Ctrl>
              <Ctrl label="Next channel" onClick={() => pick(idx + 1)}>
                <SkipForward className="size-4" />
              </Ctrl>
              <Ctrl label={muted ? "Unmute" : "Mute"} onClick={toggleMute} pressed={muted}>
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Ctrl>
            </div>
            <div className="min-w-0 flex-1 truncate text-xs font-semibold">{current.name}</div>
            {url && (
              <button
                type="button"
                onClick={() => openInApp(url)}
                className="press inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold"
              >
                YouTube <ExternalLink className="size-3" />
              </button>
            )}
          </div>
        )}

        {/* SEARCH */}
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
              failStreakRef.current = 0;
              setDead(false);
            }}
            placeholder="Search channels"
            aria-label="Search channels"
            data-testid="watch-search"
            className="w-full rounded-full border border-border bg-card py-2.5 ps-9 pe-9 text-sm outline-none focus:border-primary"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* THE STRIP */}
        {shown.length > 0 && (
          <div
            className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1"
            data-testid="watch-list"
          >
            {shown.map((e, i) => {
              const active = current ? keyOf(current) === keyOf(e) : false;
              return (
                <button
                  key={keyOf(e)}
                  type="button"
                  data-testid="watch-play"
                  onClick={() => pick(i)}
                  aria-label={`Play ${e.name}`}
                  aria-current={active}
                  className={`press w-40 shrink-0 text-left ${active ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                >
                  {/* A GLYPH, NOT ARTWORK — see the file header for why the
                      destination's own thumbnail host must never appear here. */}
                  <div
                    className={`grid aspect-video place-items-center rounded-lg border bg-surface-2 text-2xl ${
                      active ? "border-primary" : "border-border"
                    }`}
                  >
                    {EMOJI_BY_GENRE.get(e.genre) ?? "📺"}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">
                    {e.name}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {isLiveChannel(e.channelId) ? "live feed" : "uploads"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Channels known only by @handle: no playlist can be derived from a
            handle, so they stay honest link-outs rather than a dead play button. */}
        {linkOnly.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              also on YouTube
            </div>
            <ul className="flex flex-wrap gap-2">
              {linkOnly.map((e) => {
                const link = channelUrl(e);
                if (!link) return null;
                return (
                  <li key={keyOf(e)}>
                    <button
                      type="button"
                      data-testid="watch-link"
                      onClick={() => openInApp(link)}
                      aria-label={`${e.name} — ${LINK_OUT_LABEL}`}
                      className="press inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs"
                    >
                      {EMOJI_BY_GENRE.get(e.genre) ?? "📺"} {e.name}
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mx-auto mb-4 max-w-2xl px-4 pt-4">
      <Link to="/app" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" /> Home
      </Link>
      <div className="mt-3 text-[11px] uppercase tracking-wider text-primary/80">watch 📺</div>
      <h1 className="font-display text-2xl font-bold">channels, not a channel</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Plays in YouTube&apos;s own player. ONIQ keeps the list, not the stream.
      </p>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`press shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground shadow-[0_0_16px_-4px_var(--primary)]"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Ctrl({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className="press grid size-8 place-items-center rounded-full text-foreground"
    >
      {children}
    </button>
  );
}
