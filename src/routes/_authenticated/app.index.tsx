import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OniqAIOrb,
  OniqAskBar,
  OniqCanvas,
  OniqProgressBar,
  OniqSectionHeader,
  OniqSkeleton,
  OniqIconBadge,
  OniqStoryRail,
  OniqWorldCard,
  type Tint,
  type WorldId,
} from "@/components/oniq";
import { GREETING, dayPartOf, groupsFor, type WorldEntry } from "@/data/worlds";
import type { CountryCode } from "@/lib/miniapps";
import { useContinue } from "@/lib/watch/hooks";
import { formatClock, formatMinutes } from "@/lib/watch/format";
import { providerName } from "@/lib/watch/providers";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Bell,
  MessageCircle,
  Sparkles,
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
import { RegionBanner } from "@/components/home/RegionBanner";
import { HomeCountryPrompt } from "@/components/home/HomeCountryPrompt";
import { useT } from "@/lib/i18n/LanguageProvider";
import { tileName, tileNamePlain, type TileKey } from "@/lib/i18n/tileLabel";
import { WORLD_ICON } from "@/data/worldIcons";
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

export const Route = createFileRoute("/_authenticated/app/")({
  component: HomeScreen,
});

/** Two rows of five, as the reference draws them. The rest live on Explore. */
const HOME_WORLD_COUNT = 10;

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
  const { t, lang } = useT();
  const [home] = useCountry();
  const isAdult = useIsAdult18();
  const userId = useSession();
  // The hour decides the greeting and the order of the worlds. Real clock,
  // read once per visit; nothing is hidden by it (src/data/worlds.ts).
  const dayPart = useMemo(() => dayPartOf(new Date().getHours()), []);
  const groups = useMemo(() => groupsFor(dayPart), [dayPart]);
  const pulse = useHomePulse(userId, home, hidden);
  // Same hook, same cache key as the chips below — see useUnreadChats.
  const unread = useUnreadChats(userId, !hidden.has("moments")).data ?? 0;

  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";
  const greeting = GREETING[dayPart];
  // The same three gates as everywhere a world is drawn: hidden by the person,
  // unsupported in the Home country, or 18+ for a minor => not rendered at all.
  const showWorld = (w: WorldEntry) =>
    !(hidden as Set<string>).has(w.key) && isAvailable(w.key, home) && (!w.adultOnly || isAdult);
  const worlds = groups.flatMap((g) => g.worlds).filter(showWorld);

  return (
    <MediaProvider>
      <OniqCanvas world="home" className="relative pb-6">
        {/* Wallpaper is rendered by the app shell (_authenticated/app.tsx) so it
            persists across every /app/* tab; the canvas wash sits over it. */}
        <div className="relative z-10">
          <h1 className="sr-only">Your ONIQ dashboard</h1>

          {/* ---- BRAND ROW + GREETING + ASK (the reference, top to bottom) --- */}
          <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
            <div className="flex items-center justify-between gap-3 rise">
              <span className="font-display text-[26px] leading-none tracking-tight text-gradient-world">
                ONIQ
              </span>
              <div className="flex items-center gap-2">
                {/*
                  THE BELL, WITH A REAL COUNT. The reference draws a badge on
                  it; the number is the person's actual unread chats, from the
                  same hook the chip below reads, and the badge is ABSENT at
                  zero rather than showing a 0. A dot that is always there
                  stops meaning anything.
                */}
                <Link
                  to="/app/chat"
                  data-testid="home-bell"
                  aria-label={unread > 0 ? `Chats, ${unread} unread` : "Chats"}
                  className="press relative grid h-10 w-10 shrink-0 place-items-center rounded-full oniq-surface text-foreground"
                >
                  <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
                  {unread > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -end-0.5 -top-0.5 grid min-w-[19px] place-items-center rounded-full bg-destructive px-1 text-[11px] font-bold leading-[19px] text-white ring-2 ring-background"
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to="/app/profile"
                  aria-label="Open profile"
                  className="press grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-world font-bold text-white world-glow"
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
            </div>

            <div className="mt-5 rise rise-1">
              <div className="text-sm text-foreground/80">
                {t(`home.daypart.${dayPart}`, greeting.hello)},
              </div>
              {profileLoading ? (
                <OniqSkeleton className="mt-2 h-9 w-48" />
              ) : (
                <p className="mt-0.5 font-display text-[30px] normal-case leading-[1.05] tracking-tight text-foreground">
                  {first} 👋
                </p>
              )}
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`home.dayline.${dayPart}`, greeting.line)}
              </p>
            </div>

            <div className="mt-4 rise rise-1">
              <OniqAskBar testId="home-ask" />
            </div>

            {installPrompt.canInstall && (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl oniq-surface px-3 py-2 rise rise-1">
                <span className="text-xs">📲 install ONIQ on your home screen</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={installPrompt.prompt}
                    className="press rounded-full bg-world px-3 py-1 text-xs font-semibold text-white"
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

            {/* ---- THE PULSE: only what is true right now ---------------- */}
            {/*
              THE STAT CHIPS. The reference draws three compact pills under the
              ask bar — a coloured mark, a bold value, a small label under it.
              This is that shape, filled with what ONIQ ACTUALLY KNOWS.

              The reference's own three were weather, messages and a ride ETA.
              Messages is real and is here. Weather is NOT: ONIQ has no
              weather source wired (the Google one needs service-account
              OAuth2, which is an owner decision that has not been made), and a
              temperature is exactly the kind of number that looks harmless
              invented and is a lie on someone's screen. A ride ETA is the same
              — it needs a live quote for a route nobody has entered. So the
              row shows the facts that exist and is simply shorter when there
              are fewer of them, rather than being padded to three.
            */}
            {pulse.length > 0 && (
              <OniqStoryRail className="mt-4 rise rise-2" ariaLabel="Right now">
                {pulse.map((p) => (
                  <Link
                    key={p.id}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    to={p.to as any}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    search={p.search as any}
                    data-world={p.world}
                    data-testid={`home-pulse-${p.id}`}
                    className="press flex shrink-0 items-center gap-2 rounded-full oniq-surface py-1.5 pe-3.5 ps-1.5"
                  >
                    <OniqIconBadge tint={p.tint} size="sm">
                      <p.Icon />
                    </OniqIconBadge>
                    <span className="min-w-0">
                      {/* The VALUE reads first and the label second — the
                          reference's hierarchy, and the reason a chip can be
                          understood without being read word by word. */}
                      <span className="block max-w-[9rem] truncate font-display text-[13px] normal-case leading-tight tracking-normal text-foreground">
                        {p.title}
                      </span>
                      <span className="block max-w-[9rem] truncate text-[11px] leading-tight text-muted-foreground">
                        {p.sub}
                      </span>
                    </span>
                  </Link>
                ))}
              </OniqStoryRail>
            )}
          </div>

          {/* ---- CONTINUE WATCHING: the real unfinished item, or nothing --- */}
          {pulse.some((p) => p.id === "continue") && (
            <section className="mt-7 rise rise-2">
              <OniqSectionHeader
                title="Continue watching"
                action={{
                  label: "View all",
                  to: "/app/watch/library",
                  testId: "home-continue-library",
                }}
              />
              <div className="mt-3 px-5">
                <ContinueWatchingCard userId={userId} home={home} />
              </div>
            </section>
          )}

          {/* ---- FOR YOU TODAY: the feed faces, one at a time ---------------- */}
          <section className="mt-7 rise rise-3">
            <div className="flex items-end justify-between gap-3 px-5">
              <h2 className="font-display text-[15px] leading-tight text-foreground">
                For you today
              </h2>
              <CustomizeButton />
            </div>
            <div className="mt-3 px-5">
              <HomeMediaBanner />
            </div>
          </section>

          <div className="px-5">
            <RegionBanner />
            <div className="mt-3">
              <HomeCountryPrompt />
            </div>
          </div>

          {/* ---- YOUR WORLDS: every world you can use, ordered by the hour ---- */}
          {worlds.length > 0 && (
            <section className="mt-7 rise rise-4">
              <OniqSectionHeader
                title="Your worlds"
                action={{ label: "See all", to: "/app/explore", testId: "home-explore" }}
              />
              {/*
                TEN TILES, TWO ROWS — the reference draws exactly this and puts
                the rest behind "See all". Home's job is the person's own
                content; the full directory is Explore's, and it already
                renders every world grouped and searchable. Four rows of tiles
                here pushed everything below them off the screen.
              */}
              <div className="mt-2 grid grid-cols-5 gap-x-1 gap-y-3 px-3">
                {worlds.slice(0, HOME_WORLD_COUNT).map((w) => {
                  const art = WORLD_ICON[w.key];
                  return (
                    <OniqWorldCard
                      key={w.key}
                      world={w.world}
                      emoji={w.emoji}
                      // The drawn glyph AND its hue — colour is how the
                      // reference lets you find a world before reading it.
                      // The emoji only backs the glyph up. And the PLAIN
                      // name: the label's own trailing emoji would otherwise
                      // be a second copy of the glyph in the badge, which is
                      // what used to wrap onto its own line.
                      icon={art ? <art.Icon /> : undefined}
                      tint={art?.tint}
                      label={tileNamePlain(lang, w.key, home)}
                      to={w.to}
                      search={w.search}
                      skin={skins[w.key] ?? null}
                      dot={w.key === "vitals" ? vitalsColor : null}
                      onClick={() => void recordSignal("hub_open", w.key)}
                      testId={`home-world-${w.key}`}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- ONIQ AI ------------------------------------------------- */}
          <section className="mt-7 px-5 rise rise-5">
            <Link
              to="/app/ai"
              data-world="ting"
              data-testid="home-oniq-ai"
              className="press flex items-center gap-4 rounded-3xl bg-world-soft border border-world p-4"
              onClick={() => void recordSignal("hub_open", "ting")}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[16px] leading-tight text-world">
                  ONIQ AI
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Your personal super intelligence
                </span>
              </span>
              <OniqAIOrb size="lg" className="shrink-0" />
            </Link>
          </section>

          {/*
            FIVE EXPERIENCES USED TO SIT HERE, and it was the last thing on the
            page — which is how it ended up underneath the bottom bar.

            Removing it is not just a layout fix. Home carried TWO navigations:
            "Your worlds" (18 tiles) and "Five experiences" (the same worlds,
            grouped five ways). A person who wants a world has two places to
            look and no reason to prefer either, and the grouped one is a worse
            version of Explore — which already renders these exact groups from
            WORLD_GROUPS, with a chip row and search over them. So the concept
            moves to where it was already implemented, and Home spends its last
            screenful on the person's own content instead of a second menu.
          */}
        </div>
      </OniqCanvas>
    </MediaProvider>
  );
}

type PulseItem = {
  id: "continue" | "unread" | "study";
  world: WorldId;
  /** A drawn glyph and its hue, the same treatment the world tiles use. */
  Icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
  title: string;
  sub: string;
  to: string;
  search?: Record<string, string | boolean>;
};

/**
 * UNREAD CHATS, counted once.
 *
 * The header bell and the stat chips both want this number. Two copies of the
 * query would be two cache keys, two fetches and — the part that actually
 * shows — two answers that can disagree by a few seconds, so the bell says 3
 * while the chip beside it says 2. One hook, one key.
 */
function useUnreadChats(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["home-unread", userId],
    enabled: !!userId && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_chat_list");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).reduce((n, r) => n + (Number(r.unread) || 0), 0) as number;
    },
  });
}

/**
 * THE PULSE — what is true for this person right now, from data ONIQ
 * already holds. A chip exists only when its fact does: an unfinished
 * video (Watch library, India), unread chats, a learner profile. No
 * weather, no ride status, no fabricated values. Everything here is a
 * hook, and every hook runs on every render.
 */
function useHomePulse(userId: string | null, home: CountryCode, hidden: Set<TileKey>): PulseItem[] {
  const watchOk = isAvailable("watch", home) && !hidden.has("watch");
  const cont = useContinue(watchOk ? userId : null);
  const study = useStudyHeroData(isAvailable("study", home) && !hidden.has("study"));
  const unread = useUnreadChats(userId, !hidden.has("moments"));
  const items: PulseItem[] = [];
  const next = cont.data?.[0];
  if (next) {
    items.push({
      id: "continue",
      world: "watch",
      Icon: Play,
      tint: "teal",
      title: next.title,
      sub: next.duration_seconds
        ? `${formatMinutes(Math.max(0, next.duration_seconds - next.position_seconds))} left`
        : "Continue watching",
      to: "/app/watch/library",
      search: { surface: "continue" },
    });
  }
  if ((unread.data ?? 0) > 0) {
    const n = unread.data as number;
    items.push({
      id: "unread",
      world: "chat",
      Icon: MessageCircle,
      tint: "blue",
      title: `${n} unread`,
      sub: n === 1 ? "one chat is waiting" : "chats are waiting",
      to: "/app/chat",
    });
  }
  const active = study.active;
  if (active) {
    items.push({
      id: "study",
      world: "study",
      Icon: BookOpen,
      tint: "indigo",
      title: study.recent?.subject ?? active.name,
      sub: study.recent
        ? "pick up where you stopped"
        : `${active.board.toUpperCase()} · ${classLabel(active.class_level)}`,
      to: "/app/study",
    });
  }
  return items;
}

/** The first unfinished item from the Watch library, as a card with its progress. */
function ContinueWatchingCard({ userId, home }: { userId: string | null; home: CountryCode }) {
  const ok = isAvailable("watch", home);
  const cont = useContinue(ok ? userId : null);
  const item = cont.data?.[0];
  if (!item) return null;
  const done = item.duration_seconds ? item.position_seconds / item.duration_seconds : 0;
  return (
    <Link
      to="/app/watch/library"
      search={{ surface: "continue" }}
      data-world="watch"
      data-testid="home-continue-card"
      className="press block rounded-3xl oniq-surface p-4"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-world text-xl text-white world-glow"
          aria-hidden="true"
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] text-foreground">
            {item.title}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {item.creator ? `${item.creator} · ` : ""}
            {providerName(item.provider)}
          </span>
        </span>
      </div>
      <div className="mt-3">
        <OniqProgressBar value={done} label="Progress" />
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{formatClock(item.position_seconds)}</span>
          <span>{item.duration_seconds ? formatClock(item.duration_seconds) : "—"}</span>
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

/**
 * The Study hero's data, shared with the pulse chip: one query key, one
 * network call, two readers.
 */
function useStudyHeroData(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ["study-hero"],
    enabled,
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
  const active =
    (recent && profiles.find((p) => p.id === recent.profile_id)) || profiles[0] || null;
  return { profiles, recent, active, isLoading };
}

function StudyHero() {
  const { profiles, recent, active: activeProfile, isLoading } = useStudyHeroData();

  const hasProfile = profiles.length > 0;
  const hasRecent = !!recent && !!activeProfile;

  return (
    <Link
      to="/app/study"
      onClick={() => void recordSignal("hub_open", "study")}
      className="press fade-up relative block overflow-hidden rounded-3xl border border-border p-5"
      style={{
        background:
          "radial-gradient(120% 90% at 0% 0%, #FB718540 0%, #FB718510 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #FB923C33 0%, #FB923C0d 45%, transparent 75%), var(--card)",
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
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
      <p className="rounded-2xl border border-dashed border-border oniq-surface px-4 py-3 text-xs text-muted-foreground">
        all feed tiles are hidden — bring them back anytime from Customize 🎨
      </p>
    );
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Home feed"
        className="no-scrollbar mb-3 inline-flex max-w-full overflow-x-auto rounded-full oniq-surface p-1 text-[11px] font-semibold uppercase tracking-wider"
      >
        {visibleTabs.map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setMode(t.id)}
              className={`press whitespace-nowrap rounded-full px-3 py-1.5 transition-colors ${active ? "bg-world text-white" : "text-muted-foreground hover:text-foreground"}`}
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
          "radial-gradient(120% 90% at 0% 0%, #A78BFA40 0%, #A78BFA10 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #F472B633 0%, #F472B60d 45%, transparent 75%), var(--card)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          moments ✨
        </div>
        <Link
          to="/app/chat/moments"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
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

  // NO LIBRARY ROW HERE. One was added on 2026-09-03 ("watch new addition
  // not on Home page") and removed the same evening on the owner's word:
  // "remove those new buttons from home page watch its looking ugly". The
  // library's front door is the Watch screen's header link
  // (src/routes/_authenticated/app.watch.tsx); Home stays the loop and its
  // genres, nothing more.

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
          "radial-gradient(120% 90% at 0% 0%, #00D4B840 0%, #00D4B810 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #00A8E833 0%, #00A8E80d 45%, transparent 75%), var(--card)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-foreground">
          <Tv className="h-3 w-3" /> watch 📺
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: "/app/watch" })}
          className="press inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Open all <ChevronRight className="h-3 w-3" />
        </button>
      </div>

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
          "radial-gradient(120% 90% at 0% 0%, #F59E0B40 0%, #F59E0B10 40%, transparent 70%), radial-gradient(120% 90% at 100% 100%, #EC489933 0%, #EC48990d 45%, transparent 75%), var(--card)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider">
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
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
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
                <span className="absolute start-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300 backdrop-blur">
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
