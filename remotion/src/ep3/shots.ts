// Episode 3 — dividing each scene's frames between the clips that cover it.
//
// This is the join between the shot list (src/data/ep3Shots.ts, which says what
// each clip shows) and the timeline (./manifest.ts, which says how long each
// scene runs). It resolves one into the other and REFUSES TO LOAD if the result
// is not something the generator could have produced.
//
// The throw is at module scope on purpose. It fires inside the webpack bundle,
// which blocks the render outright — stronger than a test, because it cannot be
// skipped, and it is the one thing standing between a bad allocation and
// fifty-seven paid generations of clips that will not fit.
//
// Not importable by scripts/build-bed-envelope.mjs — that transpiles a single
// file and resolves no imports. It only needs manifest.ts, which is why the
// scene-level timeline is kept there and separate from this.
import { EP3_SHOTS, type Ep3Shot } from '../../../src/data/ep3Shots';
import { allocateFrames, checkShotFrames } from '../../../src/lib/shotAllocation';
import { EP3_FRAMES, EP3_SCENES, FPS } from './manifest';

/**
 * Cross-dissolve for the three in-scene time jumps in S11, in frames.
 *
 * Shorter than the 15-frame scene transition: this is "a while later", not "a
 * new part of the story", and the two want to read differently.
 */
export const SHOT_DISSOLVE_FRAMES = 12;

export type Ep3ShotPlan = Ep3Shot & {
  /**
   * Frames of GENERATED VIDEO this shot needs.
   *
   * Not the same as the frames it occupies on the timeline: a shot dissolved
   * into overlaps its predecessor by SHOT_DISSOLVE_FRAMES, so the pair together
   * occupy that many fewer. This is the number the generator has to make, and
   * the number the 10-second ceiling applies to.
   */
  frames: number;
};

function planScene(sceneIndex: number): Ep3ShotPlan[] {
  const scene = EP3_SCENES[sceneIndex];
  const shots = EP3_SHOTS.filter((s) => s.sceneId === scene.id);
  if (shots.length === 0) throw new Error(`ep3 shots: ${scene.id} has no shots`);

  // A TransitionSeries is shorter than the sum of its parts by one transition
  // per overlap, so generate that much extra and let the overlaps eat it. The
  // scene still lands on exactly EP3_FRAMES[sceneIndex], which is what every
  // downstream offset depends on.
  const overlap = shots.filter((s) => s.transitionIn === 'dissolve').length * SHOT_DISSOLVE_FRAMES;
  const frames = allocateFrames(
    shots.map((s) => s.weight),
    EP3_FRAMES[sceneIndex] + overlap,
  );

  const violations = checkShotFrames(frames, FPS);
  if (violations.length > 0) {
    throw new Error(
      `ep3 shots: ${scene.id} (${scene.seconds}s over ${shots.length} shots) cannot be ` +
        `generated — ` +
        violations
          .map((v) => `${shots[v.index].id} is ${v.seconds.toFixed(2)}s (${v.reason})`)
          .join(', ') +
        `. Add or remove a shot in src/data/ep3Shots.ts; do not stretch the narration.`,
    );
  }

  return shots.map((shot, i) => ({ ...shot, frames: frames[i] }));
}

/** The shots of each scene, in cut order, indexed the same as EP3_SCENES. */
export const EP3_SCENE_SHOTS: Ep3ShotPlan[][] = EP3_SCENES.map((_, i) => planScene(i));

// Belt and braces. planScene builds the allocation to close; this asserts that
// it DID, against the composed length the renderer will actually produce. If
// these ever disagree the fault is in the overlap arithmetic above, and it
// would otherwise surface as every scene after the first sitting a few frames
// out — inaudible in a still, obvious only in a finished seven-minute file.
for (const [i, shots] of EP3_SCENE_SHOTS.entries()) {
  const overlap = shots.filter((s) => s.transitionIn === 'dissolve').length * SHOT_DISSOLVE_FRAMES;
  const composed = shots.reduce((a, s) => a + s.frames, 0) - overlap;
  if (composed !== EP3_FRAMES[i]) {
    throw new Error(
      `ep3 shots: ${EP3_SCENES[i].id} composes to ${composed} frames but the scene is ` +
        `${EP3_FRAMES[i]}. The shot split does not close.`,
    );
  }
}

/** Every shot in the episode, flat and in play order. */
export const EP3_SHOT_PLAN: Ep3ShotPlan[] = EP3_SCENE_SHOTS.flat();
