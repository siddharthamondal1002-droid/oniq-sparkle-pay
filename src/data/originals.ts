// ONIQ ORIGINALS — season one shot list.
//
// Data only. No I/O, no secrets, no React. This is the source of truth the
// admin video tool reads to pre-fill a Runway job, and it is deliberately
// separate from that tool so the scripts can be reviewed and diffed on their
// own.
//
// TWO PROMPTS PER SCENE, ON PURPOSE:
//   stillPrompt  — what the frame IS. Fed to image generation.
//   motionPrompt — what MOVES in it. Fed to Runway, which animates the still.
// Runway is image-to-video: it takes the frame as given and adds motion. A
// motion prompt that re-describes the subject fights the image and produces
// drift, so these describe camera and movement only.
//
// COMPLIANCE (carried from the scripts, do not quietly relax):
// no prophet, no divine figure, no scripture; the jar's seal is an unreadable
// mark, never attributed; jinn are folkloric wonder-beings with no
// theological framing; violence is implied and never depicted in any frame.

export type Scene = {
  /** Storage-safe id. The still lives at video-gen/stills/<id>.png. */
  id: string;
  /** Human label in the admin picker. */
  label: string;
  /** Frame description for image generation. */
  stillPrompt: string;
  /** Camera and movement only, for Runway. */
  motionPrompt: string;
  /** Keys into the owning episode's `cast`, for whoever appears in frame. */
  cast?: string[];
};

export type Episode = {
  id: string;
  number: number;
  title: string;
  runtime: string;
  /** Rendering style for this episode's stills. Omit to use HOUSE_STYLE. */
  style?: string;
  /** Locked appearances for recurring characters, keyed by `Scene.cast`. */
  cast?: Record<string, string>;
  /** Music bed prompt. Recorded so the bed can be regenerated, like `style`. */
  bed?: string;
  scenes: Scene[];
};

/**
 * The season default: a photoreal-leaning matte painting.
 *
 * This is what Episode 1 was generated with and what it still looks like.
 */
export const HOUSE_STYLE =
  'Painterly cinematic illustration, hand-painted matte-painting feel, warm desert palette ' +
  'of sand ochre, deep teal shadow and ember gold, soft volumetric light, film grain, ' +
  'no text, no lettering, no watermark, no modern objects.';

/**
 * STORYBOOK — the look of the Firefly Forest short, chosen by the project
 * owner for Episode 2 (2026-08-08) from a reference clip.
 *
 * What was taken from the reference is the RENDERING, not the setting.
 *
 * REWRITTEN AFTER THE FIRST GENERATION, which produced three faults. All
 * three came from this string, not from the generator, and the failed wording
 * is recorded because the mistakes are easy to make again.
 *
 * 1. TIME OF DAY. The first version asked for "warm amber and gold light
 *    against deep violet and blue shadow" — the reference's palette. But the
 *    reference is a NIGHT forest, and that phrasing is a night instruction
 *    wearing a palette's clothes. It beat the scene text: S4 and S5 are an
 *    afternoon on a dry hill road and came back as full night with torches,
 *    inside a sequence that runs continuously from midday. Colour is now
 *    described as saturated and jewel-like WITHOUT naming a key, and the
 *    scene's own stated hour is declared to win.
 *
 * 2. GLOWING MOTES. "Glowing luminous accents" plus bokeh put drifting
 *    firefly lights over bare rock in daylight. That is the reference's
 *    subject leaking in through the style, which is exactly what this comment
 *    claimed would not happen. Bloom is now tied to light sources that the
 *    scene actually contains.
 *
 * 3. CHARACTER DESIGN. The old string constrained palette and finish and said
 *    nothing about how a PERSON is drawn, so each still re-invented the cast:
 *    Ali Baba was a bearded adult in S3, S7 and S9 and a chibi child in S6;
 *    Morgiana was three different women across S12, S13 and S14, one of them
 *    in a broad anime idiom. Every image is generated independently, so
 *    anything left unsaid is re-rolled. A single design language is now named
 *    and the alternatives are explicitly refused.
 *
 * A fourth, caught before regenerating rather than after: "figures small
 * against a large environment" was carried over from the reference's wonder
 * staging, and it flatly contradicts S13, which is a tight close-up. Framing
 * belongs to the scene for the same reason the hour does.
 *
 * THEN A FIFTH, FROM OVER-CORRECTING THE SECOND.
 *
 * The v2 stills fixed all four faults and lost the look. Removing the night
 * palette also removed the depth: "amber against deep violet" was carrying the
 * volume and the contrast as well as the hour, and cutting it back to "rich
 * saturated jewel-like colour" left flat, pale illustration. S7's cavern went
 * from the best match in the set to a washed-out drawing.
 *
 * The distinction that was missing: warm-versus-cool is a RELATIONSHIP, and
 * only becomes a time of day when you name the two colours. Stated as the
 * separation between the scene's own light and its own shade, midday gets warm
 * sun against cool blue shadow and a lamplit room gets amber against violet —
 * richness restored, hour still owned by the scene. Volume is now asked for
 * directly (volumetric light, shafts, modelled form, "never flat") rather than
 * arriving as a side effect of a palette.
 *
 * `film grain` is deliberately dropped and `no film grain` asserted instead.
 * Grain is the single strongest photoreal cue in HOUSE_STYLE and leaving it
 * in fights every other word here.
 */
