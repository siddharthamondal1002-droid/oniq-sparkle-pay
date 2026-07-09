import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import {
  ensureNotificationPermission,
  playRingback,
  playRingtone,
  stopAllCallSounds,
} from "@/lib/callSounds";

export type CallType = "audio" | "video";
export type CallHandle = { startCall: (type: CallType) => void };

type Props = {
  conversationId: string;
  meId: string | undefined;
  meName: string;
  peerName: string;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];
const MAX_ICE_RESTARTS = 2;
const RECONNECT_GRACE_MS = 10000;

type Status = "idle" | "outgoing" | "incoming" | "connecting" | "connected" | "reconnecting" | "ended";


const genId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

export const CallOverlay = forwardRef<CallHandle, Props>(function CallOverlay(
  { conversationId, meId, meName, peerName },
  ref,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [incomingFromName, setIncomingFromName] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const ringTimeoutRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const isCallerRef = useRef(false);
  const callTypeRef = useRef<CallType>("audio");
  const activeRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const peerIdsRef = useRef<string[]>([]);
  const userRingChannelsRef = useRef<RealtimeChannel[]>([]);
  const userRingIntervalRef = useRef<number | null>(null);
  const missedInsertedRef = useRef<Set<string>>(new Set());
  const autoAcceptTriedRef = useRef(false);
  const iceRestartsRef = useRef(0);
  const graceTimerRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);


  const setCallTypeBoth = (t: CallType) => {
    callTypeRef.current = t;
    setCallType(t);
  };

  const sendSig = (event: string, payload: Record<string, unknown> = {}) => {
    channelRef.current?.send({
      type: "broadcast",
      event,
      payload: { ...payload, fromId: meId, callId: callIdRef.current },
    });
  };

  const clearConnectTimeout = () => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  };

  const armConnectTimeout = () => {
    clearConnectTimeout();
    connectTimeoutRef.current = window.setTimeout(() => {
      if (pcRef.current && pcRef.current.connectionState !== "connected") {
        toast.error("Couldn't connect — network too strict, try again on WiFi 📶");
        finishCall(true);
      }
    }, 25000);
  };

  const stopUserRingBroadcast = () => {
    if (userRingIntervalRef.current) {
      clearInterval(userRingIntervalRef.current);
      userRingIntervalRef.current = null;
    }
    for (const c of userRingChannelsRef.current) {
      try { supabase.removeChannel(c); } catch {}
    }
    userRingChannelsRef.current = [];
  };

  const insertMissedCallMessage = async (kind: "missed" | "declined") => {
    const id = callIdRef.current;
    if (!id || !meId) return;
    if (missedInsertedRef.current.has(id)) return;
    missedInsertedRef.current.add(id);
    const t = callTypeRef.current;
    const content =
      kind === "declined"
        ? "Call declined"
        : t === "video"
          ? "📹 Missed video call"
          : "📞 Missed voice call";
    try {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: meId,
        content,
        type: "call",
      });
    } catch {}
  };

  const cleanupMedia = () => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    clearConnectTimeout();
    stopUserRingBroadcast();
    stopAllCallSounds();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    localStreamRef.current = null;
    // Remote tracks are owned by the peer connection; just drop the ref.
    remoteStreamRef.current = null;
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    pendingIceRef.current = [];
    isCallerRef.current = false;
    activeRef.current = false;
    callIdRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setMuted(false);
    setCamOff(false);
    setElapsed(0);
  };

  const finishCall = (notifyPeer: boolean) => {
    if (notifyPeer && activeRef.current) sendSig("end");
    cleanupMedia();
    setStatus("ended");
    window.setTimeout(() => setStatus((s) => (s === "ended" ? "idle" : s)), 700);
  };

  const createPc = () => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSig("ice", { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      // Remote-only stream. Never mixed with local.
      const incoming = e.streams[0];
      const stream = incoming ?? (() => {
        const s = remoteStreamRef.current ?? new MediaStream();
        if (!s.getTracks().find((x) => x.id === e.track.id)) s.addTrack(e.track);
        return s;
      })();
      remoteStreamRef.current = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        clearConnectTimeout();
        setStatus("connected");
        if (!timerRef.current) {
          const started = Date.now();
          timerRef.current = window.setInterval(
            () => setElapsed(Math.floor((Date.now() - started) / 1000)),
            500,
          );
        }
      } else if (st === "failed" || st === "closed") {
        if (activeRef.current) finishCall(false);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" && activeRef.current) {
        toast.error("Couldn't connect — network too strict, try again on WiFi 📶");
        finishCall(true);
      }
    };
    return pc;
  };

  const getMedia = async (type: CallType) => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === "video" ? { width: 1280, height: 720 } : false,
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast.error("Mic/camera blocked — enable in your browser settings");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        toast.error("No mic/camera found on this device");
      } else {
        toast.error("Couldn't start call — check mic/camera");
      }
      throw err;
    }
  };

  const attachLocal = (stream: MediaStream, type: CallType) => {
    localStreamRef.current = stream;
    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    stream.getTracks().forEach((t) => pcRef.current?.addTrack(t, stream));
  };

  // Fetch other conversation members once per conversation so we can ring
  // them on their per-user channel from anywhere in the app.
  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .neq("user_id", meId)
      .then(({ data }) => {
        if (cancelled) return;
        peerIdsRef.current = (data ?? []).map((r: any) => r.user_id).filter(Boolean);
      });
    return () => { cancelled = true; };
  }, [conversationId, meId]);

  const sendUserRing = () => {
    const id = callIdRef.current;
    if (!id) return;
    const payload = {
      conversationId,
      callId: id,
      callType: callTypeRef.current,
      fromName: meName,
      fromId: meId,
    };
    for (const ch of userRingChannelsRef.current) {
      try {
        ch.send({ type: "broadcast", event: "ring", payload });
      } catch {}
    }
  };

  const startCall = (type: CallType) => {
    if (!meId || activeRef.current) return;
    activeRef.current = true;
    isCallerRef.current = true;
    callIdRef.current = genId();
    setCallTypeBoth(type);
    setStatus("outgoing");
    ensureNotificationPermission();
    playRingback();
    sendSig("ring", { callType: type, fromName: meName });

    // Broadcast on every peer's user-scoped channel so the incoming UI shows
    // no matter what screen they're on. Re-broadcast every 2s while outgoing
    // via the outgoing-status effect below.
    stopUserRingBroadcast();
    for (const peerId of peerIdsRef.current) {
      const uch = supabase.channel(`user-calls:${peerId}`, {
        config: { broadcast: { self: false } },
      });
      uch.subscribe((s) => {
        if (s === "SUBSCRIBED") {
          uch.send({
            type: "broadcast",
            event: "ring",
            payload: {
              conversationId,
              callId: callIdRef.current,
              callType: callTypeRef.current,
              fromName: meName,
              fromId: meId,
            },
          });
        }
      });
      userRingChannelsRef.current.push(uch);
    }

    ringTimeoutRef.current = window.setTimeout(() => {
      if (isCallerRef.current && !pcRef.current) {
        toast("They're not around — try a message 💬");
        insertMissedCallMessage("missed");
        finishCall(true);
      }
    }, 30000);
  };

  useImperativeHandle(ref, () => ({ startCall }));

  // Re-broadcast ring every 2s while outgoing. Fixes the Supabase channel
  // subscribe race: the initial ring inside startCall() can be sent before
  // ch.subscribe() has reached SUBSCRIBED (or before the callee's channel has
  // joined), in which case broadcast silently drops the message. Callee-side
  // dedupe via activeRef.current in the "ring" handler makes retries a no-op
  // once the first ring lands, so this is safe.
  useEffect(() => {
    if (status !== "outgoing") return;
    const id = window.setInterval(() => {
      if (isCallerRef.current && activeRef.current && callIdRef.current) {
        sendSig("ring", { callType: callTypeRef.current, fromName: meName });
        sendUserRing();
      }
    }, 2000);
    return () => window.clearInterval(id);
    // sendSig closes over refs (meId, callIdRef, channelRef); safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, meName]);

  // Signaling channel — lives for the entire time the thread is open.
  useEffect(() => {
    if (!meId) return;
    const ch = supabase.channel(`call:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    const matches = (p: { fromId?: string; callId?: string | null }, requireActive: boolean) => {
      if (p.fromId === meId) return false;
      if (requireActive) {
        if (!activeRef.current) return false;
        if (!callIdRef.current || p.callId !== callIdRef.current) return false;
      }
      return true;
    };

    ch.on("broadcast", { event: "ring" }, ({ payload }) => {
      const p = payload as { fromId: string; callType: CallType; fromName?: string; callId: string };
      if (p.fromId === meId) return;
      if (activeRef.current) return;
      activeRef.current = true;
      isCallerRef.current = false;
      callIdRef.current = p.callId ?? genId();
      setCallTypeBoth(p.callType);
      setIncomingFromName(p.fromName || peerName);
      setStatus("incoming");
    });

    ch.on("broadcast", { event: "accept" }, async ({ payload }) => {
      const p = payload as { fromId: string; callId: string };
      if (!matches(p, true)) return;
      if (!isCallerRef.current) return;
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      setStatus("connecting");
      armConnectTimeout();
      try {
        const stream = await getMedia(callTypeRef.current);
        pcRef.current = createPc();
        attachLocal(stream, callTypeRef.current);
        const offer = await pcRef.current.createOffer();
        await pcRef.current.setLocalDescription(offer);
        sendSig("offer", { sdp: offer });
      } catch {
        finishCall(true);
      }
    });

    ch.on("broadcast", { event: "decline" }, ({ payload }) => {
      const p = payload as { fromId: string; callId: string };
      if (!matches(p, true)) return;
      if (!isCallerRef.current) return;
      toast("Call declined");
      insertMissedCallMessage("declined");
      finishCall(false);
    });

    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      const p = payload as { fromId: string; sdp: RTCSessionDescriptionInit; callId: string };
      if (!matches(p, true)) return;
      if (isCallerRef.current || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(p.sdp));
      for (const c of pendingIceRef.current) {
        try { await pcRef.current.addIceCandidate(c); } catch {}
      }
      pendingIceRef.current = [];
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      sendSig("answer", { sdp: answer });
    });

    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      const p = payload as { fromId: string; sdp: RTCSessionDescriptionInit; callId: string };
      if (!matches(p, true)) return;
      if (!isCallerRef.current || !pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(p.sdp));
      for (const c of pendingIceRef.current) {
        try { await pcRef.current.addIceCandidate(c); } catch {}
      }
      pendingIceRef.current = [];
    });

    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const p = payload as { fromId: string; candidate: RTCIceCandidateInit; callId: string };
      if (!matches(p, true)) return;
      if (!p.candidate) return;
      if (pcRef.current?.remoteDescription) {
        try { await pcRef.current.addIceCandidate(p.candidate); } catch {}
      } else {
        pendingIceRef.current.push(p.candidate);
      }
    });

    ch.on("broadcast", { event: "end" }, ({ payload }) => {
      const p = payload as { fromId: string; callId: string };
      if (!matches(p, true)) return;
      finishCall(false);
    });

    const adoptAndAccept = (acceptId: string, acceptType: CallType | null) => {
      if (autoAcceptTriedRef.current) return;
      autoAcceptTriedRef.current = true;
      if (activeRef.current) return;
      activeRef.current = true;
      isCallerRef.current = false;
      callIdRef.current = acceptId;
      setCallTypeBoth(acceptType === "video" ? "video" : "audio");
      setIncomingFromName(peerName);
      setStatus("incoming");
      window.setTimeout(() => {
        setStatus("connecting");
        armConnectTimeout();
        getMedia(callTypeRef.current)
          .then((stream) => {
            pcRef.current = createPc();
            attachLocal(stream, callTypeRef.current);
            sendSig("accept");
          })
          .catch(() => {
            sendSig("decline");
            finishCall(false);
          });
      }, 60);
    };

    ch.subscribe((sStatus) => {
      if (sStatus !== "SUBSCRIBED") return;
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const acceptId = params.get("acceptCall");
      const acceptType = params.get("acceptType") as CallType | null;
      if (!acceptId) return;
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("acceptCall");
        url.searchParams.delete("acceptType");
        window.history.replaceState({}, "", url.toString());
      } catch {}
      adoptAndAccept(acceptId, acceptType);
    });

    // Fallback: when the global overlay accepts from another screen, the
    // navigation to this thread may be same-route (no remount) and the URL
    // param path above won't re-fire. Listen for a window event that carries
    // the callId and run the same adopt+accept flow.
    const onAcceptEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { callId?: string; callType?: CallType; conversationId?: string }
        | undefined;
      if (!detail?.callId) return;
      if (detail.conversationId && detail.conversationId !== conversationId) return;
      // Reset the guard so post-navigation events after a previous accept still work.
      autoAcceptTriedRef.current = false;
      adoptAndAccept(detail.callId, detail.callType ?? null);
    };
    window.addEventListener("oniq:accept-call", onAcceptEvent);

    return () => {
      window.removeEventListener("oniq:accept-call", onAcceptEvent);
      cleanupMedia();
      supabase.removeChannel(ch);
      channelRef.current = null;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId]);

  const accept = async () => {
    if (status !== "incoming") return;
    setStatus("connecting");
    armConnectTimeout();
    try {
      const stream = await getMedia(callTypeRef.current);
      pcRef.current = createPc();
      attachLocal(stream, callTypeRef.current);
      sendSig("accept");
    } catch {
      sendSig("decline");
      finishCall(false);
    }
  };

  const decline = () => {
    sendSig("decline");
    finishCall(false);
  };

  const toggleMute = () => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !(s.getAudioTracks()[0]?.enabled ?? true);
    s.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  };

  const toggleCam = () => {
    const s = localStreamRef.current;
    if (!s) return;
    const next = !(s.getVideoTracks()[0]?.enabled ?? true);
    s.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCamOff(next);
  };

  if (status === "idle") return null;

  const statusText =
    status === "outgoing"
      ? "Ringing…"
      : status === "incoming"
        ? `Incoming ${callType} call`
        : status === "connecting"
          ? "Connecting…"
          : status === "connected"
            ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
            : "Call ended";

  const displayName = status === "incoming" ? incomingFromName : peerName;
  const monogram = (displayName || "?").charAt(0).toUpperCase();
  const showRemoteVideo = callType === "video" && status === "connected";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* Always-on hidden remote audio sink — required for voice-only calls. */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {callType === "video" && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full bg-black object-cover"
        />
      )}

      {!showRemoteVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="relative">
            <span className="absolute inset-0 -m-4 animate-ping rounded-full bg-primary/30" />
            <div className="grid h-32 w-32 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-5xl font-bold text-primary-foreground">
              {monogram}
            </div>
          </div>
          <div className="text-2xl font-semibold">{displayName}</div>
          <div className="text-sm text-white/70">{statusText}</div>
        </div>
      )}

      {showRemoteVideo && (
        <div className="absolute left-1/2 top-8 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs">
          {displayName} · {statusText}
        </div>
      )}

      {callType === "video" && (status === "connecting" || status === "connected") && (
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="absolute right-4 top-16 z-10 h-40 w-28 -scale-x-100 rounded-2xl border border-white/20 bg-black object-cover"
        />
      )}

      <div className="absolute bottom-10 left-0 right-0 flex items-center justify-center gap-6">
        {status === "incoming" ? (
          <>
            <button
              onClick={decline}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 hover:bg-red-500"
              aria-label="Decline call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
            <button
              data-testid="call-accept"
              onClick={accept}
              className="grid h-16 w-16 place-items-center rounded-full bg-green-600 hover:bg-green-500"
              aria-label="Accept call"
            >
              <Phone className="h-6 w-6" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={toggleMute}
              disabled={!localStreamRef.current}
              className="grid h-14 w-14 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"
              aria-label={muted ? "Unmute mic" : "Mute mic"}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            {callType === "video" && (
              <button
                onClick={toggleCam}
                disabled={!localStreamRef.current}
                className="grid h-14 w-14 place-items-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"
                aria-label={camOff ? "Turn camera on" : "Turn camera off"}
              >
                {camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </button>
            )}
            <button
              data-testid="call-end"
              onClick={() => finishCall(true)}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 hover:bg-red-500"
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
});
