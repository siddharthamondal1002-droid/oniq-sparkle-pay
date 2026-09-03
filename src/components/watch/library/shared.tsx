/**
 * Small pieces every Watch library surface uses: chips, sheets, states,
 * provider and rights badges. Same design tokens as the rest of Watch.
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { providerName } from "@/lib/watch/providers";
import { rightsFromStored, type Rights } from "@/lib/watch/rights";

export const INPUT =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";
export const PRIMARY =
  "press inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50";
export const GHOST =
  "press inline-flex min-h-10 items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50";
export const SMALL =
  "press inline-flex min-h-9 items-center justify-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground disabled:opacity-50";

export const PROVIDER_GLYPH: Record<string, string> = {
  youtube: "▶️",
  vimeo: "🎞️",
  nebula: "🪐",
  internet_archive: "🏛️",
  dailymotion: "📼",
  twitch: "🎮",
};

export function Chip({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`press min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {PROVIDER_GLYPH[provider] ?? "📺"} {providerName(provider)}
    </span>
  );
}

/** The rights label for an Archive item, honest about "unknown". */
export function RightsBadge({ rights }: { rights: unknown }) {
  const r: Rights | null = rightsFromStored(rights);
  const tone =
    r?.class === "public_domain" || r?.class === "creative_commons" || r?.class === "permitted"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {r ? r.label : "Rights not checked"}
    </span>
  );
}

export function EmptyState({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6 text-center">
      <div className="text-2xl">{emoji}</div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card/60" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm" role="alert">
      <div className="font-semibold">Couldn&apos;t load this</div>
      <div className="mt-1 text-xs text-muted-foreground">{message}</div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`${SMALL} mt-3`}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * A bottom sheet with its own scroll, so the page behind never jumps. The
 * panel is the only scrolling element; the frame inside it stays put.
 */
export function BottomSheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        data-testid={testId}
        className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-3xl border border-border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display truncate text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
