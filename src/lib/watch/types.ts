/**
 * The Watch library's item shape — the `watch_items` row as the app reads it.
 * Kept separate from the generated Database types so the pure modules
 * (resurface, queue, duplicates) can be tested with plain objects.
 */
import type { WatchProviderId } from "@/lib/watch/providers";

export type WatchState = "inbox" | "library" | "archived";

export type SaveReason =
  "watch_later" | "research" | "learn" | "inspiration" | "reference" | "share" | "oniq";

export const SAVE_REASONS: { key: SaveReason; label: string }[] = [
  { key: "watch_later", label: "Watch later" },
  { key: "research", label: "Research" },
  { key: "learn", label: "Learn" },
  { key: "inspiration", label: "Inspiration" },
  { key: "reference", label: "Reference" },
  { key: "share", label: "Share" },
  { key: "oniq", label: "ONIQ" },
];

export type WatchItem = {
  id: string;
  user_id: string;
  provider: WatchProviderId;
  content_id: string;
  canonical_url: string;
  title: string;
  creator: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  state: WatchState;
  reason: SaveReason | null;
  priority: number;
  position_seconds: number;
  completed_at: string | null;
  last_watched_at: string | null;
  notes: string | null;
  tags: string[];
  topics: string[];
  rights: unknown;
  metadata: Record<string, unknown>;
  duplicate_group_id: string | null;
  resurface_dismissed_at: string | null;
  resurface_dismissals: number;
  saved_at: string;
  created_at: string;
  updated_at: string;
};

export type WatchCollection = {
  id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type WatchThread = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type WatchMoment = {
  id: string;
  user_id: string;
  item_id: string;
  at_seconds: number;
  note: string | null;
  collection_id: string | null;
  created_at: string;
};

/** Started, not finished. */
export function isUnfinished(item: Pick<WatchItem, "position_seconds" | "completed_at">): boolean {
  return item.position_seconds > 0 && !item.completed_at;
}

/** Seconds left, when the length is known. */
export function remainingSeconds(
  item: Pick<WatchItem, "position_seconds" | "duration_seconds" | "completed_at">,
): number | null {
  if (!item.duration_seconds) return null;
  if (item.completed_at) return 0;
  return Math.max(0, item.duration_seconds - item.position_seconds);
}
