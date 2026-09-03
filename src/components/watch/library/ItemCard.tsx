/**
 * One saved item, wherever it appears. A glyph stands in for artwork — the
 * library fetches no thumbnail from any provider, the same rule as the rest
 * of Watch (src/config/playCompliance.ts).
 */
import type { ReactNode } from "react";
import { daysAgoLabel, formatMinutes, formatProgressClock } from "@/lib/watch/format";
import { isUnfinished, remainingSeconds, type WatchItem } from "@/lib/watch/types";
import { PROVIDER_GLYPH, ProviderBadge, RightsBadge } from "@/components/watch/library/shared";

export function ItemCard({
  item,
  now,
  reason,
  actions,
  onOpen,
}: {
  item: WatchItem;
  now: Date;
  /** The explanation line — a Resurface reason, a queue reason, a thread note. */
  reason?: string;
  actions?: ReactNode;
  onOpen: (item: WatchItem) => void;
}) {
  const unfinished = isUnfinished(item);
  const left = remainingSeconds(item);
  const pct =
    item.duration_seconds && item.duration_seconds > 0
      ? Math.min(100, Math.round((item.position_seconds / item.duration_seconds) * 100))
      : null;
  return (
    <div className="rounded-2xl border border-border bg-card p-3" data-testid="watch-item">
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`Open ${item.title}`}
        className="press flex w-full items-start gap-3 text-left"
      >
        <div className="grid h-14 w-20 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-2xl">
          {PROVIDER_GLYPH[item.provider] ?? "📺"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-semibold leading-snug">{item.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <ProviderBadge provider={item.provider} />
            {item.creator ? <span className="truncate">{item.creator}</span> : null}
            {item.duration_seconds && !unfinished ? (
              <span>{formatMinutes(item.duration_seconds)}</span>
            ) : null}
            {item.provider === "internet_archive" ? <RightsBadge rights={item.rights} /> : null}
          </div>
          {unfinished || item.completed_at ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {item.completed_at
                ? `Finished ${daysAgoLabel(item.completed_at, now)}`
                : `${formatProgressClock(item.position_seconds, item.duration_seconds)}${
                    left != null ? ` · ${formatMinutes(left)} left` : ""
                  } · watched ${daysAgoLabel(item.last_watched_at, now)}`}
            </div>
          ) : null}
          {pct != null && unfinished ? (
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2"
              aria-hidden="true"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          {reason ? <div className="mt-1 text-[11px] italic text-primary/90">{reason}</div> : null}
        </div>
      </button>
      {actions ? <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div> : null}
    </div>
  );
}
