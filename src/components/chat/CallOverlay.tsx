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
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import {
  ensureNotificationPermission,
  playRingback,
  stopAllCallSounds,
} from "@/lib/callSounds";
import { sendPush } from "@/lib/push";

// --- Native SpeakerRouter bridge (Capacitor Android plugin). No-op on web. ---
type SpeakerRouterPlugin = {
  setSpeaker: (opts: { on: boolean }) => Promise<{ on: boolean }>;
  reset: () => Promise<void>;
};
let _speakerPlugin: SpeakerRouterPlugin | null | undefined;
let _isNative = false;
async function getSpeakerPlugin(): Promise<SpeakerRouterPlugin | null> {
  if (_speakerPlugin !== undefined) return _speakerPlugin;
  try {
    const core = await import("@capacitor/core");
    _isNative = !!core.Capacitor?.isNativePlatform?.();
    if (!_isNative) { _speakerPlugin = null; return null; }
    _speakerPlugin = core.registerPlugin<SpeakerRouterPlugin>("SpeakerRouter");
    return _speakerPlugin;
  } catch {
    _speakerPlugin = null;
    return null;
  }
}
async function detectNative(): Promise<boolean> {
  try {
    const core = await import("@capacitor/core");
    return !!core.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

async function nativeSetSpeaker(on: boolean): Promise<void> {
  try {
    const plugin = await getSpeakerPlugin();
    if (plugin) await plugin.setSpeaker({ on });
  } catch { /* no-op */ }
}
async function nativeResetSpeaker(): Promise<void> {
  try {
    const plugin = await getSpeakerPlugin();
    if (plugin) await plugin.reset();
  } catch { /* no-op */ }
}


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

// Shared ICE config helper — used by every RTCPeerConnection (1:1 + mesh).
// TURN credentials are fetched from the `get-turn-credentials` edge function
// (auth-gated, server holds the Metered API key). We prefetch once per call
// session into `sessionIceServers` so `getIceConfig` stays synchronous inside
// the signaling flow. Never inline creds anywhere else.
const STUN_ONLY: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

const ICE_TTL_MS = 30 * 60 * 1000;
let cachedIce: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let sessionIceServers: RTCIceServer[] = STUN_ONLY;

async function ensureIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedIce && cachedIce.expiresAt > now) return [...cachedIce.servers];
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? "";
    const { data, error } = await supabase.functions.invoke("get-turn-credentials", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (error || !data?.iceServers?.length) throw error ?? new Error("no ice");
    const servers = data.iceServers as RTCIceServer[];
    cachedIce = { servers, expiresAt: now + ICE_TTL_MS };
    return [...servers];
  } catch (e) {
    console.warn("ensureIceServers fallback to STUN-only", e);
    return [...STUN_ONLY];
  }
}

