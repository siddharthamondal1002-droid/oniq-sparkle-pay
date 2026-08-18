/**
 * ONIQ Originals / Story engine — HOUSE STYLE REFERENCE MEMORY.
 *
 * These are owner-supplied reference frames for the look every generated
 * Story and Original should hold to: hand-painted 2D illustration, clean ink
 * linework, warm painterly light, grounded real-world cultural detail, no
 * photoreal render and no 3D-CG sheen.
 *
 * Two kinds of reference live here:
 *   scene  — a finished frame, used as a LOOK reference.
 *   sheet  — a character sheet with multiple views/expressions. Per the
 *            ep3/ep4 runbook, ONLY 3D sheets are attached to a generation;
 *            these are 2D, so they are `attachable: false` and exist as
 *            human-facing direction, never as an attachment.
 *
 * Provenance: uploaded by the project owner 2026-08-18, stored as Lovable
 * asset pointers in src/assets/story-style/. AI-generated artwork.
 */

import uzbekCeramicist from "@/assets/story-style/uzbek-ceramicist.png.asset.json";
import armenianStonemasonSheet from "@/assets/story-style/armenian-stonemason-sheet.png.asset.json";
import greekFisherman from "@/assets/story-style/greek-fisherman.png.asset.json";
import glassblowerNight from "@/assets/story-style/glassblower-night.png.asset.json";
import woodcarverSnow from "@/assets/story-style/woodcarver-snow.png.asset.json";
import griotSpiritNight from "@/assets/story-style/griot-spirit-night.png.asset.json";
import teaPickerSheet from "@/assets/story-style/tea-picker-sheet.png.asset.json";
import patagonianShepherd from "@/assets/story-style/patagonian-shepherd.png.asset.json";
import andeanSkyTemple from "@/assets/story-style/andean-sky-temple.png.asset.json";
import thaiLongtail from "@/assets/story-style/thai-longtail.png.asset.json";
// Second batch, uploaded 2026-08-18.
import mongolianHerder from "@/assets/story-style/mongolian-herder.png.asset.json";
import tibetanMonkSheet from "@/assets/story-style/tibetan-monk-sheet.png.asset.json";
import koreanPotterSheet from "@/assets/story-style/korean-potter-sheet.png.asset.json";
import balineseDancer from "@/assets/story-style/balinese-dancer.png.asset.json";
import ethiopianCoffee from "@/assets/story-style/ethiopian-coffee.png.asset.json";
import nileFeluccaSailor from "@/assets/story-style/nile-felucca-sailor.png.asset.json";
import dinerCookNight from "@/assets/story-style/diner-cook-night.png.asset.json";
import oaxacanWeaverSheet from "@/assets/story-style/oaxacan-weaver-sheet.png.asset.json";
import caribbeanFishMarket from "@/assets/story-style/caribbean-fish-market.png.asset.json";
import himalayanClimber from "@/assets/story-style/himalayan-climber.png.asset.json";

export type StoryStyleRef = {
  id: string;
  kind: "scene" | "sheet";
  title: string;
  /** What this frame is kept for — the quality it pins down. */
  note: string;
  url: string;
  /** 3D sheets only may be attached to a generation. All of these are 2D. */
  attachable: false;
};

/** One sentence the plot/still prompts can carry verbatim. */
export const STORY_HOUSE_STYLE =
  "Hand-painted 2D storybook illustration: clean confident ink linework, " +
  "soft painterly colour, warm directional light, culturally specific " +
  "clothing, architecture and props rendered accurately. Expressive but " +
  "grounded faces. No photorealism, no 3D-CG shading, no flat vector look.";

export const STORY_STYLE_REFS: StoryStyleRef[] = [
  {
    id: "uzbek-ceramicist",
    kind: "scene",
    title: "Uzbek ceramicist painting a bowl",
    note: "Interior craft scene: pattern density, ikat fabric, teal/cobalt palette, doorway light.",
    url: uzbekCeramicist.url,
    attachable: false,
  },
  {
    id: "armenian-stonemason-sheet",
    kind: "sheet",
    title: "Armenian stonemason (annotated sheet)",
    note: "2D character sheet — direction only, never attached to a generation.",
    url: armenianStonemasonSheet.url,
    attachable: false,
  },
  {
    id: "greek-fisherman",
    kind: "scene",
    title: "Aegean fisherman mending nets",
    note: "High-key daylight, bleached whites, restrained palette, wide 16:9 staging.",
    url: greekFisherman.url,
    attachable: false,
  },
  {
    id: "glassblower-night",
    kind: "scene",
    title: "Glassblower at the furnace",
    note: "Two-source lighting: furnace amber against cold window blue. The night look.",
    url: glassblowerNight.url,
    attachable: false,
  },
  {
    id: "woodcarver-snow",
    kind: "scene",
    title: "Woodcarver on a snowy porch",
    note: "Cold exterior, muted greys, warm interior glow through the doorway.",
    url: woodcarverSnow.url,
    attachable: false,
  },
  {
    id: "griot-spirit-night",
    kind: "scene",
    title: "Griot summoning a spirit",
    note: "Magic reference: light as particulate gold, crowd reaction, starfield night sky.",
    url: griotSpiritNight.url,
    attachable: false,
  },
  {
    id: "tea-picker-sheet",
    kind: "sheet",
    title: "Young tea picker (annotated sheet)",
    note: "2D character sheet — direction only, never attached to a generation.",
    url: teaPickerSheet.url,
    attachable: false,
  },
  {
    id: "patagonian-shepherd",
    kind: "scene",
    title: "Patagonian shepherd under storm light",
    note: "Landscape scale, dramatic cloud, figure held small against terrain.",
    url: patagonianShepherd.url,
    attachable: false,
  },
  {
    id: "andean-sky-temple",
    kind: "scene",
    title: "Andean girl and the sky temple",
    note: "Fantasy staging with real textiles; glow effects kept to one hue.",
    url: andeanSkyTemple.url,
    attachable: false,
  },
  {
    id: "thai-longtail",
    kind: "scene",
    title: "Thai longtail boatman",
    note: "Saturated tropical palette, water handling, rain curtain in the distance.",
    url: thaiLongtail.url,
    attachable: false,
  },
];

export const getStoryStyleRef = (id: string): StoryStyleRef | undefined =>
  STORY_STYLE_REFS.find((r) => r.id === id);
