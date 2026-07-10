import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Search, Edit3, X, Check, CheckCheck, Users, Trash2, ArrowLeft, Megaphone, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";

export const Route = createFileRoute("/_authenticated/app/chat/")({
  component: ChatList,
});


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
  const [showRequests, setShowRequests] = useState(false);
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
    staleTime: 30_000,
    queryFn: async (): Promise<EnrichedConv[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_chat_list");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      return rows
        .filter((r) => !(r.peer_id && blockedSet.has(r.peer_id)))
        .map((r): EnrichedConv => ({
          id: r.conversation_id,
          title: r.title ?? "Chat",
          avatar_url: r.avatar_url ?? null,
          type: r.type,
          updated_at: r.updated_at,
          last_message: r.last_type === "image" ? "📷 Photo" : r.last_type === "voice" ? "🎙 Voice note" : (r.last_message ?? null),
          last_sender_id: r.last_sender_id ?? null,
          last_sender_name: r.last_sender_name ?? null,
          last_created_at: r.last_created_at ?? null,
          peer_read_at: r.peer_read_at ?? null,
          unread: r.unread ?? 0,
        }));
    },
  });

  // Incoming friend requests count (for header badge)
  const { data: incomingRequests = [] } = useQuery({
    queryKey: ["friend-requests-incoming", me?.id],
    enabled: !!me,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("friendships")
        .select("user_a, user_b, requested_by, created_at")
        .eq("status", "pending");
      return (data ?? []).filter((r) => r.requested_by !== me!.id);
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
            onClick={() => setShowRequests(true)}
            className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-muted"
            aria-label="Moot requests"
            data-testid="friend-requests-btn"
          >
            <UserPlus className="h-5 w-5" />
            {incomingRequests.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#25D366] px-1 text-[10px] font-bold text-black">
                {incomingRequests.length}
              </span>
            )}
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

      <ChannelsStrip convs={convs ?? []} />

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
              const isChannel = c.type === "channel";
              return (
                <li key={c.id}>
                  <Link
                    to="/app/chat/$conversationId"
                    params={{ conversationId: c.id }}
                    className="flex items-center gap-3 px-1 py-3 active:bg-muted/60"
                  >
                    <Avatar name={c.title} url={c.avatar_url} size={52} group={c.type === "group"} channel={isChannel} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate font-semibold">{isChannel ? `📢 ${c.title}` : c.title}</div>
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
                          {mine && c.type === "direct" &&
                            (isRead ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#53BDEB]" />
                            ) : (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0" />
                            ))}
                          <span className="truncate">
                            {c.type === "group" && c.last_sender_name
                              ? `${c.last_sender_name}: `
                              : mine && !isChannel && <span>You: </span>}
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
      {showRequests && me && <FriendRequestsSheet meId={me.id} onClose={() => setShowRequests(false)} />}

    </div>
  );
}

function Avatar({ name, url, size = 44, group = false, channel = false }: { name: string; url: string | null; size?: number; group?: boolean; channel?: boolean }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const bg = colorFor(name || "?");
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.42 }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : channel ? <span aria-hidden style={{ fontSize: size * 0.5 }}>📢</span> : group ? <Users style={{ width: size * 0.5, height: size * 0.5 }} /> : initial}
    </div>
  );
}