function getIceConfig(forceRelay = false): RTCConfiguration {
  return {
    iceServers: sessionIceServers,
    iceCandidatePoolSize: 10,
    iceTransportPolicy: forceRelay ? "relay" : "all",
  };
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
  forceRelay: boolean;
  disconnectedSince: number | null;
  disconnectedTimer: number | null;
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
  const [speakerOn, setSpeakerOn] = useState(false);
  const [isNative, setIsNative] = useState(false);
  useEffect(() => { void detectNative().then(setIsNative); }, []);

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
  const statusRef = useRef<Status>("idle");
  // Call log (caller-side only): row id + last-known status so we can update it
  // at lifecycle transitions (answered / missed / declined) and write duration_s
  // on end.
  const logIdRef = useRef<string | null>(null);
  const logStatusRef = useRef<"no_answer" | "answered" | "declined" | "missed">("no_answer");

  // Keep statusRef in sync so signaling handlers (whose closures are captured
  // once at mount) can read the latest status without stale-closure bugs.
  useEffect(() => { statusRef.current = status; }, [status]);
  // Sync local video srcObject whenever the PiP <video> mounts or status/callType changes.
  // Guarantees the caller's self-preview attaches even if the stream existed before the element rendered.
  useEffect(() => {
    if (callTypeRef.current !== "video") return;
    const el = localVideoRef.current;
    const stream = localStreamRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [status, callType]);

  // Native audio routing: default speaker ON for video, OFF (earpiece) for audio,
  // whenever a call enters connecting/connected. Reset on idle/ended.
  useEffect(() => {
    if (!isNative) return;
    if (status === "connecting" || status === "connected") {
      const desired = callType === "video";
      setSpeakerOn(desired);
      void nativeSetSpeaker(desired);
    } else if (status === "idle" || status === "ended") {
      setSpeakerOn(false);
      void nativeResetSpeaker();
    }
  }, [status, callType, isNative]);

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
      // If no peer ever reached connected AND every peer has already tried
      // relay-only escalation, give up. Otherwise let ICE recovery keep trying.
      const peers = [...peerPoolRef.current.values()];
      const anyConnected = peers.some((p) => p.connState === "connected");
      const allRelayTried = peers.length > 0 && peers.every((p) => p.forceRelay);
      if (!anyConnected && allRelayTried) {
        toast.error("Couldn't connect. Please try again.");
        endEveryone(true);
      } else if (!anyConnected) {
        // Extend once — relay escalation may still be in flight.
        armConnectTimeout();
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

  const createPeerEntry = (peerId: string, hintedName?: string, forceRelay = false): PeerEntry => {
    const existing = peerPoolRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(getIceConfig(forceRelay));
    if (hintedName) peerNamesRef.current.set(peerId, hintedName);
    const entry: PeerEntry = {
      peerId,
      peerName: hintedName || peerNamesRef.current.get(peerId) || "",
      pc,
      remoteStream: null,
      pendingIce: [],
      hasRemoteDesc: false,
      connState: "new",
      reachedConnected: false,
      recoveryTimer: null,
      restartAttempts: 0,
      forceRelay,
      disconnectedSince: null,
      disconnectedTimer: null,
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

    // Rebuild this peer connection with iceTransportPolicy: "relay" and
    // re-signal a fresh connection. Called when restartIce() also fails.
    const escalateToRelay = () => {
      if (entry.forceRelay) return; // already tried relay-only
      // eslint-disable-next-line no-console
      console.log(`[mesh] peer ${peerId} escalating to relay-only TURN`);
      setStatus((s) => (s === "connected" ? s : "connecting"));
      toast("Connection failed. Retrying…");
      teardownPeer(peerId, true);
      // Recreate our side now (relay-only). Offerer triggers new offer via
      // onnegotiationneeded; callee waits for our fresh offer.
      const fresh = createPeerEntry(peerId, entry.peerName, true);
      // Nudge remote to rebuild its PC (its `hello` handler recreates it).
      sendSig("hello", null, { fromName: meName });
      void fresh;
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      // eslint-disable-next-line no-console
      console.log(`[mesh] peer ${peerId} iceConnectionState → ${st}`);
      if (st === "connected" || st === "completed") {
        entry.disconnectedSince = null;
        if (entry.disconnectedTimer) {
          clearTimeout(entry.disconnectedTimer);
          entry.disconnectedTimer = null;
        }
        return;
      }
      if (st === "disconnected") {
        if (entry.disconnectedSince == null) entry.disconnectedSince = Date.now();
        if (entry.disconnectedTimer) clearTimeout(entry.disconnectedTimer);
        entry.disconnectedTimer = window.setTimeout(() => {
          entry.disconnectedTimer = null;
          const cur = peerPoolRef.current.get(peerId);
          if (!cur) return;
          const s = cur.pc.iceConnectionState;
          if (s === "connected" || s === "completed") return;
          if (isOffererFor(peerId)) {
            try {
              // eslint-disable-next-line no-console
              console.log(`[mesh] peer ${peerId} restartIce after 5s disconnect`);
              cur.pc.restartIce();
            } catch (err) { console.warn("[mesh] restartIce failed", err); }
          }
        }, 5000);
        return;
      }
      if (st === "failed") {
        // First failure: try restartIce once. Second failure within 10s: force relay.
        if (entry.restartAttempts < 1 && isOffererFor(peerId)) {
          entry.restartAttempts += 1;
          try {
            // eslint-disable-next-line no-console
            console.log(`[mesh] peer ${peerId} restartIce on ice-failed`);
            pc.restartIce();
          } catch (err) { console.warn("[mesh] restartIce failed", err); }
          if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer);
          entry.recoveryTimer = window.setTimeout(() => {
            entry.recoveryTimer = null;
            const cur = peerPoolRef.current.get(peerId);
            if (!cur) return;
            const s = cur.pc.iceConnectionState;
            if (s === "connected" || s === "completed") return;
            escalateToRelay();
          }, 10000);
        } else if (!entry.forceRelay && isOffererFor(peerId)) {
          escalateToRelay();
        }
      }
    };

    pc.onconnectionstatechange = () => {
      entry.connState = pc.connectionState;
      publishTiles();
      const st = pc.connectionState;
      // eslint-disable-next-line no-console
      console.log(`[mesh] peer ${peerId} connectionState → ${st}`);
      if (st === "connected") {
        entry.reachedConnected = true;
        entry.restartAttempts = 0;
        if (entry.recoveryTimer) { clearTimeout(entry.recoveryTimer); entry.recoveryTimer = null; }
        if (entry.disconnectedTimer) { clearTimeout(entry.disconnectedTimer); entry.disconnectedTimer = null; }
        entry.disconnectedSince = null;
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
        // Call log: first successful connect → mark answered.
        if (isCallerRef.current && logIdRef.current && logStatusRef.current !== "answered") {
          logStatusRef.current = "answered";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("call_logs")
            .update({ status: "answered", started_at: new Date().toISOString() })
            .eq("id", logIdRef.current)
            .then(() => {});
        }
      } else if (st === "closed") {
        teardownPeer(peerId, false);
      }
      // Recovery on 'disconnected'/'failed' is handled via
      // oniceconnectionstatechange (5s grace + restartIce + relay escalation).
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
    console.log(`[mesh] PeerPool size: ${peerPoolRef.current.size} (added ${peerId}${forceRelay ? " relay-only" : ""})`);
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
    if (entry.recoveryTimer) { clearTimeout(entry.recoveryTimer); entry.recoveryTimer = null; }
    if (entry.disconnectedTimer) { clearTimeout(entry.disconnectedTimer); entry.disconnectedTimer = null; }
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
    // Call log: if this was an answered call, record duration on end.
    if (isCallerRef.current && logIdRef.current && logStatusRef.current === "answered") {
      const dur = timerRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("call_logs")
        .update({ duration_s: dur })
        .eq("id", logIdRef.current)
        .then(() => {});
    }
    logIdRef.current = null;
    logStatusRef.current = "no_answer";
    for (const peerId of [...peerPoolRef.current.keys()]) {
      const entry = peerPoolRef.current.get(peerId);
      if (entry) {
        if (entry.recoveryTimer) { clearTimeout(entry.recoveryTimer); entry.recoveryTimer = null; }
        if (entry.disconnectedTimer) { clearTimeout(entry.disconnectedTimer); entry.disconnectedTimer = null; }
        try { entry.pc.close(); } catch {}
      }
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
    if (peerIdsRef.current.length > 3) {
      toast("Group calls support up to 4 people for now");
      return;
    }
    activeRef.current = true;
    isCallerRef.current = true;
    callIdRef.current = genId();
    setCallTypeBoth(type);
    setStatus("outgoing");
    ensureNotificationPermission();
    playRingback();

    // Call log: caller inserts a 'no_answer' row up front; later transitions
    // (answered / missed / declined / duration) update this row.
    logStatusRef.current = "no_answer";
    logIdRef.current = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("call_logs")
      .insert({
        conversation_id: conversationId,
        caller_id: meId,
        callee_ids: peerIdsRef.current,
        call_type: type,
        status: "no_answer",
      })
      .select("id")
      .single()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data?.id) logIdRef.current = data.id;
      });

    try {
      const stream = await getMedia(type);
      sessionIceServers = await ensureIceServers();
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

  // Accepter side: while connecting and no peer entries yet, keep hello-ing
  // the room every 2s so the deterministic-offerer partner (who may have
  // stopped its outgoing hello loop) rebuilds a PeerEntry for us and starts
  // offering. Clears the moment any peer exists or call state leaves connecting.
  useEffect(() => {
    if (status !== "connecting") return;
    const id = window.setInterval(() => {
      if (!activeRef.current || !callIdRef.current) return;
      if (peerPoolRef.current.size > 0) return;
      if (!localStreamRef.current) return;
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

    // ROOM or TARGETED: hello — a peer joined (or replied to our hello).
    ch.on("broadcast", { event: "hello" }, async ({ payload }) => {
      const p = payload as { from: string; to: string | null; callId: string; fromName?: string };
      if (!forMe(p) || !matchesCall(p)) return;
      if (p.fromName) peerNamesRef.current.set(p.from, p.fromName);
      // Any inbound hello during outgoing means someone accepted → move on.
      if (statusRef.current === "outgoing" || (isCallerRef.current && !peerPoolRef.current.has(p.from))) {
        setStatus("connecting");
        stopAllCallSounds();
      }
      const wasRoomScoped = p.to == null;
      const alreadyHad = peerPoolRef.current.has(p.from);
      // Create PC to this peer if we don't have one AND our media is ready.
      if (!alreadyHad) {
        if (!localStreamRef.current) {
          // Media not ready yet — the sender will keep re-broadcasting until
          // we're ready. Don't reply; nothing to peer with yet.
          return;
        }
        sessionIceServers = await ensureIceServers();
        createPeerEntry(p.from, p.fromName);
      }
      // Reply with a TARGETED hello so the sender also creates its PeerEntry.
      // Only reply to room-scoped hellos to avoid an infinite echo.
      if (wasRoomScoped) {
        sendSig("hello", p.from, { fromName: meName });
      }
    });

    // TARGETED: offer.
    ch.on("broadcast", { event: "offer" }, async ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit };
      if (!forMe(p) || !matchesCall(p)) return;
      sessionIceServers = await ensureIceServers();
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
      window.setTimeout(() => { void accept(true); }, 60);
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

  const accept = async (force = false) => {
    if (!force && statusRef.current !== "incoming") return;
    if (statusRef.current !== "incoming" && statusRef.current !== "connecting" && !force) return;
    setStatus("connecting");
    statusRef.current = "connecting";
    armConnectTimeout();
    stopAllCallSounds();
    try {
      const stream = await getMedia(callTypeRef.current);
      sessionIceServers = await ensureIceServers();
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

      {callType === "video" && (status === "outgoing" || status === "connecting" || status === "connected") && (
        <video
          ref={localVideoRef}
          autoPlay muted playsInline
          className="pointer-events-none absolute right-4 top-16 z-20 h-40 w-28 -scale-x-100 rounded-2xl border border-white/20 bg-black object-cover"
        />
      )}

      <div className="absolute bottom-10 left-0 right-0 z-30 flex items-center justify-center gap-6">
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
              onClick={() => { void accept(); }}
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
            {isNative && (status === "connecting" || status === "connected") && (
              <button
                onClick={() => {
                  const next = !speakerOn;
                  setSpeakerOn(next);
                  void nativeSetSpeaker(next);
                }}
                className={`grid h-14 w-14 place-items-center rounded-full ${speakerOn ? "bg-white/20 hover:bg-white/30" : "bg-white/10 hover:bg-white/20"}`}
                aria-label={speakerOn ? "Speaker on" : "Speaker off"}
                aria-pressed={speakerOn}
              >
                {speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </button>
            )}
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
