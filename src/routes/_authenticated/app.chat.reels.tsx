import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Volume2, VolumeX, Loader2, Play, X, Film } from "lucide-react";
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

const PAGE = 12;

function ReelsTab() {
  const minorFlag = useMinorFlag();
  const [me, setMe] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
  const openClip = openId ? clips.find((c) => c.id === openId) ?? null : null;

  if (clips.length === 0 && !query.isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-muted">
          <Play className="h-6 w-6" />
        </div>
        <div className="font-display text-base font-semibold">No clips yet</div>
        <p className="max-w-xs text-xs text-muted-foreground">Be the first to post one.</p>
      </div>
    );
  }

  return (
    <div className="px-1 pb-6 pt-2">
      <div className="grid grid-cols-3 gap-1">
        {clips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            onClick={() => setOpenId(clip.id)}
            className="relative aspect-square overflow-hidden rounded-md bg-black"
            aria-label="Open clip"
          >
            <video
              src={clip.video_url}
              muted
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/10" />
            <Film className="absolute right-1 top-1 h-3.5 w-3.5 text-white drop-shadow" />
            {clip.like_count > 0 && (
              <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                <Heart className="h-3 w-3 fill-current" />
                {clip.like_count}
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center">
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            {query.isFetchingNextPage ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Load more"
            )}
          </button>
        )}
      </div>

      {openClip && (
        <ClipViewer clip={openClip} me={me} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ClipViewer({
  clip,
  me,
  onClose,
}: {
  clip: ClipRow;
  me: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { register } = useMediaCoordinator();
  const [muted, setMuted] = useState(false);
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
    const v = videoRef.current;
    if (!v) return;
    register(v);
    v.muted = muted;
    v.play().catch(() => {});
  }, [register, muted]);

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
    <div
      className="fixed inset-0 z-[60] bg-black text-white"
      onClick={onClose}
    >
      <video
        ref={videoRef}
        src={clip.video_url}
        loop
        playsInline
        muted={muted}
        preload="auto"
        onClick={(e) => { e.stopPropagation(); tapVideo(); }}
        className="absolute inset-0 h-full w-full object-contain"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute left-3 top-[max(1rem,env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
        className="absolute right-3 top-[max(1rem,env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full bg-black/50 backdrop-blur"
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      <div className="absolute bottom-6 right-3 z-20 flex flex-col items-center gap-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={toggleLike} className="flex flex-col items-center gap-1" aria-label="Like">
          <Heart className={`h-7 w-7 ${liked ? "fill-red-500 text-red-500" : "text-white"}`} />
          <span className="text-xs">{likeCount}</span>
        </button>
        <div className="flex flex-col items-center gap-1 text-white/90">
          <MessageCircle className="h-7 w-7" />
          <span className="text-xs">{clip.comment_count}</span>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-6 z-20 px-4 pr-20" onClick={(e) => e.stopPropagation()}>
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
