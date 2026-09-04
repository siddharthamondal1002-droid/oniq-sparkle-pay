/**
 * WHAT ONIQ CAN DO, AND WHY IT CANNOT DO THE REST.
 *
 * OWNER DIRECTIVE, 2026-09-04c. Given after a feature was labelled simply
 * "unavailable" when the truth was narrower and more useful:
 *
 *   "Do NOT label voice cloning simply as 'UNAVAILABLE'. Use:
 *    voice.clone -> GOOGLE -> Gated / Allowlisted"
 *
 * THE DISTINCTION THIS FILE EXISTS FOR. "We cannot do that" and "Google does
 * this, and this account is not admitted yet" are different facts with
 * different consequences, and collapsing them cost real ground: voice cloning
 * was written off as impossible when the API field is demonstrably REAL —
 * `customVoiceConfig` parses where a made-up sibling is rejected by name — and
 * the only thing missing is admission. A person told "unavailable" stops
 * asking. A person told "access required" knows there is a door.
 *
 * The four states, and the rule for each:
 *
 *   LIVE          Measured working end to end. Ships, and the UI offers it
 *                 without qualification.
 *   EXPERIMENTAL  Built and believed to work; not yet proven end to end on
 *                 production. May ship behind a flag; must not be described
 *                 to a person as finished.
 *   GATED         THE PROVIDER HAS IT. This account is not admitted. The UI
 *                 says so — "Access required", never "unavailable" — and the
 *                 capability is re-probed rather than deleted.
 *   CLOSED        The provider does not expose it on any surface reachable
 *                 from here. Measured, with the evidence recorded.
 *
 * EVERY ENTRY CARRIES ITS EVIDENCE, dated, in the words the endpoint used.
 * A state without evidence is an opinion, and this file is specifically the
 * cure for opinions hardening into architecture.
 */

export type CapabilityState = "LIVE" | "EXPERIMENTAL" | "GATED" | "CLOSED";

export type CapabilityId =
  | "image.generate"
  | "image.referenceImage"
  | "voice.speak"
  | "voice.transcribe"
  | "voice.translate"
  | "voice.clone"
  | "voice.realtime"
  | "music.generate"
  | "music.referenceAudio"
  | "music.referenceImage"
  | "text.generate"
  | "document.read";

export type CapabilityEntry = {
  id: CapabilityId;
  /** Who serves it. One word, because the UI must never name a provider. */
  provider: "google";
  state: CapabilityState;
  /**
   * WHAT A PERSON IS TOLD when this is not LIVE. Written for the person, not
   * the operator: it says what they can do about it, and it never says
   * "unavailable" for something that is merely GATED.
   */
  userMessage?: string;
  /** Measured, dated, in the endpoint's own words. Never a summary. */
  evidence: string;
};

