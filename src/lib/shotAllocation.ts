/**
 * Dividing a scene's running time between the clips that cover it.
 *
 * Episode 3 is real generated video rather than stills under a camera move, and
 * the generator caps a clip at ten seconds. A scene whose narration runs
 * thirty-three seconds therefore needs four clips, cut together, and the four
 * have to add up to EXACTLY the scene's frame count — not approximately.
 *
 * That exactness is the whole reason this file exists. `sceneStartFrames`,
 * `layOnTimeline` and the precomputed bed envelope in `audioDuck.ts` all assume
 * scene i occupies a known, contiguous block of frames. If the clips inside a
 * scene summed to one frame more or less, every scene after it would sit at the
 * wrong offset, the music duck would drift out from under the voice, and the
 * error would compound through the episode while looking perfectly fine in any
 * still frame.
 *
 * So the split is largest-remainder, which is exact by construction, rather
 * than rounding each share independently and hoping.
 *
 * PURE. No Remotion, no filesystem, no clock. The manifest calls it at module
 * scope and throws on a violation; vitest tests it here. Same arrangement as
 * `audioDuck.ts`, and for the same reason: a mixing curve or a timeline that
 * exists in two implementations will drift, and the drift is only visible in a
 * finished render.
 */

/** The generator's hard ceiling. Veo returns 5s or 10s, nothing longer. */
export const MAX_SHOT_SECONDS = 10;

/**
 * Below this a cut reads as a flash rather than a shot.
 *
 * Not a technical limit — 20 frames renders fine. It is an editorial one: this
 * show holds its images, and a sub-second shot in the middle of a languid
 * seven-minute fairy tale reads as a mistake. If the allocator produces one,
 * the scene has too many shots in it for the narration it carries.
 */
export const MIN_SHOT_SECONDS = 1.5;

/**
 * Split `total` frames between shots in proportion to `weights`.
 *
 * Largest remainder: floor every ideal share, then hand the leftover frames out
 * one each to the shots with the largest discarded fraction. The result sums to
 * `total` exactly, for any weights and any total.
 *
 * Ties in the fractional part go to the earlier shot. Arbitrary, but it has to
 * be SOMETHING fixed — a tie broken by object iteration order would make the
 * allocation depend on how the array was built, and two runs of the same
 * manifest could then produce different cuts.
 */
export function allocateFrames(weights: number[], total: number): number[] {
  if (weights.length === 0) throw new Error("allocateFrames: no shots to allocate to");
  if (!Number.isInteger(total)) throw new Error(`allocateFrames: total ${total} is not an integer`);
  if (total < 0) throw new Error(`allocateFrames: total ${total} is negative`);
  for (const [i, w] of weights.entries()) {
    if (!Number.isFinite(w) || w <= 0) {
      throw new Error(`allocateFrames: weight ${i} is ${w}; weights must be finite and positive`);
    }
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  const ideal = weights.map((w) => (total * w) / sum);
  const frames = ideal.map(Math.floor);

  // Hand out the frames that flooring discarded, largest fraction first.
  let left = total - frames.reduce((a, b) => a + b, 0);
  const order = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) frames[order[k % order.length].i] += 1;

  return frames;
}

/** One shot that broke a limit, described well enough to act on. */
export type ShotViolation = {
  index: number;
  frames: number;
  seconds: number;
  reason: "too-long" | "too-short";
};

/**
 * Check an allocation against the generator's ceiling and the editorial floor.
 *
 * Returns the violations rather than throwing, so the caller can report every
 * bad shot in one go. Fixing them one render at a time — each render being a
 * paid generation — is the slow way to find out a scene needs two more clips.
 */
export function checkShotFrames(
  frames: number[],
  fps: number,
  limits: { maxSeconds?: number; minSeconds?: number } = {},
): ShotViolation[] {
  const max = (limits.maxSeconds ?? MAX_SHOT_SECONDS) * fps;
  const min = (limits.minSeconds ?? MIN_SHOT_SECONDS) * fps;
  const out: ShotViolation[] = [];
  for (const [index, f] of frames.entries()) {
    // Strictly greater: a shot landing on exactly 10.000s is generatable.
    if (f > max) out.push({ index, frames: f, seconds: f / fps, reason: "too-long" });
    else if (f < min) out.push({ index, frames: f, seconds: f / fps, reason: "too-short" });
  }
  return out;
}

/**
 * How many shots a scene of this length needs, at minimum.
 *
 * Used to size the shot list BEFORE the narration exists — from the word-count
 * estimate, with headroom, so the list can be written and reviewed while the
 * audio is still being generated. The real check is `checkShotFrames` against
 * the measured durations; this is only how you arrive at a first draft.
 */
export function minimumShots(seconds: number, maxSeconds = MAX_SHOT_SECONDS): number {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`minimumShots: ${seconds} is not a positive duration`);
  }
  return Math.ceil(seconds / maxSeconds);
}
