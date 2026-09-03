import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Heart,
  MessageCircle,
  Image as ImageIcon,
  Globe,
  Send,
  X,
  Loader2,
  Trash2,
  Flag,
  Pencil,
  RotateCw,
  Share2,
  Eye,
} from "lucide-react";
import { ReportSheet, type ReportTarget } from "@/components/safety/ReportSheet";
import {
  AttachmentSheet,
  useAttachmentContext,
  type AttachmentOption,
} from "@/components/attach/AttachmentSheet";
import type { SharePayload } from "@/lib/share";
import { watchImageView } from "@/lib/views";
import { ViewersSheet } from "@/components/reels/ViewersSheet";
import { ShareSheet } from "@/components/share/ShareSheet";
import { PhotoStudio } from "@/components/photo/PhotoStudioLazy";
import { detectSelfHarmSignal } from "@/lib/selfHarm";
import { sha256Hex, recordProvenance, scanProvenance } from "@/lib/provenance";
import { CrisisSupportSheet } from "@/components/safety/CrisisSupportSheet";
import { removeStorageObjects, parseStorageRef } from "@/lib/storagePath";
import { formatDistanceToNow } from "date-fns";
import { OniqCard, OniqChip, OniqEmpty } from "@/components/oniq";

type Post = {
  id: string;
  content: string | null;
  media_urls: string[] | null;
  like_count: number | null;
  comment_count: number | null;
  view_count?: number | null;
  created_at: string | null;
  user_id: string;
  visibility: string | null;
  is_synthetic: boolean | null;
  profiles: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

function isImageUrl(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  return !/\.(mp4|webm|mov|m4v|3gp|mkv|mp3|m4a|aac|ogg|opus|wav|flac)$/.test(path);
}

// Upload a moment attachment to storage and return a long-lived signed URL.
// Exported for reuse (e.g. profile-photo uploads share this bucket + pattern).
export async function uploadMomentBlob(
  blob: Blob,
  ext: string,
  contentType: string,
  bucket = "moments",
): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Not signed in");
  const path = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { cacheControl: "3600", upsert: false, contentType });
  if (upErr) {
    // Never surface a raw RLS/Postgres error to the composer.
    if (/row-level security|violates/i.test(upErr.message ?? "")) {
      throw new Error("that file type isn't allowed here yet");
    }
    throw new Error(upErr.message || "upload failed");
  }
  const { data: signed, error: sErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 100);
  if (sErr || !signed) throw sErr ?? new Error("Failed to sign URL");
  return signed.signedUrl;
}

// Storage bucket policies are extension-allowlisted per bucket. Route each
// moment attachment to a bucket that accepts it (signed URLs work the same
// from any private bucket):
//   images -> moments · video -> clips · audio -> chat-media
export function routeMomentFile(file: File): { bucket: string; ext: string } {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (file.type.startsWith("image/")) {
    const ok = ["jpg", "jpeg", "png", "webp", "gif"];
    return { bucket: "moments", ext: ok.includes(ext) ? ext : "jpg" };
  }
  if (file.type.startsWith("video/")) {
    const map: Record<string, string> = { mp4: "mp4", webm: "webm", mov: "mov", quicktime: "mov" };
    const e =
      map[ext] ??
      (file.type === "video/quicktime"
        ? "mov"
        : file.type === "video/webm"
          ? "webm"
          : ext === ""
            ? "mp4"
            : ext);
    if (!["mp4", "webm", "mov"].includes(e)) {
      throw new Error("that video format isn't supported — use mp4, webm or mov 🎬");
    }
    return { bucket: "clips", ext: e };
  }
  if (file.type.startsWith("audio/")) {
    const ok = ["m4a", "mp3", "ogg", "wav", "webm"];
    if (!ok.includes(ext)) {
      throw new Error("that audio format isn't supported — use mp3, m4a, ogg or wav 🎧");
    }
    return { bucket: "chat-media", ext };
  }
  throw new Error("Choose a photo, video, or audio file");
}

// Rotate an already-uploaded image 90° clockwise and re-upload it.
async function rotateUploadedImage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("couldn't load the photo");
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.height;
  canvas.height = bmp.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  const out: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("rotate failed"))), "image/jpeg", 0.92),
  );
  return uploadMomentBlob(out, "jpg", "image/jpeg");
}

/** A round icon button on a card: 48dp hit area, no chrome until hover. */
const ICON_BTN =
  "tap grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2";
