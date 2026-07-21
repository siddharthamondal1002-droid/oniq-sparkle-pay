import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Heart, MessageCircle, Share2, Eye, Volume2, VolumeX,
  ChevronLeft, Plus, X, Send, Loader2, UserPlus, UserCheck, Flag, Trash2,
} from "lucide-react";
import { ReportSheet, type ReportTarget } from "@/components/safety/ReportSheet";

export const Route = createFileRoute("/_authenticated/app/clips")({
  component: ClipsScreen,
});

type Clip = {
  id: string;
  user_id: string;
  video_url: string;
  caption: string | null;
  hashtags: string[] | null;
  like_count: number;
  comment_count: number;
  view_count: number;
  is_deleted: boolean;
  created_at: string;
};

const PAGE = 5;
const HASHTAG_RE = /#([\p{L}\p{M}\p{N}_]{1,30})/gu;
const HASHTAG_STRIP_RE = /#[\p{L}\p{M}\p{N}_]+/gu;

function ClipsScreen() {
  const [muted, setMuted] = useState(true);
  const [me, setMe] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [openUpload, setOpenUpload] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const query = useInfiniteQuery({
    queryKey: ["clips-feed"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("clips_feed", {
        _limit: PAGE,
        _offset: pageParam as number,
      });
      if (error) throw error;
      return (data ?? []) as Clip[];
    },
    getNextPageParam: (last, all) =>
      last.length === PAGE ? all.reduce((n, p) => n + p.length, 0) : undefined,
  });

  const clips = query.data?.pages.flat() ?? [];

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link
          to="/app"
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="font-display text-base font-semibold drop-shadow">For You ✨</div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/40 backdrop-blur"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {clips.length === 0 && !query.isLoading ? (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-white/10">
            <Plus className="h-7 w-7" />
          </div>
          <p className="max-w-xs text-sm text-white/80">
            No clips yet — the feed is yours to start. Post the first one and be the moment.
          </p>
          <button
            onClick={() => setOpenUpload(true)}
            className="mt-6 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
          >
            Post a clip
          </button>
        </div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-scroll">
          {clips.map((clip, idx) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              muted={muted}
              me={me}
              isLast={idx === clips.length - 1}
              onLoadMore={() => {
                if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
              }}
              onOpenComments={() => setOpenComments(clip.id)}
              onReport={() => setReportTarget({ type: "clip", id: clip.id })}
              onDeleted={() => query.refetch()}
            />
          ))}
          {query.isFetchingNextPage && (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-white/60" />
            </div>
          )}
        </div>
      )}

      <button
        data-testid="upload-clip"
        onClick={() => setOpenUpload(true)}
        className="fixed right-5 z-[60] grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-2xl"
        style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
        aria-label="Upload clip"
      >
        <Plus className="h-6 w-6" />
      </button>


      {openComments && (
        <CommentsSheet
          clipId={openComments}
          me={me}
          onClose={() => setOpenComments(null)}
        />
      )}
      {openUpload && (
        <UploadSheet me={me} onClose={() => setOpenUpload(false)} onDone={() => query.refetch()} />
      )}
      {reportTarget && <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />}
    </div>
  );
}

