// Resuming one still across many calls — the fix for the cold-start wall.
//
// WHAT THIS PINS, and why it is worth a file of its own. Until 2026-09-01
// story-still held its own 120s deadline and the worker re-ASKED on expiry.
// Measured that day on jobs e09a0dcf and 4b335729: a cold RunPod worker must
// pull ~40 GiB of image and then fetch a 17.74 GiB text encoder out of R2
// before it can draw, so all three attempts expired — and each one SUBMITTED
// A FRESH GPU JOB while the first was still hydrating. At workersMax 1 those
// queue. One cold start therefore cost three billed jobs and produced no
// frame at all.
//
// A Supabase edge function cannot wait that out; its wall clock is measured
// in seconds. So the submit and the wait are separate now, and the waiting
// belongs to the GitHub runner, which has hours. The property that actually
// saves the money is the last one: N polls, exactly ONE submit.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  EngineError,
  STILL_MIME,
  pollStill,
  stillKeyFor,
  submitStill,
} from "../../../supabase/functions/_shared/oniqImage.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ENV = { apiKey: "k", endpointId: "ep-1", publicBase: "https://r2.example/" };

function goodOutput() {
  return {
    ok: true,
    op: "image_generate",
    format: "png",
    output_bytes: PNG.byteLength,
    model: "Lightricks/LTX-Video#distilled",
    model_load_ms: 13000,
    inference_ms: 2500,
  };
}

function deps(fetchImpl: typeof fetch) {
  return {
    fetchImpl,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    sleep: () => Promise.resolve(),
    newId: () => "id-1",
  };
}

/** A transport that records every URL, so "how many submits" is observable. */
function transport(statuses: { status: string; output?: unknown }[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith("/run")) {
      return { ok: true, status: 200, json: async () => ({ id: "job-1" }) } as unknown as Response;
    }
    if (String(url).includes("/status/")) {
      const next = statuses.shift() ?? { status: "IN_PROGRESS" };
      return { ok: true, status: 200, json: async () => next } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG.buffer.slice(0),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const runs = (calls: string[]) => calls.filter((u) => u.endsWith("/run")).length;

describe("submit hands back a job id and does not wait", () => {
  it("submits once, returns the engine's id and the derived key", async () => {
    const t = transport([]);
    const got = await submitStill("a lantern", ENV, deps(t.impl), { id: "shot-a" });

    expect(got.jobId).toBe("job-1");
    expect(got.key).toBe(stillKeyFor("shot-a"));
    // Exactly one call, and it is the submit. Nothing polled, nothing fetched.
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]).toContain("api.runpod.ai/v2/ep-1/run");
  });
});

describe("poll asks once and reports honestly", () => {
  it("a running job is not an error and not a frame", async () => {
    const t = transport([{ status: "IN_PROGRESS" }]);
    const got = await pollStill("job-1", "shot-a", ENV, deps(t.impl));

    expect(got.done).toBe(false);
    // It must NOT go looking in the bucket for a frame nobody has written.
    expect(t.calls.some((u) => u.includes("r2.example"))).toBe(false);
  });

  it("a completed job returns the proven bytes", async () => {
    const t = transport([{ status: "COMPLETED", output: goodOutput() }]);
    const got = await pollStill("job-1", "shot-a", ENV, deps(t.impl));

    expect(got.done).toBe(true);
    if (got.done !== true) throw new Error("unreachable");
    expect(got.mime).toBe(STILL_MIME);
    expect(got.bytes).toBe(PNG.byteLength);
    expect(got.key).toBe(stillKeyFor("shot-a"));
  });

  it("the artifact it fetches is the key it DERIVED, never one it was handed", async () => {
    // A poll that accepted a bucket key would let its caller name any object
    // in the bucket and have the function fetch it back to them. stillKeyFor
    // carries no overload taking a key; this keeps that true on the resume
    // path too — the only thing a caller contributes is a bounded id.
    const t = transport([{ status: "COMPLETED", output: goodOutput() }]);
    await pollStill("job-1", "shot-a", ENV, deps(t.impl));

    const fetched = t.calls.find((u) => u.includes("r2.example"));
    expect(fetched).toBe(`https://r2.example/${stillKeyFor("shot-a")}`);
    expect(fetched).not.toContain("..");
  });

  it("a terminal failure is still the engine's own verdict", async () => {
    const t = transport([{ status: "FAILED", output: { error: "cuda hiccup" } }]);
    await expect(pollStill("job-1", "shot-a", ENV, deps(t.impl))).rejects.toBeInstanceOf(
      EngineError,
    );
  });

  it("CANCELLED is somebody's decision and is not retried", async () => {
    const t = transport([{ status: "CANCELLED" }]);
    await pollStill("job-1", "shot-a", ENV, deps(t.impl)).then(
      () => {
        throw new Error("should have thrown");
      },
      (err) => {
        expect(err).toBeInstanceOf(EngineError);
        expect((err as EngineError).retryable).toBe(false);
      },
    );
  });
});

