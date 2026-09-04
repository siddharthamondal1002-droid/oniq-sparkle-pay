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
import { VOICE_TTS_DIRECT } from "./modelRegistry.ts";

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
