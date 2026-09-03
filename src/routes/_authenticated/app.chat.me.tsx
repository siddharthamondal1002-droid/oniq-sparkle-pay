import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Camera,
  Check,
  Eye,
  Film,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AvatarEditorSheet } from "@/components/profile/AvatarEditorSheet";
import { ViewersSheet } from "@/components/reels/ViewersSheet";
import { backfillClipThumb } from "@/lib/clipThumbs";
import { ReelTile, ReelTileSkeleton } from "@/components/reels/ReelTile";
import { ReelOwnerSheet } from "@/components/reels/ReelOwnerSheet";
import { removeStorageObjects } from "@/lib/storagePath";
import { OniqCanvas, OniqCard, OniqChip, OniqEmpty, OniqHeader } from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/chat/me")({
  component: MyPageTab,
});

type MyProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

type MyMoment = {
  id: string;
  content: string | null;
  media_urls: string[] | null;
  like_count: number | null;
  comment_count: number | null;
  visibility: string | null;
  is_synthetic: boolean | null;
  created_at: string | null;
};

type MyClip = {
  id: string;
  caption: string | null;
  video_url: string;
  thumbnail_url: string | null;
  hashtags: string[] | null;
  visibility: string;
  like_count: number;
  view_count: number;
  comment_count: number;
  is_synthetic: boolean | null;
  created_at: string | null;
};

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|3gp|mkv)$/.test(url.split("?")[0].toLowerCase());
}
function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/.test(url.split("?")[0].toLowerCase());
}

