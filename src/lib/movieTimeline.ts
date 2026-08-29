/**
 * A Story Movie is as long as it was asked to be. Narration is one track on
 * that timeline, not the timeline itself.
 *
 * OWNER DIRECTIVE 2026-08-29. A 300-second request with 85.8 seconds of
 * narration was refused as "28.6% of the requested duration". That number
 * was never measuring what it claimed to. The finished film's length was the
 * SUM OF ITS SHOTS' MEASURED NARRATION — storyFrames() multiplies
 * shot.seconds by fps, and shot.seconds was the wav length — so a film could
 * not be longer than the words in it, and the gate that noticed was
 * reporting a consequence of the design as if it were a fault in the story.
 *
 * WHAT WAS ALREADY THERE. planStory(requestedSeconds) has always built a
 * real timeline and asserted it sums to the request exactly:
 *
 *     const total = shots.reduce((a, s) => a + s.seconds, 0);
 *     if (total !== seconds) throw new Error(...)
 *
 * The worker called it, took the shot COUNT, and discarded the per-shot
 * seconds. So the movie timeline was computed and then thrown away every
 * run. This module puts it back.
 *
 * THE RULE, and it is one line:
 *
 *     screenSeconds[i] = max(plannedSeconds[i], narrationSeconds[i])
 *
 * The planned second is the shot's place in the requested duration. The
 * narration second is the floor, because a shot that ends mid-sentence is a
 * cut, not a pace. Speech is never stretched, never repeated, never sped up
 * — it plays at its own length inside a shot that may outlast it, and the
 * remaining screen time is carried by the visual machinery that already
 * exists for exactly this: Ken Burns, the depth parallax planes, the
 * particle VFX, and over a clip the smoothstepped push.
 *
 * For 300 seconds that is 42 shots of 7-8s each, holding ~2s of narration
 * apiece. Seven-second shots are ordinary cinema. Nothing is padded and
 * nothing is frozen.
 *
 * CLASSIC IS UNTOUCHED. Only the movie grade gets a planned timeline;
 * an ordinary Story keeps narration-as-clock and its existing duration
 * policy, because nothing about it asked to change.
 */
import { MAX_STORY_SECONDS, MIN_STORY_SECONDS, planStory } from "./storyPlan.ts";
import { MAX_SHOT_SECONDS } from "./shotAllocation.ts";

/**
 * How far past the request a film may run before it is a different film.
 *
 * A movie timeline sums to the request EXACTLY unless some shot's narration
 * overruns its planned slot — a long sentence in a short beat. That is
 * allowed, because cutting speech is worse than running over, but not
 * without limit: at some point the plan and the words are describing
 * different films and the honest answer is to say so before the money is
 * spent. 1.6 is the ceiling the old gate already used, kept so a film that
 * passed before cannot fail now.
 */
export const TIMELINE_MAX_RATIO = 1.6;

export type ShotTiming = {
  /** Measured narration for this shot. Never altered. */
  narrationSeconds: number;
  /** The shot's slot in the requested duration, from planStory. */
  plannedSeconds: number;
  /** What the shot occupies on screen: the greater of the two. */
  screenSeconds: number;
  /** Screen time beyond the narration, carried by the visual pass. */
  holdSeconds: number;
};

export type TimelineRefusal =
  | "narration-overruns-timeline"
  | "shot-count-mismatch"
  | "timeline-out-of-bounds"
  | "narration-invalid";

export type MovieTimeline =
  | {
      ok: true;
      shots: ShotTiming[];
      /** Sum of screenSeconds — the finished film's length. */
      timelineSeconds: number;
      /** Sum of narrationSeconds — one track on it. */
      narrationSeconds: number;
      /** Screen time carried by the visual pass rather than by speech. */
      holdSeconds: number;
      requestedSeconds: number;
    }
  | { ok: false; reason: TimelineRefusal; detail: string };

/** The requested seconds as the rest of the pipeline clamps them. */
export function clampRequested(requestedSeconds: number): number {
  return Math.round(Math.min(MAX_STORY_SECONDS, Math.max(MIN_STORY_SECONDS, requestedSeconds)));
}

/**
 * Build the movie's timeline from the request and the measured narration.
 *
 * Pure and total: every refusal is a value, nothing throws, and the caller
 * decides what a refusal costs. Feasibility is answered here — "can we
 * construct this movie?" — and a short narration is never on its own a
 * reason to say no.
 */
