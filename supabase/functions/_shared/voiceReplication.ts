/**
 * VOICE REPLICATION — Google's real two-step flow, the pure half.
 *
 * OWNER DIRECTIVE, 2026-09-04d. The owner supplied Google's documentation for
 * Gemini-TTS Voice Replication, and it corrected a wrong conclusion of mine:
 * I had probed generativelanguage.googleapis.com, found nothing, and called
 * the feature closed. IT IS ON A DIFFERENT HOST ENTIRELY.
 *
 *   Keys:      POST https://aiplatform.googleapis.com/v1beta1
 *                   /projects/{PROJECT}/locations/global/voices
 *   Synthesis: POST .../locations/global/publishers/google
 *                   /models/gemini-3.1-flash-tts-preview:generateContent
 *
 * MEASURED 2026-09-07, the first real POST to the Keys URL with the service
 * account: `404 NOT_FOUND: Method not found.` — nothing is bound to POST
 * there for oniq-309bd, while a GET IS bound (it 403s naming
 * aiplatform.voices.list). Google's public discovery document, revision
 * 20260831, lists no voices methods at all, but does publish
 * ReplicatedVoiceConfig { voiceSampleAudio, mimeType } inline in
 * generateContent — a ONE-step shape with no key and no consent field.
 * Whether the Keys surface is hidden behind the allowlist or simply not what
 * this project serves is undecided; read the 2026-09-07 entry in CLAUDE.md
 * before changing voicesUrl or building the one-step shape.
 *
 * That is VERTEX AI, not the Gemini API. It explains every failed probe: the
 * RPCs 404'd because they do not exist on that host, and the field is
 * `speech_config.voice_config.voice` — a plain string holding the key — not
 * the `customVoiceConfig` I was poking at.
 *
 * AUTH IS OAUTH2, NOT AN API KEY. `Authorization: Bearer <token>` plus an
 * `x-goog-user-project` header. That matches the measured 401 from
 * texttospeech.googleapis.com ("API keys are not supported by this API.
 * Expected OAuth2 access token"). ONIQ holds an API key, so this needs a
 * service account — a credential decision, recorded as the blocker rather
 * than as a dead end.
 *
 * IT IS ALSO AN ALLOWLISTED PREVIEW. Access is requested through a Google
 * form. So the capability is GATED twice over: the credential, then the
 * allowlist. Both are doors, and the UI says "Access required".
 *
 * THE CONSENT RECORDING IS THE POINT, not a formality. A person records a
 * fixed sentence saying they own the voice and agree to it being modelled,
 * and Google matches that recording against the script WORD FOR WORD. That is
 * what stops this being a tool for cloning somebody who never agreed, and it
 * is why the scripts below are treated as safety-critical data.
 *
 * This module is PURE — the scripts, the audio rules, the request bodies. No
 * network, so every rule here is unit-tested.
 */

/** The model that replicates. Same id as the prebuilt-voice path uses. */
export const REPLICATION_MODEL = "gemini-3.1-flash-tts-preview";

/** Vertex, not generativelanguage. The whole reason the first probe failed. */
export const VERTEX_HOST = "https://aiplatform.googleapis.com/v1beta1";

/** Where a key is minted. */
export function voicesUrl(projectId: string): string {
  return `${VERTEX_HOST}/projects/${encodeURIComponent(projectId)}/locations/global/voices`;
}

/** Where the key is then spoken with. */
export function replicatedSynthesisUrl(projectId: string): string {
  return (
    `${VERTEX_HOST}/projects/${encodeURIComponent(projectId)}/locations/global` +
    `/publishers/google/models/${REPLICATION_MODEL}:generateContent`
  );
}

/**
 * A KEY LIVES SEVEN DAYS. Google's own note, and the response carries
 * `expire_time`. A stored key that outlives it fails at synthesis with
 * nothing to explain why, so anything that keeps one has to keep the expiry
 * beside it and re-mint rather than retry.
 */