export const STORYBOOK_STYLE =
  'Lavish feature-animation film still, lush hand-painted 3D-animation feel with high production ' +
  'value, rounded simplified forms, soft painterly brushwork and no hard outlines. ' +
  // Richness. Stripping the reference's night palette also stripped its depth;
  // these restore the volume and contrast WITHOUT naming a key.
  'Rich saturated jewel-like colour and deep shadows that carry colour rather than going grey, ' +
  'strong warm-to-cool separation between the scene\u2019s own light and its own shade, dramatic ' +
  'volumetric light with visible light shafts and glow around whatever is emitting light in the ' +
  'scene, layered atmospheric haze for depth, shallow depth of field with a soft out-of-focus ' +
  'foreground. Deeply three-dimensional and richly modelled, never flat. ' +
  // Design language. Without this the cast is re-rolled every image.
  'Characters are drawn in one consistent feature-animation design language with naturalistic ' +
  'adult human proportions and warm expressive faces; not chibi, not super-deformed, no ' +
  'oversized heads, not anime, no oversized eyes. ' +
  // The scene text owns the hour and the weather. The style must not.
  'Lighting, time of day, weather and shot framing follow the scene description exactly; do not ' +
  'shift a daylight scene toward night, and do not widen a close-up. No fireflies, no floating ' +
  'glowing motes and no magic sparkles unless the scene description asks for them. ' +
  'No film grain, not photorealistic, no text, no lettering, no watermark, no modern objects.';

/**
 * Recurring faces, locked.
 *
 * Nothing carries between images — each still is generated on its own — so a
 * character described only as "a woodcutter" is a different man every time.
 * These are appended to the scenes each person appears in.
 *
 * Deliberately short and physical: build, age, hair, beard, one garment. Long
 * descriptions crowd out the scene itself, and eye colour never survives
 * anyway. The point is that a viewer recognises the same person twice.
 */
export const EP2_CAST: Record<string, string> = {
  // FROM THE SHEET. Red headscarf, not the grey-white one this used to say.
  aliBaba:
    'ALI BABA is the same man in every shot: a sun-darkened woodcutter in his forties, open ' +
    'friendly face, short dark beard, a worn RED cotton headscarf tied at the back of his head. ' +
    'Rough brown tunic with a frayed hem, deep maroon sash, grey-green linen trousers patched ' +
    'and tied loosely with the calves wrapped, worn leather sandals. Carries a woodcutter’s axe.',
  // NO SHEET. Kasim is not in the production-notes list, so this stays invented
  // and stays deliberately plain — he appears in two scenes and never close.
  kasim:
    'KASIM is the same man in every shot: heavier and better fed than his brother, ' +
    'black square-cut beard, hard-set mouth, deep plum and gold merchant robe.',
  // FROM THE SHEET. Teal and rust, not indigo. The old wording also banned
  // "red or bright hair" — a fix for a generation fault that no longer applies
  // now the design is pinned by reference art.
  morgiana:
    'MORGIANA is the same young woman in every shot: warm brown skin, dark hair in a single ' +
    'practical braid, level and sharp-eyed. TEAL long tunic with a side slit and long sleeves, ' +
    'RUST-red baggy trousers, a braided rope belt with a small leather pouch, brown pointed ' +
    'slippers. Teal and rust palette throughout.',
  // FROM THE SHEET. Bare-headed — the old lock invented a head cloth.
  captain:
    'THE CAPTAIN is the same man in every shot: broad and heavy-set, BARE-HEADED with black ' +
    'hair going grey, a thick black-and-grey beard and heavy brows. Deep maroon robe with gold ' +
    'trim at collar and cuffs, brown leather jerkin over it, wide brown belt and a cross-body ' +
    'strap, curved scimitar, brown trousers, tall worn leather boots.',
};

/**
 * Episode 2's music bed, written to the axes of the supplied prompt book
 * (`.claude/skills/oniq-video/references/prompt-book.md`): mood, instrument,
 * tempo, ambience.
 *
 * Chosen against the constraint that actually governs it — the bed plays under
 * narration that runs for 88% of the episode, at roughly a sixth of the
 * narrator's level. That rules out the obvious pick. A drum-led bed reads well
 * for a desert caravan and badly under a continuous voice: percussive
 * transients punch through a duck in a way sustained material does not, so
 * every hit would poke out of the mix. Textures carry the same atmosphere with
 * nothing to poke.
 *
 * Loopable because the episode is 5m35s and a generated bed will be far
 * shorter; the seam is what to listen for if it ever sounds wrong.
 */
export const EP2_BED =
  'Mysterious instrumental soundtrack using warm ambient textures and soft sustained drones, ' +
  'slow building tempo, sparse and restrained frame-drum pulse well back in the mix, dry desert ' +
  'wind ambience. Written as an underscore beneath a narrator: no melody that demands attention, ' +
  'no sharp percussive transients, no vocals, nothing in the range of a speaking voice. Seamless ' +
  'loop.';