export function planMovieTimeline(args: {
  requestedSeconds: number;
  /** One measured wav length per shot, in shot order. */
  narrationSeconds: number[];
}): MovieTimeline {
  const requested = clampRequested(args.requestedSeconds);
  const narration = args.narrationSeconds;

  if (
    !Array.isArray(narration) ||
    narration.length === 0 ||
    narration.some((n) => !Number.isFinite(n) || n < 0)
  ) {
    return {
      ok: false,
      reason: "narration-invalid",
      detail: `expected a finite non-negative second per shot, got ${JSON.stringify(narration)}`,
    };
  }

  // The plan for THIS shot count, so the slots line up one-to-one with the
  // narrations that were actually measured. planStory decides the count from
  // the requested seconds; when the film has a different one (a row carrying
  // its own shot_count), its own count wins and the slots are re-derived.
  const planned = plannedSlots(requested, narration.length);
  if (planned.length !== narration.length) {
    return {
      ok: false,
      reason: "shot-count-mismatch",
      detail: `${planned.length} planned slots for ${narration.length} shots`,
    };
  }

  const shots: ShotTiming[] = narration.map((narrationSeconds, i) => {
    const plannedSeconds = planned[i];
    const screenSeconds = Math.max(plannedSeconds, narrationSeconds);
    return {
      narrationSeconds,
      plannedSeconds,
      screenSeconds,
      holdSeconds: screenSeconds - narrationSeconds,
    };
  });

  const timelineSeconds = shots.reduce((a, s) => a + s.screenSeconds, 0);
  const narrationTotal = shots.reduce((a, s) => a + s.narrationSeconds, 0);

  // The only way to overrun is narration longer than its slot. Enough of
  // that and the words describe a different film from the one requested.
  if (timelineSeconds > requested * TIMELINE_MAX_RATIO) {
    return {
      ok: false,
      reason: "narration-overruns-timeline",
      detail:
        `narration forces a ${timelineSeconds.toFixed(1)}s timeline against a ` +
        `${requested}s request (${Math.round((timelineSeconds / requested) * 100)}%, ` +
        `ceiling ${Math.round(TIMELINE_MAX_RATIO * 100)}%)`,
    };
  }

  // The film still has to be a Story. A timeline past the cost ceiling is
  // refused here, before any still is drawn, rather than at the bill.
  if (timelineSeconds > MAX_STORY_SECONDS) {
    return {
      ok: false,
      reason: "timeline-out-of-bounds",
      detail: `${timelineSeconds.toFixed(1)}s exceeds the ${MAX_STORY_SECONDS}s ceiling`,
    };
  }

  return {
    ok: true,
    shots,
    timelineSeconds,
    narrationSeconds: narrationTotal,
    holdSeconds: timelineSeconds - narrationTotal,
    requestedSeconds: requested,
  };
}

/**
 * The requested seconds spread over a given number of shots.
 *
 * planStory owns the arithmetic and asserts the sum, so it is used whenever
 * its own shot count matches. When a film carries a different count the same
 * even-split-with-remainder is applied directly, which is what planStory
 * does internally — repeated here rather than imported because planStory
 * couples the split to its own count, and a film with a row-supplied
 * shot_count still deserves a timeline that sums to the request.
 */
function plannedSlots(requested: number, shotCount: number): number[] {
  const natural = planStory(requested).shots;
  if (natural.length === shotCount) return natural.map((s) => s.seconds);

  const base = Math.floor(requested / shotCount);
  let remainder = requested - base * shotCount;
  const slots: number[] = [];
  for (let i = 0; i < shotCount; i++) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    slots.push(base + extra);
  }
  return slots;
}

/**
 * Would this movie's shots each stay inside the generator's ceiling?
 *
 * Reported rather than refused. A shot longer than MAX_SHOT_SECONDS still
 * renders — the visual pass holds it — but past the ceiling a single clip
 * can no longer cover the shot, so the tail leans on the push. Worth
 * knowing in a log; not worth losing a film over.
 */
export function shotsOverClipCeiling(timeline: MovieTimeline): number {
  if (!timeline.ok) return 0;
  return timeline.shots.filter((s) => s.screenSeconds > MAX_SHOT_SECONDS).length;
}
