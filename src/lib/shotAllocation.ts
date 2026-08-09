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
 * Move each cut onto the nearest pause in the narration.
 *
 * WHY. `allocateFrames` divides a scene by weight, and weight knows nothing
 * about where the sentences are. Measured against episode 3's narration, only
 * 11 of 44 interior cuts landed within 150ms of a pause and 20 of 44 were more
 * than 0.6s from any pause — the worst being the episode's opening cut, 2.18s
 * adrift. A cut in the middle of a clause makes the new image arrive detached
 * from the words that set it up, and that reads as the picture lagging the
 * voice. It is not sync drift; the frames are exact. It is an edit that ignores
 * the script.
 *
 * WHAT IT PRESERVES. The sum. `snapCutsToPauses` only ever moves the boundaries
 * BETWEEN shots, never the first shot's start or the last shot's end, so the
 * result still sums to exactly the same total. Everything downstream that
 * assumes a scene is a contiguous known block keeps working untouched.
 *
 * WHAT CONSTRAINS IT.
 *   - `maxShift`  — how far a cut may travel. A cut dragged three seconds to
 *                   find a pause is no longer the shot the shot list describes.
 *   - `minFrames` — the editorial floor, per shot.
 *   - `maxFrames` — per shot, and this one is physical rather than editorial: a
 *                   shot cannot be longer than the source clip has frames. The
 *                   conformed mp4s are trimmed to exactly their allocation, so
 *                   lengthening one requires the RAW generation it came from.
 *                   Pass the raw frame counts to allow growth; pass the current
 *                   allocation to forbid it.
 *
 * Cuts are placed left to right, each against the pauses no earlier cut has
 * taken. Greedy rather than globally optimal: a cut that finds no legal pause
 * simply stays where the weights put it, which is the current behaviour and
 * therefore never worse than doing nothing. An exact solve would buy a few tens
 * of milliseconds on a handful of cuts and would be much harder to read.
 *
 * `pauses` and every frame count are in FRAMES, measured from the scene's own
 * start — the same origin the narration mp3 uses.
 */
export function snapCutsToPauses(
  frames: number[],
  pauses: number[],
  limits: { maxShift: number; minFrames: number; maxFrames?: number[] },
): number[] {
  if (frames.length === 0) throw new Error("snapCutsToPauses: no shots");
  if (frames.some((f) => !Number.isInteger(f))) {
    throw new Error("snapCutsToPauses: frame counts must be integers");
  }
  const { maxShift, minFrames } = limits;
  if (!Number.isFinite(maxShift) || maxShift < 0) {
    throw new Error(`snapCutsToPauses: maxShift ${maxShift} must be a non-negative number`);
  }
  // At least one frame, and not merely as hygiene: the guarantee that two cuts
  // can never land on the same pause comes entirely from each cut's lower bound
  // being `previous cut + minFrames`. At zero that separation disappears and
  // the whole ordering argument goes with it.
  if (!Number.isInteger(minFrames) || minFrames < 1) {
    throw new Error(`snapCutsToPauses: minFrames ${minFrames} must be a positive integer`);
  }
  const ceilings = limits.maxFrames ?? frames.map(() => Infinity);
  if (ceilings.length !== frames.length) {
    throw new Error(
      `snapCutsToPauses: maxFrames has ${ceilings.length} entries for ${frames.length} shots`,
    );
  }
  if (frames.length === 1) return [...frames];

  const total = frames.reduce((a, b) => a + b, 0);
  // Interior cut positions, as offsets from the scene start.
  const cuts: number[] = [];
  let acc = 0;
  for (let i = 0; i < frames.length - 1; i++) {
    acc += frames[i];
    cuts.push(acc);
  }

  const sorted = [...pauses].map(Math.round).sort((a, b) => a - b);

  for (let k = 0; k < cuts.length; k++) {
    // The ALREADY-MOVED previous cut. That is what stops two cuts converging on
    // one pause: this cut's floor is `prev + minFrames`, strictly greater than
    // prev, so a frame an earlier cut took is out of range by construction.
    // There is deliberately no "already used" set — it would be unreachable
    // code that reads like a real guard.
    const prev = k === 0 ? 0 : cuts[k - 1];
    // The next cut has not moved yet, so it still bounds this one. Later cuts
    // only ever get MORE room as this one moves left, and re-checking against
    // the original position keeps the pass order-independent to read.
    const next = k === cuts.length - 1 ? total : cuts[k + 1];

    // The shot before this cut runs prev..candidate; the shot after runs
    // candidate..next. Both have to stay legal at every candidate.
    const lo = Math.max(
      cuts[k] - maxShift,
      prev + minFrames,
      next - (ceilings[k + 1] ?? Infinity),
    );
    const hi = Math.min(
      cuts[k] + maxShift,
      next - minFrames,
      prev + (ceilings[k] ?? Infinity),
    );
    if (lo > hi) continue;

    let best = -1;
    let bestDist = Infinity;
    for (const p of sorted) {
      if (p < lo || p > hi) continue;
      const d = Math.abs(p - cuts[k]);
      // Ties to the earlier pause, for the same reason allocateFrames breaks
      // ties to the earlier shot: it has to be something fixed.
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best >= 0) cuts[k] = best;
  }

  // Back to per-shot lengths. Sums to `total` by construction: the boundaries
  // moved, the endpoints did not.
  const out: number[] = [];
  let at = 0;
  for (const c of cuts) {
    out.push(c - at);
    at = c;
  }
  out.push(total - at);
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
