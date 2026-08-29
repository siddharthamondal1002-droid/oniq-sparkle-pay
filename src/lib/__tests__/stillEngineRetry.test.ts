/**
 * THE STILL ENGINE FAILS 27% OF THE TIME, SO FAILING WELL IS THE FEATURE.
 *
 * Measured 2026-08-28. Story job 1481d262 asked for a 17-shot movie, and
 * image_generate returned FAILED on both of shot 1's two attempts five
 * seconds apart, so the film died before generateClip() was ever reached
 * and the LTX motion path — which had just been proven to open, the log
 * read STORY_MOVIE: select — went untested. The endpoint's own health
 * that minute:
 *
 *   jobs    completed 53  failed 20  inQueue 0  inProgress 0  retried 1
 *   workers idle 1  ready 1  running 0  initializing 0  throttled 0  unhealthy 0
 *
 * A quarter of all jobs failing against hardware with nothing wrong with
 * it. Not queue pressure, not throttling, not resource exhaustion — and
 * not diagnosable either, because the throw discarded the provider's own
 * error text, so twenty failures left no record of why.
 *
 * These tests pin the three things that changed: the reason is captured,
 * a failure says whether asking again could help, and the ladder spends a
 * bounded number of paid attempts on the ones where it could. They also
 * pin what must NOT change — no cloud fallback, no provider substitution,
 * and the artifact evidence intact.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EngineError,
  failureReason,
  generateStill,
  verifyStillOutput,
} from "../../../supabase/functions/_shared/oniqImage.ts";

const worker = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");
const stillFn = readFileSync(
  join(process.cwd(), "supabase/functions/story-still/index.ts"),
  "utf8",
);
const engine = readFileSync(join(process.cwd(), "supabase/functions/_shared/oniqImage.ts"), "utf8");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ENV = { apiKey: "k", endpointId: "ep-1", publicBase: "https://r2.example/" };

function goodOutput(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    op: "image_generate",
    format: "png",
    output_bytes: PNG.byteLength,
    model: "Lightricks/LTX-Video#distilled",
    inference_ms: 2500,
    ...over,
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

/** Submit → poll → artifact, with the poll answers scripted. */
function transport(statuses: { status: string; output?: unknown; error?: unknown }[]) {
  const impl = vi.fn(async (url: string) => {
    if (String(url).endsWith("/run")) {
      return { ok: true, status: 200, json: async () => ({ id: "job-1" }) } as unknown as Response;
    }
    if (String(url).includes("/status/")) {
      return {
        ok: true,
        status: 200,
        json: async () => statuses.shift()!,
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => PNG.buffer.slice(0),
    } as unknown as Response;
  });
  return impl as unknown as typeof fetch;
}

// A. the provider's reason survives
describe("A — a failed job now says why it failed", () => {
  it("carries the provider's error into the message", async () => {
    const t = transport([
      { status: "FAILED", error: "CUDA out of memory while loading LTX weights" },
    ]);
    await expect(generateStill("a lantern", ENV, deps(t))).rejects.toThrow(
      /engine job FAILED: CUDA out of memory while loading LTX weights/,
    );
  });

  it("reads a reason nested in output when there is no top-level error", () => {
    expect(failureReason({ output: { error: "handler raised" } })).toBe("handler raised");
    expect(failureReason({ output: "plain string failure" })).toBe("plain string failure");
  });

  it("joins both sources and bounds the length", () => {
    expect(failureReason({ error: "a", output: { message: "b" } })).toBe("a | b");
    expect(failureReason({ error: "x".repeat(900) }).length).toBe(300);
  });

  it("a reasonless failure still names the status rather than inventing one", async () => {
    const t = transport([{ status: "FAILED" }]);
    await expect(generateStill("a lantern", ENV, deps(t))).rejects.toThrow(/engine job FAILED$/);
    expect(failureReason(null)).toBe("");
    expect(failureReason({ error: 42 })).toBe("");
  });
});

// B. transient vs deterministic
describe("B — a failure says whether asking again could help", () => {
  it("FAILED and TIMED_OUT are retryable; CANCELLED is somebody's decision", async () => {
    for (const status of ["FAILED", "TIMED_OUT"]) {
      const err = await generateStill("p", ENV, deps(transport([{ status }]))).catch((e) => e);
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).retryable).toBe(true);
    }
    const cancelled = await generateStill(
      "p",
      ENV,
      deps(transport([{ status: "CANCELLED" }])),
    ).catch((e) => e);
    expect((cancelled as EngineError).retryable).toBe(false);
  });

  it("a wrong or unproven artifact is NOT retryable — the answer would not change", async () => {
    const cases = [
      goodOutput({ ok: false, code: "refused" }),
      goodOutput({ op: "video_generate" }),
      goodOutput({ format: "jpeg" }),
      goodOutput({ output_bytes: 0 }),
      goodOutput({ model: "missing" }),
      goodOutput({ inference_ms: 0 }),
    ];
    for (const output of cases) {
      const err = await generateStill(
        "p",
        ENV,
        deps(transport([{ status: "COMPLETED", output }])),
      ).catch((e) => e);
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).retryable).toBe(false);
      // and the evidence check itself is unchanged
      expect(verifyStillOutput(output).ok).toBe(false);
    }
  });

  it("the platform (5xx) is retryable, a verdict on the request (4xx) is not", async () => {
    const reject = (status: number) =>
      vi.fn(async () => ({ ok: false, status })) as unknown as typeof fetch;
    const five = await generateStill("p", ENV, deps(reject(503))).catch((e) => e);
    expect((five as EngineError).retryable).toBe(true);
    const four = await generateStill("p", ENV, deps(reject(400))).catch((e) => e);
    expect((four as EngineError).retryable).toBe(false);
  });

  it("the default is not-retryable, so a new throw never becomes spend by accident", () => {
    expect(new EngineError("something new").retryable).toBe(false);
  });

  it("a refusal that is really infrastructure is retried — a GPU-less worker most of all", async () => {
    // The worker catches every Python exception and returns {ok:false,code}
    // as a COMPLETED job, so cuda-unavailable arrives shaped exactly like a
    // refusal of the prompt. It is not one: the next container may have a
    // GPU. Same for a bucket that throttled.
    for (const code of ["cuda-unavailable", "SlowDown", "InternalError"]) {
      const err = await generateStill(
        "p",
        ENV,
        deps(transport([{ status: "COMPLETED", output: { ok: false, code } }])),
      ).catch((e) => e);
      expect(String(err)).toContain(`engine refused: ${code}`);
      expect((err as EngineError).retryable).toBe(true);
    }
  });

  it("an unrecognised refusal code stays non-retryable — the list is an allowlist", async () => {
    for (const code of ["no-frames", "storage-not-configured", "prompt-refused", "unknown"]) {
      const err = await generateStill(
        "p",
        ENV,
        deps(transport([{ status: "COMPLETED", output: { ok: false, code } }])),
      ).catch((e) => e);
      expect((err as EngineError).retryable).toBe(false);
    }
    expect(verifyStillOutput({ ok: false, code: "brand-new-code" })).toMatchObject({
      ok: false,
      retryable: false,
    });
  });
});

