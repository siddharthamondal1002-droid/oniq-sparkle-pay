import { homeFormat } from "@/lib/format";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowLeft,
  ChevronDown,
  Phone,
  Send,
  Video,
  Smile,
  Mic,
  CircleDot,
  Check,
  CheckCheck,
  Reply,
  Trash2,
  X,
  MoreVertical,
  Flag,
  Ban,
  Sparkles,
  Users,
  UserPlus,
  LogOut,
  Paperclip,
  Play,
  Pause,
  Share2,
  Pencil,
  Star,
  Search,
  Copy,
  Info,
  BellOff,
  Bell,
  Link2,
  FileText,
  Image as ImageIcon,
  Languages,
} from "lucide-react";
import { clearConversationNotification } from "@/lib/notificationTray";
import { isConversationMuted, toggleConversationMute } from "@/lib/chatMute";
import { ChannelSubBar } from "@/components/chat/ChannelSubBar";
import { doodleSurfaceStyle } from "@/lib/chatWallpaper";
import { doodleByKey, doodleFor, doodleScatter, DOODLES } from "@/data/doodleLibrary";
import { prettyFail, reportClientError } from "@/lib/errorReport";
import { ProfilePhotoPopup } from "@/components/chat/ProfilePhotoPopup";
import { useUserTheme } from "@/components/customize/CustomizeSheet";
import { useT } from "@/lib/i18n/LanguageProvider";
import { LANG_NATIVE } from "@/lib/userLanguage";
import { WINDOW_STEP, windowRows, windowSizeToReveal } from "@/lib/chat/messageWindow";
import {
  fetchCachedTranslations,
  getConversationTranslation,
  grantTranslationConsent,
  hasTranslationConsent,
  setConversationTranslation,
} from "@/lib/chat/translation";
import { PhotoStudio } from "@/components/photo/PhotoStudio";
import { EMOJI_CATEGORIES } from "@/lib/emojis";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
// CallOverlay is mounted globally by GlobalCallHost — see src/components/chat/GlobalCallHost.tsx.
import { ReportSheet, type ReportTarget } from "@/components/safety/ReportSheet";
import {
  AttachmentSheet,
  useAttachmentContext,
  type AttachmentOption,
} from "@/components/attach/AttachmentSheet";
import { scanProvenance } from "@/lib/provenance";
import { attachR2ToMessage, uploadFileToR2 } from "@/lib/upload/r2Upload";
import { MAX_UPLOAD_BYTES, formatBytes, withinUploadCap } from "@/config/mediaStorage";
import { resolveMedia, isStoragePath } from "@/lib/media/resolveMedia";
import { ReelChatCard, extractReelShare } from "@/components/chat/ReelChatCard";

/* B1 adoption: newer rows (in-call attachments first) store BARE storage
   paths in media_url; legacy rows carry full 5-year signed URLs. This
   render-prop resolves either shape — passthrough for URLs, TTL-capped
   signing (cached in resolveMedia) for paths — so every media branch of the
   thread handles both without caring which era the row is from. */
function ResolvedSrc({
  refPath,
  children,
}: {
  refPath: string;
  children: (url: string | null) => React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(isStoragePath(refPath) ? null : refPath);
  useEffect(() => {
    let cancelled = false;
    if (!isStoragePath(refPath)) {
      setUrl(refPath);
      return () => {
        cancelled = true;
      };
    }
    void resolveMedia("chat-media", refPath)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refPath]);
  return <>{children(url)}</>;
}

// Make http(s) links in plain-text messages tappable (maps links, shared
// URLs). Only real URLs become anchors; everything else stays text.
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
import { useIsOnline } from "@/hooks/usePresence";
import { sendPush } from "@/lib/push";
import { CALLS_ENABLED } from "@/lib/flags";

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
const RECENT_REACTIONS_KEY = "oniq:recent-reactions";

function readRecentReactions(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, 6);
  } catch {
    return [];
  }
}

