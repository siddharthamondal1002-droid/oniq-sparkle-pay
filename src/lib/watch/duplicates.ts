/**
 * DUPLICATES AND WATCHLIST HEALTH.
 *
 * Owner mission, 2026-09-03. The same video reached through two providers
 * should read as one thing — "Available from 2 sources" — but a similar title
 * is not the same video. So the matcher is conservative: it groups only when
 * the normalised titles are identical AND either the creators agree or the
 * lengths agree within two percent. Same-provider duplicates cannot exist at
 * all: the database refuses a second row for the same (user, provider, id).
 * Every grouping is a suggestion the user confirms, and can undo.
 */
import { daysBetween } from "@/lib/watch/format";
import { isUnfinished, type WatchItem } from "@/lib/watch/types";

export type DuplicateGroup = {
  /** Stable key: the sorted item ids joined, so the same group keys the same way each time. */
  key: string;
  items: WatchItem[];
  confidence: "high";
  reason: string;
};

const NOISE =
  /\b(official|hd|4k|full|video|trailer|remastered|hq|lyrics?|audio|ft\.?|feat\.?)\b|\(.*?\)|\[.*?\]/g;

/** Lower-case, strip decorations and punctuation, collapse spaces. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(NOISE, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCreator(creator: string | null): string {
  return (creator ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function durationsAgree(a: number | null, b: number | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(a, b) <= 0.02;
}

/** Likely duplicates across providers, high confidence only. */
export function findDuplicateGroups(items: WatchItem[]): DuplicateGroup[] {
  const byTitle = new Map<string, WatchItem[]>();
  for (const item of items) {
    if (item.state === "archived") continue;
    const key = normalizeTitle(item.title);
    if (key.length < 4) continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), item]);
  }
  const groups: DuplicateGroup[] = [];
  for (const candidates of byTitle.values()) {
    if (candidates.length < 2) continue;
    // Pairwise agreement, then union the agreeing pairs.
    const agreed = new Set<string>();
    let why = "";
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        if (a.provider === b.provider) continue; // the database already forbids same-provider twins
        const ca = normalizeCreator(a.creator);
        const cb = normalizeCreator(b.creator);
        if (ca && cb && ca === cb) {
          agreed.add(a.id).add(b.id);
          why = why || "same title and creator on two providers";
        } else if (durationsAgree(a.duration_seconds, b.duration_seconds)) {
          agreed.add(a.id).add(b.id);
          why = why || "same title and length on two providers";
        }
      }
    }
    if (agreed.size >= 2) {
      const members = candidates.filter((c) => agreed.has(c.id));
      groups.push({
        key: members
          .map((m) => m.id)
          .sort()
          .join("+"),
        items: members,
        confidence: "high",
        reason: why,
      });
    }
  }
  return groups;
}

export type WatchlistHealth = {
  active: number;
  unfinished: number;
  stale: number;
  duplicates: number;
  highPriority: number;
  recentlyAdded: number;
  staleItems: WatchItem[];
};

/** Not watched and untouched for this long counts as stale. */
export const STALE_AFTER_DAYS = 30;

export function watchlistHealth(items: WatchItem[], now: Date): WatchlistHealth {
  const active = items.filter((i) => i.state !== "archived" && !i.completed_at);
  const staleItems = active.filter(
    (i) => !i.last_watched_at && daysBetween(i.saved_at, now) >= STALE_AFTER_DAYS,
  );
  return {
    active: active.length,
    unfinished: active.filter(isUnfinished).length,
    stale: staleItems.length,
    duplicates: findDuplicateGroups(items).reduce((n, g) => n + g.items.length - 1, 0),
    highPriority: active.filter((i) => i.priority >= 2).length,
    recentlyAdded: active.filter((i) => daysBetween(i.saved_at, now) <= 7).length,
    staleItems,
  };
}
