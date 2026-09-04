/**
 * THE STYLE AND MOOD CHIPS, for the screens that draw them.
 *
 * A RE-EXPORT, not a copy — the vocabulary and the clause each token stands
 * for live beside the edge functions that resolve them, because the CLAUSE is
 * built server-side and must never be something a client can supply. The same
 * shim shape src/data/capabilities.ts and src/lib/itemLint.ts already use.
 */
export {
  IMAGE_STYLES,
  MUSIC_MOODS,
  readImageStyle,
  readMusicMood,
  withImageStyle,
  withMusicMood,
} from "../../supabase/functions/_shared/createStyles.ts";
export type { ImageStyle, MusicMood } from "../../supabase/functions/_shared/createStyles.ts";

/** Sentence case for a chip, so the data stays lowercase tokens. */
export const STYLE_LABEL: Record<string, string> = {
  auto: "Auto",
  realistic: "Realistic",
  cinematic: "Cinematic",
  anime: "Anime",
  chill: "Chill",
  energetic: "Energetic",
  happy: "Happy",
};
