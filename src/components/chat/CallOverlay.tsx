// Mesh WebRTC group calls, no participant cap. 1:1 is the N=1 case of the same code path.
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

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  PhoneOff,
  Search,
  SwitchCamera,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ensureNotificationPermission, playRingback, stopAllCallSounds } from "@/lib/callSounds";
import { sendPush } from "@/lib/push";
import { AttachmentSheet, useAttachmentContext } from "@/components/attach/AttachmentSheet";
import { reportClientError } from "@/lib/errorReport";

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
    if (!_isNative) {
      _speakerPlugin = null;
      return null;
    }
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
  } catch {
    /* no-op */
  }
}
async function nativeResetSpeaker(): Promise<void> {
  try {
    const plugin = await getSpeakerPlugin();
    if (plugin) await plugin.reset();
  } catch {
    /* no-op */
  }
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
  // Optional: when mounted by GlobalCallHost, auto-fire startCall.
  autoStart?: CallType;
  // Optional: when mounted by GlobalCallHost from a notification/global-incoming
  // accept, auto-adopt a callId + type as an incoming call and accept it.
  autoAccept?: { callId: string; callType: CallType };
  // Optional: notified once when the call ends (status → idle after ended).
  onEnded?: () => void;
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
const STUN_ONLY: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const ICE_TTL_MS = 30 * 60 * 1000;
let cachedIce: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let sessionIceServers: RTCIceServer[] = STUN_ONLY;

// Distinct error so call sites can react (toast + mark log failed + end UI)
// instead of stalling on "Connecting…" with a doomed STUN-only config.
export class IceUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "IceUnavailableError";
  }
}

async function ensureIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cachedIce && cachedIce.expiresAt > now) return [...cachedIce.servers];
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token ?? "";
  const { data, error } = await supabase.functions.invoke("get-turn-credentials", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (error || !data?.iceServers?.length) {
    console.warn("[ice] get-turn-credentials failed", error);
    throw new IceUnavailableError("edge-fn-error");
  }
  const source = (data as { source?: string }).source;
  const servers = data.iceServers as RTCIceServer[];
  const hasTurn = servers.some((s) => {
    const u = Array.isArray(s.urls) ? s.urls : [s.urls];
    return u.some(
      (x) => typeof x === "string" && (x.startsWith("turn:") || x.startsWith("turns:")),
    );
  });
  // eslint-disable-next-line no-console
  console.log(`[ice] got ${servers.length} servers, source=${source}, hasTurn=${hasTurn}`);
  if (source !== "metered" || !hasTurn) {
    // Do NOT cache fallback client-side — next call retries the edge fn.
    throw new IceUnavailableError(`unhealthy source=${source} hasTurn=${hasTurn}`);
  }
  cachedIce = { servers, expiresAt: now + ICE_TTL_MS };
  return [...servers];
}

/**
 * Warm the TURN credentials while a phone is still RINGING.
 *
 * `ensureIceServers` is a round trip to an auth-gated edge function, and on
 * the answer path it sat in series behind getUserMedia — so the seconds
 * between "I pressed Answer" and "I can hear you" included a credentials
 * fetch that could have happened while the phone was ringing. Fire this the
 * moment an incoming call appears: by the time Answer is pressed the cache is
 * warm and `ensureIceServers()` returns without touching the network.
 *
 * Deliberately silent — a failed prefetch changes nothing, because the real
 * call path still awaits (and still reports) the same function.
 */
