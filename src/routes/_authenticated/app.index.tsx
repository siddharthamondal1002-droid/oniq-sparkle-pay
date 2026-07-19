import { useEffect, useId, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Coins,
  Send,
  Car,
  LayoutGrid,
  IndianRupee,
  Lock,
  Clapperboard,
  GraduationCap,
  Plane,
  Newspaper,
  Tv,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Maximize2,
  Heart,
  Briefcase,
  BookOpen,
  Volume2,
  VolumeX,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { useVitalsTileColor } from "@/components/vitals/useVitalsTileColor";
import { loadYouTubeApi, useMyTv } from "@/components/landing/LiveNewsSection";
import {
  CustomizeButton,
  useHiddenTiles,
  useUserTheme,
  type TileKey,
} from "@/components/customize/CustomizeSheet";
import { MediaProvider, useMediaCoordinator } from "@/lib/MediaProvider";

export const Route = createFileRoute("/_authenticated/app/")({
  component: HomeScreen,
});

function HomeScreen() {
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_url")
        .eq("id", u.user.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: theme } = useUserTheme();
  const skins = theme?.tile_skins ?? {};
  const [hidden] = useHiddenTiles();
  const installPrompt = useInstallPrompt();
  const vitalsColor = useVitalsTileColor();



  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";

  return (
    <MediaProvider>
    <div className="relative pb-6 min-h-screen">
      {/* Wallpaper is now rendered by the app shell (_authenticated/app.tsx)
          so it persists across every /app/* tab. */}
      <div className="relative z-10">
        <h1 className="sr-only">Your ONIQ dashboard</h1>
        <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between fade-up">
            <div>
              <div className="text-xs text-muted-foreground">main character detected ✨</div>
              {profileLoading ? (
                <div className="mt-1 h-8 w-40 animate-pulse rounded-lg bg-surface" />
              ) : (
                <p className="font-display text-3xl font-bold text-gradient-primary">yo, {first} 👋</p>
              )}
            </div>

            <Link
              to="/app/profile"
              aria-label="Open profile"
              className="press grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground font-bold overflow-hidden"
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                (profile?.display_name ?? profile?.username ?? "O").charAt(0).toUpperCase()
              )}
            </Link>
          </div>

          {installPrompt.canInstall && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-border bg-card/85 px-3 py-2 fade-up">
              <span className="text-xs">📲 install ONIQ on your home screen</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={installPrompt.prompt}
                  className="press rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                >
                  Install
                </button>
                <button
                  onClick={installPrompt.dismiss}
                  className="press rounded-full px-2 py-1 text-xs text-muted-foreground"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <GlanceCard />

          <div className="mt-7 px-1 flex items-center justify-between">
            <h2 className="font-display text-xs uppercase tracking-wider text-muted-foreground">
              the lineup
            </h2>
            <CustomizeButton />
          </div>

          {/* Media banner — replaces old Watch + Brainrot tiles */}
          <div className="mt-3">
            <MediaBanner
              watchHidden={hidden.has("watch")}
              clipsHidden={hidden.has("clips")}
              watchSkin={skins.watch}
              clipsSkin={skins.clips}
            />
          </div>

          {/* Primary row — 5 large tiles */}
          <div className="mt-4 grid grid-cols-6 gap-3">
            {(() => {
              const primary = [
                { key: "wallet", to: "/app/wallet", icon: Coins, label: "tap in 💳", color: "#F59E0B", span: 6, showBalance: true },
                { key: "ting", to: "/app/ai", icon: Sparkles, label: "Ting ✨", color: "#8B5CF6", span: 3 },
                { key: "learn", to: "/app/learn", icon: GraduationCap, label: "smart 🧠", color: "#FB923C", span: 3 },
                { key: "study", to: "/app/study", icon: BookOpen, label: "study 📚", color: "#FB7185", span: 3 },
                { key: "upi", to: "/app/upi", icon: IndianRupee, label: "the bag 💰", color: "#22C55E", span: 3 },
              ] as const;
              return primary
                .filter((t) => !hidden.has(t.key as TileKey))
                .map((t, i) => (
                  <PrimaryTile
                    key={t.key}
                    to={t.to}
                    icon={t.icon}
                    label={t.label}
                    color={t.color}
                    span={t.span}
                    skin={skins[t.key as TileKey]}
                    delay={40 + i * 40}
                    showBalance={"showBalance" in t ? t.showBalance : false}
                  />
                ));
            })()}
          </div>

          {/* Grouped sections */}
          <SectionRow
            title="📺 media"
            tiles={[
              { key: "miniapps", to: "/app/miniapps", icon: LayoutGrid, label: "the plug 🔌", color: "#A3E635" },
              { key: "pulse", to: "/app/news", icon: Newspaper, label: "the tea ☕", color: "#F472B6" },
            ]}
            hidden={hidden}
            skins={skins}
          />
          <SectionRow
            title="🌱 life"
            tiles={[
              { key: "faith", to: "/app/faith", icon: Sparkles, label: "blessed 🙏", color: "#FCD34D" },
              { key: "vitals", to: "/app/vitals", icon: Heart, label: "vitals 🫀", color: vitalsColor },
              { key: "wander", to: "/app/travel", icon: Plane, label: "touch grass ✈️", color: "#22D3EE" },
            ]}
            hidden={hidden}
            skins={skins}
          />
          <SectionRow
            title="💼 work"
            tiles={[
              { key: "earn", to: "/app/earn", icon: Briefcase, label: "earn 💼", color: "#00D4B8" },
              { key: "rides", to: "/app/rides", icon: Car, label: "pull up 🚗", color: "#38BDF8" },
            ]}
            hidden={hidden}
            skins={skins}
          />
        </div>
      </div>
    </div>
    </MediaProvider>
  );
}

