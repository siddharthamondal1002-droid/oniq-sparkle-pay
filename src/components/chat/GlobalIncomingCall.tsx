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
  avatarUrl?: string | null;
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
  /**
   * Calls this window has already answered or declined.
   *
   * THIS IS WHAT BROKE ANSWERING IN-APP. Tapping Answer clears `incoming` and
   * then takes ~700ms to mount a CallOverlay (navigate, a profile lookup, a
   * re-dispatch tick). The caller re-rings every 2s, and a re-ring landing in
   * that gap found: no CallOverlay mounted yet, `incoming` already null — so it
   * sailed past every guard and re-opened the incoming screen ON TOP of the
   * call that was connecting. The ringtone restarted, the z-[100] screen hid
   * the live call, and the natural reaction — tap Decline on the call that
   * "won't connect" — broadcast a decline that killed it for real.
   *
   * It only worked from the notification because the app had been backgrounded
   * with its realtime socket suspended: no re-rings arrived during the mount
   * window, so nothing clobbered the overlay.
   *
   * callIds are per-call UUIDs, so an id in here can never legitimately ring
   * again and this never needs clearing.
   */
  const handledCallIdRef = useRef<string | null>(null);
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

  // An accept can originate somewhere other than this screen's button — the
  // notification tap routes through MainActivity → oniq:push-navigate →
  // AppShell, which dispatches oniq:accept-call directly. When that happens
  // this component must stand down too, or it keeps its own incoming screen up
  // over the call and the next re-ring keeps it alive.
  useEffect(() => {
    const onAccepted = (e: Event) => {
      const id = (e as CustomEvent<{ callId?: string }>).detail?.callId;
      if (!id) return;
      handledCallIdRef.current = id;
      setIncoming((cur) => (cur && cur.callId === id ? null : cur));
    };
    window.addEventListener("oniq:accept-call", onAccepted);
    return () => window.removeEventListener("oniq:accept-call", onAccepted);
  }, []);

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
      // Already answered or declined in this window — every later re-ring for
      // it is noise, and acting on one re-opens the incoming screen over a
      // call that is already connecting. This check must come FIRST.
      if (handledCallIdRef.current === p.callId) return;
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
      // The caller's photo, fetched after the screen is already up — the ring
      // must never wait on a profile read. Re-rings keep arriving while this
      // resolves, so guard against the call having ended meanwhile.
      void supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", p.fromId)
        .maybeSingle()
        .then(({ data }) => {
          const url = (data as { avatar_url?: string | null } | null)?.avatar_url;
          if (!url) return;
          setIncoming((cur) => (cur && cur.callId === p.callId ? { ...cur, avatarUrl: url } : cur));
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
    handledCallIdRef.current = cur.callId;
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
    // FIRST, not after navigation. GlobalCallHost lives above the routed
    // <Outlet />, so mounting the overlay never needed the route to change —
    // and waiting on navigate() put ~300ms of dead air between "user tapped
    // Answer" and "anything started happening", every millisecond of which was
    // a window for a re-ring to land. Navigation still runs, because the user
    // should end up in the conversation; it just no longer gates the call.
    dispatchAccept();
    navigate({
      to: "/app/chat/$conversationId" as any,
      params: { conversationId: cur.conversationId } as any,
    })
      .then(() => {
        // Belt and braces: if the overlay mounted late, its own listener is
        // registered by now. adoptAndAccept is idempotent once active.
        setTimeout(dispatchAccept, 400);
      })
      .catch(() => {
        // Do NOT hard-navigate. window.location.href reloads the whole app and
        // destroys the call that is mid-handshake — the accept event above has
        // already started it, and the overlay is route-independent.
      });
    setTimeout(() => {
      activeCallIdRef.current = null;
    }, 8000);
  };

  const decline = () => {
    const cur = incomingRef.current;
    if (!cur) return;
    // Same trap as accept: without this, the caller's next re-ring re-opens
    // the screen the user just dismissed.
    handledCallIdRef.current = cur.callId;
    // Reuse an existing `call:{conversationId}` channel if one exists in this
    // client (paranoid guard — duplicate topics from one client can poison
    // the original subscription). One exists only while a CallOverlay session
    // is mounted, and rings are dropped in that state, so normally NOT here.
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
    avatarUrl: incoming.avatarUrl,
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
