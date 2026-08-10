import { useEffect, useRef, useState } from "react";
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
                  // India-only by the feature registry — the row's isAvailable
                  // filter is what keeps the NPCI rail off every other Home.
                  { key: "upi", to: "/app/upi" },
                  { key: "official", to: "/app/official" },
                  { key: "pulse", to: "/app/news" },
                  { key: "faith", to: "/app/faith" },
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

type BannerMode = "study" | "moments" | "mast";
const BANNER_MODE_KEY = "oniq.home.banner.mode";

const BANNER_MODES: BannerMode[] = ["study", "moments", "mast"];

function HomeMediaBanner() {
  const [hidden] = useHiddenTiles();
  const { data: theme } = useUserTheme();
  const skins = theme?.tile_skins ?? {};
  const { lang } = useT();

  const [mode, setMode] = useState<BannerMode>(() => {
    if (typeof window === "undefined") return "study";
    try {
      const v = localStorage.getItem(BANNER_MODE_KEY);
      if (v === "study" || v === "moments" || v === "mast") return v;
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

  // If the current tab is hidden (persisted or just toggled), fall back to
  // the first tab that's still visible.
  useEffect(() => {
    if (hidden.has(mode)) {
      const first = BANNER_MODES.find((m) => !hidden.has(m));
      if (first) setMode(first);
    }
  }, [mode, hidden]);

  const tabs: { id: BannerMode; label: string }[] = [
    { id: "study", label: tileName(lang, "study", home) },
    { id: "moments", label: tileName(lang, "moments", home) },
    { id: "mast", label: tileName(lang, "mast", home) },
  ];
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

function MastPreview() {
  const navigate = useNavigate();
  const media = useMediaCoordinator();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [pickNonce, setPickNonce] = useState(0);
  const [muted, setMuted] = useState(true);

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
  const active = clips[idx];

  // Auto-advance every 30s; resets whenever idx or pickNonce changes so a
  // manual tap gets a fresh 30s countdown rather than a stale timer firing.
  useEffect(() => {
    if (clips.length <= 1) return;
    const t = setTimeout(() => {
      setIdx((i) => (i + 1) % clips.length);
    }, 30_000);
    return () => clearTimeout(t);
  }, [idx, pickNonce, clips.length]);

  // Register the current video with the single-audio-source coordinator so
  // Only one media surface plays audio at a time.
  useEffect(() => {
    if (videoRef.current) media.register(videoRef.current);
  }, [idx, media]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, idx]);

  const openReels = () => navigate({ to: "/app/chat/reels" });

  return (
    <div
      onClick={openReels}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openReels();
      }}
      className="press fade-up relative block cursor-pointer overflow-hidden rounded-3xl border border-border p-4"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #F59E0B40 0%, #F59E0B10 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #EC489933 0%, #EC48990d 45%, transparent 75%), hsl(var(--card))",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          <Film className="h-3 w-3" /> mast 🎬
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
          Open all <ChevronRight className="h-3 w-3" />
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 aspect-video animate-pulse rounded-xl bg-surface" />
      ) : clips.length === 0 || !active ? (
        <div className="mt-4">
          <div className="font-display text-xl font-bold text-foreground">no clips yet</div>
          <div className="mt-1 text-xs text-muted-foreground">be the first to post 🎬</div>
        </div>
      ) : (
        <>
          <div
            className="mt-3 relative mx-auto aspect-[9/16] w-full max-w-[240px] overflow-hidden rounded-xl bg-black border border-border/60 touch-pan-y"
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
              setIdx((i) =>
                forward ? (i + 1) % clips.length : (i - 1 + clips.length) % clips.length,
              );
              setPickNonce((n) => n + 1);
            }}
          >
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
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3 w-3" />
                {active.like_count}
              </span>
              <Play className="h-3.5 w-3.5 opacity-90" />
            </div>
            {clips.length > 1 && (
              <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1.5">
                {clips.map((c, i) => (
                  <button
                    key={c.id}
                    aria-label={`clip ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIdx(i);
                      setPickNonce((n) => n + 1);
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      i === idx ? "w-4 bg-white" : "w-1.5 bg-white/40"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          {active.caption && (
            <div className="mt-3 text-xs text-foreground line-clamp-1">{active.caption}</div>
          )}
        </>
      )}
    </div>
  );
}
