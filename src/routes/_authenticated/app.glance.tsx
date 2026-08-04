// Glance — public holidays, a currency reference rate, and market link-outs.
//
// Everything here is free, keyless and commercially usable. Nothing is
// re-hosted and no number is displayed that ONIQ is not licensed to show:
// markets are link-outs, and FX is an ECB reference rate labelled as such
// rather than a live quote.
//
// Weather is deliberately absent. Every weather source evaluated either
// restricts commercial use on its free tier (Open-Meteo) or is a paid vendor
// API (Google Maps Platform Weather). See REJECTED_SOURCES.
//
// AXES, which differ on purpose:
//   holidays  -> CURRENT REGION. Whether the banks are shut depends on where
//                you are standing, not where you are from.
//   FX        -> HOME currency into CURRENT REGION currency. That is the
//                traveller's question: what is my money worth here.
//   markets   -> HOME. An Indian user in Dubai still tracks the Nifty.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Coins, LineChart } from "lucide-react";
import { useCurrentRegion } from "@/lib/region";
import { useCountry } from "@/lib/country";
import { getCountryConfig } from "@/data/countryRegistry";
import { launchAppEntry } from "@/lib/miniapps";
import { marketAppsFor, MARKET_NOTICE } from "@/data/marketApps";
import { fetchHolidays, needsSubdivision, nextHoliday, type Holiday } from "@/lib/holidays";
import { fetchReferenceRate, FX_NOTICE } from "@/lib/fxReference";
import { IN_SUBDIVISIONS, getSubdivision, setSubdivision } from "@/data/inSubdivisions";
import type { Country } from "@/data/appRegistry";

export const Route = createFileRoute("/_authenticated/app/glance")({
  component: GlanceScreen,
});

function GlanceScreen() {
  const [region] = useCurrentRegion();
  const [home] = useCountry();
  const homeC = (home as Country) ?? null;
  const here = (region as Country) ?? homeC;

  const [subdivision, setSub] = useState<string | null>(null);
  useEffect(() => setSub(getSubdivision()), []);

  const showStatePicker = here ? needsSubdivision(here) : false;

  const holidaysQ = useQuery({
    queryKey: ["holidays", here, subdivision],
    queryFn: () => fetchHolidays(new Date().getFullYear(), here as Country, subdivision),
    enabled: !!here,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const homeCur = homeC ? getCountryConfig(homeC).currency : null;
  const hereCur = here ? getCountryConfig(here).currency : null;
  const fxPair = homeCur && hereCur && homeCur !== hereCur ? { from: homeCur, to: hereCur } : null;

  const fxQ = useQuery({
    queryKey: ["fx", fxPair?.from, fxPair?.to],
    queryFn: () => fetchReferenceRate(fxPair!.from, fxPair!.to),
    enabled: !!fxPair,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const markets = useMemo(() => (homeC ? marketAppsFor(homeC) : []), [homeC]);
  const upcoming = useMemo(() => {
    const list: Holiday[] = holidaysQ.data ?? [];
    const next = nextHoliday(list);
    if (!next) return [];
    return list.filter((h) => h.date >= next.date).slice(0, 5);
  }, [holidaysQ.data]);

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground">
      <header className="flex items-center gap-3 px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <Link
          to="/app"
          aria-label="Back"
          className="grid h-10 w-10 place-items-center rounded-full bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            open data, no accounts
          </p>
          <h1 className="font-display text-xl font-semibold">Glance</h1>
        </div>
      </header>

      <div className="space-y-4 px-5 pt-5">
        {/* Holidays — Current Region */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-primary" /> Public holidays
            {here && <span className="text-xs font-normal text-muted-foreground">· {here}</span>}
          </h2>

          {showStatePicker && (
            <div className="mt-3">
              <label className="block text-xs text-muted-foreground" htmlFor="in-state">
                Your state — India&rsquo;s holidays are mostly state-level, so without this you
                only get the national ones.
              </label>
              <select
                id="in-state"
                value={subdivision ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setSubdivision(v);
                  setSub(v);
                }}
                className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm"
              >
                <option value="">National holidays only</option>
                {IN_SUBDIVISIONS.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!here ? (
            <p className="mt-3 text-xs text-muted-foreground">
              We don&rsquo;t know where you are yet, so there&rsquo;s nothing to show.
            </p>
          ) : holidaysQ.isLoading ? (
            <div className="mt-3 h-16 animate-pulse rounded-xl bg-surface" />
          ) : holidaysQ.error ? (
            <p className="mt-3 text-xs text-muted-foreground">Couldn&rsquo;t load holidays.</p>
          ) : upcoming.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No more public holidays this year.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.map((h) => (
                <li key={`${h.date}-${h.name}`} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{h.localName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(`${h.date}T00:00:00`).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                    {!h.national && " · state"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">Dates from Nager.Date (MIT).</p>
        </section>

        {/* FX — reference rate, never a quote */}
        {fxPair && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Coins className="size-4 text-primary" /> {fxPair.from} → {fxPair.to}
            </h2>
            {fxQ.isLoading ? (
              <div className="mt-3 h-8 animate-pulse rounded-xl bg-surface" />
            ) : fxQ.data ? (
              <>
                <p className="mt-2 font-display text-2xl font-bold">
                  {fxQ.data.rate.toFixed(4)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {fxPair.to} per {fxPair.from}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Published {fxQ.data.asOf}
                  {fxQ.data.stale && " · may be out of date"}
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">Rate unavailable.</p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{FX_NOTICE}</p>
          </section>
        )}

        {/* Markets — link-out only, Home axis */}
        {markets.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <LineChart className="size-4 text-primary" /> Markets
              {homeC && <span className="text-xs font-normal text-muted-foreground">· {homeC}</span>}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {markets.map((m) => (
                <button
                  key={m.id}
                  onClick={() => void launchAppEntry(m)}
                  className="press rounded-xl border border-border bg-surface p-2.5 text-start"
                  aria-label={`Open ${m.name} — opens outside ONIQ`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.kind}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium">{m.name}</div>
                  <div className="text-[10px] text-muted-foreground">Open in browser ↗</div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {MARKET_NOTICE}
            </p>
          </section>
        )}

        <Link
          to="/app/attributions"
          className="block rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground"
        >
          Where this data comes from, and its licences →
        </Link>
      </div>
    </div>
  );
}