/**
 * Episode 3's cast, locked.
 *
 * THE TWO JINN ARE THE POINT. The production notes require them to be visibly
 * distinct and reused across the season, and they are the two most likely
 * things in this episode to come back as the same being in different colours —
 * both are "a spirit rising out of an object" and a generator will happily
 * draw that twice. They are pushed to opposite ends of every axis that reads
 * at a glance: size, speed, and what they are MADE of. Their voices are
 * separated the same way in VOICES.
 *
 * The magician carries two descriptions on purpose. He is warm for three
 * scenes and then he is not, and the turn is the story — but he must remain
 * recognisably one man across it, which is what the shared physical detail is
 * for.
 */
export const EP3_CAST: Record<string, string> = {
  // FROM THE SHEET. Cream tunic and teal trousers, not the patched brown one
  // this used to invent. NOTE: his sheet is the only one rendered in 3D rather
  // than 2D painterly, and he reads younger and tidier there than "fifteen and
  // scruffy" — see SHEETED below.
  aladdin:
    'ALADDIN is the same boy in every shot: a boy in his early teens, warm brown skin, dark ' +
    'tousled hair, brown eyes, an easy open face. Cream long-sleeved tunic with the sleeves ' +
    'rolled, TEAL-BLUE baggy trousers stained and patched at the knees, brown leather sandals, ' +
    'a simple cord belt. A boy, never a small adult.',
  // FROM THE SHEET. Indigo, not green.
  mother:
    'ALADDIN’S MOTHER is the same woman in every shot: careworn and dignified, grey-black hair ' +
    'under a faded INDIGO head wrap. Worn robe in dusty blue and brown, patched, with a cloth ' +
    'sash at the waist, an amber bead necklace, plain bangles, brown sandals. A spinner’s ' +
    'hands — worked and calloused.',
  // FROM THE SHEET. Clean-shaven and silver-haired; the old lock gave him a
  // black beard and an indigo coat, both wrong.
  magician:
    'THE MAGICIAN is the same man in every shot: tall and gaunt, SILVER-GREY hair swept back, ' +
    'CLEAN-SHAVEN, sharp cheekbones and deep-set dark eyes. Near-black robes with fine gold ' +
    'embroidery, a hooded cloak, a dark turban with a single teal gem at the brow, a sash set ' +
    'with red and turquoise stones, rings, dark brown boots. Carries a tall wooden staff topped ' +
    'with a clear crystal. His expression turns warm or cold between scenes; his face, his ' +
    'robes and his staff do not change.',
  // FROM THE SHEET. White-GOLD, not blue-white.
  ringJinni:
    'THE RING JINNI is SMALL and SHARP and made of LIGHT: a slight, sprite-like figure barely ' +
    'larger than a child, geometric faceted plates of WHITE-GOLD light, pointed ears, hair ' +
    'rising like a flame, ruby-magenta and lapis-blue gem accents, trailing ribbons of light ' +
    'where legs would be. Bright, swift, smiling and unthreatening. NO SMOKE anywhere.',
  // *** NO SHEET EXISTS FOR THIS CHARACTER. ***
  //
  // Every other name in the production notes was supplied as reference art;
  // this one was not, and it is the single most dangerous omission in the set.
  //
  // The reason is THREE JINN, not two. The notes warn that the ring and lamp
  // jinn must be distinguishable. But Episode 1's JAR JINNI also has a sheet —
  // vast, cracked with ember light, lower body dissolving into smoke — and the
  // description this lock used to carry ("vast, slow, smoke and ember, dark
  // grey shot through with orange firelight") is that character almost word for
  // word. Generated from that text, Episode 3's lamp jinni would have come back
  // as Episode 1's jar jinni in a different room.
  //
  // So the lock now separates it from BOTH siblings, and says out loud that it
  // is unsheeted. Design it before generating anything for S10.
  lampJinni:
    'THE LAMP JINNI has NO REFERENCE SHEET YET and must be designed before use. It is VAST and ' +
    'SLOW — it fills the room and has to stoop — and it must read as a THIRD being, distinct ' +
    'from both siblings: not the ring jinni’s small white-gold light, and NOT Episode 1’s jar ' +
    'jinni, which is a cracked ember-lit giant trailing smoke. Give it its own material and ' +
    'palette.',
  // FROM THE SHEET. Green, blue and gold with a beaded side braid — not the
  // "rose silk, hair coiled and pinned" this used to invent.
  princess:
    'THE PRINCESS is the same young woman in every shot: composed and level-eyed, long dark ' +
    'hair in a thick SIDE BRAID threaded with gold beads, a fine gold chain across her brow ' +
    'with a teardrop pendant, gold drop earrings and layered necklaces. GREEN tunic with gold ' +
    'embroidery worn under a deep BLUE-TEAL coat with heavy gold borders, a blue sash, ' +
    'gold-mustard harem trousers, gold bangles. Never a decoration in the frame.',
};

