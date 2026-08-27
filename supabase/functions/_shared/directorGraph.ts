/**
 * The ONIQ Director's production graph — the source of truth for a film.
 *
 * Owner directive 2026-08-27 (full in-house filmmaking loop). The Director
 * PLANS and COORDINATES; it never generates. Every decision it makes lives
 * here as a pure function over the graph, so the whole loop — dispatch
 * order, dependencies, resumability, idempotency, repair limits, capacity
 * — is provable offline, and the transports stay dumb.
 *
 *   FILM -> SCENE -> SHOT -> { IMAGE, VIDEO, AUDIO } -> ASSEMBLY
 *
 * The graph is derived from a validated StoryIr and then PERSISTED: it is
 * what a resumed film reads, so a restart continues at the first unfinished
 * job rather than paying for the first three shots again.
 */

import type { StoryIr } from "./storyIr.ts";

export type JobKind = "image" | "video" | "audio" | "assembly";

export type JobState =
  | "pending"
  | "running"
  | "done"
  /** Reviewed and rejected; may be repaired while attempts remain. */
  | "repair"
  /** Out of attempts, or refused outright. The film stops safely. */
  | "failed";

export type GraphJob = {
  id: string;
  kind: JobKind;
  shotId: string | null;
  /** Jobs that must be `done` before this one may be dispatched. */
  needs: string[];
  state: JobState;
  attempts: number;
  /** Stable across retries: the same logical job never pays twice. */
  idempotencyKey: string;
  /** Set once the job produced something. */
  outputRef?: string;
  measuredMs?: number;
  lastFailure?: string;
};

export type FilmGraph = {
  filmId: string;
  grade: "classic" | "movie";
  targetSeconds: number;
  shotOrder: string[];
  jobs: GraphJob[];
};

/** A shot gets this many generation attempts in total, review included. */
export const MAX_SHOT_ATTEMPTS = 2;

export function jobId(filmId: string, kind: JobKind, shotId?: string): string {
  return shotId ? `${filmId}:${shotId}:${kind}` : `${filmId}:${kind}`;
}

/**
 * Build the production graph from a validated story.
 *
 * MOVIE grade wires image -> video -> audio per shot, because genuine
 * generated motion is what the grade means. CLASSIC keeps its existing
 * lightweight path and gets no video job at all — the Director must never
 * silently downgrade a movie, and must never silently upgrade a classic
 * into GPU spend nobody asked for.
 */
export function buildGraph(
  ir: StoryIr,
  opts: { filmId: string; grade: "classic" | "movie" },
): FilmGraph {
  const jobs: GraphJob[] = [];
  const shotOrder: string[] = [];
  const key = (kind: JobKind, shotId?: string) => `${opts.filmId}|${kind}|${shotId ?? "film"}`;

  for (const scene of ir.scenes) {
    for (const shot of scene.shots) {
      shotOrder.push(shot.id);
      const image = jobId(opts.filmId, "image", shot.id);
      jobs.push({
        id: image,
        kind: "image",
        shotId: shot.id,
        needs: [],
        state: "pending",
        attempts: 0,
        idempotencyKey: key("image", shot.id),
      });
      let last = image;
      if (opts.grade === "movie") {
        const video = jobId(opts.filmId, "video", shot.id);
        jobs.push({
          id: video,
          kind: "video",
          shotId: shot.id,
          // The still is the frame the motion animates: no image, no video.
          needs: [image],
          state: "pending",
          attempts: 0,
          idempotencyKey: key("video", shot.id),
        });
        last = video;
      }
      if (shot.narration?.trim() || shot.dialogue?.line?.trim()) {
        jobs.push({
          id: jobId(opts.filmId, "audio", shot.id),
          kind: "audio",
          shotId: shot.id,
          needs: [last],
          state: "pending",
          attempts: 0,
          idempotencyKey: key("audio", shot.id),
        });
      }
    }
  }

  jobs.push({
    id: jobId(opts.filmId, "assembly"),
    kind: "assembly",
    shotId: null,
    // Assembly waits for every shot: a film missing a shot is not a film.
    needs: jobs.filter((j) => j.kind !== "image" || opts.grade === "classic").map((j) => j.id),
    state: "pending",
    attempts: 0,
    idempotencyKey: key("assembly"),
  });

  return {
    filmId: opts.filmId,
    grade: opts.grade,
    targetSeconds: ir.targetDurationSeconds,
    shotOrder,
    jobs,
  };
}

