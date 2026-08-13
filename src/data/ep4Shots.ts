// ONIQ ORIGINALS — Episode 4 shot list: "Aladdin and the Ember King".
//
// The owner's cut of the Aladdin tale, built by the same procedure as episode
// 3 and under the same three laws — read the long header of ep3Shots.ts and
// `.claude/skills/oniq-video/references/assembling-generated-clips.md` before
// editing, because every rule there was paid for:
//
//   HARD CUTS inside a scene, dissolves only where the script jumps in time.
//   Here that is S6 alone — the lamp gathering dust "one quiet day at a time"
//   — which carries the episode's only two dissolves.
//
//   MOST SHOTS HAVE NOBODY LEGIBLE IN THEM. Coverage is the consistency
//   strategy: 33 of the 56 shots below are hands, objects, crowds, skies and
//   distant silhouettes. Where identity IS legible — even a small figure whose
//   clothing reads — the shot carries its cast lock, because ep3's pilot
//   proved a wide shot can re-invent a character as easily as a close-up.
//
//   STILL is what the frame IS; MOTION is what MOVES. The video model gets
//   the image plus `motion` only — never a re-description, never a name.
//
// The cast and props resolve against EP4_CAST and EP3_PROPS: episode 3's
// people and lamp verbatim, with ONE recast — this film's jinni is the Ember
// King, not ep3's night-sky being. See EP4_CAST in originals.ts for why.

import { EP3_PROPS, EP4_CAST, STORYBOOK_STYLE } from "./originals";

export type Ep4Shot = {
  /** `ep4_s01a`. Stable: it is the filename stem for the still and the clip. */
  id: string;
  /** The scene this shot covers. Shots are listed in cut order within it. */
  sceneId: string;
  /** Relative share of the scene's running time, against its siblings only. */
  weight: number;
  /** What the FRAME IS. Style and cast locks are prepended by shotPromptFor. */
  still: string;
  /** What MOVES. Camera and movement only — never a re-description. */
  motion: string;
  /** Cast keys locked in this shot, resolved against EP4_CAST. */
  cast?: string[];
  /** Recurring props in frame, resolved against EP3_PROPS. */
  props?: string[];
  /** Dissolve INTO this shot instead of cutting. Only where time jumps. */
  transitionIn?: "dissolve";
};