function Tile({
  to,
  icon: Icon,
  label,
  color,
  skin,
  locked = false,
  delay = 0,
}: {
  to?: string;
  icon: typeof Send;
  label: string;
  color?: string;
  skin?: string;
  locked?: boolean;
  delay?: number;
}) {
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;
  const tint = color ?? "#00D4B8";
  const inner = (
    <>
      {showSkin && (
        <>
          <img
            src={skin!}
            alt=""
            onError={() => setSkinError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
        </>
      )}
      {!showSkin && (
        <div
          className="relative grid h-11 w-11 place-items-center rounded-2xl overflow-hidden transition-transform duration-200"
          style={{ color: tint, background: `${tint}26`, boxShadow: `0 0 18px ${tint}40, inset 0 0 0 1px ${tint}33` }}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      {locked && (
        <div className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-surface-2 border border-border z-10">
          <Lock className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
      <span className={`relative z-10 text-xs font-medium ${showSkin ? "text-white drop-shadow" : ""} ${locked ? "text-muted-foreground" : ""}`}>{label}</span>
    </>
  );
  const base =
    "press fade-up relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-2xl bg-card p-2 border border-border transition-colors";
  const washStyle = !showSkin
    ? { background: `radial-gradient(120% 90% at 0% 0%, ${tint}47 0%, ${tint}14 35%, transparent 65%), hsl(var(--card))` }
    : undefined;
  const style = { animationDelay: `${delay}ms`, ...(washStyle ?? {}) };
  if (locked) {
    return <div className={`${base} opacity-60`} style={style}>{inner}</div>;
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className={`${base} hover:brightness-110`} style={style}>
      {inner}
    </Link>
  );
}

type GenreId = "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle" | "devotional" | "mytv";
type FaithId = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jewish";
type Video = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
  faith?: FaithId;
};
type LiveGenre = { id: GenreId; name: string; emoji: string; live: boolean; videos: Video[] };

// Map app.faith.tsx's Religion → live-channels faith id.
function readDevotionalFaithPref(): FaithId | null {
  if (typeof window === "undefined") return null;
  try {
    const r = localStorage.getItem("oniq.faith.religion.v1");
    if (r === "islam") return "islamic";
    if (r === "hindu" || r === "sikh" || r === "christian" || r === "buddhist" || r === "jewish") return r;
  } catch { /* noop */ }
  return null;
}

const DEVOTIONAL_LOOP_START_KEY = "oniq.watch.devotionalLoopStartedAt";
const DEVOTIONAL_LOOP_DUR_KEY = "oniq.watch.devotionalLoopDurationSec";
const DEVOTIONAL_DURATIONS: { label: string; sec: number }[] = [
  { label: "10 min", sec: 10 * 60 },
  { label: "30 min", sec: 30 * 60 },
  { label: "1 hr", sec: 60 * 60 },
  { label: "3 hr", sec: 3 * 60 * 60 },
  { label: "6 hr", sec: 6 * 60 * 60 },
  { label: "12 hr", sec: 12 * 60 * 60 },
  { label: "24 hr", sec: 24 * 60 * 60 },
];


function useLiveGenres(enabled: boolean) {
  return useQuery({
    queryKey: ["live-genres"],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("live-channels", { body: {} });
      if (error) throw error;
      return (Array.isArray(data?.genres) ? data.genres : []) as LiveGenre[];
    },
  });
}

function HeroTile({
  to,
  search,
  icon: Icon,
  label,
  tagline,
  gradient,
  skin,
  delay = 0,
  livePreview = false,
}: {
  tileKey: TileKey;
  to: string;
  search?: Record<string, unknown>;
  icon: typeof Send;
  label: string;
  tagline: string;
  gradient: string;
  skin?: string;
  delay?: number;
  livePreview?: boolean;
}) {
  const navigate = useNavigate();
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;
  const { data: baseGenres } = useLiveGenres(livePreview && !showSkin);
  const { videos: myTvVideos } = useMyTv();
  const genres = livePreview && !showSkin
    ? [
        ...(baseGenres ?? []),
        ...(myTvVideos.length > 0
          ? [{ id: "mytv" as GenreId, name: "My TV", emoji: "📺", live: false, videos: myTvVideos }]
          : []),
      ]
    : [];
  const [genreId, setGenreId] = useState<GenreId>(() => {
    if (typeof window === "undefined") return "news";
    try { return (localStorage.getItem("oniq.watch.lastGenre") as GenreId) || "news"; } catch { return "news"; }
  });
  const activeGenre =
    genres.find((g) => g.id === genreId) ?? genres[0] ?? null;
  const isDevotional = activeGenre?.id === "devotional";

  // Devotional loop state — anchored to real timestamps in localStorage so backgrounding/reopens resume.
  const [devLoopStart, setDevLoopStart] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try { const v = localStorage.getItem(DEVOTIONAL_LOOP_START_KEY); return v ? Number(v) : null; } catch { return null; }
  });
  const [devLoopDur, setDevLoopDur] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try { const v = localStorage.getItem(DEVOTIONAL_LOOP_DUR_KEY); return v ? Number(v) : null; } catch { return null; }
  });
  const [devJustBrowse, setDevJustBrowse] = useState(false);
  // Ticks once per second while in devotional loop so "elapsed" flips reactively.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!isDevotional || devLoopStart == null || devLoopDur == null) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isDevotional, devLoopStart, devLoopDur]);
  const devLoopActive = isDevotional && devLoopStart != null && devLoopDur != null && (nowTs - devLoopStart) < devLoopDur * 1000;
  const devLoopEnded = isDevotional && devLoopStart != null && devLoopDur != null && (nowTs - devLoopStart) >= devLoopDur * 1000;
  const devFaithPref = isDevotional ? readDevotionalFaithPref() : null;
  // Reset "just browse" whenever we switch away from devotional so re-entering shows the picker again.
  useEffect(() => { if (!isDevotional) setDevJustBrowse(false); }, [isDevotional]);
  const showDevPicker = isDevotional && !devLoopActive && !devJustBrowse;

  const rawVideos = activeGenre?.videos ?? [];
  const videos = isDevotional && devFaithPref
    ? rawVideos.filter((v) => (v as Video).faith === devFaithPref)
    : rawVideos;

  const isLiveGenre = !!activeGenre?.live;



  const [idx, setIdx] = useState(0);
  const resumedRef = useRef(false);
  // On first non-empty load, resume last watched video (if we can find it in current genre)
  useEffect(() => {
    if (resumedRef.current) return;
    if (!livePreview || showSkin) return;
    if (videos.length === 0) return;
    try {
      const last = localStorage.getItem("oniq.watch.last");
      if (last) {
        const foundIdx = videos.findIndex((v) => v.videoId === last);
        if (foundIdx >= 0) setIdx(foundIdx);
      }
    } catch { /* noop */ }
    resumedRef.current = true;
  }, [videos, livePreview, showSkin]);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const hideTimerRef = useRef<number | null>(null);
  const stopAdvanceRef = useRef(false);
  useEffect(() => { stopAdvanceRef.current = devLoopEnded; }, [devLoopEnded]);

  // Speaker/mute coordination — start muted (matches autoplay policy),
  // unmute only on explicit user tap. Registers a controllable wrapper with
  // MediaProvider so the YouTube player participates in single-audio-source
  // coordination alongside BrainrotBanner's raw <video>.
  const media = useMediaCoordinator();
  const [muted, setMuted] = useState(true);
  const controllableRef = useRef({
    pause: () => { try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ } },
    mute: () => {
      try { playerRef.current?.mute?.(); } catch { /* noop */ }
      setMuted(true);
    },
  });
  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = playerRef.current;
    if (!p) return;
    try {
      const isMuted = typeof p.isMuted === "function" ? p.isMuted() : muted;
      if (isMuted) {
        // Unmuting is the user gesture — claim active audio slot.
        media.register(controllableRef.current);
        p.unMute?.();
        setMuted(false);
      } else {
        p.mute?.();
        setMuted(true);
      }
    } catch { /* noop */ }
    bumpHide();
  };

  const playerHostId = `yt-tile-${useId().replace(/:/g, "")}`;
  const playerCoverClass = "absolute left-1/2 top-1/2 h-full w-auto -translate-x-1/2 -translate-y-1/2 aspect-video min-h-full min-w-full";

  const current = livePreview && !showSkin && videos.length
    ? videos[idx % videos.length]
    : null;
  const videoId = current?.videoId ?? null;
  const currentLabel = current
    ? (isLiveGenre ? current.channelName : current.title)
    : "";

  // Persist last watched channel + genre for next home load
  useEffect(() => {
    if (!livePreview || showSkin) return;
    try {
      if (videoId) localStorage.setItem("oniq.watch.last", videoId);
      if (activeGenre?.id) localStorage.setItem("oniq.watch.lastGenre", activeGenre.id);
    } catch { /* noop */ }
  }, [videoId, activeGenre?.id, livePreview, showSkin]);

  // 120s auto-tour cap (per video), also honored across uploads (natural ENDED advance handles it too)
  const vLen = videos.length;
  useEffect(() => {
    if (!livePreview || showSkin || vLen < 2) return;
    if (paused || controlsVisible) return;
    // Devotional loop: no 20s auto-tour — let each video play to completion (ENDED handler wraps).
    if (isDevotional && devLoopActive) return;
    // Devotional with picker shown or timer ended: don't force-advance either.
    if (isDevotional && (showDevPicker || devLoopEnded)) return;
    let t: number | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        t = window.setTimeout(tick, 20_000);
        return;
      }
      setIdx((i) => (i + 1) % vLen);
    };
    t = window.setTimeout(tick, 20_000);
    return () => { if (t) window.clearTimeout(t); };
  }, [idx, vLen, livePreview, showSkin, paused, controlsVisible, isDevotional, devLoopActive, showDevPicker, devLoopEnded]);


  const bumpHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 15_000);
  };
  const showControls = () => { setControlsVisible(true); bumpHide(); };
  useEffect(() => () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); }, []);

  useEffect(() => {
    if (!livePreview || showSkin || !videoId) return;
    let cancelled = false;
    const host = mountRef.current;
    if (!host) return;

    if (playerRef.current?.loadVideoById) {
      try {
        playerRef.current.loadVideoById(videoId);
        playerRef.current.getIframe?.()?.setAttribute("class", playerCoverClass);
      } catch { /* noop */ }
      return;
    }

    loadYouTubeApi().then((YT) => {
      if (cancelled || !YT || playerRef.current) return;
      try {
        playerRef.current = new YT.Player(playerHostId, {
          width: "100%",
          height: "100%",
          host: "https://www.youtube-nocookie.com",
          videoId,
          playerVars: {
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            controls: 0,
            rel: 0,
            modestbranding: 1,
            cc_load_policy: 1,
            cc_lang_pref: "en",
          },
          events: {
            onReady: (e: any) => {
              try {
                e.target.getIframe?.()?.setAttribute("class", playerCoverClass);
                e.target.getIframe?.()?.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
                e.target.getIframe?.()?.setAttribute("title", "Live preview");
                e.target.mute();
                e.target.playVideo();
              } catch { /* noop */ }
            },
            onStateChange: (e: any) => {
              if (e?.data === 0) {
                // ENDED → next video (unless devotional loop timer has elapsed)
                if (stopAdvanceRef.current) return;
                const total = vLen;
                if (total > 0) setIdx((i) => (i + 1) % total);
              }
            },

          },
        });
      } catch (err) {
        console.warn("[WatchTile] player init failed", err);
      }
    });

    return () => { cancelled = true; };
  }, [livePreview, showSkin, videoId, playerHostId, vLen]);

  useEffect(() => {
    return () => {
      try { playerRef.current?.destroy?.(); } catch { /* noop */ }
      playerRef.current = null;
    };
  }, []);

  // Non-live path: unchanged Link
  if (!videoId) {
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        search={search as any}
        style={{ animationDelay: `${delay}ms` }}
        className={`press fade-up col-span-4 aspect-video relative overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between`}
      >
        {showSkin ? (
          <>
            <img
              src={skin!}
              alt=""
              onError={() => setSkinError(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

          </>
        ) : (
          <Icon className="h-10 w-10 text-foreground/90" strokeWidth={1.6} />
        )}
        <div className="relative">
          <div className={`text-[10px] uppercase tracking-wider ${showSkin ? "text-white/80" : "text-muted-foreground"}`}>{tagline}</div>
          <div className={`font-display text-2xl font-bold ${showSkin ? "text-white drop-shadow" : ""}`}>{label}</div>
        </div>
      </Link>
    );
  }

  const onTileClick = () => {
    if (controlsVisible) setControlsVisible(false);
    else showControls();
  };
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); bumpHide(); };
  const gotoIdx = (next: number) => {
    const total = videos.length;
    if (total === 0) return;
    setIdx(((next % total) + total) % total);
    setPaused(false);
  };
  const pickGenre = (g: GenreId) => {
    if (g === genreId) return;
    setGenreId(g);
    setIdx(0);
    setPaused(false);
    // Entering devotional freshly → force picker to reappear (unless a live loop is still running).
    if (g === "devotional") setDevJustBrowse(false);
    bumpHide();
  };
  const startDevLoop = (sec: number) => {
    const now = Date.now();
    setDevLoopStart(now);
    setDevLoopDur(sec);
    setDevJustBrowse(false);
    try {
      localStorage.setItem(DEVOTIONAL_LOOP_START_KEY, String(now));
      localStorage.setItem(DEVOTIONAL_LOOP_DUR_KEY, String(sec));
    } catch { /* noop */ }
    setNowTs(Date.now());
    bumpHide();
  };
  const clearDevLoop = () => {
    setDevLoopStart(null);
    setDevLoopDur(null);
    try {
      localStorage.removeItem(DEVOTIONAL_LOOP_START_KEY);
      localStorage.removeItem(DEVOTIONAL_LOOP_DUR_KEY);
    } catch { /* noop */ }
  };
  const skipDevPicker = () => { clearDevLoop(); setDevJustBrowse(true); bumpHide(); };

  const pickVideo = (i: number) => {
    setIdx(i);
    setPaused(false);
    bumpHide();
  };

  const ctrlBtn = "glass press grid h-8 w-8 place-items-center rounded-full text-foreground";

  return (
    <div
      onClick={onTileClick}
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
      className={`press fade-up col-span-4 aspect-video relative overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between cursor-pointer`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          id={playerHostId}
          ref={mountRef}
          className={playerCoverClass}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/28 to-transparent" />

      {showDevPicker && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 px-3 text-center"
        >
          <div className="text-[10px] uppercase tracking-wider text-primary/90">devotional 🙏</div>
          <div className="text-xs font-semibold text-white">loop for how long?</div>
          <div className="no-scrollbar flex max-w-full flex-wrap items-center justify-center gap-1 px-2">
            {DEVOTIONAL_DURATIONS.map((d) => (
              <button
                key={d.sec}
                onClick={(e) => { e.stopPropagation(); startDevLoop(d.sec); }}
                className="rounded-full border border-primary/60 bg-primary/20 px-2.5 py-0.5 text-[11px] font-semibold text-white"
              >
                {d.label}
              </button>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); skipDevPicker(); }}
              className="rounded-full border border-white/25 bg-black/40 px-2.5 py-0.5 text-[11px] font-medium text-white/90"
            >
              just browse
            </button>
          </div>
        </div>
      )}

      {isDevotional && devLoopEnded && !showDevPicker && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-1/2 top-2 z-20 -translate-x-1/2 flex items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white/95"
        >
          <span>loop ended</span>
          <button
            onClick={(e) => { e.stopPropagation(); clearDevLoop(); setDevJustBrowse(false); }}
            className="rounded-full border border-primary/50 bg-primary/25 px-2 py-0.5 font-semibold"
          >
            replay
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); clearDevLoop(); setDevJustBrowse(true); }}
            className="rounded-full border border-white/25 bg-black/40 px-2 py-0.5"
          >
            keep browsing
          </button>
        </div>
      )}


      <span className={`relative inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold border ${isLiveGenre ? "border-red-500/50 bg-red-500/15 text-red-300" : "border-primary/50 bg-primary/15 text-primary"}`}>
        {isLiveGenre ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
            </span>
            LIVE
          </>
        ) : (
          "NEW"
        )}
      </span>

      <div
        className={`absolute inset-x-0 bottom-2 z-10 flex flex-col items-center gap-1 transition-opacity duration-300 ${controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      >
        {genres && genres.length > 1 && (
          <div
            onClick={(e) => { e.stopPropagation(); bumpHide(); }}
            className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto px-3"
          >
            {genres.map((g) => {
              const active = g.id === (activeGenre?.id ?? genreId);
              return (
                <button
                  key={g.id}
                  onClick={(e) => { e.stopPropagation(); pickGenre(g.id); }}
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-black/40 text-foreground/85 border-white/15"}`}
                  aria-label={g.name}
                >
                  {g.emoji}
                </button>
              );
            })}
          </div>
        )}
        {videos.length > 1 && (
          <div
            onClick={(e) => { e.stopPropagation(); bumpHide(); }}
            className="no-scrollbar flex max-w-full items-center gap-1 overflow-x-auto px-3"
          >
            {videos.map((v, i) => {
              const active = i === idx % videos.length;
              const chipLabel = isLiveGenre ? v.channelName : v.title;
              return (
                <button
                  key={v.videoId}
                  onClick={(e) => { e.stopPropagation(); pickVideo(i); }}
                  className={`max-w-[10rem] truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-black/40 text-foreground/85 border-white/15"}`}
                  title={chipLabel}
                >
                  {chipLabel}
                </button>
              );
            })}
          </div>
        )}
        {currentLabel && (
          <span className="glass max-w-[80%] truncate rounded-full px-2 py-0.5 text-[10px] text-foreground/90">{currentLabel}</span>
        )}

        <div className="glass flex items-center gap-1 rounded-full p-1">
          <button className={ctrlBtn} aria-label="Previous video" onClick={(e) => { stop(e); gotoIdx(idx - 1); }}>
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            className={ctrlBtn}
            aria-label={paused ? "Play" : "Pause"}
            onClick={(e) => { stop(e); if (paused) { playerRef.current?.playVideo?.(); setPaused(false); } else { playerRef.current?.pauseVideo?.(); setPaused(true); } }}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button className={ctrlBtn} aria-label="Next video" onClick={(e) => { stop(e); gotoIdx(idx + 1); }}>
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            className={ctrlBtn}
            aria-label="Expand to full Watch"
            onClick={(e) => { stop(e); navigate({ to: "/app/news", search: { tab: "watch" as const } }); }}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {videoId && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label="Mute"
          aria-pressed={muted}
          className="press absolute bottom-3 right-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function ClipsHeroTile({
  skin,
  gradient,
  delay = 0,
}: {
  skin?: string;
  gradient: string;
  delay?: number;
}) {
  const [skinError, setSkinError] = useState(false);
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const [idx, setIdx] = useState(0);
  const showSkin = skin && !skinError;

  const { data: clips } = useQuery({
    queryKey: ["latest-clips", 10],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clips")
        .select("id, video_url")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const validClips = (clips ?? []).filter((c) => !errored[c.id]);
  const total = validClips.length;
  const current = !showSkin && total > 0 ? validClips[idx % total] : null;

  useEffect(() => {
    if (showSkin || total < 2) return;
    let t: number | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        t = window.setTimeout(tick, 20_000);
        return;
      }
      setIdx((i) => (i + 1) % total);
    };
    t = window.setTimeout(tick, 20_000);
    return () => { if (t) window.clearTimeout(t); };
  }, [idx, total, showSkin]);

  const videoUrl = current?.video_url ?? null;

  return (
    <Link
      to="/app/clips"
      style={{ animationDelay: `${delay}ms` }}
      className={`press fade-up col-span-2 row-span-2 relative overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between`}
    >
      {videoUrl && current && (
        <video
          key={current.id}
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          onError={() => {
            setErrored((e) => ({ ...e, [current.id]: true }));
            setIdx((i) => (total > 1 ? (i + 1) % total : i));
          }}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {videoUrl && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/28 to-transparent" />
      )}
      {showSkin ? (
        <>
          <img
            src={skin!}
            alt=""
            onError={() => setSkinError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/78 via-black/22 to-transparent" />
        </>
      ) : (
        <Clapperboard className="relative h-10 w-10 text-foreground/90" strokeWidth={1.6} />
      )}
      <div className="relative">
        <div className={`text-[10px] uppercase tracking-wider ${showSkin ? "text-white/80" : "text-muted-foreground"}`}>doomscroll era</div>
        <div className={`font-display text-2xl font-bold ${showSkin ? "text-white drop-shadow" : ""}`}>brainrot 🎬</div>
      </div>
    </Link>
  );
}




type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
    };
    const onInstalled = () => {
      setEvt(null);
      setDismissed(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return {
    canInstall: !!evt && !dismissed,
    prompt: async () => {
      if (!evt) return;
      await evt.prompt();
      try {
        await evt.userChoice;
      } catch {
        // ignore
      }
      setEvt(null);
    },
    dismiss: () => setDismissed(true),
  };
}

type MarketData = {
  gold: { pricePerGram: number; currency: string } | null;
  silver: { pricePerGram: number; currency: string } | null;
  repoRate: { value: number; asOf: string } | null;
  bankRates: Array<{ bank: string; rate: number; type: string }>;
};

type NewsItem = { title: string; link: string; source: string; publishedAt: string; image?: string };

const GLANCE_COLLAPSE_KEY = "oniq.home.glance.collapsed";
const MEDIA_TILE_KEY = "oniq.home.mediaTile";

function useGlanceCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(GLANCE_COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const set = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(GLANCE_COLLAPSE_KEY, v ? "1" : "0"); } catch { /* noop */ }
  };
  return [collapsed, set] as const;
}

