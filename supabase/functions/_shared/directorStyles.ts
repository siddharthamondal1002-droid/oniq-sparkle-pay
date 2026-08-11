// Director styles — the visual grammars of celebrated filmmakers from every
// country ONIQ serves, as TECHNIQUE LANGUAGE a prompt can carry.
//
// RESEARCHED AND VERIFIED 2026-08-11 (one entry corrected in verification:
// Jane Campion is a New Zealand director and was removed from the Australia
// set). The director names are METADATA for the picker UI and these comments;
// the prompt-facing text is technique only — camera height, framing,
// lighting, palette, pacing — because technique is not copyrightable and
// because a named-person reference in a generation prompt is an invitation to
// a third-party-content refusal (see the ep3 record in movieGrammar.ts).
//
// Style keys are stable identifiers; the studio can offer them per country.

export type DirectorStyle = {
  key: string;
  country: string;
  /** Metadata for UI/attribution — never sent to a model. */
  director: string;
  era?: string;
  /** Prompt-ready technique phrases. */
  techniques: readonly string[];
  signatureShot?: string;
};

export const DIRECTOR_STYLES: readonly DirectorStyle[] = [
  {
    key: "satyajit-ray",
    country: "India",
    director: "Satyajit Ray",
    era: "1955–1991 (Bengali cinema)",
    techniques: [
      "eye-level camera at a patient humanist distance, letting scenes unfold in long unhurried takes with minimal cutting",
      "naturalistic black-and-white photography using soft bounced daylight through windows and doorways",
      "lyrical observational inserts of nature — rain on a pond, wind through tall grass, insects on water — used as emotional punctuation",
      "slow contemplative pacing built on silent close-ups of faces reacting rather than dialogue",
      "characters framed within doorframes, courtyards and village architecture for quiet depth staging",
      "location realism with unforced, documentary-flavored performance blocking",
    ],
    signatureShot:
      "two children running through a field of tall white feathery grass toward a distant steam train, wide framing, backlit black-and-white, held long enough for the train to cross the whole frame",
  },
  {
    key: "guru-dutt",
    country: "India",
    director: "Guru Dutt",
    era: "1950s (Hindi cinema, golden age)",
    techniques: [
      "high-contrast black-and-white chiaroscuro with a single hard key light carving a face out of darkness",
      "slow forward tracking shot on a long lens closing in on a solitary figure during a melancholic song",
      "smoke and shafts of light through latticework, stairwells and studio rafters for romantic gloom",
      "characters staged in silhouette against bright doorways and theatrical spotlights",
      "a thin band of light across the eyes while the rest of the frame falls to black",
      "languid, mournful pacing where the camera drifts as if sighing",
    ],
    signatureShot:
      "a man in silhouette standing in a single dusty shaft of light at the back of a dark hall, arms slightly outstretched, smoke swirling in the beam, slow dolly gliding toward him",
  },
  {
    key: "s-s-rajamouli",
    country: "India",
    director: "S.S. Rajamouli",
    era: "2001–present (Telugu cinema)",
    techniques: [
      "epic slow-motion action tableaux with heroes framed from a low angle against sky, fire and banners",
      "sweeping crane and aerial moves that start tight on a face and pull out to reveal thousands of extras",
      "hyper-saturated grading: golden torchlight, teal night, vivid costume color against monumental sets",
      "physics-defying stunt choreography in extreme slow motion with dust, water droplets and debris filling the frame",
      "pacing engineered to escalate toward a single freeze-worthy heroic image at the midpoint",
      "mythic scale composition: tiny human figures against colossal statues, dams, waterfalls and armies",
    ],
    signatureShot:
      "a low-angle slow-motion shot of a warrior leaping through fire and airborne debris, garments billowing, as a crane pull-back reveals a battlefield of thousands below",
  },
  {
    key: "mani-ratnam",
    country: "India",
    director: "Mani Ratnam",
    era: "1983–present (Tamil cinema)",
    techniques: [
      "backlit interiors with practical windows deliberately blown out, faces half-lit in split cool-blue and warm-tungsten light",
      "rain, smoke and dust as constant atmosphere, with shafts of light cutting through blinds and grilles",
      "restless walk-and-talk staging through trains, corridors and crowds with the camera tracking alongside",
      "song sequences cut as visual poetry: silhouettes, monumental landscapes, wind-blown fabric, elliptical jump cuts",
      "intimate handheld close-ups in conflict scenes alternating with formal locked-off wides",
      "real-location texture — monsoon streets, coastal light, northern snow — grounding melodrama in place",
    ],
    signatureShot:
      "two lovers in silhouette before a huge sunlit window, dust motes in the air, a curtain lifting in the wind, framed in a static painterly wide",
  },
  {
    key: "sanjay-leela-bhansali",
    country: "India",
    director: "Sanjay Leela Bhansali",
    era: "1996–present (Hindi cinema)",
    techniques: [
      "operatic symmetrical wides of palatial sets lit almost entirely by hundreds of oil lamps and chandeliers",
      "saturated jewel-tone palette — deep reds, emeralds, golds — with production design filling every inch of frame",
      "long majestic dolly and jib arcs circling dancers inside mirrored halls",
      "choreographed crowd blocking in which every extra moves in rhythm with the music",
      "diffused golden haze and candlelight glow on faces for painterly tableau framing",
      "grand slow pacing that treats each frame like a court painting",
    ],
    signatureShot:
      "a dancer spinning in a mirrored palace hall lit by thousands of flames, the camera arcing around her in slow motion as reflections multiply toward infinity",
  },
  {
    key: "steven-spielberg",
    country: "United States",
    director: "Steven Spielberg",
    era: "1970s–present",
    techniques: [
      "slow eye-level dolly push-in onto an awestruck face staring at something off-screen before the reveal",
      "camera lowered to a child's eye line with wide lenses and deep staging, action layered foreground to background",
      "strong backlight through atmospheric haze — flashlight beams, headlights, god-rays through fog and doorways",
      "long fluid single takes that re-block actors from wide to close-up without cutting",
      "spectacle first revealed indirectly through reflections, shadows and off-screen glow on faces",
      "sentimental warm key light on faces against cooler blue night surroundings",
    ],
    signatureShot:
      "a slow dolly-in on an upturned face lit by a warm off-screen glow, eyes widening in wonder, haze and lens flare blooming behind",
  },
  {
    key: "stanley-kubrick",
    country: "United States",
    director: "Stanley Kubrick",
    era: "1950s–1999",
    techniques: [
      "one-point-perspective symmetry: corridors and rooms framed dead center with deep vanishing points",
      "slow gliding low-height tracking shots following a subject from behind through architectural space",
      "wide-angle lenses rendering interiors with crisp geometric precision and subtle edge distortion",
      "available and practical light only — candlelit interiors, fluorescent glare, stark white rooms",
      "long unbroken takes at glacial pace with clinical emotional detachment",
      "a menacing head-on stare framed with the chin down and eyes tilted up",
    ],
    signatureShot:
      "a perfectly symmetrical one-point-perspective corridor, the camera gliding slowly forward at waist height toward a distant vanishing point in cold even light",
  },
  {
    key: "martin-scorsese",
    country: "United States",
    director: "Martin Scorsese",
    era: "1970s–present",
    techniques: [
      "kinetic long-take tracking shots winding through kitchens, corridors and crowded rooms",
      "whip pans, crash zooms and freeze frames punctuating voice-over narration",
      "warm tungsten and neon palette against wet dark city streets",
      "slow-motion inserts scored to popular music to ritualize glamour and menace",
      "characters framed in mirrors and doorways, with sudden violence in tight handheld close-up",
      "restless editing rhythm that accelerates with a character's rise and frays with their fall",
    ],
    signatureShot:
      "an unbroken low-lit tracking shot following a couple through a back entrance, down service corridors and through a bustling kitchen into a glamorous room, all in one music-driven move",
  },
  {
    key: "christopher-nolan",
    country: "United States",
    director: "Christopher Nolan",
    era: "1998–present",
    techniques: [
      "large-format clarity: crisp deep-focus vistas with a natural desaturated palette of steel blue, grey and tan",
      "cross-cut parallel timelines accelerating toward one synchronized climax over a ticking pulse",
      "practical in-camera spectacle — real vehicles, real explosions — framed from stable monumental angles",
      "claustrophobic handheld close-ups inside vehicles and corridors intercut with vast aerial establishing shots",
      "rotating or gravity-shifting sets with the camera locked to the architecture rather than the horizon",
      "minimal color flourish; scale and geometry carry the awe instead of grading",
    ],
    signatureShot:
      "an immense wide shot of a tiny human figure against an overwhelming structure or landscape, razor-sharp deep focus, cold natural light, low thunderous score",
  },
  {
    key: "wes-anderson",
    country: "United States",
    director: "Wes Anderson",
    era: "1996–present",
    techniques: [
      "flat frontal tableau framing with strict bilateral symmetry, subjects centered and facing the lens",
      "90-degree whip pans and precise lateral dolly moves along dollhouse-like cross-section sets",
      "pastel storybook palette — pink, mustard, mint, faded red — with meticulously arranged props",
      "overhead god's-eye inserts of hands, letters and objects laid flat on tables",
      "deadpan blocking: characters walk straight lines, stop on exact marks, deliver lines motionless",
      "slow-motion ensemble walks toward camera as emotional punctuation",
    ],
    signatureShot:
      "a perfectly symmetrical head-on wide of a character standing centered in an ornate pastel interior, gazing directly into the lens, camera locked off",
  },
  {
    key: "alfred-hitchcock",
    country: "United Kingdom",
    director: "Alfred Hitchcock",
    era: "1920s–1976",
    techniques: [
      "point-of-view editing triangle: the watcher's face, what they see, then their reaction",
      "slow voyeuristic push-ins through windows and doorways toward one guilty telling detail",
      "dolly-zoom that stretches the background while the subject stays fixed, producing vertiginous dread",
      "high overhead angles isolating a figure at the exact moment of danger",
      "suspense built by showing the audience a threat the character cannot see",
      "meticulous storyboarded framing where every cut is premeditated",
    ],
    signatureShot:
      "a slow dolly-zoom looking down a stairwell, the foreground figure fixed while the drop below stretches sickeningly away in cool shadow",
  },
  {
    key: "david-lean",
    country: "United Kingdom",
    director: "David Lean",
    era: "1940s–1984",
    techniques: [
      "vast 70mm-scale desert and landscape wides where human figures are specks on the horizon",
      "patient editing that holds on an empty horizon until a distant figure slowly emerges from heat haze",
      "graceful crane moves across epic terrain paired with a sweeping romantic score",
      "intimate face close-ups intercut with immense scale to bind emotion to landscape",
      "golden-hour silhouettes on ridgelines, caravans and trains crossing the frame on strong diagonals",
      "measured stately pacing that lets scale accumulate rather than cutting away",
    ],
    signatureShot:
      "an extreme wide of shimmering desert in which a lone rider gradually materializes out of a mirage on the horizon, held in one unbroken take",
  },
  {
    key: "danny-boyle",
    country: "United Kingdom",
    director: "Danny Boyle",
    era: "1994–present",
    techniques: [
      "restless kinetic camera: canted angles, sprinting handheld pursuit shots, crash zooms",
      "acid-bright saturated grade with mixed light sources — sodium orange, toxic green, cold neon",
      "needle-drop montage editing at music-video tempo with jump cuts and speed ramps",
      "wide lenses pushed close to faces for distorted, adrenalized intimacy",
      "surreal fantasy inserts erupting inside gritty realist settings",
      "low camera angles skimming floors and streets to give motion physical urgency",
    ],
    signatureShot:
      "a young man sprinting straight at a low wide-angle camera down a narrow street, motion blur streaking, propulsive track pounding, hard cut on the beat",
  },
  {
    key: "ridley-scott",
    country: "United Kingdom",
    director: "Ridley Scott",
    era: "1977–present",
    techniques: [
      "dense atmospheric haze and smoke sliced by hard shafts of light through blinds, grates and fans",
      "layered frames crowded with practical detail: rain, steam, neon signage, drifting embers",
      "silhouettes set against enormous single light sources with deep low-key shadow",
      "slow majestic establishing shots of monumental environments before descending to street level",
      "multi-camera battle coverage cut rhythmically through dust, debris and weather",
      "commercial-honed image polish: every frame lit and dressed like a painting",
    ],
    signatureShot:
      "a dark interior sliced by shafts of light through slowly rotating fan blades, smoke drifting, a silhouetted figure at a rain-streaked window above a neon-lit city",
  },
  {
    key: "nayla-al-khaja",
    country: "UAE",
    director: "Nayla Al Khaja",
    era: "2000s–present (first female Emirati feature director)",
    techniques: [
      "slow-burn pacing with long held shots that let unease accumulate toward one large reveal",
      "dark moody palette with deep playable shadows and amplified jewel hues glowing out of blackness",
      "intimate close-ups lit by single practical sources — lamps, candle flame, doorway spill",
      "traditional interiors and desert exteriors rendered with rich, tactile production-design texture",
      "camera creeping forward at a whisper pace, tension carried by atmosphere and sound rather than cuts",
      "beauty and dread held in the same frame: ornate detail emerging from gloom",
    ],
    signatureShot:
      "a slow creeping push through a dim traditional interior toward a doorway of warm light, heavy shadow on both sides, ornate textures barely surfacing from the dark",
  },
  {
    key: "ali-f-mostafa",
    country: "UAE",
    director: "Ali F. Mostafa",
    era: "2009–present",
    techniques: [
      "interwoven multi-character city storytelling with each narrative strand shot and graded in its own distinct style",
      "glossy contemporary urban imagery: glass towers at dusk, highway light streaks, rooftop wides",
      "contrast cutting between luxury interiors and working-class spaces to map a city's social layers",
      "warm golden exterior light played against cool blue corporate interior light",
      "handheld naturalism at street level, smooth crane and vehicle-mounted moves for skyline scale",
      "kaleidoscopic pacing where separate lives converge through crosscutting",
    ],
    signatureShot:
      "a night-time aerial glide along an illuminated highway toward a skyline of glass towers, light trails streaming, then a cut down to street level where strangers' paths intersect",
  },
  {
    key: "majid-al-ansari",
    country: "UAE",
    director: "Majid Al Ansari",
    era: "2015–present",
    techniques: [
      "claustrophobic single-location staging with the camera prowling through bars, grilles and door hatches",
      "pulpy neo-noir grade of sickly greens and ambers with hard top light and deep black shadows",
      "wide lenses held close to sweating faces for pressure-cooker intensity",
      "overhead and ceiling-locked angles that trap characters inside geometric cells of light",
      "long coiled stillness broken by sudden bursts of stylized violence",
      "genre-thriller rhythm: escalating standoffs cut with surgical precision",
    ],
    signatureShot:
      "a straight-down overhead shot into a cramped cell, a figure pacing inside hard-edged rectangles of light and shadow like a cage within a cage, sickly green-amber grade",
  },
  {
    key: "denis-villeneuve",
    country: "Canada",
    director: "Denis Villeneuve",
    era: "1998–present",
    techniques: [
      "monumental minimalism: huge negative space with tiny figures dwarfed by brutalist structures and landscapes",
      "slow deliberate dolly and aerial drifts with long meditative pacing",
      "desaturated near-monochrome palettes — dust orange, concrete grey, cold teal — under soft diffused light",
      "silhouettes in fog and dust, with light through haze as the primary visual subject",
      "wide anamorphic compositions held in deep stillness over a low droning score",
      "dread built through scale and silence rather than movement",
    ],
    signatureShot:
      "a vast symmetrical wide of a lone silhouetted figure walking toward a colossal structure shrouded in haze, slow aerial drift, muted monochrome palette",
  },
  {
    key: "david-cronenberg",
    country: "Canada",
    director: "David Cronenberg",
    era: "1970s–present",
    techniques: [
      "clinical static framing under cool institutional light — fluorescent green, surgical white",
      "a detached, unflinching camera observing bodily transformation in unhurried medium shots",
      "sterile modernist interiors intercut with anatomical and mechanical textures in unsettling close-up",
      "muted palette punctured by sudden visceral reds, practical prosthetic detail shot matter-of-factly",
      "slow zooms and calm procedural pacing that make the grotesque feel administrative",
      "flat affect blocking: characters discuss horror with the composure of clinicians",
    ],
    signatureShot:
      "a slow clinical push-in across a sterile room toward a flesh-and-machine hybrid on a table, flat fluorescent light, the camera unmoved by the disturbing detail",
  },
  {
    key: "atom-egoyan",
    country: "Canada",
    director: "Atom Egoyan",
    era: "1984–present",
    techniques: [
      "cool glassy compositions with characters viewed through screens, windows and video monitors",
      "fragmented time-shuffled editing that withholds the central event until late",
      "wintry muted palette — snow white, slate blue, dim amber interiors",
      "long static takes with emotionally repressed blocking, characters held at a distance from one another",
      "degraded video-within-film textures standing in for memory and grief",
      "quiet pacing where meaning assembles retroactively across scenes",
    ],
    signatureShot:
      "a character watching degraded home-video footage on a monitor in a dark room, their reflection ghosted on the glass, static wide, wintry blue light",
  },
  {
    key: "george-miller",
    country: "Australia",
    director: "George Miller",
    era: "1979–present",
    techniques: [
      "high-octane vehicular chase choreography shot from mounted cameras inches off the ground",
      "crash zooms and variable frame-rate ramps that snap action to attention",
      "center-framed action so the key subject sits dead center and cuts stay readable at breakneck tempo",
      "saturated two-tone grade: burnt-orange desert against rich teal sky and blue night",
      "practical stunts, real vehicles and towering dust plumes across wide desert vistas",
      "cutting on motion vectors so successive shots hand off momentum like a relay",
    ],
    signatureShot:
      "a ground-skimming mounted camera racing beside pounding wheels through orange desert, dust and flame filling the frame, crash zoom to a driver's eyes dead center",
  },
  {
    key: "baz-luhrmann",
    country: "Australia",
    director: "Baz Luhrmann",
    era: "1992–present",
    techniques: [
      "theatrical maximalism: glitter, confetti, fireworks and swirling crowds packing every frame",
      "hyper-saturated jewel palette with spotlit key subjects staged as operatic tableaux",
      "frenetic whip pans, crash zooms and rapid-fire cutting that open sequences at delirious tempo before slowing for intimacy",
      "impossible swooping camera dives from wide cityscape through a window into a close-up",
      "anachronistic pop music over lavish period spectacle, artifice embraced with visible curtains and signage",
      "editing that treats the frame like a stage: entrances, reveals, curtain moments",
    ],
    signatureShot:
      "a swooping aerial dive across a glittering night city, through a window into a crowded ballroom, landing on a spotlit close-up of two lovers as confetti drifts",
  },
  {
    key: "peter-weir",
    country: "Australia",
    director: "Peter Weir",
    era: "1975–present",
    techniques: [
      "dreamlike naturalism: golden diffused light, soft focus, landscape treated as a sentient presence",
      "slow motion and gauze diffusion for hallucinatory pastoral passages",
      "characters framed small against imposing nature — monolithic rock, ocean, wheat fields",
      "long wordless observational passages carried by ambient flute or choral texture",
      "gentle push-ins on faces confronting something unknowable just off-screen",
      "unease seeded inside beauty: idyllic frames that feel faintly wrong",
    ],
    signatureShot:
      "young women in white dresses drifting up a sunlit rock face in soft-focus slow motion, golden haze all around, an uneasy stillness beneath the beauty",
  },
  {
    key: "eric-khoo",
    country: "Singapore",
    director: "Eric Khoo",
    era: "1995–present",
    techniques: [
      "unvarnished social realism in public-housing corridors and hawker stalls, fluorescent and sodium light left uncorrected",
      "static observational frames holding on lonely figures inside cramped flats",
      "muted grade with a cool institutional glow and 16mm-style grain and texture",
      "urban-isolation blocking: characters share the frame but never touch or meet eyes",
      "late-night city ambience — void decks, corridors, all-night eateries — carried by long silences",
      "compressed time and space: one block, one day, several intersecting lonely lives",
    ],
    signatureShot:
      "a static wide down a fluorescent-lit public-housing corridor at night, a solitary figure eating alone at a folding table, cool green cast, distant city hum",
  },
  {
    key: "jack-neo",
    country: "Singapore",
    director: "Jack Neo",
    era: "1998–present",
    techniques: [
      "bright even lighting with warm domestic interiors of everyday family flats",
      "ensemble comedy blocking in kitchens, classrooms and offices, staged wide so reactions play off each other",
      "fast punchline-driven cutting alternating with sentimental slow push-ins on emotional beats",
      "primary-color heartland realism: school uniforms, market stalls, bureaucratic beige played for satire",
      "montages of ordinary routines set to sentimental ballads",
      "broad performances framed plainly so social critique lands through comedy",
    ],
    signatureShot:
      "a warm wide of a family crammed around a small dinner table in a modest flat, bright practical light, comic chaos in front while one quietly hurt face sits in the background",
  },
  {
    key: "anthony-chen",
    country: "Singapore",
    director: "Anthony Chen",
    era: "2013–present",
    techniques: [
      "quiet naturalism: available light, real locations, a muted humid tropical palette, no visual flourish",
      "carefully composed static frames where doorways and windows box characters into domestic space",
      "handheld camera held uncomfortably close to bodies so intimacy feels voyeuristic",
      "monsoon atmosphere: rain-streaked glass, overcast soft light, damp greens and greys",
      "no musical score; everyday actions played out in full to earn small emotional turns",
      "restrained blocking where what characters do not say structures the scene",
    ],
    signatureShot:
      "a static medium shot through a rain-streaked car window of two people sitting in silence, soft overcast light, wipers keeping time",
  },
  {
    key: "royston-tan",
    country: "Singapore",
    director: "Royston Tan",
    era: "2003–present",
    techniques: [
      "hyper-stylized neon saturation — hot pink, purple and electric blue washing over faces",
      "music-video editing with jump cuts, speed ramps and animated graphic overlays breaking realism",
      "sequined stage spectacle with lasers, feathers and colored spotlights shot head-on like a variety show",
      "mixed-media inserts: cartoon doodles and handwritten text scrawled over live action",
      "tender static portraits between the chaos — a face held long in a single saturated color wash",
      "gritty street realism collided with kitsch fantasy inside the same sequence",
    ],
    signatureShot:
      "two performers in dazzling sequined costumes on a neon-flooded outdoor stage, lasers sweeping and feathers drifting, framed head-on in saturated pink and blue",
  },
];

/**
 * The prompt block for one style — techniques only, no names. Returns "" for
 * an unknown key so a stale/invalid request degrades to "no style" rather
 * than failing a paid plan.
 */
export function styleBlockFor(key: string): string {
  const s = DIRECTOR_STYLES.find((d) => d.key === key);
  if (!s) return "";
  const lines = [
    "VISUAL STYLE for this film — carry this grammar through every shot:",
    ...s.techniques.map((t) => `- ${t}`),
  ];
  if (s.signatureShot) lines.push(`- signature composition to use once: ${s.signatureShot}`);
  return lines.join("\n");
}
