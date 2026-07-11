import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Mic, MicOff, Phone, PhoneOff, Signal, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import {
  ensureNotificationPermission,
  playRingback,
  playRingtone,
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
};

// SDP munge: enable Opus in-band FEC and lift maxaveragebitrate on the opus
// fmtp line. Safe no-op when the SDP has no opus rtpmap/fmtp lines, and won't
// double-append params that are already present.
function mungeOpus(sdp: string): string {
  const rtpmap = sdp.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2/im);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const fmtpRe = new RegExp(`^a=fmtp:${pt} (.*)$`, "im");
  const fmtp = sdp.match(fmtpRe);
  if (!fmtp) return sdp;
  let params = fmtp[1];
  if (!/(^|;)\s*useinbandfec=/i.test(params)) params += ";useinbandfec=1";
  if (!/(^|;)\s*maxaveragebitrate=/i.test(params)) params += ";maxaveragebitrate=64000";
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
  const [showHud, setShowHud] = useState(false);
  const [hudLive, setHudLive] = useState<{
    route: string;
    rttMs: number;
    lossPct: number;
    jitterMs: number;
    kbpsIn: number;
    kbpsOut: number;
  } | null>(null);

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
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSrcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioGainNodeRef = useRef<GainNode | null>(null);
  const audioPipelineStreamIdRef = useRef<string | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const statsPrevRef = useRef<{
    ts: number;
    bytesIn: number;
    bytesOut: number;
    packetsLost: number;
    packetsReceived: number;
  } | null>(null);
  const statsAggRef = useRef<{
    samples: number;
    rttSum: number;
    rttMax: number;
    jitterSum: number;
    kbpsInSum: number;
    kbpsOutSum: number;
    lossPct: number;
    packetsLost: number;
    packetsReceived: number;
    route: string;
    codec: string;
    fec: boolean;
    connectedAt: number;
  } | null>(null);

  const remotePlayAttemptsRef = useRef(0);
  const remoteFallbackArmedRef = useRef(false);

  const teardownRemoteAudioPipeline = () => {
    try { audioSrcNodeRef.current?.disconnect(); } catch {}
    try { audioGainNodeRef.current?.disconnect(); } catch {}
    const ctx = audioCtxRef.current;
    if (ctx) {
      try { void ctx.close(); } catch {}
    }
    audioSrcNodeRef.current = null;
    audioGainNodeRef.current = null;
    audioCtxRef.current = null;
    audioPipelineStreamIdRef.current = null;
  };

  const ensureAudioCtx = (): AudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  };

  const resumeRemoteAudio = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  };

  // WebAudio pipeline as FALLBACK only — used when element playback fails
  // twice (mutes element to avoid double audio).
  const buildRemoteAudioPipeline = (stream: MediaStream) => {
    if (audioPipelineStreamIdRef.current === stream.id && audioCtxRef.current) return;
    if (audioPipelineStreamIdRef.current && audioPipelineStreamIdRef.current !== stream.id) {
      teardownRemoteAudioPipeline();
    }
    if (stream.getAudioTracks().length === 0) return;
    try {
      const ctx = ensureAudioCtx();
      if (!ctx) throw new Error("AudioContext unavailable");
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 1.35;
      src.connect(gain);
      gain.connect(ctx.destination);
      audioSrcNodeRef.current = src;
      audioGainNodeRef.current = gain;
      audioPipelineStreamIdRef.current = stream.id;
      ctx.resume?.().catch(() => {});
      if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
      if (remoteVideoRef.current) remoteVideoRef.current.muted = true;
      console.warn("[call] using WebAudio fallback for remote audio");
    } catch (err) {
      console.warn("[call] WebAudio fallback unavailable", err);
    }
  };

  // Try to play the remote element. On NotAllowedError, arm a one-shot
  // listener that retries playback on the next user gesture. After two
  // consecutive failures, fall back to the WebAudio pipeline.
  const tryPlayRemote = (stream: MediaStream) => {
    const el = remoteAudioRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1.0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).playsInline = true;
    const p = el.play();
    if (!p || typeof p.then !== "function") return;
    p.then(() => {
      remotePlayAttemptsRef.current = 0;
    }).catch((err: unknown) => {
      const name = (err as { name?: string })?.name ?? "PlayError";
      remotePlayAttemptsRef.current += 1;
      console.warn("[call] remote audio play() failed", name, remotePlayAttemptsRef.current);
      if (remotePlayAttemptsRef.current >= 2) {
        toast(`Audio blocked — tap the screen to hear (${name})`);
        buildRemoteAudioPipeline(stream);
      }
      if (!remoteFallbackArmedRef.current) {
        remoteFallbackArmedRef.current = true;
        const retry = () => {
          remoteFallbackArmedRef.current = false;
          window.removeEventListener("pointerdown", retry, true);
          window.removeEventListener("touchstart", retry, true);
          window.removeEventListener("keydown", retry, true);
          tryPlayRemote(stream);
          resumeRemoteAudio();
        };
        window.addEventListener("pointerdown", retry, true);
        window.addEventListener("touchstart", retry, true);
        window.addEventListener("keydown", retry, true);
      }
    });
  };
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

  const clearGraceTimer = () => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  };

  const releaseWakeLock = () => {
    const wl = wakeLockRef.current;
    wakeLockRef.current = null;
    if (wl && typeof wl.release === "function") {
      try { wl.release().catch(() => {}); } catch {}
    }
  };

  const acquireWakeLock = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav?.wakeLock?.request) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      }
    } catch {
      // best-effort; ignored on unsupported browsers
    }
  };

  const startStatsLoop = () => {
    if (statsIntervalRef.current) return;
    statsPrevRef.current = null;
    statsAggRef.current = {
      samples: 0, rttSum: 0, rttMax: 0, jitterSum: 0,
      kbpsInSum: 0, kbpsOutSum: 0, lossPct: 0,
      packetsLost: 0, packetsReceived: 0,
      route: "unknown", codec: "unknown", fec: false,
      connectedAt: Date.now(),
    };
    const tick = async () => {
      const pc = pcRef.current;
      const agg = statsAggRef.current;
      if (!pc || !agg) return;
      try {
        const report = await pc.getStats();
        let inbAudio: any = null, outAudio: any = null, remoteInb: any = null;
        let selectedPair: any = null, codecStat: any = null;
        const candidatesById = new Map<string, any>();
        const codecsById = new Map<string, any>();
        report.forEach((s: any) => {
          if (s.type === "inbound-rtp" && s.kind === "audio" && !s.isRemote) inbAudio = s;
          else if (s.type === "outbound-rtp" && s.kind === "audio" && !s.isRemote) outAudio = s;
          else if (s.type === "remote-inbound-rtp" && s.kind === "audio") remoteInb = s;
          else if (s.type === "candidate-pair" && (s.selected || s.nominated) && s.state === "succeeded") selectedPair = s;
          else if (s.type === "local-candidate" || s.type === "remote-candidate") candidatesById.set(s.id, s);
          else if (s.type === "codec") codecsById.set(s.id, s);
        });
        if (!selectedPair) {
          report.forEach((s: any) => {
            if (s.type === "transport" && s.selectedCandidatePairId) {
              const p = report.get(s.selectedCandidatePairId);
              if (p) selectedPair = p;
            }
          });
        }
        if (inbAudio?.codecId) codecStat = codecsById.get(inbAudio.codecId);
        else if (outAudio?.codecId) codecStat = codecsById.get(outAudio.codecId);

        const now = Date.now();
        const bytesIn = inbAudio?.bytesReceived ?? 0;
        const bytesOut = outAudio?.bytesSent ?? 0;
        const packetsLost = inbAudio?.packetsLost ?? 0;
        const packetsReceived = inbAudio?.packetsReceived ?? 0;
        let kbpsIn = 0, kbpsOut = 0;
        const prev = statsPrevRef.current;
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          if (dt > 0) {
            kbpsIn = ((bytesIn - prev.bytesIn) * 8) / 1000 / dt;
            kbpsOut = ((bytesOut - prev.bytesOut) * 8) / 1000 / dt;
          }
        }
        statsPrevRef.current = { ts: now, bytesIn, bytesOut, packetsLost, packetsReceived };

        const rttSec = selectedPair?.currentRoundTripTime ?? remoteInb?.roundTripTime ?? 0;
        const rttMs = Math.round(rttSec * 1000);
        const jitterMs = Math.round(((inbAudio?.jitter ?? 0) as number) * 1000);
        const totalPkts = packetsReceived + packetsLost;
        const lossPct = totalPkts > 0 ? (packetsLost / totalPkts) * 100 : 0;

        let route = "unknown";
        const local = selectedPair?.localCandidateId ? candidatesById.get(selectedPair.localCandidateId) : null;
        const remote = selectedPair?.remoteCandidateId ? candidatesById.get(selectedPair.remoteCandidateId) : null;
        const lct = local?.candidateType, rct = remote?.candidateType;
        if (lct === "relay" || rct === "relay") route = "Relay";
        else if (lct || rct) route = "P2P";
        agg.route = route;

        if (codecStat?.mimeType) agg.codec = String(codecStat.mimeType).replace("audio/", "");
        if (codecStat?.sdpFmtpLine) agg.fec = /useinbandfec=1/i.test(String(codecStat.sdpFmtpLine));

        agg.samples += 1;
        agg.rttSum += rttMs;
        if (rttMs > agg.rttMax) agg.rttMax = rttMs;
        agg.jitterSum += jitterMs;
        agg.kbpsInSum += kbpsIn;
        agg.kbpsOutSum += kbpsOut;
        agg.packetsLost = packetsLost;
        agg.packetsReceived = packetsReceived;
        agg.lossPct = lossPct;

        setHudLive({
          route,
          rttMs,
          lossPct: Math.round(lossPct * 10) / 10,
          jitterMs,
          kbpsIn: Math.round(kbpsIn),
          kbpsOut: Math.round(kbpsOut),
        });
      } catch {
        // getStats can throw during teardown; ignore
      }
    };
    void tick();
    statsIntervalRef.current = window.setInterval(tick, 3000);
  };

  const stopStatsLoop = () => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
  };

  const emitEndOfCallReport = () => {
    const agg = statsAggRef.current;
    statsAggRef.current = null;
    statsPrevRef.current = null;
    if (!agg) return;
    const durationMs = Date.now() - agg.connectedAt;
    if (durationMs < 10000 || agg.samples === 0) return;
    const avgRTT = Math.round(agg.rttSum / agg.samples);
    const avgJitter = Math.round(agg.jitterSum / agg.samples);
    const avgKbpsIn = Math.round(agg.kbpsInSum / agg.samples);
    const avgKbpsOut = Math.round(agg.kbpsOutSum / agg.samples);
    const lossPct = Math.round(agg.lossPct * 10) / 10;
    const summary = {
      route: agg.route,
      avgRTT,
      maxRTT: agg.rttMax,
      lossPct,
      avgJitterMs: avgJitter,
      avgKbpsIn,
      avgKbpsOut,
      codec: agg.codec,
      opusFec: agg.fec,
      durationSec: Math.round(durationMs / 1000),
      packetsLost: agg.packetsLost,
      packetsReceived: agg.packetsReceived,
    };
    // eslint-disable-next-line no-console
    console.log("[call-stats]", summary);
    toast(`Call: ${agg.route} · ${avgRTT}ms · ${lossPct}% loss · ${agg.codec}`);
  };

  const cleanupMedia = () => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    clearConnectTimeout();
    clearGraceTimer();
    stopStatsLoop();
    emitEndOfCallReport();
    setHudLive(null);
    stopUserRingBroadcast();
    stopAllCallSounds();
    releaseWakeLock();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    teardownRemoteAudioPipeline();
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    pendingIceRef.current = [];
    isCallerRef.current = false;
    activeRef.current = false;
    callIdRef.current = null;
    iceRestartsRef.current = 0;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setMuted(false);
    setCamOff(false);
    setElapsed(0);
  };

  const finishCall = (notifyPeer: boolean) => {
    // If a video call ends via the failure path, nudge the user to voice.
    if (notifyPeer && activeRef.current && callTypeRef.current === "video") {
      // No-op here; specific failure sites toast their own message.
    }
    if (notifyPeer && activeRef.current) sendSig("end");
    cleanupMedia();
    setStatus("ended");
    window.setTimeout(() => setStatus((s) => (s === "ended" ? "idle" : s)), 700);
  };

  const applyBitrateCaps = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      const kind = sender.track?.kind;
      if (!kind) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (kind === "video") {
          params.encodings[0].maxBitrate = 400_000;
          // Scale down if supported — reduces encoder load on weak devices.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (params.encodings[0] as any).scaleResolutionDownBy = 1.0;
        } else if (kind === "audio") {
          params.encodings[0].maxBitrate = 64_000;
        }
        await sender.setParameters(params);
      } catch {
        // some browsers reject mid-negotiation; ignore
      }
    }
  };

  const attemptIceRestart = async () => {
    const pc = pcRef.current;
    if (!pc || !isCallerRef.current || !activeRef.current) return;
    if (iceRestartsRef.current >= MAX_ICE_RESTARTS) return;
    if (pc.signalingState !== "stable") return;
    iceRestartsRef.current += 1;
    try {
      pc.restartIce();
      const offer = withMungedSdp(await pc.createOffer({ iceRestart: true }));
      await pc.setLocalDescription(offer);
      sendSig("offer", { sdp: offer });
    } catch {
      // If restart fails outright, let the grace timer decide.
    }
  };

  const handleTransientDrop = () => {
    if (!activeRef.current) return;
    if (graceTimerRef.current) return; // already in grace
    setStatus("reconnecting");
    // Caller drives ICE restart; callee just waits for the new offer.
    if (isCallerRef.current) {
      void attemptIceRestart();
    }
    graceTimerRef.current = window.setTimeout(() => {
      graceTimerRef.current = null;
      const pc = pcRef.current;
      if (!pc || !activeRef.current) return;
      if (pc.connectionState === "connected") return;
      if (callTypeRef.current === "video") {
        toast("Video too heavy for this network — try a voice call 🎙");
      }
      toast.error("Call dropped — network too weak 📶");
      finishCall(true);
    }, RECONNECT_GRACE_MS);
  };

  const createPc = () => {
    const pc = new RTCPeerConnection({ iceServers: cachedIceServers ?? FALLBACK_ICE_SERVERS, iceCandidatePoolSize: 4 });
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSig("ice", { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const incoming = e.streams[0];
      const stream = incoming ?? (() => {
        const s = remoteStreamRef.current ?? new MediaStream();
        if (!s.getTracks().find((x) => x.id === e.track.id)) s.addTrack(e.track);
        return s;
      })();
      remoteStreamRef.current = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      buildRemoteAudioPipeline(stream);
      resumeRemoteAudio();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        clearConnectTimeout();
        clearGraceTimer();
        setStatus("connected");
        void acquireWakeLock();
        if (!timerRef.current) {
          const started = Date.now();
          timerRef.current = window.setInterval(
            () => setElapsed(Math.floor((Date.now() - started) / 1000)),
            500,
          );
        }
        startStatsLoop();
      } else if (st === "disconnected") {
        handleTransientDrop();
      } else if (st === "failed") {
        if (activeRef.current) {
          if (callTypeRef.current === "video") {
            toast("Video too heavy for this network — try a voice call 🎙");
          }
          toast.error("Call dropped — network too weak 📶");
          finishCall(true);
        }
      } else if (st === "closed") {
        if (activeRef.current) finishCall(false);
      }
    };
    pc.oniceconnectionstatechange = () => {
      const ist = pc.iceConnectionState;
      if (ist === "disconnected") {
        handleTransientDrop();
      } else if (ist === "failed" && activeRef.current) {
        if (callTypeRef.current === "video") {
          toast("Video too heavy for this network — try a voice call 🎙");
        }
        toast.error("Call dropped — network too weak 📶");
        finishCall(true);
      } else if (ist === "connected" || ist === "completed") {
        clearGraceTimer();
      }
    };
    return pc;
  };

  const getMedia = async (type: CallType) => {
    try {
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
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
    stream.getTracks().forEach((t) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tt = t as any;
        if ("contentHint" in tt) {
          tt.contentHint = t.kind === "audio" ? "speech" : "motion";
        }
      } catch {
        // feature-detected; ignore
      }
      pcRef.current?.addTrack(t, stream);
    });
    // Fire-and-forget: bitrate caps must run after tracks are added.
    void applyBitrateCaps();
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
    resumeRemoteAudio();
    isCallerRef.current = true;
    callIdRef.current = genId();
    setCallTypeBoth(type);
    setStatus("outgoing");
    ensureNotificationPermission();
    playRingback();
    sendSig("ring", { callType: type, fromName: meName });
    sendPush({ conversation_id: conversationId, kind: "call", call_type: type });

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
        await ensureIceServers();
        pcRef.current = createPc();
        attachLocal(stream, callTypeRef.current);
        const offer = withMungedSdp(await pcRef.current.createOffer());
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
      const answer = withMungedSdp(await pcRef.current.createAnswer());
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
      resumeRemoteAudio();
      isCallerRef.current = false;
      callIdRef.current = acceptId;
      setCallTypeBoth(acceptType === "video" ? "video" : "audio");
      setIncomingFromName(peerName);
      setStatus("incoming");
      window.setTimeout(() => {
        setStatus("connecting");
        armConnectTimeout();
        getMedia(callTypeRef.current)
          .then(async (stream) => {
            await ensureIceServers();
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
    resumeRemoteAudio();
    try {
      const stream = await getMedia(callTypeRef.current);
      await ensureIceServers();
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
          : status === "reconnecting"
            ? "Reconnecting… 🔄"
            : status === "connected"
              ? `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`
              : "Call ended";

  const displayName = status === "incoming" ? incomingFromName : peerName;
  const monogram = (displayName || "?").charAt(0).toUpperCase();
  const showRemoteVideo = callType === "video" && (status === "connected" || status === "reconnecting");

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

      {showHud && hudLive && (
        <div className="absolute left-3 top-3 z-20 rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs font-mono leading-tight backdrop-blur-md">
          <div className="mb-1 text-white/60">{hudLive.route}</div>
          <div>
            RTT{" "}
            <span className={
              hudLive.rttMs > 500 ? "text-red-400"
              : hudLive.rttMs > 250 ? "text-amber-300"
              : "text-emerald-400"
            }>{hudLive.rttMs}ms</span>
          </div>
          <div>
            Loss{" "}
            <span className={
              hudLive.lossPct > 5 ? "text-red-400"
              : hudLive.lossPct > 2 ? "text-amber-300"
              : "text-emerald-400"
            }>{hudLive.lossPct}%</span>
          </div>
          <div>Jitter <span className="text-white/80">{hudLive.jitterMs}ms</span></div>
          <div className="text-white/80">↑{hudLive.kbpsOut} ↓{hudLive.kbpsIn} kbps</div>
        </div>
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

      {callType === "video" && (status === "connecting" || status === "connected" || status === "reconnecting") && (
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
              onClick={() => setShowHud((v) => !v)}
              className="grid h-14 w-14 place-items-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label={showHud ? "Hide stats" : "Show stats"}
              aria-pressed={showHud}
            >
              <Signal className="h-5 w-5" />
            </button>
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