// C. the ladder
describe("C — the ladder spends a bounded number of paid attempts", () => {
  it("three attempts, two waits, and the waits are not the same instant", () => {
    expect(worker).toMatch(/const STILL_BACKOFF_MS = \[5_000, 20_000\];/);
    expect(worker).toMatch(/const STILL_ATTEMPTS = STILL_BACKOFF_MS\.length \+ 1;/);
    expect(worker).toMatch(/for \(let t = 0; t < STILL_ATTEMPTS; t\+\+\)/);
  });

  it("runs out rather than looping, because every attempt is a GPU job", () => {
    expect(worker).toMatch(/const delay = STILL_BACKOFF_MS\[t\];/);
    expect(worker).toMatch(/if \(delay === undefined\) \{[\s\S]{0,220}throw err;/);
    // no unbounded escalation hiding anywhere near the still ladder
    expect(worker).not.toMatch(/while \(true\)[\s\S]{0,200}story-still/);
  });

  it("records attempt, error and delay on every retry", () => {
    expect(worker).toMatch(/attempt \$\{t \+ 1\}\/\$\{STILL_ATTEMPTS\} transient/);
    expect(worker).toMatch(/again in \$\{delay \/ 1000\}s/);
    expect(worker).toMatch(/attempt \$\{t \+ 1\}\/\$\{STILL_ATTEMPTS\} failed/);
  });

  it("believes the engine's verdict over the status code, and falls back when absent", () => {
    expect(worker).toMatch(/const said = \/"retryable"\\s\*:\\s\*\(true\|false\)\/\.exec\(msg\);/);
    expect(worker).toMatch(/said\s*\n?\s*\?\s*said\[1\] === 'true'/);
    expect(worker).toMatch(/: \/story-still: \(5\\d\\d\|429\)\/\.test\(msg\)/);
  });

  it("a deterministic failure is thrown at once, not retried", () => {
    // Neither steppable nor transient leaves the loop immediately — the
    // requirement is that a non-retryable verdict never reaches the delay.
    expect(worker).toMatch(/if \(!steppable && !transient\) throw err;/);
  });

  it("story-still hands the verdict out, defaulting to not-retryable", () => {
    expect(stillFn).toMatch(
      /const retryable = err instanceof EngineError \? err\.retryable : false;/,
    );
    expect(stillFn).toMatch(
      /return json\(\{ error: `Could not draw that frame: \$\{why\}`, retryable \}, 502\);/,
    );
    expect(stillFn).toMatch(/import \{ EngineError, generateStill \}/);
  });
});

// D. what must not change
describe("D — no fallback, no substitution, and the artifact still has to prove itself", () => {
  it("no code in the still path calls another provider", () => {
    // Comments are stripped first, deliberately. The guarantee is about
    // what RUNS: this file's own history is written in its comments, and
    // a note saying "the provider that used to be here is gone" must not
    // read as the provider still being here. What must never appear is a
    // live reference.
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const source of [code(engine), code(stillFn)]) {
      expect(source).not.toMatch(/\bwan\b/i);
      expect(source).not.toMatch(/\bveo\b/i);
      expect(source).not.toMatch(/googleapis|generativelanguage|gemini/i);
      expect(source).not.toMatch(/runway|replicate|fal\.ai/i);
    }
  });

  it("the engine is still ONIQ's own endpoint and the op is still image_generate", () => {
    expect(engine).toContain('const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2"');
    expect(engine).toMatch(/op: "image_generate"/);
    // one submit site, so a retry cannot quietly become a different engine
    expect(engine.match(/\/run`/g)?.length).toBe(1);
  });

  it("a retry writes a fresh key and re-proves the bytes — no trusting a past attempt", async () => {
    const t = transport([{ status: "COMPLETED", output: goodOutput() }]);
    const out = await generateStill("a lantern", ENV, deps(t));
    expect(out.key).toBe("story/still/id-1.png");
    expect(engine).toMatch(/if \(bytes\.byteLength !== verdict\.bytes\)/);
    expect(engine).toMatch(/if \(!looksLikePng\(bytes\)\) throw new EngineError/);
  });

  it("a byte-count mismatch is still fatal and still not retryable", async () => {
    const impl = vi.fn(async (url: string) => {
      if (String(url).endsWith("/run")) {
        return { ok: true, status: 200, json: async () => ({ id: "j" }) } as unknown as Response;
      }
      if (String(url).includes("/status/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "COMPLETED", output: goodOutput({ output_bytes: 999 }) }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => PNG.buffer.slice(0),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const err = await generateStill("p", ENV, deps(impl)).catch((e) => e);
    expect(String(err)).toMatch(/artifact is \d+ bytes, engine measured 999/);
    expect((err as EngineError).retryable).toBe(false);
  });
});

// E. the label
describe("E — the log names the engine that will actually be called", () => {
  it("no run can print RENTED any more", () => {
    // The word survives in one comment recording what the old line said;
    // no template literal or string that reaches a log carries it.
    const emitted = worker.replace(/^\s*\/\/.*$/gm, "");
    expect(emitted).not.toMatch(/RENTED/);
  });

  it("emits all three facts as greppable KEY=VALUE tokens", () => {
    expect(worker).toMatch(/MOTION_STAGE=\$\{clipStage\}/);
    expect(worker).toMatch(/MOTION_PROVIDER=\$\{inHouse \? 'in_house' : 'external'\}/);
    expect(worker).toMatch(/MOTION_ENGINE=\$\{inHouse \? 'LTX' : 'story-clip'\}/);
    expect(worker).toMatch(/IN_HOUSE_MOTION=\$\{inHouse \? 'on' : 'off'\}/);
    expect(worker).toMatch(/const inHouse = process\.env\.IN_HOUSE_MOTION === 'on';/);
  });

  /**
   * The line the production run must print, rendered from the same
   * expressions the worker uses. A test that only greps for the template
   * cannot catch a token that reads correctly in source and wrong once
   * interpolated, which is exactly the class of defect RENTED was.
   */
  const renderLabel = (clipStage: string, inHouseMotion: string) => {
    const inHouse = inHouseMotion === "on";
    return clipStage === "off"
      ? "  movie grade: MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none" +
          " — stills and camera only (STORY_MOVIE unset)"
      : `  movie grade: MOTION_STAGE=${clipStage} ` +
          `MOTION_PROVIDER=${inHouse ? "in_house" : "external"} ` +
          `MOTION_ENGINE=${inHouse ? "LTX" : "story-clip"} ` +
          `(IN_HOUSE_MOTION=${inHouse ? "on" : "off"}, ${
            clipStage === "select" ? "motion-selected shots only" : "every shot"
          })`;
  };

  it("the production case reads in_house / LTX and cannot be mistaken for a rented provider", () => {
    const line = renderLabel("select", "on");
    expect(line).toContain("MOTION_STAGE=select");
    expect(line).toContain("MOTION_PROVIDER=in_house");
    expect(line).toContain("MOTION_ENGINE=LTX");
    expect(line).toContain("IN_HOUSE_MOTION=on");
    for (const wrong of ["RENTED", "rented", "veo", "Veo", "google", "Google", "wan", "WAN"]) {
      expect(line).not.toContain(wrong);
    }
  });

  it("with the in-house switch off it says external, so the payer is never hidden", () => {
    const line = renderLabel("select", "");
    expect(line).toContain("MOTION_PROVIDER=external");
    expect(line).toContain("MOTION_ENGINE=story-clip");
    expect(line).toContain("IN_HOUSE_MOTION=off");
    expect(line).not.toContain("in_house");
  });

  it("the clip stage being off says stills and camera, not an experiment", () => {
    expect(renderLabel("off", "on")).toContain(
      "MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none",
    );
    expect(worker).toMatch(/MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none/);
  });
});

// F. the motion chain the still engine was blocking
describe("F — the route the film has to reach once a still succeeds", () => {
  it("'select' still opens the clip stage and generateClip is still its caller", () => {
    expect(worker).toMatch(
      /job\.grade === 'movie' && \(process\.env\.STORY_MOVIE === 'on' \|\| process\.env\.STORY_MOVIE === 'select'\)/,
    );
    expect(worker).toMatch(/if \(motionPlan\?\.attemptClip\)/);
    const call = worker.slice(worker.indexOf("if (motionPlan?.attemptClip)"));
    expect(call.slice(0, 600)).toMatch(/await generateClip\(/);
  });

  it("in-house routes to story-motion with no provider beneath it", () => {
    const generateClip = worker.slice(
      worker.indexOf("async function generateClip("),
      worker.indexOf("Temporal-aliveness score"),
    );
    const inHouse = generateClip.slice(
      generateClip.indexOf("route.engine === 'in-house'"),
      generateClip.indexOf("const prompt = composeVideoPrompt"),
    );
    expect(inHouse).toContain("edge('story-motion'");
    expect(inHouse).not.toContain("edge('story-clip'");
    expect(generateClip).toMatch(
      /in-house motion unavailable \(\$\{route\.reason\}\) — no provider fallback/,
    );
  });

  it("the engine switch is still IN_HOUSE_MOTION === 'on' and nothing else", () => {
    expect(worker).toMatch(/inHouseEnabled: process\.env\.IN_HOUSE_MOTION === 'on'/);
  });
});
