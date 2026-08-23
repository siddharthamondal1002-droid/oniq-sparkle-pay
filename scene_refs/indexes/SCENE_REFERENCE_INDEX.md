# ONIQ SCENE REFERENCE LIBRARY — human index (v1.0, frozen 2026-08-23)

Mode: LIBRARY INGESTION ONLY. Zero images generated. All records below are
measured from the 10 user-attached source files; hashes are real sha256sum
output from this host. Presentation target 5:4 is RECORDED ONLY — no source
was cropped, resized, re-encoded, or otherwise altered (copies are
byte-verified against source hashes).

Attachment order was established rigorously: the inline attachments in the
commissioning message were perceptually matched one-to-one against the
preserved upload files (MSE ≤ 8.8 at 32×32; the byte-identical pair sits at
positions 3 and 8 in both views), so `attachment_position` → §2 logical
filename mapping is evidence, not assumption.

## Registered records

| ID | logical filename (§2) | SHA-256 (16) | dims | aspect | class | notes |
|---|---|---|---|---|---|---|
| SCN-001 | Firefly_Make me 10 more descriptive images like this 98084.png | 11e1c05a3de7a609 | 1536×1024 | 3:2 | UNIQUE | ONIQ Scene Reference Library (ULTRA EDITION), 26 sections |
| SCN-002 | Firefly_Make me 10 more descriptive images like this 728799.png | d751fafb09a776ce | 1536×1024 | 3:2 | UNIQUE | ONIQ Scene Reference Library (MEGA EDITION), ~23 sections, env collages |
| SCN-003 | ONIQ Ultra Master Scene Reference Library.png | 3ae6355f9d85cb1a | 1264×843 | ~3:2 | EXACT_DUPLICATE | byte-identical to registered character reference oniq_structural_9poster_grid.png |
| SCN-004 | Firefly_Gemini Flash_Make me 10 descriptive images like this 98084 (1).png | 7f7799ab14018698 | 1264×843 | ~3:2 | EXACT_DUPLICATE | byte-identical to registered character reference oniq_global_edition.png |
| SCN-005 | Firefly_Gemini Flash_Make me 10 descriptive images like this 98084.png | 41c46208b398993f | 1264×843 | ~3:2 | EXACT_DUPLICATE | byte-identical to registered creature reference oniq_creature_colossal.png |
| SCN-006 | Firefly_Gemini Flash_Make me more images like this 964148.png | 0e0a44663db38811 | 1536×1024 | 3:2 | UNIQUE | ONIQ Scene Reference Library (GLOBAL EDITION), 21 sections |
| SCN-007 | Firefly_Gemini Flash_Make me 10 more descriptive images like this 98084.png | 57de71265a982197 | 1402×1122 | 701:561 (1.2496 — within 0.04% of 5:4, NOT exact) | UNIQUE | ONIQ Scene Reference Library (ULTRA EDITION v2.0), 28 sections |
| SCN-008 | Global Scene Reference Library Collage.png | 3ae6355f9d85cb1a | 1264×843 | ~3:2 | EXACT_DUPLICATE | byte-identical to SCN-003 (and to oniq_structural_9poster_grid.png); alias only, no second master stored |
| SCN-009 | ONIQ Scene Reference Library Poster.png | ee19e51e581531d8 | 1264×843 | ~3:2 | UNIQUE | VISTA — Global Reference (MASTER EDITION), 500+ new refs, 18 sections |
| SCN-010 | ONIQ Scene Reference Library Infographic.png | 59ece0090ee22b95 | 1264×843 | ~3:2 | UNIQUE | ONIQ Scene Reference Library (ULTRA EDITION, infographic variant), ~23 sections |

Full 64-hex hashes: `scene_refs/evidence/EVIDENCE_SHA256.txt`.
Masters (one per distinct hash, 9 files): `scene_refs/masters/`.

