/**
 * WORKER-CONSUMABLE ACTOR ASSET MAP — GENERATED, do not edit by hand.
 *
 * The matched owner character assets, as a plain, alias-free snapshot the Node
 * story worker can import directly. The bundler-land registry
 * (src/data/storyCharacterRefs.ts + storyStyleRefs.ts) uses the "@/" alias and
 * Vite ".asset.json" imports, so the worker cannot read it; this is the bridge.
 * Regenerate with scratchpad/gen-actor-assets.mjs WRITING TO THIS PATH; pinned
 * to the real registry by src/lib/__tests__/storyActorAssets.test.ts.
 *
 * It lives under supabase/functions/_shared/ rather than src/data/ because the
 * Supabase edge bundler uploads ONLY the supabase/functions tree. An edge
 * function reaching up into src/ compiles locally and then fails at deploy:
 * on 2026-08-31 story-still and story-reference-publish were both rejected
 * against production with `Module not found ".../src/data/storyActorAssets.ts"`
 * while story-motion and story-plot — which do not reach this module — went
 * out fine. src/data/storyActorAssets.ts is now a re-export of this file, so
 * every app-side and Remotion consumer keeps its existing import path.
 *
 * Being alias-free and import-free is what lets one copy serve all three
 * runtimes (Deno edge, Node worker, Vite app). Keep it that way: adding an
 * import here would break at least one of them.
 */
// Kept as a LITERAL, not an import: this file's header requires it to stay
// import-free so one copy serves Deno edge, the Node worker and Vite. Pinned
// equal to src/config/appOrigin.ts APP_ORIGIN by storyActorAssets.test.ts.
export const ONIQ_ASSET_ORIGIN = "https://www.oniqhub.com";

export type ActorAsset = {
  /** STORY_CHARACTER_REFS externalAssetId. */
  characterRefId: string;
  styleRefId: string;
  region: string;
  description: string;
  /** The style frame's path; prefix with ONIQ_ASSET_ORIGIN to fetch. */
  assetPath: string;
  /** scene = a finished frame (directly attachable); sheet = a turnaround/panel
   *  sheet that leaks its layout when conditioned, so NOT directly attachable. */
  kind: "scene" | "sheet";
};

/** The full fetch URL for an actor's owner reference frame. */
export function assetUrl(a: ActorAsset): string {
  return ONIQ_ASSET_ORIGIN + a.assetPath;
}

/**
 * A reference is DIRECTLY attachable to generation only when its frame is a
 * finished scene. Sheet frames (turnarounds/labels/palette) reproduce their own
 * layout when conditioned (measured 2026-08-21, shot 04), so they degrade to
 * the text-only path with reason SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE.
 */
export function referenceEligible(a: ActorAsset): boolean {
  return a.kind === "scene";
}

