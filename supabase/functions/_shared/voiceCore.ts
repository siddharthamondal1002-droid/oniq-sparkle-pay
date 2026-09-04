/**
 * VOICE — the pure half, so the guards can be unit-tested without a network.
 *
 * Owner reference 2026-09-04 drew Voice as a live Create card. The engine it
 * runs on is not new: ONIQ has read story narration through the Lovable
 * gateway since 2026-08-14, and the id moved with the owner's model mapping.
 * What was missing was a screen and the guards a user-facing, money-spending
 * button needs.
 *
 * WHAT THIS SCREEN IS NOT. The Create card's hint reads "Speak / Clone /
 * Translate". Only SPEAK ships: cloning a voice from a sample is a consent and
 * likeness question before it is an engineering one, and translation belongs
 * to the text path. A card that offers three things and does one is worse than
 * a card that does one.
 */
import { TEXT_DIRECT_STANDARD, VOICE_TTS_DIRECT } from "./modelRegistry.ts";

/**
 * The id Create — Voice calls, DIRECT on Google.
 *
 * Owner directive 2026-09-04b. Unprefixed: the gateway's id for the same
 * model is `google/gemini-3.1-flash-tts-preview` and 404s on the direct
 * endpoint. Taken from the registry so the id and the measurement that
 * justifies it stay in one place.
 */
export const VOICE_MODEL = VOICE_TTS_DIRECT.id;

/**
 * AUDIO IN AND OUT ARE DIFFERENT MODELS, and conflating them was a mistake
 * this comment exists to stop being repeated.
 *
 * A first probe attached audio to the TTS model, got
 * 400 "Audio input modality is not enabled for this model", and concluded
 * — wrongly — that ONIQ could not offer
 * "attach audio" at all. That was wrong, and the owner said so. The TTS model
 * speaks; it does not listen. ORDINARY GEMINI LISTENS. Re-probed 2026-09-04,
 * inlineData audio/wav plus "Transcribe this audio exactly":
 *
 *   gemini-3.1-flash-lite   200,   818 bytes, text back
 *   gemini-3.6-flash        200, 3,619 bytes, text back
 *   gemini-3.1-pro-preview  200, 2,117 bytes, text back
 *
 * So attaching a recording IS offerable — for transcription and translation,
 * which is what the reference's "Voice Input" and "Translate" tabs are. It
 * routes to a text model, not to this one.
 *
 * WHAT IS STILL NOT AVAILABLE, measured rather than assumed:
 *
 * - Speaking in a voice from a sample (cloning). `customVoiceConfig` and its
 *   `customVoiceSample` subfield ARE REAL — they parse, where a made-up name
 *   is rejected as `Unknown name "…": Cannot find field` — but a real wav in
 *   them returns a generic 400 "Request contains an invalid argument". The
 *   field exists and this key is not admitted to it. So it is gated, not
 *   missing, and re-probing later is worth it. Separately, cloning is a
 *   consent and likeness question before it is an engineering one.
 * - Live, streaming voice. gemini-3.5-transcribe-live,
 *   gemini-3.5-live-translate-preview and the gemini-2.5-flash-native-audio
 *   family exist and support ONLY `bidiGenerateContent` — a WebSocket, not
 *   REST. Reachable, but a different transport than anything ONIQ speaks
 *   today.
 */
export const VOICE_TTS_ACCEPTS_AUDIO_INPUT = false;

/** Attaching a recording works — through a TEXT model. See above. */
export const AUDIO_UNDERSTANDING_MODEL = TEXT_DIRECT_STANDARD.id;

/** What a person can attach to be transcribed, and the ceiling on it. */
export const TRANSCRIBE_MIMES = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
] as const;

/**
 * 8 MB decoded. Gemini bills audio input per second, so the real limiter is
 * length rather than bytes; this is the crude guard that stops a crafted body,
 * and the per-user cap is what bounds cost. Checked on DECODED length, for the
 * same reason the image reference is: base64 is 4/3 of what it carries.
 */
