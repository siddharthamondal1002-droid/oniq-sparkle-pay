import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/chat/reels")({
  component: ReelsTab,
});

function useMinorFlag(): boolean | undefined {
  const { data } = useQuery({
    queryKey: ["is-minor"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data: p } = await supabase.from("profiles").select("is_minor").eq("id", u.user.id).maybeSingle();
      return !!p?.is_minor;
    },
    staleTime: 5 * 60_000,
  });
  return data;
}

type ClipRow = {
  id: string;
  user_id: string;
  video_url: string;
  caption: string | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  created_at: string;
};

const PAGE = 8;

function ReelsTab() {
  // DPDP Stage 0: minors get a non-personalized (chronological) feed.
  const minorFlag = useMinorFlag();

  const query = useInfiniteQuery({
    queryKey: ["clips-feed", minorFlag ? "chrono" : "ranked"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const rpc = minorFlag ? "clips_feed_chrono" : "clips_feed";
      const { data, error } = await supabase.rpc(rpc, {
        _limit: PAGE,
        _offset: pageParam as number,
      });
      if (error) throw error;
      return (data ?? []) as ClipRow[];
    },
    enabled: minorFlag !== undefined,
    getNextPageParam: (last, all) =>
      last.length === PAGE ? all.reduce((n, p) => n + p.length, 0) : undefined,
  });

  const clips = query.data?.pages.flat() ?? [];

  return (
    <div className="pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="px-5 pt-6">
        <h1 className="font-display text-3xl font-bold">Reels</h1>
        <p className="mt-1 text-sm text-muted-foreground">mast on tap 🎬</p>
      </div>

      {clips.length === 0 && !query.isLoading ? (
        <div className="mx-5 mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border p-10 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
            <Play className="h-5 w-5" />
          </div>
          <div className="font-display text-base font-semibold">No clips yet</div>
          <p className="text-xs text-muted-foreground">Be the first to post one.</p>
          <Link
            to="/app/clips"
            className="mt-2 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
          >
            Open Clips
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2 px-3">
          {clips.map((clip) => (
            <ClipThumb key={clip.id} clip={clip} />
          ))}
          {query.isLoading && (
            <div className="col-span-2 flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center px-5">
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
          >
            {query.isFetchingNextPage ? "loading…" : "load more"}
          </button>
        </div>
      )}
    </div>
  );
}

function ClipThumb({ clip }: { clip: ClipRow }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio > 0.4),
      { threshold: [0, 0.4, 0.9] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) void el.play().catch(() => {});
    else el.pause();
  }, [visible]);

  return (
    <Link
      to="/app/clips"
      hash={clip.id}
      className="press relative block aspect-[9/16] overflow-hidden rounded-2xl border border-border bg-black"
    >
      <video
        ref={ref}
        src={visible ? clip.video_url : undefined}
        muted
        loop
        playsInline
        preload={visible ? "metadata" : "none"}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] font-semibold text-white">
        <span className="drop-shadow">▶ {clip.view_count ?? 0}</span>
        <span className="drop-shadow">♥ {clip.like_count ?? 0}</span>
      </div>
    </Link>
  );
}