export const EP4_SHOTS: Ep4Shot[] = [
  // --- S1 — Clever hands --------------------------------------------------
  {
    id: "ep4_s01a",
    sceneId: "ep4_s01",
    weight: 1,
    still:
      "A crowded bazaar lane in late amber light seen down its length: awnings, hanging cloth, " +
      "pyramids of dates and spice, a water seller, dust hanging golden in the low sun, the " +
      "crowd thick and busy.",
    motion:
      "The crowd flows in both directions. Awnings breathe in the warm air and dust turns in " +
      "the light. Slow push down the lane.",
  },
  {
    id: "ep4_s01b",
    sceneId: "ep4_s01",
    weight: 1.1,
    still:
      "A boy in his early teens weaving through the bazaar crowd mid-stride, flipping a date " +
      "into his mouth, grinning, one hand trailing along a stall edge, vendors amused rather " +
      "than angry.",
    motion:
      "He slips between two porters without breaking stride, catches the date, and grins. The " +
      "crowd parts and closes around him. Tracking alongside at his pace.",
    cast: ["aladdin"],
  },
  {
    id: "ep4_s01c",
    sceneId: "ep4_s01",
    weight: 0.9,
    still:
      "Close on a date stall: an old vendor's hands pushing a date across the counter with mock " +
      "sternness, other market hands weighing and passing goods, coins on worn wood, warm light.",
    motion:
      "The hand pushes the date forward and taps the counter twice. Coins are swept up. The " +
      "market's hands keep trading around the frame.",
  },

  // --- S2 — The garden of stone fruit -------------------------------------
  {
    id: "ep4_s02a",
    sceneId: "ep4_s02",
    weight: 1,
    still:
      "A steep stone stair descending into the earth, lit from below by a soft glow that is not " +
      "fire and not day, the last of the surface light fading behind.",
    motion:
      "Dust falls gently through the shaft of glow. The light below pulses once, slowly, like " +
      "breathing. Slow tilt down the stairway.",
  },
  {
    id: "ep4_s02b",
    sceneId: "ep4_s02",
    weight: 1.1,
    still:
      "An underground garden lit by no visible source: rows of dark trees bearing fruit of " +
      "clear green, red and blue stone, the light caught inside each fruit, the cave roof lost " +
      "in darkness above.",
    motion:
      "Light glimmers through the stone fruit as if each one breathed. Nothing else moves. " +
      "Slow pan across the trees.",
  },
  {
    id: "ep4_s02c",
    sceneId: "ep4_s02",
    weight: 0.9,
    still:
      "Close on a young hand closing around a pear of clear green stone and lifting it from " +
      "the branch, the glow lighting the fingers from inside the fruit.",
    motion:
      "The hand turns the stone fruit once in the light, then draws it out of frame. The " +
      "branch sways back. The glow flares softly on the fingers.",
  },
  {
    id: "ep4_s02d",
    sceneId: "ep4_s02",
    weight: 1,
    still:
      "Beyond the last trees, a bare rock ledge in the cave wall holding one small dull brass " +
      "oil lamp, dented and unpolished, the least splendid thing in a cave full of jewels.",
    motion:
      "Dust motes drift through the glow. The stone-fruit light glimmers at the frame's edge. " +
      "Very slow push in on the lamp.",
    props: ["lamp"],
  },

  // --- S3 — The Ember King rises ------------------------------------------
  {
    id: "ep4_s03a",
    sceneId: "ep4_s03",
    weight: 0.9,
    still:
      "Close on two young hands rubbing dust from the side of a small dented brass oil lamp, " +
      "and the first thin line of smoke leaking from its spout, lit by the cave's strange glow.",
    motion:
      "The thumb wipes across the brass. Smoke leaks from the spout, thin and questioning, " +
      "then thickens. Handheld drift, barely perceptible.",
    props: ["lamp"],
  },
  {
    id: "ep4_s03b",
    sceneId: "ep4_s03",
    weight: 1.1,
    still:
      "A towering jinni of smoke and living ember mid-formation in a dark cave: shoulders and " +
      "a crowned head gathering out of rising smoke, embers drifting upward through him, the " +
      "cave walls lit orange to the roof.",
    motion:
      "Smoke coils upward and thickens into shoulders and a head. Embers drift and scatter " +
      "through the body. Slow tilt up his full height.",
    cast: ["lampJinni"],
  },
  {
    id: "ep4_s03c",
    sceneId: "ep4_s03",
    weight: 1,
    still:
      "A boy in his early teens lit hard orange from below, looking up at something enormous " +
      "off frame, awed but not cowering, the small lamp held tight in both hands.",
    motion:
      "Firelight plays over his face. His chin lifts as his eyes climb higher. He does not " +
      "step back. Slow push in.",
    cast: ["aladdin"],
    props: ["lamp"],
  },
  {
    id: "ep4_s03d",
    sceneId: "ep4_s03",
    weight: 1,
    still:
      "The Ember King's face filling the frame: features of banked coals and drifting smoke, " +
      "eyes like blown embers brightening, the first hint of a smile forming in the fire.",
    motion:
      "The ember eyes brighten. The smile forms slowly, coal by coal. Sparks scatter upward " +
      "past the face. Static camera, locked off.",
    cast: ["lampJinni"],
  },

  // --- S4 — Splendour, carefully ------------------------------------------
  {
    id: "ep4_s04a",
    sceneId: "ep4_s04",
    weight: 0.9,
    still:
      "The city at dusk from above: flat rooftops, minaret shadows, window lights beginning " +
      "to prick on, and one bare hill standing empty above the houses.",
    motion:
      "Window lights come on one by one across the rooftops. Smoke rises from evening " +
      "fires. Slow pan toward the bare hill.",
  },
  {
    id: "ep4_s04b",
    sceneId: "ep4_s04",
    weight: 1.1,
    still:
      "Streams of ember-light pouring down out of the night sky onto the bare hill, marble " +
      "walls and arches half-assembled inside the glow, scaffolds of light where towers will " +
      "be.",
    motion:
      "The ember streams pour and weave. Walls rise inside the light, course by course. " +
      "Sparks scatter where the light touches stone. Slow push in.",
  },
  {
    id: "ep4_s04c",
    sceneId: "ep4_s04",
    weight: 0.9,
    still:
      "Close on a marble terrace rail as the last ember-light settles into the stone and " +
      "fades, leaving polished marble and gold inlay, a silk banner above it new and still.",
    motion:
      "The ember-light sinks into the stone and goes out like a tide withdrawing. The banner " +
      "lifts once in the night wind. Slow pan along the rail.",
  },
  {
    id: "ep4_s04d",
    sceneId: "ep4_s04",
    weight: 1.1,
    still:
      "The finished palace above the city at full night: lamplit arches and domes on the " +
      "hill, the city below with every street out watching, tiny and still.",
    motion:
      "Banners lift in the wind. Lamplight flickers in the arches. Crane rise until the " +
      "palace fills the frame.",
  },

  // --- S5 — The princess counts -------------------------------------------
  {
    id: "ep4_s05a",
    sceneId: "ep4_s05",
    weight: 0.9,
    still:
      "A palace hall in warm lamplight: a wide bowl of jewelled stone fruit on a low table, " +
      "green and red and blue, glowing faintly from inside, attendants' hems at the frame " +
      "edge.",
    motion:
      "The stones glimmer as the lamplight moves. A silk hem passes at frame edge. Slow " +
      "push in on the bowl.",
  },
  {
    id: "ep4_s05b",
    sceneId: "ep4_s05",
    weight: 1.1,
    still:
      "A young princess in emerald and gold holding one stone fruit up to the light, one " +
      "eye narrowed, examining it with a merchant's appraisal rather than a bride's delight.",
    motion:
      "She turns the stone slowly in her fingers, tilts it against the light, and her " +
      "narrowed eye steadies. Slow push in on her face.",
    cast: ["princess"],
  },
  {
    id: "ep4_s05c",
    sceneId: "ep4_s05",
    weight: 1,
    still:
      "Over the princess's shoulder: a young man across the hall watching her examine his " +
      "gift, hands clasped behind him, hopeful and a little exposed, attendants at the walls.",
    motion:
      "He shifts his weight and stills himself. Lamplight flickers on the walls. " +
      "Over-the-shoulder hold, then a very slow push past her toward him.",
    cast: ["princess", "aladdin"],
  },
  {
    id: "ep4_s05d",
    sceneId: "ep4_s05",
    weight: 1,
    still:
      "Close on the princess as her eyes lift from the jewel to the young man off frame: the " +
      "appraisal finishing, the verdict arriving, the beginning of an interested smile.",
    motion:
      "Her eyes lift. The smile arrives slowly and stops halfway, held. The lamp flame " +
      "sways once behind her. Static camera, locked off.",
    cast: ["princess"],
  },

  // --- S6 — The shelf (the only dissolves in the film: days passing) ------
  {
    id: "ep4_s06a",
    sceneId: "ep4_s06",
    weight: 1.1,
    still:
      "A rich alcove shelf in morning light: a hand in a fine sleeve pushing the small dented " +
      "brass oil lamp to the back, behind silver ewers and glass, the lamp half-lost in " +
      "shadow.",
    motion:
      "The hand sets the lamp back and withdraws. The finer things gleam in front of it. " +
      "Slow pull back from the shelf.",
    props: ["lamp"],
  },
  {
    id: "ep4_s06b",
    sceneId: "ep4_s06",
    weight: 1,
    still:
      "The same shelf in low afternoon light, days later: the dented lamp exactly where it " +
      "was, a thin line of dust along its spout, the silver in front polished bright.",
    motion:
      "Dust turns in the shaft of light. The sun's angle slides slowly along the shelf. " +
      "Nothing else moves. Very slow push in on the lamp.",
    props: ["lamp"],
    transitionIn: "dissolve",
  },
  {
    id: "ep4_s06c",
    sceneId: "ep4_s06",
    weight: 1,
    still:
      "The same shelf at night, much later: the lamp deep in shadow behind the bright " +
      "things, only the curve of its handle catching a distant lamplight, dust thick now.",
    motion:
      "The distant lamplight flickers on the handle's curve. A moth crosses the frame once. " +
      "Very slow push in.",
    props: ["lamp"],
    transitionIn: "dissolve",
  },
  {
    id: "ep4_s06d",
    sceneId: "ep4_s06",
    weight: 0.9,
    still:
      "The rich palace room wide at dusk: musicians' cushions, silk, low tables and wealth " +
      "everywhere, the alcove shelf tiny in a corner of the frame, the lamp an unnoticeable " +
      "speck.",
    motion:
      "Curtains stir. Lights come on one by one, warming the room. The alcove stays dark. " +
      "Slow pull back.",
    props: ["lamp"],
  },

  // --- S7 — New lamps for old ---------------------------------------------
  {
    id: "ep4_s07a",
    sceneId: "ep4_s07",
    weight: 1,
    still:
      "A wooden barrow stacked with bright new brass oil lamps at dusk, polished and " +
      "catching the last light like coals, palace walls rising pale behind.",
    motion:
      "The barrow rocks as it is set down. The new lamps glint as they shift. Slow pan " +
      "along the gleaming rows.",
    props: ["newLamps"],
  },
  {
    id: "ep4_s07b",
    sceneId: "ep4_s07",
    weight: 1.2,
    still:
      "A tall gaunt pedlar beside his barrow of new lamps, calling up toward the palace " +
      "windows, arms spread in mock generosity, his shadow stretched far too long for the " +
      "hour.",
    motion:
      "His arms spread wider as he calls. His head tilts up toward a window. The too-long " +
      "shadow stays perfectly still while he moves. Slow push in.",
    cast: ["magician"],
    props: ["newLamps"],
  },
  {
    id: "ep4_s07c",
    sceneId: "ep4_s07",
    weight: 0.9,
    still:
      "A palace balcony from below at dusk: a maid leaning over the rail laughing at " +
      "something in the street, silhouetted against warm interior light, one hand on the " +
      "rail.",
    motion:
      "She laughs and leans further over the rail, then turns back toward the room with a " +
      "thought. Low angle looking up, static.",
  },
  {
    id: "ep4_s07d",
    sceneId: "ep4_s07",
    weight: 1,
    still:
      "The trade, close: a maid's hand passing the small dented old lamp down, and long " +
      "gaunt ringed fingers closing around it, a bright new lamp already being handed up " +
      "in the other hand.",
    motion:
      "The gaunt fingers close slowly around the dented lamp and tighten. The new lamp " +
      "passes upward. The exchange completes. Handheld drift, barely perceptible.",
    props: ["lamp", "newLamps"],
  },

  // --- S8 — The morning after ---------------------------------------------
  {
    id: "ep4_s08a",
    sceneId: "ep4_s08",
    weight: 1.1,
    still:
      "Dawn over a flat-roofed city of domes and minarets: the hill where the palace " +
      "stood now bare, a vast perfect rectangle of crushed pale grass and nothing else, " +
      "birds circling the empty air above it.",
    motion:
      "Birds wheel slowly over the empty ground. Fog rolls low across the crushed grass. " +
      "Slow pull back from the bare hilltop.",
  },
  {
    id: "ep4_s08b",
    sceneId: "ep4_s08",
    weight: 0.9,
    still:
      "Close on the crushed grass at dawn: every blade pressed flat in one direction, " +
      "already beginning to spring back, dew on the bent stems, a single fallen silk " +
      "tassel.",
    motion:
      "One blade of grass slowly rights itself. Dew slides down a stem. Fog drifts " +
      "through the frame low. Very slow push in on the tassel.",
  },
  {
    id: "ep4_s08c",
    sceneId: "ep4_s08",
    weight: 0.9,
    still:
      "The flat-roofed city below waking to the absence: narrow streets between mud-brick " +
      "houses and minarets filling with distant small figures stopping and pointing up at " +
      "the empty hill, washing lines abandoned mid-hang.",
    motion:
      "Small figures gather and point upward. A dropped basket rolls. The crowd thickens " +
      "toward the hill. High angle looking down, static.",
  },
  {
    id: "ep4_s08d",
    sceneId: "ep4_s08",
    weight: 1.1,
    still:
      "A young man standing alone in the middle of the vast crushed rectangle, small " +
      "against the dawn sky, head bowed not in grief but in thought, one hand rubbing a " +
      "ring on the other.",
    motion:
      "He turns slowly in place, reading the flattened ground like a page. His thumb " +
      "works the ring. Crane rise, slow, leaving him smaller in the emptiness.",
    cast: ["aladdin"],
  },

  // --- S9 — The road west --------------------------------------------------
  {
    id: "ep4_s09a",
    sceneId: "ep4_s09",
    weight: 1,
    still:
      "A long desert road under high hard sun: packed pale earth running dead straight to " +
      "the horizon between low dunes, heat shimmer standing on it like water.",
    motion:
      "Heat shimmer rises and bends the horizon. Sand hisses across the road in a thin " +
      "sheet. Slow push down the road.",
  },
  {
    id: "ep4_s09b",
    sceneId: "ep4_s09",
    weight: 0.9,
    still:
      "Close on worn brown sandals striding the packed earth, each step raising a small " +
      "puff of dust, the pace even and unhurried and certain.",
    motion:
      "The sandals stride through frame, one-two, dust puffing at each strike. Tracking " +
      "alongside at exactly their pace.",
  },
  {
    id: "ep4_s09c",
    sceneId: "ep4_s09",
    weight: 1.1,
    still:
      "A young man walking the desert road with a small bundle over his shoulder, sun " +
      "high, eyes forward, the expression of a man doing arithmetic rather than grieving.",
    motion:
      "His stride eats the road, even and unhurried. The bundle sways at his back. Heat " +
      "shimmer wavers between him and the camera. Tracking alongside.",
    cast: ["aladdin"],
  },
  {
    id: "ep4_s09d",
    sceneId: "ep4_s09",
    weight: 1,
    still:
      "The dunes at evening from a high ridge: the road a thin scratch across them, a " +
      "single tiny unreadable silhouette moving west along it, the sky going gold and " +
      "violet.",
    motion:
      "The tiny silhouette moves steadily along the scratch of road. Sand smokes off a " +
      "dune crest. The colours deepen. Static camera, locked off.",
  },

  // --- S10 — The lamp in the window ---------------------------------------
  {
    id: "ep4_s10a",
    sceneId: "ep4_s10",
    weight: 1.1,
    still:
      "A green valley at dusk a long way from anywhere, and standing in it wrong and " +
      "white and complete: the stolen palace, its domes pale against dark hills.",
    motion:
      "Evening birds cross the valley. Mist gathers along the stream line. Slow push " +
      "toward the pale palace.",
  },
  {
    id: "ep4_s10b",
    sceneId: "ep4_s10",
    weight: 0.9,
    still:
      "The palace walls closer at dusk: windows coming alight one by one down its " +
      "length, lanterns and braziers, the building performing wealth to an empty valley.",
    motion:
      "Windows light one after another. Brazier smoke rises from the terraces. Slow pan " +
      "along the lit length of the wall.",
  },
  {
    id: "ep4_s10c",
    sceneId: "ep4_s10",
    weight: 1,
    still:
      "One high window apart from the rest: a small brass oil lamp set on the sill, lit, " +
      "its flame steady, where anyone else would have hung jewels.",
    motion:
      "The tiny flame leans and rights itself, steady. Other windows flicker; this one " +
      "holds. Very slow push in toward the sill.",
    props: ["lamp"],
  },
  {
    id: "ep4_s10d",
    sceneId: "ep4_s10",
    weight: 1,
    still:
      "A young man among dark rocks below the palace, looking up at one lit window, the " +
      "rising moon behind him, the beginning of a smile: a message received.",
    motion:
      "His eyes fix on the window and the smile arrives. The moon clears the rocks " +
      "behind him. Slow push in on his face.",
    cast: ["aladdin"],
  },
  {
    id: "ep4_s10e",
    sceneId: "ep4_s10",
    weight: 0.8,
    still:
      "Extreme close on the little lamp flame in the window: steady, patient, doubled in " +
      "the dark glass, the valley night vast and out of focus beyond.",
    motion:
      "The flame breathes but does not gutter. Its reflection trembles in the glass. " +
      "Static camera, locked off.",
    props: ["lamp"],
  },

  // --- S11 — Her feast, his climb -----------------------------------------
  {
    id: "ep4_s11a",
    sceneId: "ep4_s11",
    weight: 1.1,
    still:
      "A laden feast table in warm lamplight: a young princess in emerald pouring dark " +
      "wine for a tall gaunt man, her attention perfect, his face lit with vanity, the " +
      "night window bright with moon behind them.",
    motion:
      "She pours slowly and evenly. He leans back, savouring being attended. Neither " +
      "looks at the window. Slow push in past the table.",
    cast: ["princess", "magician"],
  },
  {
    id: "ep4_s11b",
    sceneId: "ep4_s11",
    weight: 0.9,
    still:
      "The gaunt man mid-story, goblet raised, rings catching the lamplight, eyes only " +
      "on the princess listening across the table with her chin on her hand.",
    motion:
      "The goblet gestures through the story's climax. The rings flash. His eyes never " +
      "leave her. Over-the-shoulder hold.",
    cast: ["magician", "princess"],
  },
  {
    id: "ep4_s11c",
    sceneId: "ep4_s11",
    weight: 1,
    still:
      "Through the bright window behind the feast: far up the moonlit outer wall, a " +
      "small dark figure climbing hand over hand between the stones, unreadable at this " +
      "distance.",
    motion:
      "The small figure gains one handhold, then another, patient against the pale " +
      "stone. Moonlit mist drifts below. Slow push toward the window glass.",
  },
  {
    id: "ep4_s11d",
    sceneId: "ep4_s11",
    weight: 1,
    still:
      "Close on the princess mid-laugh at the feast: eyes flicking for half a heartbeat " +
      "to the window behind her guest and back, the laugh never faltering.",
    motion:
      "Her eyes flick to the window and return before the laugh ends. She refills his " +
      "goblet without being asked. Static camera, locked off.",
    cast: ["princess"],
  },

  // --- S12 — Rooftops by moonlight ----------------------------------------
  {
    id: "ep4_s12a",
    sceneId: "ep4_s12",
    weight: 1.1,
    still:
      "Moonlit palace rooftops in blue and silver: a young man crossing the high ridge " +
      "of tiles between two domes, arms out for balance, mist soft and far below.",
    motion:
      "He crosses the ridge in quick sure steps, arms out. Wind moves his clothes. " +
      "Tracking alongside him across the rooftop.",
    cast: ["aladdin"],
  },
  {
    id: "ep4_s12b",
    sceneId: "ep4_s12",
    weight: 0.9,
    still:
      "Close on bare quick feet finding the ridge line of moonlit tiles, one step then " +
      "another, the drop beyond them soft with mist and moon.",
    motion:
      "The feet take the ridge one sure step at a time. A loose tile shifts and is " +
      "left behind. Mist drifts across the drop. Tracking alongside.",
  },
  {
    id: "ep4_s12c",
    sceneId: "ep4_s12",
    weight: 1,
    still:
      "The young man balanced on the rooftop ridge against an enormous low moon, arms " +
      "out, a market boy's grace at a killing height, silver light on the domes.",
    motion:
      "He steadies, walks the last of the ridge toward the moon, and drops lightly out " +
      "of frame beyond it. Low angle, static.",
    cast: ["aladdin"],
  },

  // --- S13 — Whose hand holds the lamp ------------------------------------
  {
    id: "ep4_s13a",
    sceneId: "ep4_s13",
    weight: 0.9,
    still:
      "A dim treasure room: gold and silk heaped in shadow, and in the centre, honoured " +
      "on a velvet stand under a single hanging light, the small dented brass oil lamp.",
    motion:
      "The hanging light sways almost imperceptibly, moving the shadows. Dust turns " +
      "above the velvet. Slow push in on the lamp.",
    props: ["lamp"],
  },
  {
    id: "ep4_s13b",
    sceneId: "ep4_s13",
    weight: 1,
    still:
      "A young man lifting the dented lamp from its velvet stand, the first coil of " +
      "smoke already rising from the spout, his face half-lit and resolved.",
    motion:
      "He lifts the lamp and the smoke thickens as if waking. His grip settles. " +
      "Handheld drift, barely perceptible, tightening on the lamp.",
    cast: ["aladdin"],
    props: ["lamp"],
  },
  {
    id: "ep4_s13c",
    sceneId: "ep4_s13",
    weight: 1,
    still:
      "The treasure room doorway bursting with lamplight: a tall gaunt silhouette " +
      "filling it, staff raised, robes flaring, the shadow thrown across the treasure " +
      "long and crooked.",
    motion:
      "The doorway light flares. The staff rises. The long shadow sweeps across the " +
      "gold. Smoke begins to curl into the frame from off screen. Static, locked off.",
    cast: ["magician"],
  },
  {
    id: "ep4_s13d",
    sceneId: "ep4_s13",
    weight: 1.1,
    still:
      "The Ember King risen to the treasure room roof between the boy and the doorway: " +
      "a wall of smoke and burning coals facing the intruder, the boy small and steady " +
      "beneath him with the lamp in both hands.",
    motion:
      "The jinni's embers brighten from banked to blazing. Smoke rolls along the " +
      "ceiling. The boy holds still. Slow tilt up the jinni toward the fire.",
    cast: ["lampJinni", "aladdin"],
    props: ["lamp"],
  },

  // --- S14 — Cleverness beats magic ---------------------------------------
  {
    id: "ep4_s14a",
    sceneId: "ep4_s14",
    weight: 1,
    still:
      "The home city at night as the palace descends onto its hill in streams of " +
      "ember-light, exactly where it had stood, windows already glowing, the city " +
      "erupting below.",
    motion:
      "The ember streams set the palace down and sink into the hill. Windows flare " +
      "warm. Tiny crowds surge in the streets. Slow pull back.",
  },
  {
    id: "ep4_s14b",
    sceneId: "ep4_s14",
    weight: 0.9,
    still:
      "The festival bazaar at night: fires and lanterns, musicians, food smoke, dancing " +
      "crowds shoulder to shoulder, embers rising off the fires into the dark.",
    motion:
      "The crowd dances and the drums move them. Embers stream upward from the fires. " +
      "Lantern light swings. Tracking slowly through the celebration.",
  },
  {
    id: "ep4_s14c",
    sceneId: "ep4_s14",
    weight: 1.1,
    still:
      "The highest palace terrace at night, from behind: a young man and a young " +
      "princess side by side at the balustrade, her emerald and his plain cotton, " +
      "watching their glowing city below.",
    motion:
      "Festival embers drift up past the terrace like slow stars. Her head tilts to " +
      "rest toward his shoulder. Neither moves otherwise. Slow push in from behind.",
    cast: ["aladdin", "princess"],
  },
  {
    id: "ep4_s14d",
    sceneId: "ep4_s14",
    weight: 0.9,
    still:
      "Close on the terrace balustrade: two hands resting near each other on the " +
      "marble, one ringed and fine, one plain and quick, festival light warm on both, " +
      "embers drifting past beyond.",
    motion:
      "Embers drift up through the frame. The plain hand slides over and rests on the " +
      "fine one. The lights below flicker warm. Static camera, locked off.",
  },
  {
    id: "ep4_s14e",
    sceneId: "ep4_s14",
    weight: 1.1,
    still:
      "The whole city from high above at night, whole again: the palace bright on its " +
      "hill, the bazaar a river of fire and lanterns, embers rising like stars going " +
      "back where they belonged.",
    motion:
      "Embers climb slowly toward the camera like a star field in reverse. The city " +
      "lights shimmer. Crane up and pull back until the night holds the frame.",
  },
];

/** The shots covering one scene, in cut order. */
export function shotsFor(sceneId: string): Ep4Shot[] {
  return EP4_SHOTS.filter((s) => s.sceneId === sceneId);
}

/**
 * The full image prompt for a shot: style, then frame, then cast locks, then
 * prop locks. Same order and same reasoning as ep3's shotPromptFor — the
 * style governs the whole image so it leads; locks constrain how things in
 * the frame are drawn so they trail. Never hand-assemble this.
 */
export function shotPromptFor(shot: Ep4Shot): string {
  const cast = (shot.cast ?? [])
    .map((key) => EP4_CAST[key])
    .filter(Boolean)
    .join(" ");
  const props = (shot.props ?? [])
    .map((key) => EP3_PROPS[key])
    .filter(Boolean)
    .join(" ");
  return [STORYBOOK_STYLE, shot.still, cast, props].filter(Boolean).join(" ");
}
