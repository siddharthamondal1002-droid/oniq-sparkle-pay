// Chat message notifier — WhatsApp-style desktop/web notifications.
// HONEST LIMIT: closed-app / phone-locked push requires FCM + a native
// Capacitor build. This handler works while the browser tab is alive (open
// or backgrounded). Missing that, we still update the app-icon badge.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bell, X } from "lucide-react";

type Msg = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  created_at: string | null;
  is_deleted: boolean | null;
};

function bodyFor(m: Msg): string {
  if (m.is_deleted) return "";
  if (m.type === "image") return "📷 Photo";
  if (m.type === "voice") return "🎙 Voice note";
  const c = (m.content ?? "").trim();
  return c.length > 80 ? c.slice(0, 80) + "…" : c;
}

async function showNativeNotif(title: string, body: string, conversationId: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const url = `/app/chat/${conversationId}`;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && "showNotification" in reg) {
      await reg.showNotification(title, {
        body,
        tag: conversationId,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url },
      });
      return;
    }
    new Notification(title, { body, tag: conversationId, icon: "/icon-192.png" });
  } catch {
    /* noop */
  }
}

export function MessageNotifier() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const senderCacheRef = useRef<Map<string, string>>(new Map());

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  // My conversation ids — used to filter incoming INSERT events.
  const { data: myConvIds = [] } = useQuery({
    queryKey: ["my-conversation-ids", me?.id],
    enabled: !!me,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", me!.id);
      return (data ?? []).map((r) => r.conversation_id);
    },
  });
  const convSet = useMemo(() => new Set(myConvIds), [myConvIds]);

  // Update app-icon badge from cached chat-list unread counts.
  const conversations = qc.getQueryData<Array<{ unread?: number }>>(["conversations", me?.id]);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    const list = qc.getQueriesData<Array<{ unread?: number }>>({ queryKey: ["conversations"] });
    let total = 0;
    for (const [, data] of list) {
      if (Array.isArray(data)) for (const c of data) total += c?.unread ?? 0;
    }
    try {
      if (total > 0 && typeof nav.setAppBadge === "function") nav.setAppBadge(total);
      else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge();
    } catch {
      /* unsupported */
    }
  }, [qc, conversations]);

  // Realtime: all message INSERTs (client-side filtered).
  useEffect(() => {
    if (!me || convSet.size === 0) return;
    const channel = supabase
      .channel(`msg-notifier:${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const m = payload.new as Msg;
          if (!m || m.sender_id === me.id) return;
          if (!convSet.has(m.conversation_id)) return;
          const inThread = pathRef.current === `/app/chat/${m.conversation_id}`;
          const active = !document.hidden && inThread;
          if (active) return;
          // Resolve sender display name (cached).
          let name = senderCacheRef.current.get(m.sender_id);
          if (!name) {
            const { data } = await supabase
              .from("profiles")
              .select("display_name, username")
              .eq("id", m.sender_id)
              .maybeSingle();
            name = data?.display_name || data?.username || "New message";
            senderCacheRef.current.set(m.sender_id, name);
          }
          const body = bodyFor(m);
          if (!body) return;
          showNativeNotif(name, body, m.conversation_id);
          try {
            const { playPing } = await import("@/lib/callSounds");
            playPing();
          } catch {}
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [me, convSet]);

  // Contextual permission banner — chat list only, once per session.
  const onChatList = pathname === "/app/chat" || pathname === "/app/chat/";
  const showBanner = onChatList && permission === "default" && !bannerDismissed;

  const requestPermission = async () => {
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      setBannerDismissed(true);
    } catch {
      setBannerDismissed(true);
    }
  };

  // Ensure SW registered so showNotification path works.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (permission !== "granted") return;
    navigator.serviceWorker.getRegistration().then((r) => {
      if (!r) navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }, [permission]);

  if (!showBanner) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-sm">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/20 text-primary">
        <Bell className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">Turn on message alerts</div>
        <div className="text-xs text-muted-foreground">Get pinged when someone replies 🔔</div>
      </div>
      <button
        onClick={requestPermission}
        className="rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
      >
        Enable
      </button>
      <button
        onClick={() => setBannerDismissed(true)}
        aria-label="Dismiss"
        className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Silence unused-import warnings caused by navigate ref for future use.
export const _n = () => useNavigate;
