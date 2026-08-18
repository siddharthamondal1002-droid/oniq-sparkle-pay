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
// Third batch, uploaded 2026-08-18.
import welshBlacksmith from "@/assets/story-style/welsh-blacksmith.png.asset.json";
import amazonCanoe from "@/assets/story-style/amazon-canoe.png.asset.json";
import bolivianAymaraSheet from "@/assets/story-style/bolivian-aymara-sheet.png.asset.json";
import mediterraneanBaker from "@/assets/story-style/mediterranean-baker.png.asset.json";
import anatolianShepherd from "@/assets/story-style/anatolian-shepherd.png.asset.json";
import singaporeHawker from "@/assets/story-style/singapore-hawker.png.asset.json";
import khmerStoneCarver from "@/assets/story-style/khmer-stone-carver.png.asset.json";
import baganAlmsRound from "@/assets/story-style/bagan-alms-round.png.asset.json";
import kashmiriCarpetWeaver from "@/assets/story-style/kashmiri-carpet-weaver.png.asset.json";
import siberianTrapper from "@/assets/story-style/siberian-trapper.png.asset.json";
// Fourth batch, uploaded 2026-08-18.
import griotStorytellerSheet from "@/assets/story-style/griot-storyteller-sheet.png.asset.json";
import maasaiHerdsmanSheet from "@/assets/story-style/maasai-herdsman-sheet.png.asset.json";
import kolkataRainMarket from "@/assets/story-style/kolkata-rain-market.png.asset.json";
import punjabiFarmerSheet from "@/assets/story-style/punjabi-farmer-sheet.png.asset.json";
import jiangnanScholar from "@/assets/story-style/jiangnan-scholar.png.asset.json";
import kyotoLanternCraftswomanSheet from "@/assets/story-style/kyoto-lantern-craftswoman-sheet.png.asset.json";
import vietnamRiceTerrace from "@/assets/story-style/vietnam-rice-terrace.png.asset.json";
// Fifth batch, uploaded 2026-08-18.
import filipinoBangkaFisherman from "@/assets/story-style/filipino-bangka-fisherman.png.asset.json";
import kazakhEagleHunter from "@/assets/story-style/kazakh-eagle-hunter.png.asset.json";
import isfahanScholarPoetSheet from "@/assets/story-style/isfahan-scholar-poet-sheet.png.asset.json";
import andeanWomanSheet from "@/assets/story-style/andean-woman-sheet.png.asset.json";
import inuitIceFisher from "@/assets/story-style/inuit-ice-fisher.png.asset.json";
import outbackElder from "@/assets/story-style/outback-elder.png.asset.json";
import maoriRangatira from "@/assets/story-style/maori-rangatira.png.asset.json";
import amazonRiverwoman from "@/assets/story-style/amazon-riverwoman.png.asset.json";
import pampasDrover from "@/assets/story-style/pampas-drover.png.asset.json";
import samiHerderSheet from "@/assets/story-style/sami-herder-sheet.png.asset.json";
// Sixth batch, uploaded 2026-08-18.
import polynesianOutrigger from "@/assets/story-style/polynesian-outrigger.png.asset.json";
import zuluBeadworkArtistSheet from "@/assets/story-style/zulu-beadwork-artist-sheet.png.asset.json";
import lagosTalkingDrummer from "@/assets/story-style/lagos-talking-drummer.png.asset.json";
import madagascarRicePlanter from "@/assets/story-style/madagascar-rice-planter.png.asset.json";
import anatolianTeaHouse from "@/assets/story-style/anatolian-tea-house.png.asset.json";
import bavarianOrnamentPainter from "@/assets/story-style/bavarian-ornament-painter.png.asset.json";
import irishPubFiddler from "@/assets/story-style/irish-pub-fiddler.png.asset.json";
import icelandicShepherd from "@/assets/story-style/icelandic-shepherd.png.asset.json";

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
  {
    id: "mongolian-herder",
    kind: "scene",
    title: "Mongolian herder outside his ger",
    note: "Wide 16:9 steppe staging: low horizon, ochre grass, figure centred at mid-distance.",
    url: mongolianHerder.url,
    attachable: false,
  },
  {
    id: "tibetan-monk-sheet",
    kind: "sheet",
    title: "Tibetan monk (annotated sheet)",
    note: "2D character sheet — expressions, 3/4 back and side profile. Direction only, never attached.",
    url: tibetanMonkSheet.url,
    attachable: false,
  },
  {
    id: "korean-potter-sheet",
    kind: "sheet",
    title: "Korean master potter (annotated sheet)",
    note: "2D character sheet — kiln-lit workshop, expression row, hand detail. Direction only.",
    url: koreanPotterSheet.url,
    attachable: false,
  },
  {
    id: "balinese-dancer",
    kind: "scene",
    title: "Balinese legong dancer at the temple gate",
    note: "Portrait framing: gold-on-magenta costume detail, torchlight against night rain.",
    url: balineseDancer.url,
    attachable: false,
  },
  {
    id: "ethiopian-coffee",
    kind: "scene",
    title: "Ethiopian coffee ceremony at Lalibela",
    note: "Daylight portrait: white shamma with woven border, warm stone, calm direct gaze.",
    url: ethiopianCoffee.url,
    attachable: false,
  },
  {
    id: "nile-felucca-sailor",
    kind: "scene",
    title: "Felucca sailor on the Nile at sunset",
    note: "Backlit silhouette work, sun-through-sail, near-monochrome amber palette.",
    url: nileFeluccaSailor.url,
    attachable: false,
  },
  {
    id: "diner-cook-night",
    kind: "scene",
    title: "Night-shift diner cook",
    note: "Contemporary setting reference: neon-teal vs tungsten, motion pose, legible sign lettering.",
    url: dinerCookNight.url,
    attachable: false,
  },
  {
    id: "oaxacan-weaver-sheet",
    kind: "sheet",
    title: "Oaxacan weaver (annotated sheet)",
    note: "2D character sheet with palette swatches and loom detail. Direction only.",
    url: oaxacanWeaverSheet.url,
    attachable: false,
  },
  {
    id: "caribbean-fish-market",
    kind: "scene",
    title: "Caribbean beach fish market",
    note: "Crowd staging: many background figures kept simple, saturated pastel buildings, midday sun.",
    url: caribbeanFishMarket.url,
    attachable: false,
  },
  {
    id: "himalayan-climber",
    kind: "scene",
    title: "Himalayan climber on the ridge",
    note: "Cold high-altitude palette, snow particles, prayer flags for scale and colour accent.",
    url: himalayanClimber.url,
    attachable: false,
  },
  {
    id: "welsh-blacksmith",
    kind: "scene",
    title: "Welsh village blacksmith at the forge",
    note: "Interior/exterior split frame: cold rainy slate-grey street through the arch vs hot forge orange inside.",
    url: welshBlacksmith.url,
    attachable: false,
  },
  {
    id: "amazon-canoe",
    kind: "scene",
    title: "Amazonian boatman in a dugout canoe",
    note: "Dense green canopy, dappled light, river mist; carved hull detail kept legible.",
    url: amazonCanoe.url,
    attachable: false,
  },
  {
    id: "bolivian-aymara-sheet",
    kind: "sheet",
    title: "Bolivian Aymara textile seller (annotated sheet)",
    note: "2D character sheet — bowler hat, fringed shawl, layered polleras, side and 3/4 back. Direction only.",
    url: bolivianAymaraSheet.url,
    attachable: false,
  },
  {
    id: "mediterranean-baker",
    kind: "scene",
    title: "Mediterranean stone-oven baker",
    note: "Cool blue dawn alley against warm oven mouth; flour dust and steam as atmosphere.",
    url: mediterraneanBaker.url,
    attachable: false,
  },
  {
    id: "anatolian-shepherd",
    kind: "scene",
    title: "Highland shepherd above a terraced valley",
    note: "Epic landscape staging: sun-through-cloud, layered mountain depth, flock scattered for scale.",
    url: anatolianShepherd.url,
    attachable: false,
  },
  {
    id: "singapore-hawker",
    kind: "scene",
    title: "Hawker-centre wok cook at night",
    note: "Neon signage plus wok flame as the two light sources; busy background crowd simplified.",
    url: singaporeHawker.url,
    attachable: false,
  },
  {
    id: "khmer-stone-carver",
    kind: "scene",
    title: "Khmer temple stone carver",
    note: "Bright daylight, warm sandstone palette, heavy carved-relief detail behind the figure.",
    url: khmerStoneCarver.url,
    attachable: false,
  },
  {
    id: "bagan-alms-round",
    kind: "scene",
    title: "Monks on the dawn alms round",
    note: "Crowd-in-depth reference: repeated figures fading into mist, saffron against pale gold sky.",
    url: baganAlmsRound.url,
    attachable: false,
  },
  {
    id: "kashmiri-carpet-weaver",
    kind: "scene",
    title: "Kashmiri carpet weaver by the lake window",
    note: "Portrait crop, quiet interior, cold snow light from the window; fine loom and pattern detail.",
    url: kashmiriCarpetWeaver.url,
    attachable: false,
  },
  {
    id: "siberian-trapper",
    kind: "scene",
    title: "Taiga trapper setting a snare",
    note: "High-key snow palette with limited colour: green coat, fur hat, blue shadow, distant cabin smoke.",
    url: siberianTrapper.url,
    attachable: false,
  },
  {
    id: "griot-storyteller-sheet",
    kind: "sheet",
    title: "West African griot storyteller (annotated sheet)",
    note: "2D character sheet — indigo boubou with ochre embroidery, woven cap, kora. Direction only.",
    url: griotStorytellerSheet.url,
    attachable: false,
  },
  {
    id: "maasai-herdsman-sheet",
    kind: "sheet",
    title: "Maasai herdsman (annotated sheet)",
    note: "2D character sheet — red/blue shuka, beaded collar, herding staff, savannah plate. Direction only.",
    url: maasaiHerdsmanSheet.url,
    attachable: false,
  },
  {
    id: "kolkata-rain-market",
    kind: "scene",
    title: "Riverside cloth market in monsoon rain",
    note: "Rain reference: desaturated grey-teal air, wet stone reflections, saturated textiles as the only colour.",
    url: kolkataRainMarket.url,
    attachable: false,
  },
  {
    id: "punjabi-farmer-sheet",
    kind: "sheet",
    title: "Punjabi farmer (annotated sheet)",
    note: "2D character sheet — saffron turban, kurta-dhoti, mustard-field hero plate, three expressions. Direction only.",
    url: punjabiFarmerSheet.url,
    attachable: false,
  },
  {
    id: "jiangnan-scholar",
    kind: "scene",
    title: "Jiangnan scholar at his desk by lantern light",
    note: "Two-source night interior: warm lantern on the figure, cold blue courtyard through the lattice window.",
    url: jiangnanScholar.url,
    attachable: false,
  },
  {
    id: "kyoto-lantern-craftswoman-sheet",
    kind: "sheet",
    title: "Kyoto lantern craftswoman (annotated sheet)",
    note: "2D character sheet — indigo sashiko work kimono, canvas apron, kushi-pinned hair, multi-pose workshop. Direction only.",
    url: kyotoLanternCraftswomanSheet.url,
    attachable: false,
  },
  {
    id: "vietnam-rice-terrace",
    kind: "scene",
    title: "Rice planter in flooded terraces under drizzle",
    note: "Wide landscape with a small figure; misted mountain layers, mirrored water, near-monochrome green palette.",
    url: vietnamRiceTerrace.url,
    attachable: false,
  },
  {
    id: "filipino-bangka-fisherman",
    kind: "scene",
    title: "Bangka fisherman hauling a net at sunset",
    note: "Coral-to-gold sunset gradient, stilt village on the horizon, turquoise water and hard-edged spray.",
    url: filipinoBangkaFisherman.url,
    attachable: false,
  },
  {
    id: "kazakh-eagle-hunter",
    kind: "scene",
    title: "Kazakh eagle hunter on horseback in snowfall",
    note: "Animal-anatomy reference: eagle wings and horse in motion, cold blue steppe with warm ochre embroidery accents.",
    url: kazakhEagleHunter.url,
    attachable: false,
  },
  {
    id: "isfahan-scholar-poet-sheet",
    kind: "sheet",
    title: "Isfahan scholar-poet (annotated sheet)",
    note: "2D character sheet — plum wool robe, felt cap, sandals, tiled courtyard fountain plate. Direction only.",
    url: isfahanScholarPoetSheet.url,
    attachable: false,
  },
  {
    id: "andean-woman-sheet",
    kind: "sheet",
    title: "Andean woman with llamas (annotated sheet)",
    note: "2D character sheet — bowler hat, red/ochre woven poncho, spindle, front/back/side turnaround. Direction only.",
    url: andeanWomanSheet.url,
    attachable: false,
  },
  {
    id: "inuit-ice-fisher",
    kind: "scene",
    title: "Inuit fisher lifting a char from the ice hole",
    note: "High-key arctic palette: near-white snow held by pale blue shadow, single warm fur-brown figure.",
    url: inuitIceFisher.url,
    attachable: false,
  },
  {
    id: "outback-elder",
    kind: "scene",
    title: "Aboriginal elder walking the red centre at dusk",
    note: "Monochrome red-ochre landscape, tiny figure with a long cast shadow, flat mesa silhouettes.",
    url: outbackElder.url,
    attachable: false,
  },
  {
    id: "maori-rangatira",
    kind: "scene",
    title: "Māori rangatira before a carved wharenui",
    note: "Portrait framing reference: feathered korowai, tā moko linework, red-ochre carving detail behind.",
    url: maoriRangatira.url,
    attachable: false,
  },
  {
    id: "amazon-riverwoman",
    kind: "scene",
    title: "Riverwoman paddling past a stilt village, rain on the horizon",
    note: "Humid golden light with a distant rain curtain; silted ochre water, layered jungle greens.",
    url: amazonRiverwoman.url,
    attachable: false,
  },
  {
    id: "pampas-drover",
    kind: "scene",
    title: "Drover moving cattle through dust at golden hour",
    note: "Dust-and-godray reference: softened painterly edges, near-sepia palette, motion carried by haze.",
    url: pampasDrover.url,
    attachable: false,
  },
  {
    id: "sami-herder-sheet",
    kind: "sheet",
    title: "Sámi reindeer herder (annotated sheet)",
    note: "2D character sheet — blue gákti with red trim and pewter embroidery, front/back turnaround, reindeer detail plate. Direction only.",
    url: samiHerderSheet.url,
    attachable: false,
  },
  {
    id: "polynesian-outrigger",
    kind: "scene",
    title: "Islander poling an outrigger canoe over a reef lagoon",
    note: "Brightest-key reference in the set: high-chroma turquoise water, visible coral through the surface, clean cel-leaning linework.",
    url: polynesianOutrigger.url,
    attachable: false,
  },
  {
    id: "zulu-beadwork-artist-sheet",
    kind: "sheet",
    title: "Zulu beadwork artist (annotated sheet)",
    note: "2D character sheet — beaded collar, patterned wrap skirt, ochre turban, hand and loom detail plates, two expression heads. Direction only.",
    url: zuluBeadworkArtistSheet.url,
    attachable: false,
  },
  {
    id: "lagos-talking-drummer",
    kind: "scene",
    title: "Talking drummer in a dusty street at golden hour",
    note: "Loose visible brushwork, indigo adire cloth against warm dust haze, busy background kept soft.",
    url: lagosTalkingDrummer.url,
    attachable: false,
  },
  {
    id: "madagascar-rice-planter",
    kind: "scene",
    title: "Planter setting seedlings as a storm crosses the terraces",
    note: "Storm reference: cool slate sky and distant rain columns above pale green flooded paddies, laterite-red bunds.",
    url: madagascarRicePlanter.url,
    attachable: false,
  },
  {
    id: "anatolian-tea-house",
    kind: "scene",
    title: "Tea house keeper pouring from a samovar under an autumn vine",
    note: "Warm amber interior light with dappled leaf shadow; portrait-orientation staging with layered background patrons.",
    url: anatolianTeaHouse.url,
    attachable: false,
  },
  {
    id: "bavarian-ornament-painter",
    kind: "scene",
    title: "Ornament painter at a workbench, snow through the window",
    note: "Three-source night interior: stove fire, oil lamp, cold blue window — the warmth-vs-cold night rule.",
    url: bavarianOrnamentPainter.url,
    attachable: false,
  },
  {
    id: "irish-pub-fiddler",
    kind: "scene",
    title: "Fiddler by the hearth in a stone pub, rain at the window (two-shot pair)",
    note: "Continuity reference: the same character and room from two angles with consistent firelight and wardrobe.",
    url: irishPubFiddler.url,
    attachable: false,
  },
  {
    id: "icelandic-shepherd",
    kind: "scene",
    title: "Shepherd beside a steaming geothermal pool at midnight sun",
    note: "Pale lilac-and-gold low sun, steam volumes, turf-roofed houses; muted high-latitude palette.",
    url: icelandicShepherd.url,
    attachable: false,
  },
];

export const getStoryStyleRef = (id: string): StoryStyleRef | undefined =>
  STORY_STYLE_REFS.find((r) => r.id === id);
