/**
 * THE BOTTOM NAV — Home · Chat · ✦ Create · Explore · Profile.
 *
 * Owner mission, 2026-09-03: five slots, Create in the centre and visibly
 * different from the four tabs. Labels are translated the same way the
 * old bar's were; the active tab lifts its icon and carries the world's
 * pair. Glass, because this is chrome floating over scrolling content.
 */
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * PUBLISH THE NAV'S REAL HEIGHT, so content can reserve exactly it.
 *
 * Reported 2026-09-04: the last section of Home ("Five experiences") sat
 * underneath this bar. The shell reserved a hardcoded 7rem while the bar is
 * actually its own box PLUS the safe-area inset PLUS the Create orb, which
 * `-mt-7` lifts clean out of the flex flow — a negative margin does not grow
 * the parent, so the orb overhangs a box that never counted it.
 *
 * Measuring from the TOP OF THE ORB to the bottom of the window captures all
 * three at once and keeps capturing them when the device changes: a taller
 * gesture inset, a larger font scale, a translated label that wraps. The
 * alternative — adding up paddings in a comment and hoping — is what the 7rem
 * was.
 */
function usePublishNavHeight(navRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const root = document.documentElement;
    const measure = () => {
      // The orb is the highest point of the chrome; fall back to the bar
      // itself where it is missing (it never is, but a null here would
      // silently reserve nothing).
      const orb = nav.querySelector<HTMLElement>("[data-nav-peak]") ?? nav;
      const top = orb.getBoundingClientRect().top;
      const h = Math.max(0, Math.round(window.innerHeight - top));
      if (h > 0) root.style.setProperty("--oniq-nav-h", `${h}px`);
    };
    measure();
    // Guarded the way LayoutGrid guards it: an old WebView without
    // ResizeObserver should lose the re-measure, not throw and take the whole
    // nav down. The resize/orientation listeners still cover the common cases.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(nav);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      root.style.removeProperty("--oniq-nav-h");
    };
  }, [navRef]);
}

export type NavTab = {
  to: string;
  labelKey: string;
  fallback: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function OniqBottomNav({
  tabs,
  isActive,
  onCreate,
}: {
  /** Exactly four: two on each side of Create. */
  tabs: NavTab[];
  isActive: (to: string) => boolean;
  onCreate: () => void;
}) {
  const { t } = useT();
  const navRef = useRef<HTMLElement | null>(null);
  usePublishNavHeight(navRef);
  const start = tabs.slice(0, 2);
  const end = tabs.slice(2, 4);
  const renderTab = (tab: NavTab) => {
    const active = isActive(tab.to);
    const Icon = tab.icon;
    return (
      <Link
        key={tab.to}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={tab.to as any}
        preload="intent"
        aria-current={active ? "page" : undefined}
        className={cn(
          "press flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-medium transition-colors duration-200",
          active ? "text-world" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-xl transition-all duration-200",
            active && "bg-world-soft -translate-y-0.5",
          )}
        >
          <Icon
            className={cn("h-5 w-5 transition-transform duration-200", active && "scale-110")}
          />
        </span>
        {t(tab.labelKey, tab.fallback)}
      </Link>
    );
  };
  return (
    <nav
      ref={navRef}
      data-world="home"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:max-w-lg lg:max-w-xl"
    >
      <div className="grid grid-cols-5 items-end rounded-[28px] oniq-glass p-1.5 shadow-card">
        {start.map(renderTab)}
        <div className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground">
          <button
            type="button"
            onClick={onCreate}
            data-testid="nav-create"
            data-nav-peak
            data-world="create"
            aria-label={t("nav.create", "Create")}
            className="press -mt-7 grid h-14 w-14 place-items-center rounded-full bg-world text-on-world world-glow ring-4 ring-background"
          >
            <Sparkles className="h-6 w-6" />
          </button>
          <span aria-hidden="true">{t("nav.create", "Create")}</span>
        </div>
        {end.map(renderTab)}
      </div>
    </nav>
  );
}
