import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Volume2, VolumeX, Loader2, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMediaCoordinator } from "@/lib/MediaProvider";

export const Route = createFileRoute("/_authenticated/app/chat/reels")({
  component: ReelsTab,
});

function useMinorFlag(): boolean | undefined {
  const { data } = useQuery({
    queryKey: ["is-minor"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data: priv } = await supabase.rpc("get_my_profile_private");
      const row = Array.isArray(priv) ? priv[0] : priv;
      return !!row?.is_minor;
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

const PAGE = 6;

function ReelsTab() {
  const minorFlag = useMinorFlag();
  const [muted, setMuted] = useState(true);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

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

  if (clips.length === 0 && !query.isLoading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted">
          <Play className="h-6 w-6" />
        </div>
        <div className="font-display text-base font-semibold">No clips yet</div>
        <p className="max-w-xs text-xs text-muted-foreground">Be the first to post one.</p>
        <Link
          to="/app/clips"
          className="mt-2 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
        >
          Post a clip
        </Link>
      </div>
    );
  }

  return (
    <div className="relative -mx-0 h-[calc(100dvh-5.5rem)] w-full overflow-hidden bg-black text-white">
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className="absolute right-3 top-[max(1rem,env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur"
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      <Link
        to="/app/clips"
        className="absolute left-3 top-[max(1rem,env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur"
        aria-label="Post a clip"
      >
        <Plus className="h-5 w-5" />
      </Link>

      <div className="h-full snap-y snap-mandatory overflow-y-scroll">
        {clips.map((clip, idx) => (
          <ReelCard
            key={clip.id}
            clip={clip}
            me={me}
            muted={muted}
            isLast={idx === clips.length - 1}
            onLoadMore={() => {
              if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
            }}
          />
        ))}
        {query.isFetchingNextPage && (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white/60" />
          </div>
        )}
      </div>
    </div>
  );
}

function ReelCard({
  clip,
  me,
  muted,
  isLast,
  onLoadMore,
}: {
  clip: ClipRow;
  me: string | null;
  muted: boolean;
  isLast: boolean;
  onLoadMore: () => void;
}) {
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { register } = useMediaCoordinator();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(clip.like_count);

  const { data: profile } = useQuery({
    queryKey: ["clip-author", clip.user_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", clip.user_id)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!me) return;
    supabase
      .from("clips_likes")
      .select("clip_id")
      .eq("clip_id", clip.id)
      .eq("user_id", me)
      .maybeSingle()
      .then(({ data }) => setLiked(!!data));
  }, [me, clip.id]);

  useEffect(() => {
    const el = sectionRef.current;
    const vid = videoRef.current;
    if (!el || !vid) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            register(vid);
            vid.play().catch(() => {});
            if (isLast) onLoadMore();
          } else {
            vid.pause();
          }
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [clip.id, isLast, onLoadMore, register]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  async function toggleLike() {
    const prevLiked = liked;
    const prevCount = likeCount;
    setLiked(!prevLiked);
    setLikeCount(prevCount + (prevLiked ? -1 : 1));
    const { error } = await supabase.rpc("toggle_clip_like", { _clip_id: clip.id });
    if (error) {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      toast.error(error.message);
    } else {
      qc.invalidateQueries({ queryKey: ["clips-feed"] });
    }
  }

  function tapVideo() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  const name = profile?.display_name ?? profile?.username ?? "user";
  const handle = profile?.username ?? "user";

  return (
    <div ref={sectionRef} className="relative h-full w-full snap-start">
      <video
        ref={videoRef}
        src={clip.video_url}
        loop
        playsInline
        muted={muted}
        preload="metadata"
        onClick={tapVideo}
        className="absolute inset-0 h-full w-full bg-black object-contain"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

      <div className="absolute bottom-6 right-3 z-20 flex flex-col items-center gap-5">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1" aria-label="Like">
          <Heart className={`h-7 w-7 ${liked ? "fill-red-500 text-red-500" : "text-white"}`} />
          <span className="text-xs">{likeCount}</span>
        </button>
        <div className="flex flex-col items-center gap-1 text-white/90">
          <MessageCircle className="h-7 w-7" />
          <span className="text-xs">{clip.comment_count}</span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-6 z-20 px-4 pr-20">
        <div className="flex items-center gap-2">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-sm font-semibold">@{handle}</div>
        </div>
        {clip.caption && (
          <p className="mt-2 text-sm text-white/95 line-clamp-2">{clip.caption}</p>
        )}
      </div>
    </div>
  );
}