export function prefetchIceServers(): void {
  void ensureIceServers().catch(() => {});
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
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

// Live call filters — CSS filter chains drawn through a canvas so the PEER
// sees them too (a CSS class on the local <video> would only fool yourself).
const CALL_FILTERS = [
  { id: "none", label: "None" },
  { id: "alien", label: "Alien 👽", css: "hue-rotate(95deg) saturate(1.7) contrast(1.12)" },
  { id: "thermal", label: "Thermal 🔥", css: "invert(0.85) hue-rotate(160deg) saturate(2.4)" },
  { id: "noir", label: "Noir 🎞️", css: "grayscale(1) contrast(1.3)" },
  { id: "neon", label: "Neon ⚡", css: "saturate(1.85) contrast(1.2) hue-rotate(8deg)" },
  { id: "ghost", label: "Ghost 👻", css: "invert(1) brightness(1.15) blur(0.6px)" },
] as const;

/**
 * How often the filter canvas is redrawn, and the rate captureStream samples
 * it at. Matched to the camera's own `frameRate: { ideal: 20 }` on purpose —
 * the draw loop used to run on requestAnimationFrame, i.e. 60–120 times a
 * second, to feed a stream that only sampled 20 of them. Two thirds of every
 * filtered frame was drawn, filtered and thrown away, on the phone's main
 * thread, during a call. That is the lag.
 */
const FX_FPS = 20;

/**
 * How long the canvas may go unpainted before the loop is presumed dead and
 * restarted, and how often that is checked. ~16 frames at FX_FPS: past any
 * ordinary jitter, well inside what a person on a call would notice.
 */
const FX_STALL_MS = 800;
const FX_WATCHDOG_MS = 500;

/**
 * The deviceId of the front or back camera.
 *
 * WHY NOT JUST facingMode. Inside an Android WebView the facingMode
 * constraint is documented as unreliable — it can be dropped before it ever
 * reaches the camera stack. What made that invisible here is the fallback:
 * `{ exact: "environment" }` throws, we retried with `{ ideal }`, and `ideal`
 * does not fail — it returns the best available match, which is the camera
 * ALREADY OPEN. So the flip button captured a second front-camera track,
 * swapped it in successfully, and reported no error. It looked alive and did
 * nothing, which is exactly the report from the field.
 *
 * A deviceId is the one instruction the WebView cannot quietly reinterpret.
 * Labels are populated only after permission is granted, which it always is
 * by the time this button can be pressed.
 */
async function cameraDeviceFor(want: "user" | "environment"): Promise<string | null> {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput",
    );
    if (cams.length < 2) return null;
    const rx = want === "environment" ? /back|rear|environment/i : /front|user|face/i;
    const labelled = cams.find((d) => rx.test(d.label));
    if (labelled) return labelled.deviceId;
    // Unlabelled (some WebViews withhold labels even post-permission).
    // Android enumerates front first and back second; with exactly two
    // cameras that is unambiguous enough to act on, and the caller verifies
    // the swap actually moved before committing to it either way.
    return want === "environment" ? cams[cams.length - 1].deviceId : cams[0].deviceId;
  } catch {
    return null;
  }
}

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
  { conversationId, meId, meName, peerName, isGroup, groupTitle, autoStart, autoAccept, onEnded },
  ref,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [callType, setCallType] = useState<CallType>("audio");
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const facingRef = useRef<"user" | "environment">("user");
  const flippingRef = useRef(false);
  // Self-view drag position, as an offset from its top-right home.
  const [pipOffset, setPipOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pipDragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);
  const [camOff, setCamOff] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [incomingFromName, setIncomingFromName] = useState("");
  const [tiles, setTiles] = useState<PeerTile[]>([]);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [isNative, setIsNative] = useState(false);
  // P1 fix: refs don't trigger re-render, so controls disabled on
  // `!localStreamRef.current` stayed stale after media attached. Mirror
  // media presence in state so mute/camera buttons enable correctly.
  const [hasMedia, setHasMedia] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [peerAvatar, setPeerAvatar] = useState<string | null>(null);
  // Owner directive: the control tray must not be welded to the screen — the
  // user hides and recalls it. Hidden slides it off-canvas; a floating chevron
  // brings it back. Incoming calls never hide their Answer/Decline.
  const [trayHidden, setTrayHidden] = useState(false);
  const trayTouchRef = useRef<number | null>(null);
  // In-call attachment sheet + add-people sheet + live video filter.
  const [showAttach, setShowAttach] = useState(false);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [callFilter, setCallFilter] = useState("none");
  const callFilterRef = useRef("none");
  const fxRef = useRef<{
    /** Handle for whichever scheduler is driving the draw loop. */
    raf: number;
    /** True when `raf` is a requestVideoFrameCallback handle, not a timeout. */
    usingRvfc: boolean;
    /** When the last frame was actually painted — the watchdog's evidence. */
    lastDrawAt: number;
    /** The watchdog interval that restarts a loop which stopped being called. */
    watchdog: number;
    canvas: HTMLCanvasElement;
    video: HTMLVideoElement;
    track: MediaStreamTrack;
    stream: MediaStream;
  } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const attachCtx = useAttachmentContext();
  useEffect(() => {
    void detectNative().then(setIsNative);
  }, []);

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
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  // Sync local video srcObject whenever the PiP <video> mounts or status/callType changes.
  // Guarantees the caller's self-preview attaches even if the stream existed before the element rendered.
  //
  // THE FILTERED STREAM WINS, AND THAT IS THE WHOLE FIX.
  //
  // This ran on every `status` change and always assigned the RAW camera. A
  // filter chosen while the call was still `connecting` set the self-view to
  // the canvas stream — and then `connecting` -> `connected` fired this, saw
  // `el.srcObject !== localStreamRef.current`, and put the unfiltered camera
  // straight back. The peer kept receiving the filtered track (the senders
  // were already swapped), so the only person who could see the filter stop
  // was the one who turned it on. From their seat the filter simply did not
  // work, and picking one AFTER connecting appeared to work fine, because no
  // further status change came to undo it.
  //
  // The same hazard is already guarded a few hundred lines down with
  // `&& !fxRef.current`; it was missed here. Preferring the fx stream fixes
  // both halves at once — nothing clobbers the filter, and a self-view element
  // that mounts later comes up filtered instead of bare.
  useEffect(() => {
    if (callTypeRef.current !== "video") return;
    const el = localVideoRef.current;
    const stream = fxRef.current?.stream ?? localStreamRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
    }
  }, [status, callType]);

  // Native audio routing whenever a call enters connecting/connected.
  // Reset on idle/ended.
  useEffect(() => {
    if (!isNative) return;
    if (status === "connecting" || status === "connected") {
      // SPEAKER ON FOR AUDIO CALLS TOO, which is not what a phone normally
      // does. In this WebView the earpiece route is reported as too quiet to
      // hold a conversation — repeatedly, across builds — because WebRTC audio
      // is emitted on the media stream while MODE_IN_COMMUNICATION meters and
      // routes it as a call. An earpiece nobody can hear is not the "correct"
      // default; it is a broken call. Speaker is audible, and one labelled tap
      // goes back to the earpiece for anyone holding the phone to their ear.
      setSpeakerOn(true);
      void nativeSetSpeaker(true);
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

  const sendSig = (event: string, to: string | null, payload: Record<string, unknown> = {}) => {
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
    // Hard 20s ICE deadline: if no peer has reached connected by then, the
    // call cannot recover in a user-tolerable window. Surface a clear toast
    // and record status='failed' in call_logs so it isn't confused with
    // no_answer/missed. Recovery paths (restartIce, relay escalation) still
    // run in the background but no longer keep the UI on "Connecting…"
    // indefinitely.
    connectTimeoutRef.current = window.setTimeout(() => {
      const peers = [...peerPoolRef.current.values()];
      const anyConnected = peers.some((p) => p.connState === "connected");
      if (anyConnected) return;
      // eslint-disable-next-line no-console
      console.warn(
        "[mesh] ICE connect timeout after 20s — peers:",
        peers.map((p) => ({
          id: p.peerId,
          ice: p.pc.iceConnectionState,
          conn: p.connState,
          forceRelay: p.forceRelay,
        })),
      );
      toast.error("network issue — call couldn't connect");
      // The admin errors panel is the only place this is visible after the
      // fact; call_logs says 'failed' but never says WHY. Peer ICE state at
      // the moment of death is the whole diagnosis.
      reportClientError(
        "call-connect-timeout",
        `no peer reached connected in 20s (${peers.length} peer(s))`,
        {
          role: isCallerRef.current ? "caller" : "callee",
          callType: callTypeRef.current,
          peers: peers.map((p) => ({
            ice: p.pc.iceConnectionState,
            conn: p.connState,
            forceRelay: p.forceRelay,
            reachedConnected: p.reachedConnected,
          })),
        },
      );
      // Never demote an ANSWERED call to failed: this timeout also re-arms
      // during mid-call relay rebuilds, and a rebuild that dies should leave
      // the log saying "answered, N seconds" — which is what happened.
      if (isCallerRef.current && logIdRef.current && logStatusRef.current !== "answered") {
        logStatusRef.current = "no_answer";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("call_logs")
          .update({ status: "failed" })
          .eq("id", logIdRef.current)
          .then(() => {});
      }
      endEveryone(true);
    }, 20000);
  };

  const stopUserRingBroadcast = () => {
    for (const c of userRingChannelsRef.current) {
      try {
        supabase.removeChannel(c);
      } catch {}
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
      } catch {
        /* some browsers reject mid-negotiation */
      }
    }
  };

  // ---- media ----

  const getMedia = async (type: CallType) => {
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      };
      const video: MediaTrackConstraints | false =
        type === "video"
          ? {
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 20, max: 24 },
              facingMode: "user",
            }
          : false;
      return await navigator.mediaDevices.getUserMedia({ audio, video });
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "Error";
      if (name === "NotAllowedError" || name === "PermissionDeniedError")
        toast.error("Mic/camera blocked — enable in your app settings");
      else if (name === "NotFoundError" || name === "OverconstrainedError")
        toast.error("No mic/camera found");
      else if (name === "NotReadableError") toast.error("Mic in use by another app");
      else toast.error(`Couldn't start call: ${name}`);
      throw err;
    }
  };

  const attachLocal = (stream: MediaStream, type: CallType) => {
    localStreamRef.current = stream;
    setHasMedia(true);
    if (type === "video" && localVideoRef.current) localVideoRef.current.srcObject = stream;
  };

  // The offer path used to build a PeerEntry before getUserMedia resolved,
  // producing a PC with ZERO senders — no video to the peer, and a camera
  // flip that replaceTrack'd into nothing, forever. Wait briefly for media
  // (the same guard the hello path always had) before building the PC.
  const waitForLocalMedia = async (timeoutMs = 8000) => {
    const t0 = Date.now();
    while (!localStreamRef.current && activeRef.current && Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return !!localStreamRef.current;
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
      const stream =
        incoming ??
        (() => {
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
      teardownPeer(peerId, true, { rebuilding: true });
      // Recreate our side now (relay-only). Offerer triggers new offer via
      // onnegotiationneeded; callee waits for our fresh offer.
      const fresh = createPeerEntry(peerId, entry.peerName, true);
      // Nudge remote to rebuild its PC (its `hello` handler recreates it).
      sendSig("hello", null, { fromName: meName });
      // The rebuild suppressed the pool-empty end above, so re-arm the hard
      // deadline: if the relay attempt never converges, the call ends with an
      // honest "couldn't connect" instead of hanging on Connecting… forever.
      armConnectTimeout();
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
            } catch (err) {
              console.warn("[mesh] restartIce failed", err);
            }
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
          } catch (err) {
            console.warn("[mesh] restartIce failed", err);
          }
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
        if (entry.recoveryTimer) {
          clearTimeout(entry.recoveryTimer);
          entry.recoveryTimer = null;
        }
        if (entry.disconnectedTimer) {
          clearTimeout(entry.disconnectedTimer);
          entry.disconnectedTimer = null;
        }
        entry.disconnectedSince = null;
        clearConnectTimeout();
        stopAllCallSounds();
        setStatus("connected");
        if (!timerRef.current) {
          startedAtRef.current = Date.now();
          // The tick is 500ms, so a bare `secs % 15` fires twice on every
          // boundary. Track the last checkpoint instead of the clock.
          let lastDurationWrite = 0;
          timerRef.current = window.setInterval(() => {
            const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
            setElapsed(secs);
            // Checkpoint the duration every 15s. It used to be written once,
            // at hang-up, by the caller alone — so a caller whose app was
            // killed mid-call (screen off, OS reclaim, closed tab) left the
            // row saying 'answered' with duration NULL forever. Half the
            // answered calls in the log read that way, which made the call
            // reports unusable for exactly the question being asked of them:
            // how long did it survive before it died?
            if (isCallerRef.current && logIdRef.current && secs >= lastDurationWrite + 15) {
              lastDurationWrite = secs;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any)
                .from("call_logs")
                .update({ duration_s: secs })
                .eq("id", logIdRef.current)
                .then(() => {});
            }
          }, 500);
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
    //
    // A LIVE FILTER OWNS THE OUTGOING VIDEO. This used to add the raw camera
    // track unconditionally, so anyone whose peer connection was built AFTER
    // the filter was chosen — the second person into a group call, or any
    // call still connecting when the user picked one — received the unfiltered
    // camera while the sender watched a filtered self-view and believed it was
    // working. applyCallFilter only rewrites senders that already exist; this
    // is the other half of the same promise.
    const local = localStreamRef.current;
    if (local) {
      for (const t of local.getTracks()) {
        try {
          pc.addTrack(t.kind === "video" && fxRef.current ? fxRef.current.track : t, local);
        } catch {}
      }
    }
    void applyBitrateCaps(pc);
    // eslint-disable-next-line no-console
    console.log(
      `[mesh] PeerPool size: ${peerPoolRef.current.size} (added ${peerId}${forceRelay ? " relay-only" : ""})`,
    );
    publishTiles();
    return entry;
  };

  const flushPendingIce = async (entry: PeerEntry) => {
    for (const c of entry.pendingIce) {
      try {
        await entry.pc.addIceCandidate(c);
      } catch {}
    }
    entry.pendingIce = [];
  };

  const teardownPeer = (peerId: string, sendBye: boolean, opts?: { rebuilding?: boolean }) => {
    const entry = peerPoolRef.current.get(peerId);
    if (!entry) return;
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer);
      entry.recoveryTimer = null;
    }
    if (entry.disconnectedTimer) {
      clearTimeout(entry.disconnectedTimer);
      entry.disconnectedTimer = null;
    }
    if (sendBye) sendSig("bye", peerId, opts?.rebuilding ? { rebuilding: true } : undefined);
    try {
      entry.pc.close();
    } catch {}
    peerPoolRef.current.delete(peerId);
    // eslint-disable-next-line no-console
    console.log(`[mesh] PeerPool size: ${peerPoolRef.current.size} (removed ${peerId})`);
    publishTiles();
    // If we drained the pool while call was active, end — UNLESS this teardown
    // is one half of a rebuild. Relay escalation tears the peer down and
    // recreates it a line later; treating that dip-to-zero as "everyone left"
    // was how every recovered call died at ~15s: the recovery path itself
    // ended the call it was recovering, on both sides.
    if (!opts?.rebuilding && peerPoolRef.current.size === 0 && activeRef.current) {
      // In 1:1 or last-peer-left scenarios, end the whole call.
      endEveryone(false);
    }
  };

  const endEveryone = (notify: boolean) => {
    if (notify && activeRef.current) sendSig("end", null);
    // Caller gave up before anyone answered → tell the phones to stop
    // ringing. The "call" push posted an insistent notification on every
    // callee device; without this it loops its ringtone for the full 35s
    // after the caller already hung up.
    if (isCallerRef.current && callIdRef.current && logStatusRef.current !== "answered") {
      sendPush({
        conversation_id: conversationId,
        kind: "call_cancel",
        call_id: callIdRef.current,
      });
    }
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
        if (entry.recoveryTimer) {
          clearTimeout(entry.recoveryTimer);
          entry.recoveryTimer = null;
        }
        if (entry.disconnectedTimer) {
          clearTimeout(entry.disconnectedTimer);
          entry.disconnectedTimer = null;
        }
        try {
          entry.pc.close();
        } catch {}
      }
      peerPoolRef.current.delete(peerId);
    }
    clearConnectTimeout();
    stopAllCallSounds();
    stopUserRingBroadcast();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {}
    });
    localStreamRef.current = null;
    setHasMedia(false);
    setMinimized(false);
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    isCallerRef.current = false;
    activeRef.current = false;
    callIdRef.current = null;
    autoAcceptTriedRef.current = false;
    setMuted(false);
    setFacing("user");
    facingRef.current = "user";
    setPipOffset({ x: 0, y: 0 });
    setCamOff(false);
    setElapsed(0);
    setTiles([]);
    // Filter pipeline + in-call sheets die with the call.
    teardownFx();
    callFilterRef.current = "none";
    setCallFilter("none");
    setFilterOpen(false);
    setShowAttach(false);
    setShowAddPeople(false);
    setTrayHidden(false);
    setStatus("ended");
    window.setTimeout(() => setStatus((s) => (s === "ended" ? "idle" : s)), 700);
  };

  // ICE is unhealthy (edge fn returned STUN-only fallback, or errored):
  // don't start a doomed call. Toast the user, mark the log failed, end UI.
  const handleIceUnavailable = (err: unknown) => {
    console.warn("[ice] unhealthy — refusing to start call", err);
    toast.error("calls are having a moment 📞 try again in a sec");
    reportClientError("call-ice-unavailable", err instanceof Error ? err.message : String(err), {
      role: isCallerRef.current ? "caller" : "callee",
      callType: callTypeRef.current,
    });
    if (isCallerRef.current && logIdRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("call_logs")
        .update({ status: "failed" })
        .eq("id", logIdRef.current)
        .then(() => {});
    }
    endEveryone(false);
  };

  // ---- fetch peer ids for ringing ----

  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    supabase
      .from("conversation_members")
      .select("user_id, profiles(display_name, username, avatar_url)")
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
        // The hero avatar: 1:1 calls show the peer's real photo, like every
        // phone dialer people already know. Groups keep the monogram.
        const first = rows[0]?.profiles?.avatar_url;
        if (!isGroup && typeof first === "string" && first) setPeerAvatar(first);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meId]);

  // ---- start / accept / decline ----

  /**
   * Camera/mic AND TURN credentials, at the same time instead of one after
   * the other. They are independent — a permission prompt does not need the
   * credentials, and the credentials do not need a camera — but they were
   * awaited in series on every dial and every answer, so the user waited for
   * the sum of two round trips where the slower one alone would do.
   *
   * If the credentials fail we stop the tracks we just took: otherwise the
   * camera light stays on after a call that never started, which reads as the
   * app watching you.
   */
  const acquireMediaAndIce = async (type: CallType): Promise<MediaStream> => {
    const [mediaR, iceR] = await Promise.allSettled([getMedia(type), ensureIceServers()]);
    if (mediaR.status === "rejected") throw mediaR.reason;
    if (iceR.status === "rejected") {
      for (const t of mediaR.value.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
      throw iceR.reason;
    }
    sessionIceServers = iceR.value;
    return mediaR.value;
  };

  const startCall = async (type: CallType) => {
    if (!meId || activeRef.current) return;
    // Ensure peer IDs are loaded before we insert the call log / send pushes.
    // The membership fetch (useEffect above) is async, and autoStart flows
    // (deep-link / one-tap accept) can race ahead of it, causing callee_ids
    // to be persisted as '{}' and breaking name resolution in the Calls tab.
    if (peerIdsRef.current.length === 0) {
      const { data } = await supabase
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId)
        .neq("user_id", meId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerIdsRef.current = ((data ?? []) as any[]).map((r) => r.user_id).filter(Boolean);
    }
    // No participant cap — the mesh takes whoever the conversation holds.
    // (Owner directive: "no restriction in numbers". Physics still applies:
    // every extra person is another peer connection on every phone.)
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

    // The push goes out BEFORE the media/TURN awaits, not after. Those two
    // awaits cover a mic-permission prompt and a credentials round trip —
    // seconds during which a closed app's phone stayed silent — and any
    // failure in them used to return early with no push ever sent. The
    // callee's phone should start ringing the moment the caller commits.
    sendPush({
      conversation_id: conversationId,
      kind: "call",
      call_type: type,
      call_id: callIdRef.current ?? undefined,
    });

    try {
      const stream = await acquireMediaAndIce(type);
      attachLocal(stream, type);
    } catch (e) {
      if (e instanceof IceUnavailableError) handleIceUnavailable(e);
      else endEveryone(false);
      return;
    }

    // Room ring on the call channel.
    sendSig("ring", null, {
      callType: type,
      fromName: meName,
      isGroup: !!isGroup,
      groupTitle: groupTitle ?? "",
    });
    // Announce presence to any accepters.
    sendSig("hello", null, { fromName: meName });

    // Per-user rings so recipients see the incoming UI from anywhere.
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
      // Still ringing means still `outgoing`. A pickup at 28s flips us to
      // `connecting` before its PeerEntry exists (the callee's media is still
      // resolving), and the pool-size test alone would call that "nobody
      // answered" and hang up on them.
      if (
        isCallerRef.current &&
        statusRef.current === "outgoing" &&
        peerPoolRef.current.size === 0
      ) {
        // Call log: nobody answered in 30s → missed.
        if (logIdRef.current && logStatusRef.current === "no_answer") {
          logStatusRef.current = "missed";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any)
            .from("call_logs")
            .update({ status: "missed" })
            .eq("id", logIdRef.current)
            .then(() => {});
        }
        toast("They're not around — try a message 💬");
        endEveryone(true);
      }
    }, 30000);
    // NO CONNECT DEADLINE HERE. This used to arm the 20s ICE deadline the
    // moment the caller pressed Call — while the other phone was still
    // RINGING. Any pickup later than 20 seconds (a phone in a pocket, which
    // is most of them) walked into a timer that fired "network issue — call
    // couldn't connect", wrote status='failed' and hung up on a call that had
    // just been answered; a pickup at 18s got two seconds to finish ICE
    // before the caller killed it. That is the "calls drop right as I answer"
    // report, and it also made the 30s missed path above nearly unreachable —
    // the 20s deadline always fired first, so genuinely unanswered calls were
    // logged 'failed' instead of 'missed'.
    //
    // The deadline belongs to CONNECTING, not to ringing: it is armed in the
    // `hello` handler below the moment someone accepts, on accept() for the
    // callee, and again on a relay rebuild.
  };

  useImperativeHandle(ref, () => ({
    startCall: (t) => {
      void startCall(t);
    },
  }));

  // GlobalCallHost props: autoStart fires a new outgoing call; autoAccept
  // adopts an incoming callId. Both dispatched after a tick so the signaling
  // channel useEffect (below) has time to subscribe and register listeners.
  useEffect(() => {
    if (autoStart) {
      const t = window.setTimeout(() => {
        if (!activeRef.current) void startCall(autoStart);
      }, 250);
      return () => window.clearTimeout(t);
    }
    if (autoAccept) {
      const t = window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("oniq:accept-call", {
            detail: { callId: autoAccept.callId, callType: autoAccept.callType, conversationId },
          }),
        );
      }, 400);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify host once when the call is fully torn down (ended → idle).
  const prevStatusRef = useRef<Status>("idle");
  useEffect(() => {
    if (prevStatusRef.current === "ended" && status === "idle") {
      onEnded?.();
    }
    prevStatusRef.current = status;
  }, [status, onEnded]);

  // Re-broadcast ring while outgoing (subscribe race guard) — on BOTH rails.
  //
  // The room channel covers accepters already inside a call session. The
  // per-user channels are the ones an IDLE callee actually listens on
  // (GlobalIncomingCall), and they used to get exactly one send, at subscribe
  // time. Two ways that lost real calls, both observed on 2026-08-10:
  // a callee whose subscription came up moments after that single send never
  // rang at all, and a callee who DID ring had the overlay auto-dismiss after
  // 6 quiet seconds — its idle timer is built around re-rings that never came
  // on this channel. Every ring below refreshes the callee's lastRing, so the
  // incoming screen persists for as long as the caller is actually waiting.
  useEffect(() => {
    if (status !== "outgoing") return;
    const id = window.setInterval(() => {
      if (!isCallerRef.current || !activeRef.current || !callIdRef.current) return;
      sendSig("ring", null, {
        callType: callTypeRef.current,
        fromName: meName,
        isGroup: !!isGroup,
        groupTitle: groupTitle ?? "",
      });
      sendSig("hello", null, { fromName: meName });
      for (const uch of userRingChannelsRef.current) {
        void uch.send({
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
    const ch = supabase.channel(`call:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
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
      const p = payload as {
        from: string;
        to: null;
        callId: string;
        callType: CallType;
        fromName?: string;
        groupTitle?: string;
      };
      if (!forMe(p)) return;
      if (activeRef.current) return;
      activeRef.current = true;
      isCallerRef.current = false;
      callIdRef.current = p.callId ?? genId();
      setCallTypeBoth(p.callType);
      setIncomingFromName(
        p.fromName || (isGroup ? p.groupTitle || groupTitle || "Group" : peerName),
      );
      setStatus("incoming");
      // Fetch TURN credentials during the ring, so Answer doesn't wait on them.
      prefetchIceServers();
    });

    // ROOM or TARGETED: hello — a peer joined (or replied to our hello).
    ch.on("broadcast", { event: "hello" }, async ({ payload }) => {
      const p = payload as { from: string; to: string | null; callId: string; fromName?: string };
      if (!forMe(p) || !matchesCall(p)) return;
      if (p.fromName) peerNamesRef.current.set(p.from, p.fromName);
      // Any inbound hello during outgoing means someone accepted → move on.
      if (
        statusRef.current === "outgoing" ||
        (isCallerRef.current && !peerPoolRef.current.has(p.from))
      ) {
        setStatus("connecting");
        stopAllCallSounds();
        // Someone accepted: NOW the 20s ICE deadline is meaningful, and its
        // clock starts from the pickup rather than from the dial. Ringing is
        // covered by the 30s missed timer instead.
        armConnectTimeout();
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
        try {
          sessionIceServers = await ensureIceServers();
        } catch (e) {
          if (e instanceof IceUnavailableError) handleIceUnavailable(e);
          else endEveryone(false);
          return;
        }
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
      const p = payload as {
        from: string;
        to: string;
        callId: string;
        sdp: RTCSessionDescriptionInit;
      };
      if (!forMe(p) || !matchesCall(p)) return;
      try {
        sessionIceServers = await ensureIceServers();
      } catch (e) {
        if (e instanceof IceUnavailableError) handleIceUnavailable(e);
        else endEveryone(false);
        return;
      }
      let entry = peerPoolRef.current.get(p.from);
      if (!entry) {
        if (!localStreamRef.current) await waitForLocalMedia();
        entry = createPeerEntry(p.from);
      }
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
      const p = payload as {
        from: string;
        to: string;
        callId: string;
        sdp: RTCSessionDescriptionInit;
      };
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
      const p = payload as {
        from: string;
        to: string;
        callId: string;
        candidate: RTCIceCandidateInit;
      };
      if (!forMe(p) || !matchesCall(p) || !p.candidate) return;
      const entry = peerPoolRef.current.get(p.from);
      if (!entry) return;
      if (entry.hasRemoteDesc) {
        try {
          await entry.pc.addIceCandidate(p.candidate);
        } catch {}
      } else {
        entry.pendingIce.push(p.candidate);
      }
    });

    // TARGETED: bye — a peer left; drop just their PC. A bye carrying
    // `rebuilding` is not a goodbye: the sender is about to re-offer over a
    // relay-only connection, so tear down the stale PC without ending the
    // call, show Connecting…, and re-arm the deadline in case the rebuild
    // never lands.
    ch.on("broadcast", { event: "bye" }, ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string; rebuilding?: boolean };
      if (!forMe(p) || !matchesCall(p)) return;
      if (p.rebuilding) {
        teardownPeer(p.from, false, { rebuilding: true });
        setStatus((s) => (s === "connected" ? "connecting" : s));
        armConnectTimeout();
        return;
      }
      teardownPeer(p.from, false);
    });

    // TARGETED: decline — in 1:1, treat as end. In groups, note it.
    ch.on("broadcast", { event: "decline" }, ({ payload }) => {
      const p = payload as { from: string; to: string; callId: string };
      if (!forMe(p) || !matchesCall(p)) return;
      if (!isCallerRef.current) return;
      // A decline that arrives AFTER the call connected is a straggler — the
      // callee's other device or tab saying no to a call this one already said
      // yes to. Acting on it would hang up a live conversation.
      if (statusRef.current === "connected") return;
      // Call log: mark declined (only if not already answered).
      if (logIdRef.current && logStatusRef.current === "no_answer") {
        logStatusRef.current = "declined";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from("call_logs")
          .update({ status: "declined" })
          .eq("id", logIdRef.current)
          .then(() => {});
      }
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
      window.setTimeout(() => {
        void accept(true);
      }, 60);
    };

    ch.subscribe((sStatus) => {
      if (sStatus !== "SUBSCRIBED") return;
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      // Kick off an outgoing call from ?startCall=audio|video (used by Calls tab call-back).
      const startType = params.get("startCall") as CallType | null;
      if (startType === "audio" || startType === "video") {
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("startCall");
          window.history.replaceState({}, "", url.toString());
        } catch {}
        if (!activeRef.current) {
          window.setTimeout(() => {
            void startCall(startType);
          }, 400);
        }
      }
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
        { callId?: string; callType?: CallType; conversationId?: string } | undefined;
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
      const stream = await acquireMediaAndIce(callTypeRef.current);
      attachLocal(stream, callTypeRef.current);
      // Announce presence — existing members will offer to us.
      sendSig("hello", null, { fromName: meName });
    } catch (e) {
      if (e instanceof IceUnavailableError) {
        sendSig("decline", null);
        handleIceUnavailable(e);
      } else {
        sendSig("decline", null);
        endEveryone(false);
      }
    }
  };

  const decline = () => {
    // Address decline to caller if we know them (from ring's `from`), else room.
    sendSig("decline", null);
    endEveryone(false);
  };

  // Both toggles used to compute `next` as the INVERTED enabled flag and then
  // write back `!next` — which is the original value. Tapping Mute or Video
  // did nothing at all: the track stayed exactly as it was and the label
  // flipped back on the next render. Read the current state, invert it once,
  // write that.
  const toggleMute = () => {
    const s = localStreamRef.current;
    const tracks = s?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const nextEnabled = !(tracks[0].enabled ?? true);
    tracks.forEach((t) => (t.enabled = nextEnabled));
    setMuted(!nextEnabled);
  };

  const toggleCam = () => {
    const s = localStreamRef.current;
    const tracks = s?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const nextEnabled = !(tracks[0].enabled ?? true);
    tracks.forEach((t) => (t.enabled = nextEnabled));
    setCamOff(!nextEnabled);
  };

  /**
   * Front ↔ back camera. A NEW track is captured with the opposite facingMode
   * and swapped via RTCRtpSender.replaceTrack — no renegotiation, the peers
   * never notice. The old track is stopped only after the swap so a failure
   * (no back camera on a tablet, camera in use) leaves the call exactly as it
   * was. The self-preview mirrors only for the front camera: a mirrored rear
   * camera makes text in the room read backwards, which is how every native
   * camera app behaves.
   */
  const flipCamera = async () => {
    const s = localStreamRef.current;
    const oldTrack = s?.getVideoTracks()[0];
    if (!s || !oldTrack || flippingRef.current) return;
    flippingRef.current = true;
    const next = facingRef.current === "user" ? "environment" : "user";
    try {
      // `exact` first (guarantees the rear lens on multi-camera phones), but
      // fall back to `ideal` instead of failing: `exact` throws
      // OverconstrainedError on plenty of real devices/WebViews that DO have
      // a back camera but label it differently — which is exactly the
      // "back camera doesn't work for the caller" report from the field.
      const baseVideo = {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 20, max: 24 },
      } as MediaTrackConstraints;
      const targetId = await cameraDeviceFor(next);
      const ask = () =>
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: targetId
            ? { ...baseVideo, deviceId: { exact: targetId } }
            : { ...baseVideo, facingMode: { exact: next } },
        });
      // Did we ACTUALLY move? A constraint the WebView ignored hands back the
      // camera already running, and swapping a front-camera track for another
      // front-camera track is the silent no-op this whole rewrite exists to
      // kill. Compare the device the tracks actually came from.
      const oldId = oldTrack.getSettings().deviceId;
      const moved = (t: MediaStreamTrack) => {
        const s2 = t.getSettings();
        if (targetId) return s2.deviceId === targetId;
        if (oldId && s2.deviceId) return s2.deviceId !== oldId;
        return s2.facingMode === next;
      };

      let fresh: MediaStream | null = null;
      let released = false;
      // Try WITHOUT releasing first: if the device can hold both cameras open,
      // a failure here costs the user nothing and the call is never blind.
      try {
        const s2 = await ask();
        if (moved(s2.getVideoTracks()[0])) fresh = s2;
        else s2.getTracks().forEach((t) => t.stop());
      } catch {
        /* busy, or the constraint is unsatisfiable while the other lens runs */
      }

      if (!fresh) {
        // Plenty of Android devices open exactly ONE camera at a time, so the
        // request above could never have succeeded while the front lens was
        // live. Release, then ask — this is the step the old code never took.
        oldTrack.stop();
        released = true;
        try {
          fresh = await ask();
        } catch {
          fresh = await navigator.mediaDevices
            .getUserMedia({ audio: false, video: { ...baseVideo, facingMode: { ideal: next } } })
            .catch(() => null);
        }
      }

      const newTrack = fresh?.getVideoTracks()[0];
      if (!newTrack) {
        // We may have just stopped the only working camera. Put the call back
        // the way we found it rather than leaving the caller blind.
        if (released) {
          const back = await navigator.mediaDevices
            .getUserMedia({
              audio: false,
              video: { ...baseVideo, facingMode: { ideal: facingRef.current } },
            })
            .catch(() => null);
          const recovered = back?.getVideoTracks()[0];
          if (recovered) {
            recovered.enabled = oldTrack.enabled;
            for (const entry of peerPoolRef.current.values()) {
              for (const sender of entry.pc.getSenders()) {
                if (sender.track?.kind === "video")
                  await sender.replaceTrack(recovered).catch(() => {});
              }
            }
            s.removeTrack(oldTrack);
            s.addTrack(recovered);
            if (fxRef.current) {
              fxRef.current.video.srcObject = new MediaStream([recovered]);
              void fxRef.current.video.play().catch(() => {});
            } else if (localVideoRef.current) {
              localVideoRef.current.srcObject = s;
            }
          }
        }
        throw new Error("no track");
      }
      newTrack.enabled = oldTrack.enabled; // respect an active "Video off"
      if (fxRef.current) {
        // A filter pipeline owns the senders (they carry the canvas track);
        // feed the new camera into the pipeline instead of the peers. The
        // canvas follows the new lens' geometry — the two cameras rarely
        // report the same dimensions, and a stale canvas stretches the image.
        const st = newTrack.getSettings();
        if (st.width && st.height) {
          fxRef.current.canvas.width = st.width;
          fxRef.current.canvas.height = st.height;
        }
        fxRef.current.video.srcObject = new MediaStream([newTrack]);
        void fxRef.current.video.play().catch(() => {});
      } else {
        for (const entry of peerPoolRef.current.values()) {
          let replaced = false;
          for (const sender of entry.pc.getSenders()) {
            if (sender.track?.kind === "video") {
              await sender.replaceTrack(newTrack).catch(() => {});
              replaced = true;
            }
          }
          // A PC built before media resolved has NO video sender at all, so
          // replaceTrack found nothing and the flip silently never reached
          // that peer — the other half of the caller's dead flip button.
          // addTrack renegotiates (offerer side) and repairs the connection.
          if (!replaced) {
            try {
              entry.pc.addTrack(newTrack, s);
            } catch {}
          }
        }
      }
      s.removeTrack(oldTrack);
      s.addTrack(newTrack);
      oldTrack.stop();
      if (localVideoRef.current && !fxRef.current) localVideoRef.current.srcObject = s;
      facingRef.current = next;
      setFacing(next);
    } catch {
      toast.error(next === "environment" ? "No back camera found" : "Couldn't switch camera");
    } finally {
      flippingRef.current = false;
    }
  };

  /**
   * Live filter for the OUTGOING video. Camera frames are drawn through a
   * canvas with ctx.filter and the canvas track replaces the camera track on
   * every peer connection, so the other side sees the effect — not just the
   * self-view. "None" swaps the raw camera track back and tears the canvas
   * down so no per-frame work survives the fun.
   */
  const teardownFx = () => {
    const fx = fxRef.current;
    if (!fx) return;
    // Cleared FIRST: the draw loop reads fxRef every frame and stops on null,
    // so an in-flight callback cannot resurrect a torn-down pipeline.
    fxRef.current = null;
    clearInterval(fx.watchdog);
    const v = fx.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (fx.usingRvfc && typeof v.cancelVideoFrameCallback === "function") {
      v.cancelVideoFrameCallback(fx.raf);
    } else {
      clearTimeout(fx.raf);
    }
    try {
      fx.track.stop();
    } catch {}
    // The source <video> is a real DOM node (see applyCallFilter) and has to
    // be removed, or every filter toggle leaks one more decoding element.
    try {
      v.pause();
      v.srcObject = null;
      v.remove();
    } catch {}
  };

  const applyCallFilter = async (id: string) => {
    callFilterRef.current = id;
    setCallFilter(id);
    const s = localStreamRef.current;
    const camTrack = s?.getVideoTracks()[0];
    if (!s || !camTrack) return;
    if (id === "none") {
      teardownFx();
      for (const entry of peerPoolRef.current.values()) {
        for (const sender of entry.pc.getSenders()) {
          if (sender.track?.kind === "video") await sender.replaceTrack(camTrack).catch(() => {});
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = s;
      return;
    }
    if (!fxRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      // IT MUST BE IN THE DOCUMENT. A detached <video> is not guaranteed to
      // decode in an Android WebView — it can stay at readyState 0 forever,
      // and drawImage of a video with no frames paints nothing. That is the
      // filter that "doesn't work": a black or frozen rectangle sent to the
      // other side. Off-screen and inert, but attached and therefore live.
      // NOT `display:none`, which suspends rendering all over again.
      video.setAttribute(
        "style",
        "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none",
      );
      document.body.appendChild(video);
      video.srcObject = new MediaStream([camTrack]);
      await video.play().catch(() => {});

      const canvas = document.createElement("canvas");
      const st = camTrack.getSettings();
      canvas.width = st.width || 640;
      canvas.height = st.height || 480;
      const stream = canvas.captureStream(FX_FPS);
      const track = stream.getVideoTracks()[0];
      // alpha:false — the camera frame is opaque, and telling the compositor
      // so removes a per-frame blend on every filtered frame.
      const ctx = canvas.getContext("2d", { alpha: false });
      const fx = {
        raf: 0,
        usingRvfc: false,
        lastDrawAt: Date.now(),
        watchdog: 0,
        canvas,
        video,
        track,
        stream,
      };
      fxRef.current = fx;

      /**
       * Draw once per CAMERA frame, not once per display refresh.
       *
       * requestAnimationFrame fires at the screen's rate — 60Hz, 120Hz on
       * newer phones — while the camera produces 20fps and captureStream
       * samples 20fps. Two thirds or more of every drawImage+filter was
       * computed and discarded, on the main thread, mid-call.
       * requestVideoFrameCallback fires exactly once per decoded frame, so
       * the work matches the frames that actually exist.
       *
       * BUT rVFC IS NOT A TIMER. It is a promise to call back when the next
       * frame is PRESENTED, and if no frame ever is — the WebView backgrounds
       * the page and pauses the element, the camera stalls, the track is
       * swapped out from under it — the callback never fires and the loop is
       * gone for good. rAF at least kept ticking and repainting the last
       * frame. Trading that away for efficiency without a liveness guard
       * turns a stutter into a permanently frozen filter, and captureStream
       * only samples a canvas that CHANGES, so the far side freezes with it.
       * Hence the watchdog below: efficiency by default, recovery guaranteed.
       */
      const schedule = () => {
        const cur = fxRef.current;
        if (!cur) return;
        const v = cur.video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof v.requestVideoFrameCallback === "function") {
          cur.usingRvfc = true;
          cur.raf = v.requestVideoFrameCallback(draw);
        } else {
          cur.usingRvfc = false;
          cur.raf = window.setTimeout(draw, 1000 / FX_FPS);
        }
      };

      const draw = () => {
        const cur = fxRef.current;
        if (!cur || !ctx) return;
        const active = CALL_FILTERS.find((x) => x.id === callFilterRef.current);
        ctx.filter = (active && "css" in active && active.css) || "none";
        try {
          ctx.drawImage(cur.video, 0, 0, cur.canvas.width, cur.canvas.height);
        } catch {}
        cur.lastDrawAt = Date.now();
        schedule();
      };

      /** Cancel whatever is pending and start the loop again from scratch. */
      const kick = () => {
        const cur = fxRef.current;
        if (!cur) return;
        const v = cur.video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (h: number) => void;
        };
        if (cur.usingRvfc && typeof v.cancelVideoFrameCallback === "function") {
          try {
            v.cancelVideoFrameCallback(cur.raf);
          } catch {
            /* already fired */
          }
        } else {
          clearTimeout(cur.raf);
        }
        // A paused element presents no frames, so nothing above would ever
        // restart on its own — this is the half that actually revives it.
        if (cur.video.paused) void cur.video.play().catch(() => {});
        draw();
      };

      draw();

      // Cheap: one comparison twice a second. FX_STALL_MS is ~16 frames at
      // FX_FPS, long enough that ordinary jitter never trips it and short
      // enough that a real stall is invisible to the person on the call.
      fx.watchdog = window.setInterval(() => {
        const cur = fxRef.current;
        if (!cur) return;
        if (Date.now() - cur.lastDrawAt > FX_STALL_MS) kick();
      }, FX_WATCHDOG_MS);

      for (const entry of peerPoolRef.current.values()) {
        for (const sender of entry.pc.getSenders()) {
          if (sender.track?.kind === "video") await sender.replaceTrack(track).catch(() => {});
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    }
  };

  /**
   * Mid-call attachments: files picked in the call go into the SAME chat the
   * call lives in, through the same bucket and message shape the thread uses.
   * The person on the other end sees them in the conversation the moment the
   * call ends — or immediately, if they glance at the chat.
   */
  const sendCallAttachment = async (files: File[]) => {
    if (!meId) return;
    let sent = 0;
    for (const f of files.slice(0, 5)) {
      try {
        const ext = (f.name.split(".").pop() || "bin").toLowerCase();
        const path = `${meId}/${genId()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("chat-media")
          .upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (upErr) throw upErr;
        const kind = f.type.startsWith("image/")
          ? "image"
          : f.type.startsWith("video/")
            ? "video"
            : "file";
        // B1: store the BARE storage path — the thread resolves it through
        // resolveMedia (TTL-capped signer) at render. First adopter of the
        // pattern the media-url fence exists to force.
        const { error: insErr } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          sender_id: meId,
          content: kind === "file" ? f.name : "",
          type: kind,
          media_url: path,
          file_name: kind === "file" ? f.name : null,
          file_size: kind === "file" ? f.size : null,
        });
        if (insErr) throw insErr;
        sent += 1;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't send that one");
      }
    }
    if (sent > 0) {
      sendPush({
        conversation_id: conversationId,
        kind: "message",
        preview: sent === 1 ? "📎 Shared in call" : `📎 ${sent} files shared in call`,
      });
      toast.success(sent === 1 ? "Sent to the chat 📎" : `${sent} sent to the chat 📎`);
    }
  };

  /**
   * Conference by addition — either side rings one more person INTO the live
   * call. The invite rides the same per-user ring channel an ordinary call
   * uses, carrying the live callId, so their accept drops them straight into
   * this mesh. Re-rung every 2s for 30s because the incoming overlay expires
   * without re-rings. (A push only reaches them if they're a member of this
   * conversation — for everyone else the in-app ring does the work.)
   */
  const ringUser = (userId: string, name?: string) => {
    if (!callIdRef.current || !activeRef.current) return;
    if (userId === meId || peerPoolRef.current.has(userId)) return;
    if (name) peerNamesRef.current.set(userId, name);
    if (!peerIdsRef.current.includes(userId)) peerIdsRef.current.push(userId);
    const uch = supabase.channel(`user-calls:${userId}`, {
      config: { broadcast: { self: false } },
    });
    const payload = () => ({
      conversationId,
      callId: callIdRef.current,
      callType: callTypeRef.current,
      fromName: meName,
      fromId: meId,
    });
    uch.subscribe((st) => {
      if (st === "SUBSCRIBED") {
        void uch.send({ type: "broadcast", event: "ring", payload: payload() });
      }
    });
    const iv = window.setInterval(() => {
      if (!activeRef.current || peerPoolRef.current.has(userId)) {
        window.clearInterval(iv);
        return;
      }
      void uch.send({ type: "broadcast", event: "ring", payload: payload() });
    }, 2000);
    window.setTimeout(() => window.clearInterval(iv), 30000);
    userRingChannelsRef.current.push(uch);
    toast(`Ringing ${name || "them"}… 📞`);
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

  const displayName =
    status === "incoming" ? incomingFromName : isGroup ? groupTitle || "Group" : peerName;
  const monogram = (displayName || "?").charAt(0).toUpperCase();

  // Grid: 1=fullscreen, 2=split, 3-4=2x2
  const tileCount = tiles.length;
  const gridCls =
    tileCount <= 1 ? "grid-cols-1" : tileCount === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2";

  // Minimized: floating pill instead of fullscreen. PC/tracks keep running.
  if (minimized) {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    const timeLabel =
      status === "connected" ? `${mm}:${ss}` : status === "connecting" ? "connecting…" : "ringing…";
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        data-testid="call-pill"
        className="fixed bottom-24 left-1/2 z-[90] -translate-x-1/2 flex items-center gap-2 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-green-500 active:scale-95"
        aria-label="Return to ongoing call"
      >
        <Phone className="h-4 w-4 animate-pulse" />
        Ongoing call · {timeLabel} · tap to return
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {status !== "incoming" && (status === "connecting" || status === "connected") && (
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="absolute left-4 top-4 z-40 grid h-10 w-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"
          aria-label="Minimize call"
          data-testid="call-minimize"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
      {status !== "incoming" &&
      (status === "connected" || status === "connecting") &&
      tileCount > 0 ? (
        <div className={`grid ${gridCls} gap-1 flex-1 p-1`}>
          {tiles.map((t) => (
            <RemoteTile key={t.peerId} tile={t} showVideo={callType === "video"} />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="relative">
            <span className="absolute inset-0 -m-4 animate-ping rounded-full bg-primary/30" />
            <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-accent text-5xl font-bold text-primary-foreground">
              {peerAvatar ? (
                <img src={peerAvatar} alt="" className="h-full w-full object-cover" />
              ) : (
                monogram
              )}
            </div>
          </div>
          <div className="text-2xl font-semibold">{displayName}</div>
          <div className="text-sm text-white/70">{statusText}</div>
          {isGroup && status !== "incoming" && (
            <div className="text-xs text-white/50">group call</div>
          )}
        </div>
      )}

      {status === "connected" && tileCount > 0 && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs">
          {displayName} · {statusText}
        </div>
      )}

      {callType === "video" &&
        (status === "outgoing" || status === "connecting" || status === "connected") && (
          // Draggable self-view. It was pointer-events-none — literally
          // inoperable — and it sat wherever it sat, covering faces. Drag
          // moves it; the flip chip on it switches front/back camera.
          <div
            className="absolute right-4 top-16 z-20 touch-none"
            style={{ transform: `translate(${pipOffset.x}px, ${pipOffset.y}px)` }}
            onTouchStart={(e) => {
              const t = e.touches[0];
              pipDragRef.current = {
                startX: t.clientX,
                startY: t.clientY,
                baseX: pipOffset.x,
                baseY: pipOffset.y,
              };
            }}
            onTouchMove={(e) => {
              const d = pipDragRef.current;
              if (!d) return;
              const t = e.touches[0];
              setPipOffset({
                x: d.baseX + (t.clientX - d.startX),
                y: d.baseY + (t.clientY - d.startY),
              });
            }}
            onTouchEnd={() => {
              pipDragRef.current = null;
            }}
          >
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`h-40 w-28 rounded-2xl border border-white/20 bg-black object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
            />
            <button
              type="button"
              onClick={() => void flipCamera()}
              aria-label="Switch camera"
              className="absolute -bottom-2 -left-2 grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-black/70 text-white backdrop-blur transition active:scale-90"
            >
              <SwitchCamera className="h-4 w-4" />
            </button>
          </div>
        )}

      {/* Tray recall chip — the way back once the user swipes the tray away. */}
      {trayHidden && status !== "incoming" && (
        <button
          type="button"
          onClick={() => setTrayHidden(false)}
          aria-label="Show call controls"
          data-testid="call-tray-show"
          className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 grid h-10 w-14 place-items-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      {/* Live filter chips — visible while the filter picker is open. */}
      {filterOpen && !trayHidden && status !== "incoming" && callType === "video" && (
        <div className="absolute bottom-[9.5rem] left-0 right-0 z-30 flex justify-center px-4">
          <div className="flex max-w-full gap-1.5 overflow-x-auto rounded-full border border-white/10 bg-black/60 px-2 py-1.5 backdrop-blur">
            {CALL_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => void applyCallFilter(f.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  callFilter === f.id ? "bg-white text-black" : "text-white/80"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* WhatsApp-style control tray: a rounded card, labeled circular
          buttons, End set apart in red. Labels matter — an unlabeled icon
          grid is exactly what "primitive" feedback points at.
          NOT welded to the screen (owner directive): swipe down or tap the
          grab-handle to slide it away; the chevron chip recalls it. Incoming
          calls always keep Answer/Decline on screen. */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-30 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-transform duration-200 ${
          trayHidden && status !== "incoming" ? "translate-y-[130%]" : ""
        }`}
        onTouchStart={(e) => {
          trayTouchRef.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const start = trayTouchRef.current;
          trayTouchRef.current = null;
          if (start == null || status === "incoming") return;
          if (e.changedTouches[0].clientY - start > 40) setTrayHidden(true);
        }}
      >
        <div className="mx-auto w-full max-w-md rounded-3xl border border-white/10 bg-[#12141c]/95 px-4 py-4 shadow-2xl backdrop-blur">
          {status !== "incoming" && (
            <button
              type="button"
              onClick={() => setTrayHidden(true)}
              aria-label="Hide call controls"
              data-testid="call-tray-hide"
              className="mx-auto mb-2 block h-1.5 w-12 rounded-full bg-white/25"
            />
          )}
          {status === "incoming" ? (
            <div className="flex items-center justify-around">
              <CallAction label="Decline" onClick={decline} tone="danger" ariaLabel="Decline call">
                <PhoneOff className="h-6 w-6" />
              </CallAction>
              <CallAction
                label="Answer"
                onClick={() => {
                  void accept();
                }}
                tone="success"
                ariaLabel="Accept call"
                testId="call-accept"
              >
                <Phone className="h-6 w-6" />
              </CallAction>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-3">
              <CallAction
                label={muted ? "Unmute" : "Mute"}
                onClick={toggleMute}
                disabled={!hasMedia}
                active={muted}
                ariaLabel={muted ? "Unmute mic" : "Mute mic"}
              >
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </CallAction>
              {isNative && (status === "connecting" || status === "connected") && (
                <CallAction
                  label="Speaker"
                  active={speakerOn}
                  ariaLabel={speakerOn ? "Speaker on" : "Speaker off"}
                  onClick={async () => {
                    const next = !speakerOn;
                    setSpeakerOn(next);
                    // eslint-disable-next-line no-console
                    console.log("[call] speaker toggle →", next);
                    try {
                      await nativeSetSpeaker(next);
                    } catch (err) {
                      // eslint-disable-next-line no-console
                      console.warn("[call] speaker toggle failed", err);
                      toast.error("Couldn't switch speaker");
                      setSpeakerOn(!next);
                    }
                  }}
                >
                  {speakerOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                </CallAction>
              )}
              {callType === "video" && (
                <CallAction
                  label={camOff ? "Cam on" : "Video"}
                  onClick={toggleCam}
                  disabled={!hasMedia}
                  active={camOff}
                  ariaLabel={camOff ? "Turn camera on" : "Turn camera off"}
                >
                  {camOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
                </CallAction>
              )}
              {(status === "connected" || status === "connecting") && (
                <CallAction
                  label="Share"
                  onClick={() => setShowAttach(true)}
                  ariaLabel="Share a file into the chat"
                  testId="call-attach"
                >
                  <Paperclip className="h-5 w-5" />
                </CallAction>
              )}
              {callType === "video" && (
                <CallAction
                  label="Filter"
                  active={callFilter !== "none"}
                  onClick={() => setFilterOpen((v) => !v)}
                  disabled={!hasMedia}
                  ariaLabel="Video filters"
                  testId="call-filter"
                >
                  <Wand2 className="h-5 w-5" />
                </CallAction>
              )}
              {(status === "connected" || status === "connecting") && (
                <CallAction
                  label="Add"
                  onClick={() => setShowAddPeople(true)}
                  ariaLabel="Add someone to this call"
                  testId="call-add-person"
                >
                  <UserPlus className="h-5 w-5" />
                </CallAction>
              )}
              <CallAction
                label="End"
                onClick={() => endEveryone(true)}
                tone="danger"
                ariaLabel="End call"
                testId="call-end"
              >
                <PhoneOff className="h-6 w-6" />
              </CallAction>
            </div>
          )}
        </div>
      </div>

      {/* Mid-call attachments: the same sheet the chat composer uses, sending
          into the same conversation this call lives in. */}
      <AttachmentSheet
        open={showAttach}
        surface="chat"
        context={attachCtx}
        onClose={() => setShowAttach(false)}
        onFiles={(_opt, files) => {
          setShowAttach(false);
          void sendCallAttachment(files);
        }}
        onSelect={() => {}}
      />

      {showAddPeople && (
        <AddPeopleSheet
          meId={meId}
          excludeIds={[...peerPoolRef.current.keys(), ...peerIdsRef.current]}
          onPick={(u) => {
            setShowAddPeople(false);
            ringUser(u.id, u.name);
          }}
          onClose={() => setShowAddPeople(false)}
        />
      )}
    </div>
  );
});

// One tile per remote peer. Renders <video> for video calls; avatar otherwise.
/** One labeled circular control in the call tray. */
function CallAction({
  label,
  onClick,
  children,
  ariaLabel,
  testId,
  tone,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  ariaLabel: string;
  testId?: string;
  /** danger = red (End/Decline), success = green (Answer). Default is glass. */
  tone?: "danger" | "success";
  /** Toggles render filled-white when engaged, like the reference dialers. */
  active?: boolean;
  disabled?: boolean;
}) {
  const circle =
    tone === "danger"
      ? "bg-red-500 hover:bg-red-400 text-white"
      : tone === "success"
        ? "bg-emerald-500 hover:bg-emerald-400 text-white"
        : active
          ? "bg-white text-black"
          : "bg-white/10 hover:bg-white/20 text-white";
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="group flex w-16 flex-col items-center gap-1.5 disabled:opacity-40"
    >
      <span
        className={`grid h-14 w-14 place-items-center rounded-full shadow-lg transition group-active:scale-95 ${circle}`}
      >
        {children}
      </span>
      <span className="text-[11px] text-white/70">{label}</span>
    </button>
  );
}

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

  /**
   * Make the peer audibly louder than the element alone can.
   *
   * An <audio> element caps at volume 1.0, and on Android the WebView hands
   * that to the media stream at a level that is genuinely too quiet to hold a
   * conversation. A compressor plus makeup gain lifts quiet speech without
   * clipping the loud parts — the compressor is what stops "louder" becoming
   * "distorted", so it is not optional here.
   *
   * FAIL-SAFE ORDERING IS THE WHOLE DESIGN. The element keeps playing until a
   * running AudioContext exists; only then is it muted, so the graph is the
   * single path. If the context never starts — autoplay policy, an OEM
   * WebView, anything — nothing is muted and the user still hears the call at
   * the old volume. Silence is the one outcome this must never produce.
   */
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !tile.stream) return;
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;

    let ctx: AudioContext | null = null;
    let cancelled = false;
    let unlock: (() => void) | null = null;

    try {
      ctx = new Ctx();
      const source = ctx.createMediaStreamSource(tile.stream);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30;
      comp.knee.value = 24;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      const gain = ctx.createGain();
      // 3.6x, up from 2.4 — still reported quiet at 2.4 on real hardware. The
      // compressor above (8:1 above -30dB) is doing the work that keeps this
      // from clipping: peaks are pinned before the makeup gain sees them, so
      // the number that rises is the floor, not the ceiling.
      gain.gain.value = 3.6;
      source.connect(comp);
      comp.connect(gain);
      gain.connect(ctx.destination);
    } catch {
      try {
        ctx?.close();
      } catch {
        /* ignore */
      }
      return;
    }

    const engage = () => {
      if (cancelled || !ctx) return;
      void ctx
        .resume()
        .then(() => {
          // Only now is it safe to hand sound over to the graph.
          if (!cancelled && ctx?.state === "running") el.muted = true;
        })
        .catch(() => {});
    };
    engage();
    if (ctx.state !== "running") {
      unlock = () => engage();
      window.addEventListener("pointerdown", unlock, true);
    }

    return () => {
      cancelled = true;
      if (unlock) window.removeEventListener("pointerdown", unlock, true);
      // Give sound back to the element before tearing the graph down, or a
      // re-render would land on a muted element with nothing feeding it.
      el.muted = false;
      try {
        void ctx?.close();
      } catch {
        /* ignore */
      }
    };
  }, [tile.stream]);

  const mono = (tile.peerName || "?").charAt(0).toUpperCase();
  const connecting = tile.connState !== "connected";
  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-black/60">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      {showVideo ? (
        // MUTED ON PURPOSE. The same MediaStream is attached to this <video>
        // and to the <audio> above; if both play it, the peer's voice is
        // decoded twice a few ms apart and comb-filters against itself —
        // which sounds thin and far away, not twice as loud. The <audio>
        // element owns sound so one element owns gain and routing.
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full bg-black object-cover"
        />
      ) : (
        <div className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground">
          {mono}
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs">
        {tile.peerName || "…"}
        {connecting ? " · connecting…" : ""}
      </div>
    </div>
  );
}

/* ---------------- Add people mid-call ----------------
   Conference by addition: search anyone by name or username and ring them
   straight into the live mesh. Membership of the conversation is not
   required — the invite carries the live callId over their personal ring
   channel, and their accept joins this call's mesh like any other peer. */
function AddPeopleSheet({
  meId,
  excludeIds,
  onPick,
  onClose,
}: {
  meId: string | null | undefined;
  excludeIds: string[];
  onPick: (u: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<
    {
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = window.setTimeout(() => {
      void supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(10)
        .then(({ data }) => {
          if (cancelled) return;
          setBusy(false);
          const skip = new Set([meId, ...excludeIds]);
          setRows(((data ?? []) as typeof rows).filter((r) => !skip.has(r.id)));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // excludeIds is a fresh array each render of the parent; depending on it
    // would re-fire every search — the set only matters at pick time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, meId]);

  return (
    <div
      data-full-bleed
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/70"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] rounded-t-3xl border-t border-white/10 bg-[#12141c] p-5 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Add to call</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-white/50" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or @username"
            autoFocus
            className="w-full bg-transparent text-sm placeholder:text-white/40 focus:outline-none"
          />
        </div>
        <div className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
          {rows.map((r) => {
            const name = r.display_name || r.username || "user";
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick({ id: r.id, name })}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/5"
              >
                {r.avatar_url ? (
                  <img src={r.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm font-bold">
                    {name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{name}</span>
                  {r.username && (
                    <span className="block truncate text-xs text-white/50">@{r.username}</span>
                  )}
                </span>
                <UserPlus className="h-4 w-4 shrink-0 text-white/60" />
              </button>
            );
          })}
          {q.trim().length >= 2 && rows.length === 0 && !busy && (
            <div className="py-6 text-center text-xs text-white/50">nobody found</div>
          )}
        </div>
      </div>
    </div>
  );
}
