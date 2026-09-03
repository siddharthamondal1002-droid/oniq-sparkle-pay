/**
 * Threads — an ONIQ organisational layer over saved items.
 *
 * "What should I watch next in this thread?" is answered here, in order:
 * unfinished items first (earliest position in the thread), then unwatched
 * ones in thread order, then nothing — a finished thread says so rather than
 * looping. No copied content, no scrolling feed.
 */
import { isUnfinished, type WatchItem } from "@/lib/watch/types";

export type ThreadMember = { item: WatchItem; position: number };

export type NextInThread = { item: WatchItem; reason: string } | null;

export function nextInThread(members: ThreadMember[]): NextInThread {
  const ordered = [...members].sort((a, b) => a.position - b.position);
  const unfinished = ordered.find((m) => isUnfinished(m.item) && m.item.state !== "archived");
  if (unfinished) {
    return { item: unfinished.item, reason: "Unfinished — carry on where you stopped." };
  }
  const unwatched = ordered.find(
    (m) => !m.item.completed_at && !m.item.last_watched_at && m.item.state !== "archived",
  );
  if (unwatched)
    return { item: unwatched.item, reason: "Next in the thread you have not watched." };
  return null;
}

/** How far through a thread a person is: watched of total. */
export function threadProgress(members: ThreadMember[]): { done: number; total: number } {
  const active = members.filter((m) => m.item.state !== "archived");
  return { done: active.filter((m) => !!m.item.completed_at).length, total: active.length };
}
