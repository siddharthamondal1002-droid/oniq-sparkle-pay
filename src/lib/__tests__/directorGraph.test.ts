// The ONIQ Director's production graph — planning, order, resumability.
//
// Owner directive 2026-08-27 (full in-house filmmaking loop). Every rule
// the Director must not get wrong is a rule about MONEY: don't regenerate
// finished shots, don't pay twice for one job, don't keep spending on a
// film that cannot be delivered, don't dispatch past the cap.
import { describe, expect, it } from "vitest";
import {
  JOB_RESOURCE,
  MAX_SHOT_ATTEMPTS,
  buildGraph,
  completeJob,
  continuityAffected,
  filmComplete,
  filmStopped,
  progress,
  readyJobs,
  rejectJob,
  needsOwnStill,
  resourceOf,
  resumeGraph,
  startJob,
} from "../../../supabase/functions/_shared/directorGraph.ts";
import type { StoryIr } from "../../../supabase/functions/_shared/storyIr.ts";

function ir(shotCount = 3, withSpeech = true): StoryIr {
  const shots = Array.from({ length: shotCount }, (_, i) => ({
    id: `sh${i + 1}`,
    visualDescription: "a lamp",
    motionDescription: "slow push in",
    cameraDescription: "push-in",
    characters: [],
    locationId: "l1",
    durationSeconds: 4,
    ...(withSpeech && i === 0 ? { narration: "It rang." } : {}),
  }));
  return {
    title: "T",
    logline: "L",
    genre: "Horror",
    tone: "dread",
    theme: "grief",
    targetDurationSeconds: shotCount * 4,
    characters: [],
    world: { locations: [], visualStyle: "cold" },
    acts: [],
    scenes: [{ id: "s1", purpose: "p", conflict: "c", locationId: "l1", characters: [], shots }],
    dnaSources: ["ONIQ-0001", "ONIQ-0002", "ONIQ-0003"],
  } as StoryIr;
}

const movie = () => buildGraph(ir(), { filmId: "f1", grade: "movie" });

describe("the graph is built from the story, and grade decides the shape", () => {
  it("movie grade wires image -> video -> audio, in that dependency order", () => {
    const g = movie();
    const video = g.jobs.find((j) => j.id === "f1:sh1:video")!;
    const audio = g.jobs.find((j) => j.id === "f1:sh1:audio")!;
    expect(video.needs).toEqual(["f1:sh1:image"]);
    expect(audio.needs).toEqual(["f1:sh1:video"]);
  });

  it("classic grade generates NO video job — a movie is never downgraded, a classic never upgraded", () => {
    const classic = buildGraph(ir(), { filmId: "f1", grade: "classic" });
    expect(classic.jobs.some((j) => j.kind === "video")).toBe(false);
    expect(movie().jobs.filter((j) => j.kind === "video")).toHaveLength(3);
  });

  it("only shots that speak get an audio job", () => {
    const g = movie();
    expect(g.jobs.filter((j) => j.kind === "audio")).toHaveLength(1);
  });

  it("assembly waits for every shot — a film missing a shot is not a film", () => {
    const g = movie();
    const assembly = g.jobs.find((j) => j.kind === "assembly")!;
    for (const shot of g.shotOrder) {
      expect(assembly.needs).toContain(`f1:${shot}:video`);
    }
  });
});

describe("dispatch respects dependencies and capacity", () => {
  it("nothing downstream is ready before its dependency is done", () => {
    const g = movie();
    const ready = readyJobs(g).map((j) => j.id);
    expect(ready).toEqual(["f1:sh1:image", "f1:sh2:image", "f1:sh3:image"]);
    expect(ready).not.toContain("f1:sh1:video");
  });

  it("the video becomes ready exactly when its still is done", () => {
    let g = movie();
    g = completeJob(g, "f1:sh1:image", { outputRef: "r" });
    expect(readyJobs(g).map((j) => j.id)).toContain("f1:sh1:video");
  });

  it("a capacity limit is a hard ceiling on what is dispatched", () => {
    // The Director queues WITHIN the cap; it never dispatches around it.
    expect(readyJobs(movie(), 2)).toHaveLength(2);
    expect(readyJobs(movie(), 0)).toHaveLength(0);
  });

  it("work is offered in shot order, so a film renders front to back", () => {
    const ready = readyJobs(movie());
    expect(ready[0].shotId).toBe("sh1");
    expect(ready.at(-1)!.shotId).toBe("sh3");
  });
});