Deduplication: per the loop's rule the hashes decided, not the filenames —
and the filenames actively mislead here: three §2 names that SOUND like new
scene posters ("ONIQ Ultra Master Scene Reference Library", "Global Scene
Reference Library Collage") are byte-exact re-sends of already-registered
CHARACTER-program posters, while three "Firefly_…" names are genuinely new
scene posters. Near-duplicate scan (256-bit dHash, all 10 attachments × 13
registered references): zero non-exact pairs within Hamming ≤ 40 — the
three ULTRA-edition variants (SCN-001/007/010) are structurally distinct
layouts, so all are kept per §29.

Integrity note (not a HOLD): all 10 decode cleanly (PIL verify + load, and
OpenCV decode; RGB, no broken alpha, no truncation). The posters are
AI-generated collages and several text labels on them are garbled
(e.g. "VAMOSPHERIC", "ABSTRAC ART"); classification below is by visible
visual content — poster text is not treated as authoritative.

## Poster section inventories (basis for the index counts)

Unit of counting everywhere below: one indexed poster SECTION (a titled
panel group). Panel-level "1000+ references" claims printed on the posters
are the posters' own marketing text and are NOT counted as measurements.

- SCN-001 ULTRA: scene 4 (categories overview, scale reference, character
  scale in environments, story context) · cinematography 4 (camera & lens,
  composition & framing, lighting setups, color grading & mood) ·
  environment 5 (time-of-day 24h, weather, seasons, surfaces, asset
  categories) · engineering 10 (pipeline overview, file & data mgmt,
  rendering details, performance/optimization, engineering specs, quality
  checklist, production pipeline flow, API & automation, shot planning
  template, data mgmt & backup) · motion 2 (walk/run/idle cycles, physics &
  FX) · negative 1.
- SCN-002 MEGA: scene 9 (interiors daily life, urban, nature, rural,
  historical, fantasy/sci-fi, special locations, story context, props
  context) · environment 4 (time, weather, seasons, environment details) ·
  cinematography 4 (camera, composition, lighting, color/mood) · negative 2
  (two negative panels) · engineering 4 (technical reminders, production
  readiness checklist, use cases, legend/status). Poster internally repeats
  one color-grading header (generation artifact) — counted once.
- SCN-006 GLOBAL: scene 9 (interiors, urban, nature, rural, historical,
  fantasy, professional/workplaces, special locations, story context) ·
  environment 5 (weather, time, seasons, props & set dressing, environment
  details) · cinematography 5 (camera, composition, emotional tone/mood,
  color grading & lighting, background depth & layers) · motion 1 (action &
  movement scenes) · negative 1.
- SCN-007 ULTRA v2.0: scene 4 · cinematography 4 · environment 6 (adds
  props & set dressing) · engineering 11 (adds engineering-principles bar)
  · motion 2 · negative 1.
- SCN-009 VISTA: scene 14 (historical battles/armies, maritime
  history/ships, vehicle interiors, ancient civilizations, modern sports,
  entertainment venues, culinary spaces, transport hub interiors,
  recreational outdoor, scientific laboratories, fauna-specific biomes,
  global cultural festivals, emerging technology interiors, abstract art
  movements) · environment 2 (textiles & costume patterns, decay &
  ruination stages) · engineering 2 (use cases, legend/status).
- SCN-010 ULTRA infographic: scene 3 · cinematography 4 · environment 5 ·
  engineering 9 (incl. post-processing & special effects, cinematic
  storytelling tools, version control & collaboration) · motion 2 ·
  negative 0 (no negative section on this variant).

Section totals across the 6 unique masters: scene 43 · cinematography 21 ·
environment 27 · engineering 36 · motion 7 · negative 5.

## Taxonomy coverage (70-category standard, §8)

Covered: 69 of 70. Per-record category lists live in
`SCENE_LIBRARY_MANIFEST.json` (union verified programmatically).

LIBRARY_GAP (recorded, NOT filled by generation, per §28):
- **16 AIRCRAFT** — no dedicated aircraft reference anywhere in the six
  masters; only airport terminals (cat 13) and generic vehicle cockpits
  (cat 14) appear.

Thin-but-covered (single-source, noted for planning honesty): 17 SPACECRAFT
(interior panels only), 26/27 sports & recreation (SCN-009 only), 32/36/
54/55/56/57/58 (SCN-009 only). If SCN-009 were ever lost, these become
gaps.

## Engineering information index (§9–§23) — where each dimension lives

- Camera type / shot size / lens / angle / movement (§11): SCN-001 §5,
  SCN-002 §11, SCN-006 §11, SCN-007 §5, SCN-010 §5 — extreme wide→extreme
  close scale strips; low/high/eye/top/bottom/Dutch/over-shoulder/POV/
  silhouette; pan-tilt-dolly-truck-crane-arc-handheld-static tables.
- Composition & framing (§12): rule of thirds, golden ratio, leading lines,
  symmetry/asymmetry, foreground interest, negative space, depth layering,
  frame-in-frame, reflection, contrast, balance — SCN-001 §6, SCN-002 §12,
  SCN-006 §12+§19 (background depth/layers), SCN-007 §6, SCN-010 §6.
- Lighting (§13): three-point diagrams (key/fill/back), high key, low key,
  rim; light types (directional/point/spot/area/sky/practical/emissive on
  SCN-007) — SCN-001 §7, SCN-002 §13, SCN-006 §16, SCN-007 §7, SCN-010 §7.
- Color / mood (§14): warm, cool, high/low contrast, desaturated, vibrant,
  cinematic, noir, teal & orange + hue wheels — SCN-001 §8, SCN-002 §14,
  SCN-006 §16, SCN-007 §8, SCN-010 §8; emotional tone (happy…horror)
  SCN-006 §15. Recorded as references only, NOT production grades.
- Time / weather (§15): 24-hour cycle strips with sun position, color
  temperature (1900K–7900K) and light quality rows — SCN-001 §9, SCN-007
  §9, SCN-010 §9; sunny→blizzard, fog/mist, storm — SCN-001 §10, SCN-002
  §9, SCN-006 §9, SCN-007 §10, SCN-010 §10.
- Season (§16): spring/summer/autumn/winter + monsoon, harvest, dry, snow,
  festival, storm seasons — SCN-001 §11, SCN-002 §10, SCN-006 §13, SCN-007
  §11, SCN-010 §11.
- Surface / material (§17): concrete, brick, stone, wood, metal, glass,
  water, sand, soil, grass, snow, ice + albedo/normal/roughness/
  displacement texture rows — SCN-001 §12, SCN-007 §12, SCN-010 §12;
  textiles/costume patterns SCN-009 §9; decay/weathering SCN-009 §13.
- Environmental detail (§18): walls, floors, doors, windows, stairs,
  ceilings, roads, bridges, plants, street furniture — SCN-002 §15(18),
  SCN-006 §18; asset categories (buildings, vehicles, props, vegetation,
  street furniture, industrial) SCN-001 §13, SCN-007 §13, SCN-010 §13.
- Scene scale (§10): human/vehicle/building/city/landscape scale strips
  with qualitative size bars — SCN-001 §2, SCN-007 §2, SCN-010 §2;
  character-in-environment scale (interior/street/square/mountain) SCN-001
  §14, SCN-007 §14, SCN-010 §14. No fabricated physical measurements
  recorded beyond what the posters print.
- Character/scene relationship (§19): character scale, placement, depth
  position via the character-scale-in-environment panels; scene references
  NOT locked to depicted character identities.
- Motion (§20): walk cycle (8 steps: contact, down, passing, up,
  opp-contact, opp-down, push-off, recovery), run cycle, idle motions
  (breathing, weight shift, look around, hand adjust) — SCN-001 §17,
  SCN-007 §17, SCN-010 §17; action & movement scenes (running, chasing,
  jumping, climbing, falling) SCN-006 §14. ONIQ motion hierarchy retained:
  WALKING primary · IDLE secondary · TURN tertiary · WAVE/REACH unpromoted.
  These panels do NOT validate any motion grammar — the frozen MOTION
  STANDARD and measured evidence remain authoritative.
- Physics/FX (§37-adjacent): cloth, water, fire & smoke, destruction —
  SCN-001 §18, SCN-007 §18, SCN-010 §18; volumetric/particles/lens
  flares/DOF post-processing SCN-010 §19.
- Story context (§21): introduction, establishing/conflict build-up,
  rising action, turning point, climax, falling action, resolution,
  epilogue strips — SCN-001 §22, SCN-002 story panels, SCN-006 §20,
  SCN-007 §22, SCN-010 story panel. Scene-design references only.
- Production engineering (§23): pipeline overview
  (pre-production→production→post→delivery), rendering passes/output
  formats (EXR/PNG/JPG)/resolutions (HD→8K), polycount guidelines, LOD/
  instancing/culling/baking optimization, engineering specs (renderer,
  samples, GI, export, gamma), quality checklists (visual/technical/
  performance), API & automation (Maya/Blender/Unreal/Houdini Python,
  AWS S3, ShotGrid), shot-planning template (scene/shot/type/angle/lens/
  movement/description), backup strategy + versioning + checksums,
  version control & collaboration (SCN-010 §22: git/Perforce flow,
  branching, code/asset review, project management, server infra) —
  SCN-001 §3/4/15/16/19/20/23–26, SCN-007 same +engineering principles,
  SCN-010 §3/4/15/16/19–23, SCN-002 technical reminders + production
  readiness checklist, SCN-009 use-case panels.
- Negative references (§22): bad lighting, over/underexposure, cluttered
  frame, poor composition, wrong scale, texture stretching — SCN-001 §21,
  SCN-002 two panels, SCN-006 §21, SCN-007 §21. Classified
  NEGATIVE_REFERENCE; never production-positive.

## Authority boundary (§3)

ONIQ_SCENE_REFERENCE_LIBRARY is supplementary. It does NOT replace the
character anatomy standard, the motion standard (knee-damping ×0.50
acceptance state unchanged), quality gates, the measured negative
catalogue, or production constraints. CHARACTER + MOTION + SCENE references
together form the complete ONIQ visual reference system.
