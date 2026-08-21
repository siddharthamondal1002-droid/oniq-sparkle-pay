/**
 * ONE AUTHORITATIVE VISIBLE-SCENE WEATHER DECISION (owner directive,
 * 2026-08-21, after the 5-shot MAIN validation).
 *
 * The 5-shot test exposed a divergence: a film themed "…Weather" let a
 * rain word ride the FILM-WIDE setting string into a shot's generated image,
 * while the particle overlay — keyed on the shot's own scene — did not agree,
 * so a dry fish-market shot carried an incongruent rain look. The rule this
 * module enforces:
 *
 *   selected visible-scene weather  →  still prompt  AND  post-render VFX
 *
 * NOT the other way round — narration (a storm someone REMEMBERS, a "tempest
 * of grief") and generic film-theme text (the title, the film-wide setting)
 * must never override what the shot's own visible scene shows. The weather is
 * decided ONCE, from the shot's own scene prompt, and the same token gates the
 * image and the overlay so the two can never disagree.
 *
 * Pure and dependency-light: the classifier is the existing vfxKindFor (one
 * vocabulary, not two), and the theme stripper is a small precipitation-only
 * regex used solely to keep film-theme weather out of a dry shot's prompt.
 */
// Explicit ".ts" so the Node story worker (strip-types, no bundler) can import
// this module the same way it imports storyActorCasting.ts; vitest and tsc
// accept it via allowImportingTsExtensions.
import { vfxKindFor, type VfxKind } from "./particleField.ts";

/**
 * THE decision. The visible weather a shot actually shows, from the shot's OWN
 * scene prompt alone — never its narration, never the film-wide theme. Null =
 * dry (the honest default). This one token drives both the image and the VFX.
 */
export function selectSceneWeather(scenePrompt: string): VfxKind | null {
  return vfxKindFor(scenePrompt);
}

/**
 * Precipitation words, boundary-anchored. Used ONLY to strip weather out of a
 * FILM-WIDE theme string (title / setting) when a shot's own scene did not
 * select that weather — so a film themed "monsoon coast" cannot wet a shot
 * whose own scene is a bright dry market. Deliberately narrow: it removes
 * precipitation the shot did not ask for, nothing else. Guards match
 * vfxKindFor's: "grain" is not rain, a crowd that "hailed" brings no hail.
 */
const THEME_PRECIP =
  /\b(rains?|rainy|raining|rainfall|rainstorms?|drizzl\w*|downpours?|monsoons?|deluges?|cloudbursts?|squalls?|torrential|tempests?|thunderstorms?|storms?|storming|stormy|snow\w*|blizzards?|sleet|hailston\w*|hailstorms?|floods?|flooding|flooded)\b/gi;

/**
 * A film-wide theme string (setting/title) with its precipitation removed, so
 * it can be appended to a DRY shot's image prompt without painting weather the
 * shot's own scene never chose. Whitespace is re-normalised. A shot whose own
 * scene IS wet keeps the full setting (see weatherConsistentSetting).
 */
export function stripThemeWeather(themeText: string): string {
  return (themeText ?? "")
    .replace(THEME_PRECIP, "")
    .replace(/\s+([,.])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The film-wide setting string as it should be appended to THIS shot's image
 * prompt, given the shot's own selected weather. When the shot is dry, the
 * theme's precipitation is stripped (theme cannot override a dry scene); when
 * the shot already shows weather, the setting rides through unchanged (they
 * agree). The single decision governs the prompt, exactly as it governs VFX.
 */
export function weatherConsistentSetting(
  setting: string,
  shotWeather: VfxKind | null,
): string {
  // Only a shot that itself shows PRECIPITATION (rain/snow) keeps the theme's
  // weather. A dry shot — dust, embers, fireflies, or nothing — is not wet, so
  // the film theme's rain/monsoon is stripped: a dusty market never inherits
  // the film's storm just because the title says "…Weather".
  const showsPrecipitation = shotWeather === "rain" || shotWeather === "snow";
  return showsPrecipitation ? (setting ?? "") : stripThemeWeather(setting ?? "");
}
