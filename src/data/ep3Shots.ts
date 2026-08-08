// ONIQ ORIGINALS — Episode 3 shot list.
//
// Episodes 1 and 2 are stills held under a Ken Burns move. Episode 3 is real
// generated video, which changes the unit of work: the generator caps a clip at
// TEN SECONDS, so a scene is no longer one image but several independently
// generated clips cut together. This file is that cut.
//
// Read `.claude/skills/oniq-video/references/assembling-generated-clips.md`
// before editing. Three things it settles, all of them load-bearing here:
//
// HARD CUTS INSIDE A SCENE. Dissolves only BETWEEN scenes. A cross-dissolve
// between two independently generated clips of the same subject is a morph —
// one face slides into a slightly different face over twelve frames. A cut is
// far better, because the eye cannot compare across it. It is also what makes
// the arithmetic close: with cuts, sum(shot frames in scene i) === the scene's
// frame count exactly, so sceneStartFrames, layOnTimeline and the whole bed
// envelope in audioDuck.ts keep working untouched.
//
// `transitionIn: 'dissolve'` is the deliberate exception, for the one place the
// script itself jumps in time: S11's "A house. Then a better house. Then a
// palace." Three dissolves in the episode, and they are all in that scene.
//
// MOST SHOTS HAVE NO FACE IN THEM. The answer to "thirty-three seconds is four
// takes of the same boy and he changes between them" is coverage, not better
// prompting. Four near-identical takes of one wide shot read as a glitch,
// because the eye is invited to compare them and finds the crowd rearranged.
// Four DIFFERENT shots — a wide, then hands, then an object, then a face — read
// as filmmaking. Thirty-nine of the sixty shots below have nobody recognisable
// in them, and that is the character-consistency strategy.
//
// STILL vs MOTION, same split as originals.ts and for the same reason. `still`
// is what the frame IS and feeds the image model; `motion` is what MOVES and
// goes to Veo alongside that image as the starting frame. A motion prompt that
// re-describes the subject fights the image it was given and produces drift.
//
// The per-shot FRAME allocation is not here — it is derived from the measured
// narration in remotion/src/ep3/shots.ts, which throws if it does not close.
// `weight` below is only a relative share of its own scene.

import { EP3_CAST, STORYBOOK_STYLE } from "./originals";

export type Ep3Shot = {
  /** `ep3_s01a`. Stable: it is the filename stem for the still and the clip. */
  id: string;
  /** The scene this shot covers. Shots are listed in cut order within it. */
  sceneId: string;
  /**
   * Relative share of the scene's running time. Only meaningful against its
   * siblings — [1, 2] and [2, 4] cut identically.
   */
  weight: number;
  /** What the FRAME IS. Style and cast locks are prepended by shotPromptFor. */
  still: string;
  /** What MOVES. Camera and movement only — never a re-description. */
  motion: string;
  /**
   * Cast keys locked in this shot, resolved against EP3_CAST.
   *
   * Absent means nobody recognisable is in frame — hands, an object, a crowd,
   * a figure too small or too dark to read. Do not add a lock to those: it
   * spends prompt on a face that is not there, and it invites the generator to
   * put one in.
   */
  cast?: string[];
  /**
   * Dissolve INTO this shot instead of cutting. Opt-in, and only where the
   * script jumps in time. See the note at the top of this file.
   */
  transitionIn?: "dissolve";
};

