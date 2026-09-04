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
