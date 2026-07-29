import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Heart, MessageCircle, Eye, Play, X, Film, Sparkles } from "lucide-react";
import { ReelTile } from "@/components/reels/ReelTile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/u/$userId")({
  component: UserPage,
});

type PublicProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

type UserMoment = {
  id: string;
  content: string | null;
  media_urls: string[] | null;
  like_count: number | null;
  comment_count: number | null;
  visibility: string | null;
  created_at: string | null;
};

type UserClip = {
  id: string;
  caption: string | null;
  video_url: string;
  thumbnail_url: string | null;
  like_count: number;
  view_count: number;
  comment_count: number;
  created_at: string | null;
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|3gp|mkv)$/.test(url.split("?")[0].toLowerCase());
}
function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/.test(url.split("?")[0].toLowerCase());
}

function UserPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const [grid, setGrid] = useState<"moments" | "reels">("moments");
  const [viewMoment, setViewMoment] = useState<UserMoment | null>(null);
  const [viewClip, setViewClip] = useState<UserClip | null>(null);
  const [openingChat, setOpeningChat] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me-id"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const isMe = me === userId;

  const { data: profile, isLoading } = useQuery({
    queryKey: ["user-page-profile", userId],
    queryFn: async (): Promise<PublicProfile | null> => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio")
        .eq("id", userId)
        .maybeSingle();
      return (data as PublicProfile) ?? null;
    },
  });

  // RLS does the privacy work: moots-only posts only come back if the
  // viewer actually is a moot (or the owner).
  const { data: moments = [] } = useQuery({
    queryKey: ["user-page-moments", userId],
    queryFn: async (): Promise<UserMoment[]> => {
      const { data } = await supabase
        .from("moments_posts")
        .select("id, content, media_urls, like_count, comment_count, visibility, created_at")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(90);
      return (data as UserMoment[]) ?? [];
    },
  });

  const { data: clips = [] } = useQuery({
    queryKey: ["user-page-clips", userId, isMe],
    queryFn: async (): Promise<UserClip[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase as any)
        .from("clips")
        .select("id, caption, video_url, thumbnail_url, like_count, view_count, comment_count, created_at")
        .eq("user_id", userId)
        .eq("is_deleted", false);
      if (!isMe) q = q.eq("visibility", "public");
      const { data } = await q.order("created_at", { ascending: false }).limit(90);
      return (data as UserClip[]) ?? [];
    },
  });

  async function messageThem() {
    if (openingChat) return;
    setOpeningChat(true);
    const { data: id, error } = await supabase.rpc("find_or_create_direct_conversation", {
      other_user_id: userId,
    });
    setOpeningChat(false);
    if (error || !id) {
      toast.error(error?.message ?? "couldn't open chat");
      return;
    }
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id as string } });
  }

  const totalLikes =
    moments.reduce((a, m) => a + (m.like_count ?? 0), 0) +
    clips.reduce((a, c) => a + (c.like_count ?? 0), 0);
  const name = profile?.display_name ?? profile?.username ?? "user";
  const initial = name.charAt(0).toUpperCase();

  if (!isLoading && !profile) {
    return (
      <div className="px-5 pt-16 text-center">
        <div className="text-4xl">👻</div>
        <div className="mt-2 font-display text-lg font-bold">this page doesn't exist</div>
        <Link to="/app/chat" className="mt-3 inline-block text-sm text-primary">← back to chats</Link>
      </div>
    );
  }

  return (
    <div className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* FB-style cover with floating back button */}
      <div className="relative h-28 bg-gradient-to-br from-primary/40 via-fuchsia-500/30 to-amber-400/30">
        <div className="absolute inset-0 bg-[radial-gradient(80%_120%_at_20%_0%,rgba(255,255,255,0.12),transparent)]" />
        <button
          onClick={() => history.back()}
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] grid h-9 w-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5">
        <div className="-mt-12 flex items-end justify-between">
          <div className="rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-primary p-[3px]">
            <div className="rounded-full bg-background p-[3px]">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-primary to-accent font-display text-2xl font-bold text-primary-foreground">
                  {initial}
                </div>
              )}
            </div>
          </div>
          <div className="mb-1 flex flex-1 items-center justify-evenly pl-2 text-center">
            <div>
              <div className="font-display text-lg font-bold">{moments.length}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">moments</div>
            </div>
            <div>
              <div className="font-display text-lg font-bold">{clips.length}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">reels</div>
            </div>
            <div>
              <div className="font-display text-lg font-bold">{totalLikes}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">likes</div>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="font-display text-xl font-bold leading-tight">{name}</div>
          {profile?.username && <div className="text-xs text-muted-foreground">@{profile.username}</div>}
          {profile?.bio && <p className="mt-2 text-sm text-foreground/90">{profile.bio}</p>}
        </div>

        {!isMe ? (
          <button
            onClick={messageThem}
            disabled={openingChat}
            className="press mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" /> {openingChat ? "opening…" : "message 💬"}
          </button>
        ) : (
          <Link
            to="/app/chat/me"
            className="press mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-primary/50 py-2.5 text-sm font-semibold text-primary"
          >
            this is you — edit on My Page ✨
          </Link>
        )}

        <div className="mt-5 grid grid-cols-2 rounded-full border border-border bg-card p-1 text-center text-xs font-semibold">
          <button
            onClick={() => setGrid("moments")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition ${
              grid === "moments" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> moments
          </button>
          <button
            onClick={() => setGrid("reels")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition ${
              grid === "reels" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Film className="h-3.5 w-3.5" /> reels
          </button>
        </div>
      </div>

      <div className="mt-3 px-1">
        {grid === "moments" ? (
          moments.length === 0 ? (
            <EmptyState label="nothing to see here (yet) — moots-only posts stay hidden 🤝" />
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {moments.map((m) => {
                const media = m.media_urls?.[0];
                return (
                  <button
                    key={m.id}
                    onClick={() => setViewMoment(m)}
                    className="relative aspect-square overflow-hidden rounded-lg bg-card"
                  >
                    {media && !isAudioUrl(media) ? (
                      isVideoUrl(media) ? (
                        <>
                          <video src={media} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          <Play className="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
                        </>
                      ) : (
                        <img src={media} alt="" loading="lazy" className="h-full w-full object-cover" />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 to-fuchsia-500/15 p-2">
                        <span className="line-clamp-4 text-[10px] leading-snug text-foreground/85">
                          {media ? "🎧 audio" : m.content}
                        </span>
                      </div>
                    )}
                    {(m.like_count ?? 0) > 0 && (
                      <span className="absolute bottom-1 left-1.5 flex items-center gap-0.5 text-[10px] font-semibold text-white drop-shadow">
                        <Heart className="h-3 w-3 fill-current" /> {m.like_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : clips.length === 0 ? (
          <EmptyState label="no public reels yet 🎬" />
        ) : (
          <div className="grid grid-cols-3 gap-0.5">
            {clips.map((c) => (
              <ReelTile
                key={c.id}
                thumbnailUrl={c.thumbnail_url}
                videoUrl={c.video_url}
                viewCount={c.view_count}
                onClick={() => setViewClip(c)}
              />
            ))}
          </div>
        )}
      </div>

      {viewMoment && (
        <MediaViewer onClose={() => setViewMoment(null)}>
          {viewMoment.media_urls?.[0] &&
            (isVideoUrl(viewMoment.media_urls[0]) ? (
              <video src={viewMoment.media_urls[0]} controls autoPlay playsInline className="max-h-[60vh] w-full rounded-2xl bg-black object-contain" />
            ) : isAudioUrl(viewMoment.media_urls[0]) ? (
              <audio src={viewMoment.media_urls[0]} controls className="w-full" />
            ) : (
              <img src={viewMoment.media_urls[0]} alt="" className="max-h-[60vh] w-full rounded-2xl object-contain" />
            ))}
          {viewMoment.content && <p className="mt-3 whitespace-pre-wrap text-sm">{viewMoment.content}</p>}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {viewMoment.like_count ?? 0}</span>
            <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {viewMoment.comment_count ?? 0}</span>
            {viewMoment.visibility === "moots" && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">moots only 🤝</span>}
            {viewMoment.created_at && <span className="ml-auto">{new Date(viewMoment.created_at).toLocaleDateString()}</span>}
          </div>
        </MediaViewer>
      )}
      {viewClip && (
        <MediaViewer onClose={() => setViewClip(null)}>
          <video src={viewClip.video_url} controls autoPlay playsInline className="max-h-[65vh] w-full rounded-2xl bg-black object-contain" />
          {viewClip.caption && <p className="mt-3 whitespace-pre-wrap text-sm">{viewClip.caption}</p>}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" /> {viewClip.like_count}</span>
            <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {viewClip.view_count}</span>
            <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" /> {viewClip.comment_count}</span>
            {viewClip.created_at && <span className="ml-auto">{new Date(viewClip.created_at).toLocaleDateString()}</span>}
          </div>
        </MediaViewer>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="mx-4 mt-6 rounded-3xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function MediaViewer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-card p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
