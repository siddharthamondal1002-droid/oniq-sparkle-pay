/**
 * THE PRODUCTION DATABASE AND GITHUB BOUNDARY for the dispatch job.
 *
 * Everything that touches the outside world for this job lives here, so
 * `dispatchJob.ts` stays a pure description of the job and can be tested
 * without a network. The kernel and its mirror hold none of this at all.
 *
 * IT READS AND WRITES EXACTLY WHAT story-dispatch ALREADY DOES — the same
 * table, the same filter, the same PATCH, the same `repository_dispatch`. A
 * second way to move a job through its states is a second thing to keep
 * correct, and this repo's own history has the receipt: `story-sweep`'s rules
 * are mirrored from `storyLifecycle.ts` rather than re-derived, with a test
 * that fails when they drift.
 */
import type { DispatchEnvironment, QueuedJob } from "./dispatchJob.ts";

const SELECT = "id,requested_seconds,grade,created_at,dispatched_at";

type Row = {
  id: string;
  requested_seconds?: number | null;
  grade?: string | null;
  created_at?: string | null;
  dispatched_at?: string | null;
};

export function rowToJob(r: Row): QueuedJob {
  return {
    id: r.id,
    requestedSeconds: typeof r.requested_seconds === "number" ? r.requested_seconds : 0,
    grade: typeof r.grade === "string" ? r.grade : null,
    createdAtMs: r.created_at ? Date.parse(r.created_at) : 0,
    dispatchedAtMs: r.dispatched_at ? Date.parse(r.dispatched_at) : null,
  };
}

export type DispatchEnvConfig = {
  readonly supabaseUrl: string;
  readonly serviceKey: string;
  readonly repo: string;
  readonly githubToken: string;
  readonly eventType: string;
  /** Built per job by the caller, which owns the job-token secret. */
  readonly payloadFor: (jobId: string) => Promise<Record<string, unknown>>;
  /** How many rows one run may reason over. */
  readonly queueLimit: number;
};

/**
 * THE QUEUE IS READ WIDER THAN story-dispatch READS IT, AND ONLY THE READ.
 *
 * The dispatcher asks for `limit=1` because it needs one row. OQCA is choosing
 * BETWEEN rows, and a candidate set of one makes every station downstream a
 * formality — IMAGINE would score a single future and PLAN would pick it.
 * `queueLimit` is a bound rather than "all of them" for the reason story-sweep
 * states about itself: this runs on a wall clock, and an unbounded read is how
 * a scheduled job times out halfway through.
 *
 * NOTHING ABOUT THE WRITE PATH WIDENS. One dispatch per tick, exactly as
 * before.
 */
export function makeDispatchEnvironment(cfg: DispatchEnvConfig): DispatchEnvironment {
  const headers = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` };
  const rest = (path: string) => `${cfg.supabaseUrl}/rest/v1/${path}`;

  return {
    nowMs: () => Date.now(),

    readQueue: async () => {
      const res = await fetch(
        rest(
          `story_jobs?status=eq.queued&order=created_at.asc&limit=${cfg.queueLimit}&select=${SELECT}`,
        ),
        { headers },
      );
      if (!res.ok) throw new Error(`queue read failed: ${res.status}`);
      const rows = (await res.json()) as Row[];
      return Array.isArray(rows) ? rows.map(rowToJob) : [];
    },

    readJob: async (jobId) => {
      // status=eq.queued ON THE READ-BACK, deliberately. A job a runner has
      // claimed is no longer queued, and "not there" is exactly the answer the
      // verifier reads as `verified`. Dropping the filter would return the
      // claimed row and turn a success into "still queued".
      const res = await fetch(
        rest(`story_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.queued&select=${SELECT}`),
        { headers },
      );
      if (!res.ok) throw new Error(`job read failed: ${res.status}`);
      const rows = (await res.json()) as Row[];
      return Array.isArray(rows) && rows.length > 0 ? rowToJob(rows[0]) : null;
    },

    stampDispatched: async (jobId) => {
      const res = await fetch(rest(`story_jobs?id=eq.${encodeURIComponent(jobId)}`), {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ dispatched_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`dispatch stamp failed: ${res.status}`);
    },

    sendDispatch: async (jobId) => {
      const res = await fetch(`https://api.github.com/repos/${cfg.repo}/dispatches`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          event_type: cfg.eventType,
          client_payload: await cfg.payloadFor(jobId),
        }),
      });
      // GitHub answers 204 with no body on success — the same check
      // story-dispatch makes, for the same reason.
      if (res.status === 204) return null;
      const detail = await res.text().catch(() => "");
      return `github dispatch failed: ${res.status} ${detail.slice(0, 160)}`;
    },
  };
}
