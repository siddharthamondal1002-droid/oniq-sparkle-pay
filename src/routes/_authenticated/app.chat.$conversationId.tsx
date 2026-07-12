import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Phone, Send, Video, Smile, Mic, Check, CheckCheck, Reply, Trash2, X, MoreVertical, Flag, Ban, Sparkles, Users, UserPlus, LogOut, Paperclip, Play, Pause, Share2, Pencil, Star, Search } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import { CallOverlay, type CallHandle } from "@/components/chat/CallOverlay";
import { ReportSheet, type ReportTarget } from "@/components/safety/ReportSheet";
import { useIsOnline } from "@/hooks/usePresence";
import { sendPush } from "@/lib/push";

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  duration_s: number | null;
  created_at: string | null;
  is_deleted: boolean | null;
  reply_to_id: string | null;
  is_ai: boolean | null;
  file_name: string | null;
  file_size: number | null;
  edited_at: string | null;
  starred_by: string[] | null;
};

type Reaction = { id: string; message_id: string; user_id: string; emoji: string };

const REACTION_EMOJIS = ["❤️", "😂", "👍", "😮", "😢", "🙏"] as const;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function truncateMiddle(s: string, max = 32) {
  if (!s || s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

const SIGNED_TTL = 60 * 60 * 24 * 365 * 5;

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

function truncate(s: string, n = 80) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function ChatThread() {
  const { conversationId } = Route.useParams();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const callRef = useRef<CallHandle>(null);
  const typingChanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const navigate = useNavigate();
  const [showMembersSheet, setShowMembersSheet] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getSession()).data.session?.user ?? null,
  });

  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const anyFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef<number>(0);
  const recCancelRef = useRef(false);

  const { data: header } = useQuery({
    queryKey: ["conversation-header", conversationId, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const { data: c } = await supabase
        .from("conversations")
        .select("id, name, type, avatar_url, description")
        .eq("id", conversationId)
        .maybeSingle();
      if (!c) return { title: "Conversation", avatar_url: null as string | null, peerId: null as string | null, isGroup: false, isChannel: false, description: null as string | null };
      if (c.type === "direct") {
        const { data: other } = await supabase
          .from("conversation_members")
          .select("user_id, profiles(display_name, username, avatar_url)")
          .eq("conversation_id", conversationId)
          .neq("user_id", me!.id)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = (other as any)?.profiles;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const peerId = (other as any)?.user_id ?? null;
        if (p) return { title: p.display_name || p.username || "Chat", avatar_url: p.avatar_url ?? null, peerId, isGroup: false, isChannel: false, description: null };
        return { title: "Chat", avatar_url: null, peerId, isGroup: false, isChannel: false, description: null };
      }
      return { title: c.name ?? (c.type === "channel" ? "Channel" : "Group"), avatar_url: c.avatar_url, peerId: null, isGroup: c.type === "group", isChannel: c.type === "channel", description: c.description ?? null };
    },
  });

  const peerId = header?.peerId ?? null;
  const isGroup = header?.isGroup ?? false;
  const isChannel = header?.isChannel ?? false;
  const peerOnline = useIsOnline(peerId);


  type GroupMember = { user_id: string; role: string; joined_at: string | null; display_name: string | null; username: string | null; avatar_url: string | null };
  const { data: members = [], refetch: refetchMembers } = useQuery({
    queryKey: ["group-members", conversationId],
    enabled: !!me && (isGroup || isChannel),
    queryFn: async (): Promise<GroupMember[]> => {
      const { data } = await supabase
        .from("conversation_members")
        .select("user_id, role, joined_at, profiles(display_name, username, avatar_url)")
        .eq("conversation_id", conversationId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => ({
        user_id: r.user_id,
        role: r.role,
        joined_at: r.joined_at,
        display_name: r.profiles?.display_name ?? null,
        username: r.profiles?.username ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
    },
  });

  const myRole = useMemo(() => members.find((m) => m.user_id === me?.id)?.role ?? null, [members, me?.id]);
  const senderMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const m of members) {
      const name = m.display_name || m.username || "Someone";
      map.set(m.user_id, { name, color: colorFor(m.user_id) });
    }
    return map;
  }, [members]);

  const [peerTypingName, setPeerTypingName] = useState<string | null>(null);


  const { data: isBlocked = false, refetch: refetchBlocked } = useQuery({
    queryKey: ["blocked", me?.id, peerId],
    enabled: !!me && !!peerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", me!.id)
        .eq("blocked_id", peerId!)
        .maybeSingle();
      return !!data;
    },
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", conversationId],
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Message[]> => {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, type, media_url, duration_s, created_at, is_deleted, reply_to_id, is_ai, file_name, file_size, edited_at, starred_by")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      return (data ?? []) as Message[];
    },
  });

  // Reactions for all messages in this conversation. Realtime refetch on any change.
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const { data: reactions = [], refetch: refetchReactions } = useQuery({
    queryKey: ["reactions", conversationId, messageIds.length],
    enabled: messageIds.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<Reaction[]> => {
      const { data } = await supabase
        .from("message_reactions")
        .select("id, message_id, user_id, emoji")
        .in("message_id", messageIds);
      return (data ?? []) as Reaction[];
    },
  });

  const reactionsByMsg = useMemo(() => {
    const m = new Map<string, Reaction[]>();
    for (const r of reactions) {
      const arr = m.get(r.message_id) ?? [];
      arr.push(r);
      m.set(r.message_id, arr);
    }
    return m;
  }, [reactions]);

  useEffect(() => {
    if (messageIds.length === 0) return;
    const ids = new Set(messageIds);
    const ch = supabase
      .channel(`reactions:${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mid = ((payload.new || payload.old) as any)?.message_id;
        if (mid && ids.has(mid)) refetchReactions();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, messageIds, refetchReactions]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!me) return;
    if (messageId.startsWith("temp-")) { toast("hang on — still sending"); return; }
    const existing = reactions.find((r) => r.message_id === messageId && r.user_id === me.id && r.emoji === emoji);
    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me.id, emoji });
    }
    refetchReactions();
  };

  const toggleStar = async (m: Message) => {
    const { error } = await supabase.rpc("toggle_message_star", { _message_id: m.id });
    if (error) { toast.error(error.message); return; }
    qc.setQueryData<Message[]>(["messages", conversationId], (prev) =>
      (prev ?? []).map((x) => {
        if (x.id !== m.id) return x;
        const arr = x.starred_by ?? [];
        const has = me && arr.includes(me.id);
        return { ...x, starred_by: has ? arr.filter((u) => u !== me!.id) : [...arr, me!.id] };
      }),
    );
    toast(me && (m.starred_by ?? []).includes(me.id) ? "Unstarred" : "Starred ⭐");
  };

  const startEdit = (m: Message) => {
    if (m.sender_id !== me?.id) return;
    if (m.type !== "text") { toast("Only text messages can be edited"); return; }
    const created = m.created_at ? new Date(m.created_at).getTime() : 0;
    if (Date.now() - created > EDIT_WINDOW_MS) { toast("Too late — 15-min edit window"); return; }
    setEditing(m);
    setText(m.content ?? "");
    setMenuFor(null);
    inputRef.current?.focus();
  };

  const submitEdit = async () => {
    if (!editing) return;
    const content = text.trim();
    if (!content) return;
    const prev = editing;
    setText("");
    setEditing(null);
    qc.setQueryData<Message[]>(["messages", conversationId], (list) =>
      (list ?? []).map((x) => (x.id === prev.id ? { ...x, content, edited_at: new Date().toISOString() } : x)),
    );
    const { error } = await supabase
      .from("messages")
      .update({ content, edited_at: new Date().toISOString() })
      .eq("id", prev.id);
    if (error) toast.error("Couldn't edit — try again");
  };

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

  const markRead = async () => {
    await supabase.rpc("mark_conversation_read", { _conversation_id: conversationId });
  };

  // Zero this conversation's unread across all cached chat-list queries,
  // then recompute the app icon badge from the summed unreads. Keeps the
  // badge death instantaneous when I open a thread or receive a message
  // while already reading it.
  const zeroUnreadInCache = () => {
    qc.setQueriesData<Array<{ id: string; unread?: number }> | undefined>(
      { queryKey: ["conversations"] },
      (prev) => {
        if (!prev) return prev;
        return prev.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c));
      },
    );
    if (typeof navigator === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    let total = 0;
    for (const [, data] of qc.getQueriesData<Array<{ unread?: number }>>({
      queryKey: ["conversations"],
    })) {
      if (Array.isArray(data)) for (const c of data) total += c?.unread ?? 0;
    }
    try {
      if (total > 0 && typeof nav.setAppBadge === "function") nav.setAppBadge(total);
      else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge();
    } catch {
      /* unsupported */
    }
  };

  // Realtime: messages INSERT + UPDATE + peer read receipts.
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
            // Dedupe: strip any optimistic temp from same sender with same content/type
            const stripped = list.filter(
              (x) =>
                !(
                  x.id.startsWith("temp-") &&
                  x.sender_id === m.sender_id &&
                  x.type === m.type &&
                  (x.content ?? "") === (m.content ?? "") &&
                  (x.media_url ?? "") === (m.media_url ?? "")
                ),
            );
            return [...stripped, m];
          });
          markRead();
          zeroUnreadInCache();
        },

      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          qc.setQueryData<Message[]>(["messages", conversationId], (prev) => {
            const list = prev ?? [];
            return list.map((x) => (x.id === m.id ? { ...x, ...m } : x));
          });
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
        const nm = senderMap.get(p.user_id)?.name?.split(/\s+/)[0] ?? null;
        setPeerTypingName(nm);
        if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
        peerTypingTimerRef.current = setTimeout(() => { setPeerTyping(false); setPeerTypingName(null); }, 4500);
      } else {
        setPeerTyping(false);
        setPeerTypingName(null);
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

  // Mark read on open + when message list changes; zero the unread count
  // in the chat-list cache so the badge dies the moment I open.
  // NOTE: intentionally NO invalidateQueries on unmount — that used to race
  // ahead of the RPC commit and overwrite the optimistic zero with stale 21.
  // Realtime UPDATE on conversation_members reconciles for peers instead.
  useEffect(() => {
    zeroUnreadInCache();
    void markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);



  // Autoscroll on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, peerTyping]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const toggleBlock = async () => {
    if (!me || !peerId) return;
    setShowHeaderMenu(false);
    if (isBlocked) {
      const { error } = await supabase.from("blocked_users").delete().eq("blocker_id", me.id).eq("blocked_id", peerId);
      if (error) { toast.error(error.message); return; }
      toast.success("Unblocked");
    } else {
      const { error } = await supabase.from("blocked_users").insert({ blocker_id: me.id, blocked_id: peerId });
      if (error) { toast.error(error.message); return; }
      toast("Blocked — you won't see their messages here 🚫");
    }
    refetchBlocked();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (editing) { await submitEdit(); return; }
    const content = text.trim();
    if (!content) return;
    if (!me) {
      toast.error("You're signed out — please sign in again");
      return;
    }
    if (isBlocked) {
      toast("You've blocked this user — unblock to chat.");
      return;
    }
    const replySnapshot = replyTo;
    // Optimistic append — instant paint
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      sender_id: me.id,
      content,
      type: "text",
      media_url: null,
      duration_s: null,
      created_at: new Date().toISOString(),
      is_deleted: false,
      reply_to_id: replySnapshot?.id ?? null,
      is_ai: false,
      file_name: null,
      file_size: null,
      edited_at: null,
      starred_by: [],
    };
    qc.setQueryData<Message[]>(["messages", conversationId], (prev) => [...(prev ?? []), optimistic]);
    setText("");
    setReplyTo(null);
    emitTyping("stop");
    lastTypingSentRef.current = 0;
    const { data: inserted, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: me.id,
        content,
        type: "text",
        reply_to_id: replySnapshot?.id ?? null,
      })
      .select("id, conversation_id, sender_id, content, type, media_url, duration_s, created_at, is_deleted, reply_to_id, is_ai, file_name, file_size")
      .single();
    if (error || !inserted) {
      console.error("send failed", error);
      toast.error(error?.message || "Couldn't send — try again");
      qc.setQueryData<Message[]>(["messages", conversationId], (prev) =>
        (prev ?? []).filter((m) => m.id !== tempId),
      );
      setText(content);
      setReplyTo(replySnapshot);
    } else {
      // Reconcile temp → real (dedupe if realtime beat us)
      qc.setQueryData<Message[]>(["messages", conversationId], (prev) => {
        const list = prev ?? [];
        const withoutTemp = list.filter((m) => m.id !== tempId);
        if (withoutTemp.some((m) => m.id === (inserted as Message).id)) return withoutTemp;
        return [...withoutTemp, inserted as Message];
      });
      supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
      markRead();
      sendPush({ conversation_id: conversationId, kind: "message", preview: content.slice(0, 60) });
    }
    inputRef.current?.focus();
  };


  const uploadToChatMedia = async (blob: Blob, ext: string): Promise<string> => {
    if (!me) throw new Error("sign in first");
    const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("chat-media")
      .upload(path, blob, { contentType: blob.type || undefined, upsert: false });
    if (upErr) throw upErr;
    const { data: signed, error: sErr } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(path, SIGNED_TTL);
    if (sErr || !signed) throw sErr ?? new Error("could not sign url");
    return signed.signedUrl;
  };

  const insertMediaMessage = async (payload: {
    type: "image" | "voice" | "video" | "file";
    media_url: string;
    duration_s?: number;
    file_name?: string;
    file_size?: number;
  }) => {
    if (!me) return;
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me.id,
      content: payload.file_name && payload.type === "file" ? payload.file_name : "",
      type: payload.type,
      media_url: payload.media_url,
      duration_s: payload.duration_s ?? null,
      file_name: payload.file_name ?? null,
      file_size: payload.file_size ?? null,
    });
    if (error) { toast.error(error.message || "Couldn't send"); return; }
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    markRead();
    const previewMap = { image: "📷 Photo", voice: "🎙 Voice note", video: "🎥 Video", file: "📎 File" } as const;
    sendPush({ conversation_id: conversationId, kind: "message", preview: previewMap[payload.type] });
  };

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast.error("images only");
    if (f.size > 10 * 1024 * 1024) return toast.error("keep it under 10MB");
    if (isBlocked) return toast("You've blocked this user — unblock to chat.");
    setUploading(true);
    try {
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const url = await uploadToChatMedia(f, ext);
      await insertMediaMessage({ type: "image", media_url: url });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePickVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^video\//.test(f.type)) return toast.error("videos only");
    if (f.size > 100 * 1024 * 1024) return toast.error("keep it under 100MB");
    if (isBlocked) return toast("You've blocked this user — unblock to chat.");
    const rawExt = (f.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
    const allowed = ["mp4", "mov", "webm", "mkv"];
    const ext = allowed.includes(rawExt) ? rawExt : "mp4";
    setUploading(true);
    try {
      const url = await uploadToChatMedia(f, ext);
      await insertMediaMessage({ type: "video", media_url: url, file_name: f.name, file_size: f.size });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handlePickAnyFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return toast.error("keep it under 50MB");
    if (isBlocked) return toast("You've blocked this user — unblock to chat.");
    const rawExt = (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const banned = ["exe", "apk", "bat", "sh", "cmd", "msi", "dll", "com", "scr", "ps1"];
    if (!rawExt || banned.includes(rawExt)) {
      return toast.error("that file type isn't allowed 🚫");
    }
    const allowed = [
      "jpg","jpeg","png","webp","gif",
      "webm","m4a","mp3","ogg","wav",
      "mp4","mov","mkv",
      "pdf","doc","docx","xls","xlsx","ppt","pptx","txt","csv","json",
      "zip","rar",
    ];
    if (!allowed.includes(rawExt)) return toast.error(`.${rawExt} isn't supported yet`);
    setUploading(true);
    try {
      const url = await uploadToChatMedia(f, rawExt);
      await insertMediaMessage({ type: "file", media_url: url, file_name: f.name, file_size: f.size });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };


  const startRecording = async () => {
    if (isBlocked) return toast("You've blocked this user — unblock to chat.");
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      recChunksRef.current = [];
      recCancelRef.current = false;
      rec.ondataavailable = (ev) => { if (ev.data.size) recChunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        const cancel = recCancelRef.current;
        const dur = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
        setRecording(false);
        setRecSeconds(0);
        if (cancel || recChunksRef.current.length === 0) return;
        const type = rec.mimeType || "audio/webm";
        const blob = new Blob(recChunksRef.current, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        setUploading(true);
        try {
          const url = await uploadToChatMedia(blob, ext);
          await insertMediaMessage({ type: "voice", media_url: url, duration_s: dur });
        } catch (err) {
          console.error(err);
          toast.error(err instanceof Error ? err.message : "upload failed");
        } finally {
          setUploading(false);
        }
      };
      recStartRef.current = Date.now();
      setRecSeconds(0);
      rec.start();
      setRecording(true);
      recTimerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - recStartRef.current) / 1000);
        setRecSeconds(s);
        if (s >= 120) stopRecording(false);
      }, 250);
    } catch (err) {
      console.error(err);
      toast.error("mic permission denied");
    }
  };

  const stopRecording = (cancel: boolean) => {
    if (!recorderRef.current) return;
    recCancelRef.current = cancel;
    try { recorderRef.current.stop(); } catch { /* noop */ }
    if (cancel) {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
      if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
      setRecording(false);
      setRecSeconds(0);
    }
  };

  useEffect(() => () => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }, []);


  const deleteForEveryone = async (m: Message) => {
    setMenuFor(null);
    // Optimistic
    qc.setQueryData<Message[]>(["messages", conversationId], (prev) =>
      (prev ?? []).map((x) => (x.id === m.id ? { ...x, is_deleted: true, content: null } : x)),
    );
    const { error } = await supabase
      .from("messages")
      .update({ is_deleted: true, content: null })
      .eq("id", m.id);
    if (error) {
      toast.error("Couldn't delete — try again");
      console.error(error);
    }
  };

  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#00D4B8]");
      setTimeout(() => el.classList.remove("ring-2", "ring-[#00D4B8]"), 1200);
    }
  };

  const title = header?.title ?? "Conversation";
  // Filter out messages from blocked peer while blocked (client-side hide)
  const baseVisible = isBlocked && peerId
    ? messages.filter((m) => m.sender_id !== peerId)
    : messages;
  const searchTerm = searchQ.trim().toLowerCase();
  const visible = searchTerm
    ? baseVisible.filter((m) => (m.content ?? "").toLowerCase().includes(searchTerm))
    : baseVisible;

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

  const startPress = (m: Message, e: React.TouchEvent) => {
    if (m.is_deleted) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    swipedRef.current = false;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setMenuFor(m);
    }, 450);
  };
  const moveTouch = (m: Message, e: React.TouchEvent) => {
    if (m.is_deleted) return;
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    }
    if (dx > 60 && Math.abs(dy) < 30 && !swipedRef.current) {
      swipedRef.current = true;
      setReplyTo(m);
    }
  };
  const endPress = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    touchStartRef.current = null;
  };

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 bg-background/80 px-2 pb-3 pt-12 backdrop-blur">
        <Link to="/app/chat" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={() => (isGroup || isChannel) && setShowMembersSheet(true)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <div
            className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: colorFor(title) }}
          >
            {header?.avatar_url ? (
              <img src={header.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : isChannel ? (
              <span aria-hidden>📢</span>
            ) : isGroup ? (
              <Users className="h-5 w-5" />
            ) : (
              title.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{isChannel ? `📢 ${title}` : title}</div>
            <div className="text-xs text-muted-foreground">
              {peerTyping && !isChannel ? (
                <span className="text-[#25D366]">
                  {isGroup && peerTypingName ? `${peerTypingName} is typing…` : "typing…"}
                </span>
              ) : isChannel ? (
                `${members.length} subscriber${members.length === 1 ? "" : "s"}`
              ) : isGroup ? (
                `${members.length} member${members.length === 1 ? "" : "s"}`
              ) : peerOnline ? (
                <span className="inline-flex items-center gap-1" data-testid="peer-online">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#25D366]" />
                  <span className="text-[#25D366]">online</span>
                </span>
              ) : null}
            </div>
          </div>
        </button>
        {!isGroup && !isChannel && (

          <>
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
          </>
        )}
        <button
          type="button"
          data-testid="chat-search-toggle"
          onClick={() => { setShowSearch((v) => !v); if (showSearch) setSearchQ(""); }}
          aria-label="Search in chat"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <Search className="h-5 w-5" />
        </button>
        <div className="relative">
          <button
            data-testid="chat-menu"
            onClick={() => setShowHeaderMenu((v) => !v)}
            aria-label="More"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
          {showHeaderMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowHeaderMenu(false)} />
              <div className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                {peerId && (
                  <button
                    type="button"
                    onClick={() => { setShowHeaderMenu(false); setReportTarget({ type: "user", id: peerId, conversationId }); }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                  >
                    <Flag className="h-4 w-4" /> Report user
                  </button>
                )}
                {peerId && (
                  <button
                    type="button"
                    onClick={toggleBlock}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-500 hover:bg-muted"
                  >
                    <Ban className="h-4 w-4" /> {isBlocked ? "Unblock user" : "Block user 🚫"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            data-testid="chat-search-input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search in conversation…"
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button type="button" onClick={() => { setSearchQ(""); setShowSearch(false); }} className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}


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
                  <span className="rounded-full bg-card/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                    {r.label}
                  </span>
                </div>
              );
            }
            if (r.kind === "system") {
              return (
                <div key={r.key} className="my-2 flex items-center justify-center">
                  <span className="rounded-full bg-card/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                    {r.text}
                  </span>
                </div>
              );
            }
            const { m, firstOfGroup, lastOfGroup } = r;
            const mine = m.sender_id === me?.id;
            const groupGap = firstOfGroup ? "mt-2.5" : "mt-[2px]";
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

            if (m.is_deleted) {
              return (
                <div key={r.key} id={`msg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${groupGap}`}>
                  <div className={`max-w-[78%] px-3 py-1.5 text-sm italic text-muted-foreground shadow-sm ${bubbleRadius} ${mine ? "bg-[#0B5A4E]/40" : "border border-border bg-card"}`}>
                    <div className="flex items-center gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>This message was deleted</span>
                    </div>
                  </div>
                </div>
              );
            }

            const quoted = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : null;
            const quotedSenderName = quoted
              ? quoted.sender_id === me?.id
                ? "You"
                : title
              : null;

            return (
              <div key={r.key} id={`msg-${m.id}`} className={`flex ${mine ? "justify-end" : "justify-start"} ${groupGap} transition-shadow`}>
                <div
                  onTouchStart={(e) => startPress(m, e)}
                  onTouchMove={(e) => moveTouch(m, e)}
                  onTouchEnd={endPress}
                  onTouchCancel={endPress}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuFor(m);
                  }}
                  className={`group relative max-w-[78%] px-3 py-1.5 text-sm shadow-sm ${bubbleRadius} ${
                    mine
                      ? "bg-[#0B5A4E] text-white"
                      : "border border-border bg-card text-foreground"
                  }`}
                >
                  {isGroup && !mine && firstOfGroup && (() => {
                    const sm = senderMap.get(m.sender_id);
                    if (!sm) return null;
                    return (
                      <div className="mb-0.5 text-xs font-semibold" style={{ color: sm.color }}>
                        {sm.name}
                      </div>
                    );
                  })()}
                  {quoted && (
                    <button
                      type="button"
                      onClick={() => scrollToMessage(quoted.id)}
                      className={`mb-1 block w-full rounded-md border-l-2 border-[#00D4B8] px-2 py-1 text-left text-xs ${mine ? "bg-black/20" : "bg-muted/60"}`}
                    >
                      <div className="font-semibold text-[#00D4B8]">
                        {quoted.sender_id === me?.id ? "You" : (senderMap.get(quoted.sender_id)?.name || title || "Message")}
                      </div>
                      <div className={`truncate ${mine ? "text-white/80" : "text-muted-foreground"}`}>
                        {quoted.is_deleted ? "This message was deleted" : truncate(quoted.content ?? "", 80)}
                      </div>
                    </button>
                  )}
                  {m.is_ai && (
                    <div className={`mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${mine ? "bg-white/15 text-white/90" : "bg-primary/15 text-primary"}`}>
                      <Sparkles className="h-2.5 w-2.5" /> AI-generated
                    </div>
                  )}
                  {m.type === "image" && m.media_url ? (
                    <button type="button" onClick={() => setViewerUrl(m.media_url!)} className="block overflow-hidden rounded-xl">
                      <img
                        src={m.media_url}
                        alt=""
                        loading="lazy"
                        className="max-h-64 w-full object-cover"
                        onError={(e) => {
                          const el = e.currentTarget;
                          el.replaceWith(Object.assign(document.createElement("div"), { textContent: "📷", className: "grid h-32 w-40 place-items-center text-3xl bg-black/20 rounded-xl" }));
                        }}
                      />
                    </button>
                  ) : m.type === "voice" && m.media_url ? (
                    <VoiceBubble url={m.media_url} durationS={m.duration_s ?? 0} mine={mine} />
                  ) : m.type === "video" && m.media_url ? (
                    <video
                      src={m.media_url}
                      controls
                      playsInline
                      preload="metadata"
                      className="max-h-64 w-full rounded-xl bg-black"
                    />
                  ) : m.type === "file" && m.media_url ? (
                    <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${mine ? "bg-white/10 backdrop-blur" : "border border-border bg-muted/60"}`}>
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/25 text-lg">📄</div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-medium ${mine ? "text-white" : "text-foreground"}`}>
                          {truncateMiddle(m.file_name || "File", 30)}
                        </div>
                        {m.file_size ? (
                          <div className={`text-xs ${mine ? "text-white/70" : "text-muted-foreground"}`}>{humanSize(m.file_size)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => window.open(m.media_url!, "_blank", "noopener,noreferrer")}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${mine ? "bg-white/20 text-white" : "bg-primary/15 text-primary"}`}
                      >
                        Open
                      </button>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words leading-snug">{m.content}</div>
                  )}
                  <div
                    className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                      mine ? "text-white/70" : "text-muted-foreground"
                    }`}
                  >
                    {m.edited_at && <span className="italic">edited</span>}
                    {me && (m.starred_by ?? []).includes(me.id) && (
                      <Star className={`h-3 w-3 ${mine ? "fill-yellow-300 text-yellow-300" : "fill-yellow-500 text-yellow-500"}`} />
                    )}
                    <span>{m.created_at ? format(new Date(m.created_at), "HH:mm") : ""}</span>
                    {mine && (isGroup || isChannel) ? (
                      <Check className="h-3.5 w-3.5 text-white/70" />
                    ) : mine ? (
                      isRead ? (
                        <CheckCheck className="h-3.5 w-3.5 text-[#25D366]" />
                      ) : (
                        <CheckCheck className="h-3.5 w-3.5 text-white/70" />
                      )
                    ) : null}
                    {mine && lastOfGroup && false && <Check className="h-3 w-3" />}
                  </div>
                  {(() => {
                    const rx = reactionsByMsg.get(m.id) ?? [];
                    if (rx.length === 0) return null;
                    const counts = new Map<string, { count: number; mine: boolean }>();
                    for (const r of rx) {
                      const cur = counts.get(r.emoji) ?? { count: 0, mine: false };
                      cur.count += 1;
                      if (me && r.user_id === me.id) cur.mine = true;
                      counts.set(r.emoji, cur);
                    }
                    return (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Array.from(counts.entries()).map(([emoji, v]) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleReaction(m.id, emoji); }}
                            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${v.mine ? "border-[#00D4B8] bg-[#00D4B8]/20 text-foreground" : "border-border bg-background/70 text-foreground"}`}
                          >
                            <span>{emoji}</span>
                            <span className="tabular-nums">{v.count}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {/* Desktop hover Reply */}
                  <button
                    type="button"
                    onClick={() => setReplyTo(m)}
                    aria-label="Reply"
                    className="absolute -top-2 right-1 hidden h-6 w-6 place-items-center rounded-full bg-background/90 text-foreground shadow group-hover:grid"
                  >
                    <Reply className="h-3.5 w-3.5" />
                  </button>
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

      {/* Long-press action sheet */}
      {menuFor && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setMenuFor(null)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-2 pb-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="mb-2 flex items-center justify-around rounded-2xl bg-muted/40 px-2 py-2">
              {REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  data-testid={`react-${e}`}
                  onClick={() => { const f = menuFor; setMenuFor(null); toggleReaction(f.id, e); }}
                  className="grid h-10 w-10 place-items-center rounded-full text-xl transition active:scale-90 hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(menuFor);
                setMenuFor(null);
                inputRef.current?.focus();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <Reply className="h-4 w-4" /> Reply
            </button>
            <button
              type="button"
              onClick={() => { const f = menuFor; setMenuFor(null); toggleStar(f); }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <Star className="h-4 w-4" /> {me && (menuFor.starred_by ?? []).includes(me.id) ? "Unstar" : "Star ⭐"}
            </button>
            {menuFor.sender_id === me?.id && menuFor.type === "text" && !menuFor.is_deleted && menuFor.created_at && (Date.now() - new Date(menuFor.created_at).getTime() < EDIT_WINDOW_MS) && (
              <button
                type="button"
                data-testid="msg-edit"
                onClick={() => startEdit(menuFor)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
              >
                <Pencil className="h-4 w-4" /> Edit
              </button>
            )}
            {menuFor.sender_id === me?.id && (
              <button
                type="button"
                onClick={() => deleteForEveryone(menuFor)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-red-500 hover:bg-muted"
              >
                <Trash2 className="h-4 w-4" /> Delete for everyone
              </button>
            )}
            {menuFor.sender_id !== me?.id && (
              <button
                type="button"
                onClick={() => {
                  const t: ReportTarget = { type: "message", id: menuFor.id, conversationId };
                  setMenuFor(null);
                  setReportTarget(t);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-red-500 hover:bg-muted"
              >
                <Flag className="h-4 w-4" /> Report message 🚩
              </button>
            )}
            <button
              type="button"
              onClick={() => { const f = menuFor; setMenuFor(null); setForwardMsg(f); }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <Share2 className="h-4 w-4" /> Forward ↪️
            </button>
            <button
              type="button"
              onClick={() => setMenuFor(null)}
              className="mt-1 w-full rounded-xl px-4 py-3 text-center text-sm text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {reportTarget && <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />}

      {showMembersSheet && (isGroup || isChannel) && (
        <GroupMembersSheet
          conversationId={conversationId}
          groupName={title}
          meId={me?.id ?? null}
          members={members}
          myRole={myRole}
          onClose={() => setShowMembersSheet(false)}
          onChanged={() => refetchMembers()}
          onLeft={() => navigate({ to: "/app/chat" })}
        />
      )}


      {isChannel && myRole !== "owner" && myRole !== "admin" ? (
        <div className="border-t border-border/60 bg-background/95 px-4 pb-6 pt-3 text-center text-xs text-muted-foreground backdrop-blur">
          You're subscribed 🔔 · only the channel owner can post
        </div>
      ) : (
      <form
        onSubmit={send}
        className="flex flex-col gap-2 border-t border-border/60 bg-background/95 px-3 pb-6 pt-3 backdrop-blur"
      >

        {editing && (
          <div className="flex items-center gap-2 rounded-xl border-l-2 border-yellow-400 bg-muted/60 px-3 py-2">
            <Pencil className="h-4 w-4 text-yellow-400" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-yellow-400">Editing message</div>
              <div className="truncate text-xs text-muted-foreground">{truncate(editing.content ?? "", 90)}</div>
            </div>
            <button
              type="button"
              onClick={() => { setEditing(null); setText(""); }}
              aria-label="Cancel edit"
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {replyTo && (
          <div className="flex items-center gap-2 rounded-xl border-l-2 border-[#00D4B8] bg-muted/60 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[#00D4B8]">
                Replying to {replyTo.sender_id === me?.id ? "yourself" : title}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {truncate(replyTo.content ?? "", 90)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {recording ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-input/40 px-3 py-2">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="flex-1 text-sm tabular-nums text-muted-foreground">
              {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:{String(recSeconds % 60).padStart(2, "0")} • recording…
            </span>
            <button type="button" onClick={() => stopRecording(true)} aria-label="Cancel recording" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => stopRecording(false)} aria-label="Send voice" className="grid h-11 w-11 place-items-center rounded-full bg-[#0B5A4E] text-white transition active:scale-95">
              <Send className="h-5 w-5" />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePickImage} data-testid="chat-file-input" />
          <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={handlePickVideo} data-testid="chat-video-input" />
          <input ref={anyFileInputRef} type="file" hidden onChange={handlePickAnyFile} data-testid="chat-anyfile-input" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handlePickImage} data-testid="chat-camera-input" />
          <input ref={cameraVideoRef} type="file" accept="video/*" capture="environment" hidden onChange={handlePickVideo} data-testid="chat-camera-video-input" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAttachSheet((v) => !v)}
              disabled={isBlocked || uploading}
              aria-label="Attach"
              data-testid="chat-attach"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground transition active:scale-95 disabled:opacity-40"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            {showAttachSheet && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowAttachSheet(false)} />
                <div className="absolute bottom-14 left-0 z-40 w-44 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
                  <button
                    type="button"
                    data-testid="chat-attach-camera"
                    onClick={() => { setShowAttachSheet(false); cameraInputRef.current?.click(); }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-lg">📸</span> Camera
                  </button>
                  <button
                    type="button"
                    data-testid="chat-attach-camera-video"
                    onClick={() => { setShowAttachSheet(false); cameraVideoRef.current?.click(); }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-lg">🎬</span> quick vid
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAttachSheet(false); fileInputRef.current?.click(); }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-lg">📷</span> Photo
                  </button>
                  <button
                    type="button"
                    data-testid="chat-attach-video"
                    onClick={() => { setShowAttachSheet(false); videoInputRef.current?.click(); }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-lg">🎥</span> Video
                  </button>
                  <button
                    type="button"
                    data-testid="chat-attach-file"
                    onClick={() => { setShowAttachSheet(false); anyFileInputRef.current?.click(); }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="text-lg">📎</span> File
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-input/40 pl-3 pr-2">
            <Smile className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              data-testid="chat-input"
              ref={inputRef}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              onBlur={() => emitTyping("stop")}
              placeholder={isBlocked ? "You've blocked this user — unblock to chat" : uploading ? "uploading…" : "Message"}
              disabled={isBlocked}
              className="flex-1 bg-transparent py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
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
              onClick={startRecording}
              disabled={isBlocked}
              data-testid="chat-mic"
              className="grid h-11 w-11 place-items-center rounded-full bg-[#0B5A4E] text-white transition active:scale-95 disabled:opacity-40"
              aria-label="Voice note"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
        )}
      </form>
      )}


      {viewerUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black" onClick={() => setViewerUrl(null)}>
          <button type="button" aria-label="Close" onClick={() => setViewerUrl(null)} className="absolute right-4 top-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
            <X className="h-5 w-5" />
          </button>
          <img src={viewerUrl} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {forwardMsg && me && (
        <ForwardSheet
          message={forwardMsg}
          meId={me.id}
          onClose={() => setForwardMsg(null)}
        />
      )}
    </div>
  );
}

function VoiceBubble({ url, durationS, mine }: { url: string; durationS: number; mine: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    const onPause = () => setPlaying(false);
    const onPlay = () => {
      // pause any other playing audio
      document.querySelectorAll("audio").forEach((el) => { if (el !== a && !el.paused) el.pause(); });
      setPlaying(true);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("pause", onPause);
    a.addEventListener("play", onPlay);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("play", onPlay);
    };
  }, []);
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => toast.error("couldn't play"));
    else a.pause();
  };
  const mm = String(Math.floor(durationS / 60)).padStart(2, "0");
  const ss = String(durationS % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-2 py-0.5">
      <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={`grid h-8 w-8 place-items-center rounded-full ${mine ? "bg-white/20" : "bg-primary/20"}`}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className={`h-1.5 w-32 overflow-hidden rounded-full ${mine ? "bg-white/20" : "bg-muted"}`}>
        <div className={`h-full ${mine ? "bg-white" : "bg-primary"}`} style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <span className={`text-xs tabular-nums ${mine ? "text-white/80" : "text-muted-foreground"}`}>{mm}:{ss}</span>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}

function ForwardSheet({ message, meId, onClose }: { message: Message; meId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data: convs = [] } = useQuery({
    queryKey: ["forward-convs", meId],
    queryFn: async () => {
      const { data } = await supabase
        .from("conversation_members")
        .select("conversation_id, conversations(id, name, type, avatar_url)")
        .eq("user_id", meId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = ((data ?? []) as any[]).filter((r) => r.conversations && r.conversation_id !== message.conversation_id);
      const enriched = await Promise.all(rows.map(async (r) => {
        const c = r.conversations;
        let title = c.name ?? "Chat";
        let avatar: string | null = c.avatar_url ?? null;
        if (c.type === "direct") {
          const { data: other } = await supabase
            .from("conversation_members")
            .select("profiles(display_name, username, avatar_url)")
            .eq("conversation_id", c.id).neq("user_id", meId).maybeSingle();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = (other as any)?.profiles;
          if (p) { title = p.display_name || p.username || "Chat"; avatar = p.avatar_url ?? avatar; }
        }
        return { id: c.id as string, title, avatar, type: c.type as string };
      }));
      return enriched;
    },
  });

  const forward = async (targetId: string) => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("messages").insert({
      conversation_id: targetId,
      sender_id: meId,
      content: message.content ?? "",
      type: message.type,
      media_url: message.media_url ?? null,
      duration_s: message.duration_s ?? null,
      file_name: message.file_name ?? null,
      file_size: message.file_size ?? null,
    });
    setBusy(false);
    if (error) { toast.error(error.message || "couldn't forward"); return; }
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", targetId);
    toast.success("Forwarded ➤");
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: targetId } });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/60" onClick={onClose}>
      <div className="max-h-[70vh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-card p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 font-display text-lg font-semibold">Forward to…</div>
        {convs.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No other chats</div>
        ) : (
          <ul className="space-y-1">
            {convs.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => forward(c.id)}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60"
                >
                  <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white" style={{ backgroundColor: colorFor(c.title) }}>
                    {c.avatar ? <img src={c.avatar} alt="" className="h-full w-full object-cover" /> : c.type === "group" ? <Users className="h-5 w-5" /> : c.title.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Member = {
  user_id: string;
  role: string;
  joined_at: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

function GroupMembersSheet({
  conversationId,
  groupName,
  meId,
  members,
  myRole,
  onClose,
  onChanged,
  onLeft,
}: {
  conversationId: string;
  groupName: string;
  meId: string | null;
  members: Member[];
  myRole: string | null;
  onClose: () => void;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const isOwner = myRole === "owner";
  const existingIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results = [] } = useQuery({
    queryKey: ["add-members-search", debounced, conversationId],
    enabled: showAdd && debounced.length >= 1,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .or(`username.ilike.%${debounced}%,display_name.ilike.%${debounced}%`)
        .limit(15);
      return (data ?? []).filter((u) => !existingIds.has(u.id));
    },
  });

  const removeMember = async (uid: string) => {
    if (!confirm("Remove this member?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("remove_group_member", {
      _conversation_id: conversationId,
      _user_id: uid,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Member removed"); onChanged(); }
  };

  const addMember = async (uid: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("add_group_members", {
      _conversation_id: conversationId,
      _member_ids: [uid],
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Member added"); setShowAdd(false); setQ(""); onChanged(); }
  };

  const leave = async () => {
    if (!confirm("Leave this group?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("leave_group", { _conversation_id: conversationId });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast("You left the group");
    onLeft();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">{groupName}</h2>
            <div className="text-xs text-muted-foreground">{members.length} members</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isOwner && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-border px-3 py-2.5 text-sm hover:bg-muted"
          >
            <UserPlus className="h-4 w-4" /> Add members
          </button>
        )}

        {showAdd && (
          <div className="mt-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search @username"
              className="w-full rounded-2xl border border-border bg-input/40 px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <div className="mt-1 max-h-40 overflow-y-auto">
              {results.map((u) => (
                <button
                  key={u.id}
                  disabled={busy}
                  onClick={() => addMember(u.id)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-muted disabled:opacity-50"
                >
                  <div className="grid h-8 w-8 place-items-center overflow-hidden rounded-full text-xs font-semibold text-white" style={{ backgroundColor: colorFor(u.id) }}>
                    {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-full w-full object-cover" /> : (u.display_name || u.username || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u.display_name}</div>
                    <div className="truncate text-xs text-muted-foreground">@{u.username}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="mt-3 divide-y divide-border/50">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2.5">
              <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white" style={{ backgroundColor: colorFor(m.user_id) }}>
                {m.avatar_url ? <img src={m.avatar_url} alt="" className="h-full w-full object-cover" /> : (m.display_name || m.username || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate text-sm font-medium">{m.display_name || m.username}{m.user_id === meId ? " (you)" : ""}</span>
                  {m.role === "owner" && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">owner</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">@{m.username}</div>
              </div>
              {isOwner && m.user_id !== meId && (
                <button
                  type="button"
                  onClick={() => removeMember(m.user_id)}
                  disabled={busy}
                  aria-label="Remove member"
                  className="grid h-9 w-9 place-items-center rounded-full text-red-500 hover:bg-muted"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={leave}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/40 py-3 text-sm font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" /> Leave group
        </button>
      </div>
    </div>
  );
}
