/**
 * FILM LANGUAGES — the languages a Story can be narrated in, and which voice
 * engine speaks each.
 *
 * OWNER DIRECTIVE, 2026-09-03: a film in a language other than English is
 * voiced by the CLOUD voice (Gemini TTS through the Lovable gateway). English
 * films stay on the in-house Piper engine, exactly as the 2026-08-27 in-house
 * directive left them. The reason is not taste: every in-house voice ONIQ owns
 * is an English model (the story worker's narrator and 904-speaker cast, and
 * the GPU worker's baked-in narrator), and Piper's catalogue has no voice for
 * any Indian language. Hand an English model Hindi text and it reads Latin
 * phonemes over Devanagari. The cloud voice speaks these languages today.
 *
 * WHY THIS LIST AND NOT THE TRANSLATOR'S 22. The translator covers every
 * scheduled Indian language; the cloud voice does not. This is the
 * intersection of the translator's list with the languages Gemini's TTS
 * documents as supported, so a film can only be requested in a language a
 * voice exists for. Extend it only alongside evidence the voice speaks the
 * language; the database CHECK constraint carries the same set.
 *
 * PUNJABI ADDED 2026-09-11, and here is the evidence the rule above demands.
 * The owner reported "Spoken in not working" and, asked which way, chose
 * "Punjabi isn't there" -- their last three films were written in Gurmukhi and
 * recorded as English.
 *
 * MEASURED, not read off a docs page. story-voice sends NO language code at
 * all: it posts the text and a prebuilt voice name, and the model reads
 * whatever script it is handed (story-voice/index.ts, the `contents` body). So
 * "supported" here is not a parameter the code can set -- it is only ever the
 * question "does the model read this script", and the only honest test is a
 * POST. Through the DEPLOYED story-voice, one Gurmukhi sentence, Charon:
 *
 *     POST /functions/v1/story-voice  {"text":"<one Punjabi sentence>"}
 *     -> 200  {"configured":true,"mime":"audio/wav", ...}
 *        RIFF/WAVE, PCM mono, 24000 Hz, 16-bit, 193,920 bytes of data
 *        = 4.04 seconds of audio
 *
 * Not a refusal, not a 502, and not a stub: four seconds is the right length
 * for that sentence. A web search also reports Punjabi among Gemini TTS's
 * languages, but that is a [SNIPPET] -- ai.google.dev, docs.cloud.google.com
 * and firebase.google.com are all egress-blocked from this container, so no
 * [PAGE] was obtainable and the POST is the load-bearing evidence.
 *
 * WHAT IS STILL UNPROVEN, stated as unproven: nobody has LISTENED to it.
 * Four seconds of 24 kHz speech is consistent with correct Punjabi and equally
 * consistent with a voice reading Gurmukhi badly. Pronunciation cannot be
 * verified from here at all. THE GATE IS THE OWNER HEARING ONE PUNJABI FILM --
 * the same shape as "the first real sign-in is the test". If it reads wrong,
 * removing `pa` from this array and the CHECK is the whole rollback.
 */
export const FILM_LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
] as const;

export type FilmLanguage = (typeof FILM_LANGUAGES)[number]["code"];

export const FILM_LANGUAGE_CODES: readonly FilmLanguage[] = FILM_LANGUAGES.map((l) => l.code);

export function isFilmLanguage(code: unknown): code is FilmLanguage {
  return typeof code === "string" && (FILM_LANGUAGE_CODES as readonly string[]).includes(code);
}

/**
 * Which engine voices a film. `localOnly` is the production dispatch setting
 * (STORY_LOCAL_TTS=only); it decides English films and nothing else, because
 * for every other language there is no in-house engine to fall back to.
 */
export function voiceEngineFor(
  language: string | null | undefined,
  localOnly: boolean,
): "cloud" | "local" {
  const code = typeof language === "string" && language ? language : "en";
  if (code !== "en") return "cloud";
  return localOnly ? "local" : "cloud";
}