export const KEY_TTL_DAYS = 7;

/**
 * THE CONSENT SCRIPTS, and five are DELIBERATELY ABSENT.
 *
 * Google matches the consent recording against these word for word; any
 * deviation fails key generation. That makes them safety-critical data, and
 * the source they were transcribed from had CORRUPTION IN IT — characters
 * from the wrong writing system inside five of the phrases, verified by
 * checking every letter's Unicode script against the language's own:
 *
 *   Amharic   Cyrillic  'а', 'р'   inside an Ethiopic sentence
 *   Armenian  Georgian  'დეილმო'   and Telugu 'క'
 *   Odia      Bengali   'ল'
 *   Punjabi   Sinhala   'ව'
 *   Swahili   Cyrillic  'а', 'в'   inside a Latin sentence
 *
 * Those five are NOT included. A corrupted script cannot match a person
 * reading the real sentence, so shipping one would offer a language in which
 * the feature can never succeed, failing at the last step with a validation
 * error nobody could act on. Better to offer eleven languages that work than
 * sixteen of which five silently do not. They go back in when the exact text
 * is confirmed from a clean source.
 *
 * `voiceReplication.test.ts` re-runs that script check over every entry here,
 * so a future addition cannot reintroduce the same fault.
 */
export const CONSENT_SCRIPTS: Record<string, string> = {
  en: "I am the owner of this voice and have consented to the creation of a synthetic model of my voice through the use of Google Cloud.",
  hi: "मैं इस आवाज का स्वामी हूं और मैंने Google क्लाउड के उपयोग के माध्यम से अपनी आवाज का कृत्रिम मॉडल बनाने की सहमति दी है।",
  bn: "আমি এই কণ্ঠস্বরের মালিক এবং গুগল ক্লাউড ব্যবহারের মাধ্যমে আমার কণ্ঠস্বরের একটি কৃত্রিম মডেল তৈরিতে সম্মতি দিয়েছি।",
  ta: "இந்தக் குரலின் உரிமையாளர் நானே, மேலும் கூகிள் கிளவுடைப் பயன்படுத்தி எனது குரலின் செயற்கை மாதிரியை உருவாக்குவதற்கும் நான் ஒப்புதல் அளித்துள்ளேன்.",
  te: "ఈ స్వరానికి నేను యజమానిని మరియు గూగుల్ క్లౌడ్‌ను ఉపయోగించి నా స్వరం యొక్క కృత్రిమ నమూనాను రూపొందించడానికి నేను సమ్మతించాను.",
  mr: "मी या आवाजाचा मालक आहे आणि गूगल क्लाउडचा वापर करून माझ्या आवाजाचे कृत्रिम मॉडेल तयार करण्यास मी संमती दिली आहे।",
  gu: "હું આ અવાજનો માલિક છું અને ગૂગલ ક્લાઉડના ઉપયોગ દ્વારા મારા અવાજનું સિન્થેટિક મોડેલ બનાવવા માટે સંમતિ આપી છે.",
  kn: "ನಾನು ಈ ಧ್ವನಿಯ ಮಾಲೀಕ ಮತ್ತು Google Cloud ಬಳಕೆಯ ಮೂಲಕ ನನ್ನ ಧ್ವನಿಯ ಸಂಶ್ಲೇಷಿತ ಮಾದರಿಯನ್ನು ರಚಿಸಲು ಸಮ್ಮತಿಸಿದ್ದೇನೆ.",
  ml: "ഈ ശബ്ദത്തിന്റെ ഉടമ ഞാനാണ്, Google ക്ലൗഡ് ഉപയോഗിച്ച് എന്റെ ശബ്ദത്തിന്റെ ഒരു സിന്തറ്റിക് മോഡൽ സൃഷ്ടിക്കാൻ ഞാൻ സമ്മതം നൽകിയിട്ടുണ്ട്.",
  ur: "میں اس آواز کا مالک ہوں اور میں نے گوگل کلاؤڈ کے استعمال کے ذریعے اپنی آواز کا مصنوعی ماڈل بنانے کے لیے رضامندی دی ہے۔",
  si: "මම මෙම හඬෙහි හිමිකරු වන අතර Google Cloud භාවිතය හරහා මගේ හඬෙහි කෘතිම ආකෘතියක් නිර්මාණය කිරීමට කැමැත්ත පළ කර ඇත්තෙමි.",
};

