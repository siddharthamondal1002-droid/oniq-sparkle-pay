import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Trash2, Image as ImageIcon, Eye } from "lucide-react";
import { ViewersSheet } from "@/components/reels/ViewersSheet";
import { recordView } from "@/lib/views";
import { toast } from "sonner";
import { formatDistanceToNowStrict } from "date-fns";
import { OniqCanvas, OniqCard, OniqEmpty, OniqHeader, OniqSectionHeader } from "@/components/oniq";

export const Route = createFileRoute("/_authenticated/app/chat/updates")({
  component: UpdatesTab,
});

type StatusRow = {
  id: string;
  user_id: string;
  kind: "text" | "image";
  content: string | null;
  media_url: string | null;
  bg_color: string | null;
  created_at: string;
  expires_at: string;
};
type ProfileLite = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

const BG_COLORS = [
  "#0B5A4E",
  "#00D4B8",
  "#8B5CF6",
  "#EF4444",
  "#F59E0B",
  "#3B82F6",
  "#EC4899",
  "#14B8A6",
];

function timeAgo(iso: string) {
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: false });
  } catch {
    return "";
  }
}

function UpdatesTab() {
  const qc = useQueryClient();
  const [showCompose, setShowCompose] = useState(false);
  const [viewerUser, setViewerUser] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: rows = [], refetch } = useQuery({
    queryKey: ["status-updates", me?.id],
    enabled: !!me,
    staleTime: 20_000,
    queryFn: async (): Promise<StatusRow[]> => {
      const { data, error } = await supabase
        .from("status_updates")
        .select("*")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as StatusRow[];
    },
  });

  useEffect(() => {
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const otherUserIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.user_id !== me?.id) s.add(r.user_id);
    return [...s];
  }, [rows, me]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["status-profiles", otherUserIds.join(",")],
    enabled: otherUserIds.length > 0,
    queryFn: async (): Promise<ProfileLite[]> => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", otherUserIds);
      return (data ?? []) as ProfileLite[];
    },
  });
  const profMap = useMemo(() => {
    const m = new Map<string, ProfileLite>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  // My views
  const { data: myViews = [] } = useQuery({
    queryKey: ["status-my-views", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<string[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("post_views")
        .select("post_id")
        .eq("post_type", "update")
        .eq("viewer_id", me!.id);
      return (data ?? []).map((r: { post_id: string }) => r.post_id);
    },
  });
  const viewedSet = useMemo(() => new Set(myViews), [myViews]);

  const myStatuses = useMemo(() => rows.filter((r) => r.user_id === me?.id), [rows, me]);
  const grouped = useMemo(() => {
    const map = new Map<string, StatusRow[]>();
    for (const r of rows) {
      if (r.user_id === me?.id) continue;
      const arr = map.get(r.user_id) ?? [];
      arr.push(r);
      map.set(r.user_id, arr);
    }
    return [...map.entries()].map(([uid, arr]) => ({
      uid,
      arr: arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      hasUnseen: arr.some((r) => !viewedSet.has(r.id)),
      latest: arr.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b)),
    }));
  }, [rows, me, viewedSet]);

  const openViewer = (uid: string) => setViewerUser(uid);
  const viewerRows =
    viewerUser === me?.id ? myStatuses : (grouped.find((g) => g.uid === viewerUser)?.arr ?? []);

  return (
    <OniqCanvas world="chat" className="pb-4">
      <OniqHeader
        eyebrow="Chat"
        title="Updates"
        subtitle="What your moots are up to right now."
        back="/app/chat"
      />

      {/* My status — the one row that is always here, so it leads */}
      <div className="mt-5 px-5">
        <OniqCard
          variant="tinted"
          padding="sm"
          className="rise flex items-center gap-3"
          ariaLabel="My status"
          onClick={() => (myStatuses.length > 0 ? openViewer(me!.id) : setShowCompose(true))}
        >
          <div className="relative shrink-0">
            <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-world font-display text-lg text-on-world world-glow">
              {me?.user_metadata?.avatar_url ? (
                <img
                  src={me.user_metadata.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                (me?.email || "?").charAt(0).toUpperCase()
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowCompose(true);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Add status"
              className="tap absolute -bottom-0.5 -end-0.5 grid h-6 w-6 place-items-center rounded-full bg-world text-on-world ring-2 ring-card"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] text-foreground">My status</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {myStatuses.length > 0
                ? `${myStatuses.length} update${myStatuses.length > 1 ? "s" : ""} · tap to view`
                : "Tap + to share an update"}
            </div>
          </div>
        </OniqCard>
      </div>

      {grouped.length > 0 && (
        <section className="mt-6 rise rise-1">
          <OniqSectionHeader eyebrow="Moots" title="Recent" />
          <div className="mt-3 px-5">
            <OniqCard padding="none" className="overflow-hidden">
              <ul className="divide-y divide-border/60">
                {grouped.map((g) => {
                  const p = profMap.get(g.uid);
                  const name = p?.display_name || p?.username || "Someone";
                  return (
                    <li key={g.uid}>
                      <button
                        type="button"
                        onClick={() => openViewer(g.uid)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors active:bg-surface-2"
                      >
                        {/* The ring carries the world's pair while something is unseen */}
                        <span
                          className={`isolate block shrink-0 rounded-full p-[2px] ${g.hasUnseen ? "bg-world" : "bg-border"}`}
                        >
                          <span className="block rounded-full bg-card p-[2px]">
                            <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-world-soft font-semibold text-world">
                              {p?.avatar_url ? (
                                <img
                                  src={p.avatar_url}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                name.charAt(0).toUpperCase()
                              )}
                            </span>
                          </span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold text-foreground">
                            {name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {timeAgo(g.latest.created_at)} ago
                          </div>
                        </div>
                        {g.hasUnseen && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-world"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </OniqCard>
          </div>
        </section>
      )}

      {grouped.length === 0 && myStatuses.length === 0 && (
        <div className="mt-6 px-5">
          <OniqEmpty
            className="rise rise-1"
            emoji="✨"
            title="No updates yet"
            body="Share what you're up to ✨"
          />
        </div>
      )}

      {showCompose && me && (
        <ComposeStatusSheet
          onClose={() => setShowCompose(false)}
          onDone={() => {
            setShowCompose(false);
            qc.invalidateQueries({ queryKey: ["status-updates"] });
          }}
        />
      )}
      {viewerUser && me && (
        <StatusViewer
          meId={me.id}
          isOwn={viewerUser === me.id}
          rows={viewerRows}
          onClose={() => {
            setViewerUser(null);
            qc.invalidateQueries({ queryKey: ["status-my-views"] });
          }}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["status-updates"] });
          }}
        />
      )}
    </OniqCanvas>
  );
}

function ComposeStatusSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BG_COLORS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // One object URL per selected file, revoked when the file changes or the
  // sheet unmounts. The old inline src={URL.createObjectURL(file)} minted a
  // fresh blob URL — pinning the whole File in memory — on every keystroke in
  // the caption field below. Same shape as StoryStudio's preview handling.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const submit = async () => {
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("not signed in");
      if (tab === "text") {
        const content = text.trim();
        if (!content) {
          toast.error("Say something first ✨");
          setBusy(false);
          return;
        }
        const { error } = await supabase.from("status_updates").insert({
          user_id: uid,
          kind: "text",
          content,
          bg_color: bg,
        });
        if (error) throw error;
      } else {
        if (!file) {
          toast.error("Pick an image first");
          setBusy(false);
          return;
        }
        const path = `${uid}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("chat-media")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage
          .from("chat-media")
          .createSignedUrl(path, 60 * 60 * 24 * 2);
        const { error } = await supabase.from("status_updates").insert({
          user_id: uid,
          kind: "image",
          media_url: signed?.signedUrl ?? path,
          content: text.trim() || null,
        });
        if (error) throw error;
      }
      toast.success("Status posted ✨");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl oniq-glass p-5 sm:rounded-3xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[18px] text-foreground">Share an update</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap grid h-9 w-9 place-items-center rounded-full oniq-surface"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-full oniq-surface p-1">
          <button
            onClick={() => setTab("text")}
            className={`rounded-full py-2 text-sm font-medium transition-colors ${tab === "text" ? "bg-world text-on-world" : "text-muted-foreground"}`}
          >
            Text
          </button>
          <button
            onClick={() => setTab("image")}
            className={`rounded-full py-2 text-sm font-medium transition-colors ${tab === "image" ? "bg-world text-on-world" : "text-muted-foreground"}`}
          >
            Image
          </button>
        </div>

        {tab === "text" ? (
          <>
            <div className="rounded-2xl p-6" style={{ background: bg }}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, 280))}
                placeholder="What's up?"
                className="min-h-[120px] w-full resize-none bg-transparent text-center text-lg font-semibold text-white placeholder:text-white/60 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex items-center gap-2 overflow-x-auto no-scrollbar">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBg(c)}
                  aria-label={`Color ${c}`}
                  className={`press h-8 w-8 shrink-0 rounded-full border-2 ${bg === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              className="grid min-h-[160px] w-full place-items-center rounded-2xl border-2 border-dashed border-border-strong p-4 text-sm text-muted-foreground"
            >
              {preview ? (
                <img src={preview} alt="" className="max-h-48 rounded-xl" />
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ImageIcon className="h-8 w-8 text-world" />
                  <span>Tap to pick an image</span>
                </div>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 200))}
              placeholder="Add a caption (optional)"
              className="mt-3 w-full rounded-2xl oniq-surface px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="press mt-4 w-full rounded-2xl bg-world py-3 font-semibold text-on-world world-glow disabled:opacity-60"
        >
          {busy ? "Posting…" : "Post status"}
        </button>
      </div>
    </div>
  );
}

function StatusViewer({
  meId,
  isOwn,
  rows,
  onClose,
  onDeleted,
}: {
  meId: string;
  isOwn: boolean;
  rows: StatusRow[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [viewsCount, setViewsCount] = useState<number | null>(null);
  const [showViewers, setShowViewers] = useState(false);
  const cur = rows[idx];

  useEffect(() => {
    if (!cur) return;
    if (!isOwn) {
      // Qualified view (>=1s on screen) through the shared batching path.
      const t1 = setTimeout(() => recordView("update", cur.id), 1000);
      const t = setTimeout(() => {
        setIdx((i) => (i + 1 < rows.length ? i + 1 : -1));
      }, 5000);
      return () => {
        clearTimeout(t1);
        clearTimeout(t);
      };
    }
    // Owner: total viewer count via owner-scoped RPC. Viewer identity is
    // never returned here — the "seen by" list uses post_viewers(), which
    // honours each viewer's show_view_identity preference.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .rpc("post_view_count", { _post_type: "update", _post_id: cur.id })
      .then(({ data }: { data: number | null }) => setViewsCount(data ?? 0));
    const t = setTimeout(() => {
      setIdx((i) => (i + 1 < rows.length ? i + 1 : -1));
    }, 5000);
    return () => clearTimeout(t);
  }, [cur, isOwn, meId, rows.length]);

  useEffect(() => {
    if (idx === -1) onClose();
  }, [idx, onClose]);

  if (!cur) return null;

  const remove = async () => {
    if (!confirm("Delete this status?")) return;
    const { error } = await supabase.from("status_updates").delete().eq("id", cur.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted");
    onDeleted();
    onClose();
  };

  const next = () => setIdx((i) => (i + 1 < rows.length ? i + 1 : -1));
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white">
      <div className="flex items-center gap-2 p-3">
        {rows.map((_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded bg-white/25">
            <div
              className={`h-full bg-white ${i < idx ? "w-full" : i === idx ? "w-full animate-pulse" : "w-0"}`}
            />
          </div>
        ))}
        <button
          onClick={onClose}
          aria-label="Close"
          className="ms-2 grid h-9 w-9 place-items-center rounded-full bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex-1" onClick={next}>
        <div
          className="absolute start-0 top-0 h-full w-1/4"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
        />
        {cur.kind === "text" ? (
          <div
            className="grid h-full w-full place-items-center p-8 text-center text-2xl font-semibold"
            style={{ background: cur.bg_color || "#0B5A4E" }}
          >
            {cur.content}
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center bg-black">
            {cur.media_url && (
              <img src={cur.media_url} alt="" className="max-h-full max-w-full object-contain" />
            )}
            {cur.content && (
              <div className="absolute inset-x-0 bottom-20 px-6 text-center text-sm">
                {cur.content}
              </div>
            )}
          </div>
        )}
      </div>

      {isOwn && (
        <div className="flex items-center justify-between gap-3 p-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowViewers(true);
            }}
            role="button"
            aria-label="See who viewed"
            className="flex min-h-[44px] items-center gap-2 rounded-full bg-white/10 px-4 text-sm text-white active:bg-white/20"
          >
            <Eye className="h-4 w-4" />
            {viewsCount ?? 0} {viewsCount === 1 ? "view" : "views"}
          </button>
          <button
            onClick={remove}
            className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}
      {showViewers && cur && (
        <ViewersSheet postType="update" postId={cur.id} onClose={() => setShowViewers(false)} />
      )}
    </div>
  );
}
