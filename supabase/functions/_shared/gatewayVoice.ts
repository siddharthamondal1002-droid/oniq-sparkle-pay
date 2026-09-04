// gatewayVoice — the Lovable-gateway speech engine, in one place.
//
// WRITTEN 2026-09-04 alongside voice-generate, the Create Voice screen — the
// second caller of a TTS id that until now lived only inside story-voice.
// gatewayImage.ts is the same shape for the same reason.
//
// STORY-VOICE STILL HOLDS ITS OWN COPY, deliberately. Importing from here
// would be the tidier diff, and it would also mean redeploying the Story
// pipeline's voice stage to move a constant — production risk bought with no
// user-visible gain. So the copies are held together by a TEST instead:
// src/lib/__tests__/voiceCore.test.ts asserts story-voice's local id, URL and
// body shape still match this file, and fails the moment either side moves.
// When story-voice next needs a deploy for its own reasons, fold it in then.
//
// WHOSE MONEY. Lovable credits — the same pool story-still and story-voice
// already spend, and the route the 2026-09-04 owner mapping put every model on
// except music.

/** Where the gateway serves speech. */
export const GATEWAY_VOICE_URL = "https://ai.gateway.lovable.dev/v1/audio/speech";

/**
 * The model. Mirrored in modelRegistry.ts as VOICE_TTS — the registry is the
 * place that carries lifecycle and capability, this constant is what goes on
 * the wire.
 *
 * MOVED 2026-09-04 by owner directive (the Google model mapping) from
 * `google/gemini-2.5-flash-tts`. The owner's "Gemini 3.1 Flash TTS"; the
 * gateway's id for it carries the -preview suffix and there is no unsuffixed
 * variant in its catalogue, so preview is what ONIQ can actually call.
 *
 * POST-VERIFIED before landing, on the exact body story-voice already sent:
 * 200 with a RIFF/WAVE, PCM 16-bit mono 24 kHz, ~46 KB for one word. The
 * envelope needed no change — that file had already learned that the OpenAI
 * input/voice fields fail here and had already moved to Google's native
 * contents + speechConfig shape, and the prebuilt voice names ride unchanged.
 *
 * PREVIEW IS A RISK AND IS NOT A MOVING ALIAS. It can be withdrawn without a
 * deprecation window; what it cannot do is change under ONIQ silently, the
 * way `-latest` would. The registry carries status/shutdownOn for it.
 */
export const GATEWAY_VOICE_MODEL = "google/gemini-3.1-flash-tts-preview";

/**
 * The request body, built in one place so both callers send the same shape.
 *
 * MEASURED FROM THE LIVE 400, not the docs: for google/*-tts the gateway
 * PASSES THROUGH Google's own body — it rejected the OpenAI input/voice
 * fields with Google's "Unknown name" error. So this is the pre-reroute
 * Gemini body verbatim, plus `model` for routing.
 */
export function voiceRequestBody(text: string, voice: string): string {
  return JSON.stringify({
    model: GATEWAY_VOICE_MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
}

/**
 * The first inline audio part of a Google-shaped reply, if there is one.
 * The mime (e.g. "audio/L16;codec=pcm;rate=24000") carries the sample rate a
 * WAV wrap needs, so it passes through un-normalized.
 */
export function firstInlineAudio(data: unknown): { mime: string; data: string } | null {
  const parts = (data as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
    if (inline?.data && typeof inline.data === "string") {
      return { mime: inline.mimeType ?? "audio/L16;rate=24000", data: inline.data };
    }
  }
  return null;
}