/**
 * Episode 1's cast, from the sheets. Recorded even though Episode 1 is already
 * rendered and shipped — the jar jinni is reused across the season, and it is
 * the design Episode 3's lamp jinni has to avoid colliding with.
 */
export const EP1_CAST: Record<string, string> = {
  fisherman:
    'THE FISHERMAN is the same man in every shot: elderly, lean and weathered, bald on top with ' +
    'white hair at the sides, a short white beard, deep smile lines, a kind face. Rough-woven ' +
    'cream tunic with short frayed sleeves, a rope belt, a cloth shoulder bag on a rope strap, ' +
    'cream trousers rolled to mid-calf and patched. BARE FEET. Carries a wooden staff.',
  jarJinni:
    'THE JAR JINNI is the same being in every shot: enormous, dwarfing any human in frame. Bald, ' +
    'pointed ears, glowing amber eyes, a grey-white beard, copper-brown skin split by glowing ' +
    'EMBER-ORANGE cracks. Below the waist it has no legs — it dissolves into billowing smoke. ' +
    'Heavy gold and turquoise collar, bracers and belt over tattered midnight-blue and teal ' +
    'cloth with gold trim.',
};

/**
 * Which characters have reference art, and which do not.
 *
 * Separate from the descriptions because it answers a different question: not
 * "what does this character look like" but "can we pin it with an image, or are
 * we trusting prose". That distinction now decides how a shot is generated —
 * Veo ignores style words in text-to-video, so a sheeted character can be held
 * to its design with a starting frame and an unsheeted one cannot.
 */
export const CHARACTER_SHEETS: Record<string, string> = {
  fisherman: 'sheets/fisherman.jpg',
  jarJinni: 'sheets/jarJinni.jpg',
  aliBaba: 'sheets/aliBaba.jpg',
  morgiana: 'sheets/morgiana.jpg',
  captain: 'sheets/captain.jpg',
  aladdin: 'sheets/aladdin.jpg',
  mother: 'sheets/mother.jpg',
  magician: 'sheets/magician.jpg',
  ringJinni: 'sheets/ringJinni.jpg',
  princess: 'sheets/princess.jpg',
};

/** Every character the season casts, sheeted or not. */
const CAST_KEYS = [
  ...Object.keys(CHARACTER_SHEETS),
  // The two gaps. Kasim was never asked for; the lamp jinni was, and is missing.
  'kasim',
  'lampJinni',
];

/**
 * DERIVED, not hand-maintained — a boolean list beside a path list is two
 * things that can disagree, and the disagreement would say a character is
 * pinned to art that does not exist.
 */
export const SHEETED: Record<string, boolean> = Object.fromEntries(
  CAST_KEYS.map((key) => [key, key in CHARACTER_SHEETS]),
);

/** Vertical, to match the phone. Runway ratio for every clip in the season. */
export const SEASON_RATIO = '720:1280';
export const SEASON_DURATION = 5;

/**
 * Resolve a scene's full image prompt, including the style of the episode
 * that OWNS it. Takes the scene alone because that is all any caller has;
 * looking the episode up here is what stops a scene being rendered in the
 * wrong episode's style.
 */
export function stillPromptFor(scene: Scene): string {
  const owner = ALL_SCENES.find((s) => s.scene.id === scene.id)?.episode;
  // Cast last. The scene is what this frame IS; the locks are a constraint on
  // how the people in it are drawn, and trail the description for the same
  // reason a style leads it.
  const cast = (scene.cast ?? [])
    .map((key) => owner?.cast?.[key])
    .filter(Boolean)
    .join(' ');
  return [owner?.style ?? HOUSE_STYLE, scene.stillPrompt, cast].filter(Boolean).join(' ');
}

