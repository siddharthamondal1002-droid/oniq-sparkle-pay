/**
 * THE WORLDS DIRECTORY — one list, read by Home and by Explore.
 *
 * Owner mission, 2026-09-03: Home must not be "16 equal boring buttons";
 * worlds are grouped by what a person is doing. Every entry here is a real
 * route that exists today. Names never live here — tileName() owns them —
 * and visibility never lives here either: the same three gates apply
 * wherever this list is rendered (hidden tiles, the country registry, the
 * 18+ check), so a world unavailable to a person is simply not drawn.
 */
import type { TileKey } from "@/lib/i18n/tileLabel";
import type { WorldId } from "@/components/oniq/OniqCanvas";
import { HEALTH_WORLD, healthDoorsOpen } from "@/health/doors";

export type WorldEntry = {
  key: TileKey;
  to: string;
  world: WorldId;
  emoji: string;
  /** One line under the name on Explore. Plain, factual, no slang. */
  hint: string;
  search?: Record<string, string | boolean>;
  adultOnly?: boolean;
};

export type WorldGroup = {
  id: "connect" | "learn" | "live" | "discover" | "work";
  title: string;
  eyebrow: string;
  worlds: WorldEntry[];
};

export const WORLD_GROUPS: WorldGroup[] = [
  {
    id: "connect",
    title: "Connect",
    eyebrow: "people",
    worlds: [
      {
        key: "moments",
        to: "/app/chat/moments",
        world: "moments",
        emoji: "✨",
        hint: "Photos and thoughts from your worlds",
      },
      {
        key: "mast",
        to: "/app/chat/reels",
        world: "mast",
        emoji: "🎬",
        hint: "Short video from creators",
      },
      {
        key: "clips",
        to: "/app/clips",
        world: "clips",
        emoji: "📼",
        hint: "Post a clip of your own",
      },
    ],
  },
  {
    id: "learn",
    title: "Learn",
    eyebrow: "grow",
    worlds: [
      {
        key: "study",
        to: "/app/study",
        world: "study",
        emoji: "📚",
        hint: "Your board, your class, your papers",
      },
      {
        key: "university",
        to: "/app/university",
        world: "campus",
        emoji: "🎓",
        hint: "Admissions, deadlines and policy",
      },
      {
        key: "learn",
        to: "/app/learn",
        world: "scout",
        emoji: "🧠",
        hint: "Translate, learn and scout prices",
      },
    ],
  },
  {
    id: "live",
    title: "Live",
    eyebrow: "get around",
    worlds: [
      // UPI's Home tile was removed here — owner directive, 2026-09-06
      // (evening): "hide upi". It had been added that morning as "the door";
      // the door closes with everything else. `worlds.test.ts` bans it again,
      // which is the state it was in before, and `/app/upi` still resolves for
      // anyone holding a link.
      {
        key: "rides",
        to: "/app/rides",
        world: "rides",
        emoji: "🚗",
        hint: "Compare rides and book",
      },
      {
        key: "wander",
        to: "/app/travel",
        world: "wanderlust",
        emoji: "✈️",
        hint: "Buses, trains, flights and stays",
      },
      {
        key: "pulse",
        to: "/app/news",
        world: "pulse",
        emoji: "📰",
        hint: "Headlines, sourced and timed",
      },
      {
        key: "official",
        to: "/app/official",
        world: "official",
        emoji: "🏛️",
        hint: "Government sites, verified",
      },
      // ONIQ Health, owner brief 2026-09-08. One of the doors src/health/doors.ts
      // enumerates; it opens with HEALTH_FLAGS["health.enabled"] and with nothing
      // else, and healthDoors.test.ts fails if this spread stops reading the flag.
      ...(healthDoorsOpen() ? [HEALTH_WORLD] : []),
    ],
  },
  {
    id: "discover",
    title: "Discover",
    eyebrow: "explore",
    worlds: [
      {
        key: "ting",
        to: "/app/ai",
        world: "ting",
        emoji: "🔮",
        hint: "Ask anything, with live sources",
      },
      {
        key: "faith",
        to: "/app/faith",
        world: "blessed",
        emoji: "🙏",
        hint: "Read, listen and keep the dates",
      },
      {
        key: "vitals",
        to: "/app/vitals",
        world: "vitals",
        emoji: "🫀",
        hint: "Check in with yourself, privately",
      },
      {
        key: "miniapps",
        to: "/app/miniapps",
        world: "plug",
        emoji: "🔌",
        hint: "Everything inside ONIQ",
      },
      {
        key: "watch",
        to: "/app/watch",
        world: "watch",
        emoji: "📺",
        hint: "Channels in their own players",
      },
      {
        key: "lores",
        to: "/app/lores",
        world: "lores",
        emoji: "🎞️",
        hint: "ONIQ Originals and your stories",
      },
    ],
  },
  {
    id: "work",
    title: "Work",
    eyebrow: "earn",
    worlds: [
      { key: "earn", to: "/app/earn", world: "earn", emoji: "💸", hint: "Hire help or get hired" },
      {
        key: "jobs",
        to: "/app/jobs",
        world: "jobs",
        emoji: "💼",
        hint: "Your CV, your facts, and job apps",
        adultOnly: true,
      },
    ],
  },
];

export const ALL_WORLDS: WorldEntry[] = WORLD_GROUPS.flatMap((g) => g.worlds);

/**
 * Which groups lead at this hour. Real clock, nothing else: morning is
 * learning and getting around, evening is people and discovery. Same
 * groups, different order — nothing is hidden by the time of day.
 */
export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const ORDER: Record<DayPart, WorldGroup["id"][]> = {
  morning: ["learn", "live", "connect", "discover", "work"],
  afternoon: ["connect", "live", "work", "learn", "discover"],
  evening: ["connect", "discover", "live", "learn", "work"],
  night: ["discover", "connect", "learn", "live", "work"],
};

export function groupsFor(part: DayPart): WorldGroup[] {
  const rank = new Map(ORDER[part].map((id, i) => [id, i]));
  return [...WORLD_GROUPS].sort((a, b) => (rank.get(a.id) ?? 9) - (rank.get(b.id) ?? 9));
}

export const GREETING: Record<DayPart, { hello: string; line: string }> = {
  morning: { hello: "Good morning", line: "Let's make today count." },
  afternoon: { hello: "Good afternoon", line: "Keep the day moving." },
  evening: { hello: "Good evening", line: "Let's make today meaningful." },
  night: { hello: "Still up", line: "Something calm, or one more thing." },
};
