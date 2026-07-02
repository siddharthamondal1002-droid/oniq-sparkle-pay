import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Send } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  created_at: string | null;
  is_deleted: boolean | null;
};

export const Route = createFileRoute("/_authenticated/app/chat/$conversationId")({
  component: ChatThread,
});

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

function ChatThread() {
  const { conversationId } = Route.useParams();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const { data: header } = useQuery({
    queryKey: ["conversation-header", conversationId, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data: c } = await supabase
        .from("conversations")
        .select("id, name, type, avatar_url")
        .eq("id", conversationId)
        .maybeSingle();
      if (!c) return { title: "Conversation", avatar_url: null as string | null };
      if (c.type === "direct") {
        const { data: other } = await supabase
          .from("conversation_members")
          .select("user_id, profiles(display_name, username, avatar_url)")
          .eq("conversation_id", conversationId)
          .neq("user_id", me!.id)
          .maybeSingle();
        const p = (other as any)?.profiles;
        if (p) return { title: p.display_name || p.username || "Chat", avatar_url: p.avatar_url ?? null };
      }
      return { title: c.name ?? "Group", avatar_url: c.avatar_url };
    },
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async (): Promise<Message[]> => {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, type, created_at, is_deleted")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      return data ?? [];
    },
  });

  const markRead = () => {
    supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
  };

  // Realtime subscription scoped to this conversation.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          qc.setQueryData<Message[]>(["messages", conversationId], (prev) => {
            const list = prev ?? [];
            if (list.some((x) => x.id === m.id)) return list;
            return [...list, m];
          });
          markRead();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  // Mark read on open + when message list changes.
  useEffect(() => {
    markRead();
  }, [conversationId, messages.length]);

  // Autoscroll to bottom on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || !me) return;
    setSending(true);
    setText("");
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me.id,
      content,
      type: "text",
    });
    if (error) {
      console.error("send failed", error);
      setText(content);
    } else {
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId);
      markRead();
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const title = header?.title ?? "Conversation";

  // Build message list with day separators.
  const visible = messages.filter((m) => !m.is_deleted);
  const rendered: Array<{ kind: "day"; key: string; label: string } | { kind: "msg"; key: string; m: Message }> = [];
  let lastDay = "";
  for (const m of visible) {
    const d = m.created_at ? new Date(m.created_at) : new Date();
    const key = format(d, "yyyy-MM-dd");
    if (key !== lastDay) {
      rendered.push({ kind: "day", key: `d-${key}`, label: dayLabel(d) });
      lastDay = key;
    }
    rendered.push({ kind: "msg", key: m.id, m });
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-3 border-b border-border/60 bg-background/80 px-4 pb-3 pt-12 backdrop-blur">
        <Link to="/app/chat" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-primary-foreground">
          {header?.avatar_url ? (
            <img src={header.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            title.charAt(0).toUpperCase()
          )}
        </div>
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">Live · realtime</div>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="text-center text-sm text-muted-foreground">Loading…</div>
        ) : rendered.length === 0 ? (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            No messages yet. Say hi 👋
          </div>
        ) : (
          rendered.map((r) => {
            if (r.kind === "day") {
              return (
                <div key={r.key} className="my-3 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {r.label}
                  </span>
                </div>
              );
            }
            const m = r.m;
            const mine = m.sender_id === me?.id;
            return (
              <div key={r.key} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm ${
                    mine
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-border bg-card text-foreground"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  <div
                    className={`mt-0.5 text-right text-[10px] ${
                      mine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {m.created_at ? format(new Date(m.created_at), "HH:mm") : ""}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-border/60 bg-background/95 px-3 pb-6 pt-3 backdrop-blur"
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          className="flex-1 rounded-full border border-border bg-input/40 px-4 py-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground transition disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