const episode1: Episode = {
  id: 'ep1',
  number: 1,
  title: 'The Fisherman and the Jinni',
  runtime: '~4 min',
  cast: EP1_CAST,
  scenes: [
    {
      id: 'ep1_s01',
      label: 'S1 — Village at dawn',
      stillPrompt:
        'Wide establishing shot of a poor fishing village at dawn, flat still sea, one small ' +
        'wooden boat pulled up on grey sand, cool blue pre-sunrise light, low horizon.',
      motionPrompt:
        'Very slow push in toward the boat. Gentle lapping water at the shoreline, slow drifting ' +
        'sea haze. Locked, patient camera.',
      cast: ['fisherman'],
    },
    {
      id: 'ep1_s02',
      label: 'S2 — First cast',
      stillPrompt:
        'Mid shot of a lean weathered fisherman waist-deep in the sea, arms wide, a net spreading ' +
        'in an arc against a pale dawn sky, spray caught in the light.',
      motionPrompt:
        'The net spreads outward and falls to the water in slow motion, droplets scattering. Slight ' +
        'handheld sway, camera holds the arc.',
      cast: ['fisherman'],
    },
    {
      id: 'ep1_s03',
      label: 'S3 — The drowned donkey',
      stillPrompt:
        'The wet net opened on grey sand with a dead donkey tangled in dark seaweed; the fisherman ' +
        'stands over it, face flat with disappointment, cold morning light.',
      motionPrompt:
        'Slow drift down the length of the net. Seaweed and wet rope shift slightly. The man exhales ' +
        'and his shoulders drop. No other movement.',
      cast: ['fisherman'],
    },
    {
      id: 'ep1_s04',
      label: 'S4 — Jar of mud',
      stillPrompt:
        'A great cracked clay jar hauled onto the sand, spilling thick river mud and grit out of its ' +
        'broken mouth, net rope taut across the frame.',
      motionPrompt:
        'Mud slides slowly out of the jar mouth and spreads on the sand. Camera tilts down with the ' +
        'spill. Slow, heavy.',
    },
    {
      id: 'ep1_s05',
      label: 'S5 — Broken pots and a shoe',
      stillPrompt:
        'Close overhead of wet sand strewn with broken pottery shards, sea-worn green glass and a ' +
        'single lost shoe, net edge curling into frame.',
      motionPrompt:
        'Slow overhead drift across the debris. A thin sheet of seawater washes in and retreats over ' +
        'the shards.',
      cast: ['fisherman'],
    },
    {
      id: 'ep1_s06',
      label: 'S6 — The copper jar (hero)',
      stillPrompt:
        'Hero shot: a sealed copper jar breaking the surface of the sea, green with age, mouth ' +
        'stopped with lead, an unreadable mark pressed into the lead, catching the first hard ' +
        'sunlight, water sheeting off it.',
      motionPrompt:
        'The jar rises out of the water in slow motion, water sheeting off the copper, sunlight ' +
        'raking across the seal. Slow rotating push in.',
      cast: ['fisherman'],
    },
    {
      id: 'ep1_s07',
      label: 'S7 — The seal comes away',
      stillPrompt:
        'Extreme close up of a worn knife blade working under a lead seal on copper, a first thin ' +
        'thread of dark smoke escaping, golden hour light turning slightly wrong.',
      motionPrompt:
        'The blade levers the seal. A thin thread of smoke escapes and begins to curl upward, ' +
        'accelerating. Macro camera holds perfectly still.',
    },
    {
      id: 'ep1_s08',
      label: 'S8 — The jinni rises',
      stillPrompt:
        'Wide low-angle: an enormous jinni of smoke and glowing ember towering over the tiny figure ' +
        'of the fisherman on an empty beach, eyes like a fire burned all night, awe not horror.',
      motionPrompt:
        'Smoke boils upward and consolidates into the towering figure, embers drifting through it. ' +
        'Camera cranes up slowly. The sand around the man stirs.',
      cast: ['jarJinni', 'fisherman'],
    },
    {
      id: 'ep1_s09',
      label: 'S9 — Standing his ground',
      stillPrompt:
        'Mid shot from behind and below the fisherman, small and steady on the sand, the vast ' +
        'ember-lit face of the jinni filling the sky above him.',
      motionPrompt:
        'The vast head lowers slowly toward the man. Smoke drifts across the frame. The man does not ' +
        'move. Slow creeping push in.',
      cast: ['jarJinni', 'fisherman'],
    },
    {
      id: 'ep1_s10',
      label: 'S10 — The idea',
      stillPrompt:
        'Tight close up on the fisherman\u2019s weathered face, thinking rather than pleading, ember ' +
        'light on one cheek, a small dangerous idea arriving behind his eyes.',
      motionPrompt:
        'Almost nothing moves. A slow blink, a flicker of ember light across the face, the faintest ' +
        'push in. Hold the stillness.',
      cast: ['jarJinni', 'fisherman'],
    },
    {
      id: 'ep1_s11',
      label: 'S11 — Back into the jar',
      stillPrompt:
        'The colossal jinni dissolving into a descending column of smoke pouring down into the small ' +
        'copper jar lying on its side in the sand, the fisherman\u2019s hand already moving with the lead.',
      motionPrompt:
        'The column of smoke pours downward into the jar mouth like water into a cup, faster and ' +
        'faster, then stops. Camera pushes down with the smoke.',
      cast: ['jarJinni', 'fisherman'],
    },
    {
      id: 'ep1_s12',
      label: 'S12 — Sunrise, sealed',
      stillPrompt:
        'Wide warm shot at full sunrise: the fisherman sitting on the sand beside the sealed copper ' +
        'jar, the sea flat and ordinary again, long golden light across the beach.',
      motionPrompt:
        'Slow pull back as the sun rises. Gentle waves, drifting light, the man breathing. Calm and ' +
        'final.',
      cast: ['fisherman'],
    },
  ],
};

