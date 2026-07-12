// Mesh WebRTC group calls (≤4 participants). 1:1 is the N=1 case of the same code path.
//
// Signaling: all payloads on channel `call:{conversationId}` carry
// `{ from: meId, to: peerId | null, callId }`. Room events (to=null): ring, end, hello.
// Targeted events (to=peerId): offer, answer, ice, bye, decline.
//
// Offerer selection is deterministic per pair (myId < peerId ⇒ I offer). This
// avoids glare without full perfect-negotiation rollback while keeping a small,
// auditable state machine per peer.
//
// PeerPool = Map<peerId, PeerEntry>. Each entry owns its own PC, remote stream,
// and pending-ICE buffer. All singleton machinery (ringback, media, controls,
// signaling channel) is shared; per-peer state is scoped inside the pool.
//
// Trimmed vs the pre-mesh 1:1 overlay (parked as follow-ups so the mesh path
// lands clean): HUD stats aggregation, end-of-call report, WebAudio fallback
// pipeline, speaker boost, wake lock, missed-call message insertion. Core
// controls (mute, camera, end), ringback/ringtone, opus munge, TURN, bitrate
// caps, and connect-timeout are preserved.

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
  stopAllCallSounds,
} from "@/lib/callSounds";
import { sendPush } from "@/lib/push";

export type CallType = "audio" | "video";
export type CallHandle = { startCall: (type: CallType) => void };

type Props = {
  conversationId: string;
  meId: string | undefined;
  meName: string;
  peerName: string;
  isGroup?: boolean;
  groupTitle?: string;
};

// --- SDP: Opus in-band FEC + higher max bitrate ---
function mungeOpus(sdp: string): string {
  const rtpmap = sdp.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/im);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const fmtpRe = new RegExp(`^a=fmtp:${pt} (.*)$`, "im");
  const fmtp = sdp.match(fmtpRe);
  if (!fmtp) return sdp;
  let params = fmtp[1];
  if (!/(^|;)\s*useinbandfec=/i.test(params)) params += ";useinbandfec=1";
  if (!/(^|;)\s*maxaveragebitrate=/i.test(params)) params += ";maxaveragebitrate=96000";
  if (!/(^|;)\s*stereo=/i.test(params)) params += ";stereo=0";
  if (params === fmtp[1]) return sdp;
  return sdp.replace(fmtpRe, `a=fmtp:${pt} ${params}`);
}
function withMungedSdp(desc: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
  if (!desc.sdp) return desc;
  return { ...desc, sdp: mungeOpus(desc.sdp) };
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

let cachedIceServers: RTCIceServer[] | null = null;
let iceServersPromise: Promise<RTCIceServer[]> | null = null;
async function ensureIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) return cachedIceServers;
  if (iceServersPromise) return iceServersPromise;
  iceServersPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      const { data: fnData, error } = await supabase.functions.invoke("turn-creds", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      clearTimeout(timer);
      if (error || !fnData?.iceServers?.length) throw error ?? new Error("no ice");
      const merged = [...(fnData.iceServers as RTCIceServer[]), ...STUN_SERVERS];
      cachedIceServers = merged;
      return merged;
    } catch (e) {
      console.warn("TURN fallback", e);
      cachedIceServers = FALLBACK_ICE_SERVERS;
      return FALLBACK_ICE_SERVERS;
    }
  })();
  return iceServersPromise;
}

type Status = "idle" | "outgoing" | "incoming" | "connecting" | "connected" | "ended";

