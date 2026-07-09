import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Phone, Send, Video, Smile, Mic, Check, CheckCheck } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { CallOverlay, type CallHandle } from "@/components/chat/CallOverlay";

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
  return format(d, "d MMMM yyyy");
}

const AVATAR_COLORS = [
  "#0B5A4E", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981",
  "#3B82F6", "#EC4899", "#14B8A6", "#F97316", "#6366F1",
];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function isSystemMessage(m: Message): boolean {
  return m.type === "system" || m.type === "call" || (m.content?.startsWith("📞") ?? false);
}

function ChatThread() {
  const { conversationId } = Route.useParams();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<CallHandle>(null);
  const typingChanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user ?? null,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Peer's last_read_at → drives read ticks.
  const { data: peerReadAt, refetch: refetchPeerRead } = useQuery({
    queryKey: ["peer-read", conversationId, me?.id],
    enabled: !!me,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("conversation_members")
        .select("last_read_at")
        .eq("conversation_id", conversationId)
        .neq("user_id", me!.id)
        .maybeSingle();
      return data?.last_read_at ?? null;
    },
  });

  const markRead = () => {
    supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
  };

  // Realtime: messages + peer read receipts + typing broadcast.
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
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          refetchPeerRead();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc, refetchPeerRead]);

  // Typing channel (broadcast).
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = payload.payload as any;
      if (!p || p.user_id === me.id) return;
      if (p.state === "start") {
        setPeerTyping(true);
        if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = setTimeout(() => setPeerTyping(false), 4500);
      } else {
        setPeerTyping(false);
      }
    });
    ch.subscribe();
    typingChanRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      typingChanRef.current = null;
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    };
  }, [conversationId, me]);

  const emitTyping = (state: "start" | "stop") => {
    if (!me || !typingChanRef.current) return;
    typingChanRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: me.id, state },
    });
  };

  const handleTextChange = (v: string) => {
    setText(v);
    if (!v.trim()) {
      emitTyping("stop");
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2500) {
      lastTypingSentRef.current = now;
      emitTyping("start");
    }
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      emitTyping("stop");
      lastTypingSentRef.current = 0;
    }, 3000);
  };

  // Mark read on open + when message list changes.
  useEffect(() => {
    markRead();
  }, [conversationId, messages.length]);

  // Autoscroll on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, peerTyping]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    if (!me) {
      toast.error("You're signed out — please sign in again");
      return;
    }
    setSending(true);
    setText("");
    emitTyping("stop");
    lastTypingSentRef.current = 0;
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me.id,
      content,
      type: "text",
    });
    if (error) {
      console.error("send failed", error);
      toast.error(error.message || "Couldn't send — try again");
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
  const visible = messages.filter((m) => !m.is_deleted);

  // Build render list with day separators + grouping metadata.
  type Row =
    | { kind: "day"; key: string; label: string }
    | { kind: "system"; key: string; text: string }
    | { kind: "msg"; key: string; m: Message; firstOfGroup: boolean; lastOfGroup: boolean };
  const rendered: Row[] = [];
  let lastDay = "";
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    const d = m.created_at ? new Date(m.created_at) : new Date();
    const dayKey = format(d, "yyyy-MM-dd");
    if (dayKey !== lastDay) {
      rendered.push({ kind: "day", key: `d-${dayKey}`, label: dayLabel(d) });
      lastDay = dayKey;
    }
    if (isSystemMessage(m)) {
      rendered.push({ kind: "system", key: m.id, text: m.content ?? "" });
      continue;
    }
    const prev = visible[i - 1];
    const next = visible[i + 1];
    const sameSenderAsPrev =
      prev && !isSystemMessage(prev) && prev.sender_id === m.sender_id &&
      prev.created_at && m.created_at &&
      format(new Date(prev.created_at), "yyyy-MM-dd") === dayKey;
    const sameSenderAsNext =
      next && !isSystemMessage(next) && next.sender_id === m.sender_id &&
      next.created_at && m.created_at &&
      format(new Date(next.created_at), "yyyy-MM-dd") === dayKey;
    rendered.push({
      kind: "msg",
      key: m.id,
      m,
      firstOfGroup: !sameSenderAsPrev,
      lastOfGroup: !sameSenderAsNext,
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 bg-background/80 px-2 pb-3 pt-12 backdrop-blur">
        <Link to="/app/chat" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div
          className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
          style={{ backgroundColor: colorFor(title) }}
        >
          {header?.avatar_url ? (
            <img src={header.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            title.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {peerTyping ? <span className="text-[#25D366]">typing…</span> : "online"}
          </div>
        </div>
        <button
          data-testid="call-audio"
          onClick={() => callRef.current?.startCall("audio")}
          aria-label="Voice call"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <Phone className="h-5 w-5" />
        </button>
        <button
          data-testid="call-video"
          onClick={() => callRef.current?.startCall("video")}
          aria-label="Video call"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <Video className="h-5 w-5" />
        </button>
      </header>

      <CallOverlay
        ref={callRef}
        conversationId={conversationId}
        meId={me?.id}
        meName={
          (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.display_name ||
          (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)?.full_name ||
          me?.email ||
          "Someone"
        }
        peerName={title}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {isLoading ? (
          <div className="text-center text-sm text-muted-foreground">Loading…</div>
        ) : rendered.length === 0 ? (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            No messages yet. Say hi 👋
          </div>
        ) : (
          rendered.map((r, idx) => {
            if (r.kind === "day") {
              return (
                <div key={r.key} className="my-3 flex items-center justify-center">
                  <span className="rounded-full bg-card/80 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                    {r.label}
                  </span>
                </div>
              );
            }
            if (r.kind === "system") {
              return (
                <div key={r.key} className="my-2 flex items-center justify-center">
                  <span className="rounded-full bg-card/80 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
                    {r.text}
                  </span>
                </div>
              );
            }
            const { m, firstOfGroup, lastOfGroup } = r;
            const mine = m.sender_id === me?.id;
            const groupGap = firstOfGroup ? "mt-2.5" : "mt-[2px]";
            // Prev row for tail decision — safe lookup
            const prev = rendered[idx - 1];
            const isFirstAfterBreak = firstOfGroup || (prev && prev.kind !== "msg");
            const bubbleRadius = mine
              ? isFirstAfterBreak
                ? "rounded-2xl rounded-tr-sm"
                : "rounded-2xl"
              : isFirstAfterBreak
                ? "rounded-2xl rounded-tl-sm"
                : "rounded-2xl";
            const isRead =
              mine && peerReadAt && m.created_at
                ? new Date(peerReadAt).getTime() >= new Date(m.created_at).getTime()
                : false;
            return (
              <div key={r.key} className={`flex ${mine ? "justify-end" : "justify-start"} ${groupGap}`}>
                <div
                  className={`max-w-[78%] px-3 py-1.5 text-sm shadow-sm ${bubbleRadius} ${
                    mine
                      ? "bg-[#0B5A4E] text-white"
                      : "border border-border bg-card text-foreground"
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words leading-snug">{m.content}</div>
                  <div
                    className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                      mine ? "text-white/70" : "text-muted-foreground"
                    }`}
                  >
                    <span>{m.created_at ? format(new Date(m.created_at), "HH:mm") : ""}</span>
                    {mine &&
                      (isRead ? (
                        <CheckCheck className="h-3.5 w-3.5 text-[#53BDEB]" />
                      ) : (
                        <CheckCheck className="h-3.5 w-3.5 text-white/70" />
                      ))}
                    {/* keep single-tick icon available for future "sent-only" state */}
                    {mine && lastOfGroup && false && <Check className="h-3 w-3" />}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {peerTyping && (
          <div className="mt-2 flex justify-start">
            <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-border/60 bg-background/95 px-3 pb-6 pt-3 backdrop-blur"
      >
        <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-input/40 pl-3 pr-2">
          <Smile className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            data-testid="chat-input"
            ref={inputRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onBlur={() => emitTyping("stop")}
            placeholder="Message"
            className="flex-1 bg-transparent py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        {text.trim() ? (
          <button
            data-testid="chat-send"
            type="submit"
            disabled={sending}
            className="grid h-11 w-11 place-items-center rounded-full bg-[#0B5A4E] text-white transition active:scale-95 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => toast("voice notes coming soon 🎙")}
            className="grid h-11 w-11 place-items-center rounded-full bg-[#0B5A4E] text-white transition active:scale-95"
            aria-label="Voice note"
          >
            <Mic className="h-5 w-5" />
          </button>
        )}
      </form>
    </div>
  );
}
