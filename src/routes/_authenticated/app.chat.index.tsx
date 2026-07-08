import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Search, Edit3, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  updated_at: string | null;
  last_message: string | null;
  unread: number;
};

function ChatList() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: convs, isLoading } = useQuery({
    queryKey: ["conversations", me?.id],
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
          .map(async (r): Promise<EnrichedConv> => {
            const c = r.conversations!;
            let title = c.name ?? "Chat";
            let avatar = c.avatar_url;
            if (c.type === "direct") {
              const { data: other } = await supabase
                .from("conversation_members")
                .select("user_id, profiles(display_name, username, avatar_url)")
                .eq("conversation_id", c.id)
                .neq("user_id", me!.id)
                .maybeSingle();
              const p = (other as any)?.profiles;
              if (p) {
                title = p.display_name || p.username || "Chat";
                avatar = p.avatar_url ?? avatar;
              }
            }
            const { data: last } = await supabase
              .from("messages")
              .select("content, created_at")
              .eq("conversation_id", c.id)
              .eq("is_deleted", false)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const { data: unread } = await supabase.rpc("unread_count", {
              _conversation_id: c.id,
            });
            return {
              id: c.id,
              title,
              avatar_url: avatar,
              updated_at: last?.created_at ?? c.updated_at,
              last_message: last?.content ?? null,
              unread: (unread as number) ?? 0,
            };
          }),
      );
      enriched.sort((a, b) => {
        const ta = new Date(a.updated_at ?? 0).getTime();
        const tb = new Date(b.updated_at ?? 0).getTime();
        return tb - ta;
      });
      return enriched;
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

  return (
    <div className="px-5 pt-12 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Chats</h1>
        <button
          onClick={() => setShowNew(true)}
          className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"
          aria-label="New chat"
        >
          <Edit3 className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder="Search chats"
          className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      <div className="mt-5 space-y-1">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : convs && convs.length > 0 ? (
          convs.map((c) => (
            <Link
              key={c.id}
              to="/app/chat/$conversationId"
              params={{ conversationId: c.id }}
              className="flex items-center gap-3 rounded-2xl p-3 hover:bg-muted"
            >
              <div className="relative grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-foreground font-bold overflow-hidden">
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  c.title.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="shrink-0 text-[10px] text-muted-foreground">
                    {c.updated_at
                      ? formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })
                      : ""}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-xs text-muted-foreground">
                    {c.last_message ?? "No messages yet"}
                  </div>
                  {c.unread > 0 && (
                    <span className="ml-2 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))
        ) : (
          <EmptyChats onNew={() => setShowNew(true)} />
        )}
      </div>

      {showNew && me && <NewChatSheet meId={me.id} onClose={() => setShowNew(false)} />}
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

function NewChatSheet({ meId, onClose }: { meId: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

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
      return data ?? [];
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
      return;
    }
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: data as string } });
  };

  const hint = useMemo(() => {
    if (!debounced) return "Type a username or name to search";
    if (isFetching) return "Searching…";
    if (results.length === 0) return "No users found";
    return null;
  }, [debounced, isFetching, results.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center">
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-background p-5 sm:rounded-3xl sm:border">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">New chat</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search @username"
            className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-11 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <div className="mt-4 max-h-[50vh] space-y-1 overflow-y-auto">
          {hint ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{hint}</div>
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                disabled={starting}
                onClick={() => startChat(u.id)}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-muted disabled:opacity-50"
              >
                <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-accent font-bold text-primary-foreground">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (u.display_name || u.username || "?").charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{u.display_name}</div>
                  <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