/** One action in a post's footer row. */
const ACTION_BTN =
  "press flex items-center gap-1.5 rounded-full px-3 py-2 text-xs transition-colors hover:bg-surface-2";

export function MomentsFeed() {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [editTarget, setEditTarget] = useState<Post | null>(null);
  const [visibility, setVisibility] = useState<"public" | "moots">(() => {
    if (typeof sessionStorage === "undefined") return "public";
    return (sessionStorage.getItem("oniq_post_visibility") as "public" | "moots") ?? "public";
  });

  const [studioFile, setStudioFile] = useState<File | null>(null);
  // IT Rules 2026: mandatory synthetic-content declaration at upload.
  const [isSynthetic, setIsSynthetic] = useState(false);
  // "confirmed" provenance (ONIQ-generated media) locks the declaration on.
  const [syntheticLocked, setSyntheticLocked] = useState(false);
  // L4 care-first: on-device signal only; never blocks or reports.
  const [showCrisis, setShowCrisis] = useState(false);
  const [shareSheet, setShareSheet] = useState<SharePayload | null>(null);
  const [viewersFor, setViewersFor] = useState<string | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const attachCtx = useAttachmentContext();

  // Unified attachment sheet -> the existing single-file moment pipeline.
  async function handleSheetFiles(_opt: AttachmentOption, files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Keep it under 50MB for now — longer videos coming soon 🎬");
      return;
    }
    if (file.type.startsWith("image/")) {
      setStudioFile(file);
      return;
    }
    if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      await uploadPicked(file);
      return;
    }
    toast.error("Choose a photo, video, or audio file");
  }

  async function sharePost(p: Post) {
    const payload: SharePayload = {
      title: "ONIQ Moment ✨",
      text: p.content ?? undefined,
      url:
        typeof window !== "undefined"
          ? `${window.location.origin}/app/chat/moments#post-${p.id}`
          : "",
    };
    setShareSheet(payload);
  }

  async function uploadPicked(file: File) {
    setUploading(true);
    try {
      const { bucket, ext } = routeMomentFile(file);
      const url = await uploadMomentBlob(file, ext, file.type, bucket);
      setImageUrl(url);
      // B4 provenance: hash of uploaded bytes (content_id linked on post).
      void sha256Hex(file).then((hash) => recordProvenance({ contentType: "moment", hash }));
      // P4: read Content Credentials server-side; pre-tick when found.
      const ref = parseStorageRef(url);
      if (ref) {
        void scanProvenance({ bucket: ref.bucket, path: ref.path, contentType: "moment" }).then(
          (r) => {
            if (r.verdict === "confirmed") {
              setIsSynthetic(true);
              setSyntheticLocked(true);
              toast("AI content credentials verified — label applied 🤖");
            } else if (r.verdict === "likely" || r.verdict === "possible") {
              setIsSynthetic(true);
              toast(
                "this file carries AI-generation credentials — label pre-applied (untick if that's wrong)",
              );
            }
          },
        );
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const kind = file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : null;
    if (!kind) {
      toast.error("Choose a photo, video, or audio file");
      return;
    }
    // Storage platform caps a single upload at 50MB on the current plan.
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Keep it under 50MB for now — longer videos coming soon 🎬");
      return;
    }
    // Photos pass through PhotoStudio; video/audio upload directly.
    if (kind === "image") {
      setStudioFile(file);
      return;
    }
    await uploadPicked(file);
  }

  async function rotatePreview() {
    if (!imageUrl || uploading) return;
    setUploading(true);
    try {
      setImageUrl(await rotateUploadedImage(imageUrl));
    } catch (err: any) {
      toast.error(err.message ?? "couldn't rotate — try re-uploading");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const {
    data: posts,
    isError: postsError,
    refetch,
  } = useQuery({
    queryKey: ["moments"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("moments_posts")
        .select(
          "id, content, media_urls, like_count, comment_count, view_count, created_at, user_id, visibility, is_synthetic, profiles:profiles!moments_posts_user_id_fkey(display_name, username, avatar_url)",
        )
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(50);
      // Throw so a failed read shows a retry, not "No moments yet".
      if (error) throw error;
      return (data ?? []) as unknown as Post[];
    },
  });

  useEffect(() => {
    if (!me || !posts?.length) return;
    supabase
      .from("moments_likes")
      .select("post_id")
      .eq("user_id", me)
      .in(
        "post_id",
        posts.map((p) => p.id),
      )
      .then(({ data }) => setLikedIds(new Set((data ?? []).map((r) => r.post_id))));
  }, [me, posts]);

  useEffect(() => {
    const ch = supabase
      .channel("moments-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "moments_posts" }, () =>
        refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refetch]);

  async function post() {
    if (!content.trim() && !imageUrl.trim()) return;
    setPosting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      // Session lapsed mid-compose — clear the spinner so the composer isn't
      // stuck disabled with no feedback.
      setPosting(false);
      return;
    }
    const media = imageUrl.trim() ? [imageUrl.trim()] : [];
    const { error } = await supabase.from("moments_posts").insert({
      user_id: u.user.id,
      content: content.trim(),
      media_urls: media,
      visibility,
      is_synthetic: isSynthetic,
    } as never);

    if (error) toast.error(error.message);
    else {
      toast.success("Posted to Moments");
      if (detectSelfHarmSignal(content)) setShowCrisis(true);
      setContent("");
      setImageUrl("");
      setIsSynthetic(false);
      refetch();
    }
    setPosting(false);
  }

  async function toggleLike(postId: string) {
    const wasLiked = likedIds.has(postId);
    setLikedIds((prev) => {
      const n = new Set(prev);
      if (wasLiked) n.delete(postId);
      else n.add(postId);
      return n;
    });
    qc.setQueryData(["moments"], (old: any) =>
      old?.map((p: any) =>
        p.id === postId
          ? { ...p, like_count: Math.max(0, (p.like_count ?? 0) + (wasLiked ? -1 : 1)) }
          : p,
      ),
    );
    const { error } = await supabase.rpc("toggle_moment_like", { _post_id: postId });
    if (error) {
      toast.error(error.message);
      refetch();
    }
  }

  async function deletePost(postId: string) {
    if (!window.confirm("Delete post?")) return;
    const prev = qc.getQueryData(["moments"]) as Post[] | undefined;
    const target = prev?.find((p) => p.id === postId);
    qc.setQueryData(["moments"], (old: any) => old?.filter((p: any) => p.id !== postId));
    const { data: delRows, error } = await supabase
      .from("moments_posts")
      .update({ is_deleted: true })
      .eq("id", postId)
      .select("id");
    // A 0-row update means RLS refused it — report it, don't fake success.
    if (error || !delRows || delRows.length === 0) {
      qc.setQueryData(["moments"], prev);
      toast.error(error?.message || "couldn't delete — this isn't your post");
      return;
    }
    // Remove the media objects behind the post (best-effort, reported).
    const failures = await removeStorageObjects(target?.media_urls ?? []);
    if (failures > 0) toast.error("post removed, but some media files couldn't be cleaned up");
    else toast.success("Post deleted");
  }

  return (
    <div className="pb-6">
      <div className="mt-2 px-5">
        {/* The composer: the one thing every visit can do, so it leads */}
        <OniqCard className="rise">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's happening in your world?"
            rows={2}
            className="w-full resize-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {imageUrl && (
            <div className="relative mt-2 overflow-hidden rounded-2xl bg-black">
              <MomentMedia url={imageUrl} className="max-h-64 w-full object-cover" />
              <button
                type="button"
                onClick={() => setImageUrl("")}
                aria-label="Remove media"
                className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {isImageUrl(imageUrl) && (
                <button
                  type="button"
                  onClick={rotatePreview}
                  disabled={uploading}
                  aria-label="Rotate photo"
                  className="absolute end-2 top-12 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCw className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={handlePickFile}
          />
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="mb-2 text-xs text-muted-foreground">who can peep this? 👀</div>
            <div className="flex gap-2" role="radiogroup" aria-label="Who can see this">
              {(["public", "moots"] as const).map((v) => {
                const active = visibility === v;
                const label = v === "public" ? "errbody 🌍" : "moots only 🤝";
                return (
                  <OniqChip
                    key={v}
                    role="radio"
                    active={active}
                    testId={`moment-visibility-${v}`}
                    className="min-h-11 flex-1 justify-center"
                    onClick={() => {
                      setVisibility(v);
                      if (typeof sessionStorage !== "undefined")
                        sessionStorage.setItem("oniq_post_visibility", v);
                    }}
                  >
                    {label}
                  </OniqChip>
                );
              })}
            </div>
          </div>
          <label className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={isSynthetic}
              disabled={syntheticLocked}
              onChange={(e) => setIsSynthetic(e.target.checked)}
              className="mt-0.5 accent-[var(--world-a)]"
            />
            <span>
              this media is AI-generated or AI-edited 🤖{" "}
              <span className="opacity-70">
                (ticks itself when we detect AI credentials; required under Indian law
                {syntheticLocked ? " — verified, can't be removed" : ""})
              </span>
            </span>
          </label>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <button
                type="button"
                onClick={() => setShowAttach(true)}
                disabled={uploading}
                className={`tap grid h-9 w-9 place-items-center rounded-full bg-world-soft text-world ${uploading ? "opacity-50" : ""}`}
                aria-label="Add photo from gallery"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = visibility === "public" ? "moots" : "public";
                  setVisibility(next);
                  if (typeof sessionStorage !== "undefined")
                    sessionStorage.setItem("oniq_post_visibility", next);
                }}
                aria-label="Toggle post visibility"
                className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors hover:bg-surface-2 ${
                  visibility === "public" ? "text-world" : "text-muted-foreground"
                }`}
              >
                {visibility === "public" ? (
                  <Globe className="h-4 w-4" />
                ) : (
                  <span aria-hidden>🤝</span>
                )}
                {visibility === "public" ? "public" : "moots"}
              </button>
            </div>
            <button
              onClick={post}
              disabled={posting || (!content.trim() && !imageUrl.trim())}
              className="press rounded-full bg-world px-5 py-2 text-xs font-semibold text-white world-glow disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </OniqCard>

        {postsError ? (
          <div role="alert" className="mt-6 rounded-3xl oniq-surface p-4 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <AlertCircle className="mt-[2px] h-4 w-4 shrink-0 text-amber-500" />
              <p>Couldn't load moments right now — a connection problem, not an empty feed.</p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="press mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
            >
              <RotateCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : posts && posts.length > 0 ? (
          <div className="mt-5 space-y-4">
            {posts.map((p, i) => {
              const liked = likedIds.has(p.id);
              const isMine = p.user_id === me;
              const media = p.media_urls?.[0];
              return (
                <article
                  key={p.id}
                  id={`post-${p.id}`}
                  className={`overflow-hidden rounded-3xl oniq-surface ${i < 3 ? `rise rise-${i + 1}` : ""}`}
                >
                  <div className="flex items-center gap-3 px-4 pt-4">
                    <Link
                      to={isMine ? "/app/chat/me" : "/app/u/$userId"}
                      params={isMine ? undefined : { userId: p.user_id }}
                      className="flex min-w-0 flex-1 items-center gap-3"
                      aria-label={`View ${p.profiles?.display_name ?? "user"}'s page`}
                    >
                      {/* story-ring avatar — tap to visit their page */}
                      <span className="isolate shrink-0 rounded-full bg-world p-[2px]">
                        <span className="block rounded-full bg-card p-[2px]">
                          {p.profiles?.avatar_url ? (
                            <img
                              src={p.profiles.avatar_url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <span className="grid h-10 w-10 place-items-center rounded-full bg-world-soft text-sm font-bold text-world">
                              {(p.profiles?.display_name ?? p.profiles?.username ?? "U")
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">
                          {p.profiles?.display_name ?? p.profiles?.username ?? "User"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(p.created_at ?? Date.now()), {
                            addSuffix: true,
                          })}
                        </span>
                      </span>
                    </Link>
                    {isMine && p.visibility === "moots" && (
                      <span className="shrink-0 rounded-full bg-world-soft px-2 py-0.5 text-[11px] font-semibold text-world">
                        moots only 🤝
                      </span>
                    )}
                    {isMine ? (
                      <span className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => setEditTarget(p)}
                          className={`${ICON_BTN} hover:text-world`}
                          aria-label="Edit post"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePost(p.id)}
                          className={`${ICON_BTN} hover:text-destructive`}
                          aria-label="Delete post"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReportTarget({ type: "moment", id: p.id })}
                        className={`${ICON_BTN} shrink-0 hover:text-destructive`}
                        aria-label="Report post"
                      >
                        <Flag className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {p.is_synthetic && (
                    <div className="px-4 pt-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                        AI-generated content 🤖
                      </span>
                    </div>
                  )}
                  {p.content && (
                    <p className="whitespace-pre-wrap px-4 pt-3 text-[15px] leading-relaxed text-foreground">
                      {p.content}
                    </p>
                  )}
                  {media && (
                    <div className="mt-3 bg-black">
                      <MomentMedia url={media} className="max-h-[70vh] w-full object-cover" />
                    </div>
                  )}

                  <div className="flex items-center gap-1 px-2 py-2 text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => toggleLike(p.id)}
                      className={`${ACTION_BTN} ${liked ? "bg-world-soft text-world" : ""}`}
                      aria-label={liked ? "Unlike" : "Like"}
                    >
                      <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />{" "}
                      {p.like_count ?? 0}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenComments(p.id)}
                      className={`${ACTION_BTN} hover:text-world`}
                      aria-label="Comments"
                    >
                      <MessageCircle className="h-4 w-4" /> {p.comment_count ?? 0}
                    </button>
                    <button
                      type="button"
                      onClick={() => sharePost(p)}
                      className={`${ACTION_BTN} hover:text-world`}
                      aria-label="Share post"
                    >
                      <Share2 className="h-4 w-4" /> share
                    </button>
                    <span className="flex-1" />
                    {me === p.user_id ? (
                      <button
                        type="button"
                        onClick={() => setViewersFor(p.id)}
                        role="button"
                        aria-label="See who viewed"
                        className={`${ACTION_BTN} min-h-[24px] hover:text-world active:opacity-70`}
                      >
                        <Eye className="h-4 w-4" /> {p.view_count ?? 0}
                      </button>
                    ) : (
                      <span
                        className="flex items-center gap-1.5 px-3 py-2 text-xs"
                        aria-label="Views"
                      >
                        <Eye className="h-4 w-4" /> {p.view_count ?? 0}
                      </span>
                    )}
                    <ViewTracker postId={p.id} ownerId={p.user_id} me={me} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <OniqEmpty
            className="mt-6 rise rise-1"
            emoji="✨"
            title="No moments yet"
            body="Be the first to share something."
          />
        )}
      </div>

      {openComments && (
        <CommentsSheet
          postId={openComments}
          onClose={() => {
            setOpenComments(null);
            refetch();
          }}
        />
      )}
      {reportTarget && <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />}
      {showCrisis && <CrisisSupportSheet onClose={() => setShowCrisis(false)} />}
      {shareSheet && <ShareSheet payload={shareSheet} onClose={() => setShareSheet(null)} />}
      {viewersFor && (
        <ViewersSheet postType="moment" postId={viewersFor} onClose={() => setViewersFor(null)} />
      )}
      <AttachmentSheet
        open={showAttach}
        surface="moment"
        context={attachCtx}
        acceptOverride={{ gallery: "image/*,video/*,audio/*" }}
        onClose={() => setShowAttach(false)}
        onFiles={(opt, files) => void handleSheetFiles(opt, files)}
        onSelect={() => {}}
      />
      {studioFile && (
        <PhotoStudio
          file={studioFile}
          onCancel={() => setStudioFile(null)}
          onDone={(edited) => {
            setStudioFile(null);
            void uploadPicked(edited);
          }}
        />
      )}
      {editTarget && (
        <EditPostSheet
          post={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function EditPostSheet({
  post,
  onClose,
  onSaved,
}: {
  post: Post;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(post.content ?? "");
  const [media, setMedia] = useState<string | null>(post.media_urls?.[0] ?? null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [studioFile, setStudioFile] = useState<File | null>(null);

  async function uploadReplacement(file: File) {
    // Type-routed buckets, same as the composer.
    setBusy(true);
    try {
      const { bucket, ext } = routeMomentFile(file);
      setMedia(await uploadMomentBlob(file, ext, file.type, bucket));
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function pickReplacement(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      !file.type.startsWith("image/") &&
      !file.type.startsWith("video/") &&
      !file.type.startsWith("audio/")
    ) {
      toast.error("Choose a photo, video, or audio file");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("Keep it under 50MB for now 🎬");
      return;
    }
    if (file.type.startsWith("image/")) {
      setStudioFile(file);
      return;
    }
    await uploadReplacement(file);
  }

  async function rotate() {
    if (!media || busy) return;
    setBusy(true);
    try {
      setMedia(await rotateUploadedImage(media));
    } catch (err: any) {
      toast.error(err.message ?? "couldn't rotate — try replacing the photo");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!text.trim() && !media) {
      toast.error("post can't be empty — add text or a photo");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("moments_posts")
      .update({ content: text.trim(), media_urls: media ? [media] : [] })
      .eq("id", post.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("post updated ✏️");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl oniq-glass p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[15px] text-foreground">edit post ✏️</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap grid h-8 w-8 place-items-center rounded-full bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What's happening in your world?"
          className="w-full resize-none rounded-2xl bg-surface-2 p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {media && (
          <div className="relative mt-3 overflow-hidden rounded-2xl bg-black">
            <MomentMedia url={media} className="max-h-64 w-full object-cover" />
            <button
              type="button"
              onClick={() => setMedia(null)}
              aria-label="Remove media"
              className="absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {isImageUrl(media) && (
              <button
                type="button"
                onClick={rotate}
                disabled={busy}
                aria-label="Rotate photo"
                className="absolute end-2 top-12 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/15 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCw className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={pickReplacement}
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="press flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground disabled:opacity-50"
          >
            <ImageIcon className="h-3.5 w-3.5" /> {media ? "replace photo" : "add photo"}
          </button>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="press mt-4 w-full rounded-2xl bg-world py-3 text-sm font-semibold text-white world-glow disabled:opacity-50"
        >
          {busy ? "saving…" : "save changes"}
        </button>
      </div>
      {studioFile && (
        <PhotoStudio
          file={studioFile}
          onCancel={() => setStudioFile(null)}
          onDone={(edited) => {
            setStudioFile(null);
            void uploadReplacement(edited);
          }}
        />
      )}
    </div>
  );
}

function CommentsSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const {
    data: comments,
    isError: commentsError,
    refetch,
  } = useQuery({
    queryKey: ["comments", postId],
    queryFn: async () => {
      // Newest 200, then flipped to chronological for display. The unbounded
      // read this replaces pulled every comment on a viral thread at once; a
      // swallowed error also showed "No comments yet" on a post that had them.
      const { data, error } = await supabase
        .from("moments_comments")
        .select(
          "id, content, created_at, user_id, profiles:profiles!moments_comments_user_id_fkey(display_name, username, avatar_url)",
        )
        .eq("post_id", postId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).reverse();
    },
  });

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      // Session lapsed — clear the spinner so the send button isn't stuck.
      setSending(false);
      return;
    }
    const { error } = await supabase.from("moments_comments").insert({
      post_id: postId,
      user_id: u.user.id,
      content: text.trim(),
    });
    if (error) toast.error(error.message);
    else {
      // moments_posts.comment_count is maintained by the bump_comment_count
      // AFTER INSERT trigger on moments_comments — nothing to call from here.
      setText("");
      refetch();
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[75vh] rounded-t-3xl oniq-glass p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[15px] text-foreground">Comments</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap grid h-8 w-8 place-items-center rounded-full bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {commentsError ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Couldn&apos;t load comments — a hiccup, not an empty thread.
              <button
                onClick={() => refetch()}
                className="press mx-auto mt-2 block rounded-full border border-border px-4 py-1.5 font-semibold"
              >
                Try again
              </button>
            </div>
          ) : comments?.length ? (
            comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-world text-xs font-bold text-white">
                  {(c.profiles?.display_name ?? "U").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 rounded-2xl bg-surface-2 px-3 py-2">
                  <div className="text-xs font-medium">
                    {c.profiles?.display_name ?? c.profiles?.username ?? "User"}
                  </div>
                  <div className="text-sm">{c.content}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No comments yet. Be the first.
            </p>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
          <input
            value={text}
            aria-label="Add a comment"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Add a comment…"
            className="min-w-0 flex-1 rounded-full bg-surface-2 px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={send}
            aria-label="Post comment"
            disabled={sending || !text.trim()}
            className="press grid h-10 w-10 shrink-0 place-items-center rounded-full bg-world text-white disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Render a moment attachment by sniffing the file extension in the URL:
 *  video and audio get native players, everything else renders as an image. */
function MomentMedia({ url, className }: { url: string; className?: string }) {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|3gp|mkv)$/.test(path)) {
    return <video src={url} controls playsInline preload="metadata" className={className} />;
  }
  if (/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/.test(path)) {
    return <audio src={url} controls preload="metadata" className="w-full p-3" />;
  }
  return <img src={url} alt="" loading="lazy" decoding="async" className={className} />;
}

/* Invisible helper: observes its parent post card and records a qualified
   view (>=1s at >=50% visible) through the shared batching path. */
function ViewTracker({
  postId,
  ownerId,
  me,
}: {
  postId: string;
  ownerId: string;
  me: string | null;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const host = ref.current?.closest("article");
    if (!host || !me) return;
    return watchImageView(host as HTMLElement, "moment", postId, ownerId, me);
  }, [postId, ownerId, me]);
  return <span ref={ref} className="hidden" aria-hidden="true" />;
}
