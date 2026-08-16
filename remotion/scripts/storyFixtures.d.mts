/**
 * Types for the dry-run fixture seam.
 *
 * The implementation is `.mjs` because the story worker is plain Node running
 * on a GitHub runner with no build step — the one place in this repo where the
 * dependency tree is most likely to break, so it has none. These declarations
 * exist so `src/lib/__tests__/storyDryRun.test.ts` can import it under `tsc`.
 *
 * They describe the CONTRACT the worker relies on, so keep them honest: the
 * `data` keys below are the ones `story-worker.mjs` actually reads, and a
 * fixture answering with a different key is the defect that made the clip
 * happy path dead code once already.
 */

/** How one scripted call answers. Selection is by call ordinal, not content. */
export interface FixtureSpec {
  /** Throw instead of answering, composed as `${fn}: ${status} ${json}`. */
  fail?: { status?: number; error?: string };
  /** story-clip only: fail on a poll rather than at start. */
  failOnPoll?: { status?: number; error?: string };
  /** story-clip only: answer `{done:false}` this many times first. */
  polls?: number;
  /** story-voice only: honoured verbatim, including a mime with no `rate=`. */
  mime?: string;
  rate?: number;
  seconds?: number;
}

export interface FixtureJob {
  id: string;
  prompt: string;
  requestedSeconds: number;
  shotCount: number;
  castJson: unknown | null;
  noWatermark: boolean;
  grade: "movie" | "classic";
  verbatim: boolean;
}

export interface FixturePlan {
  title?: string;
  setting?: string;
  cast?: { name?: string }[];
  shots: { still?: string; narration?: string; dialogue?: unknown }[];
}

export interface Scenario {
  name: string;
  job: FixtureJob;
  plan: FixturePlan;
  stillPx: { w: number; h: number };
  still: FixtureSpec[];
  voice: FixtureSpec[];
  clip: FixtureSpec[];
}

/**
 * What one answered call looks like.
 *
 * These are the keys `story-worker.mjs` READS, which is the whole point of
 * writing them down: an earlier clip fixture answered with `video` instead of
 * `data`, so the happy path was dead code and the step-down it advertised was
 * a swallowed TypeError. Every field is optional because the four functions
 * answer with different subsets, and `configured: false` is the worker's
 * "no API key" signal.
 */
export interface FixtureAnswer {
  configured?: boolean;
  /** story-plot */
  plan?: FixturePlan;
  /** story-still, story-voice, story-clip (poll) — base64 payload. */
  data?: string;
  mime?: string;
  /** story-voice */
  voice?: string;
  /** story-clip */
  operation?: string;
  done?: boolean;
}

export interface FixtureEdge {
  /** Answers a generation call, or `null` when it has no opinion. */
  (fn: string, body?: Record<string, unknown>): Promise<FixtureAnswer | null>;
  job(): FixtureJob;
  scenarioName(): string;
  summary(): {
    scenario: string;
    counts: Record<string, number>;
    events: { fn: string; n: number; spec: FixtureSpec }[];
  };
}

/**
 * Hard stop when anything in `env` could authenticate against production.
 * A dry run HAS no credentials — not "ignores the ones it has".
 */
export function assertNoProductionCredentials(env: Record<string, string | undefined>): void;

export function loadScenario(dir: string): Scenario;

export function createFixtureEdge(dir: string, opts: { ffmpeg?: string | null }): FixtureEdge;
