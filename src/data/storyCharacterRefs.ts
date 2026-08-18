/**
 * Story engine — character/scene reference manifest.
 *
 * Provenance: owner-supplied catalogue (2026-08-18), transcribed from the
 * external generation-tool manifest screenshots. These `externalAssetId`
 * values belong to that external tool, NOT to Lovable Assets — they are
 * bookkeeping only and cannot be fetched by the app. The in-repo, renderable
 * house-style frames live in `src/data/storyStyleRefs.ts`.
 *
 * Use: character-reference direction for the Story worker / ONIQ Originals.
 * Every entry is rendered in STORY_HOUSE_STYLE (hand-painted 2D storybook,
 * no photoreal, no 3D-CG). Regions marked "Fantasy" are the mythic tier.
 */

export type StoryCharacterRef = {
  /** ID in the external generation tool's library. Not a Lovable asset. */
  externalAssetId: string;
  region: string;
  description: string;
  /**
   * The in-repo, RENDERABLE frame of this same subject, when one exists —
   * an id into STORY_STYLE_REFS (src/data/storyStyleRefs.ts). Matched
   * 2026-08-18 by comparing each entry's description against the uploaded
   * frames' titles: 37 of the 74 have one. Only same-subject pairs were
   * linked; a shared region or trade alone was not enough (the outback
   * STOCKMAN is not the outback ELDER frame, the Beijing ASTRONOMER is not
   * the Jiangnan SCHOLAR). Entries without this field genuinely have no
   * picture yet, and need an upload before they are usable as frames.
   * Guarded by src/data/__tests__/storyCastMatch.test.ts.
   */
  styleRefId?: string;
};

