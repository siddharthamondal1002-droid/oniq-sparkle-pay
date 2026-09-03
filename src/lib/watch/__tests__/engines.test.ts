/**
 * The pure engines: resurface ranking with reasons, the time-budgeted queue,
 * duplicate grouping with false-positive protection, watchlist health, and
 * "what next in this thread".
 */
import { describe, expect, it } from "vitest";
import { findDuplicateGroups, normalizeTitle, watchlistHealth } from "@/lib/watch/duplicates";
import { formatClock, formatProgressClock, parseClock } from "@/lib/watch/format";
import { buildQueue } from "@/lib/watch/queue";
import { rankResurface, topicClusters } from "@/lib/watch/resurface";
import { nextInThread } from "@/lib/watch/threads";
import type { WatchItem } from "@/lib/watch/types";

const NOW = new Date("2026-09-03T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let n = 0;
function item(over: Partial<WatchItem> = {}): WatchItem {
  n += 1;
  return {
    id: `item-${n}`,
    user_id: "u1",
    provider: "youtube",
    content_id: `v${n}`,
    canonical_url: `https://www.youtube.com/watch?v=v${n}`,
    title: `Video ${n}`,
    creator: null,
    duration_seconds: 600,
    thumbnail_url: null,
    state: "library",
    reason: null,
    priority: 0,
    position_seconds: 0,
    completed_at: null,
    last_watched_at: null,
    notes: null,
    tags: [],
    topics: [],
    rights: null,
    metadata: {},
    duplicate_group_id: null,
    resurface_dismissed_at: null,
    resurface_dismissals: 0,
    saved_at: daysAgo(1),
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    ...over,
  };
}

describe("resurface", () => {
  it("ranks unfinished first, explains every card, and excludes finished, archived and recently dismissed", () => {
    const unfinished = item({ position_seconds: 300, last_watched_at: daysAgo(2) });
    const forgotten = item({ saved_at: daysAgo(19) });
    const research = item({ reason: "research", saved_at: daysAgo(12) });
    const done = item({ completed_at: daysAgo(1), saved_at: daysAgo(30) });
    const archived = item({ state: "archived", saved_at: daysAgo(40) });
    const dismissed = item({
      saved_at: daysAgo(40),
      resurface_dismissed_at: daysAgo(2),
      resurface_dismissals: 1,
    });
    const fresh = item();
    const out = rankResurface([fresh, done, archived, dismissed, research, forgotten, unfinished], {
      now: NOW,
    });
    expect(out.map((r) => r.item.id)).toEqual([unfinished.id, forgotten.id, research.id]);
    expect(out[0].reason).toBe("You started this but never finished it.");
    expect(out[1].reason).toBe("You saved this 19 days ago. Still interested?");
    expect(out[2].reason).toBe("Because you saved this for research 12 days ago.");
  });

  it("names the thread an unfinished item belongs to, and pushes dismissed items down", () => {
    const a = item({ position_seconds: 100, last_watched_at: daysAgo(3) });
    const b = item({
      position_seconds: 100,
      last_watched_at: daysAgo(3),
      resurface_dismissals: 1,
      resurface_dismissed_at: daysAgo(20),
    });
    const out = rankResurface([b, a], { now: NOW, threadNames: { [a.id]: ["AI Video"] } });
    expect(out[0].item.id).toBe(a.id);
    expect(out.find((r) => r.item.id === a.id)?.reason).toBe(
      "You started this but never finished it.",
    );
    // b: 3 - 2 = 1, still listed but last.
    expect(out[1].item.id).toBe(b.id);
    // a dismissed item with no other signal disappears entirely
    const c = item({
      saved_at: daysAgo(20),
      resurface_dismissals: 2,
      resurface_dismissed_at: daysAgo(30),
    });
    expect(rankResurface([c], { now: NOW })).toEqual([]);
  });

  it("clusters topics only at three or more", () => {
    const items = [
      item({ topics: ["motion"] }),
      item({ topics: ["motion"] }),
      item({ topics: ["motion", "lora"] }),
      item({ topics: ["lora"] }),
    ];
    expect(topicClusters(items)).toEqual([{ topic: "motion", count: 3 }]);
  });
});

describe("smart queue", () => {
  it("fills 30 minutes with unfinished first and explains each entry", () => {
    const eight = item({ duration_seconds: 8 * 60 });
    const fourteen = item({ duration_seconds: 14 * 60, priority: 2 });
    const unfinished = item({
      duration_seconds: 20 * 60,
      position_seconds: 13 * 60,
      last_watched_at: daysAgo(1),
    });
    const long = item({ duration_seconds: 50 * 60 });
    const unknown = item({ duration_seconds: null });
    const plan = buildQueue([long, eight, unknown, fourteen, unfinished], 30, NOW);
    expect(plan.entries[0].item.id).toBe(unfinished.id);
    expect(plan.entries[0].seconds).toBe(7 * 60);
    expect(plan.entries[0].reason).toContain("Unfinished");
    expect(plan.entries.map((e) => e.item.id)).toContain(fourteen.id);
    expect(plan.entries.map((e) => e.item.id)).toContain(eight.id);
    expect(plan.entries.map((e) => e.item.id)).not.toContain(long.id);
    expect(plan.totalSeconds).toBeLessThanOrEqual(plan.budgetSeconds * 1.1);
    expect(plan.unknownLength).toBe(1);
  });

  it("tolerates a ten-percent overrun on the last entry and skips finished items", () => {
    const thirtyTwo = item({ duration_seconds: 32 * 60 });
    const done = item({ duration_seconds: 5 * 60, completed_at: daysAgo(1) });
    const plan = buildQueue([done, thirtyTwo], 30, NOW);
    expect(plan.entries.map((e) => e.item.id)).toEqual([thirtyTwo.id]);
  });
});

describe("duplicates", () => {
  it("groups the same video on two providers when the creator agrees", () => {
    const a = item({
      provider: "youtube",
      title: "Character Consistency in Wan 2.2 (Official)",
      creator: "Studio X",
    });
    const b = item({
      provider: "vimeo",
      title: "Character consistency in Wan 2.2",
      creator: "studio x",
    });
    const groups = findDuplicateGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(groups[0].confidence).toBe("high");
  });

  it("groups on matching length when the creators are missing", () => {
    const a = item({
      provider: "youtube",
      title: "LoRA training walkthrough",
      creator: null,
      duration_seconds: 1000,
    });
    const b = item({
      provider: "dailymotion",
      title: "LoRA training walkthrough",
      creator: null,
      duration_seconds: 1015,
    });
    expect(findDuplicateGroups([a, b])).toHaveLength(1);
  });

  it("does not group similar titles that disagree on creator and length — false-positive protection", () => {
    const a = item({
      provider: "youtube",
      title: "Motion basics",
      creator: "Alice",
      duration_seconds: 600,
    });
    const b = item({
      provider: "vimeo",
      title: "Motion basics",
      creator: "Bob",
      duration_seconds: 900,
    });
    const c = item({
      provider: "vimeo",
      title: "Motion basics part 2",
      creator: "Alice",
      duration_seconds: 600,
    });
    expect(findDuplicateGroups([a, b, c])).toEqual([]);
  });

  it("never groups two items from the same provider (the database forbids the twin anyway)", () => {
    const a = item({ provider: "youtube", title: "Same", creator: "A" });
    const b = item({ provider: "youtube", title: "Same", creator: "A" });
    expect(findDuplicateGroups([a, b])).toEqual([]);
  });

  it("normalises decorations out of titles", () => {
    expect(normalizeTitle("My Film [4K] (Official Trailer) — HD")).toBe("my film");
  });

  it("counts watchlist health", () => {
    const items = [
      item({ saved_at: daysAgo(45) }),
      item({ position_seconds: 10, last_watched_at: daysAgo(1) }),
      item({ priority: 3, saved_at: daysAgo(2) }),
      item({ completed_at: daysAgo(1) }),
      item({ state: "archived", saved_at: daysAgo(90) }),
    ];
    const h = watchlistHealth(items, NOW);
    expect(h).toMatchObject({
      active: 3,
      unfinished: 1,
      stale: 1,
      duplicates: 0,
      highPriority: 1,
      recentlyAdded: 2,
    });
    expect(h.staleItems.map((i) => i.id)).toEqual([items[0].id]);
  });
});

describe("threads", () => {
  it("answers what to watch next: unfinished, then unwatched in order, then nothing", () => {
    const done = item({ completed_at: daysAgo(1) });
    const unfinished = item({ position_seconds: 50, last_watched_at: daysAgo(1) });
    const fresh = item();
    expect(
      nextInThread([
        { item: fresh, position: 0 },
        { item: unfinished, position: 1 },
        { item: done, position: 2 },
      ])?.item.id,
    ).toBe(unfinished.id);
    expect(
      nextInThread([
        { item: done, position: 0 },
        { item: fresh, position: 1 },
      ])?.item.id,
    ).toBe(fresh.id);
    expect(nextInThread([{ item: done, position: 0 }])).toBeNull();
  });
});

describe("format", () => {
  it("prints and parses clocks", () => {
    expect(formatClock(1052)).toBe("17:32");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatProgressClock(1052, 2588)).toBe("17:32 / 43:08");
    expect(parseClock("17:32")).toBe(1052);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("abc")).toBeNull();
  });
});
