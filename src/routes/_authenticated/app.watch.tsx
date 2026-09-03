/**
 * Watch — the screen it was, restored.
 *
 * Owner directive, 2026-08-16 (evening): channels PLAY here, the loop player
 * is back "like before with autoplay", and the genre row carries My TV and the
 * user's own genres again. The shape below — genre tabs across the top, the
 * LIVE badge ABOVE the frame, the player, the transport row, then the channel
 * strip — is the layout of the component this replaces,
 * src/components/landing/LiveNewsSection.tsx at d879305b^. It is recovered
 * rather than redesigned.
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
 * watchDirectory.test.ts fails if a stream URL is ever fetched, stored or
 * played, which is the line worth guarding rather than "no player".
 *
 * NOTHING IS DRAWN OVER THE FRAME. That is a condition of the embed grant and
 * it is the thing a later "improvement" breaks by accident, so the LIVE badge
 * sits above the player and the transport row sits below it — never on top.
 *
 * STILL NO THUMBNAILS FROM THE DESTINATION, and this now covers the user's own
 * channels too. The original built `i.ytimg.com/vi/<id>/hqdefault.jpg` for
 * every My TV card, which fires a request to Google's thumbnail host the
 * moment the STRIP renders, for every entry, with no user decision involved.
 * The embed only loads once somebody picks a channel. Hence the glyph.
 *
 * INDIA-ONLY is enforced in src/data/countryRegistry.ts, not here, so the
 * Home card and this route agree by construction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  LINK_OUT_LABEL,
  WATCH_NOTICE,
  channelUrl,
  channelUrlOf,
  faithChannelsFor,
  isLiveChannel,
  isLivePlayable,
  platformNameOf,
  playableOf,
  playableOfChannelId,
  watchDirectoryFor,
  type Playable,
  type WatchGenre,
} from "@/data/watchDirectory";
import {
  DEVOTIONAL_GENRE_ID,
  clearLoop,
  loopPhase,
  readFaithPref,
  readLoop,
  writeLoop,
  type LoopState,
} from "@/lib/devotionalLoop";
import {
  DevotionalEnded,
  DevotionalPicker,
  DevotionalRunning,
} from "@/components/watch/DevotionalLoop";
import { WatchPlayer, type WatchPlayerHandle } from "@/components/watch/WatchPlayer";
import {
  AddChannelSheet,
  AddGenreSheet,
  MyTvManageSheet,
} from "@/components/watch/UserWatchSheets";
import {
  MYTV_GENRE_ID,
  USER_GENRE_PREFIX,
  playableOfMyTv,
  playableOfUserChannel,
  useMyTv,
  useSession,
  useUserChannels,
  useUserGenres,
  type UserGenreRow,
} from "@/lib/userWatch";
import { supabase } from "@/integrations/supabase/client";
import { openInApp } from "@/lib/miniapps";
import { NOT_AFFILIATED_NOTICE } from "@/config/playCompliance";
import { PLATFORM_KIND_LABEL, opensIn, watchPlatformsFor } from "@/data/watchPlatforms";
import { EMBED_PLATFORM_NAME, embedKey, isLiveEmbed } from "@/data/watchEmbeds";
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
  { key: "film", label: "Films", emoji: "🎥" },
];

const EMOJI_BY_GENRE = new Map(GENRES.map((g) => [g.key, g.emoji]));

/** Survives a tab away and back, the way the original's did. */
const LAST_CHANNEL_KEY = "oniq.watch.last";
const LAST_GENRE_KEY = "oniq.watch.lastGenre";

/** What the strip shows and the player plays, whatever the source. */
type Card = { key: string; name: string; sub: string; emoji: string; item: Playable };

