/**
 * §21 — THE FIRST REAL BENCHMARK: "Video jobs are failing."
 *
 * THE KERNEL IS TOLD NOTHING ELSE. Not the 401, not the dispatcher, not the
 * voice failure, not which table to look in. It gets five read-only tools over
 * REAL production evidence and has to find whatever is there.
 *
 * WHY THIS LIVES OUTSIDE `src/oqca/`. The readings name
 * `GITHUB_DISPATCH_TOKEN`, and `security.test.ts` bans credential NAMES across
 * the kernel tree — correctly, and the ban is not worth weakening for a
 * fixture. The kernel stays pure; the evidence about production lives here,
 * beside the provider adapter, for the same reason.
 *
 * THE EVIDENCE IS REAL AND THE TRANSPORT IS A SNAPSHOT, which is a distinction
 * worth stating rather than burying. Every row below was read from the
 * production database on 2026-09-12 with the query named in its locator. It is
 * pinned rather than queried live so the benchmark is REPRODUCIBLE — a
 * root-cause score that moves when the database moves cannot be compared
 * against a baseline or a later run.
 *
 * THE DISTRACTORS ARE THE POINT. `send-push` has the HIGHEST error count of
 * any surface (44) and has nothing to do with video. `chat-viewport` has 27.
 * `share-video` is video-NAMED and unrelated. The `story-still` 502s are
 * genuinely video and eleven days stale. A diagnostician that ranks by volume,
 * or greps for "video", gets the wrong answer — which is exactly what the
 * BASELINE arm does, deliberately.
 */

export type BenchRow = {
  readonly key: string;
  readonly value: string;
  readonly newest: string | null;
};

export type BenchTable = {
  readonly tool: string;
  readonly locator: string;
  readonly at: string;
  readonly rows: readonly BenchRow[];
};

const AT = "2026-09-12T05:15:00Z";

/** Job rows by status. The only place a FAILED job's timestamp appears. */
export const JOB_COUNTS: BenchTable = {
  tool: "db_job_counts",
  locator:
    "production: select status, count(*), max(created_at) from story_jobs / gpu_video_jobs group by status",
  at: AT,
  rows: [
    { key: "story_jobs.purged", value: "85", newest: "2026-09-05T14:23:42Z" },
    { key: "story_jobs.ready", value: "38", newest: "2026-09-09T14:58:14Z" },
    { key: "story_jobs.failed", value: "2", newest: "2026-09-11T14:32:29Z" },
    { key: "gpu_video_jobs.completed", value: "3", newest: "2026-08-27T09:45:10Z" },
    { key: "gpu_video_jobs.orphaned", value: "1", newest: "2026-08-28T03:59:06Z" },
  ],
};

/** Error surfaces. Two of the five have nothing to do with video. */
export const ERROR_SURFACES: BenchTable = {
  tool: "db_error_surfaces",
  locator:
    "production: select surface, count(*), max(created_at) from client_error_reports where created_at > now() - interval '14 days' group by surface",
  at: AT,
  rows: [
    { key: "send-push", value: "44", newest: "2026-09-10T16:32:16Z" },
    { key: "story-dispatch", value: "41", newest: "2026-09-11T09:15:00Z" },
    { key: "chat-viewport", value: "27", newest: "2026-09-10T16:32:09Z" },
    { key: "share-video", value: "4", newest: "2026-09-11T13:44:34Z" },
    { key: "call-connect-timeout", value: "1", newest: "2026-09-07T18:13:16Z" },
  ],
};

/** Job error texts. The voice failure is here and nowhere else. */
export const JOB_ERRORS: BenchTable = {
  tool: "db_job_errors",
  locator:
    "production: select error, count(*), max(created_at) from story_jobs where created_at > now() - interval '14 days' group by error",
  at: AT,
  rows: [
    { key: "(none)", value: "22", newest: "2026-09-09T14:58:14Z" },
    {
      key: "story-still: 502 Could not draw that frame: engine",
      value: "3",
      newest: "2026-09-01T11:34:06Z",
    },
    {
      key: "story-still: 502 Could not draw that frame: still",
      value: "2",
      newest: "2026-09-01T13:31:21Z",
    },
    {
      key: "you deleted this before it finished - your time has been returned",
      value: "2",
      newest: "2026-09-03T17:19:24Z",
    },
    {
      key: "in-house tts unavailable and cloud voice exhausted",
      value: "1",
      newest: "2026-09-11T14:32:29Z",
    },
    { key: "story-still: no frame after 25 min", value: "1", newest: "2026-09-01T17:53:17Z" },
  ],
};

/** The detail text behind a surface. Keyed, so asking is a deliberate act. */
export const ERROR_DETAIL: Readonly<Record<string, string>> = {
  "story-dispatch":
    'status 502 - {"error":"github dispatch failed: 401","usingToken":"GITHUB_DISPATCH_TOKEN","repo":"siddharthamondal1002-droid/oniq-sparkle-pay"}',
  "share-video":
    '{"platform":"web","native":false,"sharePlugin":false,"filesystemPlugin":false,"webShare":true,"stage":"web-thumbnail"}',
  "send-push": '{"reason":"accepted but sent 0","unaddressed":1}',
  "chat-viewport": '{"screenH":832,"docH":560,"kb":272,"vvH":288}',
  "call-connect-timeout": '{"waitedMs":30000}',
};