const episode2: Episode = {
  id: 'ep2',
  number: 2,
  title: 'Ali Baba and the Forty Thieves',
  runtime: '~6 min',
  style: STORYBOOK_STYLE,
  cast: EP2_CAST,
  bed: EP2_BED,
  scenes: [
    {
      id: 'ep2_s01',
      label: 'S1 — Woodcutter at midday',
      stillPrompt:
        'Wide shot of dry rocky hills at hard midday, a lone woodcutter loading bundles of firewood ' +
        'onto a small donkey, heat haze shimmering off the stone.',
      motionPrompt:
        'Heat haze ripples across the hills. The man lifts a bundle onto the donkey. Slow lateral ' +
        'camera drift.',
      cast: ['aliBaba'],
    },
    {
      id: 'ep2_s02',
      label: 'S2 — Dust on the road',
      stillPrompt:
        'A long plume of dust rising on a distant hill road, riders barely visible inside it, the ' +
        'woodcutter\u2019s face turning toward it in the foreground.',
      motionPrompt:
        'The dust plume grows and drifts toward camera. The man turns his head. Slow zoom toward the ' +
        'horizon.',
      cast: ['aliBaba'],
    },
    {
      id: 'ep2_s03',
      label: 'S3 — Up the tree',
      stillPrompt:
        'A man scrambling up into the branches of a broad old tree above a dry road, a donkey hidden ' +
        'behind rocks below, dappled hard light through leaves.',
      motionPrompt:
        'Leaves shift and shadows move across the man as he settles and goes still. Slight upward ' +
        'camera drift through the branches.',
      cast: ['aliBaba'],
    },
    {
      id: 'ep2_s04',
      label: 'S4 — The captain speaks',
      stillPrompt:
        'Low angle from up in a tree: a broad bearded thief captain dismounted before a blank wall ' +
        'of bare rock, one hand raised, forty riders waiting behind him.',
      motionPrompt:
        'The captain raises his hand and holds it. Dust settles around the horses. Camera sways very ' +
        'slightly, as if from a branch.',
      cast: ['captain'],
    },
    {
      id: 'ep2_s05',
      label: 'S5 — The hill opens',
      stillPrompt:
        'A seam of light splitting a rock face, stone drawing apart onto a dark opening, thieves ' +
        'filing in with heavy sacks over their shoulders.',
      motionPrompt:
        'The rock grinds apart, dust falling from the seam, the line of men walking into the dark. ' +
        'Steady locked camera.',
    },
    {
      id: 'ep2_s06',
      label: 'S6 — Saying the words',
      stillPrompt:
        'Ali Baba alone and small against a huge blank rock face, one hand raised, expression ' +
        'half-embarrassed, long afternoon shadow behind him.',
      motionPrompt:
        'The man hesitates, then lifts his hand. His shadow stretches. Very slow push in on his back.',
      cast: ['aliBaba'],
    },
    {
      id: 'ep2_s07',
      label: 'S7 — The cavern',
      stillPrompt:
        'Interior reveal of a treasure cavern: bolts of silk, hanging lamps, chests, coin lying in ' +
        'drifts like sand, warm golden light on Ali Baba\u2019s astonished face at the entrance.',
      motionPrompt:
        'Camera glides forward into the cavern past hanging lamps. Dust motes drift through the light. ' +
        'Lamp flames flicker.',
      cast: ['aliBaba'],
    },
    {
      id: 'ep2_s08',
      label: 'S8 — The borrowed scale',
      stillPrompt:
        'Humble domestic interior at night: a woman weighing gold coins on a borrowed brass scale by ' +
        'lamplight, one coin stuck to a smear of wax on the underside.',
      motionPrompt:
        'The scale pans rock and settle. Lamplight wavers on the coins. Slow tilt down to the wax ' +
        'under the pan.',
    },
    {
      id: 'ep2_s09',
      label: 'S9 — Kasim at the door',
      stillPrompt:
        'A hard-faced wealthy brother confronting a poor man in a narrow doorway at dusk, the poor ' +
        'man resigned, warm light behind them.',
      motionPrompt:
        'The wealthy man leans in. The other lowers his eyes. Cloth and lamplight move. Slow push in ' +
        'on the doorway.',
      cast: ['kasim', 'aliBaba'],
    },
    {
      id: 'ep2_s10',
      label: 'S10 — The forgotten word',
      stillPrompt:
        'A man inside the treasure cavern surrounded by heaped gold, arms full of sacks, mouth open, ' +
        'panic dawning on his face, the entrance behind him solid stone.',
      motionPrompt:
        'He turns sharply toward the sealed wall. Coins slip from a sack and scatter. Camera pushes ' +
        'in fast then holds.',
      cast: ['kasim'],
    },
    {
      id: 'ep2_s11',
      label: 'S11 — Ten mules waiting',
      stillPrompt:
        'Exterior of the closed hill face in flat afternoon light, ten laden mules standing untended, ' +
        'a fresh dust plume growing on the road in the distance.',
      motionPrompt:
        'The mules shift and flick their tails. The distant dust plume grows steadily. Static camera, ' +
        'rising dread.',
    },
    {
      id: 'ep2_s12',
      label: 'S12 — Thirty-eight oil jars',
      stillPrompt:
        'Night courtyard: a merchant caravan of tall oil jars lined in rows, Morgiana in the doorway ' +
        'with a raised oil lamp, watching, deep teal shadows.',
      motionPrompt:
        'Lamp flame flickers and swings; shadows of the jars sway across the courtyard wall. Very slow ' +
        'push toward the nearest jar.',
      cast: ['morgiana'],
    },
    {
      id: 'ep2_s13',
      label: 'S13 — "Not yet"',
      stillPrompt:
        'Tight close up of Morgiana, absolutely still and absolutely calm, one hand resting on the rim ' +
        'of a tall oil jar, lamplight on half her face.',
      motionPrompt:
        'Only the lamplight moves on her face. A single slow blink. The faintest push in. Total ' +
        'stillness otherwise.',
      cast: ['morgiana'],
    },
    {
      id: 'ep2_s14',
      label: 'S14 — The dance',
      stillPrompt:
        'Warm lamplit interior: the disguised captain seated at dinner, Morgiana standing before him ' +
        'mid-turn in a dance, entirely aware, Ali Baba oblivious at the side of the frame.',
      motionPrompt:
        'She turns; her skirt and scarf sweep through the frame. Lamp flames gutter. Camera arcs slowly ' +
        'around the seated man.',
      cast: ['morgiana', 'captain', 'aliBaba'],
    },
    {
      id: 'ep2_s15',
      label: 'S15 — A daughter of the household',
      stillPrompt:
        'Warm domestic interior the next morning, low table laid for a shared meal, Morgiana seated ' +
        'among the family as an equal rather than serving them, Ali Baba turned toward her, soft ' +
        'daylight through a lattice.',
      motionPrompt:
        'Dust turns in the window light. Someone passes a dish. Very slow push in on the two of them.',
      cast: ['morgiana', 'aliBaba'],
    },
    {
      id: 'ep2_s16',
      label: 'S16 — What is remembered',
      stillPrompt:
        'Dusk on the empty hill road, the blank rock face closed and silent in the far distance, and ' +
        'small in the foreground a lone woman walking away from it with a lamp, seen from behind.',
      motionPrompt:
        'The lamp sways with her step. Nothing else moves. Slow pull back until both she and the hill ' +
        'sit in the same frame.',
      // Deliberately uncast. The coda is about her not being remembered, and a
      // face would undo the line — she reads as a figure, not a portrait.
    },
  ],
};

