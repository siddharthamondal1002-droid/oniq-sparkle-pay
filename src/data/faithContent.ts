// Faith content guards — Blessed must NEVER serve one faith's devotional
// content under another faith's label. Content lookup keys strictly on the
// faith id; a miss renders that faith's empty state, never a fallback to
// another faith, an index, or "whatever is playing".

export type FaithId = "islamic" | "sikh" | "hindu" | "christian" | "buddhist" | "jain" | "jewish";

/**
 * The ONLY filter the Watch/Radio sections may use. Strict equality on the
 * item's own faith tag — an item tagged with a different faith can never
 * render under the requested faith, even if a data error buckets it wrongly.
 */
export function itemsForFaith<T extends { faith?: FaithId }>(
  items: T[],
  faith: FaithId | null,
): T[] {
  if (!faith) return [];
  return items.filter((v) => v.faith === faith);
}
