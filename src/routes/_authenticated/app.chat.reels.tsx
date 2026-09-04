import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Heart,
  MessageCircle,
  Volume2,
  VolumeX,
  Loader2,
  Plus,
  MoreHorizontal,
  RotateCw,
  Share2,
  Eye,
} from "lucide-react";
import type { SharePayload } from "@/lib/share";
import { ShareSheet } from "@/components/share/ShareSheet";
import { ViewersSheet } from "@/components/reels/ViewersSheet";
import { ReelVideo } from "@/components/reels/ReelVideo";
import { watchVideoView } from "@/lib/views";
import { ReelOwnerSheet } from "@/components/reels/ReelOwnerSheet";
import { toast } from "sonner";
import { useMediaCoordinator } from "@/lib/MediaProvider";
import { OniqCanvas, OniqEmpty } from "@/components/oniq";

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

/** Glass chrome floating over the video: small, dark, legible in both themes. */
const PILL =
  "press grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/15 backdrop-blur-md";
/** The end-side action rail: an icon well plus a label under it. */
const RAIL_WELL =
  "grid h-11 w-11 place-items-center rounded-full bg-black/35 ring-1 ring-white/15 backdrop-blur-sm";
const RAIL_LABEL = "text-[11px] font-semibold text-white drop-shadow";

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

  if (query.isError) {
    return (
      <OniqCanvas world="mast" className="grid place-items-center px-5 py-10">
        <div role="alert" className="w-full max-w-sm rounded-3xl oniq-surface p-6 text-center">
          <div
            className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-world text-on-world world-glow"
            aria-hidden="true"
          >
            <AlertCircle className="h-6 w-6" />
          </div>
          <div className="mt-3 font-display text-[15px] text-foreground">
            Couldn't load the feed
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            A connection problem, not an empty feed.
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="press mt-4 inline-flex items-center gap-1.5 rounded-full bg-world px-5 py-2 text-xs font-semibold text-on-world world-glow"
          >
            <RotateCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </OniqCanvas>
    );
  }

  if (clips.length === 0 && !query.isLoading) {
    return (
      <OniqCanvas world="mast" className="grid place-items-center px-5 py-10">
        <OniqEmpty
          className="w-full max-w-sm"
          emoji="🎬"
          title="No clips yet"
          body="Be the first to post one."
          action={
            <Link
              to="/app/clips"
              className="press rounded-full bg-world px-5 py-2 text-xs font-semibold text-on-world world-glow"
            >
              Post a clip
            </Link>
          }
        />
      </OniqCanvas>
    );
  }

  return (
    <div
      data-world="mast"
      className="relative w-full overflow-hidden bg-black text-white"
      // Full bleed under the status bar — same reasoning as app.clips.tsx: the
      // shell pads <main> by the top inset for ordinary screens, and a video
      // surface is not one. The overlays below reserve the inset themselves.
      style={{ height: "100dvh", marginTop: "calc(-1 * env(safe-area-inset-top))" }}
    >
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className={`absolute end-3 top-[max(1rem,env(safe-area-inset-top))] z-30 ${PILL}`}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      <Link
        to="/app/clips"
        className={`absolute start-3 top-[max(1rem,env(safe-area-inset-top))] z-30 ${PILL}`}
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
    const stopWatch = watchVideoView(vid, "reel", clip.id, clip.user_id, me);
    return () => {
      io.disconnect();
      stopWatch();
    };
  }, [clip.id, clip.user_id, me, isLast, onLoadMore, register]);

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

  const [ownerSheet, setOwnerSheet] = useState<null | {
    id: string;
    video_url: string;
    thumbnail_url: string | null;
    caption: string | null;
    hashtags: string[] | null;
    visibility: string;
  }>(null);
  const [shareSheet, setShareSheet] = useState<SharePayload | null>(null);
  const [showViewers, setShowViewers] = useState(false);

  async function share() {
    const payload: SharePayload = {
      title: "ONIQ Reel 🎬",
      text: clip.caption ?? undefined,
      url: `https://oniqhub.com/r/${clip.id}`,
    };
    setShareSheet(payload);
  }

  async function openOwnerSheet() {
    // The feed RPC doesn't carry hashtags/visibility/thumbnail — fetch the
    // full row (owner SELECT allowed by RLS) before opening the sheet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("clips")
      .select("id, video_url, thumbnail_url, caption, hashtags, visibility")
      .eq("id", clip.id)
      .maybeSingle();
    if (error || !data) {
      toast.error("couldn't load reel options");
      return;
    }
    setOwnerSheet(data);
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
      <ReelVideo src={clip.video_url} muted={muted} videoRef={videoRef} onClick={tapVideo} />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {/* action rail */}
      <div className="absolute bottom-[calc(6.5rem+env(safe-area-inset-bottom))] end-3 z-20 flex flex-col items-center gap-4">
        <button
          onClick={toggleLike}
          className="press flex flex-col items-center gap-1"
          aria-label={liked ? "Unlike" : "Like"}
        >
          <span className={RAIL_WELL}>
            <Heart className={`h-6 w-6 ${liked ? "fill-red-500 text-red-500" : "text-white"}`} />
          </span>
          <span className={RAIL_LABEL}>{likeCount}</span>
        </button>
        <div className="flex flex-col items-center gap-1 text-white/90">
          <span className={RAIL_WELL}>
            <MessageCircle className="h-6 w-6" />
          </span>
          <span className={RAIL_LABEL}>{clip.comment_count}</span>
        </div>
        <button
          onClick={share}
          className="press flex flex-col items-center gap-1 text-white"
          aria-label="Share"
        >
          <span className={RAIL_WELL}>
            <Share2 className="h-6 w-6" />
          </span>
          <span className={RAIL_LABEL}>Share</span>
        </button>
        {me === clip.user_id ? (
          <button
            onClick={() => setShowViewers(true)}
            className="press flex flex-col items-center gap-1 text-white"
            aria-label="See who viewed"
          >
            <span className={RAIL_WELL}>
              <Eye className="h-5 w-5" />
            </span>
            <span className={RAIL_LABEL}>{clip.view_count}</span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1 text-white/80">
            <span className={RAIL_WELL}>
              <Eye className="h-5 w-5" />
            </span>
            <span className={RAIL_LABEL}>{clip.view_count}</span>
          </div>
        )}
        {me === clip.user_id && (
          <button
            onClick={openOwnerSheet}
            className="press flex flex-col items-center gap-1 text-white"
            aria-label="Reel options"
          >
            <span className={RAIL_WELL}>
              <MoreHorizontal className="h-6 w-6" />
            </span>
          </button>
        )}
      </div>

      {/* author row */}
      <div className="absolute inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-20 pe-20 ps-4">
        {/* tap the author to visit their page */}
        <Link
          to="/app/u/$userId"
          params={{ userId: clip.user_id }}
          className="press inline-flex items-center gap-2"
          aria-label={`View @${handle}'s page`}
        >
          <span className="isolate shrink-0 rounded-full bg-world p-[2px]">
            <span className="block rounded-full bg-black/40 p-[2px]">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full bg-world text-sm font-bold text-on-world">
                  {name.charAt(0).toUpperCase()}
                </span>
              )}
            </span>
          </span>
          <span className="font-display text-[15px] text-white drop-shadow">@{handle}</span>
        </Link>
        {clip.caption && (
          <p className="mt-2 text-sm leading-snug text-white/95 drop-shadow line-clamp-2">
            {clip.caption}
          </p>
        )}
      </div>

      {shareSheet && (
        <ShareSheet
          payload={shareSheet}
          reel={{ id: clip.id, videoUrl: clip.video_url }}
          onClose={() => setShareSheet(null)}
        />
      )}
      {showViewers && (
        <ViewersSheet postType="reel" postId={clip.id} onClose={() => setShowViewers(false)} />
      )}
      {ownerSheet && me && (
        <ReelOwnerSheet
          clip={ownerSheet}
          meId={me}
          onClose={() => setOwnerSheet(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["clips-feed"] });
            qc.invalidateQueries({ queryKey: ["my-page-clips"] });
          }}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["clips-feed"] });
            qc.invalidateQueries({ queryKey: ["my-page-clips"] });
          }}
        />
      )}
    </div>
  );
}
