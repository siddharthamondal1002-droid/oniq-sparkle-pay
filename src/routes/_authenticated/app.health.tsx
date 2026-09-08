import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { OniqCanvas, OniqEmpty, OniqHeader } from "@/components/oniq";
import { useT } from "@/lib/i18n/LanguageProvider";
import { cn } from "@/lib/utils";
import { HEALTH_ENABLED } from "@/health/flags";
import { HEALTH_ROUTE } from "@/health/doors";
import { registerHealthTranslations } from "@/health/i18n";

/**
 * ONIQ HEALTH — the layout every health screen sits in.
 *
 * Owner brief, 2026-09-08. DARK: while `HEALTH_FLAGS["health.enabled"]` is
 * false this renders one sentence and mounts nothing else — no query, no
 * child — so a deep link is an answer rather than a 404, and nothing here
 * can reach the server before the owner turns it on (docs/health/04).
 *
 * THE CHILDREN RENDER THROUGH `<Outlet />`. TanStack's flat file convention
 * nests `app.health.index`, `app.health.records` and `app.health.consent`
 * under this file by their dots; a parent without an Outlet mounts and drops
 * the child silently (routeNesting.test.ts, and the admin tools that were
 * invisible for a day).
 *
 * The strings come from the `health.*` overlay in three languages, registered
 * once here on import.
 */
registerHealthTranslations();

export const Route = createFileRoute("/_authenticated/app/health")({
  component: HealthLayout,
});

const TABS = [
  {
    to: HEALTH_ROUTE,
    key: "health.tab.timeline",
    fallback: "Timeline",
    exact: true,
    id: "timeline",
  },
  {
    to: `${HEALTH_ROUTE}/records`,
    key: "health.tab.records",
    fallback: "Documents",
    exact: false,
    id: "records",
  },
  {
    to: `${HEALTH_ROUTE}/consent`,
    key: "health.tab.consent",
    fallback: "Consent",
    exact: false,
    id: "consent",
  },
] as const;

function HealthLayout() {
  const { t } = useT();
  const { pathname } = useLocation();

  if (!HEALTH_ENABLED) {
    return (
      <OniqCanvas world="vitals" className="pb-28">
        <OniqHeader eyebrow="ONIQ" title={t("health.title", "Health")} back="/app" />
        <div className="mt-4 px-5">
          <OniqEmpty
            emoji="🩺"
            title={t("health.off.title", "ONIQ Health isn't switched on yet.")}
            body={t("health.off.body", "Nothing is stored until it is.")}
          />
        </div>
      </OniqCanvas>
    );
  }

  return (
    <OniqCanvas world="vitals" className="pb-28">
      <OniqHeader
        eyebrow="ONIQ"
        title={t("health.title", "Health")}
        subtitle={t("health.subtitle", "Your records, documents and consents.")}
        back="/app"
      />
      <nav className="mt-3 flex gap-2 px-5" aria-label={t("health.title", "Health")}>
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.to : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.id}
              to={tab.to}
              data-testid={`health-tab-${tab.id}`}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm transition-colors",
                active ? "bg-foreground text-background" : "oniq-surface text-muted-foreground",
              )}
            >
              {t(tab.key, tab.fallback)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 px-5">
        <Outlet />
      </div>
      <p className="mt-6 px-5 text-center text-xs text-muted-foreground">
        {t("health.disclaimer", "Information only — not a diagnosis. See a doctor.")}
      </p>
    </OniqCanvas>
  );
}
