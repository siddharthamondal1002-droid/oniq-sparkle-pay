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
  | "document.read"
  | "weather.current"
  | "air.current";

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
      "2026-09-04: the same call as voice.transcribe — gemini-3.1-flash-lite " +
      "with an inlineData audio/wav part, 200 — differing only in the " +
      "instruction, which names a target language. The instruction is built " +
      "server-side, never taken from the client: a caller who could send " +
      "their own text alongside audio would have an open prompt surface on a " +
      "paid model. EXPERIMENTAL for the same reason voice.transcribe is — " +
      "not yet run end to end through a deployed function.",
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
      "TWO DOORS. (1) THE CREDENTIAL, and this is settled rather than " +
      "suspected: three attempts against aiplatform — ?key=, an " +
      "x-goog-api-key header, and a plain GET — all returned 401 " +
      "UNAUTHENTICATED / CREDENTIALS_MISSING, 'API keys are not supported by " +
      "this API. Expected OAuth2 access token or other authentication " +
      "credentials that assert a principal.' It fires BEFORE any project or " +
      "allowlist check, so no arrangement of the key ONIQ holds will ever " +
      "work there. _shared/googleAuth.ts now mints a real OAuth2 token from " +
      "either a service-account JSON or an OAuth refresh token, so the code " +
      "side of this door is built; what is missing is which credential to " +
      "point it at. FIREBASE_SERVICE_ACCOUNT is already provisioned and is a " +
      "Google Cloud service-account key — a Firebase project IS a Cloud " +
      "project. Using it puts Vertex spend on that project's billing " +
      "account, so it was put to the owner rather than assumed, and OWNER " +
      "DIRECTIVE 2026-09-04e chose it: googleAuth.ts now authenticates as " +
      "that service account by default, with GOOGLE_VERTEX_USE_FIREBASE_SA " +
      "left as a kill switch that turns it off again without a deploy. So " +
      "door one is open. (2) THE ALLOWLIST is still shut: replication is a " +
      "preview requested through a Google form, and only the owner can " +
      "submit it. The flow itself is built and unit-tested in " +
      "_shared/voiceReplication.ts. " +
      "BUT 'ADMISSION IS THE ONLY THING LEFT' WAS WRONG, and it is corrected " +
      "here rather than quietly dropped — measured 2026-09-06, on the day an " +
      "owner asked why a person still cannot sing in their own voice. NO " +
      "DEPLOYED FUNCTION IMPORTS voiceReplication.ts: a grep for it across " +
      "supabase/functions/*/index.ts returns 0, and voice-generate's only " +
      "voice field is speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName " +
      "— a BUILT-IN voice, with no branch that could carry a minted key. So " +
      "the helpers are pure and unit-tested and nothing calls them. TWO " +
      "things stand between here and a working feature, not one: (a) Google " +
      "admitting ONIQ to the preview, which only the owner can request, and " +
      "(b) an endpoint that actually mints a key and passes it as `voice`. " +
      "(b) IS BUILT, 2026-09-06, on the day the owner asked what the problem " +
      "actually was: supabase/functions/voice-clone mints a key with " +
      "replicationKeyBody and speaks with replicatedSpeechBody, both " +
      "recordings validated before the billable call, admin-only because " +
      "Vertex replication spends the METERED Google key and the caps and " +
      "price are the owner's to set. AND THE PROBE VERB WAS WRONG THE WHOLE " +
      "TIME. Every measurement of this blocker was a GET of " +
      ".../locations/global/voices — a LIST — refused as 'aiplatform.voices" +
      ".list denied'. Minting is a POST to that same path and needs a " +
      "different permission, so not one probe ever tested the call the " +
      "feature makes. This repo's own first rule is that a catalogue says " +
      "what exists and only a POST says what this key may call, and the " +
      "voice work spent days ignoring it. So what remains is (a) alone, and " +
      "it is ANSWERABLE now rather than assumed: the first real POST returns " +
      "Google's own words, and a missing IAM role, an allowlist refusal and " +
      "a disabled API all arrive as 403 with only the text to separate them. " +
      "The lesson is the recurring one in this repo: a claim about what " +
      "remains has a shelf life, and 'built and unit-tested' is not " +
      "'reachable'. " +
      "MEASURED 2026-09-07, THE FIRST REAL POST, with the service account: " +
      "404 NOT_FOUND 'Method not found.' Not a 403 — so not an IAM or " +
      "allowlist REFUSAL but a method this project cannot SEE, which is how " +
      "Google keeps allowlisted previews un-enumerable. The owner confirmed " +
      "the same day that the access form was NEVER submitted, so a hidden " +
      "method is the expected state, not an anomaly. Google's public " +
      "discovery document (rev 20260831) lists NO voices methods at all, but " +
      "publishes ReplicatedVoiceConfig { voiceSampleAudio, mimeType } inline " +
      "in generateContent — a ONE-step shape with no key and no consent " +
      "field, on Vertex only (the Gemini API publishes prebuiltVoiceConfig " +
      "alone). Whether that one-step path is admitted for oniq-309bd is " +
      "UNMEASURED; one service-account POST answers it. Retaining a voice " +
      "sample and dropping the word-matched consent are policy, so the " +
      "one-step path is the owner's to choose, not an engineering swap.",
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
    state: "LIVE",
    evidence:
      "TWO-STAGE, owner directive 2026-09-04c: the reference NEVER reaches " +
      "Lyria. Gemini listens to it and writes a structured music brief; Lyria " +
      "generates from that brief. Sending audio to Lyria directly is CLOSED " +
      "and stays closed — measured 2026-09-04 as 400 'Unsupported input mime " +
      "type for this model: audio/s16le', identically for wav and mp3, on " +
      "every lyria id, with a text-only control returning 200. " +
      "PROVEN END TO END ON PRODUCTION, 2026-09-04, which is what moved this " +
      "from EXPERIMENTAL: one POST to the DEPLOYED music-generate carrying an " +
      "8.0s 24kHz mono 16-bit WAV of a C/Am/F/G progression (384,044 bytes) " +
      "returned HTTP 200 with reference 'audio' and brief " +
      "'Ambient, Electronic · Slow, sustained · " +
      "ethereal/dreamy/introspective/tranquil · synthesizer, pad'. " +
      "TWO THINGS THAT SENTENCE PROVES, beyond the 200. First, its SHAPE is " +
      "describeBrief's exactly — genre, then tempo, then mood joined by '/', " +
      "then instruments joined by ', ' — so parseMusicBrief read real JSON " +
      "off the listening model and compileMusicPrompt fed it forward; a " +
      "failure anywhere in that chain returns 502, never a formatted brief. " +
      "Second, the WORDS could only have come from the audio: the person's " +
      "prompt was 'something for a long drive at night' and the mood chip " +
      "was 'chill', and neither yields 'sustained' or 'synthesizer, pad' — " +
      "which is what slow sine chords under an exponential decay actually " +
      "sound like. The model listened rather than paraphrasing the prompt " +
      "back, and that is the difference between this feature working and " +
      "merely appearing to.",
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
    evidence:
      "app.ai.tsx attaches an image, a PDF or a text file; `ting` inlines it " +
      "as a base64 part (text is spliced as plain text, capped at 20,000 " +
      "chars) and llm.ts's translateMessagesToGemini carries it into the " +
      "generateContent body. The path is shipped and in daily use, which is " +
      "the strongest evidence there is — stronger than a probe, because it " +
      "is many real requests rather than one. It COUNTS the blocks it could " +
      "not inline and warns, so a silent drop would show up rather than " +
      "quietly answering without the document.",
  },
  "weather.current": {
    id: "weather.current",
    provider: "google",
    // LIVE as of 2026-09-04 21:02 UTC, on the evidence this file demands and
    // not a minute earlier: a real call from the DEPLOYED function that came
    // back with a real reading and STORED it. The three-request control set
    // below is kept because it is what made the failures readable, but it is
    // no longer the load-bearing evidence — the stored row is.
    state: "LIVE",
    // KEPT THOUGH THE ROW IS LIVE: this is what the screen says if the row
    // is ever flipped back. A kill switch that falls through to a generic
    // "Not available yet" is a worse kill switch.
    userMessage: "Weather isn't switched on yet",
    evidence:
      "PROMOTED 2026-09-04 on a production round trip. weather_cache holds " +
      "cell 22.6,88.4 fetched_at 2026-09-04 21:02:41.479+00 with reading " +
      '{"tempC":28,"feelsLikeC":33,"humidity":90,"windKmh":6,' +
      '"condition":"Partly cloudy","conditionType":"PARTLY_CLOUDY",' +
      '"isDay":false}. That row could only be written by a 200 from ' +
      "weather.googleapis.com on ONIQ's own service account, through the " +
      "deployed function, after the roles/serviceusage.serviceUsageConsumer " +
      "grant on oniq-309bd cleared — so it settles BOTH open questions at " +
      "once: the account may call the API, and the API is enabled on the " +
      "project. The second was never reached before, because the serviceusage " +
      "check fires first. " +
      "THE CACHE IS ALSO PROVEN BY THE SAME ROW: one row, not one per request, " +
      "written at the 0.1-degree cell centre rather than the caller's own " +
      "coordinates. " +
      "WHAT THE REFUSALS LOOKED LIKE, kept because a future failure will look " +
      "like one of them. " +
      "2026-09-04, three requests to weather.googleapis.com/v1/currentConditions:lookup " +
      "from the dev container, which is a control set rather than a single probe. " +
      "NO CREDENTIAL: 403 PERMISSION_DENIED, \"Method doesn't allow unregistered callers " +
      "(callers without established identity). Please use API Key or other form of API " +
      'consumer identity to call this API." A NONSENSE BEARER: 401 UNAUTHENTICATED, ' +
      '"Request had invalid authentication credentials. Expected OAuth 2 access token, ' +
      'login cookie or other valid authentication credential." A NONSENSE API KEY: 400 ' +
      "INVALID_ARGUMENT, reason API_KEY_INVALID, service weather.googleapis.com. " +
      "The middle answer is the finding and the outer two are what let it be read: the " +
      "Authorization header was PARSED and judged as an OAuth credential rather than " +
      "waved away, and the API-key path is a visibly different error route. That is the " +
      'OPPOSITE of what Vertex said to an API key ("API keys are not supported by this ' +
      'API"), and it is what makes owner directive 2026-09-04h buildable. ' +
      "GET, not POST, is also measured: the probes carried the coordinates as query " +
      "parameters and were answered on the credential rather than refused as the wrong " +
      "method. " +
      "THEN THE DEPLOYED FUNCTION ANSWERED, 2026-09-04, one POST on production, HTTP 200: " +
      '{"configured":true,"unavailable":true,"reason":"Caller does not have required ' +
      "permission to use project oniq-309bd. Grant the caller the " +
      "roles/serviceusage.serviceUsageConsumer role, or a custom role with the " +
      "serviceusage.services.use permission, by visiting " +
      "https://console.developers.google.com/iam-admin/iam?project=oniq-309bd and then " +
      'retry."} ' +
      "THAT ANSWER PROVES MORE THAN A REFUSAL WOULD. The credential chain works end to " +
      "end on production: FIREBASE_SERVICE_ACCOUNT parsed, the JWT signed, and Google's " +
      "token endpoint exchanged it for a real access token — a failure there returns " +
      "configured:false naming the missing secret, and it did not. Google then " +
      "AUTHENTICATED that token and got as far as an AUTHORIZATION check, which confirms " +
      "the OAuth finding above against the REAL service account rather than a nonsense " +
      "one. The payer is confirmed as oniq-309bd, the Firebase project, per directive " +
      "2026-09-04e. " +
      "STILL EXPERIMENTAL, and the reason matters: THE NEXT ANSWER IS NOT YET KNOWN. The " +
      "serviceusage permission check fires BEFORE the API-enablement check, so whether " +
      "the Weather API is switched on for that project is a question this response never " +
      "reached. One grant, one retry, then we learn it — do not read the grant as the " +
      "last step. " +
      "The cache held under a real failure: weather_cache had 0 rows afterwards, so a " +
      "reading that could not be read was never stored and served for a quarter hour.",
  },
  "air.current": {
    id: "air.current",
    provider: "google",
    // A SEPARATE ENTRY FROM weather.current, because it is a separate API with
    // a separate enablement state on the project. One of the two can be live
    // while the other is not, and a single row would have to lie about which.
    // Both happen to be live now; the split is what let them be settled
    // independently rather than assumed together.
    state: "LIVE",
    // KEPT THOUGH THE ROW IS LIVE: this is what the screen says if the row
    // is ever flipped back. A kill switch that falls through to a generic
    // "Not available yet" is a worse kill switch.
    userMessage: "Air quality isn't switched on yet",
    evidence:
      "PROMOTED 2026-09-04 on its own production round trip, separately from " +
      "weather. The same weather_cache row carries air " +
      '{"aqi":58,"code":"ind_cpcb","indexName":"NAQI (IN)",' +
      '"category":"Satisfactory air quality","dominantPollutant":"pm10"} at ' +
      "fetched_at 2026-09-04 21:02:41.479+00. Air is fired in the same round " +
      "as weather but settled separately and allowed to fail alone, so a " +
      "non-null `air` column is proof of THIS API answering 200 and not of " +
      "the weather one. " +
      "AND IT CONFIRMS THE POLARITY TRAP THE UI WAS BUILT AGAINST: Google " +
      "returned the LOCAL index, ind_cpcb / NAQI (IN), which runs 0-500 " +
      "WORST-high — not the 0-100 BEST-high universal index. 58 is " +
      '"Satisfactory air quality" on that scale and would read as poor on the ' +
      "other. Nothing in ONIQ judges the number; the tint and the wording come " +
      "from Google's own `category` string, which is why this row being a " +
      "different index from the one expected changed no code. " +
      "WHAT THE REFUSALS LOOKED LIKE, kept for the next failure. " +
      "2026-09-04, the same three-request control set fired at " +
      "airquality.googleapis.com/v1/currentConditions:lookup as at the weather host, and " +
      "answered identically. NO CREDENTIAL: 403 PERMISSION_DENIED, \"Method doesn't allow " +
      "unregistered callers (callers without established identity). Please use API Key or " +
      'other form of API consumer identity to call this API." A NONSENSE BEARER: 401 ' +
      'UNAUTHENTICATED, "Request had invalid authentication credentials. Expected OAuth 2 ' +
      'access token, login cookie or other valid authentication credential." A NONSENSE ' +
      "API KEY: 400 INVALID_ARGUMENT, reason API_KEY_INVALID, " +
      '"service": "airquality.googleapis.com". So it takes the same Firebase service ' +
      "account as Vertex and weather, on the same switch. " +
      "ONE MEASURED DIFFERENCE FROM WEATHER, and it shapes the code: THIS ONE IS A POST " +
      "with a JSON body. The same coordinates sent here as GET query parameters returned " +
      "Google's HTML 404 page — no JSON error and no credential check, which is what a " +
      "wrong method looks like on this host, where weather answered the identical GET on " +
      "its credential. " +
      "THE FIRST PRODUCTION CALL NEVER REACHED THIS API'S OWN GATE. Both lookups go out " +
      "together, and the weather half came back with an IAM refusal on the quota project " +
      "— see weather.current for the verbatim text and what it proves about the " +
      "credential. The air half was fired in the same round and its result discarded into " +
      "a log, by design: losing a temperature because an air index was missing would " +
      "trade a working feature for one that is not. " +
      "STILL UNPROVEN, hence EXPERIMENTAL: that the service account may call it, and that " +
      "the Air Quality API is enabled on the project. Weather and air are enabled " +
      "separately, so one may work while the other does not — which is why the function " +
      "settles them separately and this row is separate too. Expect to learn this one " +
      "only AFTER the roles/serviceusage.serviceUsageConsumer grant clears the shared " +
      "gate.",
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