describe("THE PROPERTY THAT SAVES THE MONEY", () => {
  it("waiting out a cold start costs ONE submitted job, however many polls", async () => {
    // Twelve ticks of a worker that is still hydrating, then the frame. The
    // old shape would have submitted a new GPU job on each expiry; this one
    // must never submit twice.
    const hydrating = Array.from({ length: 12 }, () => ({ status: "IN_PROGRESS" }));
    const t = transport([...hydrating, { status: "COMPLETED", output: goodOutput() }]);

    const { jobId, key } = await submitStill("a lantern", ENV, deps(t.impl), { id: "shot-a" });
    let polls = 0;
    for (;;) {
      const got = await pollStill(jobId, "shot-a", ENV, deps(t.impl));
      polls += 1;
      if (got.done) break;
    }

    expect(polls).toBe(13);
    expect(key).toBe(stillKeyFor("shot-a"));
    // The whole point, in one assertion.
    expect(runs(t.calls)).toBe(1);
    // And every poll named the SAME engine job.
    const polled = t.calls.filter((u) => u.includes("/status/"));
    expect(polled).toHaveLength(13);
    expect(new Set(polled).size).toBe(1);
    expect(polled[0]).toContain("/status/job-1");
  });
});

describe("the worker is the side that waits", () => {
  const WORKER = readFileSync(
    new URL("../../../remotion/scripts/story-worker.mjs", import.meta.url),
    "utf8",
  );

  it("submits once, then polls the id that submit returned", () => {
    // The bug was re-ASKING on expiry. drawStill must start exactly once and
    // then name `started.engineJobId` on every poll.
    expect(WORKER).toMatch(
      /const started = await edge\('story-still', \{ \.\.\.payload, action: 'start' \}\)/,
    );
    expect(WORKER).toMatch(/engineJobId: started\.engineJobId/);
    // Exactly ONE story-still start in the whole file — a second would be a
    // resubmit by another name. Scoped to story-still on purpose: story-clip
    // has its own start/poll stage and legitimately uses the same verb.
    const stillStarts =
      WORKER.match(/edge\('story-still', \{ \.\.\.payload, action: 'start' \}\)/g) ?? [];
    expect(stillStarts).toHaveLength(1);
  });

  it("waits longer than a cold start but under the endpoint's own ceiling", () => {
    // The endpoint's executionTimeoutMs read live as 2_700_000 (45 min) on
    // 2026-09-01. The runner's patience must exceed a realistic cold start
    // (~40 GiB image pull plus a 17.74 GiB R2 fetch) and stay under that, so
    // RunPod's ceiling is the backstop rather than this number.
    const wait = /const STILL_WAIT_MS = (\d+) \* 60_000/.exec(WORKER);
    expect(wait).not.toBeNull();
    const minutes = Number(wait![1]);
    expect(minutes).toBeGreaterThan(10);
    expect(minutes).toBeLessThan(45);
  });

  it("takes the anchor's verdict from START, never from a poll", () => {
    // A poll carries no characterRefId, so recomputing provenance there would
    // report `conditioned: false` for a still that was in fact anchored.
    expect(WORKER).toMatch(/conditioned: started\.conditioned/);
  });
});
