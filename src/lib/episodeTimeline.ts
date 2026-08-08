// Pure timeline planning for the admin episode assembler.
//
// No I/O, no secrets: the same module runs in the browser (to show the
// operator what will happen) and on the server (which re-runs every check and
// is the only place the result is trusted).
//
// Audio length is NOT known here. Where a scene has narration the renderer
// overrides the planned duration with the real audio length and records the
// difference — see remotion/scripts/render-episode.mjs.

export const MOTIONS = ['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight'] as const;
export type Motion = (typeof MOTIONS)[number];

export const MIN_SCENE_SECONDS = 5;
export const MAX_SCENE_SECONDS = 60;
export const MAX_TOTAL_SECONDS = 20 * 60; // hard refusal above this
export const MAX_SCENES = 200;

export const DEFAULT_TRANSITION_SECONDS = 0.5;
export const MAX_TRANSITION_SECONDS = 2;

/** Ken Burns travel: ~6% over the whole scene. Subtle on purpose. */
export const KEN_BURNS_SCALE = 0.06;
/** Pan travel as a fraction of the frame, over the whole scene. */
export const KEN_BURNS_PAN = 0.06;

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_FPS = 30;

export type SceneInput = {
  stillPath: string;
  durationSeconds: number;
  motion: Motion;
  audioPath?: string | null;
  transitionSeconds?: number | null;
};

export type PlannedScene = {
  stillPath: string;
  durationSeconds: number;
  motion: Motion;
  audioPath: string | null;
  /** Cross-dissolve INTO this scene. Always 0 for the first scene. */
  transitionSeconds: number;
};

export type Plan = {
  scenes: PlannedScene[];
  totalSeconds: number;
  /** Human-readable notes, e.g. a zoom direction that was flipped. */
  adjustments: string[];
};

function nameError(raw: string, kind: 'still' | 'audio'): string | null {
  const name = String(raw ?? '');
  if (!name) return `${kind} filename required`;
  if (name.length > 128) return `${kind} filename too long`;
  if (name.includes('/') || name.includes('\\')) return `${kind} filename may not contain a path separator`;
  if (name.startsWith('.') || name.includes('..')) return `invalid ${kind} filename`;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return `${kind} filename may only use letters, numbers, . _ -`;
  const ok = kind === 'still' ? /\.(png|jpe?g|webp)$/i : /\.(mp3|m4a|aac|wav|ogg)$/i;
  if (!ok.test(name)) return `unsupported ${kind} file type`;
  return null;
}

/** Opposite of a zoom, or null when the motion is not a zoom. */
function flipZoom(m: Motion): Motion | null {
  if (m === 'zoomIn') return 'zoomOut';
  if (m === 'zoomOut') return 'zoomIn';
  return null;
}

/**
 * Validate and normalise a submitted timeline.
 * Returns a string on refusal — never a partially valid plan.
 */
export function planTimeline(raw: unknown): Plan | string {
  if (!Array.isArray(raw)) return 'timeline must be a list of scenes';
  if (raw.length === 0) return 'timeline is empty';
  if (raw.length > MAX_SCENES) return `too many scenes (max ${MAX_SCENES})`;

  const adjustments: string[] = [];
  const scenes: PlannedScene[] = [];
  let lastZoom: Motion | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const s = raw[i] as SceneInput;
    const label = `scene ${i + 1}`;

    const badStill = nameError(String(s?.stillPath ?? ''), 'still');
    if (badStill) return `${label}: ${badStill}`;

    const audioPath = s?.audioPath ? String(s.audioPath) : null;
    if (audioPath) {
      const badAudio = nameError(audioPath, 'audio');
      if (badAudio) return `${label}: ${badAudio}`;
    }

    const duration = Number(s?.durationSeconds);
    if (!Number.isFinite(duration)) return `${label}: duration required`;
    if (duration < MIN_SCENE_SECONDS || duration > MAX_SCENE_SECONDS) {
      return `${label}: duration must be ${MIN_SCENE_SECONDS}-${MAX_SCENE_SECONDS}s`;
    }

    let motion = s?.motion as Motion;
    if (!MOTIONS.includes(motion)) return `${label}: unsupported motion`;

    // Requirement: consecutive zooms alternate, so the episode does not pulse.
    const flipped = flipZoom(motion);
    if (flipped && lastZoom === motion) {
      adjustments.push(`${label}: ${motion} flipped to ${flipped} to alternate direction`);
      motion = flipped;
    }
    if (flipZoom(motion)) lastZoom = motion;

    const t =
      s?.transitionSeconds === null || s?.transitionSeconds === undefined
        ? DEFAULT_TRANSITION_SECONDS
        : Number(s.transitionSeconds);
    if (!Number.isFinite(t) || t < 0 || t > MAX_TRANSITION_SECONDS) {
      return `${label}: transition must be 0-${MAX_TRANSITION_SECONDS}s`;
    }
    // A dissolve cannot be longer than either side of it.
    const transitionSeconds =
      i === 0 ? 0 : Math.min(t, duration / 2, (scenes[i - 1]?.durationSeconds ?? duration) / 2);

    scenes.push({
      stillPath: String(s.stillPath),
      durationSeconds: Math.round(duration * 1000) / 1000,
      motion,
      audioPath,
      transitionSeconds: Math.round(transitionSeconds * 1000) / 1000,
    });
  }

  const totalSeconds = timelineDuration(scenes);
  if (totalSeconds > MAX_TOTAL_SECONDS) {
    return `timeline is ${Math.round(totalSeconds / 60)} minutes — the cap is ${
      MAX_TOTAL_SECONDS / 60
    } minutes`;
  }

  return { scenes, totalSeconds: Math.round(totalSeconds * 1000) / 1000, adjustments };
}

/** Cross-dissolves overlap, so each one shortens the finished episode. */
export function timelineDuration(scenes: PlannedScene[]): number {
  return scenes.reduce((acc, s) => acc + s.durationSeconds - s.transitionSeconds, 0);
}
