import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, RotateCw, ChevronRight, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openInApp } from "@/lib/miniapps";
import { WatchLive } from "@/components/landing/LiveNewsSection";

export const Route = createFileRoute("/_authenticated/app/news")({
  validateSearch: (s: Record<string, unknown>) => ({
    tab: s.tab === "watch" ? ("watch" as const) : undefined,
  }),
  component: NewsScreen,
});

type NewsItem = { title: string; link: string; source: string; publishedAt: string; image?: string };

const CATEGORIES = [
  { id: "watch", label: "Watch 📺" },
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
  const { tab } = Route.useSearch();
  const [category, setCategory] = useState<string>(tab === "watch" ? "watch" : "top");
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["news", category],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("news", {
        body: { category },
      });
      if (error) throw error;
      return (data ?? { items: [] }) as { items: NewsItem[]; error?: string };
    },
    staleTime: 5 * 60 * 1000,
    enabled: category !== "watch",
  });

  const items = data?.items ?? [];
  const softError = data?.error;

  return (
    <div className="min-h-screen pb-6">
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Link to="/app" aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full bg-surface">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["news", category] });
              refetch();
            }}
            aria-label="Refresh"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface"
          >
            <RotateCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="mt-4">
          <div className="text-xs text-muted-foreground">the timeline, but factual</div>
          <h1 className="font-display text-3xl font-bold">Pulse 📰</h1>
        </div>

        {/* Category chips */}
        <div className="mt-5 -mx-5 overflow-x-auto scrollbar-none">
          <div className="flex gap-2 px-5 pb-1">
            {CATEGORIES.map((c) => {
              const active = c.id === category;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={`press whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-[0_0_16px_-4px_var(--primary)]"
                      : "bg-surface text-muted-foreground border-border hover:text-foreground"
                  }`}

                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        {category === "watch" ? (
          <div className="mt-5">
            <WatchLive />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface" />
              ))
            ) : error || (softError && items.length === 0) ? (
              <div className="rounded-2xl bg-surface p-6 text-center">
                <Newspaper className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{softError ?? "Couldn't load the feed"}</p>
                <button
                  onClick={() => refetch()}
                  className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
                >
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl bg-surface p-6 text-center">
                <p className="text-sm text-muted-foreground">nothing dropping rn — check back soon ✨</p>
              </div>
            ) : (
              items.map((it, i) => (
                <button
                  key={`${it.link}-${i}`}
                  data-testid="news-item"
                  onClick={() => openInApp(it.link)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-card border border-border p-4 text-left hover:bg-surface-2 transition-colors"
                >
                  {it.image && (
                    <img
                      src={it.image}
                      alt=""
                      loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      className="h-16 w-16 shrink-0 rounded-xl object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-medium text-primary truncate max-w-[60%]">{it.source}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{relTime(it.publishedAt)}</span>
                    </div>
                    <p className="mt-1 font-medium text-sm line-clamp-3">{it.title}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