function ChannelsStrip({ convs }: { convs: EnrichedConv[] }) {
  const [showDiscover, setShowDiscover] = useState(false);
  const channels = useMemo(() => convs.filter((c) => c.type === "channel"), [convs]);
  return (
    <>
      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setShowDiscover(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border bg-card/40 px-3 py-1.5 text-xs font-medium text-foreground"
          data-testid="discover-channels"
        >
          <Megaphone className="h-3.5 w-3.5 text-[#00D4B8]" /> Discover 📢
        </button>
        {channels.map((c) => (
          <Link
            key={c.id}
            to="/app/chat/$conversationId"
            params={{ conversationId: c.id }}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
          >
            📢 <span className="max-w-[9rem] truncate">{c.title}</span>
            {c.unread > 0 && <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#25D366] px-1 text-[10px] text-black">{c.unread}</span>}
          </Link>
        ))}
      </div>
      {showDiscover && <DiscoverChannelsSheet onClose={() => setShowDiscover(false)} />}
    </>
  );
}

function DiscoverChannelsSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [joining, setJoining] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const { data: channels = [], isFetching, refetch } = useQuery({
    queryKey: ["discover-channels", debounced],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_public_channels", { _search: debounced || undefined, _limit: 30 });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; description: string | null; subscriber_count: number }>;
    },
  });
  const join = async (id: string) => {
    setJoining(id);
    const { error } = await supabase.rpc("join_channel", { _conversation_id: id });
    setJoining(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Joined 📢");
    qc.invalidateQueries({ queryKey: ["conversations"] });
    refetch();
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id } });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Discover channels 📢</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels" className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-3 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto">
          {isFetching ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : channels.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No public channels yet — create the first 📢</div>
          ) : channels.map((ch) => (
            <div key={ch.id} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg" style={{ backgroundColor: colorFor(ch.name) }}>📢</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{ch.name}</div>
                {ch.description && <div className="line-clamp-2 text-xs text-muted-foreground">{ch.description}</div>}
                <div className="mt-0.5 text-[11px] text-muted-foreground">{ch.subscriber_count} subscriber{ch.subscriber_count === 1 ? "" : "s"}</div>
              </div>
              <button
                onClick={() => join(ch.id)}
                disabled={joining === ch.id}
                className="shrink-0 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
              >
                {joining === ch.id ? "Joining…" : "Join"}
              </button>
            </div>
          ))}
        </div>
      </div>
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
  const [mode, setMode] = useState<"chat" | "group" | "channel">("chat");
  const [channelName, setChannelName] = useState("");
  const [channelDesc, setChannelDesc] = useState("");
  const [channelPublic, setChannelPublic] = useState(true);

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

  // My friendships → Map<otherId, 'pending-out'|'pending-in'|'accepted'>
  const { data: friendMap = new Map<string, "pending-out" | "pending-in" | "accepted">() } = useQuery({
    queryKey: ["friend-map", meId],
    queryFn: async () => {
      const { data } = await supabase.from("friendships").select("user_a, user_b, status, requested_by");
      const m = new Map<string, "pending-out" | "pending-in" | "accepted">();
      for (const r of data ?? []) {
        const other = r.user_a === meId ? r.user_b : r.user_a;
        m.set(other, r.status === "accepted" ? "accepted" : r.requested_by === meId ? "pending-out" : "pending-in");
      }
      return m;
    },
  });
  const qc = useQueryClient();
  const [addingId, setAddingId] = useState<string | null>(null);
  const addFriend = async (otherId: string) => {
    setAddingId(otherId);
    const { error } = await supabase.rpc("send_friend_request", { _to: otherId });
    setAddingId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("moot request sent 🫡");
    qc.invalidateQueries({ queryKey: ["friend-map", meId] });
  };


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

  const createChannel = async () => {
    const name = channelName.trim();
    if (!name) return toast.error("Channel name required");
    setStarting(true);
    const { data, error } = await supabase.rpc("create_channel", {
      _name: name,
      _description: channelDesc.trim(),
      _is_public: channelPublic,
    });
    setStarting(false);
    if (error || !data) {
      console.error(error);
      toast.error(error?.message || "Couldn't create channel");
      return;
    }
    toast.success("Channel is live 📢");
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: data as string } });
  };

  const hint = useMemo(() => {
    if (mode === "channel") return null;
    if (!debounced) return mode === "group" ? "Search users to add" : "Type a username or name to search";
    if (isFetching) return "Searching…";
    if (results.length === 0) return "No users found";
    return null;
  }, [debounced, isFetching, results.length, mode]);


  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{mode === "channel" ? "New channel 📢" : mode === "group" ? "New group 👥" : "New chat"}</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-1 rounded-full bg-muted/40 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("chat")}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === "chat" ? "bg-background font-semibold shadow" : "text-muted-foreground"}`}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => setMode("group")}
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === "group" ? "bg-background font-semibold shadow" : "text-muted-foreground"}`}
          >
            Group 👥
          </button>
          <button
            type="button"
            onClick={() => setMode("channel")}
            data-testid="mode-channel"
            className={`flex-1 rounded-full px-3 py-1.5 ${mode === "channel" ? "bg-background font-semibold shadow" : "text-muted-foreground"}`}
          >
            Channel 📢
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

        {mode === "channel" ? (
          <div className="mt-3 space-y-2">
            <input
              data-testid="channel-name"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value.slice(0, 50))}
              placeholder="Channel name"
              className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <textarea
              value={channelDesc}
              onChange={(e) => setChannelDesc(e.target.value.slice(0, 200))}
              placeholder="Description (optional)"
              rows={3}
              className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <label className="flex items-center justify-between rounded-2xl border border-border bg-input/20 px-4 py-3 text-sm">
              <span>Public channel <span className="text-xs text-muted-foreground">(anyone can discover & join)</span></span>
              <input type="checkbox" checked={channelPublic} onChange={(e) => setChannelPublic(e.target.checked)} className="h-4 w-4 accent-[#25D366]" />
            </label>
            <button
              type="button"
              data-testid="channel-create"
              onClick={createChannel}
              disabled={starting || !channelName.trim()}
              className="w-full rounded-2xl bg-[#25D366] py-3 text-sm font-semibold text-black disabled:opacity-50"
            >
              Create channel 📢
            </button>
          </div>
        ) : (
          <>
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
                  const fs = friendMap.get(u.id);
                  return (
                    <div
                      key={u.id}
                      className={`flex w-full items-center gap-3 rounded-2xl p-3 hover:bg-muted ${isPicked ? "bg-primary/10" : ""}`}
                    >
                      <button
                        type="button"
                        disabled={starting}
                        onClick={() => (mode === "group" ? togglePick(u) : startChat(u.id))}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
                      >
                        <Avatar name={u.display_name || u.username || "?"} url={u.avatar_url} size={44} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{u.display_name}</div>
                          <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                        </div>
                        {mode === "group" && isPicked && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {mode === "chat" && (
                        fs === "accepted" ? (
                          <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary">moots ✓</span>
                        ) : fs === "pending-out" ? (
                          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">pending fr ⏳</span>
                        ) : fs === "pending-in" ? (
                          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">they added u 👀</span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); addFriend(u.id); }}
                            disabled={addingId === u.id}
                            className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-[11px] font-semibold text-black disabled:opacity-50"
                          >
                            {addingId === u.id ? "…" : "add moot ➕"}
                          </button>
                        )
                      )}
                    </div>
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
          </>
        )}
      </div>
    </div>
  );
}