const episode3: Episode = {
  id: 'ep3',
  number: 3,
  title: 'Aladdin and the Wonderful Lamp',
  runtime: '~7 min',
  // The Firefly Forest look, same as episode 2 — the owner asked for episode 3
  // to carry the characters and feel of that clip, and STORYBOOK_STYLE was
  // derived from it. Episode 1 is now the outlier in the season.
  style: STORYBOOK_STYLE,
  cast: EP3_CAST,
  scenes: [
    {
      id: 'ep3_s01',
      label: 'S1 — Boy on a wall',
      stillPrompt:
        'Busy market street in late amber light, a boy of about fifteen sitting on a low wall doing ' +
        'nothing and watching everything, crowd blurred around him.',
      motionPrompt:
        'The crowd moves past in soft blur while the boy stays still. Dust and light drift. Slow push ' +
        'in on him.',
      cast: ['aladdin'],
    },
    {
      id: 'ep3_s02',
      label: 'S2 — The stranger',
      stillPrompt:
        'A stranger in fine travelling clothes, dark-eyed and warmly smiling, hand on the boy\u2019s ' +
        'shoulder; the composition slightly off-balance, something subtly wrong.',
      motionPrompt:
        'The hand tightens very slightly on the shoulder. The smile holds a beat too long. Slow, ' +
        'uneasy push in.',
      cast: ['magician', 'aladdin'],
    },
    {
      id: 'ep3_s03',
      label: 'S3 — Green flame',
      stillPrompt:
        'Dry hills outside the city at dusk, a man scattering powder into a small fire, the flame ' +
        'turning an unnatural green, the boy lit from below.',
      motionPrompt:
        'Powder falls and the flame flares green, licking upward. Smoke curls. Camera pushes low ' +
        'toward the fire.',
      cast: ['magician', 'aladdin'],
    },
    {
      id: 'ep3_s04',
      label: 'S4 — The ground opens',
      stillPrompt:
        'A heavy stone slab drawn back in the hillside revealing steps down into darkness, the boy at ' +
        'the edge, the false uncle behind him, green firelight on the stone.',
      motionPrompt:
        'The slab grinds aside, dust pouring off it. The dark below deepens. Camera tilts down the ' +
        'steps.',
      cast: ['magician', 'aladdin'],
    },
    {
      id: 'ep3_s05',
      label: 'S5 — The jewelled garden',
      stillPrompt:
        'An underground garden of trees bearing fruit made of cut gems in clear green red and blue, ' +
        'glowing faintly, the boy small and staring among them.',
      motionPrompt:
        'Camera glides slowly between the trees. Gem fruit refracts and twinkles as the angle changes. ' +
        'Faint drifting motes.',
      cast: ['aladdin'],
    },
    {
      id: 'ep3_s06',
      label: 'S6 — The hand that will not reach',
      stillPrompt:
        'Looking up a stone shaft from below: the uncle silhouetted at the bright opening, hand ' +
        'outstretched, face no longer kind, the boy\u2019s hands full in the foreground.',
      motionPrompt:
        'The outstretched hand curls into a fist. The opening begins to narrow as the slab moves. ' +
        'Camera holds looking up.',
      cast: ['magician', 'aladdin'],
    },
    {
      id: 'ep3_s07',
      label: 'S7 — Two days in the dark',
      stillPrompt:
        'Almost total darkness with a single point of light: a boy\u2019s wringing hands, a plain ring ' +
        'catching one faint gleam, everything else black.',
      motionPrompt:
        'The hands wring slowly. The gleam on the ring slides and brightens. Everything else stays ' +
        'black. Minimal movement.',
      cast: ['aladdin'],
    },
    {
      id: 'ep3_s08',
      label: 'S8 — The ring jinni',
      stillPrompt:
        'A smaller jinni rising out of a ring: swift and sharp-edged, made of cold white light rather ' +
        'than smoke, filling a dark stone chamber, distinctly not the lamp jinni.',
      motionPrompt:
        'Light unfolds rapidly out of the ring into the sharp figure, then holds crisp and still. Fast ' +
        'bloom, then stillness.',
      cast: ['ringJinni', 'aladdin'],
    },
    {
      id: 'ep3_s09',
      label: 'S9 — Cleaning the lamp',
      stillPrompt:
        'Humble interior by daylight: a mother scrubbing a dented brass lamp with a cloth, ' +
        'unimpressed, the boy watching from the floor.',
      motionPrompt:
        'The cloth rubs back and forth on the brass. Dust rises in the light. Slow push in on the lamp.',
      cast: ['mother', 'aladdin'],
    },
    {
      id: 'ep3_s10',
      label: 'S10 — The lamp jinni stoops',
      stillPrompt:
        'A small house filled edge to edge with an enormous jinni of smoke and ember forced to stoop ' +
        'under the ceiling, vast and slow, faintly comic, the boy tiny below.',
      motionPrompt:
        'Smoke billows to fill the room and the huge figure settles, stooping. Embers drift. Camera ' +
        'pulls back to fit it in.',
      cast: ['lampJinni', 'aladdin', 'mother'],
    },
    {
      id: 'ep3_s11',
      label: 'S11 — The palace rises',
      stillPrompt:
        'The same street transformed: fine clothes, a horse, servants, the mother in silk, and a ' +
        'palace rising behind the rooftops in golden light.',
      motionPrompt:
        'Camera cranes up over the rooftops to reveal the palace. Banners and crowds move below. Grand ' +
        'and smooth.',
      cast: ['aladdin', 'mother'],
    },
    {
      id: 'ep3_s12',
      label: 'S12 — New lamps for old',
      stillPrompt:
        'Street scene: a stooped pedlar with a basket of bright new brass lamps calling out, a servant ' +
        'at a palace window above holding a dull dented one.',
      motionPrompt:
        'The pedlar lifts a shining lamp and turns it in the light. Above, the servant leans out. Slow ' +
        'tilt from street to window.',
      cast: ['magician'],
    },
    {
      id: 'ep3_s13',
      label: 'S13 — The empty square',
      stillPrompt:
        'Wide dawn shot of a bare level square of stone where a palace stood, a silent staring crowd ' +
        'at its edges, one man stopped dead in the foreground.',
      motionPrompt:
        'Slow pull back across the empty stone. Dust drifts. The crowd barely moves. Cold, quiet, ' +
        'enormous.',
      cast: ['aladdin'],
    },
    {
      id: 'ep3_s14',
      label: 'S14 — The lamp changes hands',
      stillPrompt:
        'Interior of the stolen palace far away: a young man and the princess quiet and purposeful, ' +
        'the magician asleep at a table, the dented lamp beside his hand, low lamplight.',
      motionPrompt:
        'A hand reaches slowly into frame toward the lamp. The sleeping man does not stir. Held ' +
        'breath, minimal camera drift.',
      cast: ['aladdin', 'princess', 'magician'],
    },
    {
      id: 'ep3_s15',
      label: 'S15 — The square is full again',
      stillPrompt:
        'Dawn over a city square that was empty yesterday and is not empty now: an enormous palace ' +
        'standing where there was bare ground, early traders setting up beneath it, nobody looking ' +
        'up, first light on the roofs.',
      motionPrompt:
        'Awnings unroll. Smoke rises from a stall. The palace does not move at all. Slow crane up ' +
        'until it fills the frame.',
    },
    {
      id: 'ep3_s16',
      label: 'S16 — Trusted with one',
      stillPrompt:
        'Years later, a quiet shelf in a well-kept room: the dented old lamp set carefully in its ' +
        'own place, cloth folded beside it, an older man’s hand just leaving the frame, late ' +
        'afternoon light.',
      motionPrompt:
        'The hand withdraws. Dust turns in the light. Nothing else happens. Very slow push in on ' +
        'the lamp.',
      cast: ['aladdin'],
    },
  ],
};

export const ORIGINALS: Episode[] = [episode1, episode2, episode3];

export const ALL_SCENES: { episode: Episode; scene: Scene }[] = ORIGINALS.flatMap((episode) =>
  episode.scenes.map((scene) => ({ episode, scene })),
);

export function findScene(id: string): Scene | undefined {
  return ALL_SCENES.find((s) => s.scene.id === id)?.scene;
}
