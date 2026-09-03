import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A horizontal, snapping rail that bleeds to the screen edge. */
export function OniqStoryRail({
  children,
  className,
  ariaLabel,
  role,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  role?: string;
}) {
  return (
    <div role={role} aria-label={ariaLabel} className={cn("snap-rail -mx-5 gap-3 px-5", className)}>
      {children}
    </div>
  );
}
