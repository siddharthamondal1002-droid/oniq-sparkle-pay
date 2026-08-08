// ONIQ Lores — the Originals hub.
//
// Data only: which episodes exist, and which of them already have a playable
// video. Episode metadata is read from the season shot list (originals.ts) so
// the two can never drift; this file only adds "is there a video yet, and
// where does it live".
import { ORIGINALS, type Episode } from "@/data/originals";
import fireflyAsset from "@/assets/lores-firefly-forest.mp4.asset.json";
import promoAsset from "@/assets/oniq-promo.mp4.asset.json";

export type LoreVideo = {
  id: string;
  title: string;
  /** Short line under the title. */
  blurb: string;
  /** Playable source, or null while the episode is still in production. */
  url: string | null;
  runtime: string;
  /** Season/collection this belongs to. */
  collection: string;
};

/** Standalone clips that are not part of a scripted season. */
const STANDALONE: LoreVideo[] = [
  {
    id: "oniq-promo",
    title: "ONIQ — One App. Every World.",
    blurb: "The official ONIQ promo.",
    url: promoAsset.url,
    runtime: "0:23",
    collection: "ONIQ",
  },
  {
    id: "firefly-forest",
    title: "The Glowing Forest",
    blurb: "A child walks into a forest lit by fireflies. Warm illustrated short.",
    url: fireflyAsset.url,
    runtime: "0:05",
    collection: "Shorts",
  },
];

function fromEpisode(ep: Episode): LoreVideo {
  return {
    id: ep.id,
    title: `Episode ${ep.number} — ${ep.title}`,
    blurb: `${ep.scenes.length} scenes`,
    url: null,
    runtime: ep.runtime,
    collection: "Arabian Nights — Season One",
  };
}

/** Everything Lores can show, newest/playable first. */
export const LORE_VIDEOS: LoreVideo[] = [
  ...STANDALONE,
  ...ORIGINALS.map(fromEpisode),
];

export const LORE_COLLECTIONS: { name: string; videos: LoreVideo[] }[] = [
  ...new Set(LORE_VIDEOS.map((v) => v.collection)),
].map((name) => ({ name, videos: LORE_VIDEOS.filter((v) => v.collection === name) }));
