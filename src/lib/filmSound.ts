import { emotionFor, type Emotion } from "./expressionGrammar.ts";
import { ambienceFor, type AmbienceKind } from "./soundStage.ts";

type FilmShot = {
  still: string;
  narration?: string;
  dialogue?: { line?: string } | null;
};

export function soundEmotionFor(shot: FilmShot): Emotion | null {
  return emotionFor(
    `${shot.still} ${shot.narration ?? ""} ${shot.dialogue?.line ?? ""}`.trim(),
  );
}

export function sceneAmbienceFor(
  still: string,
  sceneWeather: string | null | undefined,
): AmbienceKind | null {
  const authoredAir = ambienceFor(still);
  return sceneWeather === "rain" ? "rain" : authoredAir === "rain" ? null : authoredAir;
}
