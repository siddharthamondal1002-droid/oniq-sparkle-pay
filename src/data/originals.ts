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
};

export type Episode = {
  id: string;
  number: number;
  title: string;
  runtime: string;
  scenes: Scene[];
};

/** Prepended to every stillPrompt so the season looks like one season. */
export const HOUSE_STYLE =
  'Painterly cinematic illustration, hand-painted matte-painting feel, warm desert palette ' +
  'of sand ochre, deep teal shadow and ember gold, soft volumetric light, film grain, ' +
  'no text, no lettering, no watermark, no modern objects.';

/** Vertical, to match the phone. Runway ratio for every clip in the season. */
export const SEASON_RATIO = '720:1280';
export const SEASON_DURATION = 5;

export function stillPromptFor(scene: Scene): string {
  return `${HOUSE_STYLE} ${scene.stillPrompt}`;
}

const episode1: Episode = {
  id: 'ep1',
  number: 1,
  title: 'The Fisherman and the Jinni',
  runtime: '~4 min',
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
    },
  ],
};

const episode2: Episode = {
  id: 'ep2',
  number: 2,
  title: 'Ali Baba and the Forty Thieves',
  runtime: '~6 min',
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
    },
  ],
};

const episode3: Episode = {
  id: 'ep3',
  number: 3,
  title: 'Aladdin and the Wonderful Lamp',
  runtime: '~7 min',
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
    },
    {
      id: 'ep3_s09',
      label: 'S9 — Cleaning the lamp',
      stillPrompt:
        'Humble interior by daylight: a mother scrubbing a dented brass lamp with a cloth, ' +
        'unimpressed, the boy watching from the floor.',
      motionPrompt:
        'The cloth rubs back and forth on the brass. Dust rises in the light. Slow push in on the lamp.',
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