function writeRecentReactions(list: string[]) {
  try {
    localStorage.setItem(RECENT_REACTIONS_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* storage unavailable in webview — ignore */
  }
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

function humanSize(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  return homeFormat().bytes(n);
}

function truncateMiddle(s: string, max = 32) {
  if (!s || s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

const SIGNED_TTL = 60 * 60 * 24 * 365 * 5;

/* Video notes ride the 'video' message type; this content marker is what
   flips the bubble round. A marker beats a schema change: old clients render
   the same message as an ordinary video, losing nothing but the shape. */
const VIDEO_NOTE_MARK = "__videonote__";
/** Max length of a round video note — long enough to say it, short enough to watch. */
const VIDEO_NOTE_MAX_S = 60;

/**
 * Prefix that turns a 'sticker' row into an Open Doodles drawing.
 *
 * Sent as `__doodle__coffee`; anything else of type 'sticker' is still a
 * plain glyph. Chosen to be something no human types by accident, and kept
 * next to the video-note mark for the same reason: these two markers are the
 * app's whole vocabulary of "this text is not text".
 */
const DOODLE_MARK = "__doodle__";

/* The sticker rack. Big single glyphs sent as their own message type —
   no assets to ship, no storage to fill, every platform renders them. */
const STICKERS = [
  "😂",
  "🥹",
  "😍",
  "😎",
  "🥳",
  "😭",
  "😤",
  "🤯",
  "🤡",
  "💀",
  "👻",
  "🤖",
  "❤️",
  "💖",
  "🔥",
  "💯",
  "✨",
  "🎉",
  "👍",
  "🙏",
  "👀",
  "🫡",
  "🐒",
  "🦄",
] as const;

export const Route = createFileRoute("/_authenticated/app/chat/$conversationId")({
  component: ChatThread,
});

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "d MMMM yyyy");
}

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
  // Track A2 — translations the reader has explicitly asked for, this session.
  // Deliberately NOT persisted and NOT prefetched: nothing is translated until
  // someone taps Translate on one message, because translating sends another
  // person's words to a third-party model provider.
  const { lang: myLang } = useT();
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  // Per-conversation, not global, and off until you turn it on here. With it
  // on, translations ALREADY IN THE SHARED CACHE are shown on read — that
  // sends nothing anywhere and calls no provider. A message nobody has
  // translated yet still needs an explicit tap.
  const [convTranslate, setConvTranslate] = useState(false);
  // Set when a translation was asked for before the translation purpose was
  // consented to. The call does not happen until this is answered.
  const [consentAsk, setConsentAsk] = useState<Message | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  // Track A1 — how many rows stay mounted. See lib/chat/messageWindow.ts for
  // why this is a tail window rather than a measured virtualiser.
  const [windowSize, setWindowSize] = useState(WINDOW_STEP);
  // scrollToMessage is defined above where `rendered` is built, so it reads
  // the full row list through a ref rather than a closure over a later const.
  const renderedRef = useRef<Array<{ kind: string; key: string }>>([]);
  useEffect(() => {
    // A different conversation starts at the bottom again. Without this the
    // window stays as wide as whatever the last thread was expanded to.
    setWindowSize(WINDOW_STEP);
    setTranslated({});
    setShowOriginal({});
    let alive = true;
    void getConversationTranslation(conversationId).then((on) => {
      if (alive) setConvTranslate(on);
    });
    return () => {
      alive = false;
    };
  }, [conversationId]);
  // Opening the thread makes any tray entry for it stale — the whole point of
  // the notification was to get you here. Nothing used to clear it, so a chat
  // you had already read kept a notification until you swiped it away.
  useEffect(() => {
    void clearConversationNotification(conversationId);
  }, [conversationId]);
  const [deleteConfirm, setDeleteConfirm] = useState<Message | null>(null);
  const [infoFor, setInfoFor] = useState<Message | null>(null);
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewport is pinned near the newest message. Autoscroll obeys
  // this; a reader who has scrolled up must never be yanked to the bottom.
  const nearBottomRef = useRef(true);
  const composerRef = useRef<HTMLFormElement | null>(null);
  /** The chat column itself, measured by the keyboard probe below. */
  const columnRef = useRef<HTMLDivElement | null>(null);
  /** Probe reports fired this mount. Bounded — this is a diagnostic, not telemetry. */
  const probeCountRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  // callRef removed — CallOverlay is now mounted globally by GlobalCallHost.
  const typingChanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const navigate = useNavigate();
  // No custom wallpaper → the doodle paper, not a flat dark slab. A wallpaper
  // the user chose always wins; the shell paints that one behind everything.
  const { data: chatTheme } = useUserTheme();
  const doodle = !chatTheme?.wallpaper_url;
  const [showMembersSheet, setShowMembersSheet] = useState(false);
  const [showPhotoPopup, setShowPhotoPopup] = useState(false);
  const [showMediaSheet, setShowMediaSheet] = useState(false);
  const [showContactSheet, setShowContactSheet] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(isConversationMuted(conversationId));
  }, [conversationId]);

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
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showVideoNote, setShowVideoNote] = useState(false);
  const [recentReactions, setRecentReactions] = useState<string[]>([]);
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
      if (!c)
        return {
          title: "Conversation",
          avatar_url: null as string | null,
          peerId: null as string | null,
          isGroup: false,
          isChannel: false,
          description: null as string | null,
        };
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
        if (p)
          return {
            title: p.display_name || p.username || "Chat",
            avatar_url: p.avatar_url ?? null,
            peerId,
            isGroup: false,
            isChannel: false,
            description: null,
          };
        return {
          title: "Chat",
          avatar_url: null,
          peerId,
          isGroup: false,
          isChannel: false,
          description: null,
        };
      }
      return {
        title: c.name ?? (c.type === "channel" ? "Channel" : "Group"),
        avatar_url: c.avatar_url,
        peerId: null,
        isGroup: c.type === "group",
        isChannel: c.type === "channel",
        description: c.description ?? null,
      };
    },
  });

  const peerId = header?.peerId ?? null;
  const isGroup = header?.isGroup ?? false;
  const isChannel = header?.isChannel ?? false;
  const peerOnline = useIsOnline(peerId);

  type GroupMember = {
    user_id: string;
    role: string;
    joined_at: string | null;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
  };
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

  const myRole = useMemo(
    () => members.find((m) => m.user_id === me?.id)?.role ?? null,
    [members, me?.id],
  );
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
      // If I "deleted" this chat, history before cleared_at stays hidden for me.
      const uid = (await supabase.auth.getUser()).data.user?.id;
      let clearedAt: string | null = null;
      if (uid) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: mem } = await (supabase as any)
          .from("conversation_members")
          .select("cleared_at")
          .eq("conversation_id", conversationId)
          .eq("user_id", uid)
          .maybeSingle();
        clearedAt = mem?.cleared_at ?? null;
      }
      let q = supabase
        .from("messages")
        .select(
          "id, conversation_id, sender_id, content, type, media_url, duration_s, created_at, is_deleted, reply_to_id, is_ai, file_name, file_size, edited_at, starred_by",
        )
        .eq("conversation_id", conversationId);
      if (clearedAt) q = q.gt("created_at", clearedAt);
      // NEWEST 200, then flip to display order. Ascending+limit returns the
      // OLDEST 200 — any conversation past two hundred messages opened onto
      // ancient history and could never reach the present.
      const { data } = await q.order("created_at", { ascending: false }).limit(200);
      return ((data ?? []) as Message[]).reverse();
    },
  });

  const { data: hiddenIds = new Set<string>() } = useQuery({
    queryKey: ["message_hides", conversationId, me?.id],
    enabled: !!me?.id,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Set<string>> => {
      const { data } = await supabase
        .from("message_hides")
        .select("message_id")
        .eq("user_id", me!.id)
        .eq("conversation_id", conversationId);
      return new Set<string>((data ?? []).map((r: { message_id: string }) => r.message_id));
    },
  });

  // Reactions for all messages in this conversation. Realtime refetch on any change.
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);

  /**
   * Translate on read — from the CACHE ONLY.
   *
   * With the per-conversation setting on, any message someone has already had
   * translated into this reader's language is shown translated straight away.
   * In a group that means one message is translated once and serves everyone
   * reading in that language. This reads message_translations under RLS: no
   * text leaves the device here, and a message with no cached translation
   * stays as its original until someone taps Translate on it.
   */
  useEffect(() => {
    if (!convTranslate || messageIds.length === 0) return;
    let alive = true;
    void fetchCachedTranslations(messageIds, myLang).then((hits) => {
      if (alive && Object.keys(hits).length) setTranslated((s) => ({ ...hits, ...s }));
    });
    return () => {
      alive = false;
    };
  }, [convTranslate, messageIds, myLang]);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mid = ((payload.new || payload.old) as any)?.message_id;
          if (mid && ids.has(mid)) refetchReactions();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, messageIds, refetchReactions]);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!me) return;
    if (messageId.startsWith("temp-")) {
      toast("hang on — still sending");
      return;
    }
    const existing = reactions.find(
      (r) => r.message_id === messageId && r.user_id === me.id && r.emoji === emoji,
    );
    if (existing) {
      await supabase.from("message_reactions").delete().eq("id", existing.id);
    } else {
      await supabase
        .from("message_reactions")
        .insert({ message_id: messageId, user_id: me.id, emoji });
      setRecentReactions((prev) => {
        const next = [emoji, ...prev.filter((x) => x !== emoji)].slice(0, 6);
        writeRecentReactions(next);
        return next;
      });
    }
    refetchReactions();
  };

  const toggleStar = async (m: Message) => {
    if (m.id.startsWith("temp-")) {
      toast("hang on — still sending");
      return;
    }
    const { error } = await supabase.rpc("toggle_message_star", { _message_id: m.id });
    if (error) {
      toast.error(error.message);
      return;
    }
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
    if (m.type !== "text") {
      toast("Only text messages can be edited");
      return;
    }
    const created = m.created_at ? new Date(m.created_at).getTime() : 0;
    if (Date.now() - created > EDIT_WINDOW_MS) {
      toast("Too late — 15-min edit window");
      return;
    }
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
      (list ?? []).map((x) =>
        x.id === prev.id ? { ...x, content, edited_at: new Date().toISOString() } : x,
      ),
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
        peerTypingTimerRef.current = setTimeout(() => {
          setPeerTyping(false);
          setPeerTypingName(null);
        }, 4500);
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

  // Instant jump to latest on conversation open — like WhatsApp/iMessage.
  // Fires once messages have loaded for the current conversation (or when
  // switching between conversations) so the user never sees a smooth scroll
  // past old messages on initial render.
  const initialScrollDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialScrollDoneRef.current === conversationId) return;
    if (messages.length === 0) return;
    // Double rAF so DOM has laid out the message list before we jump.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
        initialScrollDoneRef.current = conversationId;
      });
    });
  }, [conversationId, messages.length]);

  // Autoscroll on new messages (only after the initial jump has happened),
  // and ONLY while the reader is already at the bottom. Unconditional
  // scrolling made reading history impossible on an active thread — every
  // arriving message (or even the peer starting to type) yanked the view.
  useEffect(() => {
    if (initialScrollDoneRef.current !== conversationId) return;
    if (!nearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationId, messages.length, peerTyping]);

  // NO focus() here. Focusing the composer on open sprang the Android
  // keyboard the instant a chat was tapped, covering the newest messages and
  // racing the initial scroll-to-bottom. Every other focus() in this file sits
  // inside a user gesture (reply, edit, emoji, after-send) and is correct.
  useEffect(() => {
    setShowEmojiPicker(false);
  }, [conversationId]);

  /**
   * Re-pin the scroller while the IME animates in, and measure the composer.
   *
   * IT PUBLISHES NO KEYBOARD MEASUREMENT AT ALL — not to the column, not to
   * the composer, not to anything. That is the whole correction, arrived at
   * from the file's own history rather than from a fourth theory: between
   * 6c16f217 (2026-07-02) and b0363564 (2026-08-11) this component ran no
   * viewport JavaScript whatsoever and the thread was smooth for six weeks.
   *
   * The keyboard belongs to the platform, and to exactly one layer of it:
   * MainActivity's IME padding on native, interactive-widget on the web.
   * Everything this effect used to contribute was a second subtraction in
   * some disguise.
   *
   * --kb used to be subtracted from 100dvh to get the column height, on the
   * reasoning that it "resolves to 0 wherever the platform already shrinks
   * the layout viewport (Android with interactive-widget=resizes-content)".
   * That reasoning holds in Chrome and NOT in the Android WebView, which does
   * not implement interactive-widget — there window.innerHeight stays at full
   * height while visualViewport.height shrinks, so --kb becomes the keyboard's
   * full height. Meanwhile MainActivity is padding the WebView by the same IME
   * inset, so 100dvh had ALREADY lost the keyboard. Subtracting again left the
   * chat about (screen - 2x keyboard) tall: reported 2026-08-17 as a thread
   * squeezed into a strip at the top with a dead band beneath the composer,
   * which is exactly that arithmetic made visible.
   *
   * The correction to THAT was to size the column by visualViewport.height,
   * on the reasoning that it "is the space genuinely visible right now, so it
   * cannot double-count by construction". That reasoning was wrong too, and
   * wrong in the same direction: the platform had already resized the layout
   * viewport, and visualViewport then reported the space left after the
   * keyboard ON TOP of that. Same picture, same cause, second disguise.
   *
   * What both attempts missed is that there was nothing here to fix. The
   * keyboard is handled entirely by the platform — MainActivity's IME padding
   * on native, interactive-widget=resizes-content on web — so the correct
   * amount for this file to subtract is zero. --kb stays only because the
   * composer's safe-area padding has to know whether the keyboard is up.
   *
   * AND THE REASON THAT STILL WAS NOT ENOUGH, found 2026-08-18: native was
   * running BOTH of those platform mechanisms at once. The viewport meta in
   * __root.tsx carried interactive-widget=resizes-content unconditionally, so
   * the WebView shrank its own layout viewport for the keyboard while
   * MainActivity was also padding the content view by the same inset. 100dvh
   * arrived here already about (screen - 2x keyboard), and no expression in
   * this file could have recovered it — every fix above was chasing a number
   * that was wrong before any stylesheet ran. The meta is now added for the
   * web only. The claim in the old note that "the Android WebView does not
   * implement interactive-widget" was simply false: it has since Chromium 108,
   * and believing otherwise is what let the two layers stack.
   *
   * Both listeners are required: iOS often moves offsetTop and fires `scroll`
   * without ever firing `resize`. scrollTop is assigned directly rather than
   * via scrollIntoView because a smooth scroll gets interrupted by the
   * viewport animation and lands short.
   */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      // scale > 1 means the user pinch-zoomed, and vv.height then shrinks for
      // a reason that has nothing to do with the keyboard. Without this the
      // chat column collapses by up to half the screen while panning.
      const zoomed = vv.scale > 1.01;
      /*
       * A DEGENERATE READING IS NOT A KEYBOARD.
       *
       * The three probe rows from 2026-08-18 09:00 are byte-identical, and
       * every one of them says vv.height = 0 with innerHeight = 211 on an
       * 832px screen. visualViewport.height of exactly zero is not a layout,
       * it is the absence of one — the Android WebView reporting nothing yet
       * during the synchronous apply() below that runs at mount, before the
       * view has been measured.
       *
       * With vv.height at 0 the subtraction turns the WHOLE window into
       * "keyboard": inset became 211 of a 211px viewport. That published a
       * nonsense --kb and, worse, walked straight past the `inset > 100`
       * probe guard that exists precisely to mean "a keyboard is up". Three
       * reports, none of them about a keyboard.
       *
       * So a reading has to be plausible before it counts: a viewport with
       * real height, and a keyboard that leaves some of it behind. A real IME
       * takes roughly a third of the screen; one that takes nine tenths is a
       * measurement failure wearing a keyboard's clothes.
       */
      const usable = vv.height > 0 && window.innerHeight > 0;
      const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const plausible = usable && raw < window.innerHeight * 0.9;
      const inset = zoomed || !plausible ? 0 : raw;
      /*
       * --kb IS NO LONGER PUBLISHED. NOTHING IN THIS FILE TOUCHES THE KEYBOARD.
       *
       * The history settles it. From 6c16f217 on 2026-07-02 this component was
       * `<div className="flex h-[100dvh] flex-col">` with no viewport
       * JavaScript of any kind, and it stayed that way, working, for six
       * weeks. Every part of this apparatus — --kb, --vvh, the column height
       * arithmetic, interactive-widget in the meta — arrived together in
       * b0363564 on 2026-08-11, which is the day the thread started
       * collapsing into a strip.
       *
       * All three failed fixes on 2026-08-18 were made inside that apparatus.
       * They could not have worked: the platform had already subtracted the
       * keyboard before any of them ran, and the only real defect was that it
       * was doing so twice.
       *
       * `inset` survives as a local because the probe below reports it. It is
       * deliberately not written anywhere a stylesheet can reach.
       */
      // --vvh IS GONE ON PURPOSE. It used to be published here and used as the
      // chat column's height, which subtracted the keyboard a second time on
      // top of the platform's own resize. Leaving a correct-looking variable
      // lying around is how that mistake got made twice; the way to stop it a
      // third time is for there to be nothing to reach for.
      const el = scrollRef.current;
      if (el && !zoomed && nearBottomRef.current) el.scrollTop = el.scrollHeight;

      /*
       * THE ROOT MUST SIT AT (0,0) ON THIS SCREEN. The chat column is exactly
       * one viewport tall, so the document has nothing legitimate to scroll —
       * yet the 15:47 screenshots show it scrolled anyway: the header ridden
       * up under the status bar, a black band under the composer. The WebView
       * scrolls the document while the keyboard resizes things, and the
       * offset survives the keyboard's dismissal. Not while zoomed: panning a
       * magnified viewport is the one time root offsets are the user's own.
       */
      if (!zoomed && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);

      /*
       * THE KEYBOARD PROBE — measurements, because three theories were wrong.
       *
       * This layout has now been "fixed" three times from reading the code,
       * and reported broken three times from a phone. Every one of those
       * fixes was reasoned from a model of how the Android WebView handles
       * the IME, and the model was wrong each time. So this stops modelling
       * and records what the device actually reports.
       *
       * The one number that settles it is `innerH` against `screenH`. If the
       * WebView is roughly a keyboard SHORTER than it should be, the loss is
       * native — the window resized AND MainActivity padded on top of it —
       * and no amount of CSS in this file can recover it. If the WebView is
       * full height and `colH` is short, the fault is here after all.
       *
       * BOUNDED ON PURPOSE: at most two reports per mounted thread, and only
       * once a keyboard is actually up. This is a diagnostic with a job to
       * do, not telemetry — it comes out once the layout is right.
       */
      /*
       * FIRES ON A REAL KEYBOARD, OR ON A READING THAT CLAIMS ONE AND IS NOT
       * BELIEVABLE.
       *
       * Only the first of those was wanted, but rejecting the second outright
       * would go blind on the very case that matters most: if native really
       * is subtracting the keyboard twice, the viewport collapses to about a
       * keyboard's worth and `raw` then exceeds the 0.9 plausibility bar — so
       * a guard on `inset` alone would have nothing to say about exactly the
       * failure it was built to catch. Both are recorded, and `plausible`
       * separates them.
       */
      if ((inset > 100 || (!plausible && raw > 100)) && probeCountRef.current < 2) {
        probeCountRef.current += 1;
        // env() cannot be read off a custom property, so measure it with a
        // throwaway element the browser has to resolve for real.
        let safeTop: number | null = null;
        try {
          const p = document.createElement("div");
          p.style.cssText =
            "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
          document.body.appendChild(p);
          safeTop = Math.round(p.getBoundingClientRect().height);
          p.remove();
        } catch {
          /* a probe that fails must not break the chat */
        }
        const shell = document.querySelector("[data-app-shell]");
        const col = columnRef.current?.getBoundingClientRect();
        reportClientError("chat-viewport", "keyboard layout probe", {
          screenH: typeof screen !== "undefined" ? screen.height : null,
          dpr: window.devicePixelRatio,
          innerH: window.innerHeight,
          docH: document.documentElement.clientHeight,
          vvH: Math.round(vv.height),
          vvTop: Math.round(vv.offsetTop),
          kb: inset,
          safeTop,
          appVh: shell ? getComputedStyle(shell).getPropertyValue("--app-vh").trim() : null,
          colH: col ? Math.round(col.height) : null,
          colTop: col ? Math.round(col.top) : null,
          scrollerH: el ? Math.round(el.getBoundingClientRect().height) : null,
          // THE ONE FACT THAT SETTLES WHETHER THE FIX ARRIVED. The viewport
          // fix removed interactive-widget from the static meta so native
          // stops subtracting the keyboard twice. Whether the phone actually
          // received that is unknowable from here — a service worker serving
          // a cached shell would keep the old meta indefinitely through any
          // number of publishes. So read it off the live document.
          meta:
            document
              .querySelector('meta[name="viewport"]')
              ?.getAttribute("content")
              ?.slice(0, 90) ?? null,
          // A collapsed viewport in a backgrounded WebView is not a bug in
          // the layout, and these two say so before anyone theorises again.
          vis: document.visibilityState,
          raw,
          plausible,
          ua: navigator.userAgent.slice(0, 120),
        });
      }
    };
    const onChange = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    apply();
    const composer = composerRef.current;
    let ro: ResizeObserver | null = null;
    if (composer && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        document.documentElement.style.setProperty(
          "--composer-h",
          `${composer.getBoundingClientRect().height}px`,
        );
      });
      ro.observe(composer);
    }
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      // --vvh is no longer published, so there is nothing to clean up. Kept as
      // a note rather than a stray removeProperty for a name that no longer
      // exists anywhere in the file.
      document.documentElement.style.removeProperty("--composer-h");
    };
  }, []);

  useEffect(() => {
    setRecentReactions(readRecentReactions());
  }, []);

  // VIEWS — the Creator Program's measured mechanism. Every VIDEO post
  // rendered in a channel counts one view per viewer per day, deduped
  // server-side by primary key and here by a sent-set so a re-render is not
  // a network call. Best-effort: a failed beacon is a lost view, never a
  // broken thread.
  const sentViewsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isChannel || !me?.id) return;
    const fresh = messages
      .filter((m) => m.type === "video" && !m.is_deleted && !sentViewsRef.current.has(m.id))
      .map((m) => m.id)
      .slice(0, 50);
    if (fresh.length === 0) return;
    fresh.forEach((id) => sentViewsRef.current.add(id));
    void supabase
      .rpc(
        "record_channel_views" as never,
        {
          _channel_id: conversationId,
          _message_ids: fresh,
        } as never,
      )
      .then(({ error }) => {
        if (error) fresh.forEach((id) => sentViewsRef.current.delete(id));
      });
  }, [isChannel, me?.id, messages, conversationId]);

  const reactionRow = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of [...recentReactions, ...REACTION_EMOJIS]) {
      if (seen.has(e)) continue;
      seen.add(e);
      out.push(e);
      if (out.length === 6) break;
    }
    return out;
  })();

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      handleTextChange(text + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    const next = text.slice(0, start) + emoji + text.slice(end);
    handleTextChange(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* noop */
      }
    });
  };

  const toggleBlock = async () => {
    if (!me || !peerId) return;
    setShowHeaderMenu(false);
    if (isBlocked) {
      const { error } = await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", me.id)
        .eq("blocked_id", peerId);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Unblocked");
    } else {
      const { error } = await supabase
        .from("blocked_users")
        .insert({ blocker_id: me.id, blocked_id: peerId });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast("Blocked — you won't see their messages here 🚫");
    }
    refetchBlocked();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (editing) {
      await submitEdit();
      return;
    }
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
    qc.setQueryData<Message[]>(["messages", conversationId], (prev) => [
      ...(prev ?? []),
      optimistic,
    ]);
    setText("");
    setShowEmojiPicker(false);
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
      .select(
        "id, conversation_id, sender_id, content, type, media_url, duration_s, created_at, is_deleted, reply_to_id, is_ai, file_name, file_size",
      )
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
      // PostgREST builders are lazy thenables — un-awaited, this request was
      // NEVER SENT, so text messages didn't bump the conversation's
      // updated_at and the chat list reverted order on the next refetch.
      void supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .then(() => {});
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
    // P4: provenance ledger entry for chat media (no badge surface here).
    void scanProvenance({ bucket: "chat-media", path, contentType: "chat" });
    return signed.signedUrl;
  };

  const insertMediaMessage = async (payload: {
    type: "image" | "voice" | "video" | "file";
    media_url: string;
    duration_s?: number;
    file_name?: string;
    file_size?: number;
    skipPush?: boolean;
    /* Content marker override — video notes ride the 'video' type with
       content VIDEO_NOTE_MARK so the round bubble needs no schema change. */
    content?: string;
  }) => {
    if (!me) return null;
    const { data: inserted, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: me.id,
        content:
          payload.content ??
          (payload.file_name && payload.type === "file" ? payload.file_name : ""),
        type: payload.type,
        media_url: payload.media_url,
        duration_s: payload.duration_s ?? null,
        file_name: payload.file_name ?? null,
        file_size: payload.file_size ?? null,
      })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message || "Couldn't send");
      return null;
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    markRead();
    const previewMap = {
      image: "📷 Photo",
      voice: "🎙 Voice note",
      video: payload.content === VIDEO_NOTE_MARK ? "🎥 Video note" : "🎥 Video",
      file: "📎 File",
    } as const;
    if (!payload.skipPush) {
      sendPush({
        conversation_id: conversationId,
        kind: "message",
        preview: previewMap[payload.type],
      });
    }
    return inserted?.id ?? null;
  };

  // Stickers: a message whose whole body is one big glyph. No media upload,
  // no storage — the content IS the sticker, rendered huge and bubble-less.
  const sendSticker = async (glyph: string) => {
    if (!me) return;
    setShowEmojiPicker(false);
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me.id,
      content: glyph,
      type: "sticker",
    });
    if (error) {
      toast.error(error.message || "Couldn't send");
      return;
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    markRead();
    sendPush({ conversation_id: conversationId, kind: "message", preview: `${glyph} Sticker` });
  };

  /**
   * Doodles: an Open Doodles drawing sent as a message.
   *
   * It rides the EXISTING 'sticker' type carrying a `__doodle__` key rather
   * than earning a type of its own. That is deliberate: the messages type
   * CHECK constraint is the exact thing that silently killed every channel
   * ever created here (it never learned the word 'channel'), and a new type
   * would need the database to agree before a single client could send one.
   * A doodle IS a sticker in this app — a picture with no caption, drawn
   * bubble-less at size — so it costs nothing to say so.
   *
   * The key travels, not the image: 33 drawings ship with the app, so the
   * message body stays a few bytes and renders instantly with no upload, no
   * storage and no signed URL.
   */
  const sendDoodle = async (key: string) => {
    if (!me) return;
    setShowEmojiPicker(false);
    const d = doodleByKey(key);
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: me.id,
      content: `${DOODLE_MARK}${key}`,
      type: "sticker",
    });
    if (error) {
      toast.error(prettyFail("send-doodle", error, "Couldn't send that doodle — try again 🎨"));
      return;
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    markRead();
    sendPush({
      conversation_id: conversationId,
      kind: "message",
      preview: `🎨 ${d?.label ?? "Doodle"}`,
    });
  };

  // ---- per-file validation + upload (used by single & batch flows) ----
  const validateImage = (f: File): string | null => {
    if (!/^image\//.test(f.type)) return "images only";
    if (f.size > 100 * 1024 * 1024) return "keep it under 100MB";
    return null;
  };
  const validateVideo = (f: File): string | null => {
    if (!/^video\//.test(f.type)) return "videos only";
    if (f.size > 100 * 1024 * 1024) return "keep it under 100MB";
    return null;
  };
  const bannedFileExts = ["exe", "apk", "bat", "sh", "cmd", "msi", "dll", "com", "scr", "ps1"];
  const allowedFileExts = [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "webm",
    "m4a",
    "mp3",
    "ogg",
    "wav",
    "mp4",
    "mov",
    "mkv",
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "txt",
    "csv",
    "json",
    "zip",
    "rar",
  ];
  const validateAnyFile = (f: File): string | null => {
    // 200 MB, and R2 carries anything past the small-file path. The cap is
    // enforced again at presign — a client-side limit is a courtesy so the
    // user hears immediately, never the control.
    if (!withinUploadCap(f.size)) return `keep it under ${formatBytes(MAX_UPLOAD_BYTES)}`;
    const rawExt = (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!rawExt || bannedFileExts.includes(rawExt)) return "that file type isn't allowed 🚫";
    if (!allowedFileExts.includes(rawExt)) return `.${rawExt} isn't supported yet`;
    return null;
  };

  /**
   * Anything above this goes to R2 in resumable 5 MB parts. Below it, the
   * existing single-shot Supabase Storage path is simpler and already proven.
   */
  const R2_THRESHOLD_BYTES = 15 * 1024 * 1024;

  type BatchKind = "image" | "video" | "file";
  const uploadOne = async (f: File, kind: BatchKind, skipPush = false): Promise<boolean> => {
    try {
      const rawExt = (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const type = kind === "image" ? "image" : kind === "video" ? "video" : "file";

      if (f.size > R2_THRESHOLD_BYTES) {
        // Streamed, resumable, never materialised. The File is only sliced.
        const res = await uploadFileToR2(f, {
          onProgress: (done, total) => setBatchProgress({ done, total }),
        });
        if (!res.ok) {
          toast.error(
            `${f.name}: ${"rejected" in res ? (res.rejected as { message?: string }).message || "not allowed" : res.error}`,
          );
          return false;
        }
        const messageId = await insertMediaMessage({
          type,
          media_url: res.ref,
          file_name: f.name,
          file_size: f.size,
          skipPush,
        });
        // Link the object to the message so deleting the message deletes the
        // bytes. Unlinked, the sweeper would only ever remove it on expiry.
        if (messageId) await attachR2ToMessage(res.ref, messageId);
        return true;
      }

      if (kind === "image") {
        const ext = rawExt || "jpg";
        const url = await uploadToChatMedia(f, ext);
        await insertMediaMessage({ type: "image", media_url: url, skipPush });
      } else if (kind === "video") {
        const allowed = ["mp4", "mov", "webm", "mkv"];
        const ext = allowed.includes(rawExt) ? rawExt : "mp4";
        const url = await uploadToChatMedia(f, ext);
        await insertMediaMessage({
          type: "video",
          media_url: url,
          file_name: f.name,
          file_size: f.size,
          skipPush,
        });
      } else {
        const url = await uploadToChatMedia(f, rawExt);
        await insertMediaMessage({
          type: "file",
          media_url: url,
          file_name: f.name,
          file_size: f.size,
          skipPush,
        });
      }
      return true;
    } catch (err) {
      console.error(err);
      toast.error(`${f.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      return false;
    }
  };

  // ---- batch flow: preview tray + sequential send ----
  type PendingItem = { id: string; file: File; kind: BatchKind; previewUrl: string };
  const [pendingBatch, setPendingBatch] = useState<PendingItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const revokePendingUrls = (items: PendingItem[]) => {
    items.forEach((it) => {
      try {
        URL.revokeObjectURL(it.previewUrl);
      } catch {}
    });
  };
  const clearBatch = () => {
    setPendingBatch((prev) => {
      revokePendingUrls(prev);
      return [];
    });
  };
  const removeFromBatch = (id: string) => {
    setPendingBatch((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) {
        try {
          URL.revokeObjectURL(gone.previewUrl);
        } catch {}
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const handlePickedFiles = async (files: File[], kind: BatchKind) => {
    if (files.length === 0) return;
    if (isBlocked) {
      toast("You've blocked this user — unblock to chat.");
      return;
    }
    let list = files;
    if (list.length > 10) {
      toast("10 at a time bestie 😅");
      list = list.slice(0, 10);
    }
    const validator =
      kind === "image" ? validateImage : kind === "video" ? validateVideo : validateAnyFile;
    const accepted: File[] = [];
    for (const f of list) {
      const err = validator(f);
      if (err) toast.error(`${f.name}: ${err}`);
      else accepted.push(f);
    }
    if (accepted.length === 0) return;
    // Single-file: preserve identical immediate-send behavior.
    if (accepted.length === 1) {
      setUploading(true);
      try {
        await uploadOne(accepted[0], kind);
      } finally {
        setUploading(false);
      }
      return;
    }
    // Multi-file: populate preview tray, wait for user to tap send.
    const items: PendingItem[] = accepted.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      kind,
      previewUrl: URL.createObjectURL(f),
    }));
    setPendingBatch((prev) => {
      revokePendingUrls(prev);
      return items;
    });
  };

  const sendPendingBatch = async () => {
    const items = pendingBatch;
    if (items.length === 0) return;
    setUploading(true);
    setBatchProgress({ done: 0, total: items.length });
    // Multi-item batches suppress the per-item push and send ONE "N items"
    // nudge at the end — ten photos used to buzz the recipient eleven times.
    const multi = items.length > 1;
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const success = await uploadOne(it.file, it.kind, multi);
      if (success) ok++;
      setBatchProgress({ done: i + 1, total: items.length });
    }
    if (multi && ok > 0) {
      sendPush({
        conversation_id: conversationId,
        kind: "message",
        preview: `📎 ${ok} items`,
      });
    }
    revokePendingUrls(items);
    setPendingBatch([]);
    setBatchProgress(null);
    setUploading(false);
  };

  // The three onChange handlers that lived here (handlePickImage,
  // handlePickVideo, handlePickAnyFile) went with the hidden inputs they were
  // attached to. handleSheetFiles below is the single entry point now, and it
  // still routes photos through PhotoStudio for the metadata-stripping
  // re-encode before upload.

  const [studioQueue, setStudioQueue] = useState<File[]>([]);
  const studioResults = useRef<File[]>([]);

  const attachCtx = useAttachmentContext();

  // Unified attachment sheet -> existing upload pipelines.
  const handleSheetFiles = (option: AttachmentOption, files: File[]) => {
    if (option.id === "camera-video") {
      void handlePickedFiles(
        files.filter((f) => f.type.startsWith("video/")),
        "video",
      );
      return;
    }
    if (option.id === "gallery" || option.id === "camera") {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const videos = files.filter((f) => f.type.startsWith("video/"));
      if (images.length) {
        studioResults.current = [];
        setStudioQueue(images);
      }
      if (videos.length) void handlePickedFiles(videos, "video");
      return;
    }
    // document / audio ride the existing any-file pipeline (chat-media
    // storage policy already allows these extensions).
    void handlePickedFiles(files, "file");
  };

  // Location share: one tap -> a maps link message (no live tracking).
  const sendLocation = () => {
    if (!me) return;
    if (!("geolocation" in navigator)) {
      toast.error("location not available on this device");
      return;
    }
    toast("getting your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const content = `📍 My location: https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        const { error } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: me.id,
          content,
          type: "text",
        });
        if (error) {
          toast.error(error.message || "couldn't share location");
          return;
        }
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);
        markRead();
        sendPush({ conversation_id: conversationId, kind: "message", preview: "📍 Location" });
      },
      () => toast.error("location permission denied"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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
      rec.ondataavailable = (ev) => {
        if (ev.data.size) recChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const cancel = recCancelRef.current;
        const dur = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        recStreamRef.current?.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current);
          recTimerRef.current = null;
        }
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
    try {
      recorderRef.current.stop();
    } catch {
      /* noop */
    }
    if (cancel) {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      setRecording(false);
      setRecSeconds(0);
    }
  };

  useEffect(
    () => () => {
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    },
    [],
  );

  const deleteForEveryone = async (m: Message) => {
    setMenuFor(null);
    setDeleteConfirm(null);
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

  const deleteForMe = async (m: Message) => {
    setMenuFor(null);
    setDeleteConfirm(null);
    if (!me?.id) return;
    // Optimistic add to local hidden set
    qc.setQueryData<Set<string>>(["message_hides", conversationId, me.id], (prev) => {
      const next = new Set(prev ?? []);
      next.add(m.id);
      return next;
    });
    const { error } = await supabase
      .from("message_hides")
      .insert({ user_id: me.id, message_id: m.id, conversation_id: conversationId });
    if (error && !String(error.message).includes("duplicate")) {
      toast.error("Couldn't hide — try again");
      console.error(error);
    }
  };

  const copyMessage = async (m: Message) => {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(m.content ?? "");
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  /**
   * Translate one message into the reader's own language.
   *
   * Sends only the message ID — never the text. The edge function reads the
   * message itself using this user's JWT, so RLS performs the authorisation
   * and the shared cache cannot be poisoned with caller-supplied content. See
   * the header of supabase/functions/translate-message/index.ts.
   */
  const runTranslate = async (m: Message) => {
    setTranslatingId(m.id);
    try {
      const { data, error } = await supabase.functions.invoke("translate-message", {
        body: { message_id: m.id, to: myLang },
      });
      if (error) throw error;
      const out = typeof data?.translation === "string" ? data.translation.trim() : "";
      if (!out) {
        // Quiet failure: the original is already on screen and stays there.
        toast.error(data?.error || "Couldn't translate that");
        return;
      }
      setTranslated((s) => ({ ...s, [m.id]: out }));
      setShowOriginal((s) => ({ ...s, [m.id]: false }));
    } catch {
      toast.error("Couldn't translate that — try again");
    } finally {
      setTranslatingId(null);
    }
  };

  const translateMessage = async (m: Message) => {
    setMenuFor(null);
    if (translated[m.id]) {
      setShowOriginal((s) => ({ ...s, [m.id]: false }));
      return;
    }
    // CONSENT FIRST. Sending message text to a model provider is its own
    // processing purpose with its own line in the notice and its own row in
    // the ledger. No grant, no call — the ask is raised and this returns.
    try {
      if (!(await hasTranslationConsent())) {
        setConsentAsk(m);
        return;
      }
    } catch {
      setConsentAsk(m);
      return;
    }
    await runTranslate(m);
  };

  const highlight = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-ring");
    setTimeout(() => el.classList.remove("ring-2", "ring-ring"), 1200);
  };

  /**
   * Jump to a message — including one older than the current window.
   *
   * A tail window means a reply can point at something not currently mounted.
   * Silently doing nothing would look like a broken button, so the window is
   * widened to include the target and the scroll happens once React has
   * painted it.
   */
  const scrollToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      highlight(el);
      return;
    }
    const index = renderedRef.current.findIndex((r) => r.kind === "msg" && r.key === id);
    if (index < 0) return;
    setWindowSize((size) => windowSizeToReveal(renderedRef.current, index, size));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const late = document.getElementById(`msg-${id}`);
        if (late) highlight(late);
      });
    });
  };

  const title = header?.title ?? "Conversation";
  // Filter out messages from blocked peer while blocked (client-side hide)
  const notHidden = messages.filter((m) => !hiddenIds.has(m.id));
  const baseVisible =
    isBlocked && peerId ? notHidden.filter((m) => m.sender_id !== peerId) : notHidden;
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
      prev &&
      !isSystemMessage(prev) &&
      prev.sender_id === m.sender_id &&
      prev.created_at &&
      m.created_at &&
      format(new Date(prev.created_at), "yyyy-MM-dd") === dayKey;
    const sameSenderAsNext =
      next &&
      !isSystemMessage(next) &&
      next.sender_id === m.sender_id &&
      next.created_at &&
      m.created_at &&
      format(new Date(next.created_at), "yyyy-MM-dd") === dayKey;
    rendered.push({
      kind: "msg",
      key: m.id,
      m,
      firstOfGroup: !sameSenderAsPrev,
      lastOfGroup: !sameSenderAsNext,
    });
  }

  // Only the tail is mounted. Everything above is one tap away, and
  // scrollToMessage widens the window on demand for reply-jumps.
  renderedRef.current = rendered;
  const { rows: windowedRows, hidden: hiddenRowCount } = windowRows(rendered, windowSize);

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
    <div
      ref={columnRef}
      className="relative flex flex-col"
      /*
       * NO KEYBOARD ARITHMETIC HERE. NONE. THAT IS THE WHOLE FIX.
       *
       * This one line has been wrong three times in two days, each time by
       * subtracting the keyboard a SECOND time in a different disguise:
       *
       *   calc(100dvh - var(--kb))   --kb is innerHeight - visualViewport.
       *                              That IS the keyboard. Subtracted.
       *   var(--vvh)                 visualViewport.height is what is left
       *                              AFTER the keyboard. Subtracted again,
       *                              just with no minus sign to give it away.
       *
       * Both drew the same picture, reported 2026-08-18: the thread squeezed
       * to a strip under the header, the composer, then a dead band exactly
       * one keyboard tall beneath it.
       *
       * Both were wrong because 100dvh HAS ALREADY LOST THE KEYBOARD before
       * this file sees it, in BOTH environments, for two unrelated reasons:
       *
       *   native  MainActivity pads the content view by the IME inset
       *           (`v.setPadding(0, 0, 0, ime.bottom)`), so the WebView is
       *           physically shorter while the keyboard is up.
       *   web     __root.tsx sets `interactive-widget=resizes-content`, so
       *           the browser shrinks the layout viewport itself.
       *
       * Exactly one layer may subtract the keyboard, and in both cases that
       * layer is the platform — which is why native carrying BOTH mechanisms
       * at once was the real defect all along, fixed in __root.tsx rather
       * than here.
       *
       * So the column takes --app-vh: the viewport less the status-bar inset
       * the shell pads with, and nothing else. That is arithmetically the
       * same as the `h-[100dvh]` this file carried from 2026-07-02 until the
       * apparatus landed — the shell simply owns the inset now. No keyboard
       * term survives anywhere in this component; --kb is not published at
       * all any more, so there is nothing left to reach for.
       */
      style={{ height: "var(--app-vh, 100dvh)" }}
    >
      {/* relative z-40: backdrop-blur makes the header its own stacking
          context at z-auto, which let animated message bubbles paint OVER the
          three-dot dropdown. Lifting the header keeps the menu above the
          thread while sheets/viewers (z-50+) still cover everything. */}
      {/* NO SAFE-AREA INSET HERE. The shell already paid it.
          src/routes/_authenticated/app.tsx pads <main> by
          env(safe-area-inset-top) for all 45 screens, so a screen that adds it
          again gets TWO status bars of gap.

          This header used to read `calc(env(safe-area-inset-top)+0.75rem)`,
          and that was correct until 2026-08-17. Before then MainActivity
          returned WindowInsetsCompat.CONSUMED, which stopped the insets ever
          reaching the WebView — every env(safe-area-inset-*) in this codebase
          evaluated to ZERO, so the calc quietly meant 0.75rem and the real
          inset came from native padding. The edge-to-edge flip let the insets
          through, and this line started charging for them a second time.

          The 17 screens written as `max(3rem, env(...))` are fine and were
          left alone: 3rem beats a phone's inset, so they resolve to 3rem on
          top of the shell's padding exactly as they did before. It is the
          ADDITIVE form that broke, and this was the only one. */}
      <header className="relative z-40 flex items-center gap-2 border-b border-border/60 bg-background/72 px-2 pb-3 pt-3 backdrop-blur-md">
        <Link
          to="/app/chat"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={
            () =>
              isGroup || isChannel
                ? setShowMembersSheet(true)
                : setShowPhotoPopup(true) /* 1:1 — the tap asks to SEE the DP */
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left normal-case tracking-normal"
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
            <div className="truncate text-[17px] font-semibold leading-tight text-foreground">
              {isChannel ? `📢 ${title}` : title}
            </div>
            <div className="text-xs text-white/90">
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
        {CALLS_ENABLED &&
          !isChannel &&
          (() => {
            // No participant cap (owner directive): the mesh takes whoever
            // the conversation holds, and quality degrades gracefully.
            const onClick = (t: "audio" | "video") => () => {
              const meName =
                (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)
                  ?.display_name ||
                (me?.user_metadata as { display_name?: string; full_name?: string } | undefined)
                  ?.full_name ||
                me?.email ||
                "Someone";
              window.dispatchEvent(
                new CustomEvent("oniq:start-call", {
                  detail: {
                    conversationId,
                    callType: t,
                    peerName: title,
                    isGroup,
                    groupTitle: isGroup ? title : undefined,
                    meId: me?.id,
                    meName,
                  },
                }),
              );
            };
            return (
              <>
                <button
                  data-testid="call-audio"
                  onClick={onClick("audio")}
                  aria-label="Voice call"
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
                >
                  <Phone className="h-5 w-5" />
                </button>
                <button
                  data-testid="call-video"
                  onClick={onClick("video")}
                  aria-label="Video call"
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
                >
                  <Video className="h-5 w-5" />
                </button>
              </>
            );
          })()}
        <button
          type="button"
          data-testid="chat-search-toggle"
          onClick={() => {
            setShowSearch((v) => !v);
            if (showSearch) setSearchQ("");
          }}
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
              {/* Tap anywhere outside the list to dismiss and carry on. */}
              <div className="fixed inset-0 z-30" onClick={() => setShowHeaderMenu(false)} />
              <div className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
                {peerId ? (
                  <button
                    type="button"
                    data-testid="menu-view-contact"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowContactSheet(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                  >
                    <Info className="h-4 w-4" /> View contact
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="menu-group-info"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setShowMembersSheet(true);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                  >
                    <Users className="h-4 w-4" /> {isChannel ? "Channel info" : "Group info"}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="menu-search"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    setShowSearch(true);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                >
                  <Search className="h-4 w-4" /> Search
                </button>
                <button
                  type="button"
                  data-testid="menu-media"
                  onClick={() => {
                    setShowHeaderMenu(false);
                    setShowMediaSheet(true);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                >
                  <ImageIcon className="h-4 w-4" /> Media, links, and docs
                </button>
                <button
                  type="button"
                  data-testid="menu-mute"
                  onClick={() => {
                    const next = toggleConversationMute(conversationId);
                    setMuted(next);
                    setShowHeaderMenu(false);
                    toast(
                      next ? "notifications muted on this device 🔕" : "notifications back on 🔔",
                    );
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                >
                  {muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  {muted ? "Unmute notifications" : "Mute notifications"}
                </button>
                {peerId && (
                  <button
                    type="button"
                    data-testid="menu-delete-chat"
                    onClick={async () => {
                      setShowHeaderMenu(false);
                      if (
                        !confirm(
                          "Delete this chat for you? They keep their copy; if they message again the chat comes back empty.",
                        )
                      )
                        return;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const { error } = await (supabase as any).rpc("delete_chat", {
                        _conversation_id: conversationId,
                      });
                      if (error) {
                        toast.error(error.message);
                        return;
                      }
                      toast("Chat deleted");
                      navigate({ to: "/app/chat" });
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                  >
                    <Trash2 className="h-4 w-4" /> Delete chat
                  </button>
                )}
                <div className="h-px bg-border" />
                {peerId && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowHeaderMenu(false);
                      setReportTarget({ type: "user", id: peerId, conversationId });
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted"
                  >
                    <Flag className="h-4 w-4" /> Report user
                  </button>
                )}
                {peerId && (
                  <button
                    type="button"
                    onClick={toggleBlock}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-500 hover:bg-muted"
                  >
                    <Ban className="h-4 w-4" /> {isBlocked ? "Unblock user" : "Block user 🚫"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>
      {/* Channels wear their subscription strip under the header: the offer
          for members, the shop for the owner. Renders nothing for channels
          that never set a price. */}
      {isChannel && <ChannelSubBar conversationId={conversationId} isOwner={myRole === "owner"} />}
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
          <button
            type="button"
            onClick={() => {
              setSearchQ("");
              setShowSearch(false);
            }}
            className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* CallOverlay is mounted globally by GlobalCallHost (src/routes/_authenticated/app.tsx). */}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          nearBottomRef.current = nearBottom;
          setShowJump((cur) => (cur === !nearBottom ? cur : !nearBottom));
        }}
        /*
         * overflow-x-clip IS LORE-BEARING, NOT TIDINESS.
         *
         * `overflow-y: auto` alone does not mean "scrolls vertically". CSS
         * computes the OTHER axis to `auto` as soon as one axis is not
         * `visible`, so this scroller was horizontally scrollable too — and
         * the doodle wallpaper overflows it: doodleScatter can place a figure
         * at 67% with a 171px width, which runs past the right edge of a 448px
         * column. Reported 2026-08-18 from screenshots as a dark band down the
         * right side with the bubbles clipped against it.
         *
         * `clip` rather than `hidden` on purpose: `hidden` would make this a
         * scroll container on both axes and break the `sticky` doodle layer
         * below. `clip` pairs legally with `auto` on the other axis and just
         * refuses to paint outside the box.
         */
        className="relative flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-3 pb-2 pt-3"
        style={doodle ? doodleSurfaceStyle : undefined}
      >
        {doodle && (
          /* The doodle wallpaper: a scatter of Open Doodles figures UNDER the
             bubbles, stable per conversation so a chat always looks like
             itself. It was one figure in one corner, which read as a stray
             graphic rather than paper; a spread of them across the height
             reads as a printed sheet the messages sit on.

             The layer is `sticky` at zero height, so it costs the thread no
             layout at all and stays put while messages scroll over it — an
             absolutely positioned layer would only ever cover the first
             screenful of a long thread. */
          <div className="pointer-events-none sticky top-0 z-0 h-0 select-none" aria-hidden>
            {doodleScatter(conversationId).map((d) => (
              <img
                key={d.key}
                src={d.src}
                alt=""
                decoding="async"
                className="absolute opacity-[0.11]"
                style={{
                  top: `${d.top}vh`,
                  insetInlineStart: `${d.start}%`,
                  height: d.size,
                  width: d.size,
                  transform: `rotate(${d.rotate}deg)${d.flip ? " scaleX(-1)" : ""}`,
                }}
              />
            ))}
          </div>
        )}
        {isLoading ? (
          // Skeleton bubbles, not a "Loading…" line. Opening from a
          // notification cold-starts this screen, and a bare line of text that
          // pops into a full thread reads as broken; ghost bubbles in the real
          // layout read as loading.
          <div className="space-y-2.5 pt-2" aria-hidden>
            {[68, 44, 80, 56, 72, 38].map((w, i) => (
              <div key={i} className={`flex ${i % 3 === 1 ? "justify-end" : "justify-start"}`}>
                <div
                  className={`h-10 animate-pulse rounded-[18px] ${
                    i % 3 === 1 ? "bg-primary/15" : "bg-muted/60"
                  }`}
                  style={{ width: `${w}%`, maxWidth: "26rem" }}
                />
              </div>
            ))}
          </div>
        ) : rendered.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
            <img
              src={doodleFor(conversationId).src}
              alt=""
              aria-hidden
              className="h-36 w-36 opacity-70"
            />
            No messages yet. Say hi 👋
          </div>
        ) : (
          <>
            {hiddenRowCount > 0 && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  data-testid="load-earlier"
                  onClick={() => setWindowSize((n) => n + WINDOW_STEP)}
                  className="press rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold text-muted-foreground"
                >
                  Load earlier messages
                </button>
              </div>
            )}
            {windowedRows.map((r, idx) => {
              if (r.kind === "day") {
                return (
                  <div key={r.key} className="my-4 flex items-center justify-center">
                    <span className="rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[11px] font-medium text-white/85">
                      {r.label}
                    </span>
                  </div>
                );
              }
              if (r.kind === "system") {
                return (
                  <div key={r.key} className="my-2 flex items-center justify-center">
                    <span className="max-w-[15rem] rounded-full border border-white/10 bg-black/55 px-3 py-1 text-center text-[11px] text-white/85">
                      {r.text}
                    </span>
                  </div>
                );
              }
              const { m, firstOfGroup, lastOfGroup } = r;
              const mine = m.sender_id === me?.id;
              // On the doodle paper BOTH bubbles are light, so "mine" can no
              // longer mean "white text". These four tokens are the only place
              // that decision lives; every colour inside a bubble reads them.
              const ink = doodle ? "text-[#111b21]" : mine ? "text-white" : "text-foreground";
              const inkSoft = doodle
                ? "text-black/55"
                : mine
                  ? "text-white/70"
                  : "text-muted-foreground";
              const inkRule = doodle
                ? "border-black/10"
                : mine
                  ? "border-white/20"
                  : "border-border";
              const inkChip = doodle
                ? "bg-black/[0.06] text-[#111b21]"
                : mine
                  ? "bg-white/15 text-white/90"
                  : "bg-primary/15 text-primary";
              const groupGap = firstOfGroup ? "mt-2.5" : "mt-[2px]";
              const prev = windowedRows[idx - 1];
              const isFirstAfterBreak = firstOfGroup || (prev && prev.kind !== "msg");
              // 20px everywhere; the two corners FACING a neighbour in the same
              // group collapse to 7px. That is what makes grouping read without
              // drawing tails (Signal/Telegram's rule). The pair moved up from
              // 18/6 on 2026-08-18 to sit with the roomier padding and the
              // 16px body — a radius has to grow with the box it rounds or the
              // bubble reads tighter than it is.
              const bubbleRadius = [
                "rounded-[20px]",
                mine
                  ? `${isFirstAfterBreak ? "" : "rounded-tr-[7px]"} ${lastOfGroup ? "" : "rounded-br-[7px]"}`
                  : `${isFirstAfterBreak ? "" : "rounded-tl-[7px]"} ${lastOfGroup ? "" : "rounded-bl-[7px]"}`,
              ].join(" ");
              const isRead =
                mine && peerReadAt && m.created_at
                  ? new Date(peerReadAt).getTime() >= new Date(m.created_at).getTime()
                  : false;

              if (m.is_deleted) {
                return (
                  <div
                    key={r.key}
                    id={`msg-${m.id}`}
                    className={`flex ${mine ? "justify-end" : "justify-start"} ${groupGap}`}
                  >
                    <div
                      className={`max-w-[min(80%,26rem)] px-3.5 py-2.5 text-[16px] italic leading-[23px] text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.16)] ${bubbleRadius} ${doodle ? "border border-black/5 bg-white/70 text-black/50" : mine ? "border border-white/10 bg-[#0d6e58]/40" : "border border-border bg-surface-2"}`}
                    >
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
                <div
                  key={r.key}
                  id={`msg-${m.id}`}
                  className={`flex ${mine ? "justify-end" : "justify-start"} ${groupGap} transition-shadow`}
                >
                  <div
                    onTouchStart={(e) => startPress(m, e)}
                    onTouchMove={(e) => moveTouch(m, e)}
                    onTouchEnd={endPress}
                    onTouchCancel={endPress}
                    onDoubleClick={() => {
                      if (!m.is_deleted) toggleReaction(m.id, "❤️");
                    }}
                    onClick={() => {
                      if (m.is_deleted) return;
                      const now = Date.now();
                      const last = lastTapRef.current;
                      if (last && last.id === m.id && now - last.t < 300) {
                        lastTapRef.current = null;
                        toggleReaction(m.id, "❤️");
                      } else {
                        lastTapRef.current = { id: m.id, t: now };
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuFor(m);
                    }}
                    className={`group relative max-w-[min(80%,26rem)] flow-root text-[16px] leading-[23px] ${
                      m.type === "sticker"
                        ? /* Stickers wear no bubble — the glyph IS the message. */
                          "bg-transparent p-0.5 shadow-none"
                        : /* ONE SOFT SHADOW, NOT TWO STACKED ONES. The pair
                             below this was doing a job the border already
                             does; two shadows on a light bubble over patterned
                             paper reads as grime around the edge rather than
                             lift. Asked for 2026-08-18 against a reference
                             whose surfaces are flat and let type do the work. */
                          `shadow-[0_1px_2px_rgba(0,0,0,0.16)] ${
                            (m.type === "image" || m.type === "video") && m.media_url
                              ? "p-1"
                              : "px-3.5 py-2.5"
                          } ${bubbleRadius} ${
                            doodle
                              ? mine
                                ? "border border-black/5 bg-[#d9fdd3] text-[#111b21]"
                                : "border border-black/5 bg-white text-[#111b21]"
                              : mine
                                ? "border border-white/10 bg-[#0d6e58] text-white"
                                : "border border-border bg-surface-2 text-foreground"
                          }`
                    }`}
                  >
                    {isGroup &&
                      !mine &&
                      firstOfGroup &&
                      (() => {
                        const sm = senderMap.get(m.sender_id);
                        if (!sm) return null;
                        return (
                          <div
                            className="mb-1 truncate text-[13px] font-semibold leading-[16px]"
                            style={{ color: sm.color }}
                          >
                            {sm.name}
                          </div>
                        );
                      })()}
                    {/* normal-case/tracking-normal here, and an explicit weight on
                      each child, because styles.css uppercases and bolds EVERY
                      button app-wide — which rendered quoted messages, and the
                      header's conversation name, as SHOUTED CAPS. */}
                    {quoted && (
                      <button
                        type="button"
                        onClick={() => scrollToMessage(quoted.id)}
                        className={`mb-1.5 block w-full overflow-hidden rounded-[10px] border-l-[3px] border-primary py-1 pl-2 pr-2 text-left normal-case tracking-normal ${doodle ? "bg-black/[0.05]" : mine ? "bg-black/25" : "bg-white/[0.06]"}`}
                      >
                        <div className="mb-px truncate text-[13px] font-semibold leading-[16px] text-primary">
                          {quoted.sender_id === me?.id
                            ? "You"
                            : senderMap.get(quoted.sender_id)?.name || title || "Message"}
                        </div>
                        <div
                          className={`truncate text-[13px] font-normal leading-[17px] ${inkSoft}`}
                        >
                          {quoted.is_deleted
                            ? "This message was deleted"
                            : truncate(quoted.content ?? "", 80)}
                        </div>
                      </button>
                    )}
                    {m.is_ai && (
                      <div
                        className={`mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${inkChip}`}
                      >
                        <Sparkles className="h-2.5 w-2.5" /> AI-generated
                      </div>
                    )}
                    {m.type === "sticker" && m.content?.startsWith(DOODLE_MARK) ? (
                      /* A doodle: the key was sent, the drawing ships with the
                         app. An unknown key means a newer build sent a figure
                         this one doesn't carry — say so plainly rather than
                         rendering a broken image. */
                      (() => {
                        const d = doodleByKey(m.content.slice(DOODLE_MARK.length));
                        return d ? (
                          <img
                            src={d.src}
                            alt={d.label}
                            className="h-40 w-40 select-none object-contain"
                            draggable={false}
                          />
                        ) : (
                          <div className="px-1 py-0.5 text-[15px] italic opacity-70">
                            🎨 a doodle from a newer version
                          </div>
                        );
                      })()
                    ) : m.type === "sticker" ? (
                      <div className="select-none px-1 py-0.5 text-[64px] leading-[1.1]">
                        {m.content}
                      </div>
                    ) : m.type === "video" && m.media_url && m.content === VIDEO_NOTE_MARK ? (
                      /* Round video note — tap toggles play, WhatsApp-style. */
                      <ResolvedSrc refPath={m.media_url}>
                        {(src) =>
                          src ? (
                            <video
                              src={src}
                              playsInline
                              preload="metadata"
                              onClick={(e) => {
                                const v = e.currentTarget;
                                if (v.paused) void v.play().catch(() => {});
                                else v.pause();
                              }}
                              className="h-52 w-52 cursor-pointer rounded-full bg-black object-cover"
                            />
                          ) : (
                            <div className="h-52 w-52 animate-pulse rounded-full bg-black/40" />
                          )
                        }
                      </ResolvedSrc>
                    ) : m.type === "image" && m.media_url ? (
                      <ResolvedSrc refPath={m.media_url}>
                        {(src) =>
                          src ? (
                            <button
                              type="button"
                              onClick={() => setViewerUrl(src)}
                              className="block overflow-hidden rounded-[14px]"
                            >
                              <img
                                src={src}
                                alt=""
                                loading="lazy"
                                className="max-h-64 w-full object-cover"
                                onError={(e) => {
                                  // Swap the SRC, never the NODE. replaceWith() pulled
                                  // a React-owned element out of the DOM; the next
                                  // reconciliation of the row (a reaction, an edit)
                                  // then threw NotFoundError and blanked the thread.
                                  const el = e.currentTarget;
                                  el.onerror = null;
                                  el.src =
                                    "data:image/svg+xml," +
                                    encodeURIComponent(
                                      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="128"><rect width="100%" height="100%" fill="#1a1c24"/><text x="50%" y="50%" font-size="28" text-anchor="middle" dominant-baseline="central">📷</text></svg>',
                                    );
                                }}
                              />
                            </button>
                          ) : (
                            <div className="h-40 w-56 max-w-full animate-pulse rounded-[14px] bg-black/30" />
                          )
                        }
                      </ResolvedSrc>
                    ) : m.type === "voice" && m.media_url ? (
                      <ResolvedSrc refPath={m.media_url}>
                        {(src) =>
                          src ? (
                            <VoiceBubble
                              url={src}
                              durationS={m.duration_s ?? 0}
                              mine={mine}
                              onLight={doodle}
                            />
                          ) : null
                        }
                      </ResolvedSrc>
                    ) : m.type === "video" && m.media_url ? (
                      <ResolvedSrc refPath={m.media_url}>
                        {(src) =>
                          src ? (
                            <video
                              src={src}
                              controls
                              playsInline
                              preload="metadata"
                              className="max-h-64 w-full rounded-[14px] bg-black"
                            />
                          ) : (
                            <div className="h-36 w-56 max-w-full animate-pulse rounded-[14px] bg-black/30" />
                          )
                        }
                      </ResolvedSrc>
                    ) : m.type === "file" && m.media_url ? (
                      <div
                        className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${doodle ? "bg-black/[0.05]" : mine ? "bg-white/10 backdrop-blur" : "border border-border bg-muted/60"}`}
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-black/25 text-lg">
                          📄
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-sm font-medium ${ink}`}>
                            {truncateMiddle(m.file_name || "File", 30)}
                          </div>
                          {m.file_size ? (
                            <div className={`text-xs ${inkSoft}`}>{humanSize(m.file_size)}</div>
                          ) : null}
                        </div>
                        <ResolvedSrc refPath={m.media_url}>
                          {(src) => (
                            <button
                              type="button"
                              disabled={!src}
                              onClick={() =>
                                src && window.open(src, "_blank", "noopener,noreferrer")
                              }
                              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 ${inkChip}`}
                            >
                              Open
                            </button>
                          )}
                        </ResolvedSrc>
                      </div>
                    ) : (
                      (() => {
                        const reel = m.content ? extractReelShare(m.content) : null;
                        if (reel) {
                          return (
                            <div>
                              {reel.note && (
                                <div className="whitespace-pre-wrap break-words">{reel.note}</div>
                              )}
                              <ReelChatCard clipId={reel.clipId} />
                            </div>
                          );
                        }
                        return (
                          <div className="whitespace-pre-wrap break-words">
                            <LinkifiedText text={m.content ?? ""} />
                          </div>
                        );
                      })()
                    )}
                    {/* Translation, when this reader asked for one. Shown BELOW
                      the original rather than replacing it: a translation is a
                      machine's reading of what someone said, and hiding the
                      words they actually typed would present a guess as the
                      message itself. The original stays one tap away always. */}
                    {translatingId === m.id && !translated[m.id] && (
                      <div className={`mt-1 text-[11px] italic ${inkSoft}`}>translating…</div>
                    )}
                    {translated[m.id] && !showOriginal[m.id] && (
                      <div
                        data-testid={`translation-${m.id}`}
                        className={`mt-1.5 border-t pt-1.5 ${inkRule}`}
                      >
                        <div className="whitespace-pre-wrap break-words">
                          <LinkifiedText text={translated[m.id]} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowOriginal((s) => ({ ...s, [m.id]: true }))}
                          className={`mt-1 text-[10px] underline ${inkSoft}`}
                        >
                          translated by AI · show original
                        </button>
                      </div>
                    )}
                    {translated[m.id] && showOriginal[m.id] && (
                      <button
                        type="button"
                        onClick={() => setShowOriginal((s) => ({ ...s, [m.id]: false }))}
                        className={`mt-1 text-[10px] underline ${inkSoft}`}
                      >
                        show translation
                      </button>
                    )}
                    <div
                      className={`${
                        (m.type === "text" || !m.type) &&
                        (reactionsByMsg.get(m.id) ?? []).length === 0
                          ? "float-right -mr-0.5 ml-2 mt-[7px]"
                          : "mt-0.5 justify-end"
                      } flex items-center gap-1 text-[11px] tabular-nums ${
                        doodle ? "text-black/45" : mine ? "text-white/60" : "text-muted-foreground"
                      }`}
                    >
                      {m.edited_at && <span className="italic">edited</span>}
                      {me && (m.starred_by ?? []).includes(me.id) && (
                        <Star
                          className={`h-3 w-3 ${mine ? "fill-yellow-300 text-yellow-300" : "fill-yellow-500 text-yellow-500"}`}
                        />
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
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleReaction(m.id, emoji);
                              }}
                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${v.mine ? "border-primary bg-primary/20 text-foreground" : "border-border bg-background/70 text-foreground"}`}
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
            })}
          </>
        )}
        {peerTyping && (
          <div className="mt-2 flex justify-start">
            <div className="rounded-[20px] rounded-tl-[7px] border border-border bg-surface-2 px-3.5 py-2.5 text-xs text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.16)]">
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

      {/* Jump to newest — appears whenever the reader has scrolled up. */}
      {showJump && (
        <button
          type="button"
          onClick={() => {
            nearBottomRef.current = true;
            setShowJump(false);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
          aria-label="Jump to newest messages"
          className="press absolute right-4 z-30 grid h-10 w-10 place-items-center rounded-full border border-border bg-background/90 text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.45)] backdrop-blur-sm"
          style={{ bottom: "calc(var(--composer-h, 5.5rem) + 0.75rem)" }}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}

      {/* Long-press action sheet */}
      {menuFor && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMenuFor(null)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-2 pb-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="mb-2 flex items-center justify-around rounded-2xl bg-muted/40 px-2 py-2">
              {reactionRow.map((e) => (
                <button
                  key={e}
                  type="button"
                  data-testid={`react-${e}`}
                  onClick={() => {
                    const f = menuFor;
                    setMenuFor(null);
                    toggleReaction(f.id, e);
                  }}
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
              onClick={() => {
                const f = menuFor;
                setMenuFor(null);
                toggleStar(f);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <Star className="h-4 w-4" />{" "}
              {me && (menuFor.starred_by ?? []).includes(me.id) ? "Unstar" : "Star ⭐"}
            </button>
            {menuFor.sender_id === me?.id &&
              menuFor.type === "text" &&
              !menuFor.is_deleted &&
              menuFor.created_at &&
              Date.now() - new Date(menuFor.created_at).getTime() < EDIT_WINDOW_MS && (
                <button
                  type="button"
                  data-testid="msg-edit"
                  onClick={() => startEdit(menuFor)}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              )}
            {menuFor.type === "text" && !menuFor.is_deleted && (
              <button
                type="button"
                onClick={() => copyMessage(menuFor)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
              >
                <Copy className="h-4 w-4" /> Copy
              </button>
            )}
            {/* Translate. Offered on other people's text messages only —
                translating your own words into your own language is a no-op,
                and every call sends content to a third-party model provider,
                so the pointless case should not be one tap away. */}
            {menuFor.type === "text" &&
              !menuFor.is_deleted &&
              menuFor.sender_id !== me?.id &&
              (menuFor.content ?? "").trim().length > 0 && (
                <button
                  type="button"
                  data-testid="msg-translate"
                  onClick={() => translateMessage(menuFor)}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
                >
                  <Languages className="h-4 w-4" />{" "}
                  {translated[menuFor.id]
                    ? "Show translation"
                    : `Translate to ${LANG_NATIVE[myLang] ?? myLang}`}
                </button>
              )}
            {/* Per conversation, never global, and off until turned on here.
                On, it only reveals translations already in the shared cache
                — it never translates anything by itself. */}
            {menuFor.type === "text" && !menuFor.is_deleted && (
              <button
                type="button"
                data-testid="msg-translate-chat-pref"
                onClick={async () => {
                  const next = !convTranslate;
                  setMenuFor(null);
                  setConvTranslate(next);
                  try {
                    await setConversationTranslation(conversationId, next);
                  } catch {
                    setConvTranslate(!next);
                    toast.error("Couldn't save that setting");
                  }
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
              >
                <Languages className="h-4 w-4" />{" "}
                {convTranslate
                  ? "Stop showing translations in this chat"
                  : "Show translations in this chat"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const f = menuFor;
                setMenuFor(null);
                setForwardMsg(f);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
            >
              <Share2 className="h-4 w-4" /> Forward ↪️
            </button>
            {menuFor.sender_id === me?.id && (
              <button
                type="button"
                onClick={() => {
                  const f = menuFor;
                  setMenuFor(null);
                  setInfoFor(f);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm hover:bg-muted"
              >
                <Info className="h-4 w-4" /> Info
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
              onClick={() => {
                const f = menuFor;
                setMenuFor(null);
                setDeleteConfirm(f);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-red-500 hover:bg-muted"
            >
              <Trash2 className="h-4 w-4" /> Delete
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

      {/* Translation consent. Raised BEFORE the first translation call ever
          happens, never after: the message text leaves the device to a model
          provider, which is its own purpose in the notice and its own row in
          the consent ledger. Declining simply leaves the original on screen. */}
      {consentAsk && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-1 font-display text-lg font-semibold">Translate messages?</div>
            <div className="mb-4 text-sm text-muted-foreground">
              To translate, the text of this message is sent to our AI provider and the machine
              translation is stored so it does not have to be sent again. The original message is
              always kept and always shown. Nothing is translated unless you ask. You can withdraw
              this in Privacy → Consent notice at any time.
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                data-testid="translate-consent-agree"
                disabled={consentBusy}
                onClick={async () => {
                  const m = consentAsk;
                  setConsentBusy(true);
                  try {
                    await grantTranslationConsent(myLang);
                    setConsentAsk(null);
                    await runTranslate(m);
                  } catch {
                    toast.error("Couldn't record that — try again");
                  } finally {
                    setConsentBusy(false);
                  }
                }}
                className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                I agree — translate
              </button>
              <button
                type="button"
                onClick={() => setConsentAsk(null)}
                className="w-full rounded-xl px-4 py-3 text-sm text-muted-foreground hover:bg-muted"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 font-display text-lg font-semibold">Delete message?</div>
            <div className="mb-4 text-sm text-muted-foreground">
              {deleteConfirm.sender_id === me?.id
                ? "You can delete it for everyone or just for yourself."
                : "This will remove the message from your view only."}
            </div>
            <div className="flex flex-col gap-2">
              {deleteConfirm.sender_id === me?.id && !deleteConfirm.is_deleted && (
                <button
                  type="button"
                  onClick={() => deleteForEveryone(deleteConfirm)}
                  className="w-full rounded-xl bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-500 hover:bg-red-500/25"
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                data-testid="delete-for-me"
                onClick={() => deleteForMe(deleteConfirm)}
                className="w-full rounded-xl bg-muted px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/70"
              >
                Delete for me
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="w-full rounded-xl px-4 py-3 text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {infoFor && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6"
          onClick={() => setInfoFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 font-display text-lg font-semibold">Message info</div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Sent</span>
                <span>
                  {infoFor.created_at
                    ? format(new Date(infoFor.created_at), "d MMM yyyy, HH:mm")
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Read</span>
                <span>
                  {peerReadAt &&
                  infoFor.created_at &&
                  new Date(peerReadAt).getTime() >= new Date(infoFor.created_at).getTime()
                    ? format(new Date(peerReadAt), "d MMM yyyy, HH:mm")
                    : "Not yet"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInfoFor(null)}
              className="mt-4 w-full rounded-xl bg-muted px-4 py-3 text-sm hover:bg-muted/70"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {reportTarget && <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />}

      {showContactSheet && peerId && (
        <ContactSheet peerId={peerId} onClose={() => setShowContactSheet(false)} />
      )}
      {studioQueue.length > 0 && (
        <PhotoStudio
          key={`${studioQueue.length}-${studioQueue[0].name}-${studioQueue[0].size}-${studioQueue[0].lastModified}`}
          file={studioQueue[0]}
          onCancel={() => {
            setStudioQueue([]);
            studioResults.current = [];
          }}
          onDone={(edited) => {
            const rest = studioQueue.slice(1);
            const acc = [...studioResults.current, edited];
            studioResults.current = acc;
            setStudioQueue(rest);
            if (rest.length === 0) {
              studioResults.current = [];
              void handlePickedFiles(acc, "image");
            }
          }}
        />
      )}

      {showMediaSheet && (
        <MediaLinksDocsSheet messages={messages} onClose={() => setShowMediaSheet(false)} />
      )}

      {showPhotoPopup && (
        <ProfilePhotoPopup
          target={{
            conversationId,
            title,
            avatarUrl: header?.avatar_url ?? null,
            isGroup,
            isChannel,
          }}
          onClose={() => setShowPhotoPopup(false)}
        />
      )}

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
        <div
          className="border-t border-border/60 bg-background/88 px-4 pt-3 text-center text-xs text-muted-foreground backdrop-blur-md"
          style={{
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
          }}
        >
          You're subscribed 🔔 · only the channel owner can post
        </div>
      ) : (
        <form
          ref={composerRef}
          onSubmit={send}
          className="flex flex-col gap-2 border-t border-border/60 bg-background/88 px-3 pt-3 backdrop-blur-md"
          style={{
            paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
          }}
        >
          {editing && (
            <div className="flex items-center gap-2 rounded-xl border-l-2 border-yellow-400 bg-muted/60 px-3 py-2">
              <Pencil className="h-4 w-4 text-yellow-400" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-yellow-400">Editing message</div>
                <div className="truncate text-xs text-muted-foreground">
                  {truncate(editing.content ?? "", 90)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setText("");
                }}
                aria-label="Cancel edit"
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {replyTo && (
            <div className="flex items-center gap-2 rounded-xl border-l-2 border-primary bg-muted/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-primary">
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
                {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:
                {String(recSeconds % 60).padStart(2, "0")} • recording…
              </span>
              <button
                type="button"
                onClick={() => stopRecording(true)}
                aria-label="Cancel recording"
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                aria-label="Send voice"
                className="grid h-11 w-11 place-items-center rounded-full bg-[#0d6e58] text-white transition active:scale-95"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {pendingBatch.length > 0 && (
                <div
                  data-testid="chat-batch-tray"
                  className="rounded-2xl border border-border bg-card/60 p-2"
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span className="text-xs text-muted-foreground">
                      {batchProgress
                        ? `uploading ${batchProgress.done}/${batchProgress.total}…`
                        : `${pendingBatch.length} item${pendingBatch.length === 1 ? "" : "s"}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={clearBatch}
                        disabled={uploading}
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        data-testid="chat-batch-send"
                        onClick={() => void sendPendingBatch()}
                        disabled={uploading}
                        className="rounded-full bg-[#0B5A4E] px-3 py-1 text-xs font-medium text-white transition active:scale-95 disabled:opacity-40"
                      >
                        <Send className="mr-1 inline h-3 w-3" /> Send
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto">
                    {pendingBatch.map((it) => (
                      <div key={it.id} className="relative shrink-0">
                        {it.kind === "image" ? (
                          <img
                            src={it.previewUrl}
                            alt=""
                            className="h-20 w-20 rounded-lg object-cover"
                          />
                        ) : it.kind === "video" ? (
                          <div className="relative h-20 w-20 overflow-hidden rounded-lg bg-black/40">
                            <video
                              src={it.previewUrl}
                              className="h-full w-full object-cover"
                              muted
                              preload="metadata"
                            />
                            <div className="absolute inset-0 grid place-items-center">
                              <Play className="h-6 w-6 text-white drop-shadow" />
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-20 w-32 flex-col justify-center rounded-lg bg-muted p-2">
                            <div className="truncate text-xs font-medium">{it.file.name}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {humanSize(it.file.size)}
                            </div>
                          </div>
                        )}
                        {!uploading && (
                          <button
                            type="button"
                            aria-label="Remove"
                            onClick={() => removeFromBatch(it.id)}
                            className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                {/*
            Five hidden file inputs used to sit here — including two with
            capture="environment" that looked exactly like working camera
            wiring. Nothing ever clicked any of them: they predate the unified
            AttachmentSheet, which owns its own input and every picker path.
            They are removed rather than left, because a dead camera input next
            to a broken camera button is how the bug came back.
          */}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmojiPicker(false);
                      setShowAttachSheet((v) => !v);
                    }}
                    disabled={isBlocked || uploading}
                    aria-label="Attach"
                    data-testid="chat-attach"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground transition active:scale-95 disabled:opacity-40"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                  <AttachmentSheet
                    open={showAttachSheet}
                    surface="chat"
                    context={attachCtx}
                    onClose={() => setShowAttachSheet(false)}
                    onFiles={(opt, files) => handleSheetFiles(opt, files)}
                    onSelect={(opt) => {
                      if (opt.id === "location") sendLocation();
                    }}
                  />
                </div>
                {/* A ROUNDED CARD, NOT A PILL. Asked for 2026-08-18 against a
                    reference whose composer is a squared-off rounded rectangle
                    with a visible edge. A full pill (rounded-full) collapses
                    to a lozenge the moment the field is one line tall, which
                    is most of the time; 22px keeps a readable rectangle at one
                    line and still looks intentional at three. */}
                {/* min-w-0 IS THE COMPOSER FITTING ON A PHONE AT ALL. An
                    <input> refuses to shrink below its intrinsic size (about
                    20 characters, ~180px) unless its flex ancestors allow it,
                    because flexbox min-width defaults to auto. On a 384px-wide
                    phone, paperclip + emoji + that floor + circle-dot + mic
                    comes to MORE than the screen: the mic fell off the right
                    edge and the document went wider than the viewport, which
                    is the sideways-pannable app in the 15:47 screenshots.
                    min-w-0 here and on the input lets the field yield instead
                    of the row overflowing. */}
                <div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-[22px] border border-border bg-input/40 pl-4 pr-2">
                  <button
                    type="button"
                    aria-label="Emoji"
                    data-testid="chat-emoji-toggle"
                    disabled={isBlocked}
                    onClick={() => {
                      setShowAttachSheet(false);
                      setShowEmojiPicker((v) => !v);
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition active:scale-95 hover:bg-muted disabled:opacity-40"
                  >
                    <Smile className="h-5 w-5" />
                  </button>
                  {showEmojiPicker && (
                    <>
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setShowEmojiPicker(false)}
                      />
                      <div className="absolute bottom-14 left-0 right-0 z-40 max-h-[260px] overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-2xl">
                        <div className="sticky top-0 z-10 bg-card px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Stickers
                        </div>
                        <div className="mb-1 flex flex-wrap">
                          {STICKERS.map((s) => (
                            <button
                              key={`stk-${s}`}
                              type="button"
                              onClick={() => void sendSticker(s)}
                              className="grid h-14 w-14 place-items-center rounded-xl text-4xl transition active:scale-90 hover:bg-muted"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        {/* Doodles sit in the same drawer as stickers because
                            that is what they are here: a picture you send
                            instead of a sentence. All 33 of them, drawn from
                            the app's own assets, so the rack works offline. */}
                        <div className="sticky top-0 z-10 bg-card px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Doodles 🎨
                        </div>
                        <div className="mb-1 grid grid-cols-4 gap-1">
                          {DOODLES.map((d) => (
                            <button
                              key={`doodle-${d.key}`}
                              type="button"
                              onClick={() => void sendDoodle(d.key)}
                              title={d.label}
                              aria-label={`Send doodle: ${d.label}`}
                              className="grid h-20 place-items-center rounded-xl p-1 transition active:scale-90 hover:bg-muted"
                            >
                              <img
                                src={d.src}
                                alt=""
                                // 33 detailed vector drawings in one grid is a
                                // real cost on a phone: without these the
                                // drawer fetched and rasterised every one the
                                // moment it opened.
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-contain"
                                draggable={false}
                              />
                            </button>
                          ))}
                        </div>
                        {EMOJI_CATEGORIES.map((cat) => (
                          <div key={cat.name}>
                            <div className="sticky top-0 z-10 bg-card px-1 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {cat.name}
                            </div>
                            <div className="mb-1 flex flex-wrap">
                              {cat.emojis.map((em) => (
                                <button
                                  key={cat.name + em}
                                  type="button"
                                  onClick={() => insertEmoji(em)}
                                  className="grid h-9 w-9 place-items-center rounded-lg text-xl transition active:scale-90 hover:bg-muted"
                                >
                                  {em}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <input
                    data-testid="chat-input"
                    ref={inputRef}
                    value={text}
                    onChange={(e) => handleTextChange(e.target.value)}
                    onBlur={() => emitTyping("stop")}
                    placeholder={
                      isBlocked
                        ? "You've blocked this user — unblock to chat"
                        : uploading
                          ? "uploading…"
                          : "Message"
                    }
                    disabled={isBlocked}
                    className="min-w-0 flex-1 bg-transparent py-3 text-[15px] placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
                  />
                </div>
                {text.trim() ? (
                  <button
                    data-testid="chat-send"
                    type="submit"
                    disabled={sending}
                    className="grid h-11 w-11 place-items-center rounded-full bg-[#0d6e58] text-white transition active:scale-95 disabled:opacity-40"
                    aria-label="Send"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowVideoNote(true)}
                      disabled={isBlocked}
                      data-testid="chat-video-note"
                      className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground transition active:scale-95 disabled:opacity-40"
                      aria-label="Video note"
                    >
                      <CircleDot className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={isBlocked}
                      data-testid="chat-mic"
                      className="grid h-11 w-11 place-items-center rounded-full bg-[#0d6e58] text-white transition active:scale-95 disabled:opacity-40"
                      aria-label="Voice note"
                    >
                      <Mic className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </form>
      )}

      {showVideoNote && (
        <VideoNoteRecorder
          onClose={() => setShowVideoNote(false)}
          onSend={async (blob, ext, durationS) => {
            const url = await uploadToChatMedia(blob, ext);
            await insertMediaMessage({
              type: "video",
              media_url: url,
              duration_s: durationS,
              content: VIDEO_NOTE_MARK,
            });
          }}
        />
      )}

      {/* Full-bleed image viewer, not a card — `data-full-bleed` opts it out of
          the app-wide modal bounding in styles.css so the image keeps filling
          the screen instead of gaining a scrollbar. */}
      {viewerUrl && (
        <div
          data-full-bleed
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black"
          onClick={() => setViewerUrl(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setViewerUrl(null)}
            className="absolute right-4 top-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={viewerUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {forwardMsg && me && (
        <ForwardSheet message={forwardMsg} meId={me.id} onClose={() => setForwardMsg(null)} />
      )}
    </div>
  );
}

function VoiceBubble({
  url,
  durationS,
  mine,
  onLight,
}: {
  url: string;
  durationS: number;
  mine: boolean;
  /** Doodle paper: the bubble is light, so white-on-white must not happen. */
  onLight?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => {
      // pause any other playing audio
      document.querySelectorAll("audio").forEach((el) => {
        if (el !== a && !el.paused) el.pause();
      });
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
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className={`grid h-8 w-8 place-items-center rounded-full ${onLight ? "bg-black/10" : mine ? "bg-white/20" : "bg-primary/20"}`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div
        className={`h-1.5 w-32 overflow-hidden rounded-full ${onLight ? "bg-black/10" : mine ? "bg-white/20" : "bg-muted"}`}
      >
        <div
          className={`h-full ${onLight ? "bg-[#111b21]" : mine ? "bg-white" : "bg-primary"}`}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <span
        className={`text-xs tabular-nums ${onLight ? "text-black/55" : mine ? "text-white/80" : "text-muted-foreground"}`}
      >
        {mm}:{ss}
      </span>
      <audio ref={audioRef} src={url} preload="metadata" />
    </div>
  );
}

function ForwardSheet({
  message,
  meId,
  onClose,
}: {
  message: Message;
  meId: string;
  onClose: () => void;
}) {
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
      const rows = ((data ?? []) as any[]).filter(
        (r) => r.conversations && r.conversation_id !== message.conversation_id,
      );
      const enriched = await Promise.all(
        rows.map(async (r) => {
          const c = r.conversations;
          let title = c.name ?? "Chat";
          let avatar: string | null = c.avatar_url ?? null;
          if (c.type === "direct") {
            const { data: other } = await supabase
              .from("conversation_members")
              .select("profiles(display_name, username, avatar_url)")
              .eq("conversation_id", c.id)
              .neq("user_id", meId)
              .maybeSingle();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = (other as any)?.profiles;
            if (p) {
              title = p.display_name || p.username || "Chat";
              avatar = p.avatar_url ?? avatar;
            }
          }
          return { id: c.id as string, title, avatar, type: c.type as string };
        }),
      );
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
    if (error) {
      toast.error(error.message || "couldn't forward");
      return;
    }
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", targetId);
    toast.success("Forwarded ➤");
    onClose();
    navigate({ to: "/app/chat/$conversationId", params: { conversationId: targetId } });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-card p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
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
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left normal-case tracking-normal hover:bg-muted disabled:opacity-60"
                >
                  <div
                    className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: colorFor(c.title) }}
                  >
                    {c.avatar ? (
                      <img src={c.avatar} alt="" className="h-full w-full object-cover" />
                    ) : c.type === "group" ? (
                      <Users className="h-5 w-5" />
                    ) : (
                      c.title.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="flex-1 truncate text-sm font-medium">{c.title}</span>
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
    else {
      toast.success("Member removed");
      onChanged();
    }
  };

  const addMember = async (uid: string) => {
    setBusy(true);
    const { error } = await supabase.rpc("add_group_members", {
      _conversation_id: conversationId,
      _member_ids: [uid],
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Member added");
      setShowAdd(false);
      setQ("");
      onChanged();
    }
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
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
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
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left normal-case tracking-normal hover:bg-muted disabled:opacity-50"
                >
                  <div
                    className="grid h-8 w-8 place-items-center overflow-hidden rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: colorFor(u.id) }}
                  >
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (u.display_name || u.username || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{u.display_name}</div>
                    <div className="truncate text-xs font-normal text-muted-foreground">
                      @{u.username}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="mt-3 divide-y divide-border/50">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2.5">
              <div
                className="grid h-10 w-10 place-items-center overflow-hidden rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: colorFor(m.user_id) }}
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  (m.display_name || m.username || "?").charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate text-sm font-medium">
                    {m.display_name || m.username}
                    {m.user_id === meId ? " (you)" : ""}
                  </span>
                  {m.role === "owner" && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      owner
                    </span>
                  )}
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

/* ---------------- Contact sheet (three-dot → View contact) ---------------- */

function ContactSheet({ peerId, onClose }: { peerId: string; onClose: () => void }) {
  const { data: peer } = useQuery({
    queryKey: ["contact-sheet", peerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_url, created_at")
        .eq("id", peerId)
        .maybeSingle();
      return data;
    },
  });
  const name = peer?.display_name || peer?.username || "ONIQ user";
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl border-t border-border bg-background p-6 pb-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-20 w-20 overflow-hidden rounded-full bg-muted">
          {peer?.avatar_url ? (
            <img src={peer.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-3xl font-bold text-muted-foreground">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="mt-3 font-display text-lg font-bold">{name}</div>
        {peer?.username && <div className="text-sm text-muted-foreground">@{peer.username}</div>}
        {peer?.created_at && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            on ONIQ since {new Date(peer.created_at).toLocaleDateString()}
          </div>
        )}
        <Link
          to="/app/u/$userId"
          params={{ userId: peerId }}
          className="press mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          view their page ✨
        </Link>
        <button
          onClick={onClose}
          className="press mt-2 w-full rounded-2xl border border-border py-3 text-sm text-muted-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* ------------- Media, links & docs sheet (three-dot menu) ------------- */

function MediaLinksDocsSheet({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  const [tab, setTab] = useState<"media" | "links" | "docs">("media");
  const live = messages.filter((m) => !m.is_deleted);
  const media = live.filter((m) => (m.type === "image" || m.type === "video") && m.media_url);
  const docs = live.filter((m) => (m.type === "file" || m.type === "voice") && m.media_url);
  const links = live.flatMap((m) => {
    if (m.type !== "text" || !m.content) return [];
    const found = m.content.match(/https?:\/\/[^\s]+/g);
    return (found ?? []).map((url) => ({ id: m.id + url, url, at: m.created_at }));
  });
  const TABS = [
    ["media", `Media ${media.length}`],
    ["links", `Links ${links.length}`],
    ["docs", `Docs ${docs.length}`],
  ] as const;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl border-t border-border bg-background p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">Media, links, and docs</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 rounded-xl border border-border bg-card p-1 text-xs">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg py-2 font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {tab === "media" &&
            (media.length === 0 ? (
              <Empty label="no photos or videos here yet 📷" />
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {media.map((m) => (
                  <ResolvedSrc key={m.id} refPath={m.media_url!}>
                    {(src) => (
                      <button
                        disabled={!src}
                        onClick={() => src && window.open(src, "_blank")}
                        className="aspect-square overflow-hidden rounded-lg bg-muted disabled:opacity-60"
                      >
                        {!src ? null : m.type === "image" ? (
                          <img
                            src={src}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <video src={src} muted className="h-full w-full object-cover" />
                        )}
                      </button>
                    )}
                  </ResolvedSrc>
                ))}
              </div>
            ))}
          {tab === "links" &&
            (links.length === 0 ? (
              <Empty label="no links shared yet 🔗" />
            ) : (
              <div className="space-y-2">
                {links.map((l) => (
                  <a
                    key={l.id}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 rounded-xl border border-border p-3"
                  >
                    <Link2 className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-sm text-primary">{l.url}</span>
                  </a>
                ))}
              </div>
            ))}
          {tab === "docs" &&
            (docs.length === 0 ? (
              <Empty label="no files or voice notes yet 📎" />
            ) : (
              <div className="space-y-2">
                {docs.map((m) => (
                  <ResolvedDocRow key={m.id} m={m} />
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{label}</div>;
}

/* One row of the docs tab, resolving legacy signed URLs and B1 bare paths alike. */
function ResolvedDocRow({ m }: { m: Message }) {
  return (
    <ResolvedSrc refPath={m.media_url!}>
      {(src) => (
        <button
          disabled={!src}
          onClick={() => src && window.open(src, "_blank")}
          className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left normal-case tracking-normal disabled:opacity-60"
        >
          {m.type === "voice" ? (
            <Mic className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {m.file_name || (m.type === "voice" ? "Voice note" : "File")}
            </span>
            {m.file_size ? (
              <span className="text-[11px] font-normal text-muted-foreground">
                {humanSize(m.file_size)}
              </span>
            ) : null}
          </span>
        </button>
      )}
    </ResolvedSrc>
  );
}

/* ---------------- Video notes ----------------
   A round, front-camera moment — record up to VIDEO_NOTE_MAX_S seconds and
   send. Rides the 'video' message type with VIDEO_NOTE_MARK as content, so
   nothing about storage, RLS, or older clients changes; only the bubble
   turns round. */
function VideoNoteRecorder({
  onClose,
  onSend,
}: {
  onClose: () => void;
  onSend: (blob: Blob, ext: string, durationS: number) => Promise<void>;
}) {
  // EVERY HOOK ABOVE EVERY EARLY RETURN. rules-of-hooks is a release blocker.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const cancelRef = useRef(false);
  const startedAtRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        toast.error("Camera unavailable");
        onClose();
      }
    })();
    return () => {
      cancelled = true;
      if (recRef.current && recRef.current.state === "recording") {
        cancelRef.current = true;
        recRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // onClose identity is stable enough for a mount-once effect; re-running
    // this on parent re-renders would restart the camera mid-recording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const s = Math.round((Date.now() - startedAtRef.current) / 1000);
      setElapsed(s);
      if (s >= VIDEO_NOTE_MAX_S && recRef.current?.state === "recording") {
        recRef.current.stop();
      }
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  function begin() {
    const stream = streamRef.current;
    if (!stream || recording || typeof MediaRecorder === "undefined") return;
    const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      toast.error("Recording not supported on this device");
      return;
    }
    chunksRef.current = [];
    cancelRef.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      setRecording(false);
      if (cancelRef.current) return;
      const type = rec.mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size === 0) return;
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const durationS = Math.max(
        1,
        Math.min(VIDEO_NOTE_MAX_S, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
      setBusy(true);
      onSend(blob, ext, durationS)
        .then(() => onClose())
        .catch((e2) => {
          toast.error(e2 instanceof Error ? e2.message : "Couldn't send");
          setBusy(false);
        });
    };
    recRef.current = rec;
    startedAtRef.current = Date.now();
    setElapsed(0);
    rec.start(250);
    setRecording(true);
  }

  function finish() {
    if (recRef.current?.state === "recording") recRef.current.stop();
  }

  return (
    <div
      data-full-bleed
      className="fixed inset-0 z-[85] flex flex-col items-center justify-center bg-black/90"
    >
      <div className="relative h-72 w-72 overflow-hidden rounded-full border-2 border-white/20 bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full -scale-x-100 object-cover"
        />
        {recording && (
          <div className="absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full bg-red-600/90 px-2.5 py-0.5 text-[11px] font-semibold text-white">
              ● {elapsed}s / {VIDEO_NOTE_MAX_S}s
            </span>
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            cancelRef.current = true;
            if (recRef.current?.state === "recording") recRef.current.stop();
            onClose();
          }}
          disabled={busy}
          className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Cancel
        </button>
        {recording ? (
          <button
            type="button"
            onClick={finish}
            disabled={busy}
            className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg disabled:opacity-50"
            aria-label="Stop and send"
          >
            <Send className="h-6 w-6" />
          </button>
        ) : (
          <button
            type="button"
            onClick={begin}
            disabled={!ready || busy}
            className="grid h-16 w-16 place-items-center rounded-full bg-white disabled:opacity-50"
            aria-label="Start recording"
          >
            <span className="h-7 w-7 rounded-full bg-red-600" />
          </button>
        )}
      </div>
      {busy && <div className="mt-4 text-xs text-white/80">Sending…</div>}
    </div>
  );
}
