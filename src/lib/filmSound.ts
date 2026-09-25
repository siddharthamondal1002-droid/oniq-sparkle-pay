import { emotionFor, type Emotion } from "./expressionGrammar.ts";
import { ambienceFor, type AmbienceKind } from "./soundStage.ts";

type FilmShot = {
  still: string;
  narration?: string;
  dialogue?: { line?: string } | null;
};

/**
 * The film's emotional register, read off the shot's own authored words.
 *
 * Deliberately independent of whether the shot has an animation rig or a
 * motion clip: a film with no measured rigs still has feelings in its text,
 * and gating this on rigs is what left expressive films scored silent.
 */
export function soundEmotionFor(shot: FilmShot): Emotion | null {
  return emotionFor(`${shot.still} ${shot.narration ?? ""} ${shot.dialogue?.line ?? ""}`.trim());
}

/**
 * The air a shot is heard in, decided by what is VISIBLE.
 *
 * Visible rain always wins. Otherwise rain words are struck out of the scene
 * text before classifying — narration about remembered, absent or negated
 * rain must not put a rain bed over a dry frame, while a valid cave, wind or
 * night bed in the same sentence still survives.
 */
export function sceneAmbienceFor(
  still: string,
  sceneWeather: string | null | undefined,
): AmbienceKind | null {
  if (sceneWeather === "rain") return "rain";
  const withoutRain = still.replace(
    /\b(?:rain\w*|drizzl\w*|downpour\w*|monsoon\w*|thunderstorm\w*)\b/gi,
    " ",
  );
  return ambienceFor(withoutRain);
}
