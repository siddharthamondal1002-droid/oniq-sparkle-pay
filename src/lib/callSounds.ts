// WebAudio-generated ring tones + vibration + notification helpers for calls.
// Autoplay-safe: all .play/resume calls are best-effort; failures are silent.

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

function playBeep(ctx: AudioContext, freqs: number[], durationMs: number, gain: number) {
  const now = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  g.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.connect(g);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.05);
  }
}

// Louder two-tone ring for incoming calls (~1s on, 1s off).
export function playRingtone() {
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

  const ring = () => {
    if (tone.stopped) return;
    try {
      // Pleasant two-tone: 880Hz then 660Hz.
      playBeep(ctx, [880], 400, 0.18);
      window.setTimeout(() => {
        if (!tone.stopped) playBeep(ctx, [660], 400, 0.18);
      }, 500);
    } catch {}
  };
  ring();
  tone.timer = window.setInterval(ring, 2000);

  // Vibration loop (feature-detect).
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      const vib = () => {
        try {
          navigator.vibrate([400, 200, 400]);
        } catch {}
      };
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
    try {
      playBeep(ctx, [440], 800, 0.08);
    } catch {}
  };
  beep();
  tone.timer = window.setInterval(beep, 3000);
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
