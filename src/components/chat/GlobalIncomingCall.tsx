import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ensureNotificationPermission,
  playRingtone,
  showIncomingNotification,
  stopAllCallSounds,
} from "@/lib/callSounds";
import {
  IncomingCallScreen,
  scheduleReminder,
  sendQuickReply,
  type IncomingCallInfo,
} from "./IncomingCallScreen";
import { activeCallSession } from "./GlobalCallHost";
import { bumpMissedCallCount } from "@/components/onboarding/FullScreenIntentPrompt";

type CallType = "audio" | "video";

type Incoming = {
  conversationId: string;
  callId: string;
  callType: CallType;
  fromName: string;
  fromId: string;
  lastRing: number;
  firstRing: number;
};

/**
 * Global incoming-call UI. Subscribes to `user-calls:{myUserId}` and shows a
 * full-screen accept/decline overlay from anywhere in the app — INCLUDING the
 * call's own conversation thread. This component is the ONLY incoming-call
 * surface: since the GlobalCallHost refactor the thread route mounts no
 * CallOverlay of its own, so the old "suppress when the thread is open" rule
 * had become "show incoming calls to nobody who has the chat open". That is
 * exactly how the 2026-08-10 calls failed: two people messaging each other
 * both tapped call, every ring was delivered, and every ring was discarded
 * here. The one real overlap it guarded — a ring landing while a CallOverlay
 * session is already mounted — is handled by `activeCallSession` instead.
 *
 * Accept navigates to the conversation with ?acceptCall=… — GlobalCallHost
 * mounts a CallOverlay that adopts the callId and completes the handshake.
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
      const now = Date.now();
      const idleTooLong = now - cur.lastRing > 6000;
      const hardTimeout = now - cur.firstRing > 45_000;
      if (idleTooLong || hardTimeout) {
        // Missed: caller stopped ringing or 45s cap reached.
        try {
          bumpMissedCallCount();
        } catch {}
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
      // Already dialing or in a call in this window — a CallOverlay session is
      // mounted, and painting an incoming screen over it would be the very
      // overlap the retired thread-open check existed for. (Re-rings for the
      // call just accepted land here too, harmlessly.)
      if (activeCallSession.current) return;
      // Ignore if already in an active call in this window.
      if (activeCallIdRef.current && activeCallIdRef.current !== p.callId) return;
      const cur = incomingRef.current;
      if (cur && cur.callId === p.callId) {
        setIncoming({ ...cur, lastRing: Date.now() });
        return;
      }
      if (cur) return;
      ensureNotificationPermission();
      setIncoming({
        conversationId: p.conversationId,
        callId: p.callId,
        callType: p.callType,
        fromName: p.fromName || "Someone",
        fromId: p.fromId,
        lastRing: Date.now(),
        firstRing: Date.now(),
      });
    });
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
    const dispatchAccept = () => {
      try {
        window.dispatchEvent(
          new CustomEvent("oniq:accept-call", {
            detail: {
              callId: cur.callId,
              callType: cur.callType,
              conversationId: cur.conversationId,
            },
          }),
        );
      } catch {}
    };
    navigate({
      to: "/app/chat/$conversationId" as any,
      params: { conversationId: cur.conversationId } as any,
      search: {
        acceptCall: cur.callId,
        acceptType: cur.callType,
      } as any,
    })
      .then(() => {
        // Same-route navigation won't remount CallOverlay → the URL-param
        // adoption inside its subscribe callback won't re-fire. Dispatch the
        // fallback event after navigation settles.
        setTimeout(dispatchAccept, 300);
      })
      .catch(() => {
        window.location.href = `/app/chat/${cur.conversationId}?acceptCall=${cur.callId}&acceptType=${cur.callType}`;
      });
    setTimeout(() => {
      activeCallIdRef.current = null;
    }, 8000);
  };

  const decline = () => {
    const cur = incomingRef.current;
    if (!cur) return;
    // Reuse an existing `call:{conversationId}` channel if one exists in this
    // client (paranoid guard — duplicate topics from one client can poison
    // the original subscription). Since this component is suppressed when the
    // thread is open, the thread's channel is normally NOT present here.
    const topic = `call:${cur.conversationId}`;
    const existing = supabase
      .getChannels()
      .find((c: any) => c.topic === `realtime:${topic}` || c.topic === topic);
    const ch = existing ?? supabase.channel(topic, { config: { broadcast: { self: false } } });
    const send = () =>
      ch.send({
        type: "broadcast",
        event: "decline",
        payload: { fromId: me, callId: cur.callId },
      });
    if (existing) {
      send();
    } else {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          send().finally(() => {
            setTimeout(() => supabase.removeChannel(ch), 500);
          });
        }
      });
    }
    setIncoming(null);
  };

  if (!incoming) return null;

  const info: IncomingCallInfo = {
    conversationId: incoming.conversationId,
    callId: incoming.callId,
    callType: incoming.callType,
    fromName: incoming.fromName,
    fromId: incoming.fromId,
  };

  return (
    <IncomingCallScreen
      info={info}
      onAccept={accept}
      onDecline={decline}
      onMessageInstead={async (text) => {
        try {
          await sendQuickReply(incoming.conversationId, text);
        } catch {}
        decline();
      }}
      onRemindMe={async (mins) => {
        try {
          await scheduleReminder(incoming.conversationId, incoming.fromName, mins);
        } catch {}
        decline();
      }}
    />
  );
}