export const STORY_CHARACTER_REFS: StoryCharacterRef[] = [
  {
    externalAssetId: "83193e07-2b3c-465b-8479-7a3f03d73464",
    region: "Jamaica",
    description: "Fishmonger woman arranging fresh fish, Port Antonio coastal market",
    styleRefId: "caribbean-fish-market",
  },
  {
    externalAssetId: "2d3a4f57-3711-43ef-bc9c-3734f931f094",
    region: "Mexico",
    description: "Oaxacan weaver working a backstrap loom in a sunlit courtyard",
    styleRefId: "oaxacan-weaver-sheet",
  },
  {
    externalAssetId: "f2343315-f56e-4f56-b859-23469bd46f15",
    region: "Haiti",
    description: "Young girl skipping rope in a Jacmel schoolyard",
    styleRefId: "jacmel-skipping-girl",
  },
  {
    externalAssetId: "eeafb8a5-b493-497b-9dd2-690dc4e5c358",
    region: "Guatemala",
    description: "Maya teenage boy carrying maize basket near Lake Atitlan",
    styleRefId: "atitlan-maize-boy",
  },
  {
    externalAssetId: "c46a818d-f272-4298-93b7-f91fd885cac2",
    region: "Cuba",
    description: "Elderly musician playing guitar on a Havana balcony",
    styleRefId: "havana-balcony-musician",
  },
  {
    externalAssetId: "2de517ea-9e7f-46f5-9eab-b59e04ef3ed4",
    region: "Panama",
    description: "Guna Yala woman arranging mola textiles, San Blas Islands",
    styleRefId: "guna-yala-mola-sheet",
  },
  {
    externalAssetId: "934e9c03-ca23-4dab-bd5d-09527ec3eb7f",
    region: "Brazil",
    description: "Carnival samba dancer mid-motion, Salvador street parade",
    styleRefId: "salvador-samba-dancer",
  },
  {
    externalAssetId: "3986709d-8be5-4944-8369-35325bedbe2f",
    region: "Colombia",
    description: "Coffee farmer hand-picking cherries, Zona Cafetera",
    styleRefId: "zona-cafetera-coffee-picker",
  },
  {
    externalAssetId: "45446c52-b612-4d13-ac5c-78e054e6fc4d",
    region: "Peru",
    description: "Amazonian shaman-healer arranging medicinal plants, Iquitos",
    styleRefId: "iquitos-shaman-healer",
  },
  {
    externalAssetId: "146887de-3573-4f8a-9bff-5716aad8977d",
    region: "Venezuela",
    description: "Warao woman weaving a hammock, Orinoco Delta",
    styleRefId: "warao-hammock-weaver-sheet",
  },
  {
    externalAssetId: "6e0aea18-bfc5-4320-a050-b7c1133516e6",
    region: "Bolivia",
    description: "Aymara market vendor with layered textiles, El Alto",
    styleRefId: "bolivian-aymara-sheet",
  },
  {
    externalAssetId: "3e78557e-f11c-4a90-a8f4-5159821a89ac",
    region: "Ecuador",
    description: "Kichwa river guide paddling a canoe, Napo River",
    styleRefId: "amazon-canoe",
  },
  {
    externalAssetId: "b7dd7c1f-6a95-400a-85a1-3fee4cb95f6a",
    region: "Chile",
    description: "Patagonian shepherd guiding sheep, Torres del Paine",
    styleRefId: "patagonian-shepherd",
  },
  {
    externalAssetId: "6ff3247b-f981-4d12-abe1-955205a2243c",
    region: "United States",
    description: "Diner cook flipping food on a griddle, rural Louisiana",
    styleRefId: "diner-cook-night",
  },
  {
    externalAssetId: "e4d31888-fa56-4660-96bc-d6ad1542ed0f",
    region: "United States",
    description: "Navajo healer grinding herbs outside a hogan, Arizona",
    styleRefId: "navajo-healer-hogan",
  },
  {
    externalAssetId: "a7a89fd9-4aab-466f-9c41-290afc745cc4",
    region: "Australia",
    description: "Outback stockman mustering cattle near Alice Springs",
  },
  {
    externalAssetId: "1fa2b9e8-685c-4704-9df8-b4810020dd5c",
    region: "United States (Alaska)",
    description: "Yupik carver shaping walrus ivory by lamplight, Bethel",
  },
  {
    externalAssetId: "215ddf67-c0d7-4e4e-90a4-a13bacc0955a",
    region: "Canada (Arctic)",
    description: "Inuit grandmother telling a story inside an iglu",
    styleRefId: "iglu-storytelling-grandmother",
  },
  {
    externalAssetId: "963d7a67-cae7-4018-8791-a2c41040a16f",
    region: "United States (Hawaii)",
    description: "Native Hawaiian carver shaping a tiki figure, Hilo",
    styleRefId: "hilo-tiki-carver",
  },
  {
    externalAssetId: "7c641cb8-5223-4e88-9b96-06f33170ef91",
    region: "Egypt",
    description: "Boatman steering a felucca sailboat on the Nile, Aswan",
    styleRefId: "nile-felucca-sailor",
  },
  {
    externalAssetId: "d37ab5fa-ebcd-4387-9a58-2f59c7983260",
    region: "Ethiopia",
    description: "Coffee ceremony host pouring from a jebena pot, Lalibela",
    styleRefId: "ethiopian-coffee",
  },
  {
    externalAssetId: "950147a1-7171-43be-b2f4-33429f70d8ba",
    region: "South Africa",
    description: "Zulu beadwork artist threading a loom, KwaZulu-Natal",
    styleRefId: "zulu-beadwork-artist-sheet",
  },
  {
    externalAssetId: "8a46ec45-4764-4cc7-b673-8823c084adbf",
    region: "Nigeria",
    description: "Yoruba drummer playing a talking drum, Lagos street celebration",
    styleRefId: "lagos-talking-drummer",
  },
  {
    externalAssetId: "0d9d2af1-0223-46c9-a059-19a45c5a0de8",
    region: "Madagascar",
    description: "Rice farmer planting terraced paddies in the highlands",
    styleRefId: "madagascar-rice-planter",
  },
  {
    externalAssetId: "06a51575-e788-45ba-b9ef-d4ebea5009d1",
    region: "Morocco",
    description: "Spice merchant scooping spices at a Marrakech market stall",
    styleRefId: "marrakech-spice-merchant",
  },
  {
    externalAssetId: "89b75ea5-adba-45d1-8b3d-946d3b7dfb41",
    region: "Morocco",
    description: "Desert guide with a camel atop a Sahara dune at sunset",
  },
  {
    externalAssetId: "f1af6160-c816-4bb7-a392-6e04ed070dd4",
    region: "Ghana",
    description: "Kente weaver at a narrow-strip loom, Kumasi",
    styleRefId: "kumasi-kente-weaver",
  },
  {
    externalAssetId: "066269c6-4977-401a-9c91-e3fe515ac533",
    region: "Tanzania",
    description: "Clove harvester on a spice plantation, Zanzibar",
    styleRefId: "zanzibar-clove-harvester",
  },
  {
    externalAssetId: "6d1bf9f6-4a9e-4e92-b0cf-34dd4a52efe5",
    region: "Papua New Guinea",
    description: "Boy running with a hoop on a jungle-fringed beach, Madang",
    styleRefId: "madang-hoop-boy",
  },
  {
    externalAssetId: "39a0e2fb-8f56-475d-a2a9-ff2e1dd4e341",
    region: "Greece",
    description: "Fisherman mending nets on a whitewashed harbor, Cyclades",
    styleRefId: "greek-fisherman",
  },
  {
    externalAssetId: "ad82610f-1bdd-4459-85ec-6fc7b22c76f9",
    region: "Italy",
    description: "Glassblower shaping molten glass, Murano, Venice",
    styleRefId: "glassblower-night",
  },
  {
    externalAssetId: "37dc301f-bb16-4962-8260-5c6038538668",
    region: "Poland",
    description: "Elderly woodcarver at a snow-covered cottage, Zakopane",
    styleRefId: "woodcarver-snow",
  },
  {
    externalAssetId: "534c5b7c-b331-41b3-94ec-bb91643fb6a8",
    region: "Turkey",
    description: "Tea house owner pouring tulip-glass tea, Istanbul",
    styleRefId: "anatolian-tea-house",
  },
  {
    externalAssetId: "d546455c-f77d-45ff-a2a9-ecd129a89666",
    region: "Germany",
    description: "Glass-ornament maker painting details, Ore Mountains",
    styleRefId: "bavarian-ornament-painter",
  },
  {
    externalAssetId: "0d90e5f4-4ba8-4d1e-8c30-7d723062df85",
    region: "Ireland",
    description: "Fiddler performing in a stone pub, County Clare",
    styleRefId: "irish-pub-fiddler",
  },
  {
    externalAssetId: "6b9b89fd-747e-403e-b803-557f2a80edf1",
    region: "Iceland",
    description: "Sheep farmer beside a geothermal spring under midnight sun",
    styleRefId: "icelandic-shepherd",
  },
  {
    externalAssetId: "5cdc6873-2f22-4d68-a70a-f5183d077768",
    region: "Russia",
    description: "Siberian trapper checking a fur trap line, Lake Baikal",
    styleRefId: "siberian-trapper",
  },
  {
    externalAssetId: "7ee65483-a0dd-46f6-ab13-4679e8ea0d30",
    region: "Wales",
    description: "Blacksmith hammering glowing metal at a forge, Cardiff",
    styleRefId: "welsh-blacksmith",
  },
  {
    externalAssetId: "bec7a6d5-1782-49e4-8901-653dded50def",
    region: "Spain",
    description: "Flamenco dancer mid-spin in a Seville courtyard",
    styleRefId: "seville-flamenco-dancer",
  },
  {
    externalAssetId: "d4ff379a-2c64-4606-85b7-e9a1179df48c",
    region: "Netherlands",
    description: "Tulip farmer walking fields at dawn, Lisse",
    styleRefId: "lisse-tulip-farmer",
  },
  {
    externalAssetId: "8fb919d1-268b-4247-846a-74c6aacfadeb",
    region: "Portugal",
    description: "Fisherman's wife mending nets, Nazare",
    styleRefId: "nazare-net-mender",
  },
  {
    externalAssetId: "611ea645-050e-4889-9386-8e8419531edb",
    region: "France",
    description: "Vintner inspecting grapes in a Bordeaux vineyard",
  },
  {
    externalAssetId: "aa796b4b-439a-4470-92bd-533025b3a20c",
    region: "Croatia",
    description: "Fisherman hauling in nets at a stone harbor, Hvar",
  },
  {
    externalAssetId: "7e27701e-7f2a-450a-a927-799e7c565c12",
    region: "Denmark",
    description: "Baker arranging pastries in a Copenhagen shop window",
    styleRefId: "copenhagen-pastry-baker",
  },
  {
    externalAssetId: "160582cc-78aa-4973-8cd0-0dc5f8f4f71a",
    region: "Switzerland",
    description: "Alpine cheesemaker stirring curd in a copper cauldron, Zermatt",
  },
  {
    externalAssetId: "86845117-0c06-4e63-a1af-c2a66f988ec2",
    region: "Austria",
    description: "Woodcutter splitting logs outside an alpine cabin, Salzburg",
    styleRefId: "salzburg-woodcutter",
  },
  {
    externalAssetId: "fde8b66d-091e-4aeb-8935-368b6b75d930",
    region: "Georgia",
    description: "Polyphonic singer at a village feast, Svaneti",
    styleRefId: "svaneti-polyphonic-singer",
  },
  {
    externalAssetId: "9f306c98-5857-4f5c-8c13-dbb04f307f0f",
    region: "Armenia",
    description: "Stonemason carving a khachkar cross-stone, Lake Sevan",
    styleRefId: "armenian-stonemason-sheet",
  },
  {
    externalAssetId: "a6a6bfc0-aec5-4054-9df6-4b3688111bfd",
    region: "Uzbekistan",
    description: "Ceramicist painting blue glaze patterns, Samarkand",
    styleRefId: "uzbek-ceramicist",
  },
  {
    externalAssetId: "fe7d9e78-8912-4905-aa00-4edda9013f3d",
    region: "South Korea",
    description: "Potter shaping clay on a wheel, Icheon",
    styleRefId: "korean-potter-sheet",
  },
  {
    externalAssetId: "5d0c3b1e-f9f2-4976-bfba-ac50f632e8b2",
    region: "Mongolia",
    description: "Herder standing before a ger tent on the steppe",
    styleRefId: "mongolian-herder",
  },
  {
    externalAssetId: "b3f060dc-3b6a-4ca9-bfa9-43f7947de40a",
    region: "Tibet",
    description: "Monk spinning a prayer wheel at dawn, Lhasa",
    styleRefId: "tibetan-monk-sheet",
  },
  {
    externalAssetId: "b8258792-a7ce-4b98-90c7-6f769673ff9d",
    region: "Thailand",
    description: "Longtail boat driver steering through karst waters, Krabi",
    styleRefId: "thai-longtail",
  },
  {
    externalAssetId: "96f5b3bb-fd3e-4106-a8fc-a90a775d303a",
    region: "Indonesia",
    description: "Balinese dancer mid-pose in a temple courtyard, Ubud",
    styleRefId: "balinese-dancer",
  },
  {
    externalAssetId: "456bbf0f-10d3-42af-9ae3-0ee15b1aadce",
    region: "Sri Lanka",
    description: "Tea picker on a misty highland plantation",
    styleRefId: "tea-picker-sheet",
  },
  {
    externalAssetId: "115d7c9c-a5a4-4089-9492-5b90f2835bed",
    region: "Kashmir",
    description: "Shawl weaver at a handloom, Srinagar",
    styleRefId: "kashmiri-carpet-weaver",
  },
  {
    externalAssetId: "aaf0031b-7e30-4d51-ad16-0a705a01109f",
    region: "Myanmar",
    description: "Novice monk carrying an alms bowl at dawn, Bagan",
    styleRefId: "bagan-alms-round",
  },
  {
    externalAssetId: "b540aabb-e0ed-435a-a4a2-520ceadc959a",
    region: "Cambodia",
    description: "Stone carver working sandstone reliefs, Angkor Wat",
    styleRefId: "khmer-stone-carver",
  },
  {
    externalAssetId: "424c3750-734f-44b1-ae6c-9b3326efbed4",
    region: "Singapore",
    description: "Hawker cook tossing noodles in a flaming wok",
    styleRefId: "singapore-hawker",
  },
  {
    externalAssetId: "6082f4d2-61b1-4771-9d23-ab6c68a23829",
    region: "Kurdistan region",
    description: "Shepherd on a ridge overlooking a valley, Zagros mountains",
    styleRefId: "anatolian-shepherd",
  },
  {
    externalAssetId: "a69826a5-e90f-41ac-8b5e-98da395ddad7",
    region: "Lebanon",
    description: "Baker pulling manakish from a stone oven, Beirut",
    styleRefId: "mediterranean-baker",
  },
  {
    externalAssetId: "31c78c3a-8f75-455b-894b-c5b6b7c9edc7",
    region: "China",
    description: "Astronomer gazing through an armillary sphere, Beijing",
  },
  {
    externalAssetId: "99e6fbfc-b40f-49d1-b66d-57e08fe7f314",
    region: "India",
    description: "Bharatanatyam dancer mid-pose, Chennai temple stage",
    styleRefId: "chennai-bharatanatyam",
  },
  {
    externalAssetId: "a4124e0a-8ac7-48a6-b597-85e3dc475fb5",
    region: "Bhutan",
    description: "Archer drawing a bamboo bow at a village contest, Paro",
    styleRefId: "paro-archery-contest",
  },
  {
    externalAssetId: "209cd48d-2d1c-4cca-9224-c0fdb01feaa1",
    region: "Fiji",
    description: "Outrigger sailor at the bow, skimming a turquoise lagoon",
    styleRefId: "polynesian-outrigger",
  },
  {
    externalAssetId: "e584a916-1341-44c7-9439-1bb417f01714",
    region: "Fantasy",
    description: "Polynesian wave-caller commanding a spirit-shark wave",
    styleRefId: "polynesian-wave-caller",
  },
  {
    externalAssetId: "95c0668f-5634-4933-88d4-ee4487702ad1",
    region: "Fantasy",
    description: "Sahel griot-mage summoning firefly-spirits at night",
    styleRefId: "griot-spirit-night",
  },
  {
    externalAssetId: "260850ec-fe97-4c54-9b73-e8ab28dc48ca",
    region: "Fantasy",
    description: "Andean sky-sorceress channeling energy on a floating platform",
    styleRefId: "andean-sky-temple",
  },
  {
    externalAssetId: "b5299c26-7fc9-404a-b293-2d7ae135cbe7",
    region: "Fantasy",
    description: "Dragon-tamer girl reaching toward a cloud-dragon",
    styleRefId: "dragon-tamer-cloud",
  },
  {
    externalAssetId: "aab33b28-dc8c-4b70-8a4f-7c283580d9af",
    region: "Fantasy",
    description: "Nordic rune-wizard before a glacier ice palace",
    styleRefId: "nordic-rune-wizard",
  },
  {
    externalAssetId: "89c8bbb7-e6fb-45d1-a3d8-fbf7f051890e",
    region: "Fantasy",
    description: "Glowing brass astrolabe artifact on a scholar's desk",
    styleRefId: "brass-astrolabe-artifact",
  },
  {
    externalAssetId: "fbd2c0fc-c411-497c-94b8-5fc3c974f530",
    region: "Fantasy",
    description: "West African iron-forged guardian spirit in a sacred grove",
    styleRefId: "iron-forged-guardian",
  },
  {
    externalAssetId: "b18709c1-2a90-40ee-ade2-c76bcaddc58a",
    region: "Fantasy",
    description: "Celestial librarian among towering glowing scrolls",
    styleRefId: "celestial-librarian",
  },
  {
    externalAssetId: "4c1165a2-512f-4a26-8d8c-23bdd4496fcc",
    region: "Fantasy",
    description: "Slavic firebird keeper cradling a glowing chick",
    styleRefId: "slavic-firebird-keeper",
  },
];

export const getStoryCharacterRefsByRegion = (region: string): StoryCharacterRef[] =>
  STORY_CHARACTER_REFS.filter((r) => r.region.toLowerCase() === region.toLowerCase());
