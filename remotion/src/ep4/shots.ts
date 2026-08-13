// Episode 4 — dividing each scene's frames between the clips that cover it.
//
// The ep3 allocation, re-pointed: same throw-at-module-scope guard (it fires
// inside the webpack bundle, blocking a render of an impossible plan), same
// snap-in-timeline-space discipline, same overlap arithmetic. See
// ep3/shots.ts for the long-form reasoning; only the episode data differs.
import { EP4_SHOTS, type Ep4Shot } from '../../../src/data/ep4Shots';
import {
  MAX_SHOT_SECONDS,
  MIN_SHOT_SECONDS,
  allocateFrames,
  checkShotFrames,
  snapCutsToPauses,
} from '../../../src/lib/shotAllocation';
import { EP4_FRAMES, EP4_SCENES, FPS } from './manifest';
import { EP4_PAUSES } from './pauses';

/**
 * Cross-dissolve for the in-scene time jumps, in frames. ep4 has exactly two,
 * both in S6 — the dust settling on the shelf, "one quiet day at a time".
 * Shorter than the scene transition: "a while later", not "a new chapter".
 */
export const SHOT_DISSOLVE_FRAMES = 12;

/** How far a cut may travel to find a pause, in frames. ep3's measured 1s. */
export const SNAP_SHIFT_FRAMES = FPS;

export type Ep4ShotPlan = Ep4Shot & {
  /** Frames of GENERATED video this shot needs (overlap included). */
  frames: number;
};

function planScene(sceneIndex: number): Ep4ShotPlan[] {
  const scene = EP4_SCENES[sceneIndex];
  const shots = EP4_SHOTS.filter((s) => s.sceneId === scene.id);
  if (shots.length === 0) throw new Error(`ep4 shots: ${scene.id} has no shots`);

  const overlap = shots.filter((s) => s.transitionIn === 'dissolve').length * SHOT_DISSOLVE_FRAMES;
  const generated = allocateFrames(
    shots.map((s) => s.weight),
    EP4_FRAMES[sceneIndex] + overlap,
  );

  // Snap in TIMELINE space: strip the dissolve overlap, snap, put it back.
  const lift = (i: number) => (shots[i].transitionIn === 'dissolve' ? SHOT_DISSOLVE_FRAMES : 0);
  const onTimeline = generated.map((f, i) => f - lift(i));
  const snapped = snapCutsToPauses(onTimeline, EP4_PAUSES[scene.id] ?? [], {
    maxShift: SNAP_SHIFT_FRAMES,
    minFrames: Math.round(MIN_SHOT_SECONDS * FPS),
    maxFrames: shots.map((_, i) => Math.round(MAX_SHOT_SECONDS * FPS) - lift(i)),
  });
  const frames = snapped.map((f, i) => f + lift(i));

  const violations = checkShotFrames(frames, FPS);
  if (violations.length > 0) {
    throw new Error(
      `ep4 shots: ${scene.id} (${scene.seconds}s over ${shots.length} shots) cannot be ` +
        `generated — ` +
        violations
          .map((v) => `${shots[v.index].id} is ${v.seconds.toFixed(2)}s (${v.reason})`)
          .join(', ') +
        `. Add or remove a shot in src/data/ep4Shots.ts; do not stretch the narration.`,
    );
  }

  return shots.map((shot, i) => ({ ...shot, frames: frames[i] }));
}

/** The shots of each scene, in cut order, indexed the same as EP4_SCENES. */
export const EP4_SCENE_SHOTS: Ep4ShotPlan[][] = EP4_SCENES.map((_, i) => planScene(i));

// Belt and braces: assert the allocation closes against the composed length.
for (const [i, shots] of EP4_SCENE_SHOTS.entries()) {
  const overlap = shots.filter((s) => s.transitionIn === 'dissolve').length * SHOT_DISSOLVE_FRAMES;
  const composed = shots.reduce((a, s) => a + s.frames, 0) - overlap;
  if (composed !== EP4_FRAMES[i]) {
    throw new Error(
      `ep4 shots: ${EP4_SCENES[i].id} composes to ${composed} frames but the scene is ` +
        `${EP4_FRAMES[i]}. The shot split does not close.`,
    );
  }
}

/** Every shot in the episode, flat and in play order. */
export const EP4_SHOT_PLAN: Ep4ShotPlan[] = EP4_SCENE_SHOTS.flat();
