import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A pill. Active chips fill with the world's pair; the rest sit on a surface. */
/**
 * TWO ACTIVE TREATMENTS, because the owner's reference draws two.
 *
 *   "world" — a solid world gradient with white text. What a FILTER or a TAB
 *             gets: Home's "Mast", Explore's "All". It is a statement about
 *             where you are.
 *   "soft"  — a pale wash of the world with the world's own ink on top. What
 *             an OPTION gets: Style, Mood. It is a statement about a setting,
 *             and it sits inside a card rather than on the canvas.
 *
 * "soft" is also the legible one, which is not a coincidence. MEASURED
 * 2026-09-04 in a browser: white on the `create` gradient is 1.7:1 at the cyan
 * end (#22d3ee) and 3.5:1 at the pink (#ec4899) — both below the 4.5:1 floor.
 * `--world-on` is #ffffff for every world but one, and that one was already
 * overridden to a dark ink, so somebody has hit this before. Fixing it for
 * every world is a wider job than this component; using the treatment the
 * reference already draws for options is the part that belongs here.
 */
export function OniqChip({
  active = false,
  onClick,
  children,
  className,
  ariaLabel,
  role,
  testId,
  tone = "world",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  role?: "tab" | "radio";
  testId?: string;
  tone?: "world" | "soft";
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
        // `normal-case tracking-normal` against the app-wide
        // `button { text-transform: uppercase }` rule. EVERY chip in the
        // owner's reference is sentence case — "Auto", "Cinematic", "Text to
        // Voice", "All", "Study" — and the cascade was shouting all of them.
        // Measured in a browser 2026-09-04: the Style and Mood chips rendered
        // "AUTO" / "CHILL" with computed text-transform: uppercase. It reads
        // as a system label rather than a choice, and a shouted secondary
        // control competes with the primary one beside it.
        "press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold normal-case tracking-normal transition-colors",
        active
          ? tone === "soft"
            ? "bg-world-soft text-world border border-world"
            : "bg-world text-on-world world-glow"
          : "oniq-surface text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