export const EP3_SHOTS: Ep3Shot[] = [
  // --- S1 — Boy on a wall -------------------------------------------------
  {
    id: "ep3_s01a",
    sceneId: "ep3_s01",
    weight: 1,
    still:
      "A busy market street in late amber light seen down its length — awnings, stacked baskets, a " +
      "water seller, dust hanging in the low sun. Far down the street a boy sits alone on a low " +
      "wall, small in the frame and doing nothing.",
    motion:
      "The crowd flows past in soft blur. Awnings lift in the warm air and dust turns in the low " +
      "light. Very slow push down the street toward the distant wall.",
  },
  {
    id: "ep3_s01b",
    sceneId: "ep3_s01",
    weight: 1.1,
    still:
      "A boy of about fifteen sitting on a low mud-brick wall doing nothing and watching " +
      "everything, the market blurred behind him, one bare heel resting against the wall.",
    motion:
      "He breathes and shifts his weight, turns his head slowly to follow a passing trader, and " +
      "blinks. One heel knocks the wall twice. The crowd streams past behind him in soft blur.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s01c",
    sceneId: "ep3_s01",
    weight: 0.9,
    still:
      "The doorway of a poor house in the same amber light: a drop spindle hanging and turning, a " +
      "basket of raw cotton, worked hands feeding the thread out. The bright street beyond the door.",
    motion:
      "The spindle turns and drops steadily. The thread draws out between finger and thumb. " +
      "Nothing else in the frame moves.",
  },

  // --- S2 — The stranger --------------------------------------------------
  {
    id: "ep3_s02a",
    sceneId: "ep3_s02",
    weight: 1,
    still:
      "The market seen from the height of the awnings: a tall figure in near-black travelling " +
      "robes with a hooded cloak and a tall wooden staff moving against the flow of the crowd, " +
      "seen from above and behind.",
    motion:
      "He moves steadily against the crowd, which parts around him. The staff plants and lifts " +
      "with each stride and the heavy cloth swings. The camera drifts slowly down toward him.",
    cast: ["magician"],
  },
  {
    id: "ep3_s02b",
    sceneId: "ep3_s02",
    weight: 1.1,
    still:
      "A tall silver-haired man crouched to a boy's height with one hand on the boy's shoulder, " +
      "smiling warmly at him; the composition slightly off balance, something subtly wrong about it.",
    motion:
      "The hand tightens very slightly on the shoulder. The smile holds a beat too long. The boy " +
      "leans back a fraction. Slow, uneasy push in.",
    cast: ["magician", "aladdin"],
  },
  {
    id: "ep3_s02c",
    sceneId: "ep3_s02",
    weight: 0.9,
    still:
      "Seen from the dim inside of a poor house looking out: a woman's silhouette standing in her " +
      "own doorway, listening to a tall visitor she is half turned away from, the bright street " +
      "behind them both.",
    motion:
      "She shifts her weight and folds her arms. The visitor's cloak moves as he talks. Neither " +
      "face is readable against the bright street. The camera holds inside the dark.",
  },
  {
    id: "ep3_s02d",
    sceneId: "ep3_s02",
    weight: 0.9,
    still:
      "A doorstep in shadow: gold coins counted one by one into a woman's open, work-worn palm, a " +
      "drop spindle set aside on the step beside her.",
    motion:
      "Coins drop one at a time and settle with weight. Her fingers close slowly around them. The " +
      "hand that gave them withdraws out of frame.",
  },

  // --- S3 — Green flame ---------------------------------------------------
  {
    id: "ep3_s03a",
    sceneId: "ep3_s03",
    weight: 1,
    still:
      "The last houses of the city behind and below, and two small figures walking out into dry " +
      "ochre hills at dusk under an enormous sky, their shadows running long behind them.",
    motion:
      "The two figures walk on, small and steady. Wind moves the dry scrub. Cloud shadow slides " +
      "across the hills. Slow crane up and back until the sky takes most of the frame.",
  },
  {
    id: "ep3_s03b",
    sceneId: "ep3_s03",
    weight: 1,
    still:
      "A gaunt silver-haired man kneeling to build a small fire of dry sticks in a hollow between " +
      "the hills, the last of the dusk light going, his tall wooden staff laid on the ground beside him.",
    motion:
      "He snaps sticks and sets them one by one. The first flame catches and grows. He reaches " +
      "into the sash at his waist. The camera settles low beside the fire.",
    cast: ["magician"],
  },
  {
    id: "ep3_s03c",
    sceneId: "ep3_s03",
    weight: 1,
    still:
      "Extreme close on a small fire from ground level, a hand scattering pale powder into it, the " +
      "flame turning an unnatural green, green light spilling out across the stones.",
    motion:
      "The powder falls and the flame flares hard green, licking upward. Smoke curls off it. The " +
      "green light spreads over the stones. The ground begins, faintly, to tremble.",
  },

  // --- S4 — The ground opens (dialogue) -----------------------------------
  {
    id: "ep3_s04a",
    sceneId: "ep3_s04",
    weight: 0.9,
    still:
      "A heavy stone slab grinding back out of the hillside, dust pouring off its edge, revealing " +
      "worn steps going down into complete darkness. Green firelight raking across the stone.",
    motion:
      "The slab grinds aside with dust sheeting off it. The dark below deepens as it opens. The " +
      "camera tilts down the steps into black.",
  },
  {
    id: "ep3_s04b",
    sceneId: "ep3_s04",
    weight: 1.2,
    still:
      "A gaunt silver-haired man lit from below by green firelight, speaking down to someone out " +
      "of frame, one hand held out toward the opening in the ground.",
    motion:
      "He speaks at length. His jaw and brow move with the words, but his eyes stay on the opening " +
      "rather than on the boy. Green light shifts across his face. Very slow push in.",
    cast: ["magician"],
  },
  {
    id: "ep3_s04c",
    sceneId: "ep3_s04",
    weight: 0.9,
    still:
      "Looking down the worn steps from over a shoulder: the first few treads lit green, then " +
      "nothing at all, the dark going down further than the light reaches.",
    motion:
      "The camera creeps forward to the lip of the opening and looks down. Green light picks out " +
      "one more tread, then gives up. Something far below is very faintly there.",
  },
  {
    id: "ep3_s04d",
    sceneId: "ep3_s04",
    weight: 1,
    still:
      "Close on two hands: an older ringed hand pushing a plain, worn ring onto a boy's finger, " +
      "green firelight on both of them.",
    motion:
      "The ring is worked over the knuckle and settles. The older hand pats it once and withdraws. " +
      "The boy's fingers close slowly over it.",
  },
  {
    id: "ep3_s04e",
    sceneId: "ep3_s04",
    weight: 0.9,
    still:
      "Looking straight down into the opening from above: worn steps descending into black, and a " +
      "boy's shoulders and the top of his head going down them.",
    motion:
      "He goes down step by step, growing smaller, until the dark takes him. Dust drifts through " +
      "the green light. The camera holds, looking down.",
  },

  // --- S5 — The jewelled garden -------------------------------------------
  {
    id: "ep3_s05a",
    sceneId: "ep3_s05",
    weight: 0.9,
    still:
      "An empty vaulted stone corridor deep underground, one shaft of pale light falling from far " +
      "above, dust turning in it, worked stone walls receding into dark.",
    motion:
      "Dust turns slowly through the shaft of light. The camera glides forward down the corridor. " +
      "Nothing else moves at all.",
  },
  {
    id: "ep3_s05b",
    sceneId: "ep3_s05",
    weight: 0.9,
    still:
      "A low underground store room exactly as it was promised: stacked sealed jars, dulled coin " +
      "spilling from a split sack, plain chests along the wall, everything ordinary and expected.",
    motion:
      "The camera tracks steadily past the jars and the chests, taking them in and moving on. A " +
      "coin rocks and settles. Nothing here is a surprise.",
  },
  {
    id: "ep3_s05c",
    sceneId: "ep3_s05",
    weight: 1.1,
    still:
      "An underground garden of trees whose fruit is cut gemstone — clear green, red and blue — " +
      "glowing faintly and lighting the whole cavern from within, with no visible light source.",
    motion:
      "The camera glides slowly between the trees. The gem fruit refracts and twinkles as the " +
      "angle changes. Faint motes drift upward through the glow.",
  },
  {
    id: "ep3_s05d",
    sceneId: "ep3_s05",
    weight: 1.1,
    still:
      "A boy standing small among the gem trees, staring up at them, then pulling the fruit down " +
      "and stuffing it into his pockets, his rolled sleeves and the front of his tunic.",
    motion:
      "He stares up, then reaches and pulls. Gem fruit drops into his tunic front. He works " +
      "faster, glancing around him. His sleeves sag with the weight.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s05e",
    sceneId: "ep3_s05",
    weight: 0.9,
    still:
      "A dented, dull brass oil lamp alone on a plain stone ledge at the end of the garden — " +
      "unlit, unremarkable, the glowing gem trees thrown out of focus behind it.",
    motion:
      "A hand enters the frame, hesitates, and lifts the lamp off the ledge. Dust lifts from where " +
      "it stood. The glow behind shifts as it is carried away.",
  },

  // --- S6 — The hand that will not reach (dialogue) -----------------------
  {
    id: "ep3_s06a",
    sceneId: "ep3_s06",
    weight: 1,
    still:
      "Looking up a stone shaft from deep below: a man silhouetted against the bright opening, " +
      "leaning in, one hand outstretched down toward the camera, his face no longer kind.",
    motion:
      "He leans further in and the outstretched hand opens and beckons twice. He speaks, sharply. " +
      "The bright sky behind him flares.",
    cast: ["magician"],
  },
  {
    id: "ep3_s06b",
    sceneId: "ep3_s06",
    weight: 1.1,
    still:
      "A boy sitting halfway up worn stone steps in the half-dark, his pockets and tunic front " +
      "bulging with jewelled fruit, looking up into the light above him.",
    motion:
      "He looks up and answers, shifting the weight in his tunic front. He tries to rise, cannot, " +
      "and settles back. The gem fruit shifts and clicks against itself.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s06c",
    sceneId: "ep3_s06",
    weight: 0.9,
    still:
      "Close on a boy's tunic front held up in both fists like a sack, heavy and sagging with " +
      "cut-gem fruit in green, red and blue, one stone working its way loose at the edge.",
    motion:
      "The fists tighten on the cloth and the load shifts and clicks. One gem works loose, teeters " +
      "on the fold, and does not quite fall. Nothing lets go.",
  },
  {
    id: "ep3_s06d",
    sceneId: "ep3_s06",
    weight: 1,
    still:
      "Extreme close on an outstretched hand against a blinding white sky, rings on the fingers, " +
      "the fingers beginning to curl inward.",
    motion:
      "The fingers curl slowly into a fist. The hand withdraws upward out of frame. Only bright, " +
      "empty sky is left behind it.",
  },
  {
    id: "ep3_s06e",
    sceneId: "ep3_s06",
    weight: 0.9,
    still:
      "Looking up at the opening in the hillside from below as the heavy stone slab slides back " +
      "across it, the bright gap narrowing to a bar of light.",
    motion:
      "The slab grinds across. The bar of light narrows steadily to a thread and closes. Dust " +
      "falls through the last of it. Then total black.",
  },

  // --- S7 — Two days in the dark ------------------------------------------
  {
    id: "ep3_s07a",
    sceneId: "ep3_s07",
    weight: 1,
    still:
      "Almost total black. A single faint gleam picks out the curve of a boy's shoulder and the " +
      "edge of a stone step; everything else in the frame is unreadable dark.",
    motion:
      "Almost nothing moves. The shoulder rises and falls with slow breathing. The faint gleam " +
      "wavers. A long, still hold.",
  },
  {
    id: "ep3_s07b",
    sceneId: "ep3_s07",
    weight: 1,
    still:
      "Almost total black with one point of light in it: two hands wringing each other, a plain " +
      "worn ring on one finger catching the single faint gleam.",
    motion:
      "The hands wring slowly over each other. A thumb passes across the ring and the gleam slides " +
      "and brightens. Everything else stays black.",
  },

  // --- S8 — The ring jinni (dialogue) -------------------------------------
  {
    id: "ep3_s08a",
    sceneId: "ep3_s08",
    weight: 0.9,
    still:
      "Total dark broken by the first hard white-gold light escaping from a plain ring on a " +
      "finger, geometric shards of light beginning to unfold outward from it.",
    motion:
      "Light bursts from the ring and unfolds rapidly outward in geometric facets, throwing hard " +
      "shadows across unseen stone. A fast bloom, then it steadies.",
  },
  {
    id: "ep3_s08b",
    sceneId: "ep3_s08",
    weight: 1.1,
    still:
      "A small, sharp, sprite-like figure of faceted white-gold light hanging in a dark stone " +
      "chamber, barely larger than a child, ribbons of light trailing where legs would be.",
    motion:
      "The figure settles out of the bloom and holds crisp and still, only the light ribbons " +
      "drifting. It speaks, and its facets shift with the words.",
    cast: ["ringJinni"],
  },
  {
    id: "ep3_s08c",
    sceneId: "ep3_s08",
    weight: 1,
    still:
      "A boy on stone steps lit hard from one side by cold white-gold light, gem fruit spilling " +
      "out of his tunic, looking up and answering.",
    motion:
      "He squints into the light, swallows, and speaks. The hard white light flickers across his " +
      "face. He does not get up.",
    cast: ["aladdin"],
  },

  // --- S9 — Cleaning the lamp ---------------------------------------------
  {
    id: "ep3_s09a",
    sceneId: "ep3_s09",
    weight: 1,
    still:
      "A humble interior in flat daylight: a low bare room, a doorway onto a bright street, and a " +
      "heap of dull gem fruit tipped out onto a cloth on the floor and ignored.",
    motion:
      "Light from the doorway shifts as someone passes outside. The gem fruit sits inert. A slow " +
      "drift across the floor toward the cloth.",
  },
  {
    id: "ep3_s09b",
    sceneId: "ep3_s09",
    weight: 1.1,
    still:
      "A careworn woman in a faded indigo head wrap sitting on the floor scrubbing a dented brass " +
      "lamp with a cloth, entirely unimpressed by it.",
    motion:
      "The cloth works back and forth on the brass and her shoulders move with it. She turns the " +
      "lamp over and starts again. Dust rises in the daylight.",
    cast: ["mother"],
  },
  {
    id: "ep3_s09c",
    sceneId: "ep3_s09",
    weight: 0.9,
    still:
      "Extreme close on the dented brass lamp under a rubbing cloth, a dull patch coming up bright " +
      "under the pressure, dust turning in a shaft of daylight.",
    motion:
      "The cloth passes over the brass and a bright patch grows. Dust turns in the light. On the " +
      "third pass the brass begins, very faintly, to glow from within.",
  },

  // --- S10 — The lamp jinni stoops (dialogue) -----------------------------
  {
    id: "ep3_s10a",
    sceneId: "ep3_s10",
    weight: 0.9,
    still:
      "A small poor room filling with dense smoke pouring upward out of a dented brass lamp on the " +
      "floor, the daylight from the doorway going out behind it.",
    motion:
      "Smoke pours from the lamp and boils upward, filling the room from the ceiling down. The " +
      "daylight from the door is swallowed. Fast at first, then slowing.",
  },
  {
    id: "ep3_s10b",
    sceneId: "ep3_s10",
    weight: 1.2,
    still:
      "A small house filled edge to edge by an enormous jinni forced to stoop under the low " +
      "ceiling beams, vast and slow and faintly comic, a boy tiny on the floor below it.",
    motion:
      "The huge shape settles and stoops, its head pressed against the beams. It speaks, slowly " +
      "and deeply. The whole room dims and brightens with it. Camera pulls back to fit it in.",
    cast: ["lampJinni", "aladdin"],
  },
  {
    id: "ep3_s10c",
    sceneId: "ep3_s10",
    weight: 0.9,
    still:
      "Low and close on the dented brass lamp lying on the floor at the centre of the room, " +
      "everything above it lost in vast moving shadow, dust sifting down past it.",
    motion:
      "Dust sifts down through the frame and settles on the brass. The shadow above swells and " +
      "shifts. The ceiling beams creak. The lamp itself does not move at all.",
  },
  {
    id: "ep3_s10d",
    sceneId: "ep3_s10",
    weight: 0.9,
    still:
      "The same small room: a woman collapsed in a faint on the floor beside an overturned stool, " +
      "a boy sitting up beside her looking upward, entirely unbothered, mid-sentence.",
    motion:
      "The woman does not move. The boy looks up, thinks for a moment, and speaks. Light from " +
      "above shifts slowly across them both.",
    cast: ["aladdin", "mother"],
  },

  // --- S11 — The palace rises (the one scene that jumps in time) ----------
  {
    id: "ep3_s11a",
    sceneId: "ep3_s11",
    weight: 1,
    still:
      "A poor room at night transformed by one impossible detail: a low table laid with heavy " +
      "silver dishes, steam rising off them, the bare cracked plaster walls unchanged behind.",
    motion:
      "Steam rises off the dishes and turns in the lamplight. A hand reaches in and lifts a cover. " +
      "Slow push in across the silver.",
  },
  {
    id: "ep3_s11b",
    sceneId: "ep3_s11",
    weight: 0.9,
    transitionIn: "dissolve",
    still:
      "A modest but sound house in daylight — a new painted door, whole shutters, a swept step. A " +
      "woman in decent cloth stands in the doorway looking out, no longer careworn.",
    motion:
      "She shades her eyes and looks up the street. The new shutters knock gently in the wind. " +
      "Slow push in on the doorway.",
    cast: ["mother"],
  },
  {
    id: "ep3_s11c",
    sceneId: "ep3_s11",
    weight: 1.1,
    transitionIn: "dissolve",
    still:
      "Dawn over the city rooftops with an enormous new palace standing behind them in golden " +
      "light where nothing stood yesterday, banners on its towers, crowds gathering below.",
    motion:
      "The camera cranes up over the rooftops to reveal the palace. Banners lift. Crowds move in " +
      "the streets below. Grand, smooth and continuous.",
  },
  {
    id: "ep3_s11d",
    sceneId: "ep3_s11",
    weight: 1.1,
    transitionIn: "dissolve",
    still:
      "A high palace terrace in warm light: a young man and a composed young woman with a " +
      "gold-beaded side braid standing together looking out over the city, at ease with each other.",
    motion:
      "They speak without looking at each other, then he turns to her and she almost smiles. Her " +
      "braid and coat lift in the wind. A slow arc around the two of them.",
    cast: ["aladdin", "princess"],
  },
  {
    id: "ep3_s11e",
    sceneId: "ep3_s11",
    weight: 0.9,
    still:
      "A palace courtyard in ordinary daylight: grain measured out from sacks to a patient queue " +
      "of townspeople, open ledgers on a trestle table, scribes working, nothing ceremonial about it.",
    motion:
      "The measure is filled, tipped and filled again. The queue shuffles forward one place. A " +
      "scribe rules a line. Steady, unhurried, a slow drift along the queue.",
  },
  {
    id: "ep3_s11f",
    sceneId: "ep3_s11",
    weight: 0.9,
    still:
      "A grand, quiet room in late light: a dented, dull brass lamp standing forgotten on a side " +
      "table behind a bowl of fruit, everything else in the room fine and new.",
    motion:
      "Late light creeps slowly across the table and over the dented brass. Nobody comes. Nothing " +
      "else moves. A very slow push in.",
  },

  // --- S12 — New lamps for old (dialogue) ---------------------------------
  {
    id: "ep3_s12a",
    sceneId: "ep3_s12",
    weight: 1,
    still:
      "A city street at midday from behind a stooped pedlar's shoulder, a wide basket of bright " +
      "new brass lamps carried on his hip, a high palace wall rising ahead of him.",
    motion:
      "He walks; the basket rocks and the new lamps knock together and flash in the sun. The crowd " +
      "parts around him. The camera follows behind at his shoulder.",
  },
  {
    id: "ep3_s12b",
    sceneId: "ep3_s12",
    weight: 1.1,
    still:
      "A stooped pedlar in a worn cloak with his head down, calling out an offer, a basket of " +
      "bright new lamps at his hip — and beneath the stoop, a gaunt silver-haired clean-shaven " +
      "face with deep-set dark eyes.",
    motion:
      "He calls out, turning his head along the street. His mouth moves on the words. He lifts his " +
      "chin once and the face beneath the hood is unmistakable.",
    cast: ["magician"],
  },
  {
    id: "ep3_s12c",
    sceneId: "ep3_s12",
    weight: 1,
    still:
      "Close on the basket: a dozen new brass lamps polished to a hard shine, packed together, one " +
      "of them lifted and turned in the sunlight.",
    motion:
      "A hand lifts one lamp and turns it slowly; the sun runs around its rim and flashes off it. " +
      "The others shift and settle in the basket.",
  },
  {
    id: "ep3_s12d",
    sceneId: "ep3_s12",
    weight: 0.9,
    still:
      "A high palace window: hands resting on the sill holding a dull dented brass lamp, the " +
      "bright street far below, the pedlar's basket a small spot of gold in it.",
    motion:
      "The hands turn the dented lamp over once, considering it. They lean out over the sill. The " +
      "basket of new lamps glints far below.",
  },

  // --- S13 — The empty square ---------------------------------------------
  {
    id: "ep3_s13a",
    sceneId: "ep3_s13",
    weight: 1,
    still:
      "Wide at dawn: a bare, level square of stone where an enormous palace stood yesterday, swept " +
      "flat, a silent staring crowd standing all around its edges.",
    motion:
      "A slow pull back across the empty stone. Dust drifts over it. The crowd barely moves. Cold, " +
      "quiet and enormous.",
  },
  {
    id: "ep3_s13b",
    sceneId: "ep3_s13",
    weight: 0.9,
    still:
      "Ground level on the bare stone: the clean rectangular scar where foundations were, a single " +
      "dropped shoe, and nothing else on the whole expanse.",
    motion:
      "The camera glides low across the swept stone. Dust skitters ahead of it. The dropped shoe " +
      "passes through frame. Nothing else at all.",
  },
  {
    id: "ep3_s13c",
    sceneId: "ep3_s13",
    weight: 1.1,
    still:
      "A young man stopped dead in the foreground of the empty square, his back to the camera, the " +
      "silent crowd behind him watching him rather than the ground.",
    motion:
      "He stands quite still, then turns his head, then his whole body. It goes across his face. " +
      "The crowd behind him does not move.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s13d",
    sceneId: "ep3_s13",
    weight: 1,
    still:
      "Close on a hand hanging at a man's side against dark cloth, a plain worn ring on the " +
      "finger, the empty stone square out of focus beyond it.",
    motion:
      "The hand opens and closes once. The thumb finds the ring and stops on it. The hand goes " +
      "still. A very slow push in.",
  },

  // --- S14 — The lamp changes hands ---------------------------------------
  {
    id: "ep3_s14a",
    sceneId: "ep3_s14",
    weight: 1,
    still:
      "A young man set down alone in a strange landscape at dusk — different trees, different " +
      "stone, a foreign palace on the horizon far off — turning to take it in.",
    motion:
      "He staggers a step as he arrives, catches himself, and turns slowly through a full circle " +
      "taking it in. Wind moves the unfamiliar trees.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s14b",
    sceneId: "ep3_s14",
    weight: 1.1,
    still:
      "A dim palace interior in low lamplight: a young man and a composed young woman with a " +
      "gold-beaded side braid standing close together, quiet and purposeful.",
    motion:
      "She speaks low and he listens, then nods once. She glances toward a door. The lamp flame " +
      "between them wavers. Minimal camera drift.",
    cast: ["aladdin", "princess"],
  },
  {
    id: "ep3_s14c",
    sceneId: "ep3_s14",
    weight: 1,
    still:
      "A gaunt silver-haired man asleep at a table with his head down on his arm in low lamplight, " +
      "a dented brass lamp standing beside his hand, a cup overturned.",
    motion:
      "He breathes slowly, deeply asleep. The lamp flame gutters. A shadow moves across the table " +
      "from off frame. He does not stir.",
    cast: ["magician"],
  },
  {
    id: "ep3_s14d",
    sceneId: "ep3_s14",
    weight: 0.9,
    still:
      "Extreme close, held breath: a hand reaching slowly into frame across a table toward a " +
      "dented brass lamp, the sleeping man's own hand lying slack beside it.",
    motion:
      "The hand crosses the table, slows, closes on the lamp, and lifts it clear without a sound. " +
      "The sleeping hand does not move.",
  },

  // --- S15 — The square is full again -------------------------------------
  {
    id: "ep3_s15a",
    sceneId: "ep3_s15",
    weight: 1,
    still:
      "First light on a city square that was bare stone yesterday: an enormous palace standing in " +
      "it, early traders unrolling awnings beneath the walls, nobody looking up.",
    motion:
      "Awnings unroll. Smoke rises from a stall. A cart is pushed through. The palace does not " +
      "move at all. A slow crane up its wall.",
  },
  {
    id: "ep3_s15b",
    sceneId: "ep3_s15",
    weight: 1,
    still:
      "Looking up the full height of the returned palace into a pale dawn sky, its towers catching " +
      "the first sun, the small business of the street going on at the bottom of frame.",
    motion:
      "A slow continuous crane up the wall until the towers and the sky fill the frame. Birds " +
      "cross. First light spreads down the stone.",
  },

  // --- S16 — Trusted with one ---------------------------------------------
  {
    id: "ep3_s16a",
    sceneId: "ep3_s16",
    weight: 0.9,
    still:
      "A quiet, well-kept room in late afternoon light: a swept floor, ordered shelves, a window " +
      "with the shutter half closed, dust turning in the light.",
    motion:
      "Dust turns slowly in the shaft of light. The half-closed shutter breathes in the warm air. " +
      "A slow drift across the room toward the shelves.",
  },
  {
    id: "ep3_s16b",
    sceneId: "ep3_s16",
    weight: 1.1,
    still:
      "An older man in plain good clothes standing at a shelf, setting a dented brass lamp " +
      "carefully into its own cleared place, a folded cloth in his other hand.",
    motion:
      "He sets the lamp down, adjusts it a fraction, and lays the folded cloth beside it. He looks " +
      "at it for a moment. Then he turns away.",
    cast: ["aladdin"],
  },
  {
    id: "ep3_s16c",
    sceneId: "ep3_s16",
    weight: 1,
    still:
      "The dented old lamp alone in its place on the shelf, the cloth folded beside it, a hand " +
      "just leaving the edge of frame, late afternoon light across the brass.",
    motion:
      "The hand withdraws out of frame. Dust turns in the light. Nothing else happens at all. A " +
      "very slow push in on the lamp.",
  },
];

/** The shots covering one scene, in cut order. */
export function shotsFor(sceneId: string): Ep3Shot[] {
  return EP3_SHOTS.filter((s) => s.sceneId === sceneId);
}

/**
 * The full image prompt for a shot: style, then frame, then cast locks.
 *
 * Same order and the same reasoning as `stillPromptFor` in originals.ts — the
 * style leads because it governs the whole image, the locks trail because they
 * are a constraint on how the people in it are drawn rather than a description
 * of the shot. Never hand-assemble this; the locks are the only thing holding
 * eleven characters to their reference sheets across fifty-four generations.
 */
export function shotPromptFor(shot: Ep3Shot): string {
  const cast = (shot.cast ?? [])
    .map((key) => EP3_CAST[key])
    .filter(Boolean)
    .join(" ");
  return [STORYBOOK_STYLE, shot.still, cast].filter(Boolean).join(" ");
}
