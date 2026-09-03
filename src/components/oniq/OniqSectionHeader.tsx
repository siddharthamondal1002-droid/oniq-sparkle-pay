import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A section title with an optional "view all" on the end side. */
export function OniqSectionHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: { label: ReactNode; to?: string; onClick?: () => void; testId?: string };
  className?: string;
}) {
  const actionClass =
    "press inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[12px] font-semibold text-world";
  return (
    <div className={cn("flex items-end justify-between gap-3 px-5", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="font-display text-[15px] leading-tight text-foreground">{title}</h2>
      </div>
      {action?.to ? (
        <Link
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          to={action.to as any}
          className={actionClass}
          data-testid={action.testId}
        >
          {action.label} <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </Link>
      ) : action?.onClick ? (
        <button
          type="button"
          onClick={action.onClick}
          className={actionClass}
          data-testid={action.testId}
        >
          {action.label} <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
      ) : null}
    </div>
  );
}
