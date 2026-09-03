/**
 * THE SCREEN HEADER — one shape for every world.
 *
 * Back on the start side, actions on the end side, then the eyebrow (the
 * world's name, in its ink), a large display title and an optional line
 * under it. Children render below for tabs or a search field. The top
 * inset is NOT paid here: the app shell's <main> already pads
 * env(safe-area-inset-top) once for every screen.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OniqHeader({
  eyebrow,
  title,
  subtitle,
  back = "/app",
  actions,
  children,
  className,
  size = "lg",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Route to go back to; null hides the back button. */
  back?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  size?: "lg" | "md";
}) {
  return (
    <header className={cn("px-5 pt-8", className)}>
      {(back || actions) && (
        <div className="flex items-center justify-between gap-3">
          {back ? (
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              to={back as any}
              aria-label="Back"
              className="tap press grid h-10 w-10 shrink-0 place-items-center rounded-full oniq-glass text-foreground"
            >
              <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
            </Link>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={cn("mt-5", !back && !actions && "mt-0")}>
        {eyebrow ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-world">
            {eyebrow}
          </div>
        ) : null}
        <h1
          className={cn(
            "font-display leading-[1.02] tracking-tight text-foreground",
            size === "lg" ? "mt-1 text-[30px]" : "mt-1 text-[22px]",
          )}
          style={{ textWrap: "balance" }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-[38ch] text-sm leading-snug text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}
