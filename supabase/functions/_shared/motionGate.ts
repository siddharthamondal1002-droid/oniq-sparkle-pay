/**
 * The calibrated motion gate, in one place both runtimes can read.
 *
 * This number was measured, not chosen: two identical frames score exactly
 * 0, an encoder's noise floor on a frozen scene stays well under 0.5, and
 * real generated motion on the ep3-era clips scored several whole units.
 * 0.75 sits in the empty gap between those bands — low enough that gentle
 * drift passes, high enough that a still in a video container cannot.
 *
 * It lives under supabase/functions/_shared because the dependency only
 * runs one way in this project: the app may read the shared core, the
 * edge functions may never read the app. Both the Remotion-era motion
 * runtime and the Director's reviewer gate on THIS constant, so the film
 * cannot be judged by two different lines.
 */
export const CLIP_ALIVENESS_MIN = 0.75;
