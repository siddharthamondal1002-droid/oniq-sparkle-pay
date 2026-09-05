import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

const VARIANT: Record<string, string> = {
  surface: "oniq-surface",
  glass: "oniq-glass",
  tinted: "bg-world-soft border border-world",
  hero: "bg-world text-on-world world-glow",
  outline: "border border-border bg-transparent",
};
const PADDING: Record<string, string> = { none: "", sm: "p-3", md: "p-4", lg: "p-5" };

/**
 * THE CARD. Surface by default — white in light, the card token in dark —
 * with the soft two-part shadow. Glass is for chrome that floats over
 * scrolling content, not for every card on a screen. When `onClick` is
 * given the card is a real button for the keyboard too.
 */
export function OniqCard({
  variant = "surface",
  padding = "md",
  className,
  style,
  children,
  onClick,
  testId,
  ariaLabel,
}: {
  variant?: keyof typeof VARIANT;
  padding?: keyof typeof PADDING;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
  ariaLabel?: string;
}) {
  const base = cn(
    // MIN-W-0, AND IT IS LOAD-BEARING. A grid or flex item defaults to
    // `min-width: auto`, which refuses to shrink below the min-content width
    // of its subtree — and `<audio controls>` carries a UA minimum inside its
    // shadow DOM that is far wider than a phone. Measured 2026-09-05 at a
    // 390px viewport: one song card in Creations' single-column grid forced
    // the whole COLUMN to 548px, so every card in the list — films with no
    // audio in them at all — hung 198px off the right edge with their titles
    // sliced by the screen instead of ellipsised by `truncate`.
    //
    // The obvious one-line fix does NOT work: `audio { min-width: 0 }` was
    // measured and changed nothing, because the UA minimum lives in the
    // element's shadow tree and still counts toward the grid item's
    // min-content contribution. It has to be the item that is allowed to
    // shrink, which is this.
    "min-w-0",
    "rounded-3xl",
    VARIANT[variant],
    PADDING[padding],
    onClick && "press text-start",
    className,
  );
  if (onClick) {
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    };
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={onClick}
        onKeyDown={onKey}
        className={cn(base, "cursor-pointer")}
        style={style}
        data-testid={testId}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={base} style={style} data-testid={testId}>
      {children}
    </div>
  );
}
