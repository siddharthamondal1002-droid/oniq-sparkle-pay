/**
 * Watchlist health and "Clean Watchlist". Counts from src/lib/watch/duplicates.ts;
 * every action is confirmed by the person, and nothing is deleted here —
 * cleaning archives, and grouping is reversible from the item.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ItemCard } from "@/components/watch/library/ItemCard";
import {
  BottomSheet,
  EmptyState,
  GHOST,
  PRIMARY,
  ProviderBadge,
  SMALL,
} from "@/components/watch/library/shared";
import { useInvalidateWatch } from "@/lib/watch/hooks";
import { ANALYSIS_CAP, setDuplicateGroup, updateWatchItem } from "@/lib/watch/library";
import { findDuplicateGroups, watchlistHealth } from "@/lib/watch/duplicates";
import type { WatchItem } from "@/lib/watch/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function HealthSheet({
  pool,
  now,
  onClose,
  onOpen,
}: {
  pool: WatchItem[];
  now: Date;
  onClose: () => void;
  onOpen: (item: WatchItem) => void;
}) {
  const invalidate = useInvalidateWatch();
  const [confirmStale, setConfirmStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const health = useMemo(() => watchlistHealth(pool, now), [pool, now]);
  const groups = useMemo(
    () => findDuplicateGroups(pool).filter((g) => g.items.some((i) => !i.duplicate_group_id)),
    [pool],
  );

  const archiveStale = async () => {
    setBusy(true);
    try {
      for (const it of health.staleItems) await updateWatchItem(it.id, { state: "archived" });
      invalidate();
      toast.success(
        `Archived ${health.staleItems.length} stale item${health.staleItems.length === 1 ? "" : "s"}`,
      );
      setConfirmStale(false);
    } catch {
      toast.error("Couldn't archive everything; some may remain.");
    } finally {
      setBusy(false);
    }
  };

  const group = async (ids: string[]) => {
    try {
      await setDuplicateGroup(ids, crypto.randomUUID());
      invalidate();
      toast.success("Grouped as one video");
    } catch {
      toast.error("Couldn't group those.");
    }
  };

  return (
    <BottomSheet title="Watchlist health" onClose={onClose} testId="watch-health-sheet">
      {pool.length >= ANALYSIS_CAP ? (
        <p className="mb-2 text-[11px] text-muted-foreground">
          Counting the most recent {ANALYSIS_CAP} items.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="active" value={health.active} />
        <Stat label="unfinished" value={health.unfinished} />
        <Stat label="stale (30d+)" value={health.stale} />
        <Stat label="likely duplicates" value={health.duplicates} />
        <Stat label="high priority" value={health.highPriority} />
        <Stat label="added this week" value={health.recentlyAdded} />
      </div>

      <div className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
        likely the same video
      </div>
      {groups.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">
          No likely duplicates. Similar titles alone are never grouped.
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          {groups.map((g) => (
            <div key={g.key} className="rounded-2xl border border-border bg-card p-3 text-xs">
              <div className="font-semibold">{g.items[0].title}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.items.map((i) => (
                  <ProviderBadge key={i.id} provider={i.provider} />
                ))}
              </div>
              <div className="mt-1 text-muted-foreground">Matched on {g.reason}.</div>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => group(g.items.map((i) => i.id))}
                  className={SMALL}
                >
                  Group as one
                </button>
                <button type="button" onClick={() => onOpen(g.items[0])} className={SMALL}>
                  Look
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground">
        stale — saved 30+ days ago, never watched
      </div>
      {health.staleItems.length === 0 ? (
        <div className="mt-1">
          <EmptyState
            emoji="🧹"
            title="Nothing stale"
            hint="Everything saved a month ago or more has been watched."
          />
        </div>
      ) : (
        <>
          <div className="mt-1 space-y-2">
            {health.staleItems.slice(0, 8).map((it) => (
              <ItemCard key={it.id} item={it} now={now} onOpen={onOpen} />
            ))}
            {health.staleItems.length > 8 ? (
              <div className="text-xs text-muted-foreground">
                and {health.staleItems.length - 8} more
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {confirmStale ? (
              <>
                <button type="button" onClick={() => setConfirmStale(false)} className={GHOST}>
                  cancel
                </button>
                <button type="button" disabled={busy} onClick={archiveStale} className={PRIMARY}>
                  Archive {health.staleItems.length} stale
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmStale(true)} className={PRIMARY}>
                Clean watchlist
              </button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  );
}
