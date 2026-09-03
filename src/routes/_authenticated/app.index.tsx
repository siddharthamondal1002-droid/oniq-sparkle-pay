import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Send,
  Lock,
  Clapperboard,
  Film,
  Play,
  Heart,
  BookOpen,
  Volume2,
  VolumeX,
  ArrowRight,
  ChevronRight,
  Plus,
  SkipBack,
  SkipForward,
  Tv,
} from "lucide-react";
import { useVitalsTileColor } from "@/components/vitals/useVitalsTileColor";

import {
  CustomizeButton,
  useHiddenTiles,
  useUserTheme,
} from "@/components/customize/CustomizeSheet";
import { MediaProvider, useMediaCoordinator } from "@/lib/MediaProvider";
import { useCountry } from "@/lib/country";
import { isAvailable } from "@/data/countryRegistry";
import { useIsAdult18 } from "@/lib/useIsAdult18";
import { SafeMount } from "@/components/SafeMount";
import { RegionBanner } from "@/components/home/RegionBanner";
import { HomeCountryPrompt } from "@/components/home/HomeCountryPrompt";
import { useT } from "@/lib/i18n/LanguageProvider";
import { tileName, type TileKey } from "@/lib/i18n/tileLabel";
import { AnticipatoryCard } from "@/components/home/AnticipatoryCard";
import { recordSignal } from "@/lib/personalisation";
import { LORE_COLLECTIONS } from "@/data/lores";
import { WatchPlayer, type WatchPlayerHandle } from "@/components/watch/WatchPlayer";
import {
  faithChannelsFor,
  playableOf,
  playableOfChannelId,
  watchDirectoryFor,
  type Playable,
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
import {
  MYTV_GENRE_ID,
  USER_GENRE_PREFIX,
  playableOfMyTv,
  playableOfUserChannel,
  useMyTv,
  useSession,
  useUserChannels,
  useUserGenres,
} from "@/lib/userWatch";
import { AiOutputReport } from "@/components/safety/AiOutputReport";
import { useWatchCounts } from "@/lib/watch/hooks";
import type { WatchSurface } from "@/lib/watch/surfaces";

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
  const { t } = useT();

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
                  <p className="font-display text-3xl font-bold text-gradient-primary">
                    {t("home.greeting", "Hey")}, {first} 👋
                  </p>
                )}
              </div>

              <Link
                to="/app/profile"
                aria-label="Open profile"
                className="press grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground font-bold overflow-hidden"
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Your profile picture"
                    className="h-full w-full object-cover"
                  />
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

            <AnticipatoryCard />

            <div className="mt-7 px-1 flex items-center justify-between">
              <h2 className="font-display text-xs uppercase tracking-wider text-muted-foreground">
                your feed
              </h2>
              <CustomizeButton />
            </div>

            <div className="mt-3">
              <HomeMediaBanner />
            </div>

            <RegionBanner />

            <div className="mt-3">
              <HomeCountryPrompt />
            </div>

            <div className="mt-7 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              also in ONIQ
            </div>
            <SafeMount name="AlsoInOniqRow">
              <AlsoInOniqRow
                tiles={[
                  // Names come from the shared table (tileLabel.ts) — never inline.
                  { key: "ting", to: "/app/ai" },
                  { key: "learn", to: "/app/learn" },
                  { key: "rides", to: "/app/rides" },
                  { key: "miniapps", to: "/app/miniapps" },
                  // NO UPI TILE — owner directive, 2026-08-17: Scan & Pay and
                  // every pay-by-QR entry point is hidden. The route still
                  // resolves for deep links; nothing on Home points at it.
                  { key: "official", to: "/app/official" },
                  { key: "pulse", to: "/app/news" },
                  { key: "faith", to: "/app/faith" },
                  // India-only by the feature registry, same as upi above —
                  // owner directive 2026-08-16. Channels PLAY there, in
                  // YouTube's own player, and the personal genres live there
                  // too; see src/routes/_authenticated/app.watch.tsx.
                  { key: "watch", to: "/app/watch" },
                  { key: "vitals", to: "/app/vitals", color: vitalsColor },
                  { key: "wander", to: "/app/travel" },
                  { key: "earn", to: "/app/earn" },
                  { key: "university", to: "/app/university" },
                  { key: "lores", to: "/app/lores" },
                  // 18+ only — hidden entirely for minors and null-DOB accounts.
                  // Jobs is one screen now: the CV builder and the job & gig
                  // directory are tabs of /app/jobs behind a single 18+ gate.
                  // The separate "Job apps" tile is gone.
                  { key: "jobs", to: "/app/jobs", adultOnly: true },
                ]}
                hidden={hidden}
              />
            </SafeMount>
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
          style={{
            color: tint,
            background: `${tint}26`,
            boxShadow: `0 0 18px ${tint}40, inset 0 0 0 1px ${tint}33`,
          }}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
      {locked && (
        <div className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-surface-2 border border-border z-10">
          <Lock className="h-2.5 w-2.5 text-muted-foreground" />
        </div>
      )}
      <span
        className={`font-display relative z-10 text-xs font-medium ${showSkin ? "text-white drop-shadow" : ""} ${locked ? "text-muted-foreground" : ""}`}
      >
        {label}
      </span>
    </>
  );
  const base =
    "press fade-up relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-2xl bg-card p-2 border border-border transition-colors";
  const washStyle = !showSkin
    ? {
        background: `radial-gradient(120% 90% at 0% 0%, ${tint}47 0%, ${tint}14 35%, transparent 65%), hsl(var(--card))`,
      }
    : undefined;
  const style = { animationDelay: `${delay}ms`, ...(washStyle ?? {}) };
  if (locked) {
    return (
      <div className={`${base} opacity-60`} style={style}>
        {inner}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className={`${base} hover:brightness-110`} style={style}>
      {inner}
    </Link>
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
    return () => {
      if (t) window.clearTimeout(t);
    };
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
        <div
          className={`text-[10px] uppercase tracking-wider ${showSkin ? "text-white/80" : "text-muted-foreground"}`}
        >
          doomscroll era
        </div>
        <div
          className={`font-display text-2xl font-bold ${showSkin ? "text-white drop-shadow" : ""}`}
        >
          mast 🎬
        </div>
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

type NewsItem = {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  image?: string;
};

// ---------- Primary tiles ----------

function PrimaryTile({
  to,
  icon: Icon,
  label,
  sub,
  color,
  span,
  skin,
  delay = 0,
}: {
  to: string;
  icon: typeof Send;
  label: string;
  sub?: string;
  color: string;
  span: number;
  skin?: string;
  delay?: number;
}) {
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;

  const spanClass = span === 6 ? "col-span-6" : span === 3 ? "col-span-3" : "col-span-2";
  const height = span === 6 ? "h-28" : "h-24";

  return (
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
        style={{
          color,
          background: `${color}26`,
          boxShadow: `0 0 18px ${color}40, inset 0 0 0 1px ${color}33`,
        }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="relative">
        <div
          className={`font-display text-sm font-semibold ${showSkin ? "text-white drop-shadow" : "text-foreground"}`}
        >
          {label}
        </div>
        {sub && (
          <div
            className={`mt-0.5 font-sans text-[11px] normal-case tracking-normal font-normal ${showSkin ? "text-white/80 drop-shadow" : "text-muted-foreground"}`}
          >
            {sub}
          </div>
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
  const [home] = useCountry();
  const visible = tiles.filter(
    (t) => !(hidden as Set<string>).has(t.key) && isAvailable(t.key, home),
  );
  if (visible.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="no-scrollbar mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {visible.map((t) => {
          const skin = skins[t.key];
          const Icon = t.icon;
          return (
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
                style={{
                  color: t.color,
                  background: `${t.color}26`,
                  boxShadow: `inset 0 0 0 1px ${t.color}33`,
                }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={`font-display relative text-xs font-medium ${skin ? "text-white drop-shadow" : "text-foreground"}`}
              >
                {t.label}
              </span>
              <ChevronRight className="relative ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Study hero (Study-first home) ----------

type LearnerProfileLite = { id: string; name: string; board: string; class_level: string };
type RecentAttempt = {
  profile_id: string;
  subject: string;
  chapter: string | null;
  created_at: string;
};

function classLabel(c: string): string {
  if (c === "ug") return "UG";
  if (c === "pg") return "PG";
  if (c === "drop") return "Drop year";
  if (c === "aspirant") return "Aspirant";
  return `Class ${c}`;
}

function StudyHero() {
  const { data, isLoading } = useQuery({
    queryKey: ["study-hero"],
    staleTime: 30_000,
    queryFn: async () => {
      const [profilesRes, attemptsRes] = await Promise.all([
        (
          supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => Promise<{ data: LearnerProfileLite[] | null; error: Error | null }>;
              };
            };
          }
        )
          .from("learner_profiles")
          .select("id, name, board, class_level")
          .order("created_at", { ascending: true }),
        (
          supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                order: (
                  col: string,
                  opts: { ascending: boolean },
                ) => {
                  limit: (
                    n: number,
                  ) => Promise<{ data: RecentAttempt[] | null; error: Error | null }>;
                };
              };
            };
          }
        )
          .from("quiz_attempts")
          .select("profile_id, subject, chapter, created_at")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      return {
        profiles: profilesRes.data ?? [],
        recent: (attemptsRes.data ?? [])[0] ?? null,
      };
    },
  });

  const profiles = data?.profiles ?? [];
  const recent = data?.recent ?? null;
  const activeProfile =
    (recent && profiles.find((p) => p.id === recent.profile_id)) || profiles[0] || null;

  const hasProfile = profiles.length > 0;
  const hasRecent = !!recent && !!activeProfile;

  return (
    <Link
      to="/app/study"
      onClick={() => void recordSignal("hub_open", "study")}
      className="press fade-up relative block overflow-hidden rounded-3xl border border-border p-5"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #FB718540 0%, #FB718510 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #FB923C33 0%, #FB923C0d 45%, transparent 75%), hsl(var(--card))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className="grid h-12 w-12 place-items-center rounded-2xl"
          style={{
            color: "#FB7185",
            background: "#FB718526",
            boxShadow: "0 0 22px #FB718540, inset 0 0 0 1px #FB718533",
          }}
        >
          <BookOpen className="h-6 w-6" />
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          study 📚
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-surface" />
          <div className="h-6 w-56 animate-pulse rounded bg-surface" />
        </div>
      ) : hasRecent ? (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            continue · {activeProfile!.name} · {activeProfile!.board.toUpperCase()}{" "}
            {classLabel(activeProfile!.class_level)}
          </div>
          <div className="mt-1 font-display text-xl font-bold text-foreground">
            {recent!.subject}
            {recent!.chapter ? (
              <span className="text-muted-foreground"> · {recent!.chapter}</span>
            ) : null}
          </div>
        </div>
      ) : hasProfile ? (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {activeProfile!.name} · {activeProfile!.board.toUpperCase()}{" "}
            {classLabel(activeProfile!.class_level)}
          </div>
          <div className="mt-1 font-display text-xl font-bold text-foreground">
            pick a chapter to begin
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            no learner profile yet
          </div>
          <div className="mt-1 font-display text-xl font-bold text-foreground">
            set up your syllabus
          </div>
        </div>
      )}

      <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-bold uppercase tracking-wider text-background">
        {hasRecent ? "Resume studying" : hasProfile ? "Open study" : "Start studying"}
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

// ---------- "also in ONIQ" chip row ----------

function AlsoInOniqRow({
  tiles,
  hidden,
}: {
  tiles: {
    key: TileKey;
    to: string;
    color?: string;
    search?: Record<string, unknown>;
    adultOnly?: boolean;
  }[];
  hidden: Set<TileKey>;
}) {
  const { lang } = useT();
  const [home] = useCountry();
  const isAdult = useIsAdult18();
  // Unsupported in this Home country => the tile does not render at all.
  // No greyed-out state, no disabled tile, no "coming soon".
  const visible = tiles.filter(
    (t) =>
      !(hidden as Set<string>).has(t.key) && isAvailable(t.key, home) && (!t.adultOnly || isAdult),
  );
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {visible.map((t) => (
        <Link
          key={t.key}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          to={t.to as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          search={t.search as any}
          onClick={() => void recordSignal("hub_open", t.key)}
          className="press fade-up inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          style={t.color ? { boxShadow: `inset 0 0 0 1px ${t.color}22` } : undefined}
        >
          {t.color && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: t.color }}
            />
          )}
          {tileName(lang, t.key, home)}
        </Link>
      ))}
    </div>
  );
}

// ---------- Home media banner: Study / Moments / Mast ----------

type BannerMode = "study" | "moments" | "mast" | "watch";
const BANNER_MODE_KEY = "oniq.home.banner.mode";

const BANNER_MODES: BannerMode[] = ["study", "moments", "mast", "watch"];

function isBannerMode(v: unknown): v is BannerMode {
  return typeof v === "string" && (BANNER_MODES as string[]).includes(v);
}

function HomeMediaBanner() {
  const [hidden] = useHiddenTiles();
  const { data: theme } = useUserTheme();
  const skins = theme?.tile_skins ?? {};
  const { lang } = useT();

  const [mode, setMode] = useState<BannerMode>(() => {
    if (typeof window === "undefined") return "study";
    try {
      const v = localStorage.getItem(BANNER_MODE_KEY);
      if (isBannerMode(v)) return v;
    } catch {
      /* noop */
    }
    return "study";
  });
  useEffect(() => {
    try {
      localStorage.setItem(BANNER_MODE_KEY, mode);
    } catch {
      /* noop */
    }
  }, [mode]);

  const [home] = useCountry();
  // Watch is registered India-only in the country registry, and this is where
  // the Home surface honours that. `isAvailable` answers TRUE for anything
  // unregistered, so the gate has to be read here rather than assumed.
  const watchAvailable = isAvailable("watch", home);

  // If the current tab is hidden (persisted, just toggled, or unavailable in
  // this country), fall back to the first tab that's still visible.
  const offered = BANNER_MODES.filter((m) => m !== "watch" || watchAvailable);
  useEffect(() => {
    if (hidden.has(mode) || !offered.includes(mode)) {
      const first = offered.find((m) => !hidden.has(m));
      if (first) setMode(first);
    }
    // `offered` is rebuilt every render; its CONTENT is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hidden, watchAvailable]);

  const tabs: { id: BannerMode; label: string }[] = offered.map((id) => ({
    id,
    label: tileName(lang, id, home),
  }));
  const visibleTabs = tabs.filter((tb) => !hidden.has(tb.id));

  if (visibleTabs.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-3 text-xs text-muted-foreground">
        all feed tiles are hidden — bring them back anytime from Customize 🎨
      </p>
    );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Home feed"
        className="mb-3 inline-flex rounded-full border border-border bg-card/70 p-1 text-[11px] font-semibold uppercase tracking-wider"
      >
        {visibleTabs.map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setMode(t.id)}
              className={`press rounded-full px-3 py-1.5 transition-colors ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === "study" && !hidden.has("study") && <StudyHero />}
      {mode === "moments" && !hidden.has("moments") && <MomentsPreview />}
      {mode === "mast" && !hidden.has("mast") && <MastPreview />}
      {mode === "watch" && watchAvailable && !hidden.has("watch") && <WatchPreview />}
    </div>
  );
}

type MomentPost = {
  id: string;
  content: string | null;
  media_urls: string[] | null;
  like_count: number | null;
  created_at: string;
  profiles: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

function MomentsPreview() {
  const { data, isLoading } = useQuery({
    queryKey: ["moments"],
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("moments_posts")
        .select(
          "id, content, media_urls, like_count, created_at, user_id, profiles:profiles!moments_posts_user_id_fkey(display_name, username, avatar_url)",
        )
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as MomentPost[];
    },
  });

  const all = data ?? [];
  const PAGE = 3;
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const [pageIdx, setPageIdx] = useState(0);
  const [pickNonce, setPickNonce] = useState(0);

  useEffect(() => {
    if (pageIdx >= pages) setPageIdx(0);
  }, [pages, pageIdx]);

  // Auto-rotate every 2 minutes; resets whenever user manually picks a page.
  useEffect(() => {
    if (pages <= 1) return;
    const id = window.setTimeout(() => {
      setPageIdx((i) => (i + 1) % pages);
    }, 120_000);
    return () => window.clearTimeout(id);
  }, [pageIdx, pages, pickNonce]);

  const pickPage = (i: number) => {
    setPageIdx(i);
    setPickNonce((n) => n + 1);
  };

  const posts = all.slice(pageIdx * PAGE, pageIdx * PAGE + PAGE);

  return (
    <div
      className="press fade-up relative block overflow-hidden rounded-3xl border border-border p-4"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #A78BFA40 0%, #A78BFA10 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #F472B633 0%, #F472B60d 45%, transparent 75%), hsl(var(--card))",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          moments ✨
        </div>
        <Link
          to="/app/chat/moments"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
        >
          Open all <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          <div className="h-14 animate-pulse rounded-xl bg-surface" />
          <div className="h-14 animate-pulse rounded-xl bg-surface" />
        </div>
      ) : posts.length === 0 ? (
        <Link to="/app/chat/moments" className="mt-4 block">
          <div className="font-display text-xl font-bold text-foreground">no moments yet</div>
          <div className="mt-1 text-xs text-muted-foreground">be the first to post ✨</div>
        </Link>
      ) : (
        <div className="mt-3 space-y-2">
          {posts.map((p) => {
            const who = p.profiles?.display_name || p.profiles?.username || "someone";
            const img = p.media_urls?.[0];
            const snippet = (p.content ?? "").trim();
            return (
              <Link
                key={p.id}
                to="/app/chat/moments"
                onClick={() => setPickNonce((n) => n + 1)}
                className="flex items-center gap-3 rounded-xl bg-card/60 p-2 border border-border/60"
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-surface grid place-items-center flex-shrink-0">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                    {who}
                  </div>
                  <div className="text-sm text-foreground truncate">
                    {snippet || "shared a photo"}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Heart className="h-3.5 w-3.5" />
                  {p.like_count ?? 0}
                </div>
              </Link>
            );
          })}
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-1.5">
              {Array.from({ length: pages }).map((_, i) => (
                <button
                  key={i}
                  aria-label={`Show moments page ${i + 1}`}
                  onClick={() => pickPage(i)}
                  className={`h-1.5 rounded-full transition-all ${i === pageIdx ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/40"}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Mast preview (clips teaser) ----------

type ClipPreview = {
  id: string;
  video_url: string;
  caption: string | null;
  like_count: number;
  comment_count: number;
  user_id: string;
  created_at: string;
};

// Originals with a playable file, flattened once — the home loop's playlist.
const HOME_ORIGINALS = LORE_COLLECTIONS.flatMap((c) => c.videos).filter((v) => !!v.url);

/**
 * The Home Watch loop — back under the banner toggle, autoplaying, muted.
 *
 * Owner directive, 2026-08-16 (evening): "loop player in home screen toggle
 * like before with autoplay". This is the tile that was removed with the rest
 * of Watch at d879305b, rebuilt on the same toggle the other home loops use
 * rather than as a tile of its own — one card, one player, one place a user
 * looks for it.
 *
 * TWO THINGS THAT LOOK LIKE OMISSIONS AND ARE NOT.
 *
 * Nothing is layered on the frame. The mast and originals faces put a mute
 * button, a gradient and a dot row on top of their <video>; those are ONIQ's
 * own files and it may. YouTube's embed terms forbid rendering anything in
 * front of any part of their player, so every control here sits above or
 * below the frame, and the mute button drives the player through the API
 * instead of covering it.
 *
 * And it starts MUTED, which is what autoplay means in a browser. Unmuted
 * autoplay is refused outright; the speaker button under the frame is the
 * user gesture that turns sound on, and taking it registers with the
 * single-audio-source coordinator so nothing else on Home keeps playing.
 *
 * THE GENRE SELECTOR, added 2026-08-16 on the owner's note that it was
 * missing here. The original home tile carried an emoji-only genre row inside
 * its control overlay; this card has no overlay to put it in (see above), so
 * the row sits under the header where it is always visible rather than behind
 * a tap. My TV and the user's own genres appear in it exactly as they do on
 * the Watch screen — the whole point of a personal genre is that it follows
 * you to where you actually look.
 */
const HOME_GENRES: { key: string; emoji: string; label: string }[] = [
  { key: "all", emoji: "🌐", label: "All" },
  { key: "news", emoji: "📰", label: "News" },
  { key: "sports", emoji: "🏏", label: "Sports" },
  { key: "entertainment", emoji: "🎬", label: "Entertainment" },
  { key: "finance", emoji: "📈", label: "Finance" },
  { key: "influencer", emoji: "✨", label: "Creators" },
  { key: "lifestyle", emoji: "🌿", label: "Lifestyle" },
  // Films from Vimeo and the Internet Archive, played in their own players
  // (owner directive, 2026-09-03 afternoon). Offered only while the
  // directory has one, like every chip here.
  { key: "film", emoji: "🎥", label: "Films" },
];

/** Seconds a channel holds the Home card before the tour moves on (owner directive, 2026-09-03). */
export const TOUR_MS = 20_000;
/** The devotional genre is exempt from the 20-second tour and keeps its original two minutes. */
export const DEVOTIONAL_TOUR_MS = 120_000;
/** While the app is in the background the tour only re-checks; it never advances. */
const HIDDEN_RECHECK_MS = 30_000;

function WatchPreview() {
  const navigate = useNavigate();
  const media = useMediaCoordinator();
  const userId = useSession();
  const playerRef = useRef<WatchPlayerHandle | null>(null);
  const [idx, setIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const [dead, setDead] = useState(false);
  const failStreakRef = useRef(0);

  // Shared with the Watch screen, so picking a genre in one and opening the
  // other lands you where you left off.
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      return localStorage.getItem("oniq.watch.lastGenre") || "all";
    } catch {
      return "all";
    }
  });

  const userGenresQ = useUserGenres(userId);
  const myTvQ = useMyTv(userId);
  const userGenres = useMemo(() => userGenresQ.data ?? [], [userGenresQ.data]);
  const activeUserGenreId = tab.startsWith(USER_GENRE_PREFIX)
    ? tab.slice(USER_GENRE_PREFIX.length)
    : null;
  const userChannelsQ = useUserChannels(userId, activeUserGenreId);

  // THE LIBRARY ROW (owner, 2026-09-03 evening: "watch new addition not on
  // Home page"). The library shipped reachable only from the Watch screen's
  // header; this is its front door. Two head-count requests, nothing else:
  // Home never fetches a page of the library it does not render. Every chip
  // deep-links to /app/watch/library on the surface it names.
  const counts = useWatchCounts(userId);
  const openLibrary = (surface?: WatchSurface) =>
    navigate({ to: "/app/watch/library", search: surface ? { surface } : {} });

  // THE DEVOTIONAL LOOP. This is the tile the removal commit named — "the
  // second player behind the home Watch tile (with its devotional loop
  // timer)". Anchored to real timestamps so backgrounding the app resumes the
  // loop rather than restarting it; see src/lib/devotionalLoop.ts.
  const faith = useMemo(() => readFaithPref(), []);
  const [loop, setLoop] = useState<LoopState>(() => readLoop());
  const [justBrowse, setJustBrowse] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const isDevotional = tab === DEVOTIONAL_GENRE_ID;
  const phase = isDevotional ? loopPhase(loop, nowTs) : "none";
  const loopActive = phase === "active";
  const loopEnded = phase === "ended";
  const showPicker = isDevotional && !loopActive && !loopEnded && !justBrowse;

  useEffect(() => {
    if (!isDevotional || !loop) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isDevotional, loop]);

  useEffect(() => {
    if (!isDevotional) setJustBrowse(false);
  }, [isDevotional]);

  // LIVE FEEDS BELONG HERE, and excluding them is what broke News.
  //
  // This list used to be filtered to entries with an uploads playlist, on the
  // reasoning that a live channel never ends so it cannot rotate. The
  // reasoning was sound and the effect was not: every one of the eight news
  // entries in the directory IS a live broadcaster — they are exactly the
  // roster in src/data/watchChannels.ts — so the filter emptied the 📰 genre
  // completely and the card fell through to "nothing in here yet". Measured,
  // not guessed: news 8 entries, 8 live, 0 surviving that filter, while every
  // other genre kept all of its own.
  //
  // Worse than a dead chip, it could strand a user who never tapped one. The
  // selected genre is stored under oniq.watch.lastGenre and SHARED with the
  // Watch screen, where News works — so choosing News there and coming back to
  // Home opened the card already empty.
  //
  // Rotation survives. A live feed cannot fire ENDED, but the 2-minute
  // auto-tour below moves the card along regardless, and onError still steps
  // past a broadcaster that is off air. What a live item still does NOT do is
  // start itself: WatchPlayer's live path has never carried autoplay and that
  // is unchanged here, so News shows YouTube's own player waiting on a tap
  // rather than a 24/7 news channel talking at an unattended home screen.
  const directory = useMemo(() => watchDirectoryFor(null), []);

  // NO CHIP FOR A GENRE WITH NOTHING IN IT. HOME_GENRES is a fixed list and
  // the directory is not; the two silently drifting apart is precisely what
  // produced an empty News chip that looked like a loading failure. Deriving
  // the row from what is actually in the directory means a genre can only be
  // offered when tapping it does something.
  const genreChips = useMemo(() => {
    const present = new Set<string>(directory.map((e) => e.genre));
    return HOME_GENRES.filter((g) => g.key === "all" || present.has(g.key));
  }, [directory]);

  // And a stored genre that is no longer offered must not strand the card on
  // an empty frame with no chip lit. The key arrives from the Watch screen, so
  // it can hold anything that screen ever offered.
  const tabIsOffered =
    tab === MYTV_GENRE_ID ||
    tab === DEVOTIONAL_GENRE_ID ||
    tab.startsWith(USER_GENRE_PREFIX) ||
    genreChips.some((g) => g.key === tab);
  useEffect(() => {
    if (!tabIsOffered) setTab("all");
  }, [tabIsOffered]);

  const loopable: Playable[] = useMemo(() => {
    if (tab === MYTV_GENRE_ID) {
      return (myTvQ.data ?? []).map(playableOfMyTv).filter(Boolean) as Playable[];
    }
    if (isDevotional) {
      // Strict faith isolation, same rule as everywhere else: this user's
      // faith or nothing. Never a default list.
      return faithChannelsFor(faith)
        .map((e) => playableOfChannelId(e.channelId, e.name))
        .filter(Boolean) as Playable[];
    }
    if (activeUserGenreId) {
      return (userChannelsQ.data ?? []).map(playableOfUserChannel).filter(Boolean) as Playable[];
    }
    return directory
      .filter((e) => tab === "all" || e.genre === tab)
      .map(playableOf)
      .filter(Boolean) as Playable[];
  }, [tab, isDevotional, faith, activeUserGenreId, directory, myTvQ.data, userChannelsQ.data]);

  const current = loopable.length ? loopable[idx % loopable.length] : null;

  // An elapsed devotional loop stops the rotation without cutting the current
  // track off mid-recitation. Through a ref: the player's handlers bind once.
  const stopAdvanceRef = useRef(false);
  useEffect(() => {
    stopAdvanceRef.current = loopEnded;
  }, [loopEnded]);

  const advance = useCallback(
    (reason: "error" | "ended") => {
      if (stopAdvanceRef.current && reason === "ended") return;
      const total = loopable.length;
      if (total === 0) return;
      if (reason === "error") failStreakRef.current += 1;
      if (failStreakRef.current >= total) {
        setDead(true);
        return;
      }
      setIdx((i) => (i + 1) % total);
    },
    [loopable.length],
  );

  /**
   * THE AUTO-TOUR, also recovered from the removed tile.
   *
   * A home tile that sits on one channel until it happens to end is not a
   * preview of anything, so it moves on by itself. Owner directive,
   * 2026-09-03 (evening): "keep loop timing 20 sec for each channel except
   * devotional" — every genre tours at TOUR_MS; the devotional genre is
   * exempt and keeps the original two minutes while browsing. Two
   * conditions from the original are load-bearing:
   *
   *   - a HIDDEN document defers rather than advances. Without that, a phone
   *     left in a pocket burns through the whole roster and comes back on a
   *     channel the user never chose.
   *   - a RUNNING devotional loop turns the tour OFF entirely. That is the
   *     difference between a loop and a shuffle: each track plays out and the
   *     ENDED event wraps, instead of a timer cutting it short.
   */
  const vLen = loopable.length;
  useEffect(() => {
    if (vLen < 2) return;
    if (isDevotional && (loopActive || loopEnded || showPicker)) return;
    let t: number | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        t = window.setTimeout(tick, HIDDEN_RECHECK_MS);
        return;
      }
      setIdx((i) => (i + 1) % vLen);
    };
    t = window.setTimeout(tick, isDevotional ? DEVOTIONAL_TOUR_MS : TOUR_MS);
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [idx, vLen, isDevotional, loopActive, loopEnded, showPicker]);

  const startLoop = (sec: number) => {
    const now = Date.now();
    writeLoop(now, sec);
    setLoop({ startedAt: now, durationSec: sec });
    setJustBrowse(false);
    setNowTs(now);
    failStreakRef.current = 0;
    setDead(false);
  };

  const pickTab = (t: string) => {
    if (t === tab) return;
    failStreakRef.current = 0;
    setDead(false);
    setTab(t);
    setIdx(0);
    try {
      localStorage.setItem("oniq.watch.lastGenre", t);
    } catch {
      /* noop */
    }
  };

  const bindPlayer = useCallback((h: WatchPlayerHandle | null) => {
    playerRef.current = h;
    setMuted(true);
  }, []);

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      media.register({ pause: () => p.pause(), mute: () => p.mute() });
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  const step = (delta: number) => {
    if (loopable.length === 0) return;
    failStreakRef.current = 0;
    setDead(false);
    setIdx((i) => (i + delta + loopable.length) % loopable.length);
  };

  return (
    <div
      className="fade-up relative overflow-hidden rounded-3xl border border-border p-4"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #00D4B840 0%, #00D4B810 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #00A8E833 0%, #00A8E80d 45%, transparent 75%), hsl(var(--card))",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-foreground">
          <Tv className="h-3 w-3" /> watch 📺
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/app/watch" })}
          className="press inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Open all <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* THE LIBRARY ROW. Continue and Inbox carry live counts; Resurface is
          one tap away; Save a link opens the sheet straight from Home. */}
      {userId && (
        <div
          className="no-scrollbar mt-3 flex items-center gap-1 overflow-x-auto"
          data-testid="home-watch-library"
          aria-label="Your Watch library"
        >
          <button
            type="button"
            onClick={() => openLibrary()}
            aria-label="Open your Watch library"
            className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground"
          >
            📚 library
          </button>
          <HomeLibraryChip
            label="Continue"
            count={counts.data?.unfinished}
            onClick={() => openLibrary("continue")}
          >
            ▶️
          </HomeLibraryChip>
          <HomeLibraryChip
            label="Inbox"
            count={counts.data?.inbox}
            onClick={() => openLibrary("inbox")}
          >
            📥
          </HomeLibraryChip>
          <HomeLibraryChip label="Resurface" onClick={() => openLibrary("resurface")}>
            🌊
          </HomeLibraryChip>
          <button
            type="button"
            data-testid="home-watch-save"
            onClick={() => navigate({ to: "/app/watch/library", search: { save: true } })}
            aria-label="Save a link to your Watch library"
            className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
          >
            <Plus className="h-3 w-3" /> save a link
          </button>
        </div>
      )}

      {/* THE GENRE SELECTOR. Emoji-forward so seven of them fit a phone. */}
      <div
        className="no-scrollbar mt-3 flex items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label="Watch genre"
      >
        {genreChips.map((g) => (
          <HomeGenreChip
            key={g.key}
            active={tab === g.key}
            label={g.label}
            onClick={() => pickTab(g.key)}
          >
            {g.emoji}
          </HomeGenreChip>
        ))}
        {/* Devotional, only once a faith has been chosen. No faith, no tab —
            never a default tradition. */}
        {faith && (
          <HomeGenreChip
            active={isDevotional}
            label="Devotional"
            onClick={() => pickTab(DEVOTIONAL_GENRE_ID)}
          >
            🙏
          </HomeGenreChip>
        )}
        {userId && (myTvQ.data?.length ?? 0) > 0 && (
          <HomeGenreChip
            active={tab === MYTV_GENRE_ID}
            label="My TV"
            onClick={() => pickTab(MYTV_GENRE_ID)}
          >
            📺
          </HomeGenreChip>
        )}
        {userGenres.map((g) => (
          <HomeGenreChip
            key={g.id}
            active={tab === `${USER_GENRE_PREFIX}${g.id}`}
            label={g.name}
            onClick={() => pickTab(`${USER_GENRE_PREFIX}${g.id}`)}
          >
            🎯
          </HomeGenreChip>
        ))}
        {/* Making genres is a full-screen job — the sheets need room and the
            keyboard covers a card this size. The chip routes to where they
            live rather than duplicating the editor here. */}
        {userId && (
          <button
            type="button"
            data-testid="home-watch-manage"
            onClick={() => navigate({ to: "/app/watch" })}
            aria-label="Add a genre or manage My TV"
            className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground"
          >
            <Plus className="h-3 w-3" /> genre
          </button>
        )}
      </div>

      {/* THE DEVOTIONAL LOOP CONTROLS — above the frame, never over it. */}
      <div className="mt-3">
        {showPicker && (
          <DevotionalPicker compact onStart={startLoop} onSkip={() => setJustBrowse(true)} />
        )}
        {isDevotional && loopActive && (
          <DevotionalRunning
            loop={loop}
            now={nowTs}
            onStop={() => {
              clearLoop();
              setLoop(null);
              setJustBrowse(true);
            }}
          />
        )}
        {isDevotional && loopEnded && (
          <DevotionalEnded
            onReplay={() => loop && startLoop(loop.durationSec)}
            onBrowse={() => {
              clearLoop();
              setLoop(null);
              setJustBrowse(true);
            }}
          />
        )}
      </div>

      {/* THE FRAME, AND NOTHING OVER IT. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border/60 bg-black">
        {dead || !current ? (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-muted-foreground">
            {loopable.length === 0
              ? isDevotional
                ? "no channels listed for your faith yet 🌙"
                : "nothing in here yet 📺"
              : "streams are napping — try later 📺"}
          </div>
        ) : (
          <WatchPlayer
            key={`${current.kind}:${tab}:${idx}`}
            item={current}
            autoplay
            onAdvance={advance}
            onReady={bindPlayer}
            className="absolute inset-0 h-full w-full"
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card/70 p-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous channel"
            className="tap press grid h-7 w-7 place-items-center rounded-full text-foreground"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next channel"
            className="tap press grid h-7 w-7 place-items-center rounded-full text-foreground"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            className="tap press grid h-7 w-7 place-items-center rounded-full text-foreground"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="min-w-0 flex-1 truncate text-xs text-foreground">
          {current ? current.name : "—"}
        </div>
      </div>
    </div>
  );
}

function HomeLibraryChip({
  label,
  count,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count ? `${label}, ${count}` : label}
      title={label}
      className="press inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card/60 px-2 py-1 text-xs text-foreground"
    >
      <span aria-hidden="true">{children}</span>
      <span>{label}</span>
      {count ? (
        <span className="rounded-full bg-primary/20 px-1.5 text-[11px] font-semibold tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

function HomeGenreChip({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`press shrink-0 whitespace-nowrap rounded-full border px-2 py-1 text-xs transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/60"
      }`}
    >
      {children}
    </button>
  );
}

function MastPreview() {
  const navigate = useNavigate();
  const media = useMediaCoordinator();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [pickNonce, setPickNonce] = useState(0);
  const [muted, setMuted] = useState(true);
  // OWNER DIRECTIVE: Originals live on Home UNDER A TOGGLE, with the same
  // loop features as the brainrot card — autoplay, loop, swipe-to-advance,
  // mute, auto-rotate. One card, two faces; the choice sticks per session.
  const [face, setFace] = useState<"mast" | "originals">(() => {
    if (typeof sessionStorage === "undefined") return "mast";
    return (sessionStorage.getItem("oniq_home_loop") as "mast" | "originals") ?? "mast";
  });

  const { data, isLoading } = useQuery({
    queryKey: ["clips-preview"],
    staleTime: 60_000,
    queryFn: async () => {
      // Reuse the same feed RPC used by Chat's Reels tab.
      const { data, error } = await supabase.rpc("clips_feed", { _limit: 6, _offset: 0 });
      if (error) throw error;
      return (data ?? []) as ClipPreview[];
    },
  });

  const clips = data ?? [];
  const listLength = face === "mast" ? clips.length : HOME_ORIGINALS.length;
  const active = face === "mast" ? clips[idx % Math.max(1, clips.length)] : undefined;
  const activeLore =
    face === "originals" ? HOME_ORIGINALS[idx % Math.max(1, HOME_ORIGINALS.length)] : undefined;

  // Auto-advance every 30s; resets whenever idx or pickNonce changes so a
  // manual tap gets a fresh 30s countdown rather than a stale timer firing.
  useEffect(() => {
    if (listLength <= 1) return;
    const t = setTimeout(() => {
      setIdx((i) => (i + 1) % listLength);
    }, 30_000);
    return () => clearTimeout(t);
  }, [idx, pickNonce, listLength]);

  // Register the current video with the single-audio-source coordinator so
  // Only one media surface plays audio at a time.
  useEffect(() => {
    if (videoRef.current) media.register(videoRef.current);
  }, [idx, face, media]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, idx, face]);

  const openAll = () => navigate({ to: face === "mast" ? "/app/chat/reels" : "/app/lores" });

  return (
    <div
      onClick={openAll}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openAll();
      }}
      className="press fade-up relative block cursor-pointer overflow-hidden rounded-3xl border border-border p-4"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #F59E0B40 0%, #F59E0B10 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #EC489933 0%, #EC48990d 45%, transparent 75%), hsl(var(--card))",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
          {(
            [
              ["mast", "mast 🎬"],
              ["originals", "originals 🍿"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFace(k);
                setIdx(0);
                setPickNonce((n) => n + 1);
                if (typeof sessionStorage !== "undefined")
                  sessionStorage.setItem("oniq_home_loop", k);
              }}
              className={`press inline-flex items-center gap-1 rounded-full px-2 py-1 ${
                face === k ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              {k === "mast" ? <Film className="h-3 w-3" /> : null}
              {label}
            </button>
          ))}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          Open all <ChevronRight className="h-3 w-3" />
        </div>
      </div>

      {face === "mast" && isLoading ? (
        <div className="mt-3 aspect-video animate-pulse rounded-xl bg-surface" />
      ) : face === "mast" && (clips.length === 0 || !active) ? (
        <div className="mt-4">
          <div className="font-display text-xl font-bold text-foreground">no clips yet</div>
          <div className="mt-1 text-xs text-muted-foreground">be the first to post 🎬</div>
        </div>
      ) : face === "originals" && !activeLore ? (
        <div className="mt-4">
          <div className="font-display text-xl font-bold text-foreground">Originals soon</div>
          <div className="mt-1 text-xs text-muted-foreground">the first season is rendering 🍿</div>
        </div>
      ) : (
        <>
          <div
            className={`mt-3 relative mx-auto overflow-hidden rounded-xl bg-black border border-border/60 touch-pan-y ${
              face === "mast" ? "aspect-[9/16] w-full max-w-[240px]" : "aspect-video w-full"
            }`}
            onTouchStart={(e) => {
              const t = e.touches[0];
              (e.currentTarget as HTMLDivElement).dataset.sx = String(t.clientX);
              (e.currentTarget as HTMLDivElement).dataset.sy = String(t.clientY);
            }}
            onTouchEnd={(e) => {
              const el = e.currentTarget as HTMLDivElement;
              const sx = Number(el.dataset.sx ?? 0);
              const sy = Number(el.dataset.sy ?? 0);
              const t = e.changedTouches[0];
              const dx = t.clientX - sx;
              const dy = t.clientY - sy;
              const absX = Math.abs(dx);
              const absY = Math.abs(dy);
              // Swipe threshold — dominant axis must exceed 40px.
              if (Math.max(absX, absY) < 40) return;
              e.stopPropagation();
              const forward = absY > absX ? dy < 0 : dx < 0; // up or left → next
              setIdx((i) => (forward ? (i + 1) % listLength : (i - 1 + listLength) % listLength));
              setPickNonce((n) => n + 1);
            }}
          >
            {face === "mast" && active ? (
              <video
                ref={videoRef}
                key={active.id}
                src={`${active.video_url}${active.video_url.includes("#") ? "&" : "#"}t=0.5`}
                muted={muted}
                playsInline
                autoPlay
                loop
                preload="auto"
                disablePictureInPicture
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...({ disableremoteplayback: "" } as any)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : activeLore ? (
              <>
                <video
                  ref={videoRef}
                  key={activeLore.id}
                  src={activeLore.url ?? undefined}
                  muted={muted}
                  playsInline
                  autoPlay
                  loop
                  preload="metadata"
                  disablePictureInPicture
                  className="absolute inset-0 h-full w-full object-contain"
                />
                {/* Play's AI-content policy: generated video carries its label
                    wherever it plays, the home loop included. */}
                <span className="absolute start-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300 backdrop-blur">
                  AI-generated 🤖
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMuted((m) => !m);
              }}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-x-2 bottom-2 flex items-center justify-between text-[11px] text-white">
              {face === "mast" && active ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {active.like_count}
                  </span>
                  <Play className="h-3.5 w-3.5 opacity-90" />
                </>
              ) : activeLore ? (
                <>
                  <span className="truncate pe-2 font-semibold">{activeLore.title}</span>
                  <Play className="h-3.5 w-3.5 shrink-0 opacity-90" />
                </>
              ) : null}
            </div>
            {listLength > 1 && (
              <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1.5">
                {Array.from({ length: listLength }, (_, i) => (
                  <button
                    key={i}
                    aria-label={`item ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIdx(i);
                      setPickNonce((n) => n + 1);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === idx % listLength ? "w-4 bg-white" : "w-1.5 bg-white/40"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          {face === "mast" && active?.caption && (
            <div className="mt-3 text-xs text-foreground line-clamp-1">{active.caption}</div>
          )}
          {face === "originals" && activeLore && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs text-foreground">
                {activeLore.title} · {activeLore.runtime}
              </div>
              {/* Play policy: generated output must be reportable IN-APP from
                  the surface that plays it — the chip labels, this reports. */}
              <span
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="presentation"
              >
                <AiOutputReport surface="home_originals_loop" targetId={activeLore.id} />
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
