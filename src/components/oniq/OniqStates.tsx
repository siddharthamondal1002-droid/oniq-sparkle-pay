import { AlertCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A shimmering placeholder block. */
export function OniqSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton-shimmer rounded-2xl", className)} />;
}

export function OniqSkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <OniqSkeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/** Nothing here yet — and it says so without pretending something failed. */
export function OniqEmpty({
  emoji,
  title,
  body,
  action,
  className,
}: {
  emoji?: string;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-3xl oniq-surface p-6 text-center", className)}>
      {emoji ? (
        <div
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-world-soft text-2xl"
          aria-hidden="true"
        >
          {emoji}
        </div>
      ) : null}
      <div className="mt-3 font-display text-[15px] text-foreground">{title}</div>
      {body ? <p className="mt-1 text-sm text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Something failed on our side. Says so, offers a retry, and never claims
 * the person has no data — the distinction src/lib/queryView.ts exists for.
 */
export function OniqError({
  label = "Couldn't load this right now.",
  onRetry,
  busy = false,
  className,
}: {
  label?: string;
  onRetry?: () => void;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-3xl oniq-surface p-4 text-sm", className)} role="alert">
      <div className="flex items-start gap-2 text-muted-foreground">
        <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
        <span>{label}</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
        >
          <RotateCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Try again
        </button>
      ) : null}
    </div>
  );
}
