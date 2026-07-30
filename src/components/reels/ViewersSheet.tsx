import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { X, Eye, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { PostType } from "@/lib/views";

type ViewerRow = {
  viewer_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  viewed_at: string;
  anonymous: boolean;
};

const PAGE = 30;

/**
 * Owner-only "seen by" list (post_viewers RPC enforces ownership and every
 * privacy rule server-side: blocked pairs omitted, minors + opted-out
 * viewers anonymised, symmetric anonymity for callers who hide their own
 * views). Paginates at 30; search once the list is long.
 */
export function ViewersSheet({
  postType,
  postId,
  onClose,
}: {
  postType: PostType;
  postId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const query = useInfiniteQuery({
    queryKey: ["post-viewers", postType, postId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ViewerRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("post_viewers", {
        _post_type: postType,
        _post_id: postId,
        _limit: PAGE,
        _offset: pageParam as number,
      });
      if (error) throw error;
      return (data ?? []) as ViewerRow[];
    },
    getNextPageParam: (last, all) =>
      last.length === PAGE ? all.reduce((n, p) => n + p.length, 0) : undefined,
  });

  const viewers = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return viewers;
    return viewers.filter(
      (v) =>
        !v.anonymous &&
        ((v.display_name ?? "").toLowerCase().includes(q) ||
          (v.username ?? "").toLowerCase().includes(q)),
    );
  }, [viewers, search]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[70dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold">
            <Eye className="h-4 w-4 text-primary" /> seen by{viewers.length ? ` · ${viewers.length}${query.hasNextPage ? "+" : ""}` : ""}
          </h3>
          <button onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {viewers.length > 12 && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-input/40 px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search viewers"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {query.isLoading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              couldn't load viewers
              <button onClick={() => query.refetch()} className="mx-auto mt-2 block rounded-full border border-border px-4 py-1.5 text-xs font-semibold">
                retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {search ? "no matches" : "No views yet — share it and watch this fill up ✨"}
            </div>
          ) : (
            filtered.map((v, i) => {
              if (v.anonymous || !v.viewer_id) {
                return (
                  <div key={`anon-${i}`} className="flex items-center gap-3 rounded-xl p-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-sm">🫥</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-muted-foreground">Someone</div>
                      <div className="text-[11px] text-muted-foreground/70">prefers to stay anonymous</div>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{relTime(v.viewed_at)}</span>
                  </div>
                );
              }
              const name = v.display_name ?? v.username ?? "user";
              return (
                <Link
                  key={v.viewer_id}
                  to="/app/u/$userId"
                  params={{ userId: v.viewer_id }}
                  onClick={onClose}
                  className="flex min-h-[44px] items-center gap-3 rounded-xl p-2 active:bg-muted hover:bg-muted"
                >
                  {v.avatar_url ? (
                    <img src={v.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-white">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{name}</div>
                    {v.username && <div className="truncate text-[11px] text-muted-foreground">@{v.username}</div>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{relTime(v.viewed_at)}</span>
                </Link>
              );
            })
          )}
          {query.hasNextPage && !search && (
            <button
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mx-auto mb-1 mt-2 block rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"
            >
              {query.isFetchingNextPage ? "loading…" : "show more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