describe("idempotency: one logical job is never paid for twice", () => {
  it("every job carries a stable key that a rebuild reproduces", () => {
    const keys = movie().jobs.map((j) => j.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(movie().jobs.map((j) => j.idempotencyKey)).toEqual(keys);
  });

  it("completing an already-done job changes nothing — duplicate callbacks are harmless", () => {
    let g = completeJob(movie(), "f1:sh1:image", { outputRef: "first" });
    g = completeJob(g, "f1:sh1:image", { outputRef: "second" });
    expect(g.jobs.find((j) => j.id === "f1:sh1:image")!.outputRef).toBe("first");
  });

  it("starting a done job does not un-finish it", () => {
    let g = completeJob(movie(), "f1:sh1:image", { outputRef: "r" });
    g = startJob(g, "f1:sh1:image");
    expect(g.jobs.find((j) => j.id === "f1:sh1:image")!.state).toBe("done");
  });
});

describe("resumability: a restart continues, it does not start over", () => {
  it("finished shots stay finished and are never re-offered", () => {
    let g = movie();
    g = completeJob(g, "f1:sh1:image", { outputRef: "a" });
    g = completeJob(g, "f1:sh2:image", { outputRef: "b" });
    g = startJob(g, "f1:sh3:image");

    const resumed = resumeGraph(g);
    const ready = readyJobs(resumed).map((j) => j.id);
    expect(ready).not.toContain("f1:sh1:image");
    expect(ready).not.toContain("f1:sh2:image");
    // The one that was mid-flight when the process died is offered again.
    expect(ready).toContain("f1:sh3:image");
    expect(progress(resumed).done).toBe(2);
  });
});

describe("repair is bounded and selective", () => {
  it("a rejected shot returns for repair while attempts remain", () => {
    const g = rejectJob(movie(), "f1:sh1:image", "STATIC_MOTION");
    const job = g.jobs.find((j) => j.id === "f1:sh1:image")!;
    expect(job.state).toBe("repair");
    expect(readyJobs(g).map((j) => j.id)).toContain("f1:sh1:image");
  });

  it("it fails for good at the attempt limit, and the film stops safely", () => {
    let g = movie();
    for (let i = 0; i < MAX_SHOT_ATTEMPTS; i++) g = rejectJob(g, "f1:sh1:image", "STATIC_MOTION");
    expect(g.jobs.find((j) => j.id === "f1:sh1:image")!.state).toBe("failed");
    expect(filmStopped(g)).toBe(true);
    expect(readyJobs(g).map((j) => j.id)).not.toContain("f1:sh1:image");
  });

  it("one bad shot never regenerates the others", () => {
    let g = movie();
    g = completeJob(g, "f1:sh2:image", { outputRef: "keep" });
    g = rejectJob(g, "f1:sh1:image", "STATIC_MOTION");
    expect(g.jobs.find((j) => j.id === "f1:sh2:image")!.state).toBe("done");
  });

  it("only the NEXT shot is implicated by continuity, not the whole tail", () => {
    const g = movie();
    expect(continuityAffected(g, "sh1")).toEqual(["sh2"]);
    expect(continuityAffected(g, "sh3")).toEqual([]);
  });
});

describe("a film is complete only when it is assembled", () => {
  it("every shot done is not a finished film", () => {
    let g = movie();
    for (const j of g.jobs.filter((x) => x.kind !== "assembly")) {
      g = completeJob(g, j.id, { outputRef: "r" });
    }
    expect(filmComplete(g)).toBe(false);
    g = completeJob(g, "f1:assembly", { outputRef: "film.mp4", measuredMs: 12000 });
    expect(filmComplete(g)).toBe(true);
  });
});

// ── CAPACITY A: what a job actually consumes ────────────────────────────────
//
// Owner directive 2026-08-27: CPU-only work must not consume the GPU
// generation allowance — and must not stop being counted either.

describe("jobs are classified by the resource they really use", () => {
  it("image and video are GPU; audio and assembly are not", () => {
    // From the worker's source: piper speaks on the CPU, concat is a
    // stream copy. Neither touches CUDA.
    expect(JOB_RESOURCE.image).toBe("gpu");
    expect(JOB_RESOURCE.video).toBe("gpu");
    expect(JOB_RESOURCE.audio).toBe("cpu");
    expect(JOB_RESOURCE.assembly).toBe("cpu");
  });

  it("a spent GPU day does not stop the CPU work of a film", () => {
    let g = movie();
    // Finish shot 1's picture so its audio becomes ready.
    g = completeJob(g, "f1:sh1:image", { outputRef: "i" });
    g = completeJob(g, "f1:sh1:video", { outputRef: "v" });

    const noGpuLeft = readyJobs(g, { gpu: 0, cpu: 4 });
    expect(noGpuLeft.map((j) => j.id)).toContain("f1:sh1:audio");
    expect(noGpuLeft.every((j) => resourceOf(j) === "cpu")).toBe(true);
  });

  it("CPU work never consumes a GPU slot", () => {
    let g = movie();
    g = completeJob(g, "f1:sh1:image", { outputRef: "i" });
    g = completeJob(g, "f1:sh1:video", { outputRef: "v" });

    const oneEach = readyJobs(g, { gpu: 1, cpu: 1 });
    expect(oneEach.filter((j) => resourceOf(j) === "gpu")).toHaveLength(1);
    expect(oneEach.filter((j) => resourceOf(j) === "cpu")).toHaveLength(1);
  });

  it("CPU work is still bounded — classified, not exempted", () => {
    let g = movie();
    g = completeJob(g, "f1:sh1:image", { outputRef: "i" });
    g = completeJob(g, "f1:sh1:video", { outputRef: "v" });
    expect(readyJobs(g, { gpu: 0, cpu: 0 })).toHaveLength(0);
  });
});

// ── CAPACITY B: one conditioning still per scene ────────────────────────────

describe("a scene's shots share one conditioning still where they can", () => {
  function sceneIr(shots: Partial<StoryIr["scenes"][0]["shots"][0]>[]): StoryIr {
    const base = ir(1);
    base.scenes[0].shots = shots.map((s, i) => ({
      id: `sh${i + 1}`,
      visualDescription: "a lamp",
      motionDescription: "push in",
      cameraDescription: "push-in",
      characters: [],
      locationId: "l1",
      durationSeconds: 4,
      ...s,
    })) as StoryIr["scenes"][0]["shots"];
    return base;
  }

  it("three shots in one place with one cast need ONE still, not three", () => {
    const g = buildGraph(sceneIr([{}, {}, {}]), {
      filmId: "f1",
      grade: "movie",
      stillPerScene: true,
    });
    expect(g.jobs.filter((j) => j.kind === "image")).toHaveLength(1);
    // ...and every shot still gets its own motion job.
    expect(g.jobs.filter((j) => j.kind === "video")).toHaveLength(3);
  });

  it("every video animates the still it was actually anchored to", () => {
    const g = buildGraph(sceneIr([{}, {}, {}]), {
      filmId: "f1",
      grade: "movie",
      stillPerScene: true,
    });
    for (const v of g.jobs.filter((j) => j.kind === "video")) {
      expect(v.needs).toEqual(["f1:sh1:image"]);
    }
  });

  it("a location change forces a new still — a frame cannot show two places", () => {
    const g = buildGraph(sceneIr([{}, { locationId: "l2" }, { locationId: "l2" }]), {
      filmId: "f1",
      grade: "movie",
      stillPerScene: true,
    });
    expect(g.jobs.filter((j) => j.kind === "image")).toHaveLength(2);
  });

  it("a cast change forces a new still — a frame cannot condition who is absent", () => {
    const g = buildGraph(sceneIr([{ characters: ["c1"] }, { characters: ["c1", "c2"] }]), {
      filmId: "f1",
      grade: "movie",
      stillPerScene: true,
    });
    expect(g.jobs.filter((j) => j.kind === "image")).toHaveLength(2);
  });

  it("when in doubt it draws: no anchor yet always means a new still", () => {
    expect(needsOwnStill({ locationId: "l1", characters: [] } as never, null)).toBe(true);
  });

  it("the previous shape is still available and unchanged", () => {
    const g = buildGraph(sceneIr([{}, {}, {}]), { filmId: "f1", grade: "movie" });
    expect(g.jobs.filter((j) => j.kind === "image")).toHaveLength(3);
  });
});