// Silence unused-warning for icons kept for future use.
export const _iconRef = Check;
export const _trashRef = Trash2;
export const _plusRef = Plus;

function FriendRequestsSheet({ meId, onClose }: { meId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["friends-full", meId],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("friendships")
        .select("user_a, user_b, status, requested_by, created_at");
      const otherIds = Array.from(new Set((rows ?? []).map((r) => (r.user_a === meId ? r.user_b : r.user_a))));
      const profByIdMap = new Map<string, { id: string; display_name: string | null; username: string | null; avatar_url: string | null }>();
      if (otherIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", otherIds);
        for (const p of profs ?? []) profByIdMap.set(p.id, p);
      }
      const incoming: Array<{ id: string; prof: typeof profByIdMap extends Map<string, infer V> ? V : never }> = [];
      const friends: Array<{ id: string; prof: typeof profByIdMap extends Map<string, infer V> ? V : never }> = [];
      for (const r of rows ?? []) {
        const other = r.user_a === meId ? r.user_b : r.user_a;
        const prof = profByIdMap.get(other);
        if (!prof) continue;
        if (r.status === "accepted") friends.push({ id: other, prof });
        else if (r.requested_by !== meId) incoming.push({ id: other, prof });
      }
      return { incoming, friends };
    },
  });

  const respond = async (otherId: string, accept: boolean) => {
    setBusy(otherId);
    const { error } = await supabase.rpc("respond_friend_request", { _other: otherId, _accept: accept });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(accept ? "6 7!! you're moots now 🤝✨" : "nah'd it ✕");
    qc.invalidateQueries({ queryKey: ["friends-full", meId] });
    qc.invalidateQueries({ queryKey: ["friend-requests-incoming", meId] });
    qc.invalidateQueries({ queryKey: ["friend-map", meId] });
  };

  const openChat = async (otherId: string) => {
    const { data: id, error } = await supabase.rpc("find_or_create_direct_conversation", { other_user_id: otherId });
    if (error || !id) { toast.error(error?.message || "Couldn't open chat"); return; }
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id as string } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">the moots 🤝</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 max-h-[65vh] space-y-4 overflow-y-auto">
          <section>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">moot requests 👀</div>
            {isLoading ? (
              <div className="py-3 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.incoming ?? []).length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">no requests rn — go add some moots ✨</div>
            ) : (
              <ul className="space-y-1">
                {data!.incoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl p-2">
                    <Avatar name={r.prof.display_name || r.prof.username || "?"} url={r.prof.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.prof.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">@{r.prof.username}</div>
                    </div>
                    <button disabled={busy === r.id} onClick={() => respond(r.id, true)} className="rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50">bet ✅</button>
                    <button disabled={busy === r.id} onClick={() => respond(r.id, false)} className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-50">nah ✕</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">the moots 🫶</div>
            {(data?.friends ?? []).length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">zero moots?? go rizz up the search bar 💀</div>
            ) : (
              <ul className="space-y-1">
                {data!.friends.map((r) => (
                  <button key={r.id} onClick={() => openChat(r.id)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-muted">
                    <Avatar name={r.prof.display_name || r.prof.username || "?"} url={r.prof.avatar_url} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.prof.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">@{r.prof.username}</div>
                    </div>
                    <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}



