import { AlertCircle, RotateCw } from "lucide-react";

/**
 * The explicit "this failed, here is a retry" card that replaces a false empty
 * state. Deliberately says something went wrong on OUR side and never claims
 * the user has no data — see src/lib/queryView.ts for why that distinction
 * matters. Small and self-contained so it can drop into any of the P3 screens.
 */
export function QueryError({
  onRetry,
  label = "Couldn't load this right now.",
  busy = false,
}: {
  onRetry: () => void;
  label?: string;
  busy?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
      <div className="flex items-start gap-2 text-muted-foreground">
        <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
        <span>{label}</span>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      >
        <RotateCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Try again
      </button>
    </div>
  );
}