function MyPageTab() {
  const qc = useQueryClient();
  const [grid, setGrid] = useState<"moments" | "reels">("moments");
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [viewMoment, setViewMoment] = useState<MyMoment | null>(null);
  const [viewClip, setViewClip] = useState<MyClip | null>(null);
  const [viewersFor, setViewersFor] = useState<string | null>(null);
  const [editAvatar, setEditAvatar] = useState(false);
  const [ownReel, setOwnReel] = useState<MyClip | null>(null);

  const { data: me } = useQuery({
    queryKey: ["my-page-profile"],
    queryFn: async (): Promise<MyProfile | null> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, bio")
        .eq("id", u.user.id)
        .maybeSingle();
      return (data as MyProfile) ?? null;
    },
  });

  const {
    data: moments = [],
    isError: momentsError,
    refetch: refetchMoments,
  } = useQuery({
    queryKey: ["my-page-moments", me?.id],
    enabled: !!me?.id,
    queryFn: async (): Promise<MyMoment[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("moments_posts")
        .select(
          "id, content, media_urls, like_count, comment_count, visibility, is_synthetic, created_at",
        )
        .eq("user_id", me!.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(90);
      if (error) throw error;
      return (data as MyMoment[]) ?? [];
    },
  });

  const {
    data: clips = [],
    isLoading: clipsLoading,
    isError: clipsError,
    refetch: refetchClips,
  } = useQuery({
    queryKey: ["my-page-clips", me?.id],
    enabled: !!me?.id,
    queryFn: async (): Promise<MyClip[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("clips")
        .select(
          "id, caption, video_url, thumbnail_url, hashtags, visibility, is_synthetic, like_count, view_count, comment_count, created_at",
        )
        .eq("user_id", me!.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(90);
      if (error) throw error;
      return (data as MyClip[]) ?? [];
    },
  });

  // Lazy thumbnail backfill for older reels: heal up to 3 per visit, owner-only.
  const backfilling = useRef(false);
  useEffect(() => {
    if (!me?.id || backfilling.current) return;
    const missing = clips.filter((c) => !c.thumbnail_url).slice(0, 3);
    if (missing.length === 0) return;
    backfilling.current = true;
    (async () => {
      let healed = 0;
      for (const c of missing) {
        const url = await backfillClipThumb(me.id, c.id, c.video_url);
        if (url) healed += 1;
      }
      if (healed > 0) qc.invalidateQueries({ queryKey: ["my-page-clips"] });
    })();
  }, [clips, me?.id, qc]);

  const totalLikes =
    moments.reduce((a, m) => a + (m.like_count ?? 0), 0) +
    clips.reduce((a, c) => a + (c.like_count ?? 0), 0);

  async function saveBio() {
    if (!me) return;
    setSavingBio(true);
    const { error } = await supabase
      .from("profiles")
      .update({ bio: bioDraft.trim().slice(0, 160) || null })
      .eq("id", me.id);
    setSavingBio(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("vibe updated ✨");
    setEditingBio(false);
    qc.invalidateQueries({ queryKey: ["my-page-profile"] });
  }

  const name = me?.display_name ?? me?.username ?? "you";
  const initial = name.charAt(0).toUpperCase();

  return (
    <OniqCanvas world="chat" className="pb-6">
      <OniqHeader
        eyebrow="My Page"
        title={name}
        subtitle={me?.username ? `@${me.username}` : undefined}
        back={null}
      />

      {/* Cover + identity: the one card that carries the world's pair */}
      <div className="mt-4 px-5">
        <OniqCard variant="hero" padding="none" className="rise relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_20%_0%,rgba(255,255,255,0.18),transparent)]"
            aria-hidden="true"
          />
          <div className="relative flex items-center gap-4 p-4">
            {/* tap to change/remove the photo */}
            <button
              type="button"
              onClick={() => setEditAvatar(true)}
              aria-label="Edit profile photo"
              className="press relative shrink-0 rounded-full ring-[3px] ring-white/80"
            >
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <span className="grid h-20 w-20 place-items-center rounded-full bg-white/20 font-display text-2xl text-white">
                  {initial}
                </span>
              )}
              <span className="absolute -bottom-0.5 -end-0.5 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white ring-2 ring-white/70">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-evenly text-center text-white">
              <div>
                <div className="font-display text-[22px] leading-none">{moments.length}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-white/80">
                  moments
                </div>
              </div>
              <div>
                <div className="font-display text-[22px] leading-none">{clips.length}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-white/80">reels</div>
              </div>
              <div>
                <div className="font-display text-[22px] leading-none">{totalLikes}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-white/80">likes</div>
              </div>
            </div>
          </div>
        </OniqCard>
      </div>

      {/* status / bio */}
      <div className="mt-3 px-5">
        {editingBio ? (
          <OniqCard padding="sm" className="rise rise-1">
            <textarea
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              maxLength={160}
              rows={2}
              autoFocus
              placeholder="drop your vibe… (160 chars)"
              className="w-full resize-none rounded-2xl bg-surface-2 p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                onClick={() => setEditingBio(false)}
                className="press grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                onClick={saveBio}
                disabled={savingBio}
                className="press flex h-8 items-center gap-1 rounded-full bg-world px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> save
              </button>
            </div>
          </OniqCard>
        ) : (
          <button
            onClick={() => {
              setBioDraft(me?.bio ?? "");
              setEditingBio(true);
            }}
            className="press rise rise-1 flex w-full items-start gap-2 rounded-3xl border border-dashed border-border-strong bg-world-soft px-4 py-3 text-start"
          >
            <span
              className={`flex-1 text-sm ${me?.bio ? "text-foreground/90" : "italic text-muted-foreground"}`}
            >
              {me?.bio || "no status yet — tap to drop your vibe ✨"}
            </span>
            <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* content switcher */}
      <div className="mt-5 flex gap-2 px-5" role="tablist" aria-label="My content">
        <OniqChip
          role="tab"
          active={grid === "moments"}
          onClick={() => setGrid("moments")}
          className="min-h-10 flex-1 justify-center"
        >
          <Sparkles className="h-3.5 w-3.5" /> my moments
        </OniqChip>
        <OniqChip
          role="tab"
          active={grid === "reels"}
          onClick={() => setGrid("reels")}
          className="min-h-10 flex-1 justify-center"
        >
          <Film className="h-3.5 w-3.5" /> my reels
        </OniqChip>
      </div>

      {/* 3-column grid */}
      <div className="mt-3 px-3">
        {grid === "moments" ? (
          momentsError ? (
            <div role="alert" className="mx-2 rounded-3xl oniq-surface p-4 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground">
                <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
                <p>
                  Couldn't load your moments right now — a connection problem, not an empty profile.
                </p>
              </div>
              <button
                type="button"
                onClick={() => refetchMoments()}
                className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
              >
                <RotateCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : moments.length === 0 ? (
            <EmptyState label="no moments yet — post something iconic 🧊" />
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {moments.map((m) => {
                const media = m.media_urls?.[0];
                return (
                  <button
                    key={m.id}
                    onClick={() => setViewMoment(m)}
                    className="press relative aspect-square overflow-hidden rounded-xl bg-black"
                  >
                    {media && !isAudioUrl(media) ? (
                      isVideoUrl(media) ? (
                        <>
                          <video
                            src={media}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                          <Play className="absolute end-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
                        </>
                      ) : (
                        <img
                          src={media}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-world-soft p-2">
                        <span className="line-clamp-4 text-[11px] leading-snug text-foreground/85">
                          {media ? "🎧 audio" : m.content}
                        </span>
                      </div>
                    )}
                    {(m.like_count ?? 0) > 0 && (
                      <span className="absolute bottom-1 start-1.5 flex items-center gap-0.5 text-[11px] font-semibold text-white drop-shadow">
                        <Heart className="h-3 w-3 fill-current" /> {m.like_count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : clipsError ? (
          <div role="alert" className="mx-2 rounded-3xl oniq-surface p-4 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
              <p>
                Couldn't load your reels right now — a connection problem, not an empty profile.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetchClips()}
              className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : clipsLoading ? (
          <div className="grid grid-cols-3 gap-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <ReelTileSkeleton key={i} />
            ))}
          </div>
        ) : clips.length === 0 ? (
          <EmptyState label="no reels yet — create one 🎬 your main-character era awaits" />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {clips.map((c) => (
              <ReelTile
                key={c.id}
                thumbnailUrl={c.thumbnail_url}
                videoUrl={c.video_url}
                viewCount={c.view_count}
                onClick={() => setViewClip(c)}
                onLongPress={() => setOwnReel(c)}
                topRight={
                  <button
                    type="button"
                    onClick={() => setOwnReel(c)}
                    aria-label="Reel options"
                    className="grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>

      {ownReel && me?.id && (
        <ReelOwnerSheet
          clip={ownReel}
          meId={me.id}
          onClose={() => setOwnReel(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["my-page-clips"] })}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["my-page-clips"] })}
        />
      )}

      {editAvatar && (
        <AvatarEditorSheet
          currentUrl={me?.avatar_url ?? null}
          onClose={() => setEditAvatar(false)}
          onChanged={() => {
            setEditAvatar(false);
            qc.invalidateQueries({ queryKey: ["my-page-profile"] });
            qc.invalidateQueries({ queryKey: ["moments"] });
            qc.invalidateQueries({ queryKey: ["conversations"] });
          }}
        />
      )}

      {/* viewers */}
      {viewMoment && (
        <MediaViewer onClose={() => setViewMoment(null)}>
          {viewMoment.media_urls?.[0] &&
            (isVideoUrl(viewMoment.media_urls[0]) ? (
              <video
                src={viewMoment.media_urls[0]}
                controls
                autoPlay
                playsInline
                className="max-h-[60vh] w-full rounded-2xl bg-black object-contain"
              />
            ) : isAudioUrl(viewMoment.media_urls[0]) ? (
              <audio src={viewMoment.media_urls[0]} controls className="w-full" />
            ) : (
              <img
                src={viewMoment.media_urls[0]}
                alt=""
                className="max-h-[60vh] w-full rounded-2xl bg-black object-contain"
              />
            ))}
          {viewMoment.is_synthetic && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              AI-generated content 🤖
            </span>
          )}
          {viewMoment.content && (
            <p className="mt-3 whitespace-pre-wrap text-sm">{viewMoment.content}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" /> {viewMoment.like_count ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> {viewMoment.comment_count ?? 0}
            </span>
            {viewMoment.visibility === "moots" && (
              <span className="rounded-full bg-world-soft px-2 py-0.5 text-[11px] font-semibold text-world">
                moots only 🤝
              </span>
            )}
            {viewMoment.created_at && (
              <span className="ms-auto">
                {new Date(viewMoment.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <button
            onClick={async () => {
              if (!window.confirm("Delete this post?")) return;
              const { data: delRows, error } = await supabase
                .from("moments_posts")
                .update({ is_deleted: true })
                .eq("id", viewMoment.id)
                .select("id");
              if (error || !delRows || delRows.length === 0) {
                toast.error(error?.message || "couldn't delete — try again");
                return;
              }
              const failures = await removeStorageObjects(viewMoment.media_urls ?? []);
              if (failures > 0)
                toast.error("post removed, but some media files couldn't be cleaned up");
              else toast.success("Post deleted");
              setViewMoment(null);
              qc.invalidateQueries({ queryKey: ["my-page-moments"] });
              qc.invalidateQueries({ queryKey: ["moments"] });
            }}
            className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 py-2.5 text-sm font-semibold text-red-400 active:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" /> delete post
          </button>
        </MediaViewer>
      )}
      {viewersFor && (
        <ViewersSheet postType="reel" postId={viewersFor} onClose={() => setViewersFor(null)} />
      )}
      {viewClip && (
        <MediaViewer onClose={() => setViewClip(null)}>
          <video
            src={viewClip.video_url}
            controls
            autoPlay
            playsInline
            className="max-h-[65vh] w-full rounded-2xl bg-black object-contain"
          />
          {viewClip.is_synthetic && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              AI-generated content 🤖
            </span>
          )}
          {viewClip.caption && (
            <p className="mt-3 whitespace-pre-wrap text-sm">{viewClip.caption}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" /> {viewClip.like_count}
            </span>
            <button
              onClick={() => setViewersFor(viewClip.id)}
              role="button"
              aria-label="See who viewed"
              className="flex min-h-[32px] items-center gap-1 text-world active:opacity-70"
            >
              <Eye className="h-3.5 w-3.5" /> {viewClip.view_count}
            </button>
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5" /> {viewClip.comment_count}
            </span>
            {viewClip.created_at && (
              <span className="ms-auto">{new Date(viewClip.created_at).toLocaleDateString()}</span>
            )}
          </div>
        </MediaViewer>
      )}
    </OniqCanvas>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="mx-2 mt-2">
      <OniqEmpty title="Empty for now" body={label} />
    </div>
  );
}

function MediaViewer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl oniq-surface p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap grid h-8 w-8 place-items-center rounded-full bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
