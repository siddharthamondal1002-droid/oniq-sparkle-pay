import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { SearchClearButton } from "@/components/ui/SearchClearButton";
import {
  MessageCircle,
  Search,
  Edit3,
  X,
  Check,
  CheckCheck,
  Users,
  Trash2,
  ArrowLeft,
  Megaphone,
  Plus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";
import { useOnlineUsers } from "@/hooks/usePresence";
import { ProfilePhotoPopup, type ProfilePhotoTarget } from "@/components/chat/ProfilePhotoPopup";
import { getNativeContacts, isNativeContactsAvailable, normalizePhone } from "@/lib/nativeContacts";
import { prettyFail } from "@/lib/errorReport";

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
  peer_id: string | null;
  unread: number;
};

const AVATAR_COLORS = [
  "#0B5A4E",
  "#8B5CF6",
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#3B82F6",
  "#EC4899",
  "#14B8A6",
  "#F97316",
  "#6366F1",
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
  const onlineSet = useOnlineUsers();
  const [showNew, setShowNew] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<ProfilePhotoTarget | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<"all" | "unread" | "groups">("all");
  const [mounted, setMounted] = useState(false);
  const [actionConv, setActionConv] = useState<EnrichedConv | null>(null);
  const [deleting, setDeleting] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const startLongPress = (c: EnrichedConv) => {
    longPressFired.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      setActionConv(c);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const deleteChat = async () => {
    if (!actionConv || deleting) return;
    setDeleting(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("delete_chat", {
      _conversation_id: actionConv.id,
    });
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const deletedId = actionConv.id;
    qc.setQueriesData<EnrichedConv[] | undefined>({ queryKey: ["conversations"] }, (prev) =>
      prev ? prev.filter((x) => x.id !== deletedId) : prev,
    );
    qc.removeQueries({ queryKey: ["messages", deletedId] });
    toast(actionConv.type === "direct" ? "Chat deleted" : "Left and removed");
    setActionConv(null);
  };

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
      const { data } = await supabase
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", me!.id);
      return (data ?? []).map((r) => r.blocked_id);
    },
  });
  const blockedSet = useMemo(() => new Set(blockedIds), [blockedIds]);

  const { data: convs, isLoading } = useQuery({
    queryKey: ["conversations", me?.id, blockedIds.join(",")],
    enabled: !!me,
    staleTime: 30_000,
    // The key changes as auth/blocked-list resolve — keep showing the last
    // list instead of flashing "Loading…" on every landing.
    placeholderData: keepPreviousData,
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
          last_message:
            r.last_type === "image"
              ? "📷 Photo"
              : r.last_type === "voice"
                ? "🎙 Voice note"
                : r.last_type === "video"
                  ? // Video notes ride the video type with a content marker.
                    r.last_message === "__videonote__"
                    ? "🎥 Video note"
                    : "🎥 Video"
                  : r.last_type === "sticker"
                    ? `${r.last_message || "💟"} Sticker`
                    : r.last_type === "file"
                      ? `📎 ${r.last_message || "File"}`
                      : (r.last_message ?? null),
          last_sender_id: r.last_sender_id ?? null,
          last_sender_name: r.last_sender_name ?? null,
          last_created_at: r.last_created_at ?? null,
          peer_read_at: r.peer_read_at ?? null,
          peer_id: r.peer_id ?? null,
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

  // Realtime: patch the affected row in place instead of invalidating the
  // whole list — invalidating caused the list to reshuffle/animate on every
  // incoming message anywhere in the app (visible up/down jitter).
  useEffect(() => {
    if (!me) return;
    const channel = supabase
      .channel("chat-list-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const m = payload.new as any;
          if (!m?.conversation_id) return;
          const isMine = m.sender_id === me.id;
          const preview =
            m.type === "image"
              ? "📷 Photo"
              : m.type === "voice"
                ? "🎙 Voice note"
                : m.type === "video"
                  ? m.content === "__videonote__"
                    ? "🎥 Video note"
                    : "🎥 Video"
                  : m.type === "sticker"
                    ? `${m.content || "💟"} Sticker`
                    : m.type === "file"
                      ? `📎 ${m.content || "File"}`
                      : (m.content ?? null);
          qc.setQueriesData<EnrichedConv[] | undefined>({ queryKey: ["conversations"] }, (prev) => {
            if (!prev) return prev;
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;
            const row = prev[idx];
            const openHere =
              typeof window !== "undefined" &&
              window.location.pathname === `/app/chat/${m.conversation_id}`;
            const patched: EnrichedConv = {
              ...row,
              last_message: preview,
              last_sender_id: m.sender_id,
              last_created_at: m.created_at,
              updated_at: m.created_at,
              unread: isMine || openHere ? row.unread : (row.unread ?? 0) + 1,
            };
            const rest = prev.filter((_, i) => i !== idx);
            return [patched, ...rest];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${me.id}`,
        },
        () => {
          // Own last_read_at moved (e.g. read on another tab) — reconcile.
          qc.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, me]);

  // Safety-net reconcile on window focus (covers any patch we missed).
  useEffect(() => {
    const onFocus = () => qc.invalidateQueries({ queryKey: ["conversations"] });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  const filtered = useMemo(() => {
    if (!convs) return [];
    let list = convs;
    if (chip === "unread") list = list.filter((c) => (c.unread ?? 0) > 0);
    else if (chip === "groups") list = list.filter((c) => c.type === "group");
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.last_message ?? "").toLowerCase().includes(q),
    );
  }, [convs, query, chip]);

  return (
    <div className="px-4 pt-12 pb-4">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            aria-label="Back"
            className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-3xl font-bold">
            <span className="bg-gradient-to-r from-foreground via-foreground to-fuchsia-400 bg-clip-text text-transparent">
              Chats
            </span>
          </h1>
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
            className="w-full rounded-full border border-border bg-input/40 py-2.5 pl-11 pr-10 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <SearchClearButton value={query} onClear={() => setQuery("")} />
          </div>
        </div>
      )}

      <ChannelsStrip convs={convs ?? []} />

      <div
        className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none"
        data-testid="chat-filter-chips"
      >
        {(
          [
            { k: "all", label: "All" },
            { k: "unread", label: "Unread" },
            { k: "groups", label: "Groups" },
          ] as const
        ).map((c) => {
          const active = chip === c.k;
          return (
            <button
              key={c.k}
              onClick={() => setChip(c.k)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-gradient-to-r from-primary to-fuchsia-500 text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.35)]"
                  : "border border-border bg-card/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {isLoading ? (
          <ul aria-hidden className="animate-pulse">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="flex items-center gap-3 px-1 py-3">
                <div className="h-12 w-12 shrink-0 rounded-full bg-muted" />
                <div className="min-w-0 flex-1">
                  <div className="h-3.5 w-2/5 rounded bg-muted" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-muted/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {filtered.map((c) => {
              const mine = c.last_sender_id === me?.id;
              const isRead =
                mine && c.last_created_at && c.peer_read_at
                  ? new Date(c.peer_read_at).getTime() >= new Date(c.last_created_at).getTime()
                  : false;
              const isChannel = c.type === "channel";
              const online = c.type === "direct" && !!c.peer_id && onlineSet.has(c.peer_id);
              return (
                <li key={c.id}>
                  <Link
                    to="/app/chat/$conversationId"
                    params={{ conversationId: c.id }}
                    className="flex items-center gap-3 px-1 py-3 active:bg-muted/60"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setActionConv(c);
                    }}
                    onTouchStart={() => startLongPress(c)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onClick={(e) => {
                      if (longPressFired.current) {
                        e.preventDefault();
                        longPressFired.current = false;
                      }
                    }}
                  >
                    <div className="relative">
                      {/* IG-style ring: gradient when there's something unseen */}
                      <span
                        className={`isolate block rounded-full p-[2px] ${
                          c.unread > 0
                            ? "bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-primary"
                            : "bg-transparent"
                        }`}
                      >
                        <span
                          className={`block rounded-full ${c.unread > 0 ? "bg-background p-[2px]" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`View ${c.title}'s photo`}
                          onClick={(e) => {
                            // The DP answers "show me the photo", the rest of
                            // the row answers "open the chat" — WhatsApp's
                            // split, and the one users expect.
                            e.preventDefault();
                            e.stopPropagation();
                            setPhotoTarget({
                              conversationId: c.id,
                              title: c.title,
                              avatarUrl: c.avatar_url,
                              isGroup: c.type === "group",
                              isChannel,
                            });
                          }}
                        >
                          <Avatar
                            name={c.title}
                            url={c.avatar_url}
                            size={48}
                            group={c.type === "group"}
                            channel={isChannel}
                          />
                        </span>
                      </span>
                      {online && (
                        <span
                          data-testid="online-dot"
                          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-[#25D366]"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate font-semibold">
                          {isChannel ? `📢 ${c.title}` : c.title}
                        </div>
                        <div
                          className={`shrink-0 text-xs ${
                            c.unread > 0 ? "font-semibold text-[#25D366]" : "text-muted-foreground"
                          }`}
                        >
                          {convTime(c.updated_at)}
                        </div>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
                          {mine &&
                            c.type === "direct" &&
                            (isRead ? (
                              <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#25D366]" />
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
                          <span className="ml-2 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#25D366] px-1.5 text-xs font-bold text-black">
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

      {/* Compose FAB removed on Chats — it overlapped the tab bar / My Page.
          The header pencil remains the compose entry point. */}
      {showNew && me && <NewChatSheet meId={me.id} onClose={() => setShowNew(false)} />}
      {showRequests && me && (
        <FriendRequestsSheet meId={me.id} onClose={() => setShowRequests(false)} />
      )}

      {actionConv && (
        <div
          className="fixed inset-0 z-[80] flex items-end bg-black/60"
          onClick={() => setActionConv(null)}
        >
          <div
            className="w-full rounded-t-3xl border-t border-border bg-background p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <Avatar
                name={actionConv.title}
                url={actionConv.avatar_url}
                size={40}
                group={actionConv.type === "group"}
                channel={actionConv.type === "channel"}
              />
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-semibold">
                  {actionConv.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {actionConv.type === "direct"
                    ? "Deletes this chat for you only — they keep their copy. If they message you again, the chat comes back empty."
                    : actionConv.type === "channel"
                      ? "Leaves this channel and removes it from your list."
                      : "Leaves this group and removes it from your list."}
                </div>
              </div>
            </div>
            <button
              onClick={deleteChat}
              disabled={deleting}
              data-testid="delete-chat-confirm"
              className="press mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 font-semibold text-red-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {deleting
                ? "Deleting…"
                : actionConv.type === "direct"
                  ? "Delete chat"
                  : "Leave & remove"}
            </button>
            <button
              onClick={() => setActionConv(null)}
              className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {photoTarget ? (
        <ProfilePhotoPopup target={photoTarget} onClose={() => setPhotoTarget(null)} />
      ) : null}
    </div>
  );
}

function Avatar({
  name,
  url,
  size = 44,
  group = false,
  channel = false,
}: {
  name: string;
  url: string | null;
  size?: number;
  group?: boolean;
  channel?: boolean;
}) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const bg = colorFor(name || "?");
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.42 }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : channel ? (
        <span aria-hidden style={{ fontSize: size * 0.5 }}>
          📢
        </span>
      ) : group ? (
        <Users style={{ width: size * 0.5, height: size * 0.5 }} />
      ) : (
        initial
      )}
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
          className="flex shrink-0 min-h-11 items-center gap-1.5 rounded-full border border-dashed border-border bg-card/40 px-4 py-2 text-xs font-medium text-foreground"
          data-testid="discover-channels"
        >
          <Megaphone className="h-3.5 w-3.5 text-[#00D4B8]" /> Discover 📢
        </button>
        {channels.map((c) => (
          <Link
            key={c.id}
            to="/app/chat/$conversationId"
            params={{ conversationId: c.id }}
            className="flex shrink-0 min-h-11 items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2 text-xs font-medium text-primary"
          >
            📢 <span className="max-w-[9rem] truncate">{c.title}</span>
            {c.unread > 0 && (
              <span className="ml-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#25D366] px-1 text-[10px] text-black">
                {c.unread}
              </span>
            )}
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
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const {
    data: channels = [],
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["discover-channels", debounced],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_public_channels", {
        _search: debounced || undefined,
        _limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        description: string | null;
        subscriber_count: number;
      }>;
    },
  });
  const join = async (id: string) => {
    setJoining(id);
    const { error } = await supabase.rpc("join_channel", { _conversation_id: id });
    setJoining(null);
    if (error) {
      toast.error(error.message);
      return;
    }
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
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search channels"
            className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-10 text-sm focus:border-primary focus:outline-none"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <SearchClearButton value={q} onClear={() => setQ("")} />
          </div>
        </div>
        <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto">
          {isFetching ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : channels.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No public channels yet — create the first 📢
            </div>
          ) : (
            channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 p-3"
              >
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg"
                  style={{ backgroundColor: colorFor(ch.name) }}
                >
                  📢
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{ch.name}</div>
                  {ch.description && (
                    <div className="line-clamp-2 text-xs text-muted-foreground">
                      {ch.description}
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {ch.subscriber_count} subscriber{ch.subscriber_count === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  onClick={() => join(ch.id)}
                  disabled={joining === ch.id}
                  className="shrink-0 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                >
                  {joining === ch.id ? "Joining…" : "Join"}
                </button>
              </div>
            ))
          )}
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

type PickedUser = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

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
  const { data: friendMap = new Map<string, "pending-out" | "pending-in" | "accepted">() } =
    useQuery({
      queryKey: ["friend-map", meId],
      queryFn: async () => {
        const { data } = await supabase
          .from("friendships")
          .select("user_a, user_b, status, requested_by");
        const m = new Map<string, "pending-out" | "pending-in" | "accepted">();
        for (const r of data ?? []) {
          const other = r.user_a === meId ? r.user_b : r.user_a;
          m.set(
            other,
            r.status === "accepted"
              ? "accepted"
              : r.requested_by === meId
                ? "pending-out"
                : "pending-in",
          );
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
    if (error) {
      toast.error(error.message);
      return;
    }
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
      // Detail goes to the admin errors panel; the user gets one kind line.
      toast.error(
        prettyFail(
          "create-group",
          error ?? new Error("no id returned"),
          "Couldn't create the group — we've noted it and we're on it 🛠️",
        ),
      );
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
      toast.error(
        prettyFail(
          "create-channel",
          error ?? new Error("no id returned"),
          "Couldn't create the channel — we've noted it and we're on it 🛠️",
        ),
      );
      return;
    }
    toast.success("Channel is live 📢");
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: data as string } });
  };

  const hint = useMemo(() => {
    if (mode === "channel") return null;
    if (!debounced)
      return mode === "group" ? "Search users to add" : "Type a username or name to search";
    if (isFetching) return "Searching…";
    if (results.length === 0) return "No users found";
    return null;
  }, [debounced, isFetching, results.length, mode]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">
            {mode === "channel" ? "New channel 📢" : mode === "group" ? "New group 👥" : "New chat"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
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
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary"
                  >
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
              <span>
                Public channel{" "}
                <span className="text-xs text-muted-foreground">(anyone can discover & join)</span>
              </span>
              <input
                type="checkbox"
                checked={channelPublic}
                onChange={(e) => setChannelPublic(e.target.checked)}
                className="h-4 w-4 accent-[#25D366]"
              />
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
                className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-10 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <SearchClearButton value={q} onClear={() => setQ("")} />
              </div>
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
                        <Avatar
                          name={u.display_name || u.username || "?"}
                          url={u.avatar_url}
                          size={44}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{u.display_name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            @{u.username}
                          </div>
                        </div>
                        {mode === "group" && isPicked && <Check className="h-4 w-4 text-primary" />}
                      </button>
                      {mode === "chat" &&
                        (fs === "accepted" ? (
                          <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                            moots ✓
                          </span>
                        ) : fs === "pending-out" ? (
                          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                            pending fr ⏳
                          </span>
                        ) : fs === "pending-in" ? (
                          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                            they added u 👀
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addFriend(u.id);
                            }}
                            disabled={addingId === u.id}
                            className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
                          >
                            {addingId === u.id ? "…" : "add moot ➕"}
                          </button>
                        ))}
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
      const otherIds = Array.from(
        new Set((rows ?? []).map((r) => (r.user_a === meId ? r.user_b : r.user_a))),
      );
      const profByIdMap = new Map<
        string,
        {
          id: string;
          display_name: string | null;
          username: string | null;
          avatar_url: string | null;
        }
      >();
      if (otherIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .in("id", otherIds);
        for (const p of profs ?? []) profByIdMap.set(p.id, p);
      }
      const incoming: Array<{
        id: string;
        prof: typeof profByIdMap extends Map<string, infer V> ? V : never;
      }> = [];
      const friends: Array<{
        id: string;
        prof: typeof profByIdMap extends Map<string, infer V> ? V : never;
      }> = [];
      const statusMap = new Map<string, "pending-out" | "pending-in" | "accepted">();
      for (const r of rows ?? []) {
        const other = r.user_a === meId ? r.user_b : r.user_a;
        statusMap.set(
          other,
          r.status === "accepted"
            ? "accepted"
            : r.requested_by === meId
              ? "pending-out"
              : "pending-in",
        );
        const prof = profByIdMap.get(other);
        if (!prof) continue;
        if (r.status === "accepted") friends.push({ id: other, prof });
        else if (r.requested_by !== meId) incoming.push({ id: other, prof });
      }
      return { incoming, friends, statusMap };
    },
  });

  const respond = async (otherId: string, accept: boolean) => {
    setBusy(otherId);
    const { error } = await supabase.rpc("respond_friend_request", {
      _other: otherId,
      _accept: accept,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(accept ? "6 7!! you're moots now 🤝✨" : "nah'd it ✕");
    qc.invalidateQueries({ queryKey: ["friends-full", meId] });
    qc.invalidateQueries({ queryKey: ["friend-requests-incoming", meId] });
    qc.invalidateQueries({ queryKey: ["friend-map", meId] });
  };

  const openChat = async (otherId: string) => {
    const { data: id, error } = await supabase.rpc("find_or_create_direct_conversation", {
      other_user_id: otherId,
    });
    if (error || !id) {
      toast.error(error?.message || "Couldn't open chat");
      return;
    }
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: id as string } });
  };

  // ── Contacts discovery ──
  type OnOniqRow = {
    user_id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    email: string;
  };
  type PickedContact = { name: string; email: string };
  const [picking, setPicking] = useState(false);
  const [onOniq, setOnOniq] = useState<OnOniqRow[] | null>(null);
  const [notOnOniq, setNotOnOniq] = useState<PickedContact[]>([]);
  const [noEmailCount, setNoEmailCount] = useState(0);
  const [addingId, setAddingId] = useState<string | null>(null);
  // Native (Capacitor) contacts flow — separate from web email flow.
  type NativeMatch = {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
  };
  const [isNative, setIsNative] = useState(false);
  const [nativePicking, setNativePicking] = useState(false);
  const [nativeMatches, setNativeMatches] = useState<NativeMatch[] | null>(null);
  const [nativeNotCount, setNativeNotCount] = useState(0);
  const [nativeDenied, setNativeDenied] = useState(false);
  useEffect(() => {
    isNativeContactsAvailable().then(setIsNative);
  }, []);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchQ.trim()), 200);
    return () => clearTimeout(t);
  }, [searchQ]);
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["moot-search", searchDebounced, meId],
    enabled: searchDebounced.length >= 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .neq("id", meId)
        .or(`username.ilike.%${searchDebounced}%,display_name.ilike.%${searchDebounced}%`)
        .limit(15);
      return (data ?? []) as Array<{
        id: string;
        username: string | null;
        display_name: string | null;
        avatar_url: string | null;
      }>;
    },
  });

  const inviteMessage = "pull up to ONIQ — one app, every world 🌍";
  const inviteUrl = "https://oniqhub.com";

  const invite = async () => {
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await (navigator as Navigator).share({
          title: "ONIQ",
          text: inviteMessage,
          url: inviteUrl,
        });
        return;
      }
    } catch {
      return;
    }
    try {
      await (navigator as Navigator).clipboard.writeText(`${inviteMessage} ${inviteUrl}`);
      toast.success("link copied — go spam them 📋");
    } catch {
      toast.error("couldn't copy invite");
    }
  };

  const addMoot = async (otherId: string) => {
    setAddingId(otherId);
    const { error } = await supabase.rpc("send_friend_request", { _to: otherId });
    setAddingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("moot request sent 🫡");
    qc.invalidateQueries({ queryKey: ["friends-full", meId] });
    qc.invalidateQueries({ queryKey: ["friend-map", meId] });
  };

  const pickContacts = async () => {
    const nav =
      typeof navigator !== "undefined"
        ? (navigator as unknown as {
            contacts?: {
              select: (
                props: string[],
                opts: { multiple: boolean },
              ) => Promise<Array<{ name?: string[]; email?: string[] }>>;
            };
          })
        : null;
    if (!nav?.contacts || typeof nav.contacts.select !== "function") {
      toast("ur browser can't do contacts 😔 — search by @username instead 🔍");
      searchInputRef.current?.focus();
      return;
    }
    setPicking(true);
    try {
      const contacts = await nav.contacts.select(["name", "email"], { multiple: true });
      const picked: PickedContact[] = [];
      let skipped = 0;
      for (const c of contacts) {
        const name = (c.name?.[0] ?? "").trim() || "friend";
        const emails = (c.email ?? [])
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        if (emails.length === 0) {
          skipped++;
          continue;
        }
        for (const e of emails) picked.push({ name, email: e });
      }
      setNoEmailCount(skipped);
      const capped = picked.slice(0, 100);
      const uniqueEmails = Array.from(new Set(capped.map((p) => p.email)));
      const resp = await supabase.functions.invoke<{ on_oniq: OnOniqRow[]; not_on_oniq: string[] }>(
        "match-contacts",
        {
          body: { emails: uniqueEmails },
        },
      );
      if (resp.error || !resp.data) {
        toast.error(resp.error?.message || "couldn't reach ONIQ");
        setPicking(false);
        return;
      }
      const onEmails = new Set(resp.data.on_oniq.map((f) => f.email));
      setOnOniq(resp.data.on_oniq);
      // dedupe not-on-oniq by email, keep the contact name for display
      const seen = new Set<string>();
      const notOnDedup: PickedContact[] = [];
      for (const c of capped) {
        if (onEmails.has(c.email)) continue;
        if (seen.has(c.email)) continue;
        seen.add(c.email);
        notOnDedup.push(c);
      }
      setNotOnOniq(notOnDedup);
      if (resp.data.on_oniq.length === 0 && notOnDedup.length === 0)
        toast("nothing to match — try picking again");
    } catch (e) {
      const name = (e as { name?: string })?.name;
      const msg = String((e as { message?: string })?.message ?? "");
      if (name === "AbortError") {
        toast("contact picker cancelled");
      } else {
        // Never surface raw ContactsManager errors (e.g. "top frame" in WebView).
        toast("pick from contacts isn't available here — search by @username 👇");
        searchInputRef.current?.focus();
        void msg;
      }
    } finally {
      setPicking(false);
    }
  };

  const pickNativeContacts = async () => {
    setNativePicking(true);
    setNativeDenied(false);
    try {
      const res = await getNativeContacts();
      if (!res.ok) {
        if (res.denied) {
          setNativeDenied(true);
          toast("contacts permission denied — tap retry to allow");
        } else toast.error("couldn't read contacts");
        return;
      }
      const normalized = new Set<string>();
      let submitted = 0;
      for (const c of res.contacts) {
        for (const p of c.phones ?? []) {
          const n = normalizePhone(p);
          if (n) {
            normalized.add(n);
            submitted++;
          }
        }
      }
      const phones = Array.from(normalized);
      if (phones.length === 0) {
        setNativeMatches([]);
        setNativeNotCount(0);
        toast("no usable phone numbers in ur contacts");
        return;
      }
      // Batch by 500 to keep RPC payloads modest.
      const matches: NativeMatch[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < phones.length; i += 500) {
        const slice = phones.slice(i, i + 500);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rows, error } = await (supabase.rpc as any)("match_contacts", {
          _phones: slice,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        for (const r of (rows ?? []) as NativeMatch[]) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            matches.push(r);
          }
        }
      }
      setNativeMatches(matches);
      setNativeNotCount(Math.max(0, phones.length - matches.length));
      void submitted;
    } catch (e) {
      toast.error(String((e as { message?: string })?.message ?? "contacts failed"));
    } finally {
      setNativePicking(false);
    }
  };

  const contactsSupported =
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof (navigator as unknown as { contacts?: { select?: unknown } }).contacts?.select ===
      "function" &&
    typeof window !== "undefined" &&
    window.top === window.self;

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 pb-8 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">the moots 🤝</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="search @username or name 🔍"
            className="w-full rounded-full border border-border bg-input/40 py-2.5 pl-11 pr-10 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            data-testid="moots-search-input"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <SearchClearButton
              value={searchQ}
              onClear={() => setSearchQ("")}
              inputRef={searchInputRef}
            />
          </div>
        </div>
        {searchDebounced.length >= 1 && (
          <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-border/60">
            {searching ? (
              <div className="py-3 text-center text-xs text-muted-foreground">searching…</div>
            ) : searchResults.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">no ppl found</div>
            ) : (
              <ul className="divide-y divide-border/40">
                {searchResults.map((u) => {
                  const fs = data?.statusMap.get(u.id);
                  return (
                    <li key={u.id} className="flex items-center gap-3 p-2">
                      <Avatar
                        name={u.display_name || u.username || "?"}
                        url={u.avatar_url}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{u.display_name}</div>
                        <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                      </div>
                      {fs === "accepted" ? (
                        <button
                          onClick={() => openChat(u.id)}
                          className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"
                        >
                          chat 💬
                        </button>
                      ) : fs === "pending-out" ? (
                        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                          pending ⏳
                        </span>
                      ) : fs === "pending-in" ? (
                        <button
                          disabled={busy === u.id}
                          onClick={() => respond(u.id, true)}
                          className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
                        >
                          accept ✅
                        </button>
                      ) : (
                        <button
                          disabled={addingId === u.id}
                          onClick={() => addMoot(u.id)}
                          className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
                        >
                          {addingId === u.id ? "…" : "add moot ➕"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <div className="mt-3 max-h-[65vh] space-y-4 overflow-y-auto">
          <section>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              moot requests 👀
            </div>
            {isLoading ? (
              <div className="py-3 text-sm text-muted-foreground">Loading…</div>
            ) : (data?.incoming ?? []).length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">
                no requests rn — go add some moots ✨
              </div>
            ) : (
              <ul className="space-y-1">
                {data!.incoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-2xl p-2">
                    <Avatar
                      name={r.prof.display_name || r.prof.username || "?"}
                      url={r.prof.avatar_url}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.prof.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        @{r.prof.username}
                      </div>
                    </div>
                    <button
                      disabled={busy === r.id}
                      onClick={() => respond(r.id, true)}
                      className="rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
                    >
                      bet ✅
                    </button>
                    <button
                      disabled={busy === r.id}
                      onClick={() => respond(r.id, false)}
                      className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-50"
                    >
                      nah ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {contactsSupported && (
              <button
                type="button"
                onClick={pickContacts}
                disabled={picking}
                className="mt-2 w-full rounded-2xl bg-[#25D366] py-3 text-sm font-semibold text-black disabled:opacity-50"
              >
                {picking ? "checking your contacts…" : "find ur ppl 📇"}
              </button>
            )}

            {noEmailCount > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                {noEmailCount} contact{noEmailCount === 1 ? "" : "s"} had no email — ONIQ matches by
                email for now
              </div>
            )}

            {isNative && (
              <button
                type="button"
                onClick={pickNativeContacts}
                disabled={nativePicking}
                className="mt-2 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {nativePicking ? "reading ur contacts…" : "Find friends from contacts 📇"}
              </button>
            )}
            {isNative && nativeDenied && (
              <div className="mt-2 flex items-center justify-between rounded-2xl border border-border/60 p-2 text-xs">
                <span className="text-muted-foreground">
                  contacts access blocked — enable it to match ur ppl
                </span>
                <button
                  onClick={pickNativeContacts}
                  className="rounded-full bg-primary/15 px-2.5 py-1 font-semibold text-primary"
                >
                  retry
                </button>
              </div>
            )}
            {nativeMatches !== null && (
              <div className="mt-3 space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  on ONIQ ✨
                </div>
                {nativeMatches.length === 0 ? (
                  <div className="py-2 text-sm text-muted-foreground">
                    none of ur contacts are on ONIQ yet — invite below 📤
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {nativeMatches.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 rounded-2xl p-2">
                        <Avatar
                          name={m.display_name || m.username || "?"}
                          url={m.avatar_url}
                          size={40}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{m.display_name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            @{m.username}
                          </div>
                        </div>
                        <button
                          onClick={() => openChat(m.id)}
                          className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"
                        >
                          chat 💬
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {nativeNotCount > 0 && (
                  <div className="flex items-center justify-between rounded-2xl border border-border/60 p-2">
                    <span className="text-xs text-muted-foreground">
                      {nativeNotCount} contact{nativeNotCount === 1 ? "" : "s"} not on ONIQ yet
                    </span>
                    <button
                      onClick={invite}
                      className="rounded-full bg-[#25D366] px-3 py-1 text-xs font-semibold text-black"
                    >
                      Invite 📤
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          {onOniq !== null && (
            <>
              <section>
                <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  already here 😎
                </div>
                {onOniq.length === 0 ? (
                  <div className="py-3 text-sm text-muted-foreground">
                    none of ur ppl are on ONIQ yet — drag them in below 📤
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {onOniq.map((f) => {
                      const fs = data?.statusMap.get(f.user_id);
                      return (
                        <li key={f.user_id} className="flex items-center gap-3 rounded-2xl p-2">
                          <Avatar
                            name={f.display_name || f.username || "?"}
                            url={f.avatar_url}
                            size={40}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{f.display_name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              @{f.username}
                            </div>
                          </div>
                          {fs === "accepted" ? (
                            <button
                              onClick={() => openChat(f.user_id)}
                              className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary"
                            >
                              moots ✓
                            </button>
                          ) : fs === "pending-out" ? (
                            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                              pending fr ⏳
                            </span>
                          ) : fs === "pending-in" ? (
                            <button
                              disabled={busy === f.user_id}
                              onClick={() => respond(f.user_id, true)}
                              className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
                            >
                              accept ✅
                            </button>
                          ) : (
                            <button
                              onClick={() => addMoot(f.user_id)}
                              disabled={addingId === f.user_id}
                              className="shrink-0 rounded-full bg-[#25D366] px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-50"
                            >
                              {addingId === f.user_id ? "…" : "add moot ➕"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section>
                <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  drag them in 📤
                </div>
                {notOnOniq.length === 0 ? (
                  <div className="py-3 text-sm text-muted-foreground">
                    everyone u picked is already here 🎉
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {notOnOniq.map((c) => (
                      <li key={c.email} className="flex items-center gap-3 rounded-2xl p-2">
                        <Avatar name={c.name} url={null} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.email}</div>
                        </div>
                        <button
                          onClick={() => invite()}
                          className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-semibold"
                        >
                          invite 📤
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          <section>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              your moots
            </div>
            {(data?.friends ?? []).length === 0 ? (
              <div className="py-3 text-sm text-muted-foreground">
                zero moots?? not for long — search someone 🔍
              </div>
            ) : (
              <ul className="space-y-1">
                {data!.friends.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openChat(r.id)}
                    className="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-muted"
                  >
                    <Avatar
                      name={r.prof.display_name || r.prof.username || "?"}
                      url={r.prof.avatar_url}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.prof.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        @{r.prof.username}
                      </div>
                    </div>
                    <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="mt-3 border-t border-border/50 pt-2 text-center text-[10px] text-muted-foreground">
          Contacts you pick are matched once and never stored 🔒
        </div>
      </div>
    </div>
  );
}
