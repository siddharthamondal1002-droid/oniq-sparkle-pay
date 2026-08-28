/**
 * The in-house motion transport: engine, edge function and renderer wiring.
 *
 * The engine is exercised against a fake fetch — the same discipline
 * oniqImage's tests use — because this path spends money when it is wrong and
 * a GPU is not available to find that out.
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { generateMotionClip, MotionEngineError } from "../../../supabase/functions/_shared/oniqMotion";
import { stillKeyFor } from "../../../supabase/functions/_shared/inHouseMotion";
import { stillKeyFor as oniqStillKeyFor } from "../../../supabase/functions/_shared/oniqImage";

const ENV = { apiKey: "k", endpointId: "ep", publicBase: "https://cdn.example" };
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 1, 2, 3, 4, 5, 6]);

function deps(over: Partial<Parameters<typeof generateMotionClip>[2]> = {}) {
  return {
    fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
    now: () => 0,
    sleep: async () => {},
    ...over,
  };
}

/** A fetch that walks submit → status → artifact. */
const GOOD_OUTPUT = {
  ok: true,
  device: "cuda",
  gpu_name: "NVIDIA RTX A5000",
  model: "LTX_VIDEO_2B",
  model_load_ms: 900,
  inference_ms: 12_000,
  frames: 97,
  video_seconds: 97 / 24,
  output_bytes: MP4.byteLength,
};

function happyFetch(output: unknown = GOOD_OUTPUT) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    if (String(url).endsWith("/run")) return new Response(JSON.stringify({ id: "gpu-77" }));
    if (String(url).includes("/status/")) {
      return new Response(JSON.stringify({ status: "COMPLETED", output }));
    }
    return new Response(MP4);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("one still key scheme", () => {
  it("inHouseMotion derives through oniqImage's own function", () => {
    expect(stillKeyFor("job1", "s1", "sh1")).toBe(oniqStillKeyFor("job1-s1-sh1"));
    expect(stillKeyFor("job1", "s1", "sh1")).toBe("story/still/job1-s1-sh1.png");
  });
});

