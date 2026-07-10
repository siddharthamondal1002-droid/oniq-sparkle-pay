import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Search, Edit3, X, Check, CheckCheck, Users, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/chat/")({
  component: ChatList,
});

type ConvRow = {
  conversation_id: string;
  conversations: {
    id: string;
    name: string | null;
    type: string;
    avatar_url: string | null;
    updated_at: string | null;
  } | null;
};

type EnrichedConv = {
  id: string;
  title: string;
  avatar_url: string | null;
  type: string;
  updated_at: string | null;
  last_message: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  last_created_at: string | null;
  peer_read_at: string | null;
  unread: number;
};

const AVATAR_COLORS = [
  "#0B5A4E", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981",
  "#3B82F6", "#EC4899", "#14B8A6", "#F97316", "#6366F1",
];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function convTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "Yesterday";
  if (differenceInDays(new Date(), d) < 7) return format(d, "EEEE");
  return format(d, "dd/MM/yy");
}

function ChatList() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: blockedIds = [] } = useQuery({
    queryKey: ["blocked-ids", me?.id],
    enabled: !!me,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase.from("blocked_users").select("blocked_id").eq("blocker_id", me!.id);
      return (data ?? []).map((r) => r.blocked_id);
    },
  });
  const blockedSet = useMemo(() => new Set(blockedIds), [blockedIds]);

  const { data: convs, isLoading } = useQuery({
    queryKey: ["conversations", me?.id, blockedIds.join(",")],
    enabled: !!me,
    queryFn: async (): Promise<EnrichedConv[]> => {
      const { data } = await supabase
        .from("conversation_members")
        .select("conversation_id, conversations(id, name, type, avatar_url, updated_at)")
        .eq("user_id", me!.id);
      const rows = (data ?? []) as ConvRow[];
      const enriched = await Promise.all(
        rows
          .filter((r) => r.conversations)
          .map(async (r): Promise<EnrichedConv | null> => {
            const c = r.conversations!;
            let title = c.name ?? "Chat";
            let avatar = c.avatar_url;
            let peerReadAt: string | null = null;
            let peerId: string | null = null;
            if (c.type === "direct") {
              const { data: other } = await supabase
                .from("conversation_members")
                .select("user_id, last_read_at, profiles(display_name, username, avatar_url)")
                .eq("conversation_id", c.id)
                .neq("user_id", me!.id)
                .maybeSingle();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const o = other as any;
              const p = o?.profiles;
              if (p) {
                title = p.display_name || p.username || "Chat";
                avatar = p.avatar_url ?? avatar;
              }
              peerReadAt = o?.last_read_at ?? null;
              peerId = o?.user_id ?? null;
            }
            if (peerId && blockedSet.has(peerId)) return null;
            const { data: last } = await supabase
              .from("messages")
              .select("content, created_at, sender_id, type")
              .eq("conversation_id", c.id)
              .eq("is_deleted", false)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const { data: unread } = await supabase.rpc("unread_count", {
              _conversation_id: c.id,
            });
            let lastSenderName: string | null = null;
            if (c.type === "group" && last?.sender_id) {
              if (last.sender_id === me!.id) {
                lastSenderName = "You";
              } else {
                const { data: sp } = await supabase
                  .from("profiles")
                  .select("display_name, username")
                  .eq("id", last.sender_id)
                  .maybeSingle();
                const full = (sp?.display_name || sp?.username || "").trim();
                lastSenderName = full ? full.split(/\s+/)[0] : null;
              }
            }
            return {
              id: c.id,
              title,
              avatar_url: avatar,
              type: c.type,
              updated_at: last?.created_at ?? c.updated_at,
              last_message: last?.type === "image" ? "📷 Photo" : last?.type === "voice" ? "🎙 Voice note" : (last?.content ?? null),
              last_sender_id: last?.sender_id ?? null,
              last_sender_name: lastSenderName,
              last_created_at: last?.created_at ?? null,
              peer_read_at: peerReadAt,
              unread: (unread as number) ?? 0,
            };
          }),
      );
      const filtered = enriched.filter((x): x is EnrichedConv => x !== null);
      filtered.sort((a, b) => {
        const ta = new Date(a.updated_at ?? 0).getTime();
        const tb = new Date(b.updated_at ?? 0).getTime();
        return tb - ta;
      });
      return filtered;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("chat-list-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members" }, () => {
        qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const filtered = useMemo(() => {
    if (!convs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.last_message ?? "").toLowerCase().includes(q),
    );
  }, [convs, query]);

  return (
    <div className="px-4 pt-12 pb-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Link to="/app" aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-3xl font-bold">Chats</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setShowSearch((s) => !s);
              if (showSearch) setQuery("");
            }}
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted"
            aria-label="New chat"
          >
            <Edit3 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-full border border-border bg-input/40 py-2.5 pl-11 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      )}

      <div className="mt-3">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {filtered.map((c) => {
              const mine = c.last_sender_id === me?.id;
              const isRead =
                mine && c.last_created_at && c.peer_read_at
                  ? new Date(c.peer_read_at).getTime() >= new Date(c.last_created_at).getTime()
                  : false;
              return (
                <li key={c.id}>
                  <Link
                    to="/app/chat/$conversationId"
                    params={{ conversationId: c.id }}
                    className="flex items-center gap-3 px-1 py-3 active:bg-muted/60"
                  >
                    <Avatar name={c.title} url={c.avatar_url} size={52} group={c.type === "group"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate font-semibold">{c.title}</div>
                        <div
                          className={`shrink-0 text-[11px] ${
                            c.unread > 0 ? "font-semibold text-[#25D366]" : "text-muted-foreground"
                          }`}
                        >
                          {convTime(c.updated_at)}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
                          {mine && c.type !== "group" &&
                            (isRead ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#53BDEB]" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0" />
                            ))}
                          <span className="truncate">
                            {c.type === "group" && c.last_sender_name
                              ? `${c.last_sender_name}: `
                              : mine && <span>You: </span>}
                            {c.last_message ?? "No messages yet"}
                          </span>
                        </div>
                        {c.unread > 0 && (
                          <span className="ml-2 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25D366] px-1.5 text-[11px] font-bold text-black">
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : query ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No matches</div>
        ) : (
          <EmptyChats onNew={() => setShowNew(true)} />
        )}
      </div>

      {mounted &&
        createPortal(
          <button
            onClick={() => setShowNew(true)}
            aria-label="New chat"
            data-testid="new-chat-fab"
            className="fixed right-4 bottom-6 z-[70] h-14 w-14 rounded-full bg-[#25D366] text-black shadow-xl grid place-items-center active:scale-95"
          >
            <Edit3 className="h-5 w-5" />
          </button>,
          document.body,
        )}

      {showNew && me && <NewChatSheet meId={me.id} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function Avatar({ name, url, size = 44, group = false }: { name: string; url: string | null; size?: number; group?: boolean }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const bg = colorFor(name || "?");
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.42 }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : group ? <Users style={{ width: size * 0.5, height: size * 0.5 }} /> : initial}
    </div>
  );
}

function EmptyChats({ onNew }: { onNew: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border p-10 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <MessageCircle className="h-6 w-6" />
      </div>
      <div className="font-display text-lg font-semibold">No chats yet</div>
      <p className="max-w-xs text-sm text-muted-foreground">
        Search a username to start your first conversation.
      </p>
      <button
        onClick={onNew}
        className="mt-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        New chat
      </button>
    </div>
  );
}

type PickedUser = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };

function NewChatSheet({ meId, onClose }: { meId: string; onClose: () => void }) {
  const [mode, setMode] = useState<"chat" | "group">("chat");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["user-search", debounced, meId],
    enabled: debounced.length >= 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .neq("id", meId)
        .or(`username.ilike.%${debounced}%,display_name.ilike.%${debounced}%`)
        .limit(20);
      return (data ?? []) as PickedUser[];
    },
  });

  const startChat = async (otherId: string) => {
    setStarting(true);
    const { data, error } = await supabase.rpc("find_or_create_direct_conversation", {
      other_user_id: otherId,
    });
    setStarting(false);
    if (error || !data) {
      console.error("start chat failed", error);
      toast.error(error?.message || "Couldn't start chat");
      return;
    }
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: data as string } });
  };

  const togglePick = (u: PickedUser) => {
    setPicked((prev) =>
      prev.some((p) => p.id === u.id)
        ? prev.filter((p) => p.id !== u.id)
        : prev.length >= 50
          ? (toast("Max 50 members"), prev)
          : [...prev, u],
    );
  };

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) return toast.error("Group name required");
    if (picked.length < 1) return toast.error("Add at least one member");
    setStarting(true);
    const { data, error } = await supabase.rpc("create_group", {
      _name: name,
      _member_ids: picked.map((p) => p.id),
    });
    setStarting(false);
    if (error || !data) {
      console.error(error);
      toast.error(error?.message || "Couldn't create group");
      return;
    }
    toast.success("Group created 🎉");
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: data as string } });
  };

  const hint = useMemo(() => {
    if (!debounced) return mode === "group" ? "Search users to add" : "Type a username or name to search";
    if (isFetching) return "Searching…";
    if (results.length === 0) return "No users found";
    return null;
  }, [debounced, isFetching, results.length, mode]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{mode === "group" ? "New group 👥" : "New chat"}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-2 rounded-full bg-muted/40 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("chat")}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === "chat" ? "bg-background font-semibold shadow" : "text-muted-foreground"}`}
          >
            New chat
          </button>
          <button
            type="button"
            onClick={() => setMode("group")}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === "group" ? "bg-background font-semibold shadow" : "text-muted-foreground"}`}
          >
            New group 👥
          </button>
        </div>

        {mode === "group" && (
          <>
            <input
              data-testid="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value.slice(0, 50))}
              placeholder="Group name"
              className="mt-3 w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {picked.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {picked.map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
                    {p.display_name || p.username}
                    <button type="button" onClick={() => togglePick(p)} aria-label="Remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search @username"
            className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="mt-3 max-h-[42vh] space-y-1 overflow-y-auto">
          {hint ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{hint}</div>
          ) : (
            results.map((u) => {
              const isPicked = pickedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  disabled={starting}
                  onClick={() => (mode === "group" ? togglePick(u) : startChat(u.id))}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-muted disabled:opacity-50 ${isPicked ? "bg-primary/10" : ""}`}
                >
                  <Avatar name={u.display_name || u.username || "?"} url={u.avatar_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{u.display_name}</div>
                    <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                  </div>
                  {mode === "group" && isPicked && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })
          )}
        </div>

        {mode === "group" && (
          <button
            type="button"
            data-testid="group-create"
            onClick={createGroup}
            disabled={starting || !groupName.trim() || picked.length < 1}
            className="mt-4 w-full rounded-2xl bg-[#25D366] py-3 text-sm font-semibold text-black disabled:opacity-50"
          >
            Create group ({picked.length})
          </button>
        )}
      </div>
    </div>
  );
}

// Silence unused-warning for icons kept for future use.
export const _iconRef = Check;
export const _trashRef = Trash2;

