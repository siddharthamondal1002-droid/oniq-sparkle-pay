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

import type { IrShot, StoryIr } from "./storyIr.ts";

export type JobKind = "image" | "video" | "audio" | "assembly";

/**
 * Which resource a job actually consumes (owner directive 2026-08-27,
 * capacity option A).
 *
 * Measured from the worker's own source, not assumed: audio_mux speaks
 * with piper ON THE CPU and muxes with PyAV, and video_concat is a
 * stream copy with no re-encode. Neither touches CUDA — yet both spent a
 * slot in the GPU endpoint's daily cap, which was 35% of a film's jobs
 * consuming the GPU allowance for work no GPU performs.
 *
 * The fix is CLASSIFICATION, not deletion: CPU work is still counted,
 * still queued and still bounded, but against its own resource. The GPU
 * cap keeps its exact meaning — how much GENERATION the endpoint may do
 * in a day — and Video Clips keeps the protection that number is for.
 */
export type ResourceClass = "gpu" | "cpu";

export const JOB_RESOURCE: Record<JobKind, ResourceClass> = {
  /** ONIQ's image engine: LTX text-to-video on CUDA. */
  image: "gpu",
  /** LTX image-to-video on CUDA. */
  video: "gpu",
  /** piper + PyAV mux. No CUDA in the path. */
  audio: "cpu",
  /** Stream-copy concat. No re-encode, no CUDA in the path. */
  assembly: "cpu",
};

export function resourceOf(job: { kind: JobKind }): ResourceClass {
  return JOB_RESOURCE[job.kind];
}

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
/**
 * Does this shot need its OWN conditioning still, or can it animate the
 * one its scene already has? (Owner directive 2026-08-27, capacity B.)
 *
 * Sharing is the default because it is both cheaper AND better: the
 * still exists to anchor identity, so anchoring a scene's shots to one
 * frame anchors them to each other. But a shared frame is only valid
 * while it still depicts the shot — the owner's own list — so a new
 * still is required when the visual STATE changes:
 *
 *   - the location changes (a different place is a different frame)
 *   - the cast in frame changes (a frame cannot condition a person who
 *     is not in it)
 *   - the story marks a continuity break
 *
 * When in doubt this returns TRUE: an unnecessary still costs one job,
 * while a wrongly shared one costs a whole shot that shows the wrong
 * place or the wrong person.
 */
export function needsOwnStill(shot: IrShot, anchor: IrShot | null): boolean {
  if (!anchor) return true;
  if (shot.locationId !== anchor.locationId) return true;
  const cast = [...(shot.characters ?? [])].sort().join(",");
  const anchorCast = [...(anchor.characters ?? [])].sort().join(",");
  return cast !== anchorCast;
}

export function buildGraph(
  ir: StoryIr,
  opts: {
    filmId: string;
    grade: "classic" | "movie";
    /**
     * One conditioning still per SCENE where the shots allow it. Off
     * keeps the previous shape, so the change is reversible without a
     * rebuild of anything downstream.
     */
    stillPerScene?: boolean;
  },
): FilmGraph {
  const jobs: GraphJob[] = [];
  const shotOrder: string[] = [];
  const key = (kind: JobKind, shotId?: string) => `${opts.filmId}|${kind}|${shotId ?? "film"}`;

  for (const scene of ir.scenes) {
    /** The shot whose still the rest of this scene may animate. */
    let anchor: IrShot | null = null;
    let anchorImage: string | null = null;
    for (const shot of scene.shots) {
      shotOrder.push(shot.id);
      const ownStill: boolean =
        !opts.stillPerScene || anchorImage === null || needsOwnStill(shot, anchor);
      const image: string = ownStill
        ? jobId(opts.filmId, "image", shot.id)
        : (anchorImage as string);
      if (ownStill) {
        jobs.push({
          id: image,
          kind: "image",
          shotId: shot.id,
          needs: [],
          state: "pending",
          attempts: 0,
          idempotencyKey: key("image", shot.id),
        });
        anchor = shot;
        anchorImage = image;
      }
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
export function readyJobs(
  graph: FilmGraph,
  limit: number | { gpu: number; cpu: number } = Infinity,
): GraphJob[] {
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
  if (typeof limit === "number") {
    return ready.slice(0, limit === Infinity ? undefined : Math.max(0, limit));
  }
  // Per-resource allowances: CPU work never consumes a GPU slot, and a
  // spent GPU day does not stop a film's narration from being spoken.
  const left = { gpu: Math.max(0, limit.gpu), cpu: Math.max(0, limit.cpu) };
  const out: GraphJob[] = [];
  for (const job of ready) {
    const resource = resourceOf(job);
    if (left[resource] <= 0) continue;
    left[resource] -= 1;
    out.push(job);
  }
  return out;
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
