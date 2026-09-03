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
 */
export const FILM_LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
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