const genId = () => {
  try { return crypto.randomUUID(); } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

type PeerEntry = {
  peerId: string;
  peerName: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null;
  pendingIce: RTCIceCandidateInit[];
  hasRemoteDesc: boolean;
  connState: RTCPeerConnectionState;
  reachedConnected: boolean;
  recoveryTimer: number | null;
  restartAttempts: number;
};

// UI-visible peer tile info (subset of PeerEntry).
type PeerTile = {
  peerId: string;
  peerName: string;
  stream: MediaStream | null;
  connState: RTCPeerConnectionState;
};

export const CallOverlay = forwardRef<CallHandle, Props>(function CallOverlay(
  { conversationId, meId, meName, peerName, isGroup, groupTitle },
  ref,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [incomingFromName, setIncomingFromName] = useState("");
  const [tiles, setTiles] = useState<PeerTile[]>([]);

  // ---- refs (session-scoped state) ----
  const peerPoolRef = useRef<Map<string, PeerEntry>>(new Map());
  const peerNamesRef = useRef<Map<string, string>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const ringTimeoutRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const isCallerRef = useRef(false);
  const callTypeRef = useRef<CallType>("audio");
  const activeRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerIdsRef = useRef<string[]>([]);
  const userRingChannelsRef = useRef<RealtimeChannel[]>([]);
  const autoAcceptTriedRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  // ---- helpers ----

  const publishTiles = () => {
    const list: PeerTile[] = [];
    for (const e of peerPoolRef.current.values()) {
      list.push({
        peerId: e.peerId,
        peerName: e.peerName || peerNamesRef.current.get(e.peerId) || "…",
        stream: e.remoteStream,
        connState: e.connState,
      });
    }
    setTiles(list);
  };

  const setCallTypeBoth = (t: CallType) => {
    callTypeRef.current = t;
    setCallType(t);
  };

  const sendSig = (
    event: string,
    to: string | null,
    payload: Record<string, unknown> = {},
  ) => {
    channelRef.current?.send({
      type: "broadcast",
      event,
      payload: { ...payload, from: meId, to, callId: callIdRef.current },
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
      // If no peer ever reached connected, tear down.
      const anyConnected = [...peerPoolRef.current.values()].some((p) => p.connState === "connected");
      if (!anyConnected) {
        toast.error("Couldn't connect — network too strict, try again on WiFi 📶");
        endEveryone(true);
      }
    }, 25000);
  };

  const stopUserRingBroadcast = () => {
    for (const c of userRingChannelsRef.current) {
      try { supabase.removeChannel(c); } catch {}
    }
    userRingChannelsRef.current = [];
  };

  const applyBitrateCaps = async (pc: RTCPeerConnection) => {
    for (const sender of pc.getSenders()) {
      const kind = sender.track?.kind;
      if (!kind) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        if (kind === "video") params.encodings[0].maxBitrate = 400_000;
        else if (kind === "audio") params.encodings[0].maxBitrate = 64_000;
        await sender.setParameters(params);
      } catch { /* some browsers reject mid-negotiation */ }
    }
  };

  // ---- media ----

  const getMedia = async (type: CallType) => {
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
      };
      const video: MediaTrackConstraints | false =
        type === "video"
          ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 24 }, facingMode: "user" }
          : false;
      return await navigator.mediaDevices.getUserMedia({ audio, video });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "Error";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") toast.error("Mic/camera blocked — enable in your app settings");
      else if (name === "NotFoundError" || name === "OverconstrainedError") toast.error("No mic/camera found");
      else if (name === "NotReadableError") toast.error("Mic in use by another app");
      else toast.error(`Couldn't start call: ${name}`);
      throw err;
    }
  };

  const attachLocal = (stream: MediaStream, type: CallType) => {
    localStreamRef.current = stream;
    if (type === "video" && localVideoRef.current) localVideoRef.current.srcObject = stream;
  };

  // ---- PeerPool ----

  const isOffererFor = (peerId: string) => {
    // Deterministic offerer per pair; myId < peerId ⇒ I offer.
    return (meId ?? "") < peerId;
  };

  const createPeerEntry = (peerId: string, hintedName?: string): PeerEntry => {
    const existing = peerPoolRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({
      iceServers: cachedIceServers ?? FALLBACK_ICE_SERVERS,
      iceCandidatePoolSize: 4,
    });
    if (hintedName) peerNamesRef.current.set(peerId, hintedName);
    const entry: PeerEntry = {
      peerId,
      peerName: hintedName || peerNamesRef.current.get(peerId) || "",
      pc,
      remoteStream: null,
      pendingIce: [],
      hasRemoteDesc: false,
      connState: "new",
    };
    peerPoolRef.current.set(peerId, entry);

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSig("ice", peerId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const incoming = e.streams[0];
      const stream = incoming ?? (() => {
        const s = entry.remoteStream ?? new MediaStream();
        if (!s.getTracks().find((x) => x.id === e.track.id)) s.addTrack(e.track);
        return s;
      })();
      entry.remoteStream = stream;
      stopAllCallSounds();
      publishTiles();
    };
    pc.onconnectionstatechange = () => {
      entry.connState = pc.connectionState;
      publishTiles();
      const st = pc.connectionState;
      if (st === "connected") {
        clearConnectTimeout();
        stopAllCallSounds();
        setStatus("connected");
        if (!timerRef.current) {
          startedAtRef.current = Date.now();
          timerRef.current = window.setInterval(
            () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
            500,
          );
        }
      } else if (st === "failed" || st === "closed") {
        // Remove just this peer; others may still be up.
        teardownPeer(peerId, false);
      }
    };
    pc.onnegotiationneeded = async () => {
      if (!isOffererFor(peerId)) return;
      if (pc.signalingState !== "stable") return;
      try {
        const offer = withMungedSdp(await pc.createOffer());
        await pc.setLocalDescription(offer);
        sendSig("offer", peerId, { sdp: offer });
      } catch (err) {
        console.warn("[mesh] createOffer failed for", peerId, err);
      }
    };
    // Add local tracks so negotiation kicks off (offerer side) or exists for answer (callee).
    const local = localStreamRef.current;
    if (local) {
      for (const t of local.getTracks()) {
        try { pc.addTrack(t, local); } catch {}
      }
    }
    void applyBitrateCaps(pc);
    // eslint-disable-next-line no-console
    console.log(`[mesh] PeerPool size: ${peerPoolRef.current.size} (added ${peerId})`);
    publishTiles();
    return entry;
  };

  const flushPendingIce = async (entry: PeerEntry) => {
    for (const c of entry.pendingIce) {
      try { await entry.pc.addIceCandidate(c); } catch {}
    }
    entry.pendingIce = [];
  };

  const teardownPeer = (peerId: string, sendBye: boolean) => {
    const entry = peerPoolRef.current.get(peerId);
    if (!entry) return;
    if (sendBye) sendSig("bye", peerId);
    try { entry.pc.close(); } catch {}
    peerPoolRef.current.delete(peerId);
    // eslint-disable-next-line no-console
    console.log(`[mesh] PeerPool size: ${peerPoolRef.current.size} (removed ${peerId})`);
    publishTiles();
    // If we drained the pool while call was active, end.
    if (peerPoolRef.current.size === 0 && activeRef.current) {
      // In 1:1 or last-peer-left scenarios, end the whole call.
      endEveryone(false);
    }
  };

  const endEveryone = (notify: boolean) => {
    if (notify && activeRef.current) sendSig("end", null);
    for (const peerId of [...peerPoolRef.current.keys()]) {
      const entry = peerPoolRef.current.get(peerId);
      if (entry) { try { entry.pc.close(); } catch {} }
      peerPoolRef.current.delete(peerId);
    }
    clearConnectTimeout();
    stopAllCallSounds();
    stopUserRingBroadcast();
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    isCallerRef.current = false;
    activeRef.current = false;
    callIdRef.current = null;
    autoAcceptTriedRef.current = false;
    setMuted(false);
    setCamOff(false);
    setElapsed(0);
    setTiles([]);
    setStatus("ended");
    window.setTimeout(() => setStatus((s) => (s === "ended" ? "idle" : s)), 700);
  };

  // ---- fetch peer ids for ringing ----

  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    supabase
      .from("conversation_members")
      .select("user_id, profiles(display_name, username)")
      .eq("conversation_id", conversationId)
      .neq("user_id", meId)
      .then(({ data }) => {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []) as any[];
        peerIdsRef.current = rows.map((r) => r.user_id).filter(Boolean);
        for (const r of rows) {
          const nm = r.profiles?.display_name || r.profiles?.username;
          if (r.user_id && nm) peerNamesRef.current.set(r.user_id, nm);
        }
      });
    return () => { cancelled = true; };
  }, [conversationId, meId]);

  // ---- start / accept / decline ----

  const startCall = async (type: CallType) => {
    if (!meId || activeRef.current) return;
    if (peerIdsRef.current.length > 4) {
      toast.error("group calls fit 4 for now 🎥 — smaller squad");
      return;
    }
    activeRef.current = true;
    isCallerRef.current = true;
    callIdRef.current = genId();
    setCallTypeBoth(type);
    setStatus("outgoing");
    ensureNotificationPermission();
    playRingback();

    try {
      const stream = await getMedia(type);
      await ensureIceServers();
      attachLocal(stream, type);
    } catch {
      endEveryone(false);
      return;
    }

    // Room ring on the call channel.
    sendSig("ring", null, { callType: type, fromName: meName, isGroup: !!isGroup, groupTitle: groupTitle ?? "" });
    // Announce presence to any accepters.
    sendSig("hello", null, { fromName: meName });
    sendPush({ conversation_id: conversationId, kind: "call", call_type: type });

    // Per-user rings so recipients see the incoming UI from anywhere.
    stopUserRingBroadcast();
    for (const peerId of peerIdsRef.current) {
      const uch = supabase.channel(`user-calls:${peerId}`, { config: { broadcast: { self: false } } });
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
      if (isCallerRef.current && peerPoolRef.current.size === 0) {
        toast("They're not around — try a message 💬");
        endEveryone(true);
      }
    }, 30000);
    armConnectTimeout();
  };

  useImperativeHandle(ref, () => ({ startCall: (t) => { void startCall(t); } }));

  // Re-broadcast ring while outgoing (subscribe race guard).
  useEffect(() => {
    if (status !== "outgoing") return;
    const id = window.setInterval(() => {
      if (!isCallerRef.current || !activeRef.current || !callIdRef.current) return;
      sendSig("ring", null, { callType: callTypeRef.current, fromName: meName, isGroup: !!isGroup, groupTitle: groupTitle ?? "" });
      sendSig("hello", null, { fromName: meName });
    }, 2000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, meName]);

  // ---- signaling ----

  useEffect(() => {
    if (!meId) return;
    const ch = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false } } });
    channelRef.current = ch;

    // Payloads must be scoped: either to me, or room-scope (to === null).
    const forMe = (p: { from?: string; to?: string | null }) => {
      if (!p || p.from === meId) return false;
      if (p.to !== null && p.to !== undefined && p.to !== meId) return false;
      return true;
    };
    const matchesCall = (p: { callId?: string | null }) =>
      !!callIdRef.current && p.callId === callIdRef.current;

    // ROOM: ring — show incoming if idle.
    ch.on("broadcast", { event: "ring" }, ({ payload }) => {
      const p = payload as { from: string; to: null; callId: string; callType: CallType; fromName?: string; groupTitle?: string };
      if (!forMe(p)) return;
      if (activeRef.current) return;
      activeRef.current = true;
      isCallerRef.current = false;
      callIdRef.current = p.callId ?? genId();
      setCallTypeBoth(p.callType);
      setIncomingFromName(p.fromName || (isGroup ? (p.groupTitle || groupTitle || "Group") : peerName));
      setStatus("incoming");
    });

    // ROOM: hello — a peer joined the room.
    ch.on("broadcast", { event: "hello" }, async ({ payload }) => {
      const p = payload as { from: string; to: null; callId: string; fromName?: string };
      if (!forMe(p) || !matchesCall(p)) return;
      if (p.fromName) peerNamesRef.current.set(p.from, p.fromName);
      // Any inbound hello during outgoing means someone accepted → move on.
      if (status === "outgoing" || (isCallerRef.current && !peerPoolRef.current.has(p.from))) {
        setStatus("connecting");
        stopAllCallSounds();
      }
      // Create PC to this peer if we don't have one.
      if (peerPoolRef.current.has(p.from)) return;
      if (!localStreamRef.current) return; // media not ready yet; ignore, they'll hello again
      await ensureIceServers();
      createPeerEntry(p.from, p.fromName);
      // Non-offerer will wait for their offer.
    });

    // TARGETED: offer.
    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit };
      if (!forMe(p) || !matchesCall(p)) return;
      await ensureIceServers();
      let entry = peerPoolRef.current.get(p.from);
      if (!entry) entry = createPeerEntry(p.from);
      try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        entry.hasRemoteDesc = true;
        await flushPendingIce(entry);
        const answer = withMungedSdp(await entry.pc.createAnswer());
        await entry.pc.setLocalDescription(answer);
        sendSig("answer", p.from, { sdp: answer });
      } catch (err) {
        console.warn("[mesh] offer handling failed", err);
      }
    });

    // TARGETED: answer.
    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit };
      if (!forMe(p) || !matchesCall(p)) return;
      const entry = peerPoolRef.current.get(p.from);
      if (!entry) return;
      try {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        entry.hasRemoteDesc = true;
        await flushPendingIce(entry);
      } catch (err) {
        console.warn("[mesh] answer handling failed", err);
      }
    });

    // TARGETED: ice.
    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string; candidate: RTCIceCandidateInit };
      if (!forMe(p) || !matchesCall(p) || !p.candidate) return;
      const entry = peerPoolRef.current.get(p.from);
      if (!entry) return;
      if (entry.hasRemoteDesc) {
        try { await entry.pc.addIceCandidate(p.candidate); } catch {}
      } else {
        entry.pendingIce.push(p.candidate);
      }
    });

    // TARGETED: bye — a peer left; drop just their PC.
    ch.on("broadcast", { event: "bye" }, ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string };
      if (!forMe(p) || !matchesCall(p)) return;
      teardownPeer(p.from, false);
    });

    // TARGETED: decline — in 1:1, treat as end. In groups, note it.
    ch.on("broadcast", { event: "decline" }, ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string };
      if (!forMe(p) || !matchesCall(p)) return;
      if (!isCallerRef.current) return;
      if (peerIdsRef.current.length <= 1) {
        toast("Call declined");
        endEveryone(false);
      } else {
        toast(`${peerNamesRef.current.get(p.from) || "Someone"} declined`);
      }
    });

    // ROOM: end — everyone tears down.
    ch.on("broadcast", { event: "end" }, ({ payload }) => {
      const p = payload as { from: string; to: null; callId: string };
      if (!forMe(p) || !matchesCall(p)) return;
      endEveryone(false);
    });

    // Adopt via URL/event from GlobalIncomingCall.
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
      window.setTimeout(() => { void accept(); }, 60);
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

    const onAcceptEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { callId?: string; callType?: CallType; conversationId?: string }
        | undefined;
      if (!detail?.callId) return;
      if (detail.conversationId && detail.conversationId !== conversationId) return;
      autoAcceptTriedRef.current = false;
      adoptAndAccept(detail.callId, detail.callType ?? null);
    };
    window.addEventListener("oniq:accept-call", onAcceptEvent);

    return () => {
      window.removeEventListener("oniq:accept-call", onAcceptEvent);
      endEveryone(false);
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId]);

  const accept = async () => {
    if (status !== "incoming") return;
    setStatus("connecting");
    armConnectTimeout();
    stopAllCallSounds();
    try {
      const stream = await getMedia(callTypeRef.current);
      await ensureIceServers();
      attachLocal(stream, callTypeRef.current);
      // Announce presence — existing members will offer to us.
      sendSig("hello", null, { fromName: meName });
    } catch {
      sendSig("decline", null);
      endEveryone(false);
    }
  };

  const decline = () => {
    // Address decline to caller if we know them (from ring's `from`), else room.
    sendSig("decline", null);
    endEveryone(false);
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
    status === "outgoing" ? "Ringing…"
    : status === "incoming" ? `Incoming ${callType} call`
    : status === "connecting" ? "Connecting…"
    : status === "connected" ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
    : "Call ended";

  const displayName = status === "incoming"
    ? incomingFromName
    : (isGroup ? (groupTitle || "Group") : peerName);
  const monogram = (displayName || "?").charAt(0).toUpperCase();

  // Grid: 1=fullscreen, 2=split, 3-4=2x2
  const tileCount = tiles.length;
  const gridCls =
    tileCount <= 1 ? "grid-cols-1"
    : tileCount === 2 ? "grid-cols-1 sm:grid-cols-2"
    : "grid-cols-2";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {status !== "incoming" && (status === "connected" || status === "connecting") && tileCount > 0 ? (
        <div className={`grid ${gridCls} gap-1 flex-1 p-1`}>
          {tiles.map((t) => (
            <RemoteTile key={t.peerId} tile={t} showVideo={callType === "video"} />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="relative">
            <span className="absolute inset-0 -m-4 animate-ping rounded-full bg-primary/30" />
            <div className="grid h-32 w-32 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-5xl font-bold text-primary-foreground">
              {monogram}
            </div>
          </div>
          <div className="text-2xl font-semibold">{displayName}</div>
          <div className="text-sm text-white/70">{statusText}</div>
          {isGroup && status !== "incoming" && (
            <div className="text-xs text-white/50">group call · up to 4</div>
          )}
        </div>
      )}

      {status === "connected" && tileCount > 0 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs">
          {displayName} · {statusText}
        </div>
      )}

      {callType === "video" && (status === "connecting" || status === "connected") && (
        <video
          ref={localVideoRef}
          autoPlay muted playsInline
          className="absolute right-4 top-16 z-20 h-40 w-28 -scale-x-100 rounded-2xl border border-white/20 bg-black object-cover"
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
              className={`grid h-14 w-14 place-items-center rounded-full disabled:opacity-40 ${muted ? "bg-red-600 hover:bg-red-500" : "bg-white/10 hover:bg-white/20"}`}
              aria-label={muted ? "Unmute mic" : "Mute mic"}
              aria-pressed={muted}
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
              onClick={() => endEveryone(true)}
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

// One tile per remote peer. Renders <video> for video calls; avatar otherwise.
function RemoteTile({ tile, showVideo }: { tile: PeerTile; showVideo: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = tile.stream;
    if (audioRef.current) audioRef.current.srcObject = tile.stream;
    const el = audioRef.current;
    if (el) {
      el.muted = false;
      el.volume = 1.0;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          const retry = () => {
            window.removeEventListener("pointerdown", retry, true);
            el.play().catch(() => {});
          };
          window.addEventListener("pointerdown", retry, true);
        });
      }
    }
  }, [tile.stream]);

  const mono = (tile.peerName || "?").charAt(0).toUpperCase();
  const connecting = tile.connState !== "connected";
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black/60">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay playsInline
          className="h-full w-full bg-black object-cover"
        />
      ) : (
        <div className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground">
          {mono}
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs">
        {tile.peerName || "…"}{connecting ? " · connecting…" : ""}
      </div>
    </div>
  );
}