export const CAPABILITIES: Record<CapabilityId, CapabilityEntry> = {
  "image.generate": {
    id: "image.generate",
    provider: "google",
    state: "LIVE",
    evidence:
      "2026-09-04: gemini-3.1-flash-image :generateContent with " +
      "responseModalities:['IMAGE'] -> 200, 3,329,851 bytes, inlineData image/jpeg.",
  },
  "image.referenceImage": {
    id: "image.referenceImage",
    provider: "google",
    state: "LIVE",
    evidence:
      "2026-09-04: the same id with an inlineData jpeg part BEFORE the text " +
      "('make the wall green') -> 200, 2,405,500 bytes, an edited picture back.",
  },

  "voice.speak": {
    id: "voice.speak",
    provider: "google",
    state: "LIVE",
    evidence:
      "2026-09-04: gemini-3.1-flash-tts-preview with speechConfig -> 200, " +
      "144,129 bytes, inlineData 'audio/l16; rate=24000; channels=1'. Without " +
      "speechConfig the same id returns 400 INVALID_ARGUMENT.",
  },
  "voice.transcribe": {
    id: "voice.transcribe",
    provider: "google",
    state: "EXPERIMENTAL",
    evidence:
      "2026-09-04: gemini-3.1-flash-lite / gemini-3.6-flash / " +
      "gemini-3.1-pro-preview each accepted inlineData audio/wav and returned " +
      "text (200 at 818 / 3,619 / 2,117 bytes). Built; not yet run end to end " +
      "through a deployed function by a real user, which is what LIVE means.",
  },
  "voice.translate": {
    id: "voice.translate",
    provider: "google",
    state: "EXPERIMENTAL",
    evidence:
      "Same path and same measurement as voice.transcribe, with a target language in the ask.",
  },
  "voice.clone": {
    id: "voice.clone",
    provider: "google",
    state: "GATED",
    // The exact wording the owner asked for. It is not "unavailable".
    userMessage: "Google Voice Replication — Access required",
    evidence:
      "THE FEATURE IS REAL AND ON A HOST ONIQ WAS NOT PROBING. Owner supplied " +
      "Google's documentation 2026-09-04d: replication lives on VERTEX AI, " +
      "POST aiplatform.googleapis.com/v1beta1/projects/{P}/locations/global/" +
      "voices to mint a key from a source sample plus a consent recording, " +
      "then .../publishers/google/models/gemini-3.1-flash-tts-preview" +
      ":generateContent with the key in speech_config.voice_config.voice. " +
      "That explains every earlier negative: those probes ran against " +
      "generativelanguage.googleapis.com, where the RPCs genuinely do not " +
      "exist, and looked for `customVoiceConfig` when the field is a plain " +
      "string called `voice`. The earlier 'no such surface' finding was " +
      "wrong, and is corrected here rather than quietly dropped. " +
      "TWO DOORS, BOTH SHUT: (1) auth is OAuth2 — measured, " +
      "texttospeech.googleapis.com answers 401 'API keys are not supported " +
      "by this API. Expected OAuth2 access token' — so it needs a SERVICE " +
      "ACCOUNT and a GOOGLE_CLOUD_PROJECT, which ONIQ does not hold; (2) it " +
      "is an allow-listed preview, requested through a Google form. Both are " +
      "owner decisions. The flow itself is built and unit-tested in " +
      "_shared/voiceReplication.ts, so admission is the only thing between " +
      "here and a working feature.",
  },
  "voice.realtime": {
    id: "voice.realtime",
    provider: "google",
    state: "CLOSED",
    userMessage: "Live voice needs a connection ONIQ doesn't open yet",
    evidence:
      "2026-09-04 ListModels: gemini-3.5-transcribe-live, " +
      "gemini-3.5-live-translate-preview and the gemini-2.5-flash-native-audio " +
      "family support ONLY `bidiGenerateContent` — a WebSocket. Reachable in " +
      "principle; not CLOSED at Google's end, closed at ONIQ's, which speaks " +
      "no bidi transport today. Re-state as EXPERIMENTAL the day one exists.",
  },

  "music.generate": {
    id: "music.generate",
    provider: "google",
    state: "LIVE",
    evidence:
      "2026-09-04: lyria text-only -> 200, 5,578,562 bytes, inlineData " +
      "audio/mpeg. Confirmed again as the control for the reference probe.",
  },
  "music.referenceAudio": {
    id: "music.referenceAudio",
    provider: "google",
    state: "EXPERIMENTAL",
    evidence:
      "TWO-STAGE, owner directive 2026-09-04c: the reference NEVER reaches " +
      "Lyria. Gemini listens to it and writes a structured music brief; Lyria " +
      "generates from that brief. Sending audio to Lyria directly is CLOSED " +
      "and stays closed — measured 2026-09-04 as 400 'Unsupported input mime " +
      "type for this model: audio/s16le', identically for wav and mp3, on " +
      "every lyria id, with a text-only control returning 200. The Gemini " +
      "half is measured (see voice.transcribe); the joined pipeline is not " +
      "yet proven end to end, which is why this is not LIVE.",
  },
  "music.referenceImage": {
    id: "music.referenceImage",
    provider: "google",
    state: "EXPERIMENTAL",
    evidence:
      "THE OWNER WAS RIGHT — Lyria takes an image. Measured 2026-09-04, a " +
      "256x256 PNG as an inlineData part before the text: " +
      "lyria-3-pro-preview -> 200, 5,215,484 bytes of audio/mpeg with lyrics " +
      "visibly derived from the picture; lyria-3-clip-preview -> 200, " +
      "994,461 bytes. Google billed it in promptTokensDetails as modality " +
      "IMAGE, 258 tokens, so it was read rather than ignored. The bare " +
      "lyria-3.5 returned 200 with NO audio on one sampling " +
      "(promptFeedback.blockReason PROHIBITED_CONTENT), which is why the " +
      "caller needs a refusal path. EXPERIMENTAL until it has run end to end " +
      "through the deployed function, not because the capability is in doubt.",
  },

  "text.generate": {
    id: "text.generate",
    provider: "google",
    state: "LIVE",
    evidence:
      "2026-09-04: gemini-3.1-flash-lite -> 200, 738 bytes; " +
      "gemini-3.1-pro-preview -> 200, 1,388 bytes.",
  },
  "document.read": {
    id: "document.read",
    provider: "google",
    state: "LIVE",
    evidence: "Images, PDFs and text files already reach the AI path from app.ai.tsx.",
  },
};

/** True only when the capability is proven end to end. */
export function isLive(id: CapabilityId): boolean {
  return CAPABILITIES[id].state === "LIVE";
}

/**
 * What to show a person for a capability that is not LIVE, or null when it is.
 *
 * NEVER the word "unavailable" for a GATED capability — that is the whole
 * point of the owner's directive. A gated feature has a door; the sentence
 * has to leave it visible.
 */
export function unavailableMessage(id: CapabilityId): string | null {
  const c = CAPABILITIES[id];
  if (c.state === "LIVE") return null;
  return c.userMessage ?? "Not ready yet.";
}