describe("the motion engine", () => {
  it("submits video_generate naming the still it animates", async () => {
    const bodies: string[] = [];
    const { impl } = happyFetch();
    const spy = (async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(String(init.body));
      return impl(url as never, init as never);
    }) as unknown as typeof fetch;

    const out = await generateMotionClip(
      { prompt: "push in", inputKey: "story/still/a.png", outputKey: "story/clip/a.mp4", watermark: true },
      ENV,
      deps({ fetchImpl: spy }),
    );
    const submitted = JSON.parse(bodies[0]);
    expect(submitted.input.op).toBe("video_generate");
    expect(submitted.input.input_key).toBe("story/still/a.png");
    expect(submitted.input.params.watermark).toBe(true);
    expect(out.gpuJobId).toBe("gpu-77");
    expect(out.mime).toBe("video/mp4");
  });

  it("proves the artifact is really an mp4, not just a 200", async () => {
    const notMp4 = (async (url: string) => {
      if (String(url).endsWith("/run")) return new Response(JSON.stringify({ id: "g1" }));
      if (String(url).includes("/status/")) {
        return new Response(
          JSON.stringify({
            status: "COMPLETED",
            output: { ...GOOD_OUTPUT, output_bytes: 4 },
          }),
        );
      }
      return new Response(new Uint8Array([1, 2, 3, 4]));
    }) as unknown as typeof fetch;
    await expect(
      generateMotionClip(
        { prompt: "p", inputKey: "story/still/a.png", outputKey: "story/clip/a.mp4", watermark: true },
        ENV,
        deps({ fetchImpl: notMp4 }),
      ),
    ).rejects.toThrow(/artifact-size-mismatch|artifact-not-mp4/);
  });

  it("carries the gpu job id into every failure so nothing is orphaned", async () => {
    const failed = (async (url: string) => {
      if (String(url).endsWith("/run")) return new Response(JSON.stringify({ id: "gpu-9" }));
      return new Response(JSON.stringify({ status: "FAILED" }));
    }) as unknown as typeof fetch;
    await expect(
      generateMotionClip(
        { prompt: "p", inputKey: "story/still/a.png", outputKey: "story/clip/a.mp4", watermark: true },
        ENV,
        deps({ fetchImpl: failed }),
      ),
    ).rejects.toThrow(/gpu job gpu-9/);
  });

  it("a timeout names the job rather than losing it", async () => {
    let t = 0;
    const slow = (async (url: string) => {
      if (String(url).endsWith("/run")) return new Response(JSON.stringify({ id: "gpu-slow" }));
      return new Response(JSON.stringify({ status: "IN_PROGRESS" }));
    }) as unknown as typeof fetch;
    await expect(
      generateMotionClip(
        { prompt: "p", inputKey: "story/still/a.png", outputKey: "story/clip/a.mp4", watermark: true },
        ENV,
        deps({ fetchImpl: slow, now: () => (t += 400_000) }),
        { deadlineMs: 1000, pollMs: 0 },
      ),
    ).rejects.toThrow(/gpu job gpu-slow/);
  });

  it("refuses a rejected submission rather than polling nothing", async () => {
    const rejected = (async () => new Response("no", { status: 429 })) as unknown as typeof fetch;
    await expect(
      generateMotionClip(
        { prompt: "p", inputKey: "story/still/a.png", outputKey: "story/clip/a.mp4", watermark: true },
        ENV,
        deps({ fetchImpl: rejected }),
      ),
    ).rejects.toBeInstanceOf(MotionEngineError);
  });

  it("uses the SHARED artifact verifier — no second copy of the mp4 check", async () => {
    const src = readFileSync(
      new URL("../../../supabase/functions/_shared/oniqMotion.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("verifyStoredArtifact");
    expect(src).not.toContain("0x66");
    expect(src).not.toContain("looksLikeMp4");
  });
});

describe("story-motion is job-token only and path-free", () => {
  const SRC = readFileSync(
    new URL("../../../supabase/functions/story-motion/index.ts", import.meta.url),
    "utf-8",
  );

  it("has no user-JWT branch — a browser cannot animate a film", () => {
    expect(SRC).toContain("x-story-job-token");
    expect(SRC).not.toContain("auth.getUser");
    expect(SRC).not.toContain("SUPABASE_ANON_KEY");
  });

  it("takes the job id from the TOKEN, never the body", () => {
    expect(SRC).toContain("stillKeyFor(verified.jobId");
    expect(SRC).not.toMatch(/body\?\.jobId/);
  });

  it("accepts no key, url or path field of any kind", () => {
    for (const banned of ["body?.stillKey", "body?.inputKey", "body?.url", "body?.path"]) {
      expect(SRC).not.toContain(banned);
    }
  });

  it("names no provider but ONIQ's own worker", () => {
    for (const banned of ["veo", "generativelanguage", "GOOGLE_AI_API_KEY"]) {
      expect(SRC.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    // The only mention of a fallback is the comment saying there is none.
    expect(SRC).toContain("NO FALLBACK");
  });
});

describe("the renderer's in-house branch", () => {
  const R = readFileSync(
    new URL("../../../remotion/scripts/story-worker.mjs", import.meta.url),
    "utf-8",
  );
  const FN = R.slice(R.indexOf("async function generateClip("), R.indexOf("Temporal-aliveness score"));

  it("calls story-motion", () => {
    expect(FN).toContain("edge('story-motion'");
  });

  it("takes noWatermark as a PARAMETER, not from a foreign scope", () => {
    // Regression: an earlier draft read `job?.no_watermark` inside this
    // function, where `job` is not in scope — a ReferenceError that would
    // only have fired once the flag was switched on.
    expect(FN).toMatch(/async function generateClip\([^)]*noWatermark/);
    expect(FN).not.toMatch(/\bjob\?\./);
    expect(FN).not.toMatch(/\bjob\.id\b/);
  });

  it("refuses an empty in-house reply instead of falling through to Veo", () => {
    expect(FN).toContain("no provider fallback");
  });
});
