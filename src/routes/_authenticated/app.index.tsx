import { useEffect, useRef, useState } from "react";
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
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Maximize2,
} from "lucide-react";
import { CompactLiveNews } from "@/components/landing/LiveNewsSection";
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
  const wallpaper = theme?.wallpaper_url ?? null;
  const installPrompt = useInstallPrompt();


  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";

  return (
    <div className="relative bg-hero pb-6 min-h-screen">
      {wallpaper && (
        <div className="pointer-events-none fixed inset-0 -z-0">
          <img
            src={wallpaper}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => ((e.currentTarget.style.display = "none"))}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/35 via-background/20 to-background/60" />
        </div>
      )}
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
          <div className="mt-3 grid grid-cols-4 auto-rows-[5.25rem] gap-3">
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
            <HeroTile
              tileKey="clips"
              skin={skins.clips}
              to="/app/clips"
              icon={Clapperboard}
              label="Clips"
              tagline="watch the feed"
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
      <div
        className="relative grid h-11 w-11 place-items-center rounded-2xl overflow-hidden"
        style={
          showSkin
            ? undefined
            : { color: tint, background: `${tint}1A` }
        }
      >
        {showSkin ? (
          <img
            src={skin!}
            alt=""
            className="h-11 w-11 rounded-2xl object-cover"
            onError={() => setSkinError(true)}
          />
        ) : (
          <Icon className="h-5 w-5" />
        )}
        {locked && (
          <div className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-surface-2 border border-border">
            <Lock className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
        )}
      </div>
      <span className={`text-[11px] font-medium ${locked ? "text-muted-foreground" : ""}`}>{label}</span>
    </>
  );
  const base =
    "press fade-up flex flex-col items-center justify-center gap-2 rounded-2xl bg-card/85 p-2 border border-border";
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

type LiveEntry = { id: string; name: string; videoId: string };

function useLiveChannels(enabled: boolean) {
  return useQuery({
    queryKey: ["live-channels"],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("live-channels", { body: {} });
      if (error) throw error;
      return (Array.isArray(data?.channels) ? data.channels : []) as LiveEntry[];
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
  const { data: channels } = useLiveChannels(livePreview && !showSkin);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const videoId = livePreview && !showSkin && channels && channels.length
    ? channels[idx % channels.length].videoId
    : null;
  const currentName = livePreview && channels && channels.length
    ? channels[idx % channels.length].name
    : "";

  // 120s auto-tour, paused while user paused or controls visible
  useEffect(() => {
    if (!livePreview || showSkin || !channels || channels.length < 2) return;
    if (paused || controlsVisible) return;
    let t: number | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        t = window.setTimeout(tick, 120_000);
        return;
      }
      setIdx((i) => (i + 1) % channels.length);
    };
    t = window.setTimeout(tick, 120_000);
    return () => { if (t) window.clearTimeout(t); };
  }, [idx, channels, livePreview, showSkin, paused, controlsVisible]);

  const yt = (func: string, args: unknown[] = []) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    try {
      w.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    } catch { /* noop */ }
  };

  const bumpHide = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 15_000);
  };
  const showControls = () => { setControlsVisible(true); bumpHide(); };
  useEffect(() => () => { if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current); }, []);

  // Non-live path: unchanged Link
  if (!videoId) {
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        search={search as any}
        style={{ animationDelay: `${delay}ms` }}
        className={`press fade-up col-span-2 row-span-2 relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between`}
      >
        {showSkin ? (
          <img
            src={skin!}
            alt=""
            className="relative h-10 w-10 rounded-xl object-cover"
            onError={() => setSkinError(true)}
          />
        ) : (
          <Icon className="h-10 w-10 text-foreground/90" strokeWidth={1.6} />
        )}
        <div className="relative">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tagline}</div>
          <div className="font-display text-2xl font-bold">{label}</div>
        </div>
      </Link>
    );
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muted ? 1 : 0}&controls=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(origin)}`;

  const onTileClick = () => {
    if (controlsVisible) setControlsVisible(false);
    else showControls();
  };
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); bumpHide(); };
  const gotoIdx = (next: number) => {
    const total = channels!.length;
    setIdx(((next % total) + total) % total);
    setPaused(false);
  };
  const ctrlBtn = "glass press grid h-8 w-8 place-items-center rounded-full text-foreground";

  return (
    <div
      onClick={onTileClick}
      role="button"
      tabIndex={0}
      style={{ animationDelay: `${delay}ms` }}
      className={`press fade-up col-span-2 row-span-2 relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between cursor-pointer`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <iframe
          key={`${videoId}-${muted ? "m" : "s"}`}
          ref={iframeRef}
          src={src}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture"
          className="absolute left-1/2 top-1/2 h-full w-auto -translate-x-1/2 -translate-y-1/2 aspect-video min-h-full min-w-full"
          title="Live preview"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

      <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        LIVE
      </span>

      <div className="relative">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tagline}</div>
        <div className="font-display text-2xl font-bold">{label}</div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-2 z-10 flex flex-col items-center gap-1 transition-opacity duration-300 ${controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      >
        {currentName && (
          <span className="glass rounded-full px-2 py-0.5 text-[10px] text-foreground/90">{currentName}</span>
        )}
        <div className="glass flex items-center gap-1 rounded-full p-1">
          <button className={ctrlBtn} aria-label="Previous channel" onClick={(e) => { stop(e); gotoIdx(idx - 1); }}>
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            className={ctrlBtn}
            aria-label={paused ? "Play" : "Pause"}
            onClick={(e) => { stop(e); if (paused) { yt("playVideo"); setPaused(false); } else { yt("pauseVideo"); setPaused(true); } }}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button className={ctrlBtn} aria-label="Next channel" onClick={(e) => { stop(e); gotoIdx(idx + 1); }}>
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            className={ctrlBtn}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={(e) => { stop(e); if (muted) { yt("unMute"); setMuted(false); } else { yt("mute"); setMuted(true); } }}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
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