const byId = (graph: FilmGraph) => new Map(graph.jobs.map((j) => [j.id, j]));

/**
 * What may be dispatched right now, in shot order.
 *
 * A job is ready when it is pending or awaiting repair AND every job it
 * needs is done. `limit` is the caller's capacity, never a suggestion:
 * the Director queues within the cap rather than around it.
 */
export function readyJobs(graph: FilmGraph, limit = Infinity): GraphJob[] {
  const jobs = byId(graph);
  const ready = graph.jobs.filter(
    (j) =>
      (j.state === "pending" || j.state === "repair") &&
      j.needs.every((n) => jobs.get(n)?.state === "done"),
  );
  const shotRank = new Map(graph.shotOrder.map((s, i) => [s, i]));
  ready.sort(
    (a, b) =>
      (shotRank.get(a.shotId ?? "") ?? Infinity) - (shotRank.get(b.shotId ?? "") ?? Infinity),
  );
  return ready.slice(0, limit === Infinity ? undefined : Math.max(0, limit));
}

/** A film is finished when its assembly is done. */
export function filmComplete(graph: FilmGraph): boolean {
  return graph.jobs.some((j) => j.kind === "assembly" && j.state === "done");
}

/**
 * A film stops safely when any job has exhausted its attempts. It does NOT
 * keep spending on the remaining shots of a film that cannot be delivered.
 */
export function filmStopped(graph: FilmGraph): boolean {
  return graph.jobs.some((j) => j.state === "failed");
}

export type Progress = { done: number; total: number; failed: number; pending: number };

export function progress(graph: FilmGraph): Progress {
  const count = (s: JobState) => graph.jobs.filter((j) => j.state === s).length;
  return {
    done: count("done"),
    total: graph.jobs.length,
    failed: count("failed"),
    pending: count("pending") + count("repair") + count("running"),
  };
}

/**
 * Record a finished job. Completing an already-done job is a NO-OP, which
 * is what makes a duplicate callback, a worker retry and a double tap all
 * harmless: the second delivery of the same work changes nothing.
 */
export function completeJob(
  graph: FilmGraph,
  id: string,
  result: { outputRef: string; measuredMs?: number },
): FilmGraph {
  return mapJob(graph, id, (job) =>
    job.state === "done"
      ? job
      : { ...job, state: "done", outputRef: result.outputRef, measuredMs: result.measuredMs },
  );
}

/**
 * Record a rejected job. It goes back for repair while attempts remain and
 * fails for good when they do not — the bound is what stops a bad shot
 * consuming GPU capacity forever.
 */
export function rejectJob(graph: FilmGraph, id: string, failure: string): FilmGraph {
  return mapJob(graph, id, (job) => {
    const attempts = job.attempts + 1;
    return {
      ...job,
      attempts,
      lastFailure: failure,
      state: attempts >= MAX_SHOT_ATTEMPTS ? "failed" : "repair",
    };
  });
}

export function startJob(graph: FilmGraph, id: string): FilmGraph {
  return mapJob(graph, id, (job) => (job.state === "done" ? job : { ...job, state: "running" }));
}

function mapJob(graph: FilmGraph, id: string, fn: (j: GraphJob) => GraphJob): FilmGraph {
  return { ...graph, jobs: graph.jobs.map((j) => (j.id === id ? fn(j) : j)) };
}

/**
 * Shots that must be looked at again because a shot they follow changed.
 *
 * Only the NEXT shot is implicated, deliberately: it is the one whose
 * opening state the repaired shot hands over. Marking the whole tail would
 * regenerate a film to fix one take, which is the waste this exists to
 * prevent — and marking nothing would let a repaired shot cut into a shot
 * that no longer follows from it.
 */
export function continuityAffected(graph: FilmGraph, repairedShotId: string): string[] {
  const i = graph.shotOrder.indexOf(repairedShotId);
  if (i === -1 || i + 1 >= graph.shotOrder.length) return [];
  return [graph.shotOrder[i + 1]];
}

/**
 * Resume: take the persisted graph as it stands. Work already done stays
 * done; work that was mid-flight when the process died goes back to
 * pending, because a running job nobody is watching is not running.
 */
export function resumeGraph(graph: FilmGraph): FilmGraph {
  return {
    ...graph,
    jobs: graph.jobs.map((j) => (j.state === "running" ? { ...j, state: "pending" } : j)),
  };
}
