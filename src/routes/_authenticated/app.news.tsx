import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RotateCw, ChevronRight, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRegion } from "@/lib/region";
import { useCountry } from "@/lib/country";
import { newsUnavailableReason } from "@/data/newsPolicy";
import type { Country } from "@/data/appRegistry";
import { openInApp } from "@/lib/miniapps";
import {
  OniqCanvas,
  OniqCard,
  OniqChip,
  OniqEmpty,
  OniqHeader,
  OniqSectionHeader,
  OniqSkeleton,
  OniqSkeletonRows,
  OniqStoryRail,
} from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/news")({
  // Watch is gone. `?tab=watch` deep links still resolve — the param is
  // simply ignored and the reader lands on the news feed.
  validateSearch: () => ({}),
  component: NewsScreen,
});

type NewsItem = { title: string; link: string; source: string; publishedAt: string; image?: string };

const CATEGORIES = [
  { id: "top", label: "Top" },
  { id: "india", label: "India" },
  { id: "world", label: "World" },
  { id: "business", label: "Business" },
  { id: "technology", label: "Tech" },
  { id: "entertainment", label: "Entertainment" },
  { id: "sports", label: "Sports" },
  { id: "science", label: "Science" },
] as const;

function relTime(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function NewsScreen() {
  const [category, setCategory] = useState<string>("top");
  const qc = useQueryClient();
  // Axis: where you are standing by default, with a Home toggle for diaspora
  // users. Both hooks stay above every early return.
  const [region] = useCurrentRegion();
  const [home] = useCountry();
  const [useHome, setUseHome] = useState(false);
  const axisCountry = ((useHome ? home : region) ?? null) as Country | null;
  // Enforced server-side too — this only decides what to render.
  const unavailable = newsUnavailableReason(axisCountry);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["news", category, axisCountry],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("news", {
        body: { category, country: axisCountry },
      });
      if (error) throw error;
      return (data ?? { items: [] }) as {
        items: NewsItem[];
        error?: string;
        unavailable?: string;
      };
    },
    staleTime: 5 * 60 * 1000,
    enabled: !unavailable,
  });

  const items = data?.items ?? [];
  const softError = data?.error;
  // Either side may say no; the server's word wins.
  const blockedMessage = unavailable ?? data?.unavailable ?? null;

  // The first item is the lead story; the rest are headline rows. Not a hook.
  const [lead, ...more] = items;

  return (
    <OniqCanvas world="pulse" className="pb-8">
      <OniqHeader
        eyebrow="Pulse"
        title="Pulse 📰"
        subtitle="the timeline, but factual"
        back="/app"
        actions={
          <button
            type="button"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["news", category] });
              refetch();
            }}
            aria-label="Refresh"
            className="tap press grid h-10 w-10 place-items-center rounded-full oniq-glass text-foreground"
          >
            <RotateCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        }
      >
        {/* Category chips */}
        <OniqStoryRail ariaLabel="Categories" role="tablist">
          {CATEGORIES.map((c) => (
            <OniqChip
              key={c.id}
              role="tab"
              active={c.id === category}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </OniqChip>
          ))}
        </OniqStoryRail>
      </OniqHeader>

      {/* Content */}
      {blockedMessage ? (
        <div className="mt-5 px-5 rise rise-1">
          <OniqCard padding="lg" className="text-center">
            <Newspaper className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">{blockedMessage}</p>
            {!useHome && home && home !== region && (
              <button
                type="button"
                onClick={() => setUseHome(true)}
                className="press mt-4 rounded-full bg-world px-5 py-2 text-sm font-medium text-white world-glow"
              >
                Show {home} news instead
              </button>
            )}
          </OniqCard>
        </div>
      ) : (
        <div className="mt-5 px-5">
          {isLoading ? (
            <div aria-busy="true" aria-live="polite">
              <OniqSkeleton className="aspect-video w-full rounded-3xl" />
              <OniqSkeletonRows rows={4} className="mt-3" />
            </div>
          ) : error || (softError && items.length === 0) ? (
            <div role="alert" className="rounded-3xl oniq-surface p-6 text-center">
              <Newspaper
                className="mx-auto mb-2 h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                {softError ?? "Couldn't load the feed"}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="press mt-3 rounded-full bg-world px-5 py-2 text-sm font-medium text-white world-glow"
              >
                Retry
              </button>
            </div>
          ) : items.length === 0 ? (
            <OniqEmpty emoji="📰" title="nothing dropping rn — check back soon ✨" />
          ) : (
            <>
              {/* Lead story — the first item, its image only if the feed sent one */}
              {lead && (
                <button
                  type="button"
                  data-testid="news-item"
                  onClick={() => openInApp(lead.link)}
                  className="press block w-full overflow-hidden rounded-3xl oniq-surface text-start rise rise-1"
                >
                  {lead.image && (
                    <div className="relative aspect-video w-full overflow-hidden bg-surface-2">
                      <img
                        src={lead.image}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget.parentElement as HTMLElement).style.display = "none";
                        }}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="h-1 w-10 rounded-full bg-[var(--world-b)]" aria-hidden="true" />
                    <div className="mt-3 flex items-center gap-2 text-[11px]">
                      <span className="max-w-[60%] truncate font-semibold text-world">
                        {lead.source}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-normal normal-case text-muted-foreground">
                        {relTime(lead.publishedAt)}
                      </span>
                    </div>
                    <p
                      className="mt-2 line-clamp-4 font-display text-[20px] leading-tight normal-case text-foreground"
                      style={{ textWrap: "balance" }}
                    >
                      {lead.title}
                    </p>
                  </div>
                </button>
              )}

              {more.length > 0 && (
                <section className="mt-6 rise rise-2">
                  <OniqSectionHeader eyebrow="Pulse" title="More headlines" className="px-0" />
                  <div className="mt-3 grid gap-2">
                    {more.map((it, i) => (
                      <button
                        key={`${it.link}-${i + 1}`}
                        type="button"
                        data-testid="news-item"
                        onClick={() => openInApp(it.link)}
                        className="press flex w-full items-center gap-3 rounded-3xl oniq-surface p-3 text-start"
                      >
                        {it.image && (
                          <img
                            src={it.image}
                            alt=""
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                            className="h-16 w-16 shrink-0 rounded-2xl object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="max-w-[60%] truncate font-semibold text-world">
                              {it.source}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="font-normal normal-case text-muted-foreground">
                              {relTime(it.publishedAt)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-3 text-sm font-medium normal-case leading-snug text-foreground">
                            {it.title}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </OniqCanvas>
  );
}
