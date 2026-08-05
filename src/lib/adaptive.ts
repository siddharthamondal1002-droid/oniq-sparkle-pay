import { TILE_LABELS, type TileKey } from "@/lib/i18n/tileLabel";
/**
 * Loop 2 — the rules engine behind anticipatory home cards.
 *
 * Deliberately deterministic and offline: no model, no server call, no
 * cross-user data. It reads only the signed-in user's own `usage_signals`
 * rows (Loop 1) and returns at most ONE suggestion, always with a plain
 * sentence explaining exactly why it fired. If it cannot explain itself, it
 * does not fire.
 *
 * Hard limits, by design:
 *  - at most one card on screen, ever
 *  - a hub must have been opened at least MIN_HITS times in the same
 *    weekday/weekend + hour band before it is suggested
 *  - dismissing puts that hub to sleep for DISMISS_COOLDOWN_DAYS
 *  - two dismisses of the same hub retires it permanently
 *  - the card never performs an action; it is a shortcut the user must tap
 */

export type Signal = {
  id: string;
  kind: "hub_open" | "card_tap" | "card_dismiss";
  hub: string;
  city: string | null;
  dow: number;
  hour: number;
  created_at: string;
};

export type Suggestion = {
  hub: string;
  /** Key into the shared tile-label table, for localised display. */
  tile?: TileKey;
  label: string;
  to: string;
  search?: Record<string, unknown>;
  /** Shown verbatim on the card. Never omitted. */
  reason: string;
};

/** Every hub the card is allowed to point at. Nothing money-, health- or call-related. */
// `tile` names the entry in the shared label table (src/lib/i18n/tileLabel.ts)
// so the card can localise; `label` is the English fallback used in pure
// (non-React) contexts such as the reason string and memory writes.
export const SUGGESTABLE: Record<
  string,
  { tile?: TileKey; label: string; to: string; search?: Record<string, unknown> }
> = {
  study: { tile: "study", label: TILE_LABELS.study, to: "/app/study" },
  ting: { tile: "ting", label: TILE_LABELS.ting, to: "/app/ai" },
  learn: { tile: "learn", label: TILE_LABELS.learn, to: "/app/learn" },
  rides: { tile: "rides", label: TILE_LABELS.rides, to: "/app/rides" },
  faith: { tile: "faith", label: TILE_LABELS.faith, to: "/app/faith" },
  pulse: { tile: "pulse", label: TILE_LABELS.pulse, to: "/app/news" },
  miniapps: { tile: "miniapps", label: TILE_LABELS.miniapps, to: "/app/miniapps" },
  official: { tile: "official", label: TILE_LABELS.official, to: "/app/official" },
  wander: { tile: "wander", label: TILE_LABELS.wander, to: "/app/travel" },
  earn: { tile: "earn", label: TILE_LABELS.earn, to: "/app/earn" },
  clips: { tile: "clips", label: TILE_LABELS.clips, to: "/app/chat/reels" },
  moments: { tile: "moments", label: TILE_LABELS.moments, to: "/app/chat/moments" },
};

export const MIN_HITS = 3;
export const DISMISS_COOLDOWN_DAYS = 14;
export const MAX_DISMISSES = 2;
const HOUR_WINDOW = 1;

const isWeekend = (dow: number) => dow === 0 || dow === 6;

export function bandLabel(hour: number): string {
  if (hour < 5) return "late at night";
  if (hour < 12) return "in the morning";
  if (hour < 17) return "in the afternoon";
  if (hour < 21) return "in the evening";
  return "at night";
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

/**
 * Pure: same signals + same clock ⇒ same answer. Returns null far more often
 * than it returns a card, which is the intended behaviour — silence is the
 * default and a suggestion has to earn its place.
 */
export function pickSuggestion(signals: Signal[], now: Date = new Date()): Suggestion | null {
  const dow = now.getDay();
  const hour = now.getHours();

  const dismissals = new Map<string, string[]>();
  for (const s of signals) {
    if (s.kind !== "card_dismiss") continue;
    dismissals.set(s.hub, [...(dismissals.get(s.hub) ?? []), s.created_at]);
  }

  const counts = new Map<string, number>();
  for (const s of signals) {
    if (s.kind !== "hub_open") continue;
    if (!SUGGESTABLE[s.hub]) continue;
    if (isWeekend(s.dow) !== isWeekend(dow)) continue;
    const diff = Math.abs(s.hour - hour);
    if (Math.min(diff, 24 - diff) > HOUR_WINDOW) continue;
    counts.set(s.hub, (counts.get(s.hub) ?? 0) + 1);
  }

  const eligible = [...counts.entries()]
    .filter(([hub, n]) => {
      if (n < MIN_HITS) return false;
      const d = dismissals.get(hub) ?? [];
      if (d.length >= MAX_DISMISSES) return false;
      return !d.some((at) => daysSince(at, now) < DISMISS_COOLDOWN_DAYS);
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const top = eligible[0];
  if (!top) return null;

  const [hub, n] = top;
  const meta = SUGGESTABLE[hub]!;
  const when = isWeekend(dow) ? "on weekends" : "on weekdays";
  return {
    hub,
    tile: meta.tile,
    label: meta.label,
    to: meta.to,
    search: meta.search,
    reason: `You've opened ${meta.label} ${n} times around this hour ${when}, ${bandLabel(hour)}.`,
  };
}