export const ACTOR_ASSETS: ActorAsset[] = [
  {
    characterRefId: "83193e07-2b3c-465b-8479-7a3f03d73464",
    styleRefId: "caribbean-fish-market",
    region: "Jamaica",
    description: "Fishmonger woman arranging fresh fish, Port Antonio coastal market",
    assetPath:
      "/__l5e/assets-v1/f38f998a-f2ec-4a41-99d0-726a89b2edb7/story-style-caribbean-fish-market.png",
    kind: "scene",
  },
  {
    characterRefId: "2d3a4f57-3711-43ef-bc9c-3734f931f094",
    styleRefId: "oaxacan-weaver-sheet",
    region: "Mexico",
    description: "Oaxacan weaver working a backstrap loom in a sunlit courtyard",
    assetPath:
      "/__l5e/assets-v1/ab8469a7-5727-48b6-b3ba-afac56d03acf/story-style-oaxacan-weaver-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "f2343315-f56e-4f56-b859-23469bd46f15",
    styleRefId: "jacmel-skipping-girl",
    region: "Haiti",
    description: "Young girl skipping rope in a Jacmel schoolyard",
    assetPath: "/__l5e/assets-v1/b255dfb5-c412-43b8-9dbc-21b1e2ddbfe4/jacmel-skipping-girl.jpg",
    kind: "scene",
  },
  {
    characterRefId: "eeafb8a5-b493-497b-9dd2-690dc4e5c358",
    styleRefId: "atitlan-maize-boy",
    region: "Guatemala",
    description: "Maya teenage boy carrying maize basket near Lake Atitlan",
    assetPath: "/__l5e/assets-v1/0fa54632-c833-457b-8e56-c9a9071f3d6a/atitlan-maize-boy.jpg",
    kind: "scene",
  },
  {
    characterRefId: "c46a818d-f272-4298-93b7-f91fd885cac2",
    styleRefId: "havana-balcony-musician",
    region: "Cuba",
    description: "Elderly musician playing guitar on a Havana balcony",
    assetPath: "/__l5e/assets-v1/422f778f-a6d6-4974-b2af-c9918a886d85/havana-balcony-musician.jpg",
    kind: "scene",
  },
  {
    characterRefId: "2de517ea-9e7f-46f5-9eab-b59e04ef3ed4",
    styleRefId: "guna-yala-mola-sheet",
    region: "Panama",
    description: "Guna Yala woman arranging mola textiles, San Blas Islands",
    assetPath: "/__l5e/assets-v1/12f929c8-394d-4dc0-8da4-b5b7afb15649/guna-yala-mola-sheet.jpg",
    kind: "sheet",
  },
  {
    characterRefId: "934e9c03-ca23-4dab-bd5d-09527ec3eb7f",
    styleRefId: "salvador-samba-dancer",
    region: "Brazil",
    description: "Carnival samba dancer mid-motion, Salvador street parade",
    assetPath: "/__l5e/assets-v1/669819e3-d9b1-49f9-900b-3b300d540be2/salvador-samba-dancer.jpg",
    kind: "scene",
  },
  {
    characterRefId: "3986709d-8be5-4944-8369-35325bedbe2f",
    styleRefId: "zona-cafetera-coffee-picker",
    region: "Colombia",
    description: "Coffee farmer hand-picking cherries, Zona Cafetera",
    assetPath:
      "/__l5e/assets-v1/8264919b-46a7-47c6-88e6-846555956006/zona-cafetera-coffee-picker.jpg",
    kind: "scene",
  },
  {
    characterRefId: "45446c52-b612-4d13-ac5c-78e054e6fc4d",
    styleRefId: "iquitos-shaman-healer",
    region: "Peru",
    description: "Amazonian shaman-healer arranging medicinal plants, Iquitos",
    assetPath: "/__l5e/assets-v1/d923b0ef-3ba6-4284-a3b6-301f0f9cd42a/iquitos-shaman-healer.jpg",
    kind: "scene",
  },
  {
    characterRefId: "146887de-3573-4f8a-9bff-5716aad8977d",
    styleRefId: "warao-hammock-weaver-sheet",
    region: "Venezuela",
    description: "Warao woman weaving a hammock, Orinoco Delta",
    assetPath:
      "/__l5e/assets-v1/c1119c91-d808-4dcb-8e8f-92b65e5cd7fa/warao-hammock-weaver-sheet.jpg",
    kind: "sheet",
  },
  {
    characterRefId: "6e0aea18-bfc5-4320-a050-b7c1133516e6",
    styleRefId: "bolivian-aymara-sheet",
    region: "Bolivia",
    description: "Aymara market vendor with layered textiles, El Alto",
    assetPath: "/__l5e/assets-v1/17ce178b-72b2-455b-8a7f-c2e926c0403e/bolivian-aymara-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "3e78557e-f11c-4a90-a8f4-5159821a89ac",
    styleRefId: "amazon-canoe",
    region: "Ecuador",
    description: "Kichwa river guide paddling a canoe, Napo River",
    assetPath: "/__l5e/assets-v1/082ec13f-ae4b-41fe-b920-86143315e8c1/amazon-canoe.png",
    kind: "scene",
  },
  {
    characterRefId: "b7dd7c1f-6a95-400a-85a1-3fee4cb95f6a",
    styleRefId: "patagonian-shepherd",
    region: "Chile",
    description: "Patagonian shepherd guiding sheep, Torres del Paine",
    assetPath:
      "/__l5e/assets-v1/1012184c-aee6-4d03-aa9d-63285cd87513/story-style-patagonian-shepherd.png",
    kind: "scene",
  },
  {
    characterRefId: "6ff3247b-f981-4d12-abe1-955205a2243c",
    styleRefId: "diner-cook-night",
    region: "United States",
    description: "Diner cook flipping food on a griddle, rural Louisiana",
    assetPath:
      "/__l5e/assets-v1/3db00542-11be-46c7-9bed-7960c22eb5ca/story-style-diner-cook-night.png",
    kind: "scene",
  },
  {
    characterRefId: "e4d31888-fa56-4660-96bc-d6ad1542ed0f",
    styleRefId: "navajo-healer-hogan",
    region: "United States",
    description: "Navajo healer grinding herbs outside a hogan, Arizona",
    assetPath: "/__l5e/assets-v1/aff51fb2-826d-43e1-b503-d06e9828965d/navajo-healer-hogan.jpg",
    kind: "scene",
  },
  {
    characterRefId: "215ddf67-c0d7-4e4e-90a4-a13bacc0955a",
    styleRefId: "iglu-storytelling-grandmother",
    region: "Canada (Arctic)",
    description: "Inuit grandmother telling a story inside an iglu",
    assetPath:
      "/__l5e/assets-v1/f68744e1-3a45-4347-bbcd-1f61e170b1fc/iglu-storytelling-grandmother.jpg",
    kind: "scene",
  },
  {
    characterRefId: "963d7a67-cae7-4018-8791-a2c41040a16f",
    styleRefId: "hilo-tiki-carver",
    region: "United States (Hawaii)",
    description: "Native Hawaiian carver shaping a tiki figure, Hilo",
    assetPath: "/__l5e/assets-v1/8ad00499-b6db-4221-804d-8fd751e009bb/hilo-tiki-carver.jpg",
    kind: "scene",
  },
  {
    characterRefId: "7c641cb8-5223-4e88-9b96-06f33170ef91",
    styleRefId: "nile-felucca-sailor",
    region: "Egypt",
    description: "Boatman steering a felucca sailboat on the Nile, Aswan",
    assetPath:
      "/__l5e/assets-v1/0c8241d8-21e6-4e53-b29f-2bdab7dabba3/story-style-nile-felucca-sailor.png",
    kind: "scene",
  },
  {
    characterRefId: "d37ab5fa-ebcd-4387-9a58-2f59c7983260",
    styleRefId: "ethiopian-coffee",
    region: "Ethiopia",
    description: "Coffee ceremony host pouring from a jebena pot, Lalibela",
    assetPath:
      "/__l5e/assets-v1/f369eba0-3369-4f43-87f4-3eeb04e377e5/story-style-ethiopian-coffee.png",
    kind: "scene",
  },
  {
    characterRefId: "950147a1-7171-43be-b2f4-33429f70d8ba",
    styleRefId: "zulu-beadwork-artist-sheet",
    region: "South Africa",
    description: "Zulu beadwork artist threading a loom, KwaZulu-Natal",
    assetPath:
      "/__l5e/assets-v1/730b533f-f848-41af-9d42-c0d8581e341f/zulu-beadwork-artist-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "8a46ec45-4764-4cc7-b673-8823c084adbf",
    styleRefId: "lagos-talking-drummer",
    region: "Nigeria",
    description: "Yoruba drummer playing a talking drum, Lagos street celebration",
    assetPath: "/__l5e/assets-v1/46b77b1d-eca9-42ef-8d86-74c0bf50f707/lagos-talking-drummer.png",
    kind: "scene",
  },
  {
    characterRefId: "0d9d2af1-0223-46c9-a059-19a45c5a0de8",
    styleRefId: "madagascar-rice-planter",
    region: "Madagascar",
    description: "Rice farmer planting terraced paddies in the highlands",
    assetPath: "/__l5e/assets-v1/99c70ef7-1c89-4dfd-a349-00456cac582d/madagascar-rice-planter.png",
    kind: "scene",
  },
  {
    characterRefId: "06a51575-e788-45ba-b9ef-d4ebea5009d1",
    styleRefId: "marrakech-spice-merchant",
    region: "Morocco",
    description: "Spice merchant scooping spices at a Marrakech market stall",
    assetPath: "/__l5e/assets-v1/c67badf9-c9e3-4e32-aa92-83dfce924e34/marrakech-spice-merchant.jpg",
    kind: "scene",
  },
  {
    characterRefId: "f1af6160-c816-4bb7-a392-6e04ed070dd4",
    styleRefId: "kumasi-kente-weaver",
    region: "Ghana",
    description: "Kente weaver at a narrow-strip loom, Kumasi",
    assetPath: "/__l5e/assets-v1/47a4417d-fb58-493d-a4a0-5bf40e5d714f/kumasi-kente-weaver.jpg",
    kind: "scene",
  },
  {
    characterRefId: "066269c6-4977-401a-9c91-e3fe515ac533",
    styleRefId: "zanzibar-clove-harvester",
    region: "Tanzania",
    description: "Clove harvester on a spice plantation, Zanzibar",
    assetPath: "/__l5e/assets-v1/b81e3ee1-a57d-4c41-ae98-baf5ea8a3ec7/zanzibar-clove-harvester.jpg",
    kind: "scene",
  },
  {
    characterRefId: "6d1bf9f6-4a9e-4e92-b0cf-34dd4a52efe5",
    styleRefId: "madang-hoop-boy",
    region: "Papua New Guinea",
    description: "Boy running with a hoop on a jungle-fringed beach, Madang",
    assetPath: "/__l5e/assets-v1/f5b40e2b-011b-479d-a9dd-9a70c44eda98/madang-hoop-boy.jpg",
    kind: "scene",
  },
  {
    characterRefId: "39a0e2fb-8f56-475d-a2a9-ff2e1dd4e341",
    styleRefId: "greek-fisherman",
    region: "Greece",
    description: "Fisherman mending nets on a whitewashed harbor, Cyclades",
    assetPath:
      "/__l5e/assets-v1/dec667e1-3536-4c9b-a30a-3a22c9585c6c/story-style-greek-fisherman.png",
    kind: "scene",
  },
  {
    characterRefId: "ad82610f-1bdd-4459-85ec-6fc7b22c76f9",
    styleRefId: "glassblower-night",
    region: "Italy",
    description: "Glassblower shaping molten glass, Murano, Venice",
    assetPath:
      "/__l5e/assets-v1/88e87f3f-f7a6-49c4-8cf3-1de0b38762eb/story-style-glassblower-night.png",
    kind: "scene",
  },
  {
    characterRefId: "37dc301f-bb16-4962-8260-5c6038538668",
    styleRefId: "woodcarver-snow",
    region: "Poland",
    description: "Elderly woodcarver at a snow-covered cottage, Zakopane",
    assetPath:
      "/__l5e/assets-v1/572fffff-294b-472d-8356-15f30965e09c/story-style-woodcarver-snow.png",
    kind: "scene",
  },
  {
    characterRefId: "534c5b7c-b331-41b3-94ec-bb91643fb6a8",
    styleRefId: "anatolian-tea-house",
    region: "Turkey",
    description: "Tea house owner pouring tulip-glass tea, Istanbul",
    assetPath: "/__l5e/assets-v1/a3bbf43f-37a0-4fda-aded-577159c00d58/anatolian-tea-house.png",
    kind: "scene",
  },
  {
    characterRefId: "d546455c-f77d-45ff-a2a9-ecd129a89666",
    styleRefId: "bavarian-ornament-painter",
    region: "Germany",
    description: "Glass-ornament maker painting details, Ore Mountains",
    assetPath:
      "/__l5e/assets-v1/d44e3bfe-1ce3-4dff-b533-aa6cd133d382/bavarian-ornament-painter.png",
    kind: "scene",
  },
  {
    characterRefId: "0d90e5f4-4ba8-4d1e-8c30-7d723062df85",
    styleRefId: "irish-pub-fiddler",
    region: "Ireland",
    description: "Fiddler performing in a stone pub, County Clare",
    assetPath: "/__l5e/assets-v1/931e9f6d-b615-4205-a5a7-0cb7a4319f33/irish-pub-fiddler.png",
    kind: "scene",
  },
  {
    characterRefId: "6b9b89fd-747e-403e-b803-557f2a80edf1",
    styleRefId: "icelandic-shepherd",
    region: "Iceland",
    description: "Sheep farmer beside a geothermal spring under midnight sun",
    assetPath: "/__l5e/assets-v1/2d34fb08-47d4-405c-a07c-8252bbd48ffc/icelandic-shepherd.png",
    kind: "scene",
  },
  {
    characterRefId: "5cdc6873-2f22-4d68-a70a-f5183d077768",
    styleRefId: "siberian-trapper",
    region: "Russia",
    description: "Siberian trapper checking a fur trap line, Lake Baikal",
    assetPath: "/__l5e/assets-v1/aaa241f5-7b39-40d1-a1b3-b4778f0ba36b/siberian-trapper.png",
    kind: "scene",
  },
  {
    characterRefId: "7ee65483-a0dd-46f6-ab13-4679e8ea0d30",
    styleRefId: "welsh-blacksmith",
    region: "Wales",
    description: "Blacksmith hammering glowing metal at a forge, Cardiff",
    assetPath: "/__l5e/assets-v1/3f5cc2af-f338-4e64-bf96-543a595a73f2/welsh-blacksmith.png",
    kind: "scene",
  },
  {
    characterRefId: "bec7a6d5-1782-49e4-8901-653dded50def",
    styleRefId: "seville-flamenco-dancer",
    region: "Spain",
    description: "Flamenco dancer mid-spin in a Seville courtyard",
    assetPath: "/__l5e/assets-v1/64ea4730-b593-4217-a5f5-3b74d4e830f6/seville-flamenco-dancer.jpg",
    kind: "scene",
  },
  {
    characterRefId: "d4ff379a-2c64-4606-85b7-e9a1179df48c",
    styleRefId: "lisse-tulip-farmer",
    region: "Netherlands",
    description: "Tulip farmer walking fields at dawn, Lisse",
    assetPath: "/__l5e/assets-v1/b35ac521-cd8d-4c49-a31c-059775becff1/lisse-tulip-farmer.jpg",
    kind: "scene",
  },
  {
    characterRefId: "8fb919d1-268b-4247-846a-74c6aacfadeb",
    styleRefId: "nazare-net-mender",
    region: "Portugal",
    description: "Fisherman's wife mending nets, Nazare",
    assetPath: "/__l5e/assets-v1/15b6681b-1b87-4fe1-a6c2-b56d5df22d11/nazare-net-mender.jpg",
    kind: "scene",
  },
  {
    characterRefId: "7e27701e-7f2a-450a-a927-799e7c565c12",
    styleRefId: "copenhagen-pastry-baker",
    region: "Denmark",
    description: "Baker arranging pastries in a Copenhagen shop window",
    assetPath: "/__l5e/assets-v1/1c9d753c-b1dc-418f-8cca-1e846c650249/copenhagen-pastry-baker.jpg",
    kind: "scene",
  },
  {
    characterRefId: "86845117-0c06-4e63-a1af-c2a66f988ec2",
    styleRefId: "salzburg-woodcutter",
    region: "Austria",
    description: "Woodcutter splitting logs outside an alpine cabin, Salzburg",
    assetPath: "/__l5e/assets-v1/4ea709fb-d5bb-4a99-8e16-ae689c3547e1/salzburg-woodcutter.jpg",
    kind: "scene",
  },
  {
    characterRefId: "fde8b66d-091e-4aeb-8935-368b6b75d930",
    styleRefId: "svaneti-polyphonic-singer",
    region: "Georgia",
    description: "Polyphonic singer at a village feast, Svaneti",
    assetPath:
      "/__l5e/assets-v1/68af067c-99ee-4799-812e-c5a90ab830e8/svaneti-polyphonic-singer.jpg",
    kind: "scene",
  },
  {
    characterRefId: "9f306c98-5857-4f5c-8c13-dbb04f307f0f",
    styleRefId: "armenian-stonemason-sheet",
    region: "Armenia",
    description: "Stonemason carving a khachkar cross-stone, Lake Sevan",
    assetPath:
      "/__l5e/assets-v1/0125f489-ed7e-489b-b390-18aa17dc4629/story-style-armenian-stonemason-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "a6a6bfc0-aec5-4054-9df6-4b3688111bfd",
    styleRefId: "uzbek-ceramicist",
    region: "Uzbekistan",
    description: "Ceramicist painting blue glaze patterns, Samarkand",
    assetPath:
      "/__l5e/assets-v1/5f25285e-328c-4b0b-81c6-b2b171982cc4/story-style-uzbek-ceramicist.png",
    kind: "scene",
  },
  {
    characterRefId: "fe7d9e78-8912-4905-aa00-4edda9013f3d",
    styleRefId: "korean-potter-sheet",
    region: "South Korea",
    description: "Potter shaping clay on a wheel, Icheon",
    assetPath:
      "/__l5e/assets-v1/874f0d2f-98d8-4556-a04e-4580affad423/story-style-korean-potter-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "5d0c3b1e-f9f2-4976-bfba-ac50f632e8b2",
    styleRefId: "mongolian-herder",
    region: "Mongolia",
    description: "Herder standing before a ger tent on the steppe",
    assetPath:
      "/__l5e/assets-v1/f41d1df5-dc2c-4091-8059-90ce431f9c84/story-style-mongolian-herder.png",
    kind: "scene",
  },
  {
    characterRefId: "b3f060dc-3b6a-4ca9-bfa9-43f7947de40a",
    styleRefId: "tibetan-monk-sheet",
    region: "Tibet",
    description: "Monk spinning a prayer wheel at dawn, Lhasa",
    assetPath:
      "/__l5e/assets-v1/444b8473-2c5c-4d76-b067-f4426f2b17df/story-style-tibetan-monk-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "b8258792-a7ce-4b98-90c7-6f769673ff9d",
    styleRefId: "thai-longtail",
    region: "Thailand",
    description: "Longtail boat driver steering through karst waters, Krabi",
    assetPath:
      "/__l5e/assets-v1/5e7e3acd-ea26-4556-bf83-07035ef1ef3d/story-style-thai-longtail.png",
    kind: "scene",
  },
  {
    characterRefId: "96f5b3bb-fd3e-4106-a8fc-a90a775d303a",
    styleRefId: "balinese-dancer",
    region: "Indonesia",
    description: "Balinese dancer mid-pose in a temple courtyard, Ubud",
    assetPath:
      "/__l5e/assets-v1/64c3777b-7b9d-4d42-bf26-d0063451680a/story-style-balinese-dancer.png",
    kind: "scene",
  },
  {
    characterRefId: "456bbf0f-10d3-42af-9ae3-0ee15b1aadce",
    styleRefId: "tea-picker-sheet",
    region: "Sri Lanka",
    description: "Tea picker on a misty highland plantation",
    assetPath:
      "/__l5e/assets-v1/f900cee2-4603-47df-8450-9f5b5422f90a/story-style-tea-picker-sheet.png",
    kind: "sheet",
  },
  {
    characterRefId: "115d7c9c-a5a4-4089-9492-5b90f2835bed",
    styleRefId: "kashmiri-carpet-weaver",
    region: "Kashmir",
    description: "Shawl weaver at a handloom, Srinagar",
    assetPath: "/__l5e/assets-v1/e6dd13a9-8cc0-44b5-91b7-cfb25509ad61/kashmiri-carpet-weaver.png",
    kind: "scene",
  },
  {
    characterRefId: "aaf0031b-7e30-4d51-ad16-0a705a01109f",
    styleRefId: "bagan-alms-round",
    region: "Myanmar",
    description: "Novice monk carrying an alms bowl at dawn, Bagan",
    assetPath: "/__l5e/assets-v1/a805e9de-f24c-46d9-8de2-1cf70776701b/bagan-alms-round.png",
    kind: "scene",
  },
  {
    characterRefId: "b540aabb-e0ed-435a-a4a2-520ceadc959a",
    styleRefId: "khmer-stone-carver",
    region: "Cambodia",
    description: "Stone carver working sandstone reliefs, Angkor Wat",
    assetPath: "/__l5e/assets-v1/c13ab392-779f-4373-a365-290e6aeebe79/khmer-stone-carver.png",
    kind: "scene",
  },
  {
    characterRefId: "424c3750-734f-44b1-ae6c-9b3326efbed4",
    styleRefId: "singapore-hawker",
    region: "Singapore",
    description: "Hawker cook tossing noodles in a flaming wok",
    assetPath: "/__l5e/assets-v1/ad8c3231-da69-454d-812c-83288e6000bc/singapore-hawker.png",
    kind: "scene",
  },
  {
    characterRefId: "6082f4d2-61b1-4771-9d23-ab6c68a23829",
    styleRefId: "anatolian-shepherd",
    region: "Kurdistan region",
    description: "Shepherd on a ridge overlooking a valley, Zagros mountains",
    assetPath: "/__l5e/assets-v1/b3b2b11f-101c-42f7-8f78-e2a1dc6762d7/anatolian-shepherd.png",
    kind: "scene",
  },
  {
    characterRefId: "a69826a5-e90f-41ac-8b5e-98da395ddad7",
    styleRefId: "mediterranean-baker",
    region: "Lebanon",
    description: "Baker pulling manakish from a stone oven, Beirut",
    assetPath: "/__l5e/assets-v1/4dddfcc7-a664-416c-9306-a3b2b98da066/mediterranean-baker.png",
    kind: "scene",
  },
  {
    characterRefId: "99e6fbfc-b40f-49d1-b66d-57e08fe7f314",
    styleRefId: "chennai-bharatanatyam",
    region: "India",
    description: "Bharatanatyam dancer mid-pose, Chennai temple stage",
    assetPath: "/__l5e/assets-v1/18feebf4-1906-42d8-b467-d0e5ae3fbaa0/chennai-bharatanatyam.jpg",
    kind: "scene",
  },
  {
    characterRefId: "a4124e0a-8ac7-48a6-b597-85e3dc475fb5",
    styleRefId: "paro-archery-contest",
    region: "Bhutan",
    description: "Archer drawing a bamboo bow at a village contest, Paro",
    assetPath: "/__l5e/assets-v1/47f7ff03-4a28-4915-9e36-f54129e8c7c7/paro-archery-contest.jpg",
    kind: "scene",
  },
  {
    characterRefId: "209cd48d-2d1c-4cca-9224-c0fdb01feaa1",
    styleRefId: "polynesian-outrigger",
    region: "Fiji",
    description: "Outrigger sailor at the bow, skimming a turquoise lagoon",
    assetPath: "/__l5e/assets-v1/87ed804d-a564-46b1-9dbd-d3c7de4a0218/polynesian-outrigger.png",
    kind: "scene",
  },
  {
    characterRefId: "e584a916-1341-44c7-9439-1bb417f01714",
    styleRefId: "polynesian-wave-caller",
    region: "Fantasy",
    description: "Polynesian wave-caller commanding a spirit-shark wave",
    assetPath: "/__l5e/assets-v1/6e63b9df-c046-4935-82eb-22961a771f80/polynesian-wave-caller.jpg",
    kind: "scene",
  },
  {
    characterRefId: "95c0668f-5634-4933-88d4-ee4487702ad1",
    styleRefId: "griot-spirit-night",
    region: "Fantasy",
    description: "Sahel griot-mage summoning firefly-spirits at night",
    assetPath:
      "/__l5e/assets-v1/0c056167-9532-4512-b4c0-0d8a8878f92d/story-style-griot-spirit-night.png",
    kind: "scene",
  },
  {
    characterRefId: "260850ec-fe97-4c54-9b73-e8ab28dc48ca",
    styleRefId: "andean-sky-temple",
    region: "Fantasy",
    description: "Andean sky-sorceress channeling energy on a floating platform",
    assetPath:
      "/__l5e/assets-v1/2940ea1b-8f36-42d0-b6a6-911f688a2e39/story-style-andean-sky-temple.png",
    kind: "scene",
  },
  {
    characterRefId: "b5299c26-7fc9-404a-b293-2d7ae135cbe7",
    styleRefId: "dragon-tamer-cloud",
    region: "Fantasy",
    description: "Dragon-tamer girl reaching toward a cloud-dragon",
    assetPath: "/__l5e/assets-v1/6ddf85ca-986f-44cb-98ce-d532dbf9678f/dragon-tamer-cloud.jpg",
    kind: "scene",
  },
  {
    characterRefId: "aab33b28-dc8c-4b70-8a4f-7c283580d9af",
    styleRefId: "nordic-rune-wizard",
    region: "Fantasy",
    description: "Nordic rune-wizard before a glacier ice palace",
    assetPath: "/__l5e/assets-v1/74ca8247-b45c-42d4-80e1-d7d094a605d6/nordic-rune-wizard.jpg",
    kind: "scene",
  },
  {
    characterRefId: "89c8bbb7-e6fb-45d1-a3d8-fbf7f051890e",
    styleRefId: "brass-astrolabe-artifact",
    region: "Fantasy",
    description: "Glowing brass astrolabe artifact on a scholar's desk",
    assetPath: "/__l5e/assets-v1/bc78e413-8c2d-4cc4-b541-0b8dba356f18/brass-astrolabe-artifact.jpg",
    kind: "scene",
  },
  {
    characterRefId: "fbd2c0fc-c411-497c-94b8-5fc3c974f530",
    styleRefId: "iron-forged-guardian",
    region: "Fantasy",
    description: "West African iron-forged guardian spirit in a sacred grove",
    assetPath: "/__l5e/assets-v1/de79cdc8-26ef-49b8-b513-206b250669f9/iron-forged-guardian.jpg",
    kind: "scene",
  },
  {
    characterRefId: "b18709c1-2a90-40ee-ade2-c76bcaddc58a",
    styleRefId: "celestial-librarian",
    region: "Fantasy",
    description: "Celestial librarian among towering glowing scrolls",
    assetPath: "/__l5e/assets-v1/9bdca0bb-89f7-412a-8d9f-50033569f3cb/celestial-librarian.jpg",
    kind: "scene",
  },
  {
    characterRefId: "4c1165a2-512f-4a26-8d8c-23bdd4496fcc",
    styleRefId: "slavic-firebird-keeper",
    region: "Fantasy",
    description: "Slavic firebird keeper cradling a glowing chick",
    assetPath: "/__l5e/assets-v1/8b33159f-17ff-43f5-9929-9c8938753429/slavic-firebird-keeper.jpg",
    kind: "scene",
  },
];
