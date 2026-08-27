/**
 * ONIQ Story IR — the structured story every stage downstream reads.
 *
 * Owner directive 2026-08-27 (local story intelligence): the renderer must
 * never interpret creative prose. The local model emits THIS, the
 * validator proves it, the compiler turns it into production objects, and
 * only then does anything expensive run.
 *
 * The IR is deliberately close to the shapes this project already renders
 * (movieGrammar's still / motion / dialogue split, narration as the
 * clock) so it is one representation of a story, not a second one.
 *
 * NOTHING HERE INFERS IDENTITY. A character carries whatever appearance
 * the story establishes and nothing else; no field exists for ethnicity,
 * gender, nationality or occupation, so no stage can quietly assign one.
 */

export type IrCharacter = {
  id: string;
  name: string;
  /** What the camera sees. Established by the story, never inferred. */
  appearance: string;
  clothing?: string;
  personality: string;
  goal: string;
  fear: string;
  contradiction: string;
  relationships?: { to: string; as: string }[];
  /** Which voice speaks this character. Assigned by the compiler. */
  voiceId?: string;
};

export type IrWorld = {
  locations: { id: string; name: string; description: string }[];
  visualStyle: string;
  timePeriod?: string;
  rules?: string[];
  importantObjects?: string[];
  continuityConstraints?: string[];
};

export type IrShot = {
  id: string;
  /** What the frame IS — feeds the in-house image engine. */
  visualDescription: string;
  /** What MOVES — feeds LTX. Camera and movement only, never the frame. */
  motionDescription: string;
  cameraDescription: string;
  /** Character ids present, resolved against the bible. */
  characters: string[];
  locationId: string;
  durationSeconds: number;
  narration?: string;
  dialogue?: { speaker: string; line: string };
};

export type IrScene = {
  id: string;
  purpose: string;
  conflict: string;
  locationId: string;
  characters: string[];
  shots: IrShot[];
};

export type IrAct = { id: string; purpose: string; sceneIds: string[] };

export type StoryIr = {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  theme: string;
  targetDurationSeconds: number;
  characters: IrCharacter[];
  world: IrWorld;
  acts: IrAct[];
  scenes: IrScene[];
  /** DNA entry ids this story recombined. Provenance, never prose. */
  dnaSources: string[];
};

/* ----------------------------------------------------------- budgeting */

/**
 * Duration-aware planning. The directive's rule: budget FIRST, then write
 * to the budget — never write a story and discover it is three times too
 * long. These numbers come from what this project already measures: a
 * shot is a generated clip of VIDEO_CLOCK_SECONDS, and narration is the
 * clock, so words-per-shot follows the measured speaking rate.
 */
export const SHOT_SECONDS = 4;
/** Measured narration rate used by the existing duration pre-gate. */
export const WORDS_PER_SECOND = 2.5;
export const MIN_SHOTS_PER_SCENE = 2;
export const MAX_SHOTS_PER_SCENE = 8;

export type Budget = {
  targetSeconds: number;
  shots: number;
  scenes: number;
  shotsPerScene: number;
  wordsPerShot: number;
  totalWords: number;
};

export function budgetFor(targetSeconds: number): Budget {
  const shots = Math.max(1, Math.round(targetSeconds / SHOT_SECONDS));
  // Scenes are sized so a scene reads as a scene: never one shot, never
  // so many that a location change stops meaning anything.
  const shotsPerScene = Math.min(
    MAX_SHOTS_PER_SCENE,
    Math.max(MIN_SHOTS_PER_SCENE, Math.round(Math.sqrt(shots))),
  );
  const scenes = Math.max(1, Math.ceil(shots / shotsPerScene));
  const wordsPerShot = Math.floor(SHOT_SECONDS * WORDS_PER_SECOND);
  return {
    targetSeconds,
    shots,
    scenes,
    shotsPerScene,
    wordsPerShot,
    totalWords: shots * wordsPerShot,
  };
}

/* ---------------------------------------------------------- validation */

export type IrProblem = { code: string; where: string; detail: string };

/** Tolerance on total duration, as a fraction of the target. */
export const DURATION_TOLERANCE = 0.2;

/**
 * Prove the story before anything expensive runs.
 *
 * Every check here is one an invalid story would otherwise fail at, much
 * later, with GPU money already spent: a shot naming a character nobody
 * defined, a speaker who does not exist, a shot with nothing to draw, a
 * film that is twice the length that was sold. Returns EVERY problem
 * rather than the first, because a story with six faults should be
 * regenerated once, not six times.
 */
