// WebAudio-generated ring tones + vibration + notification helpers for calls.
// Autoplay-safe: all .play/resume calls are best-effort; failures are silent.

export type RingtoneId = "classic" | "synth" | "arcade" | "minimal";
export type PingId = "chime" | "pop" | "blip" | "soft";

export const RINGTONES: { id: RingtoneId; label: string; emoji: string }[] = [
  { id: "classic", label: "classic", emoji: "☎️" },
  { id: "synth", label: "synth", emoji: "🌊" },
  { id: "arcade", label: "arcade", emoji: "🕹" },
  { id: "minimal", label: "minimal", emoji: "🔔" },
];

export const PINGS: { id: PingId; label: string; emoji: string }[] = [
  { id: "chime", label: "chime", emoji: "🎐" },
  { id: "pop", label: "pop", emoji: "💧" },
  { id: "blip", label: "blip", emoji: "📟" },
  { id: "soft", label: "soft", emoji: "🌙" },
];

const LS_RING = "oniq.sounds.ringtone";
const LS_PING = "oniq.sounds.ping";

export function getSelectedRingtone(): RingtoneId {
  try {
    const v = localStorage.getItem(LS_RING) as RingtoneId | null;
    if (v && RINGTONES.some((r) => r.id === v)) return v;
  } catch {}
  return "classic";
}

export function setSelectedRingtone(id: RingtoneId) {
  try { localStorage.setItem(LS_RING, id); } catch {}
}

export function getSelectedPing(): PingId {
  try {
    const v = localStorage.getItem(LS_PING) as PingId | null;
    if (v && PINGS.some((p) => p.id === v)) return v;
  } catch {}
  return "chime";
}

export function setSelectedPing(id: PingId) {
  try { localStorage.setItem(LS_PING, id); } catch {}
}

type Tone = {
  ctx: AudioContext;
  timer: number | null;
  vibTimer: number | null;
  stopped: boolean;
};

let currentTone: Tone | null = null;

function stopTone(tone: Tone | null) {
  if (!tone) return;
  tone.stopped = true;
  if (tone.timer) {
    clearInterval(tone.timer);
    tone.timer = null;
  }
  if (tone.vibTimer) {
    clearInterval(tone.vibTimer);
    tone.vibTimer = null;
  }
  try {
    tone.ctx.close();
  } catch {}
}

export function stopAllCallSounds() {
  stopTone(currentTone);
  currentTone = null;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(0);
    }
  } catch {}
}

function playBeep(
  ctx: AudioContext,
  freqs: number[],
  durationMs: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const now = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  g.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.connect(g);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.05);
  }
}

type RingPattern = {
  intervalMs: number;
  play: (ctx: AudioContext, tone: Tone) => void;
};

const PATTERNS: Record<RingtoneId, RingPattern> = {
  classic: {
    intervalMs: 2000,
    play: (ctx, tone) => {
      playBeep(ctx, [880], 400, 0.2, "sine");
      window.setTimeout(() => { if (!tone.stopped) playBeep(ctx, [660], 400, 0.2, "sine"); }, 500);
    },
  },
  synth: {
    intervalMs: 2200,
    play: (ctx, tone) => {
      playBeep(ctx, [523.25, 659.25], 500, 0.14, "sawtooth");
      window.setTimeout(() => { if (!tone.stopped) playBeep(ctx, [783.99], 700, 0.14, "sawtooth"); }, 550);
    },
  },
  arcade: {
    intervalMs: 1600,
    play: (ctx, tone) => {
      playBeep(ctx, [1046.5], 120, 0.18, "square");
      window.setTimeout(() => { if (!tone.stopped) playBeep(ctx, [1318.5], 120, 0.18, "square"); }, 150);
      window.setTimeout(() => { if (!tone.stopped) playBeep(ctx, [1568], 200, 0.18, "square"); }, 300);
    },
  },
  minimal: {
    intervalMs: 2600,
    play: (ctx) => {
      playBeep(ctx, [1200], 90, 0.16, "triangle");
    },
  },
};

const PING_PATTERNS: Record<PingId, (ctx: AudioContext) => void> = {
  chime: (ctx) => {
    playBeep(ctx, [1318.5, 1760], 220, 0.12, "sine");
  },
  pop: (ctx) => {
    playBeep(ctx, [660], 80, 0.18, "square");
  },
  blip: (ctx) => {
    playBeep(ctx, [880], 60, 0.14, "sawtooth");
    setTimeout(() => playBeep(ctx, [1320], 60, 0.14, "sawtooth"), 70);
  },
  soft: (ctx) => {
    playBeep(ctx, [523.25], 260, 0.10, "triangle");
  },
};

// Louder two-tone ring for incoming calls (~1s on, 1s off).
export function playRingtone(id?: RingtoneId) {
  stopAllCallSounds();
  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return;
  }
  ctx.resume?.().catch(() => {});
  const tone: Tone = { ctx, timer: null, vibTimer: null, stopped: false };
  currentTone = tone;

  const pattern = PATTERNS[id ?? getSelectedRingtone()] ?? PATTERNS.classic;
  const ring = () => {
    if (tone.stopped) return;
    try { pattern.play(ctx, tone); } catch {}
  };
  ring();
  tone.timer = window.setInterval(ring, pattern.intervalMs);

  // Vibration loop (feature-detect).
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      const vib = () => { try { navigator.vibrate([400, 200, 400]); } catch {} };
      vib();
      tone.vibTimer = window.setInterval(vib, 1200);
    }
  } catch {}
}

// Softer ringback (caller side) — single 440Hz pulse every 3s.
export function playRingback() {
  stopAllCallSounds();
  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return;
  }
  ctx.resume?.().catch(() => {});
  const tone: Tone = { ctx, timer: null, vibTimer: null, stopped: false };
  currentTone = tone;

  const beep = () => {
    if (tone.stopped) return;
    try { playBeep(ctx, [440], 800, 0.08); } catch {}
  };
  beep();
  tone.timer = window.setInterval(beep, 3000);
}

// One-shot chat/notification ping using the selected ping sound.
export function playPing(id?: PingId) {
  const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return;
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return; }
  ctx.resume?.().catch(() => {});
  try {
    (PING_PATTERNS[id ?? getSelectedPing()] ?? PING_PATTERNS.chime)(ctx);
  } catch {}
  // Auto-close after a short window so we don't leak AudioContexts.
  setTimeout(() => { try { void ctx.close(); } catch {} }, 900);
}

// Ask once, remember result at module scope.
let notifPermRequested = false;
export function ensureNotificationPermission(): void {
  if (notifPermRequested) return;
  notifPermRequested = true;
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {}
}

// Best-effort: only fires when the app is alive but the tab is hidden.
// Closed-app push notifications require the native Capacitor build.
export async function showIncomingNotification(callId: string, fromName: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    await reg.showNotification("Incoming call 📞", {
      body: `${fromName} is calling…`,
      tag: callId,
      renotify: true,
      requireInteraction: true,
      data: { url: "/app/chat" },
    } as NotificationOptions);
  } catch {}
}
