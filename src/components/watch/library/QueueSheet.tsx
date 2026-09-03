/**
 * "What should I watch?" — a queue for the time the person has, built from
 * their own saved items by src/lib/watch/queue.ts. Every entry says why.
 */
import { useMemo, useState } from "react";
import { ItemCard } from "@/components/watch/library/ItemCard";
import { BottomSheet, Chip, EmptyState, PRIMARY } from "@/components/watch/library/shared";
import { formatMinutes } from "@/lib/watch/format";
import { QUEUE_BUDGETS_MINUTES, buildQueue } from "@/lib/watch/queue";
import type { WatchItem } from "@/lib/watch/types";

export function QueueSheet({
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
  const [minutes, setMinutes] = useState<number>(30);
  const plan = useMemo(() => buildQueue(pool, minutes, now), [pool, minutes, now]);
  return (
    <BottomSheet title="What should I watch?" onClose={onClose} testId="watch-queue-sheet">
      <div className="mb-2 text-xs text-muted-foreground">I have…</div>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
        {QUEUE_BUDGETS_MINUTES.map((m) => (
          <Chip key={m} active={minutes === m} onClick={() => setMinutes(m)}>
            {m >= 120
              ? "2+ hours"
              : m >= 60
                ? `${m / 60} hour${m > 60 ? "s" : ""}`
                : `${m} minutes`}
          </Chip>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {plan.entries.length
          ? `${plan.entries.length} to watch · ${formatMinutes(plan.totalSeconds)} of ${formatMinutes(plan.budgetSeconds)}`
          : "Nothing fits yet."}
        {plan.unknownLength
          ? ` · ${plan.unknownLength} saved item${plan.unknownLength > 1 ? "s" : ""} left out because the length is unknown`
          : ""}
      </div>
      <div className="mt-2 space-y-2">
        {plan.entries.length === 0 ? (
          <EmptyState
            emoji="⏱️"
            title="No saved videos fit this window"
            hint="Save a few with a known length, or give one a length from its card."
          />
        ) : (
          plan.entries.map((e, i) => (
            <ItemCard
              key={e.item.id}
              item={e.item}
              now={now}
              reason={`${i + 1}. ${formatMinutes(e.seconds)} — ${e.reason}`}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
      {plan.entries.length ? (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => onOpen(plan.entries[0].item)} className={PRIMARY}>
            Start with the first
          </button>
        </div>
      ) : null}
    </BottomSheet>
  );
}