function ClipCard({
  clip, muted, me, isLast, onLoadMore, onOpenComments, onReport, onDeleted,
}: {
  clip: Clip;
  muted: boolean;
  me: string | null;
  isLast: boolean;
  onLoadMore: () => void;
  onOpenComments: () => void;
  onReport: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewedRef = useRef(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(clip.like_count);
  const [viewCount, setViewCount] = useState(clip.view_count);

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
            vid.play().catch(() => {});
            if (!viewedRef.current) {
              viewedRef.current = true;
              supabase.rpc("record_clip_view", { _clip_id: clip.id }).then(({ error }) => {
                if (!error) setViewCount((v) => v + 1);
              });
            }
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
  }, [clip.id, isLast, onLoadMore]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const { data: following, refetch: refetchFollow } = useQuery({
    queryKey: ["follow", me, clip.user_id],
    enabled: !!me && me !== clip.user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("follows")
        .select("followee_id")
        .eq("follower_id", me!)
        .eq("followee_id", clip.user_id)
        .maybeSingle();
      return !!data;
    },
  });

  async function toggleFollow() {
    if (!me) return;
    if (following) {
      await supabase.from("follows").delete()
        .eq("follower_id", me).eq("followee_id", clip.user_id);
    } else {
      await supabase.from("follows").insert({ follower_id: me, followee_id: clip.user_id });
    }
    refetchFollow();
  }

  async function togglePlay() {
    // Reveal the shell nav on any tap of the video area (auto-hides on clips)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("oniq:clips-tap"));
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) await v.play().catch(() => {});
    else v.pause();
  }


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

  async function share() {
    const url = typeof window !== "undefined" ? `${window.location.origin}/app/clips#${clip.id}` : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "ONIQ Clip", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch { /* user cancelled */ }
  }

  const name = profile?.display_name ?? profile?.username ?? "user";
  const handle = profile?.username ?? "user";

  return (
    <div ref={sectionRef} data-testid="clip-card" className="relative h-full w-full snap-start">
      <video
        ref={videoRef}
        src={clip.video_url}
        loop
        playsInline
        muted={muted}
        preload="metadata"
        onClick={togglePlay}
        className="absolute inset-0 h-full w-full object-contain bg-black"
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

      <div className="absolute bottom-24 right-3 z-20 flex flex-col items-center gap-5">
        <button onClick={toggleLike} className="flex flex-col items-center gap-1" aria-label="Like">
          <Heart className={`h-7 w-7 ${liked ? "fill-red-500 text-red-500" : "text-white"}`} />
          <span className="text-xs">{likeCount}</span>
        </button>
        <button onClick={onOpenComments} className="flex flex-col items-center gap-1" aria-label="Comments">
          <MessageCircle className="h-7 w-7" />
          <span className="text-xs">{clip.comment_count}</span>
        </button>
        <button onClick={share} className="flex flex-col items-center gap-1" aria-label="Share">
          <Share2 className="h-7 w-7" />
          <span className="text-xs">Share</span>
        </button>
        <div className="flex flex-col items-center gap-1 text-white/80">
          <Eye className="h-6 w-6" />
          <span className="text-xs">{viewCount}</span>
        </div>
        {me === clip.user_id ? (
          <button
            onClick={async () => {
              if (!window.confirm("Delete this clip?")) return;
              // optimistic: yank from feed cache immediately
              qc.setQueriesData({ queryKey: ["clips-feed"] }, (old: any) => {
                if (!old?.pages) return old;
                return {
                  ...old,
                  pages: old.pages.map((p: Clip[]) => p.filter((c) => c.id !== clip.id)),
                };
              });
              const { error } = await supabase
                .from("clips")
                .update({ is_deleted: true })
                .eq("id", clip.id);
              if (error) {
                toast.error(error.message);
                onDeleted();
              } else {
                toast.success("Clip deleted");
              }
            }}
            className="flex flex-col items-center gap-1 text-white/70"
            aria-label="Delete clip"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={onReport} className="flex flex-col items-center gap-1 text-white/70" aria-label="Report clip">
            <Flag className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-6 z-20 px-4 pr-20">
        <div className="flex items-center gap-2">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" loading="lazy" decoding="async" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="text-sm font-semibold">@{handle}</div>
          {me && me !== clip.user_id && (
            <button
              onClick={toggleFollow}
              className={`ml-2 flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                following ? "border-white/40 text-white/80" : "border-white bg-white text-black"
              }`}
            >
              {following ? <UserCheck className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
              {following ? "Following" : "Follow"}
            </button>
          )}
        </div>
        {clip.caption && (
          <p className="mt-2 text-sm text-white/95 line-clamp-2">{clip.caption}</p>
        )}
        {clip.hashtags && clip.hashtags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-white/80">
            {clip.hashtags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentsSheet({
  clipId, me, onClose,
}: { clipId: string; me: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const { data: comments, refetch } = useQuery({
    queryKey: ["clip-comments", clipId],
    queryFn: async () => {
      const { data } = await supabase
        .from("clips_comments")
        .select("id, content, created_at, user_id, profiles:profiles!clips_comments_user_id_fkey(username, display_name, avatar_url)")
        .eq("clip_id", clipId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  async function send() {
    const val = text.trim();
    if (val.length < 1 || val.length > 500 || !me) return;
    setSending(true);
    const { error } = await supabase.from("clips_comments").insert({
      clip_id: clipId, user_id: me, content: val,
    });
    if (error) toast.error(error.message);
    else {
      setText("");
      qc.invalidateQueries({ queryKey: ["clip-comments", clipId] });
      qc.invalidateQueries({ queryKey: ["clips-feed"] });
      refetch();
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70" onClick={onClose}>
      <div
        className="max-h-[75vh] rounded-t-3xl border-t border-border bg-card p-5 text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Comments</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {comments?.length ? comments.map((c: any) => (
            <div key={c.id} className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
                {(c.profiles?.display_name ?? c.profiles?.username ?? "U").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 rounded-2xl bg-muted px-3 py-2">
                <div className="text-xs font-medium">
                  {c.profiles?.display_name ?? c.profiles?.username ?? "User"}
                </div>
                <div className="text-sm">{c.content}</div>
              </div>
            </div>
          )) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              First one to drop a comment sets the vibe.
            </p>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Add a comment…"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function probeDuration(file: File): Promise<number | null> {
  // Best-effort probe. Some devices/formats never fire loadedmetadata
  // (iOS quicktime, camera recordings without moov atom moved). We must NOT
  // block uploads on a failed probe — return null and let the server accept.
  return new Promise((resolve) => {
    let done = false;
    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch {}
      resolve(d);
    };
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : null;
      finish(d);
    };
    v.onerror = () => finish(null);
    v.src = url;
    setTimeout(() => finish(null), 3000);
  });
}

function UploadSheet({
  me, onClose, onDone,
}: { me: string | null; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "moots">(() => {
    if (typeof sessionStorage === "undefined") return "public";
    return (sessionStorage.getItem("oniq_post_visibility") as "public" | "moots") ?? "public";
  });
  const inputRef = useRef<HTMLInputElement | null>(null);


  const pick = useCallback(async (f: File | null) => {
    if (!f) return;
    const allowed = ["video/mp4", "video/webm", "video/quicktime"];
    if (!allowed.includes(f.type)) {
      toast.error("Only mp4, webm, or mov");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      toast.error("That video is too big — keep it under 100MB 📦");
      return;
    }
    const dur = await probeDuration(f);
    if (dur !== null && dur > 90) {
      toast.error("Max 90 seconds — this isn't YouTube 😌");
      return;
    }
    setFile(f);
  }, []);

  async function publish() {
    if (!file || !me) return;
    setBusy(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const path = `${me}/${crypto.randomUUID()}.${ext}`;

      const uploadPromise = supabase.storage
        .from("clips")
        .upload(path, file, { contentType: file.type, upsert: false });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("timeout")),
          120_000,
        );
      });

      const { error: upErr } = (await Promise.race([
        uploadPromise,
        timeoutPromise,
      ])) as Awaited<typeof uploadPromise>;
      clearTimeout(timeoutId);
      if (upErr) throw upErr;

      const { data: signed, error: sErr } = await supabase.storage
        .from("clips")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 100);
      if (sErr || !signed) throw sErr ?? new Error("Failed to sign URL");

      const tags = Array.from(caption.matchAll(HASHTAG_RE))
        .map((m) => m[1].toLowerCase())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 10);
      const cleaned = caption.replace(HASHTAG_STRIP_RE, "").trim().slice(0, 300);

      const { error: insErr } = await supabase.from("clips").insert({
        user_id: me,
        video_url: signed.signedUrl,
        caption: cleaned.length ? cleaned : null,
        hashtags: tags,
        visibility,
      });

      if (insErr) throw insErr;

      toast.success("Clip posted 🎬 it's giving content creator");
      onDone();
      onClose();
    } catch (err: any) {
      clearTimeout(timeoutId);
      const msg = String(err?.message ?? err ?? "").toLowerCase();
      const status = Number(err?.statusCode ?? err?.status ?? 0);
      if (msg === "timeout") {
        toast.error("Upload timed out — try again on stronger wifi 📶");
      } else if (
        status === 413 ||
        msg.includes("payload") ||
        msg.includes("too large") ||
        msg.includes("exceeded") ||
        msg.includes("maximum allowed size")
      ) {
        toast.error("That video is too big — keep it under 100MB 📦");
      } else if (msg.includes("mime")) {
        toast.error("Unsupported format — use mp4, webm, or mov 🎞️");
      } else {
        toast.error(err?.message ? `Upload failed — ${err.message}` : "Upload failed — try again 📶");
      }
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70" onClick={onClose}>
      <div
        className="max-h-[85vh] rounded-t-3xl border-t border-border bg-card p-5 text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Post a clip</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ""; pick(f); }}
        />

        {!file ? (
          <button
            onClick={() => inputRef.current?.click()}
            className="grid w-full place-items-center rounded-2xl border-2 border-dashed border-border py-14 text-sm text-muted-foreground"
          >
            <span>Tap to pick a video</span>
            <span className="mt-1 text-xs">mp4 · webm · mov · max 90s · 100MB</span>
          </button>
        ) : (
          <div className="rounded-2xl bg-muted p-3 text-sm">
            <div className="truncate font-medium">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {(file.size / (1024 * 1024)).toFixed(1)} MB · {file.type}
            </div>
            <button
              onClick={() => setFile(null)}
              className="mt-2 text-xs text-primary"
            >
              Choose another
            </button>
          </div>
        )}

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          placeholder="Caption + #hashtags…"
          className="mt-3 w-full resize-none rounded-2xl border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        <div className="mt-3">
          <div className="mb-1.5 text-xs text-muted-foreground">who can peep this? 👀</div>
          <div className="flex gap-2">
            {(["public", "moots"] as const).map((v) => {
              const active = visibility === v;
              const label = v === "public" ? "errbody 🌍" : "moots only 🤝";
              return (
                <button
                  key={v}
                  type="button"
                  data-testid={`clip-visibility-${v}`}
                  onClick={() => {
                    setVisibility(v);
                    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("oniq_post_visibility", v);
                  }}
                  className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>


        <button
          data-testid="publish-clip"
          onClick={publish}
          disabled={!file || busy}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Posting…" : "Publish"}
        </button>
        {busy && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Uploading… this can take a minute on mobile data
          </p>
        )}
      </div>
    </div>
  );
}
