import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Heart, MessageCircle, Plus, Image as ImageIcon, Globe, Send, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/discover")({
  component: DiscoverScreen,
});

function DiscoverScreen() {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [posting, setPosting] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"public" | "moots">(() => {
    if (typeof sessionStorage === "undefined") return "public";
    return (sessionStorage.getItem("oniq_post_visibility") as "public" | "moots") ?? "public";
  });


  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${u.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("moments")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      // 100 years — effectively permanent while bucket exists
      const { data: signed, error: sErr } = await supabase.storage
        .from("moments")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 100);
      if (sErr || !signed) throw sErr ?? new Error("Failed to sign URL");
      setImageUrl(signed.signedUrl);
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  const { data: posts, refetch } = useQuery({
    queryKey: ["moments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("moments_posts")
        .select("id, content, media_urls, like_count, comment_count, created_at, user_id, visibility, profiles:profiles!moments_posts_user_id_fkey(display_name, username, avatar_url)")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!me || !posts?.length) return;
    supabase.from("moments_likes").select("post_id").eq("user_id", me)
      .in("post_id", posts.map(p => p.id))
      .then(({ data }) => setLikedIds(new Set((data ?? []).map(r => r.post_id))));
  }, [me, posts]);

  useEffect(() => {
    const ch = supabase.channel("moments-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "moments_posts" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

  async function post() {
    if (!content.trim() && !imageUrl.trim()) return;
    setPosting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const media = imageUrl.trim() ? [imageUrl.trim()] : [];
    const { error } = await supabase
      .from("moments_posts")
      .insert({ user_id: u.user.id, content: content.trim(), media_urls: media, visibility });

    if (error) toast.error(error.message);
    else {
      toast.success("Posted to Moments");
      setContent(""); setImageUrl("");
      refetch();
    }
    setPosting(false);
  }

  async function toggleLike(postId: string) {
    const wasLiked = likedIds.has(postId);
    // optimistic
    setLikedIds(prev => {
      const n = new Set(prev);
      if (wasLiked) n.delete(postId); else n.add(postId);
      return n;
    });
    qc.setQueryData(["moments"], (old: any) =>
      old?.map((p: any) => p.id === postId
        ? { ...p, like_count: Math.max(0, (p.like_count ?? 0) + (wasLiked ? -1 : 1)) }
        : p));
    const { error } = await supabase.rpc("toggle_moment_like", { _post_id: postId });
    if (error) { toast.error(error.message); refetch(); }
  }

  return (
    <div className="pb-6">
      <div className="bg-hero px-5 pt-12">
        <h1 className="font-display text-3xl font-bold">Discover</h1>
        <p className="mt-1 text-sm text-muted-foreground">Moments from your worlds</p>
      </div>

      <div className="mt-5 px-5">
        <div className="rounded-3xl border border-border bg-card p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What's happening in your world?"
            rows={2}
            className="w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          {imageUrl && (
            <div className="relative mt-2">
              <img src={imageUrl} alt="" className="max-h-64 w-full rounded-2xl object-cover" />
              <button
                type="button"
                onClick={() => setImageUrl("")}
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickFile}
          />
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 text-xs text-muted-foreground">who can peep this? 👀</div>
            <div className="flex gap-2">
              {(["public", "moots"] as const).map((v) => {
                const active = visibility === v;
                const label = v === "public" ? "errbody 🌍" : "moots only 🤝";
                return (
                  <button
                    key={v}
                    type="button"
                    data-testid={`moment-visibility-${v}`}
                    onClick={() => {
                      setVisibility(v);
                      if (typeof sessionStorage !== "undefined") sessionStorage.setItem("oniq_post_visibility", v);
                    }}
                    className={`flex-1 min-h-11 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                      active ? "border-primary bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <div className="flex gap-2 text-muted-foreground">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`grid h-8 w-8 place-items-center rounded-full hover:bg-muted ${uploading ? "opacity-50" : ""}`}
                aria-label="Add photo from gallery"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
              </button>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted">
                <Globe className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={post}
              disabled={posting || (!content.trim() && !imageUrl.trim())}
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>

        </div>

        <div className="mt-5 space-y-3">
          {posts && posts.length > 0 ? (
            posts.map((p) => {
              const liked = likedIds.has(p.id);
              return (
                <article key={p.id} className="rounded-3xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    {p.profiles?.avatar_url ? (
                      <img src={p.profiles.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground font-bold">
                        {(p.profiles?.display_name ?? "U").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {p.profiles?.display_name ?? p.profiles?.username ?? "User"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(p.created_at ?? Date.now()), { addSuffix: true })}
                      </div>
                    </div>
                    {p.user_id === me && p.visibility === "moots" && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">moots only 🤝</span>
                    )}
                  </div>

                  {p.content && <p className="mt-3 text-sm">{p.content}</p>}
                  {p.media_urls?.[0] && (
                    <img src={p.media_urls[0]} alt="" className="mt-3 max-h-96 w-full rounded-2xl object-cover" />
                  )}
                  <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                    <button
                      onClick={() => toggleLike(p.id)}
                      className={`flex items-center gap-1 transition ${liked ? "text-accent" : "hover:text-accent"}`}
                    >
                      <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} /> {p.like_count ?? 0}
                    </button>
                    <button
                      onClick={() => setOpenComments(p.id)}
                      className="flex items-center gap-1 hover:text-primary"
                    >
                      <MessageCircle className="h-4 w-4" /> {p.comment_count ?? 0}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">
                <Plus className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-semibold">No moments yet</div>
              <p className="text-xs text-muted-foreground">Be the first to share something.</p>
            </div>
          )}
        </div>
      </div>

      {openComments && (
        <CommentsSheet postId={openComments} onClose={() => { setOpenComments(null); refetch(); }} />
      )}
    </div>
  );
}

function CommentsSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const { data: comments, refetch } = useQuery({
    queryKey: ["comments", postId],
    queryFn: async () => {
      const { data } = await supabase
        .from("moments_comments")
        .select("id, content, created_at, user_id, profiles:profiles!moments_comments_user_id_fkey(display_name, username, avatar_url)")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("moments_comments").insert({
      post_id: postId, user_id: u.user.id, content: text.trim(),
    });
    if (error) toast.error(error.message);
    else {
      await supabase.rpc as any; // no-op safety
      setText("");
      refetch();
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[75vh] rounded-t-3xl border-t border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Comments</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {comments?.length ? comments.map(c => (
            <div key={c.id} className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xs font-bold text-primary-foreground">
                {(c.profiles?.display_name ?? "U").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 rounded-2xl bg-muted px-3 py-2">
                <div className="text-xs font-medium">{c.profiles?.display_name ?? c.profiles?.username ?? "User"}</div>
                <div className="text-sm">{c.content}</div>
              </div>
            </div>
          )) : (
            <p className="py-6 text-center text-xs text-muted-foreground">No comments yet. Be the first.</p>
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