export function validateStoryIr(ir: StoryIr, opts: { movieGrade?: boolean } = {}): IrProblem[] {
  const problems: IrProblem[] = [];
  const bad = (code: string, where: string, detail: string) =>
    problems.push({ code, where, detail });

  if (!ir.title?.trim()) bad("no-title", "story", "a story needs a title");
  if (!ir.logline?.trim()) bad("no-logline", "story", "a story needs a logline");
  if (!Array.isArray(ir.characters) || ir.characters.length === 0) {
    bad("no-characters", "story", "a story needs at least one character");
  }
  if (!Array.isArray(ir.scenes) || ir.scenes.length === 0) {
    bad("no-scenes", "story", "a story needs at least one scene");
    return problems; // nothing below can mean anything without scenes
  }

  const characterIds = new Set((ir.characters ?? []).map((c) => c.id));
  const characterNames = new Set((ir.characters ?? []).map((c) => c.name));
  const locationIds = new Set((ir.world?.locations ?? []).map((l) => l.id));
  const seenShotIds = new Set<string>();
  const seenSceneIds = new Set<string>();

  for (const c of ir.characters ?? []) {
    if (!c.id?.trim()) bad("character-no-id", "characters", "a character has no id");
    if (!c.appearance?.trim()) {
      bad("character-no-appearance", c.id ?? "?", "a character the camera cannot see");
    }
    for (const rel of c.relationships ?? []) {
      if (!characterIds.has(rel.to)) {
        bad("orphan-relationship", c.id, `relationship points at unknown ${rel.to}`);
      }
    }
  }

  let totalSeconds = 0;
  let shotCount = 0;

  for (const scene of ir.scenes) {
    if (seenSceneIds.has(scene.id)) bad("duplicate-scene", scene.id, "scene id repeats");
    seenSceneIds.add(scene.id);
    if (!scene.purpose?.trim())
      bad("scene-no-purpose", scene.id, "a scene with no reason to exist");
    if (locationIds.size && !locationIds.has(scene.locationId)) {
      bad("orphan-location", scene.id, `unknown location ${scene.locationId}`);
    }
    for (const id of scene.characters ?? []) {
      if (!characterIds.has(id)) bad("orphan-character", scene.id, `unknown character ${id}`);
    }
    if (!scene.shots?.length) {
      bad("scene-no-shots", scene.id, "a scene with nothing to render");
      continue;
    }
    for (const shot of scene.shots) {
      shotCount += 1;
      if (seenShotIds.has(shot.id)) bad("duplicate-shot", shot.id, "shot id repeats");
      seenShotIds.add(shot.id);
      if (!shot.visualDescription?.trim()) {
        bad("shot-no-visual", shot.id, "nothing for the image engine to draw");
      }
      if (opts.movieGrade && !shot.motionDescription?.trim()) {
        bad("shot-no-motion", shot.id, "movie grade needs motion for the video engine");
      }
      for (const id of shot.characters ?? []) {
        if (!characterIds.has(id)) bad("orphan-character", shot.id, `unknown character ${id}`);
      }
      if (locationIds.size && !locationIds.has(shot.locationId)) {
        bad("orphan-location", shot.id, `unknown location ${shot.locationId}`);
      }
      if (shot.dialogue) {
        if (!shot.dialogue.line?.trim()) {
          bad("empty-dialogue", shot.id, "a speaker with nothing to say");
        }
        const speaker = shot.dialogue.speaker;
        if (!characterIds.has(speaker) && !characterNames.has(speaker)) {
          bad("orphan-speaker", shot.id, `unknown speaker ${speaker}`);
        }
      }
      if (!(shot.durationSeconds > 0)) {
        bad("shot-no-duration", shot.id, "a shot with no length");
      } else {
        totalSeconds += shot.durationSeconds;
        const spoken = [shot.narration ?? "", shot.dialogue?.line ?? ""].join(" ").trim();
        const words = spoken ? spoken.split(/\s+/).length : 0;
        if (words > shot.durationSeconds * WORDS_PER_SECOND * 1.5) {
          bad(
            "shot-overspoken",
            shot.id,
            `${words} words cannot be spoken in ${shot.durationSeconds}s`,
          );
        }
      }
    }
  }

  for (const act of ir.acts ?? []) {
    for (const id of act.sceneIds ?? []) {
      if (!seenSceneIds.has(id)) bad("orphan-scene", act.id, `act names unknown scene ${id}`);
    }
  }

  const target = ir.targetDurationSeconds;
  if (target > 0) {
    const drift = Math.abs(totalSeconds - target) / target;
    if (drift > DURATION_TOLERANCE) {
      bad("duration-drift", "story", `shots total ${totalSeconds}s against a ${target}s target`);
    }
  }
  if (shotCount === 0) bad("no-shots", "story", "a story with nothing to render");

  return problems;
}
