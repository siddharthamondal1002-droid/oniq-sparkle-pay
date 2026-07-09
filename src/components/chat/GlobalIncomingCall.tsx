import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Phone, PhoneOff, Video } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ensureNotificationPermission,
  playRingtone,
  showIncomingNotification,
  stopAllCallSounds,
} from "@/lib/callSounds";

type CallType = "audio" | "video";

type Incoming = {
  conversationId: string;
  callId: string;
  callType: CallType;
  fromName: string;
  fromId: string;
  lastRing: number;
};

/**
 * Global incoming-call UI. Subscribes to `user-calls:{myUserId}` and shows a
 * full-screen accept/decline overlay from anywhere in the app. Accept
 * navigates to the conversation with ?acceptCall=… — the thread's CallOverlay
 * adopts the callId and completes the accept handshake there.
 */
export function GlobalIncomingCall() {
  const navigate = useNavigate();
  const [me, setMe] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const incomingRef = useRef<Incoming | null>(null);
  const activeCallIdRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setMe(s?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keep ref in sync so the interval + broadcasts see latest.
  useEffect(() => {
    incomingRef.current = incoming;
    if (incoming) {
      playRingtone();
      if (typeof document !== "undefined" && document.hidden) {
        showIncomingNotification(incoming.callId, incoming.fromName);
      }
    } else {
      stopAllCallSounds();
    }
  }, [incoming]);

  // Auto-dismiss when caller stops re-broadcasting (>6s of silence).
  useEffect(() => {
    if (!incoming) {
      if (dismissTimerRef.current) {
        clearInterval(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
      return;
    }
    dismissTimerRef.current = setInterval(() => {
      const cur = incomingRef.current;
      if (!cur) return;
      if (Date.now() - cur.lastRing > 6000) {
        setIncoming(null);
      }
    }, 1000);
    return () => {
      if (dismissTimerRef.current) {
        clearInterval(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [incoming]);

  // Subscribe to user-scoped ring channel.
  useEffect(() => {
    if (!me) return;
    const ch: RealtimeChannel = supabase.channel(`user-calls:${me}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "ring" }, ({ payload }) => {
      const p = payload as {
        conversationId: string;
        callId: string;
        callType: CallType;
        fromName: string;
        fromId: string;
      };
      if (!p?.callId || p.fromId === me) return;
      // Ignore if already in an active call in this window.
      if (activeCallIdRef.current && activeCallIdRef.current !== p.callId) return;
      const cur = incomingRef.current;
      if (cur && cur.callId === p.callId) {
        // Refresh lastRing, don't re-toast.
        setIncoming({ ...cur, lastRing: Date.now() });
        return;
      }
      if (cur) return; // don't overwrite a different active ring
      ensureNotificationPermission();
      setIncoming({
        conversationId: p.conversationId,
        callId: p.callId,
        callType: p.callType,
        fromName: p.fromName || "Someone",
        fromId: p.fromId,
        lastRing: Date.now(),
      });
    });
    // If the caller cancels via the convo end broadcast we can't hear it here,
    // but the 6s silence guard covers that.
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me]);

  const accept = () => {
    const cur = incomingRef.current;
    if (!cur) return;
    activeCallIdRef.current = cur.callId;
    setIncoming(null);
    navigate({
      to: "/app/chat/$conversationId" as any,
      params: { conversationId: cur.conversationId },
      search: {
        acceptCall: cur.callId,
        acceptType: cur.callType,
      } as any,
    }).catch(() => {
      // Fallback to full navigation if the router rejects unknown search.
      window.location.href = `/app/chat/${cur.conversationId}?acceptCall=${cur.callId}&acceptType=${cur.callType}`;
    });
    // Clear active guard after a few seconds — thread overlay owns state now.
    setTimeout(() => {
      activeCallIdRef.current = null;
    }, 8000);
  };

  const decline = () => {
    const cur = incomingRef.current;
    if (!cur) return;
    // Fire a decline on the convo channel so caller UI can update immediately.
    const ch = supabase.channel(`call:${cur.conversationId}`, {
      config: { broadcast: { self: false } },
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({
          type: "broadcast",
          event: "decline",
          payload: { fromId: me, callId: cur.callId },
        }).finally(() => {
          setTimeout(() => supabase.removeChannel(ch), 500);
        });
      }
    });
    setIncoming(null);
  };

  if (!incoming) return null;

  const Icon = incoming.callType === "video" ? Video : Phone;
  const monogram = (incoming.fromName || "?").charAt(0).toUpperCase();

  return (
    <div
      data-testid="global-incoming-call"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-black/80 px-6 text-center text-white backdrop-blur-xl"
    >
      <div className="relative">
        <span className="absolute inset-0 -m-4 animate-ping rounded-full bg-primary/30" />
        <div className="grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-4xl font-bold">
          {monogram}
        </div>
      </div>
      <div>
        <div className="text-2xl font-semibold">{incoming.fromName}</div>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/70">
          <Icon className="h-4 w-4" />
          Incoming {incoming.callType} call…
        </div>
      </div>
      <div className="mt-4 flex items-center gap-10">
        <button
          data-testid="global-incoming-decline"
          onClick={decline}
          className="grid h-16 w-16 place-items-center rounded-full bg-red-600 hover:bg-red-500"
          aria-label="Decline call"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
        <button
          data-testid="global-incoming-accept"
          onClick={accept}
          className="grid h-16 w-16 place-items-center rounded-full bg-green-600 hover:bg-green-500"
          aria-label="Accept call"
        >
          <Phone className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
