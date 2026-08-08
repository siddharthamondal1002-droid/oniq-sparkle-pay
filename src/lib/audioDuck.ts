/**
 * Ducking a music bed under narration.
 *
 * Pure functions, no I/O and no Remotion import, so the behaviour that decides
 * whether an episode is listenable can be tested without rendering 8,000
 * frames. `remotion/scripts/build-bed-envelope.mjs` measures the narration and
 * calls these; the composition only reads the resulting array.
 *
 * WHY DUCK AT ALL. A bed at a fixed level is either loud enough to hear during
 * the gaps or quiet enough to sit under the voice, never both. Ducking gives
 * you both: the bed drops while the narrator speaks and comes back up between
 * sentences. It is the single thing that separates a scored documentary from
 * one with music accidentally left on.
 */

/**
 * Peak-hold smoothing, so a gap between syllables is not read as a gap.
 *
 * Speech measured per video frame is extremely bursty: on the real Episode 2
 * narration the MEDIAN frame sits at 0.024 of full scale while the 90th
 * percentile is 0.108, because half the frames land in the tiny silences
 * inside ordinary speech. Thresholding that raw makes the bed surge between
 * words — the exact pumping the release time is there to prevent.
 *
 * Taking a running maximum over a short window turns "is this frame loud" into
 * "is anyone speaking around now", which is the question the duck is actually
 * asking.
 */
export function peakHold(levels: number[], windowFrames: number): number[] {
  const half = Math.max(0, Math.floor(windowFrames / 2));
  const out = new Array<number>(levels.length);
  for (let i = 0; i < levels.length; i++) {
    let peak = 0;
    const from = Math.max(0, i - half);
    const to = Math.min(levels.length - 1, i + half);
    for (let j = from; j <= to; j++) if (levels[j] > peak) peak = levels[j];
    out[i] = peak;
  }
  return out;
}

/**
 * Scale an envelope so that its `q`th percentile becomes 1.
 *
 * The duck threshold has to mean the same thing regardless of how loudly a
 * given batch of narration was rendered. An absolute threshold does not: 0.06
 * of full scale sounds like a reasonable speech level and is in fact ABOVE the
 * median frame of real narration, so it ducked during only 30% of an episode
 * that is speaking almost throughout. Normalising first makes the threshold a
 * property of the mix rather than of the recording gain.
 *
 * A high percentile rather than the maximum, because one clipped frame would
 * otherwise scale the whole episode down.
 */
export function normaliseByPercentile(levels: number[], q = 0.95): number[] {
  const sorted = levels.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return levels.slice();
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  if (ref <= 0) return levels.slice();
  return levels.map((v) => Math.min(1, v / ref));
}

/** Where each scene begins on the episode timeline, in frames. */
export function sceneStartFrames(frames: number[], transitionFrames: number): number[] {
  const starts: number[] = [];
  let at = 0;
  for (let i = 0; i < frames.length; i++) {
    starts.push(at);
    // TransitionSeries overlaps neighbours, so the next scene starts before
    // this one ends. Getting this wrong slides the whole envelope out of sync
    // with the voice it is supposed to be following, and the further into the
    // episode you go the worse it sounds.
    at += frames[i] - transitionFrames;
  }
  return starts;
}

export type DuckOptions = {
  /** Bed gain while the narrator is speaking. */
  under: number;
  /** Bed gain when nothing is being said. */
  alone: number;
  /** Frames to fall from `alone` to `under`. Short: catch the first syllable. */
  attackFrames: number;
  /** Frames to climb back. Long: stops the bed pumping between words. */
  releaseFrames: number;
  /**
   * Narration level above which the bed is held down.
   *
   * Relative to a NORMALISED envelope (see `normaliseByPercentile`), not to
   * full scale.
   */
  threshold: number;
};

/** Peak-hold window, ~0.4s at 30fps: longer than a syllable, shorter than a pause. */
export const PEAK_HOLD_FRAMES = 12;

export const DEFAULT_DUCK: DuckOptions = {
  under: 0.14,
  alone: 0.55,
  // 0.2s down, 1.2s up at 30fps. Asymmetric on purpose — fast attack so the
  // bed is already out of the way by the time a sentence starts, slow release
  // so a comma does not sound like someone riding a fader.
  attackFrames: 6,
  releaseFrames: 36,
  // Of the normalised envelope. Low, because after peak-holding, anything
  // above a fraction of the working level is someone talking.
  threshold: 0.12,
};

/**
 * Turn a per-frame narration level into a per-frame bed gain.
 *
 * A one-pole slew in each direction — the same shape as a compressor's
 * sidechain, which is what this is. Deliberately NOT a hard switch at the
 * threshold: a step change in gain is audible as a click, and on a sustained
 * pad it is very audible.
 */
export function speechToGain(speech: number[], options: Partial<DuckOptions> = {}): number[] {
  const { under, alone, attackFrames, releaseFrames, threshold } = { ...DEFAULT_DUCK, ...options };
  const attack = 1 / Math.max(1, attackFrames);
  const release = 1 / Math.max(1, releaseFrames);

  const gain: number[] = new Array(speech.length);
  let current = alone;
  for (let i = 0; i < speech.length; i++) {
    const target = speech[i] >= threshold ? under : alone;
    // Move toward the target by a fixed fraction of the remaining distance.
    const rate = target < current ? attack : release;
    current += (target - current) * rate;
    gain[i] = current;
  }
  return gain;
}

/**
 * Fade the bed in at the top and out at the tail.
 *
 * Applied after ducking rather than folded into it: a fade is about the
 * episode's edges and the duck is about the voice, and combining them makes
 * both harder to reason about. Multiplying is safe because both are gains.
 */
export function applyEdgeFades(gain: number[], fadeInFrames: number, fadeOutFrames: number) {
  const out = gain.slice();
  const n = out.length;
  for (let i = 0; i < Math.min(fadeInFrames, n); i++) {
    out[i] *= i / fadeInFrames;
  }
  for (let i = 0; i < Math.min(fadeOutFrames, n); i++) {
    out[n - 1 - i] *= i / fadeOutFrames;
  }
  return out;
}

/**
 * Lay each scene's narration level onto the episode timeline.
 *
 * Scenes OVERLAP during a cross-dissolve, and the two narrations overlap with
 * them. Taking the max rather than summing or overwriting is what stops the
 * overlap reading as a gap and letting the bed swell straight into the next
 * line.
 */
export function layOnTimeline(
  perScene: number[][],
  starts: number[],
  totalFrames: number,
): number[] {
  const timeline = new Array<number>(totalFrames).fill(0);
  for (let s = 0; s < perScene.length; s++) {
    const start = starts[s];
    const level = perScene[s];
    for (let i = 0; i < level.length; i++) {
      const at = start + i;
      if (at >= 0 && at < totalFrames) timeline[at] = Math.max(timeline[at], level[i]);
    }
  }
  return timeline;
}