function GlanceCard() {
  const [collapsed, setCollapsed] = useGlanceCollapsed();
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanTab, setLoanTab] = useState<LoanCategory["type"]>("home");
  const openLoan = (t: LoanCategory["type"]) => { setLoanTab(t); setLoanOpen(true); };

  const { data: market } = useQuery<MarketData | null>({
    queryKey: ["market-ticker"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("market-ticker");
      if (error) return null;
      return data as MarketData;
    },
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });




  if (collapsed) {
    return (
      <div className="mt-4 flex items-center justify-between rounded-full border border-border bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>glance card hidden</span>
        <button
          onClick={() => setCollapsed(false)}
          className="press rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary"
          aria-label="Show glance card"
        >
          show
        </button>
      </div>
    );
  }

  const gold = market?.gold?.pricePerGram ?? null;
  const silver = market?.silver?.pricePerGram ?? null;

  return (
    <div
      className="mt-4 rounded-2xl border border-primary/20 p-3 fade-up"
      style={{
        background:
          "linear-gradient(135deg, rgba(0,212,184,0.10) 0%, rgba(245,158,11,0.06) 60%, rgba(255,255,255,0.02) 100%), var(--gradient-card)",
        boxShadow: "0 0 18px rgba(0,212,184,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setLoanOpen(true)}
          className="press grid flex-1 grid-cols-2 gap-2 text-left"
          aria-label="Open loan & deposit rates"
        >
          <StatBox
            label="24K Gold"
            value={gold ? `₹${gold.toLocaleString("en-IN")}` : "—"}
            unit="/g"
            accent="#F59E0B"
          />
          <StatBox
            label="Silver"
            value={silver ? `₹${silver.toLocaleString("en-IN")}` : "—"}
            unit="/g"
            accent="#94A3B8"
          />
        </button>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Hide glance card"
          className="press grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-black/30 text-muted-foreground hover:text-foreground"
        >
          <span className="text-[13px] leading-none">×</span>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {([
          { t: "home", emoji: "🏠", label: "Home" },
          { t: "gold", emoji: "🪙", label: "Gold" },
          { t: "car",  emoji: "🚗", label: "Car"  },
          { t: "fd",   emoji: "🏦", label: "FD"   },
        ] as const).map((c) => (
          <button
            key={c.t}
            onClick={() => openLoan(c.t)}
            className="press rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] font-semibold text-foreground hover:border-primary/40 hover:bg-primary/10"
            aria-label={`Open ${c.label} loan rates`}
          >
            <span className="mr-1">{c.emoji}</span>{c.label}
          </button>
        ))}
      </div>
      <LoanRatesSheet open={loanOpen} initialTab={loanTab} onClose={() => setLoanOpen(false)} />
    </div>
  );
}

type LoanBank = { bank: string; rateRange: string; note?: string };
type LoanCategory = { type: "home" | "gold" | "car" | "fd"; label: string; banks: LoanBank[] };
type LoanRatesPayload = { asOf: string; categories: LoanCategory[]; disclaimer: string };

function LoanRatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<LoanRatesPayload | null>({
    queryKey: ["loan-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("loan-rates");
      if (error) throw error;
      return data as LoanRatesPayload;
    },
    enabled: open,
    staleTime: 12 * 60 * 60 * 1000,
  });
  const [tab, setTab] = useState<LoanCategory["type"]>("home");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!open) return null;

  const cats = data?.categories ?? [];
  const active = cats.find((c) => c.type === tab) ?? cats[0] ?? null;
  const tabs: LoanCategory["type"][] = ["home", "gold", "car", "fd"];
  const tabLabels: Record<LoanCategory["type"], string> = {
    home: "🏠 Home",
    gold: "🪙 Gold",
    car: "🚗 Car",
    fd: "🏦 FD",
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b border-border px-4 pb-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div>
            <div className="font-display text-lg font-bold">loan & deposit rates</div>
            <div className="text-[10px] text-muted-foreground">
              {data?.asOf ? `as of ${data.asOf}` : "snapshot"} · Indian banks
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press grid h-8 w-8 place-items-center rounded-full border border-border bg-black/30 text-muted-foreground hover:text-foreground"
          >
            <span className="text-base leading-none">×</span>
          </button>
        </div>

        {(data?.disclaimer || DEFAULT_LOAN_DISCLAIMER) && (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            {data?.disclaimer ?? DEFAULT_LOAN_DISCLAIMER}
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto px-4 pt-3">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`press shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                tab === t
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border bg-black/20 text-muted-foreground"
              }`}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-4 pb-4 pt-3">
          {isLoading && (
            <div className="py-10 text-center text-sm text-muted-foreground">loading rates…</div>
          )}
          {isError && !isLoading && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              couldn't load rates right now — try again in a moment.
            </div>
          )}
          {!isLoading && !isError && cats.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              rates unavailable at the moment.
            </div>
          )}
          {active && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {active.label}
              </div>
              {active.banks.map((b) => (
                <div
                  key={b.bank}
                  className="rounded-xl border border-white/5 bg-black/25 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-foreground">{b.bank}</div>
                    <div className="font-display text-sm font-bold text-primary">{b.rateRange}</div>
                  </div>
                  {b.note && (
                    <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{b.note}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_LOAN_DISCLAIMER =
  "Rates vary by CIBIL score, loan amount, tenure, and individual bank policy. 750+ CIBIL typically qualifies for the lower end of each range. Confirm your exact rate with the bank directly.";

function StatBox({ label, value, unit, accent }: { label: string; value: string; unit: string; accent: string }) {
  return (
    <div
      className="min-w-0 rounded-xl border border-white/5 bg-black/25 px-3 py-2"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}18` }}
    >
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
        <span className="font-display text-base font-bold tabular-nums" style={{ color: accent }}>{value}</span>
        {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

// ---------- Primary tiles ----------

function useWalletBalance() {
  return useQuery({
    queryKey: ["home-wallet-balance"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("wallets")
        .select("omiq_balance")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return data?.omiq_balance ?? null;
    },
    staleTime: 60 * 1000,
  });
}

function PrimaryTile({
  to,
  icon: Icon,
  label,
  color,
  span,
  skin,
  delay = 0,
  showBalance = false,
}: {
  to: string;
  icon: typeof Send;
  label: string;
  color: string;
  span: number;
  skin?: string;
  delay?: number;
  showBalance?: boolean;
}) {
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;
  const { data: omiqBalance } = useWalletBalance();
  const balance = showBalance && typeof omiqBalance === "number"
    ? `${Number(omiqBalance).toFixed(2)} ⭘`
    : null;

  const spanClass = span === 6 ? "col-span-6" : span === 3 ? "col-span-3" : "col-span-2";
  const height = span === 6 ? "h-28" : "h-24";

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      style={{
        animationDelay: `${delay}ms`,
        background: showSkin
          ? undefined
          : `radial-gradient(120% 90% at 0% 0%, ${color}40 0%, ${color}10 40%, transparent 70%), hsl(var(--card))`,
      }}
      className={`press fade-up relative overflow-hidden rounded-3xl border border-border bg-card p-4 ${spanClass} ${height} flex flex-col justify-between transition-colors hover:brightness-110`}
    >
      {showSkin && (
        <>
          <img
            src={skin!}
            alt=""
            onError={() => setSkinError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        </>
      )}
      <div
        className="relative grid h-10 w-10 place-items-center rounded-2xl overflow-hidden"
        style={{ color, background: `${color}26`, boxShadow: `0 0 18px ${color}40, inset 0 0 0 1px ${color}33` }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="relative">
        <div className={`font-display text-sm font-semibold ${showSkin ? "text-white drop-shadow" : "text-foreground"}`}>{label}</div>
        {balance && (
          <div className="mt-0.5 font-display text-xl font-bold text-gradient-primary">{balance}</div>
        )}
      </div>
    </Link>
  );
}

// ---------- Section row (horizontal scrollable chip row) ----------

type SectionTile = {
  key: string;
  to: string;
  icon: typeof Send;
  label: string;
  color: string;
};

function SectionRow({
  title,
  tiles,
  hidden,
  skins,
}: {
  title: string;
  tiles: SectionTile[];
  hidden: Set<TileKey>;
  skins: Record<string, string | undefined>;
}) {
  const visible = tiles.filter((t) => !(hidden as Set<string>).has(t.key));
  if (visible.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="no-scrollbar mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {visible.map((t) => {
          const skin = skins[t.key];
          const Icon = t.icon;
          return (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link
              key={t.key}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              to={t.to as any}
              className="press fade-up relative flex min-w-[7.5rem] shrink-0 items-center gap-2 overflow-hidden rounded-2xl border border-border bg-card px-3 py-2.5"
              style={{
                background: skin
                  ? undefined
                  : `radial-gradient(120% 90% at 0% 0%, ${t.color}33 0%, ${t.color}0d 45%, transparent 75%), hsl(var(--card))`,
              }}
            >
              {skin && (
                <>
                  <img src={skin} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                </>
              )}
              <div
                className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                style={{ color: t.color, background: `${t.color}26`, boxShadow: `inset 0 0 0 1px ${t.color}33` }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className={`relative text-xs font-medium ${skin ? "text-white drop-shadow" : "text-foreground"}`}>{t.label}</span>
              <ChevronRight className="relative ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Media banner ----------

type MediaMode = "watch" | "brainrot";

function useMediaMode(): [MediaMode, (m: MediaMode) => void] {
  const [mode, setMode] = useState<MediaMode>(() => {
    if (typeof window === "undefined") return "watch";
    try {
      const v = localStorage.getItem(MEDIA_TILE_KEY);
      return v === "brainrot" ? "brainrot" : "watch";
    } catch { return "watch"; }
  });
  const set = (m: MediaMode) => {
    setMode(m);
    try { localStorage.setItem(MEDIA_TILE_KEY, m); } catch { /* noop */ }
  };
  return [mode, set];
}

function MediaBanner({
  watchHidden,
  clipsHidden,
  watchSkin,
  clipsSkin,
}: {
  watchHidden: boolean;
  clipsHidden: boolean;
  watchSkin?: string;
  clipsSkin?: string;
}) {
  const [savedMode, setMode] = useMediaMode();
  // If a mode is hidden via customize, fall back to the other.
  const effective: MediaMode | null = (() => {
    if (savedMode === "brainrot" && !clipsHidden) return "brainrot";
    if (savedMode === "watch" && !watchHidden) return "watch";
    if (!watchHidden) return "watch";
    if (!clipsHidden) return "brainrot";
    return null;
  })();

  if (!effective) return null;

  return (
    <div className="relative">
      {effective === "watch" ? (
        <HeroTile
          tileKey="watch"
          skin={watchSkin}
          to="/app/news"
          search={{ tab: "watch" as const }}
          icon={Tv}
          label="Watch"
          tagline="brainrot on tap 📺"
          gradient="from-primary/30 via-primary/10 to-accent/30"
          delay={0}
          livePreview
        />
      ) : (
        <BrainrotBanner skin={clipsSkin} />
      )}

      {/* Mode switcher — only visible when both modes are available */}
      {!watchHidden && !clipsHidden && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 z-40 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 p-0.5 backdrop-blur"
        >
          <button
            onClick={(e) => { e.stopPropagation(); setMode("watch"); }}
            aria-pressed={effective === "watch"}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              effective === "watch" ? "bg-primary text-primary-foreground" : "text-white/80"
            }`}
          >
            watch
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setMode("brainrot"); }}
            aria-pressed={effective === "brainrot"}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              effective === "brainrot" ? "bg-primary text-primary-foreground" : "text-white/80"
            }`}
          >
            brainrot
          </button>
        </div>
      )}
    </div>
  );
}

function BrainrotBanner({ skin }: { skin?: string }) {
  const [skinError, setSkinError] = useState(false);
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const media = useMediaCoordinator();
  const showSkin = skin && !skinError;

  const { data: clips } = useQuery({
    queryKey: ["latest-clips", 10],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clips")
        .select("id, video_url")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const validClips = (clips ?? []).filter((c) => !errored[c.id]);
  const total = validClips.length;
  const current = !showSkin && total > 0 ? validClips[idx % total] : null;

  useEffect(() => {
    if (showSkin || total < 2) return;
    let t: number | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        t = window.setTimeout(tick, 20_000);
        return;
      }
      setIdx((i) => (i + 1) % total);
    };
    t = window.setTimeout(tick, 20_000);
    return () => { if (t) window.clearTimeout(t); };
  }, [idx, total, showSkin]);

  const videoUrl = current?.video_url ?? null;

  const onVideoPlay = () => {
    if (videoElRef.current) media.register(videoElRef.current);
  };
  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = videoElRef.current;
    if (!el) return;
    if (el.muted) {
      // Unmuting: this click is the user gesture, register as active player.
      media.register(el);
      el.muted = false;
      setMuted(false);
      // Ensure playback survives autoplay-with-sound restrictions.
      void el.play().catch(() => {
        el.muted = true;
        setMuted(true);
      });
    } else {
      el.muted = true;
      setMuted(true);
    }
  };

  return (
    <Link
      to="/app/clips"
      className="press fade-up relative block aspect-video w-full overflow-hidden rounded-3xl border border-border bg-card bg-gradient-to-br from-accent/30 via-fuchsia-500/20 to-pink-500/30 p-4"
    >
      {videoUrl && current && (
        <video
          key={current.id}
          ref={videoElRef}
          src={videoUrl}
          autoPlay
          muted={muted}
          loop
          playsInline
          onPlay={onVideoPlay}
          onError={() => {
            setErrored((e) => ({ ...e, [current.id]: true }));
            setIdx((i) => (total > 1 ? (i + 1) % total : i));
          }}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}
      {videoUrl && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/28 to-transparent" />
      )}
      {showSkin ? (
        <>
          <img
            src={skin!}
            alt=""
            onError={() => setSkinError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/78 via-black/22 to-transparent" />
        </>
      ) : !videoUrl ? (
        <Clapperboard className="relative h-10 w-10 text-foreground/90" strokeWidth={1.6} />
      ) : null}
      <div className="relative flex h-full flex-col justify-end">
        <div className="text-[10px] uppercase tracking-wider text-white/80">doomscroll era</div>
        <div className="font-display text-2xl font-bold text-white drop-shadow">brainrot 🎬</div>
      </div>

      {videoUrl && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label="Mute"
          aria-pressed={muted}
          className="press absolute bottom-3 right-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}
    </Link>
  );
}