/**
 * GROUND TRUTH — used only by `score()`, AFTER a run. No tool returns it and
 * no instruction mentions it.
 *
 * TWO independent causes are live, which is what makes this a real test rather
 * than a keyword hunt: a diagnostician that stops at the first one is wrong,
 * and one that reports the loudest surface is wrong in a different way.
 */
export const GROUND_TRUTH = {
  causes: [
    {
      id: "dispatch_credential",
      /** Any of these, in a conclusion, counts as having found it. */
      markers: [/\b401\b/, /bad credential/i, /GITHUB_DISPATCH_TOKEN/, /github.{0,20}dispatch/i],
      summary: "story-dispatch cannot reach GitHub: 401 on GITHUB_DISPATCH_TOKEN",
    },
    {
      id: "voice_unavailable",
      markers: [/\btts\b/i, /voice/i],
      summary: "a film failed on the in-house voice being unavailable",
    },
  ],
  /** Naming any of these as A CAUSE is a false positive. */
  distractors: [
    { id: "send_push", markers: [/send-push/i, /push notification/i] },
    { id: "chat_viewport", markers: [/chat-viewport/i, /keyboard/i] },
    { id: "share_video", markers: [/share-video/i] },
    { id: "story_still", markers: [/story-still/i, /could not draw/i] },
  ],
} as const;

export type Score = {
  readonly causesFound: readonly string[];
  readonly causesMissed: readonly string[];
  readonly falsePositives: readonly string[];
  readonly toolCalls: number;
  readonly irrelevantToolCalls: number;
  readonly elapsedMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

/**
 * Score a finished run against ground truth.
 *
 * A CAUSE COUNTS ONLY IF THE CONCLUSION TEXT NAMES IT. Reading the row is not
 * finding it: the dispatcher's detail can be fetched and then ignored, and a
 * benchmark that credited the tool call rather than the conclusion would score
 * a system that looked everywhere and understood nothing.
 */
export function score(
  conclusionText: string,
  toolsCalled: readonly string[],
  opts: { elapsedMs: number; inputTokens: number; outputTokens: number },
): Score {
  const found: string[] = [];
  const missed: string[] = [];
  for (const c of GROUND_TRUTH.causes) {
    (c.markers.some((m) => m.test(conclusionText)) ? found : missed).push(c.id);
  }
  /**
   * NAMED, NOT BLAMED — and the field says so because it cannot tell the
   * difference. This is a keyword match over the whole conclusion, so a model
   * that writes "five story-still 502s establish frame-generation failures,
   * BUT NOT THEIR UNDERLYING CAUSE" scores identically to one that asserts
   * story-still as a root cause. The first is the more careful answer and was
   * penalised for it. Distinguishing an attribution from a refusal to attribute
   * is a judgement, not a regex; inventing a heuristic here would be a measure
   * calibrated against nothing. So the number is reported as what it measures.
   */
  const distractorsNamed = GROUND_TRUTH.distractors
    .filter((d) => d.markers.some((m) => m.test(conclusionText)))
    .map((d) => d.id);

  /**
   * An "irrelevant" call is one that asked for a distractor's DETAIL — a
   * deliberate act, unlike listing the surfaces, which is how anyone would
   * start and which returns the distractors whether they are wanted or not.
   *
   * THIS PATTERN WAS DEAD FOR EVERY RUN THAT EVER SCORED. It matched
   * `db.error_detail:` with a DOT, and the tools were renamed to underscores
   * when OpenAI rejected dots in tool names — so it reported 0 whatever was
   * called. The run that caught it had genuinely asked for a distractor's
   * detail (`db_error_detail:share-video`) and still scored 0. A metric that
   * cannot fire is not a metric, and this one read as a clean result.
   */
  const irrelevant = toolsCalled.filter((t) =>
    /^db_error_detail:(send-push|chat-viewport|share-video|call-connect-timeout)$/.test(t),
  ).length;

  return {
    causesFound: found,
    causesMissed: missed,
    falsePositives: distractorsNamed,
    toolCalls: toolsCalled.length,
    irrelevantToolCalls: irrelevant,
    elapsedMs: opts.elapsedMs,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
  };
}

/**
 * §22's BASELINE arm: "read the error surfaces, report the loudest".
 *
 * This is not a straw man — it is what a sensible dashboard does, and it is
 * what OQCA's own ranking does in spirit. It returns `send-push`, which is the
 * single most common error in the system and has nothing to do with video.
 * Recorded so the kernel's score has something honest to beat.
 */
export function baselineDiagnosis(): string {
  const top = [...ERROR_SURFACES.rows].sort((a, b) => Number(b.value) - Number(a.value))[0];
  return `the most frequent error surface in the last 14 days is ${top.key} with ${top.value} reports`;
}
