import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { OniqAIOrb } from "./OniqAIOrb";

/**
 * "Ask ONIQ anything" — the one control every screen may carry. A link,
 * not a form: the question is typed on Ting's own screen, which owns the
 * crisis guard and the spend guard. Nothing is sent from here.
 */
export function OniqAskBar({
  placeholder = "Ask ONIQ anything…",
  to = "/app/ai",
  className,
  testId,
}: {
  placeholder?: string;
  to?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      preload="intent"
      aria-label={placeholder}
      data-testid={testId}
      className={cn(
        "press flex items-center gap-3 rounded-full oniq-surface py-2 pe-2 ps-4 text-start",
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-world" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{placeholder}</span>
      <OniqAIOrb size="sm" still />
    </Link>
  );
}