function WatchPage() {
  const [home] = useCountry();
  const media = useMediaCoordinator();
  const userId = useSession();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      return localStorage.getItem(LAST_GENRE_KEY) || "all";
    } catch {
      return "all";
    }
  });
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dead, setDead] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [addGenreOpen, setAddGenreOpen] = useState(false);
  const [addChannelFor, setAddChannelFor] = useState<{ id: string; name: string } | null>(null);
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const failStreakRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const resumedRef = useRef(false);

  const userGenresQ = useUserGenres(userId);
  const myTvQ = useMyTv(userId);
  const userGenres = useMemo(() => userGenresQ.data ?? [], [userGenresQ.data]);

  const activeUserGenre: UserGenreRow | null = useMemo(() => {
    if (!tab.startsWith(USER_GENRE_PREFIX)) return null;
    const id = tab.slice(USER_GENRE_PREFIX.length);
    return userGenres.find((g) => g.id === id) ?? null;
  }, [tab, userGenres]);

  const userChannelsQ = useUserChannels(userId, activeUserGenre?.id ?? null);
  const userChannels = useMemo(() => userChannelsQ.data ?? [], [userChannelsQ.data]);

  // DEVOTIONAL LOOP. Anchored to real timestamps in localStorage, so leaving
  // the app and coming back resumes rather than restarts — see the reasoning
  // in src/lib/devotionalLoop.ts.
  const faith = useMemo(() => readFaithPref(), []);
  const [loop, setLoop] = useState<LoopState>(() => readLoop());
  const [justBrowse, setJustBrowse] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const isDevotional = tab === DEVOTIONAL_GENRE_ID;
  const phase = isDevotional ? loopPhase(loop, nowTs) : "none";
  const loopActive = phase === "active";
  const loopEnded = phase === "ended";
  const showPicker = isDevotional && !loopActive && !loopEnded && !justBrowse;

  // Ticks once a second, and ONLY while a devotional loop is running, so the
  // countdown is live without a timer burning on every other tab.
  useEffect(() => {
    if (!isDevotional || !loop) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isDevotional, loop]);

  // Leaving devotional resets "just browse" so re-entering offers the picker.
  useEffect(() => {
    if (!isDevotional) setJustBrowse(false);
  }, [isDevotional]);

  /**
   * The FULL verified roster, not the India slice.
   *
   * `watchDirectoryFor(null)` returns every verified entry; passing "IN" would
   * drop channels tagged for other markets. The owner gated the SURFACE to
   * India (2026-08-16), not the shelf — an Indian user can still open a
   * British or American channel, which is the whole point of a directory.
   */
  const all = useMemo(() => watchDirectoryFor(null), []);

  /** Directory entries that can play; the rest are honest link-outs below. */
  const playableDir = useMemo(
    () =>
      all
        .map((e) => {
          const item = playableOf(e);
          // A card from another platform is keyed by its EmbedRef and says
          // which player it opens in; a YouTube card reads as it always did.
          const sub = e.embed
            ? isLiveEmbed(e.embed)
              ? `${EMBED_PLATFORM_NAME[e.embed.platform]} live`
              : EMBED_PLATFORM_NAME[e.embed.platform].toLowerCase()
            : isLiveChannel(e.channelId)
              ? "live feed"
              : "uploads";
          return item
            ? {
                key: e.embed ? embedKey(e.embed) : (e.channelId as string),
                name: e.name,
                sub,
                emoji: EMOJI_BY_GENRE.get(e.genre) ?? "📺",
                genre: e.genre,
                description: e.description,
                item,
              }
            : null;
        })
        .filter(Boolean) as (Card & { genre: WatchGenre; description: string })[],
    [all],
  );
  const linkOnly = useMemo(() => all.filter((e) => playableOf(e) === null), [all]);

  /**
   * OTHER PLACES TO WATCH (owner directive, 2026-09-03). The full shelf, the
   * same way `all` is: the surface is India-gated, the list is not. Each one
   * opens on its own site — see src/data/watchPlatforms.ts for why none of
   * them is framed.
   */
  const platforms = useMemo(() => watchPlatformsFor(null), []);

  const myTvCards: Card[] = useMemo(
    () =>
      (myTvQ.data ?? [])
        .map((r) => {
          const item = playableOfMyTv(r);
          return item
            ? { key: `mytv:${r.channel_id}`, name: r.name, sub: "yours", emoji: "📺", item }
            : null;
        })
        .filter(Boolean) as Card[],
    [myTvQ.data],
  );

  const userGenreCards: Card[] = useMemo(
    () =>
      userChannels
        .map((r) => {
          const item = playableOfUserChannel(r);
          return item ? { key: `uc:${r.id}`, name: r.name, sub: "yours", emoji: "🎯", item } : null;
        })
        .filter(Boolean) as Card[],
    [userChannels],
  );

  /**
   * DEVOTIONAL. Strict faith isolation, carried over rather than inherited:
   * the roster is whatever `faithChannelsFor` returns for THIS user's faith
   * and nothing else. No default list, no index-based access, and a faith
   * with no channels gets its own empty state — that was the Jain bleed bug.
   */
  const devotionalCards: Card[] = useMemo(
    () =>
      faithChannelsFor(faith)
        .map((e) => {
          const item = playableOfChannelId(e.channelId, e.name);
          return item
            ? { key: `faith:${e.channelId}`, name: e.name, sub: "devotional", emoji: "🙏", item }
            : null;
        })
        .filter(Boolean) as Card[],
    [faith],
  );

  /** Whatever the active tab is showing. Search applies to the directory tabs. */
  const shown: Card[] = useMemo(() => {
    if (tab === MYTV_GENRE_ID) return myTvCards;
    if (tab === DEVOTIONAL_GENRE_ID) return devotionalCards;
    if (tab.startsWith(USER_GENRE_PREFIX)) return userGenreCards;
    const needle = q.trim().toLowerCase();
    return playableDir.filter((c) => {
      if (tab !== "all" && c.genre !== tab) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle);
    });
  }, [tab, q, playableDir, myTvCards, userGenreCards, devotionalCards]);

  /** Counts come from the unfiltered roster, so a tab never reads "0" mid-search. */
  const countFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of playableDir) m.set(c.genre, (m.get(c.genre) ?? 0) + 1);
    return m;
  }, [playableDir]);

  const current = shown.length ? shown[idx % shown.length] : null;
  const live = current ? isLivePlayable(current.item) : false;

  // Resume the last channel watched, once, on the first non-empty list.
  useEffect(() => {
    if (resumedRef.current || shown.length === 0) return;
    resumedRef.current = true;
    try {
      const last = localStorage.getItem(LAST_CHANNEL_KEY);
      if (last) {
        const found = shown.findIndex((c) => c.key === last);
        if (found >= 0) setIdx(found);
      }
    } catch {
      /* noop */
    }
  }, [shown]);

  // Persist channel + tab so Home and this screen restore the same state.
  useEffect(() => {
    try {
      if (current) localStorage.setItem(LAST_CHANNEL_KEY, current.key);
      localStorage.setItem(LAST_GENRE_KEY, tab);
    } catch {
      /* noop */
    }
  }, [current, tab]);

  // A tab whose genre was just deleted must not strand the screen on it.
  useEffect(() => {
    if (!tab.startsWith(USER_GENRE_PREFIX)) return;
    if (userGenresQ.isLoading) return;
    if (!activeUserGenre) setTab("all");
  }, [tab, activeUserGenre, userGenresQ.isLoading]);

  // The loop. An ENDED playlist rolls to the next channel; an ERROR does too,
  // but errors are counted — once every channel in the tab has failed the
  // screen says so instead of spinning through them forever. Lifted from
  // advance() in the original component.
  // An elapsed devotional loop stops the rotation WITHOUT cutting the current
  // track off. Read through a ref because the player's event handlers are
  // bound once and would otherwise close over a stale value.
  const stopAdvanceRef = useRef(false);
  useEffect(() => {
    stopAdvanceRef.current = loopEnded;
  }, [loopEnded]);

  const advance = useCallback(
    (reason: "error" | "ended") => {
      // The loop's time is up: let this one finish, then stay put.
      if (stopAdvanceRef.current && reason === "ended") return;
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

  const invalidateUserWatch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["user-watch-genres"] });
    queryClient.invalidateQueries({ queryKey: ["user-watch-channels"] });
    queryClient.invalidateQueries({ queryKey: ["my-tv-channels"] });
  }, [queryClient]);

  const reset = () => {
    failStreakRef.current = 0;
    setDead(false);
    setPaused(false);
  };

  const pick = (i: number) => {
    reset();
    setIdx(i);
  };

  const pickTab = (t: string) => {
    if (t === tab) return;
    reset();
    setTab(t);
    setIdx(0);
  };

  const startLoop = (sec: number) => {
    const now = Date.now();
    writeLoop(now, sec);
    setLoop({ startedAt: now, durationSec: sec });
    setJustBrowse(false);
    setNowTs(now);
    reset();
  };

  const stopLoop = () => {
    clearLoop();
    setLoop(null);
    setJustBrowse(true);
  };

  const replayLoop = () => {
    if (!loop) return;
    startLoop(loop.durationSec);
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

  const renameUserGenre = async (g: UserGenreRow) => {
    const next = window.prompt("rename genre", g.name)?.trim();
    if (!next || next === g.name) return;
    const { error } = await supabase
      .from("user_watch_genres")
      .update({ name: next.slice(0, 40) })
      .eq("id", g.id);
    if (error) {
      toast.error("couldn't rename");
      return;
    }
    toast.success("renamed ✨");
    invalidateUserWatch();
  };

  const deleteUserGenre = async (g: UserGenreRow) => {
    if (!window.confirm(`delete "${g.name}" and its channels? this is forever fr`)) return;
    const { error } = await supabase.from("user_watch_genres").delete().eq("id", g.id);
    if (error) {
      toast.error("couldn't delete");
      return;
    }
    toast("genre deleted 🧹");
    setTab("all");
    invalidateUserWatch();
  };

  const deleteUserChannel = async (rowId: string, name: string) => {
    if (!window.confirm(`remove "${name}"?`)) return;
    const { error } = await supabase.from("user_watch_channels").delete().eq("id", rowId);
    if (error) {
      toast.error("couldn't remove");
      return;
    }
    toast("removed 🧹");
    invalidateUserWatch();
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

  const isMine = tab === MYTV_GENRE_ID || tab.startsWith(USER_GENRE_PREFIX);
  /** Non-searchable tabs: a personal or devotional list is short by design. */
  const isCurated = isMine || isDevotional;
  // Derived from the Playable, not from `key` — keys are namespaced per source
  // (`mytv:`, `faith:`, `uc:`) and reading one as a channel id built a broken
  // link the moment a second source appeared.
  const url = current ? channelUrlOf(current.item) : null;

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      <Header />

      <div className="mx-auto max-w-2xl px-4">
        {/* TABS — built-ins, then My TV, then the user's own, then the buttons
            that make more of them. Same order the original used. */}
        <div className="no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto pb-1">
          <Chip active={tab === "all"} onClick={() => pickTab("all")}>
            All {playableDir.length}
          </Chip>
          {GENRES.map((g) => (
            <Chip key={g.key} active={tab === g.key} onClick={() => pickTab(g.key)}>
              {g.emoji} {g.label} {countFor.get(g.key) ?? 0}
            </Chip>
          ))}

          {/* DEVOTIONAL. Only offered once a faith has been chosen — an
              unchosen faith has no roster, and showing a tab that leads to
              somebody else's tradition is the bleed bug, not a fallback. */}
          {faith && (
            <Chip active={tab === DEVOTIONAL_GENRE_ID} onClick={() => pickTab(DEVOTIONAL_GENRE_ID)}>
              🙏 Devotional {devotionalCards.length}
            </Chip>
          )}

          {userId && (
            <Chip active={tab === MYTV_GENRE_ID} onClick={() => pickTab(MYTV_GENRE_ID)}>
              📺 My TV {myTvCards.length}
            </Chip>
          )}

          {userGenres.map((g) => {
            const id = `${USER_GENRE_PREFIX}${g.id}`;
            const active = tab === id;
            return (
              <div key={g.id} className="inline-flex shrink-0 items-center gap-0.5">
                <Chip active={active} onClick={() => pickTab(id)}>
                  🎯 {g.name}
                </Chip>
                {active && (
                  <>
                    <IconBtn label={`Rename ${g.name}`} onClick={() => renameUserGenre(g)}>
                      <Pencil className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn label={`Delete ${g.name}`} danger onClick={() => deleteUserGenre(g)}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </>
                )}
              </div>
            );
          })}

          {userId && (
            <button
              type="button"
              data-testid="user-genre-add"
              onClick={() => setAddGenreOpen(true)}
              aria-label="Add genre"
              className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> genre
            </button>
          )}
          {userId && (
            <button
              type="button"
              data-testid="mytv-manage"
              onClick={() => setManageOpen(true)}
              aria-label="Manage My TV"
              className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <Settings className="h-3 w-3" /> My TV
            </button>
          )}
        </div>

        {/* THE DEVOTIONAL LOOP — above the frame, never over it. The original
            put the picker on an `absolute inset-0 z-30` sheet across the whole
            tile, which voids the embed grant. */}
        {showPicker && <DevotionalPicker onStart={startLoop} onSkip={() => setJustBrowse(true)} />}
        {isDevotional && loopActive && (
          <DevotionalRunning loop={loop} now={nowTs} onStop={stopLoop} />
        )}
        {isDevotional && loopEnded && (
          <DevotionalEnded
            onReplay={replayLoop}
            onBrowse={() => {
              clearLoop();
              setLoop(null);
              setJustBrowse(true);
            }}
          />
        )}

        {/*
          LIVE, ABOVE THE FRAME AND NOT OVER IT. This badge used to sit
          `absolute top-2 left-2 z-10` on top of the player, which voids the
          embed grant — YouTube forbids rendering anything in front of any
          part of the player, controls included. Enforced by
          src/data/__tests__/watchChannels.test.ts.
        */}
        {current && (
          <span
            className={`mb-2 inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
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
                ? isDevotional
                  ? // THIS FAITH'S OWN empty state. Never a fallback to
                    // another faith's channels — that was the Jain bleed bug.
                    "no channels listed for your faith yet 🌙"
                  : isMine
                    ? "nothing here yet — add your first 📺"
                    : "nothing here for that 🔍"
                : "streams are napping — try later 📺"}
            </div>
          ) : (
            <WatchPlayer
              key={current.key}
              item={current.item}
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
                {platformNameOf(current.item)} <ExternalLink className="size-3" />
              </button>
            )}
          </div>
        )}

        {/* SEARCH — directory tabs only; a user's own lists are short. */}
        {!isCurated && (
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIdx(0);
                reset();
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
        )}

        {/* THE STRIP */}
        <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto pb-1" data-testid="watch-list">
          {activeUserGenre && (
            <button
              type="button"
              data-testid="user-channel-add"
              onClick={() =>
                setAddChannelFor({ id: activeUserGenre.id, name: activeUserGenre.name })
              }
              aria-label="Add channel"
              className="press w-40 shrink-0 text-left"
            >
              <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border bg-surface-2">
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="mt-1.5 text-xs font-medium leading-snug">add channel</div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                youtube · vimeo · dailymotion · twitch · archive link
              </div>
            </button>
          )}
          {shown.map((c, i) => {
            const active = current?.key === c.key;
            const removable = c.key.startsWith("uc:");
            return (
              <div key={c.key} className="relative w-40 shrink-0">
                <button
                  type="button"
                  data-testid="watch-play"
                  onClick={() => pick(i)}
                  aria-label={`Play ${c.name}`}
                  aria-current={active}
                  className={`press w-full text-left ${active ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
                >
                  {/* A GLYPH, NOT ARTWORK — see the file header for why the
                      destination's own thumbnail host must never appear here. */}
                  <div
                    className={`grid aspect-video place-items-center rounded-lg border bg-surface-2 text-2xl ${
                      active ? "border-primary" : "border-border"
                    }`}
                  >
                    {c.emoji}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug">
                    {c.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.sub}</div>
                </button>
                {removable && (
                  <div className="absolute end-1 top-1">
                    <IconBtn
                      label={`Remove ${c.name}`}
                      danger
                      onClick={() => deleteUserChannel(c.key.slice(3), c.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Channels known only by @handle: no playlist can be derived from a
            handle, so they stay honest link-outs rather than a dead play button. */}
        {!isCurated && linkOnly.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              also on YouTube
            </div>
            <ul className="flex flex-wrap gap-2">
              {linkOnly.map((e) => {
                const link = channelUrl(e);
                if (!link) return null;
                return (
                  <li key={e.channelId ?? e.handle ?? e.name}>
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

        {/* OTHER PLACES TO WATCH (owner directive, 2026-09-03). Free platforms,
            each opening in the in-app browser. None plays inside ONIQ: framing
            another platform's player is a per-platform owner call with its own
            CSP grant and Play declaration — src/data/watchPlatforms.ts. */}
        {!isCurated && platforms.length > 0 && (
          <div className="mt-6" data-testid="watch-platforms">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              more places to watch
            </div>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-testid="watch-platform"
                  onClick={() => openInApp(p.url)}
                  aria-label={`${p.name} — ${opensIn(p.name)}`}
                  className="press w-40 shrink-0 text-left opacity-80 hover:opacity-100"
                >
                  {/* A GLYPH, NOT A LOGO — the platform's mark stays on its site. */}
                  <div className="grid aspect-video place-items-center rounded-lg border border-border bg-surface-2 text-2xl">
                    {p.emoji}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1 text-xs font-medium leading-snug">
                    <span className="truncate">{p.name}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {p.plays ? "plays in Watch" : PLATFORM_KIND_LABEL[p.kind]} ·{" "}
                    {opensIn(p.name).toLowerCase()}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {p.description}
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {NOT_AFFILIATED_NOTICE}
            </p>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-snug text-muted-foreground">{WATCH_NOTICE}</p>
      </div>

      {manageOpen && userId && (
        <MyTvManageSheet userId={userId} onClose={() => setManageOpen(false)} />
      )}
      {addGenreOpen && userId && (
        <AddGenreSheet
          userId={userId}
          existingCount={userGenres.length}
          onClose={() => setAddGenreOpen(false)}
          onCreated={(row) => {
            invalidateUserWatch();
            setTab(`${USER_GENRE_PREFIX}${row.id}`);
            setIdx(0);
          }}
        />
      )}
      {addChannelFor && userId && (
        <AddChannelSheet
          userId={userId}
          genre={addChannelFor}
          existingCount={userChannels.length}
          onClose={() => setAddChannelFor(null)}
          onAdded={invalidateUserWatch}
        />
      )}
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

function IconBtn({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`tap press grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground ${
        danger ? "hover:text-red-400" : "hover:text-foreground"
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
      className="tap press grid size-8 place-items-center rounded-full text-foreground"
    >
      {children}
    </button>
  );
}
