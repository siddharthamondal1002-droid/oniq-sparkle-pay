import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A pill. Active chips fill with the world's pair; the rest sit on a surface. */
export function OniqChip({
  active = false,
  onClick,
  children,
  className,
  ariaLabel,
  role,
  testId,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  role?: "tab" | "radio";
  testId?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === "tab" ? active : undefined}
      aria-checked={role === "radio" ? active : undefined}
      aria-pressed={role ? undefined : active}
      aria-label={ariaLabel}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors",
        active ? "bg-world text-white world-glow" : "oniq-surface text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
