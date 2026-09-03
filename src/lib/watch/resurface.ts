/**
 * THE RESURFACE ENGINE — explainable, first production version.
 *
 * Owner mission, 2026-09-03: surface intelligently forgotten content, with a
 * reason on every card, and never as an engagement feed. So the ranking is a
 * short list of additive signals a person can read, the reason is the
 * strongest signal in words, dismissals push an item down and then out, and
 * the output is capped. There is no learning loop and no randomness.
 */
import { daysBetween } from "@/lib/watch/format";
import { isUnfinished, type WatchItem } from "@/lib/watch/types";

export type ResurfaceCandidate = {
  item: WatchItem;
  score: number;
  reason: string;
};

export type ResurfaceContext = {
  now: Date;
  /** Names of threads each item belongs to, by item id — for the thread reason. */
  threadNames?: Record<string, string[]>;
  limit?: number;
};

/** Days after "Not interested" during which an item stays out of Resurface. */
export const DISMISS_QUIET_DAYS = 7;
/** Saved at least this long ago without being watched counts as forgotten. */
export const FORGOTTEN_AFTER_DAYS = 14;

const REASON_WORD: Record<string, string> = {
  research: "research",
  learn: "learning",
  inspiration: "inspiration",
  reference: "reference",
  share: "sharing",
  oniq: "ONIQ",
  watch_later: "later",
};

export function rankResurface(items: WatchItem[], ctx: ResurfaceContext): ResurfaceCandidate[] {
  const { now } = ctx;
  const out: ResurfaceCandidate[] = [];
  for (const item of items) {
    if (item.state === "archived" || item.completed_at) continue;
    if (
      item.resurface_dismissed_at &&
      daysBetween(item.resurface_dismissed_at, now) < DISMISS_QUIET_DAYS
    ) {
      continue;
    }
    const savedDays = daysBetween(item.saved_at, now);
    const unfinished = isUnfinished(item);
    const threads = ctx.threadNames?.[item.id] ?? [];
    const signals: { score: number; reason: string }[] = [];

    if (unfinished) {
      signals.push({ score: 3, reason: "You started this but never finished it." });
    }
    if (!item.last_watched_at && savedDays >= FORGOTTEN_AFTER_DAYS) {
      signals.push({
        score: 2,
        reason: `You saved this ${savedDays} days ago. Still interested?`,
      });
    }
    if (item.reason && item.reason !== "watch_later" && savedDays >= 3) {
      signals.push({
        score: 1.5,
        reason: `Because you saved this for ${REASON_WORD[item.reason] ?? item.reason} ${savedDays} days ago.`,
      });
    }
    if (threads.length > 0) {
      signals.push({
        score: 1,
        reason: `Part of your ${unfinished ? "unfinished " : ""}"${threads[0]}" thread.`,
      });
    }
    if (item.priority > 0) {
      signals.push({ score: item.priority * 0.75, reason: "You marked this high priority." });
    }
    if (signals.length === 0) continue;

    const score = signals.reduce((s, x) => s + x.score, 0) - item.resurface_dismissals * 2;
    if (score <= 0) continue;
    const strongest = [...signals].sort((a, b) => b.score - a.score)[0];
    out.push({ item, score, reason: strongest.reason });
  }
  out.sort((a, b) => b.score - a.score || a.item.saved_at.localeCompare(b.item.saved_at));
  return out.slice(0, ctx.limit ?? 12);
}

/** "You have 6 saved videos about character motion." — grouped by topic, when there is a group. */
export function topicClusters(items: WatchItem[], min = 3): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.state === "archived") continue;
    for (const t of item.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}
