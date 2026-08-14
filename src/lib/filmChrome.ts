// RUNG 9 — the opening and the close. A film that starts cold on shot one
// and stops dead on the last frame is a slideshow with good manners; a
// movie opens with its name and closes by letting go of the picture.
//
// TWO OVERLAYS AND NOTHING MORE, both movie grade only:
//   - The title card: the film's name over the opening seconds of the
//     FIRST shot, fading in and out over a soft scrim.
//   - The close: the final seconds of the LAST shot easing to black.
//
// NEITHER ADDS A FRAME. Story seconds are paid seconds — the chrome rides
// OVER the shots the user bought instead of appending unpaid ones, which
// also keeps narration-as-clock and every duration contract untouched.
// Classic films render pixel-identical: no grade, no chrome.
//
// Zero imports, like every module the story worker might one day load.

/** How long the title card lives, from the first frame. */
export const TITLE_SECONDS = 2.8;

/** Title fade shape: quick rise, longer release. */
export const TITLE_FADE_IN_SECONDS = 0.6;
export const TITLE_FADE_OUT_SECONDS = 0.8;

/** The close: how much of the last shot eases to black. */
export const END_FADE_SECONDS = 1.2;

/**
 * Title opacity at one frame, 0 outside its window. Rise, hold, release —
 * all inside TITLE_SECONDS, so the card is gone before the second shot.
 */
export function titleOpacityAt(frame: number, fps: number): number {
  if (fps <= 0 || frame < 0) return 0;
  const total = TITLE_SECONDS * fps;
  if (frame >= total) return 0;
  const rise = (frame + 1) / Math.max(1, TITLE_FADE_IN_SECONDS * fps);
  const fall = (total - frame) / Math.max(1, TITLE_FADE_OUT_SECONDS * fps);
  return Math.max(0, Math.min(1, rise, fall));
}

/**
 * Black-overlay opacity for the close: 0 until the fade window opens,
 * easing to 1 exactly at the film's final frame. Ease-in (squared) so the
 * picture lingers and then commits.
 */
export function endFadeAt(frame: number, totalFrames: number, fps: number): number {
  if (fps <= 0 || totalFrames <= 0) return 0;
  const window = Math.max(1, END_FADE_SECONDS * fps);
  const into = frame - (totalFrames - 1 - window);
  if (into <= 0) return 0;
  const t = Math.min(1, into / window);
  return t * t;
}
