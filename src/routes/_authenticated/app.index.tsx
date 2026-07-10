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
} from "lucide-react";
import { CompactLiveNews, loadYouTubeApi, useMyTv } from "@/components/landing/LiveNewsSection";
import {
  CustomizeButton,
  useUserTheme,
  type TileKey,
} from "@/components/customize/CustomizeSheet";

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
  const installPrompt = useInstallPrompt();


  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";

  return (
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
                  className="press rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground"
                >
                  Install
                </button>
                <button
                  onClick={installPrompt.dismiss}
                  className="press rounded-full px-2 py-1 text-[11px] text-muted-foreground"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          <CompactLiveNews />


          <div className="mt-7 px-1 flex items-center justify-between">
            <h2 className="font-display text-xs uppercase tracking-wider text-muted-foreground">
              the lineup
            </h2>
            <CustomizeButton />
          </div>
          <div className="mt-3">
            <HeroTile
              tileKey="watch"
              skin={skins.watch}
              to="/app/news"
              search={{ tab: "watch" as const }}
              icon={Tv}
              label="Watch"
              tagline="live tv rn"
              gradient="from-primary/30 via-primary/10 to-accent/30"
              delay={0}
              livePreview
            />
          </div>
          <div className="mt-3 grid grid-cols-4 auto-rows-[5.25rem] gap-3">
            <ClipsHeroTile
              skin={skins.clips}
              gradient="from-accent/30 via-fuchsia-500/20 to-pink-500/30"
              delay={60}
            />
            {(
              [
                { key: "wallet", to: "/app/wallet", icon: Coins, label: "Wallet", color: "#F59E0B" },
                { key: "ting", to: "/app/ai", icon: Sparkles, label: "Ting", color: "#8B5CF6" },
                { key: "rides", to: "/app/rides", icon: Car, label: "Rides", color: "#38BDF8" },
                { key: "miniapps", to: "/app/miniapps", icon: LayoutGrid, label: "Mini Apps", color: "#A3E635" },
                { key: "upi", to: "/app/upi", icon: IndianRupee, label: "UPI Pay", color: "#22C55E" },
                { key: "learn", to: "/app/learn", icon: GraduationCap, label: "Learn", color: "#FB923C" },
                { key: "wander", to: "/app/travel", icon: Plane, label: "Wander", color: "#22D3EE" },
                { key: "pulse", to: "/app/news", icon: Newspaper, label: "Pulse", color: "#F472B6" },
              ] as const
            ).map((t, i) => (
              <Tile
                key={t.label}
                to={t.to}
                icon={t.icon}
                label={t.label}
                color={t.color}
                skin={skins[t.key as TileKey]}
                delay={120 + i * 40}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
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
          className="relative grid h-11 w-11 place-items-center rounded-2xl overflow-hidden"
          style={{ color: tint, background: `${tint}1A` }}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      {locked && (
        <div className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-surface-2 border border-border z-10">
          <Lock className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
      <span className={`relative z-10 text-[11px] font-medium ${showSkin ? "text-white drop-shadow" : ""} ${locked ? "text-muted-foreground" : ""}`}>{label}</span>
    </>
  );
  const base =
    "press fade-up relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-2xl bg-card/85 p-2 border border-border";
  const style = { animationDelay: `${delay}ms` };
  if (locked) {
    return <div className={`${base} opacity-60`} style={style}>{inner}</div>;
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className={`${base} hover:bg-surface-2 transition-colors`} style={style}>
      {inner}
    </Link>
  );
}

type GenreId = "news" | "sports" | "entertainment" | "finance" | "influencer" | "lifestyle" | "mytv";
type Video = {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  thumbnail: string;
};
type LiveGenre = { id: GenreId; name: string; emoji: string; live: boolean; videos: Video[] };

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
  const [genreId, setGenreId] = useState<GenreId>("news");
  const activeGenre =
    genres.find((g) => g.id === genreId) ?? genres[0] ?? null;
  const videos = activeGenre?.videos ?? [];
  const isLiveGenre = !!activeGenre?.live;


  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const hideTimerRef = useRef<number | null>(null);
  const playerHostId = `yt-tile-${useId().replace(/:/g, "")}`;
  const playerCoverClass = "absolute left-1/2 top-1/2 h-full w-auto -translate-x-1/2 -translate-y-1/2 aspect-video min-h-full min-w-full";

  const current = livePreview && !showSkin && videos.length
    ? videos[idx % videos.length]
    : null;
  const videoId = current?.videoId ?? null;
  const currentLabel = current
    ? (isLiveGenre ? current.channelName : current.title)
    : "";

  // 120s auto-tour cap (per video), also honored across uploads (natural ENDED advance handles it too)
  const vLen = videos.length;
  useEffect(() => {
    if (!livePreview || showSkin || vLen < 2) return;
    if (paused || controlsVisible) return;
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
  }, [idx, vLen, livePreview, showSkin, paused, controlsVisible]);

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
                // ENDED → next video
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
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
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
    bumpHide();
  };
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
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

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
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-black/40 text-foreground/85 border-white/15"}`}
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      )}
      {showSkin ? (
        <>
          <img
            src={skin!}
            alt=""
            onError={() => setSkinError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
        </>
      ) : (
        <Clapperboard className="relative h-10 w-10 text-foreground/90" strokeWidth={1.6} />
      )}
      <div className="relative">
        <div className={`text-[10px] uppercase tracking-wider ${showSkin ? "text-white/80" : "text-muted-foreground"}`}>watch the feed</div>
        <div className={`font-display text-2xl font-bold ${showSkin ? "text-white drop-shadow" : ""}`}>Clips</div>
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