export const TRANSCRIBE_MAX_BYTES = 8 * 1024 * 1024;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Returns why an attached recording cannot be sent, or null when it can. */
export function validateAudioAttachment(att: unknown): string | null {
  if (att === undefined || att === null) return null;
  if (typeof att !== "object") return "That recording could not be read.";
  const { mimeType, data } = att as { mimeType?: unknown; data?: unknown };
  if (typeof mimeType !== "string" || typeof data !== "string") {
    return "That recording could not be read.";
  }
  // The browser tags a MediaRecorder blob with codecs, e.g.
  // "audio/webm;codecs=opus". Compare the type only.
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (!(TRANSCRIBE_MIMES as readonly string[]).includes(base)) {
    return "Attach an audio recording — WAV, MP3, M4A, WebM or Ogg.";
  }
  if (data.length === 0) return "That recording was empty.";
  if (data.startsWith("data:")) return "That recording could not be read.";
  if (!B64.test(data)) return "That recording could not be read.";
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decoded = Math.floor((data.length * 3) / 4) - padding;
  if (decoded > TRANSCRIBE_MAX_BYTES) return "That recording is too long. Under 8MB, please.";
  return null;
}

/**
 * The voices, and every one of them POST-verified.
 *
 * MEASURED 2026-09-04 on google/gemini-3.1-flash-tts-preview through the
 * gateway, one "Hello." each: all eight answered 200 with a RIFF/WAVE body,
 * 44,204-59,564 bytes. That is the whole claim being made here — these are
 * names this key can actually call, which is the rule CLAUDE.md states and the
 * reason llm.ts carries a table of ids that listed fine and 404'd on every
 * real call.
 *
 * NO DESCRIPTORS. The provider publishes a word for each voice's character,
 * and none of it was measured here, so none of it is written down as if it
 * were. A person picks a voice by hearing it, and every generation plays back
 * immediately — which is a better answer than eight adjectives nobody checked.
 *
 * Charon leads because it is the one with production history: it has been
 * story-voice's default narrator since the pipeline had a voice at all.
 */
export const VOICE_CHOICES = [
  "Charon",
  "Kore",
  "Puck",
  "Zephyr",
  "Aoede",
  "Fenrir",
  "Leda",
  "Orus",
] as const;

export type VoiceName = (typeof VOICE_CHOICES)[number];

/** The narrator ONIQ has always used, and the fallback for an unknown ask. */
export const DEFAULT_VOICE: VoiceName = "Charon";

/**
 * The caller's voice, or the default.
 *
 * An unrecognised name FALLS BACK rather than passing through: the request
 * body reaches a paid provider, and a name nobody verified is either a typo
 * that wastes a call or an unbounded string on the wire.
 */
export function resolveVoice(asked: unknown): VoiceName {
  return (VOICE_CHOICES as readonly string[]).includes(asked as string)
    ? (asked as VoiceName)
    : DEFAULT_VOICE;
}

/**
 * A paragraph, not a chapter — roughly 45 seconds of speech.
 *
 * TTS is billed per output audio token, so the text length IS the bill for one
 * call, and this is the only lever that bounds a single charge. The per-user
 * cap bounds how many charges; this bounds each one. story-voice's own ceiling
 * is 1200 because a narration line is written by ONIQ's planner and cannot run
 * away; a box a person types into can.
 */
export const VOICE_TEXT_MAX = 600;

/**
 * Returns an error message when the text cannot be read, or null when it can.
 *
 * Runs AFTER the caps and BEFORE the billable call, which is the order the
 * cost guard needs: rejected text must not consume a slot, and a slot must not
 * be consumed by a call that was never going to be made.
 */
export function validateVoiceText(text: string): string | null {
  if (!text) return "Type something to say.";
  if (text.length > VOICE_TEXT_MAX) {
    return `Keep it under ${VOICE_TEXT_MAX} characters.`;
  }
  return null;
}

/**
 * Sample rate out of "audio/L16;codec=pcm;rate=24000".
 *
 * Guessing would produce audio at the wrong speed, which reads as a strange
 * voice rather than as a bug — so an unstated rate is null and the caller
 * refuses rather than inventing 24000.
 */
export function rateOf(mime: string): number | null {
  const m = /rate=(\d+)/.exec(mime ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whether these bytes still need a container put on them. */
export function needsWavHeader(mime: string): boolean {
  return /audio\/l16|pcm/i.test(mime ?? "");
}

/**
 * Headerless 16-bit mono PCM, wrapped as a playable WAV.
 *
 * MIRRORS remotion/scripts/story-worker.mjs `wrapPcmAsWav`, and the bug it
 * exists to avoid is the same one: double-wrapping already-containered bytes
 * leaves an outer header that is still valid, so the file opens, the duration
 * is off by under a millisecond, and the only symptom is a click at the top of
 * every clip. Hence `needsWavHeader` gating this rather than always wrapping.
 */
export function wrapPcmAsWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(header, 0);
  out.set(pcm, 44);
  return out;
}
