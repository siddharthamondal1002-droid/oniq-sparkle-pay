/**
 * THE SMART WATCH QUEUE — "I have 30 minutes."
 *
 * Owner mission, 2026-09-03. Fills a time budget from the user's own saved
 * items: unfinished ones first (by what is LEFT, not their full length), then
 * priority, then what was saved for a reason, then age. Items whose length is
 * unknown cannot be budgeted and are left out — the UI says so — rather than
 * guessed. Nothing is fetched and nothing is manufactured.
 */
import { daysBetween } from "@/lib/watch/format";
import { isUnfinished, remainingSeconds, type WatchItem } from "@/lib/watch/types";

export const QUEUE_BUDGETS_MINUTES = [10, 20, 30, 60, 90, 120] as const;
export type QueueBudget = (typeof QUEUE_BUDGETS_MINUTES)[number];

export type QueueEntry = {
  item: WatchItem;
  /** Seconds this entry takes: what is left of an unfinished item, or its length. */
  seconds: number;
  reason: string;
};

export type QueuePlan = {
  entries: QueueEntry[];
  totalSeconds: number;
  budgetSeconds: number;
  /** Saved items that could not be budgeted because their length is unknown. */
  unknownLength: number;
};

type Scored = { item: WatchItem; seconds: number; score: number; reason: string };

function scoreItem(item: WatchItem, now: Date): Scored | null {
  const seconds = remainingSeconds(item);
  if (seconds == null || seconds <= 0) return null;
  let score = 0;
  let reason = "Saved to watch";
  if (isUnfinished(item)) {
    score += 4;
    reason = "Unfinished — pick up where you left off";
  }
  if (item.priority > 0) {
    score += item.priority;
    if (!isUnfinished(item)) reason = "Marked high priority";
  }
  if (item.reason === "research" || item.reason === "learn") {
    score += 1;
    if (score < 4) reason = item.reason === "research" ? "Saved for research" : "Saved to learn";
  }
  const age = daysBetween(item.saved_at, now);
  if (age >= 14) {
    score += 1;
    if (score < 4 && item.priority === 0) reason = `Waiting ${age} days`;
  }
  if (item.state === "inbox") score += 0.5;
  return { item, seconds, score, reason };
}

/**
 * Greedy fill: best-scored items first, each taken if it still fits; a 10%
 * overrun is tolerated for the last entry so a 32-minute video is not refused
 * for a 30-minute budget. Deterministic for a given input.
 */
export function buildQueue(items: WatchItem[], budgetMinutes: number, now: Date): QueuePlan {
  const budgetSeconds = Math.max(60, Math.round(budgetMinutes * 60));
  const slack = Math.round(budgetSeconds * 0.1);
  let unknownLength = 0;
  const scored: Scored[] = [];
  for (const item of items) {
    if (item.state === "archived" || item.completed_at) continue;
    const s = scoreItem(item, now);
    if (!s) {
      if (!item.duration_seconds) unknownLength += 1;
      continue;
    }
    scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score || a.seconds - b.seconds);

  const entries: QueueEntry[] = [];
  let total = 0;
  for (const s of scored) {
    if (total + s.seconds <= budgetSeconds + slack) {
      entries.push({ item: s.item, seconds: s.seconds, reason: s.reason });
      total += s.seconds;
    }
    if (total >= budgetSeconds) break;
  }
  return { entries, totalSeconds: total, budgetSeconds, unknownLength };
}