/**
 * The languages whose script was corrupt in the source, kept as a list so the
 * omission is a recorded decision rather than an oversight somebody "fixes"
 * by pasting the same broken text back in.
 */
export const CONSENT_SCRIPTS_WITHHELD = ["am", "hy", "or", "pa", "sw"] as const;

/** The consent sentence for a language, or null when ONIQ does not have it. */
export function consentScript(lang: string): string | null {
  return CONSENT_SCRIPTS[(lang ?? "").toLowerCase().split("-")[0]] ?? null;
}

/* ===========================================================================
 * THE AUDIO RULES. Google's, restated as checks that run BEFORE the upload —
 * a sample rejected after a multi-megabyte round trip wastes the person's
 * time and a paid call.
 * ======================================================================== */

/** Both files: little-endian LINEAR16, mono, 24 kHz. */
export const REQUIRED_SAMPLE_RATE = 24000;
export const REQUIRED_CHANNELS = 1;
export const REQUIRED_BITS = 16;

/** The reference sample. Longer is better quality, up to the ceiling. */
export const SOURCE_MIN_SECONDS = 10;
export const SOURCE_MAX_SECONDS = 30;

export type WavFacts = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** PCM format code; 1 is LINEAR16. */
  format: number;
  seconds: number;
};

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/**
 * Read a WAV header, or null when these bytes are not one.
 *
 * WALKS THE CHUNKS rather than assuming `fmt ` sits at byte 12. A WAV written
 * by a phone or by ffmpeg often carries a LIST/INFO chunk first, and a reader
 * that assumes the canonical 44-byte layout reports nonsense for a perfectly
 * valid file — which would show up as "wrong sample rate" on audio that is
 * fine.
 *
 * RIFF is little-endian by definition; a big-endian RIFX file is rejected
 * here rather than silently misread, which is the "little-endian" half of
 * Google's requirement.
 */
export function readWavFacts(bytes: Uint8Array): WavFacts | null {
  if (bytes.length < 12) return null;
  if (tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") return null;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataBytes = 0;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = tag(bytes, p);
    const size = u32(bytes, p + 4);
    const body = p + 8;
    if (id === "fmt " && body + 16 <= bytes.length) {
      fmt = {
        format: u16(bytes, body),
        channels: u16(bytes, body + 2),
        sampleRate: u32(bytes, body + 4),
        bits: u16(bytes, body + 14),
      };
    } else if (id === "data") {
      // A streamed WAV can carry size 0 or 0xFFFFFFFF; fall back to what is
      // actually present rather than reporting a nonsense duration.
      dataBytes = size > 0 && body + size <= bytes.length ? size : bytes.length - body;
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    p = body + size + (size % 2);
    if (size === 0) break;
  }
  if (!fmt || fmt.channels === 0 || fmt.sampleRate === 0 || fmt.bits === 0) return null;
  const bytesPerFrame = (fmt.bits / 8) * fmt.channels;
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bits,
    format: fmt.format,
    seconds: bytesPerFrame > 0 ? dataBytes / (fmt.sampleRate * bytesPerFrame) : 0,
  };
}

/**
 * Why this recording cannot be sent, or null when it can.
 *
 * `role` changes only the LENGTH rule: Google's 10-30s applies to the voice
 * sample. The consent recording is however long the sentence takes to read.
 *
 * Every message names the fix. "Invalid audio" tells somebody holding a phone
 * nothing they can act on.
 */
