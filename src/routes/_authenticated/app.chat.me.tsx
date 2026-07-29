import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, MessageCircle, Play, Eye, Pencil, X, Check, Film, Sparkles, Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AvatarEditorSheet } from "@/components/profile/AvatarEditorSheet";

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
  created_at: string | null;
};

type MyClip = {
  id: string;
  caption: string | null;
  video_url: string;
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

function MyPageTab() {
  const qc = useQueryClient();
  const [grid, setGrid] = useState<"moments" | "reels">("moments");
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);
  const [viewMoment, setViewMoment] = useState<MyMoment | null>(null);
  const [viewClip, setViewClip] = useState<MyClip | null>(null);
  const [editAvatar, setEditAvatar] = useState(false);

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

  const { data: moments = [] } = useQuery({
    queryKey: ["my-page-moments", me?.id],
    enabled: !!me?.id,
    queryFn: async (): Promise<MyMoment[]> => {
      const { data } = await supabase
        .from("moments_posts")
        .select("id, content, media_urls, like_count, comment_count, visibility, created_at")
        .eq("user_id", me!.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(90);
      return (data as MyMoment[]) ?? [];
    },
  });

  const { data: clips = [] } = useQuery({
    queryKey: ["my-page-clips", me?.id],
    enabled: !!me?.id,
    queryFn: async (): Promise<MyClip[]> => {
      const { data } = await supabase
        .from("clips")
        .select("id, caption, video_url, like_count, view_count, comment_count, created_at")
        .eq("user_id", me!.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(90);
      return (data as MyClip[]) ?? [];
    },
  });

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
    <div className="pb-6 pt-[max(1rem,env(safe-area-inset-top))]">
      {/* FB-style cover strip */}
      <div className="relative h-28 bg-gradient-to-br from-primary/40 via-fuchsia-500/30 to-amber-400/30">
        <div className="absolute inset-0 bg-[radial-gradient(80%_120%_at_20%_0%,rgba(255,255,255,0.12),transparent)]" />
      </div>

      {/* IG-style header */}
      <div className="px-5">
        <div className="-mt-12 flex items-end justify-between">
          {/* story-ring avatar — tap to change/remove the photo */}
          <button
            type="button"
            onClick={() => setEditAvatar(true)}
            aria-label="Edit profile photo"
            className="relative rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-primary p-[3px]"
          >
            <span className="block rounded-full bg-background p-[3px]">
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-primary to-accent font-display text-2xl font-bold text-primary-foreground">
                  {initial}
                </span>
              )}
            </span>
            <span className="absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground">
              <Camera className="h-3.5 w-3.5" />
            </span>
          </button>
          {/* IG-style stats */}
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
          {me?.username && <div className="text-xs text-muted-foreground">@{me.username}</div>}

          {/* status / bio */}
          {editingBio ? (
            <div className="mt-2">
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                maxLength={160}
                rows={2}
                autoFocus
                placeholder="drop your vibe… (160 chars)"
                className="w-full resize-none rounded-2xl border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                  className="press flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> save
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setBioDraft(me?.bio ?? "");
                setEditingBio(true);
              }}
              className="mt-2 flex w-full items-start gap-2 rounded-2xl border border-dashed border-border/70 bg-card/50 px-3 py-2 text-left"
            >
              <span className={`flex-1 text-sm ${me?.bio ? "text-foreground/90" : "italic text-muted-foreground"}`}>
                {me?.bio || "no status yet — tap to drop your vibe ✨"}
              </span>
              <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* TikTok-style content switcher */}
        <div className="mt-5 grid grid-cols-2 rounded-full border border-border bg-card p-1 text-center text-xs font-semibold">
          <button
            onClick={() => setGrid("moments")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition ${
              grid === "moments" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> my moments
          </button>
          <button
            onClick={() => setGrid("reels")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 transition ${
              grid === "reels" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            <Film className="h-3.5 w-3.5" /> my reels
          </button>
        </div>
      </div>

      {/* IG-style 3-column grid */}
      <div className="mt-3 px-1">
        {grid === "moments" ? (
          moments.length === 0 ? (
            <EmptyState label="no moments yet — post something iconic 🧊" />
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
          <EmptyState label="no reels yet — your main-character era awaits 🎬" />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {clips.map((c) => (
              <button
                key={c.id}
                onClick={() => setViewClip(c)}
                className="relative aspect-[3/4] overflow-hidden rounded-lg bg-black"
              >
                <video src={c.video_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                <Play className="absolute inset-0 m-auto h-6 w-6 text-white/90 drop-shadow" />
                <span className="absolute bottom-1 left-1.5 flex items-center gap-0.5 text-[10px] font-semibold text-white drop-shadow">
                  <Eye className="h-3 w-3" /> {c.view_count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

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