export function validateReplicationAudio(
  bytes: Uint8Array,
  role: "source" | "consent",
): string | null {
  const facts = readWavFacts(bytes);
  if (!facts) return "That file isn't a WAV recording.";
  if (facts.format !== 1) return "Record as uncompressed WAV (LINEAR16).";
  if (facts.bitsPerSample !== REQUIRED_BITS) return "Record in 16-bit WAV.";
  if (facts.channels !== REQUIRED_CHANNELS) return "Record in mono, not stereo.";
  if (facts.sampleRate !== REQUIRED_SAMPLE_RATE) {
    return `Record at ${REQUIRED_SAMPLE_RATE / 1000}kHz.`;
  }
  if (role === "source") {
    if (facts.seconds < SOURCE_MIN_SECONDS) {
      return `Speak for at least ${SOURCE_MIN_SECONDS} seconds.`;
    }
    if (facts.seconds > SOURCE_MAX_SECONDS) {
      return `Keep it under ${SOURCE_MAX_SECONDS} seconds.`;
    }
  } else if (facts.seconds < 1) {
    return "That recording is empty.";
  }
  return null;
}

/* ===========================================================================
 * THE TWO REQUEST BODIES, built here so their shape is testable without a
 * network and without a credential.
 * ======================================================================== */

/**
 * Step 1: mint a key from the sample and the consent recording.
 *
 * `store: false` — STATELESS, the key comes back to ONIQ and Google keeps
 * nothing. The alternative would leave a voice profile sitting in a Google
 * project, which is a data-retention decision nobody has taken; this way the
 * only copy of the key is the one ONIQ holds, and it expires in seven days on
 * its own.
 *
 * snake_case throughout: this is the Vertex REST surface, and it does NOT
 * accept the camelCase the Gemini API takes.
 */
export function replicationKeyBody(
  source: { mimeType: string; data: string },
  consent: {
    mimeType: string;
    data: string;
  },
): Record<string, unknown> {
  return {
    voice: {
      model: `models/${REPLICATION_MODEL}`,
      type: "REPLICATED",
      replicated: {
        source_audio: { mime_type: source.mimeType, data: source.data },
        consent_audio: { mime_type: consent.mimeType, data: consent.data },
      },
    },
    store: false,
  };
}

/**
 * Step 2: speak, in the replicated voice.
 *
 * The key goes in `speech_config.voice_config.voice` as a plain STRING. Not
 * `prebuiltVoiceConfig`, and not `customVoiceConfig` — that was the wrong
 * guess, and probing for it on the wrong host is what produced the "does not
 * exist" conclusion this file corrects.
 */
export function replicatedSpeechBody(
  text: string,
  voiceKey: string,
  languageCode: string,
): Record<string, unknown> {
  return {
    contents: { role: "user", parts: [{ text }] },
    generation_config: {
      response_modalities: ["AUDIO"],
      speech_config: {
        voice_config: { voice: voiceKey },
        language_code: languageCode,
      },
    },
  };
}

/** The key and its expiry, read out of Google's reply. */
export function readReplicationKey(data: unknown): { key: string; expiresAt: string } | null {
  const o = data as { key?: unknown; expire_time?: unknown; expireTime?: unknown };
  if (typeof o?.key !== "string" || !o.key) return null;
  // Google's REST replies carry expireTime; the docs' snake_case shows up on
  // some surfaces. Read both rather than losing the expiry to a naming style.
  const raw = o.expire_time ?? o.expireTime;
  const expiresAt =
    typeof raw === "string"
      ? raw
      : typeof raw === "number"
        ? new Date(raw * 1000).toISOString()
        : new Date(Date.now() + KEY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { key: o.key, expiresAt };
}

/** True when a stored key is past its expiry, or so close it is not worth using. */
export function keyExpired(expiresAt: string, nowMs: number = Date.now()): boolean {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return true;
  // A minute of slack: a key that expires mid-request fails with an error the
  // person cannot act on, and re-minting is cheap next to that.
  return t - nowMs < 60_000;
}
