/**
 * The dry-run seam, and the guarantee it is only worth having if it holds.
 *
 * WHAT A DRY RUN CLAIMS. `STORY_FIXTURES=<dir> node scripts/story-worker.mjs`
 * renders a real film through the real worker — the real still ladder, the
 * real voice fallback, the real Remotion render and the real ffmpeg assembly —
 * while making zero network calls and spending zero money. That claim is the
 * entire value of the mode. If it is false, the mode is worse than nothing,
 * because it invites exactly the runs nobody would risk against production.
 *
 * WHY THIS FILE IS PARANOID. The first version of the seam made that claim and
 * it was false in three ways, each confirmed in the source:
 *
 *   1. `claimJob()` was not intercepted. With a service key present a dry run
 *      would claim a REAL QUEUED ROW, fill a paying user's film with synthetic
 *      PNGs and sine tones, and mark it ready.
 *   2. `story-plot` was not intercepted, so the very first thing the worker
 *      does was a paid LLM call.
 *   3. The clip fixture answered with the wrong key, so the happy path was
 *      dead code and the "step-down" being demonstrated was a TypeError
 *      landing in a catch-all.
 *
 * None of those three would have shown up as a failing run. All three were
 * silent, and two of them cost money while printing success. So the tests here
 * are structural rather than behavioural: they pin the SHAPE of the seam, on
 * the theory that the next hole will be as quiet as the last three.
 *
 * WHY THE WORKER IS PARSED AND NOT IMPORTED. `story-worker.mjs` executes on
 * import — it is a script, not a module — so importing it here would start a
 * render. The repo already reads-and-parses for the same reason elsewhere
 * (storyPricing, modelRegistry). `storyFixtures.mjs` has no side effects and
 * IS imported, so the fixture half is tested for real.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findBin } from "../../../remotion/scripts/findFfmpeg.mjs";
import { packetCoverageFailures } from "../../../remotion/scripts/mediaIntegrity.mjs";
import {
  assertNoProductionCredentials,
  createFixtureEdge,
  loadScenario,
  type FixtureAnswer,
} from "../../../remotion/scripts/storyFixtures.mjs";

const ROOT = process.cwd();
const WORKER_PATH = "remotion/scripts/story-worker.mjs";
const FIXTURES_ROOT = join(ROOT, "remotion/fixtures/story");
const WORKER = readFileSync(join(ROOT, WORKER_PATH), "utf8");

/**
 * The worker with comments removed.
 *
 * Every one of these guards is documented in a comment that names the thing it
 * forbids, so a test reading raw source passes on the prose and proves
 * nothing. This trap has been sprung repeatedly in this repo; strip first.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * An ffmpeg this machine can actually encode with, or null.
 *
 * `findBin` looks inside remotion's own node_modules for the compositor build.
 * The lint workflow runs `npm ci` at the repo root only, so on CI that path
 * does not exist and findBin throws — which is how the clip test took the
 * whole suite down after passing locally, where those deps are installed.
 *
 * So: prefer the binary the worker itself would find (that is the one whose
 * cut-down filter surface the fixture has to respect), fall back to a system
 * ffmpeg, and report null when there is neither. A machine with no ffmpeg at
 * all cannot run a dry run either, so there is nothing there to protect.
 */
function resolveFfmpeg(): string | null {
  try {
    return findBin("ffmpeg");
  } catch {
    // remotion's dependencies are not installed here.
  }
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return probe.status === 0 ? "ffmpeg" : null;
}
const FFMPEG = resolveFfmpeg();

/** Every `async function name(...) { ... }` body, by brace matching. */
function functionBodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = /async function (\w+)\s*\([^)]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(src))) {
    let depth = 1;
    let i = head.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    out.set(m[1], src.slice(head.lastIndex, i - 1));
  }
  return out;
}

describe("dry run refuses to run against anything real", () => {
  // The rule is "a dry run HAS no credentials", not "ignores the ones it
  // has" — because the damage case is authentication succeeding by accident.
  it.each(["SUPABASE_SERVICE_ROLE_KEY", "STORY_JOB_TOKEN"])(
    "refuses to start when %s is set",
    (key) => {
      expect(() => assertNoProductionCredentials({ [key]: "x" })).toThrow(key);
    },
  );

  it("names every armed credential, not just the first", () => {
    expect(() =>
      assertNoProductionCredentials({
        SUPABASE_SERVICE_ROLE_KEY: "x",
        STORY_JOB_TOKEN: "y",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY and STORY_JOB_TOKEN/);
  });

  it("starts clean when the environment has neither", () => {
    expect(() => assertNoProductionCredentials({ HOME: "/root" })).not.toThrow();
  });

  it("is called by the worker before anything else in the dry-run branch", () => {
    const code = codeOnly(WORKER);
    const guard = code.indexOf("assertNoProductionCredentials(process.env)");
    const build = code.indexOf("createFixtureEdge(");
    expect(guard).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(guard);
  });

  it("refuses PLAN mode, which never reaches the seam at all", () => {
    // PLAN takes a branch that makes no generation calls, so pairing it with
    // fixtures would silently exercise nothing. Failing loudly beats that.
    expect(codeOnly(WORKER)).toMatch(/STORY_FIXTURES and PLAN are different modes/);
  });
});

describe("every route out of the process is stubbed", () => {
  const bodies = functionBodies(codeOnly(WORKER));

  it("finds the worker's network functions", () => {
    // A sanity check on the parser itself: if this drops to zero the tests
    // below all pass vacuously, which is the failure mode of a source-reading
    // test and the reason it is asserted rather than assumed.
    const reaching = [...bodies].filter(([, b]) => /\bfetch\(/.test(b));
    expect(reaching.length).toBeGreaterThanOrEqual(5);
  });

  it.each(
    [...functionBodies(codeOnly(WORKER))]
      .filter(([, b]) => /\bfetch\(/.test(b))
      .map(([name]) => name),
  )("%s cannot reach the network in a dry run", (name) => {
    // Not "mentions fixtureEdge somewhere" — the guard has to come BEFORE the
    // fetch, or it is decoration. `callback` throws, `db`/`rpc` log and
    // return, `edge` answers from disk, `uploadFinished` copies to .tmp.
    const body = bodies.get(name) as string;
    expect(body.indexOf("fixtureEdge")).toBeGreaterThan(-1);
    expect(body.indexOf("fixtureEdge")).toBeLessThan(body.indexOf("fetch("));
  });

  it("claims no job — the scenario supplies it", () => {
    const claim = functionBodies(codeOnly(WORKER)).get("claimJob") as string;
    expect(claim).toMatch(/if \(fixtureEdge\) return fixtureEdge\.job\(\);/);
  });

  it("treats a callback as a bug rather than making one", () => {
    // db and rpc degrade to a log because a dry run wants to SEE the writes it
    // would have made. A callback has no such reading — reaching one means the
    // seam has a hole, so it throws.
    const cb = functionBodies(codeOnly(WORKER)).get("callback") as string;
    expect(cb).toMatch(/if \(fixtureEdge\) throw new Error/);
  });

  it("survives the preflight, which would otherwise refuse first", () => {
    // SUPABASE_URL is required for a real run and absent in a dry one. The
    // preflight used to throw before the fixture branch could speak, so the
    // mode was unreachable by its own documented invocation.
    const code = codeOnly(WORKER);
    expect(code).toMatch(/if \(!offline && !fixtureEdge && !SUPABASE_URL\)/);
    expect(code).toMatch(/if \(!offline && !fixtureEdge && !dispatched && !SERVICE_KEY\)/);
  });
});

describe("finished media integrity gate", () => {
  it("rejects a container whose declared duration outlives its media packets", () => {
    const valid = packetCoverageFailures({
      video: { nb_read_packets: "240" },
      audio: { nb_read_packets: "189", sample_rate: "24000" },
      expectedSeconds: 8,
      fps: 30,
    });
    const truncated = packetCoverageFailures({
      video: { nb_read_packets: "179" },
      audio: { nb_read_packets: "140", sample_rate: "24000" },
      expectedSeconds: 8,
      fps: 30,
    });

    expect(valid).toEqual([]);
    expect(truncated).toEqual([
      expect.stringMatching(/video.*partial/i),
      expect.stringMatching(/audio.*partial/i),
    ]);
  });

  it("uses the existing episode verifier after grading and before upload", () => {
    const code = codeOnly(WORKER);
    const onlinePath = code.slice(code.lastIndexOf("await markAssembling(job)"));
    const grade = onlinePath.indexOf("gradeInPlace(outFile)");
    const verify = onlinePath.indexOf("verifyFinishedRender(outFile, expectedSeconds)");
    const upload = onlinePath.indexOf("uploadFinished(job, outFile)");
    const ready = onlinePath.indexOf("markReady(job, storagePath, rendered.length)");

    expect(code).toMatch(/function verifyFinishedRender[\s\S]*verify-episode\.mjs/);
    expect(grade).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(grade);
    expect(upload).toBeGreaterThan(verify);
    expect(ready).toBeGreaterThan(upload);
  });

  it("verifies against the exact duration selected by Remotion", () => {
    const render = functionBodies(codeOnly(WORKER)).get("renderPlan") as string;
    expect(render).toMatch(/return videoSeconds/);
    expect(codeOnly(WORKER)).toMatch(/const expectedSeconds = await renderPlan\(/);
  });

  it("uses the same ceiling-safe audio frame conversion as the composition", () => {
    expect(codeOnly(WORKER)).toContain(
      "const durationFrames = framesForStorySeconds(seconds, FPS)",
    );
  });

  it("rejects narration that decodes but contains no speech signal", () => {
    expect(codeOnly(WORKER)).toContain(
      "push('audio.signal', speechSpanCount > 0, `${speechSpanCount} speech spans`)",
    );
  });
});

/** Call the seam and insist it had an opinion. `null` means "let it through". */
async function answer(
  dir: string,
  fn: string,
  body: Record<string, unknown> = {},
): Promise<FixtureAnswer> {
  const got = await createFixtureEdge(dir, {})(fn, body);
  expect(got, `${fn} was not intercepted — a dry run would make this call for real`).not.toBeNull();
  return got as FixtureAnswer;
}

/** The base64 payload, decoded, insisting the key the worker reads is present. */
function payload(got: FixtureAnswer): Buffer {
  expect(typeof got.data).toBe("string");
  return Buffer.from(got.data as string, "base64");
}

describe("fixture answers match the keys the worker reads", () => {
  const dir = join(FIXTURES_ROOT, "happy-path");

  it("story-plot answers from disk — it is a paid LLM call", async () => {
    const got = await answer(dir, "story-plot", { prompt: "x" });
    expect(got.plan?.shots.length).toBeGreaterThan(0);
  });

  it("story-still answers with `data`, base64 of a real PNG", async () => {
    const got = await answer(dir, "story-still", { prompt: "x" });
    expect(got.mime).toBe("image/png");
    expect(payload(got).subarray(1, 4).toString("latin1")).toBe("PNG");
  });

  it("story-voice answers with `data` and a mime carrying a sample rate", async () => {
    const got = await answer(dir, "story-voice", { text: "hello there" });
    expect(got.mime).toMatch(/rate=\d+/);
    expect(payload(got).length).toBeGreaterThan(0);
  });

  /**
   * The clip builder must stay inside the compositor ffmpeg's tiny surface,
   * and this assertion runs EVERYWHERE — including on a bare CI runner with no
   * ffmpeg at all, where the encode test below cannot.
   *
   * That distinction is the whole reason this exists as a separate test. The
   * encoding version depends on a binary that only appears once remotion's own
   * dependencies are installed, which the lint workflow does not do; relying on
   * it alone meant the regression it guards was unguarded in CI. A static
   * assertion cannot prove the mp4 is playable, but it does catch the exact
   * mistake that was made — reaching for a filter this build does not carry.
   */
  it("the clip builder uses no ffmpeg filter, on any machine", () => {
    const src = codeOnly(readFileSync(join(ROOT, "remotion/scripts/storyFixtures.mjs"), "utf8"));
    // findFfmpeg.mjs documents the build: libx264, the mp4/wav muxers, crop,
    // scale, trim, silencedetect. No filter SOURCE, so lavfi cannot generate.
    expect(src).not.toMatch(/lavfi/);
    expect(src).not.toMatch(/filter_complex/);
    // The route that needs no filter: loop one PNG through the image2 demuxer.
    expect(src).toMatch(/'-loop'/);
  });

  it.skipIf(!FFMPEG)(
    "story-clip answers a poll with `data`, base64 of a playable mp4",
    async () => {
      /**
       * The most-bitten assertion in this file, and the only one that shells out.
       *
       * It has failed twice for two different reasons, both silent. First the
       * fixture answered with `video` where the worker reads `data`, so the
       * happy path was dead code. Then it built the mp4 with a lavfi filter
       * source the compositor's cut-down ffmpeg does not have, so every poll
       * threw and every shot "fell back" to its still while the ledger printed
       * successful clip calls. Both times the run finished and looked fine.
       *
       * So this encodes for real, with the same binary the worker finds — and
       * skips only where there is no ffmpeg to find, which is also a machine
       * where no dry run could run either. The filter-surface test above still
       * runs there.
       */
      const clipDir = join(FIXTURES_ROOT, "clip-refused");
      const edge = createFixtureEdge(clipDir, { ffmpeg: FFMPEG });
      await expect(edge("story-clip", { action: "start", seconds: 4 })).rejects.toThrow(/422/);
      const started = await edge("story-clip", { action: "start", seconds: 4 });
      expect(started?.operation).toBeTruthy();

      // `polls: 1` — one pending answer before the real one.
      const pending = await edge("story-clip", {
        action: "poll",
        operation: started?.operation,
      });
      expect(pending?.done).toBe(false);

      const done = await edge("story-clip", { action: "poll", operation: started?.operation });
      expect(done?.done).toBe(true);
      expect(done?.mime).toBe("video/mp4");
      // An mp4's first box is `ftyp`, at offset 4. Cheaper than a probe and it
      // fails on the empty buffer a broken encode would leave behind.
      expect(
        payload(done as FixtureAnswer)
          .subarray(4, 8)
          .toString("latin1"),
      ).toBe("ftyp");
    },
  );

  it("an unhandled function returns null so the seam stays honest", async () => {
    // `null` means "no opinion" and lets the real call through. Nothing in a
    // dry run should reach it, but the contract has to be explicit or the
    // seam would answer for functions it knows nothing about.
    const edge = createFixtureEdge(dir, {});
    expect(await edge("story-sweep", {})).toBeNull();
  });
});

describe("the two voice mime branches produce genuinely different bytes", () => {
  /**
   * `voiceBytesToFile` wraps headerless PCM in a RIFF header and passes a
   * container through untouched. Double-wrapping is the bug worth catching and
   * the nastiest kind: the outer header is still valid, so ffprobe reads the
   * file, the duration is off by under a millisecond, and the only symptom is
   * a click at the top of every line. A run cannot detect it — so the fixture
   * has to actually emit the two shapes, or the gateway-audio scenario proves
   * nothing by rendering successfully.
   */
  const dir = join(FIXTURES_ROOT, "gateway-audio");

  it("a container mime yields bytes that already start with RIFF", async () => {
    const got = await answer(dir, "story-voice", { text: "hello" });
    expect(got.mime).toBe("audio/wav");
    expect(payload(got).subarray(0, 4).toString("latin1")).toBe("RIFF");
  });

  it("a PCM mime yields headerless bytes for the worker to wrap", async () => {
    const got = await answer(join(FIXTURES_ROOT, "happy-path"), "story-voice", { text: "hello" });
    expect(payload(got).subarray(0, 4).toString("latin1")).not.toBe("RIFF");
  });

  it("the worker branches on the mime, and `audio/wav` misses the wrap", () => {
    const line = codeOnly(WORKER).match(/return \/audio\\\/l16\|pcm\/i\.test\([^)]*\)[^;]*;/);
    expect(line).not.toBeNull();
    expect(/audio\/l16|pcm/i.test("audio/wav")).toBe(false);
    expect(/audio\/l16|pcm/i.test("audio/L16;codec=pcm;rate=24000")).toBe(true);
  });
});

describe("scripted failures wear the shape the worker's ladders match", () => {
  /**
   * The subtle one. `edge()` composes its error as `${fn}: ${status} ${json}`
   * and every ladder in the worker matches on that exact shape — the voice
   * fallback tests `/story-voice: 502/`. A fixture that threw a plain
   * `Error('quota')` would be caught by nothing, the job would die, and the
   * scenario would look like it had proved a ladder while proving its absence.
   */
  it("a 502 voice failure reads exactly as story-voice: 502", async () => {
    const edge = createFixtureEdge(join(FIXTURES_ROOT, "voice-quota-dies"), {});
    await expect(edge("story-voice", { text: "x" })).rejects.toThrow(/^story-voice: 502 \{/);
  });

  it("the worker's voice fallback matches that shape", () => {
    expect(codeOnly(WORKER)).toMatch(/\/story-voice: 502\/\.test/);
  });

  it("a 422 still refusal reads exactly as story-still: 422", async () => {
    const edge = createFixtureEdge(join(FIXTURES_ROOT, "still-refused"), {});
    await expect(edge("story-still", { prompt: "x" })).rejects.toThrow(/^story-still: 422 \{/);
  });
});

describe("every shipped scenario is loadable", () => {
  const dirs = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it("there are scenarios to load", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)("%s parses and carries its own job and plan", (name) => {
    const s = loadScenario(join(FIXTURES_ROOT, name));
    expect(s.job.id).toBeTruthy();
    expect(s.plan.shots.length).toBeGreaterThan(0);
  });

  /** The raw file, including the `_`-prefixed keys loadScenario drops. */
  function rawScenario(name: string) {
    return JSON.parse(readFileSync(join(FIXTURES_ROOT, name, "scenario.json"), "utf8")) as {
      _why?: string;
      _expect?: {
        exit?: number;
        calls?: Record<string, number>;
        log?: string[];
        absent?: string[];
        film?: boolean;
        same_film_as?: string;
      };
    };
  }

  it.each(dirs)("%s explains which incident it reproduces", (name) => {
    // A scenario without a _why is a fixture nobody can decide whether to
    // delete. Each of these encodes a run that cost real money to learn.
    expect(rawScenario(name)._why ?? "").not.toHaveLength(0);
  });

  it.each(dirs)("%s declares what a run of it must prove", (name) => {
    /**
     * `scripts/dry_run_all.py` enforces this block; without it the scenario is
     * checked by eye, which is how the clip stage stayed broken through two
     * different defects while printing a finished film both times.
     *
     * `calls` and `film` are required because they are the two things every
     * scenario has an answer for. `absent` is optional but carries the most
     * weight where it appears — voice-quota-dies proves its whole point with
     * one forbidden string, since the property is a call that must not happen
     * and no log line exists for that.
     */
    const expected = rawScenario(name)._expect;
    expect(expected, `${name}/scenario.json has no _expect block`).toBeTruthy();
    expect(typeof expected?.exit).toBe("number");
    expect(typeof expected?.film).toBe("boolean");
    expect(Object.keys(expected?.calls ?? {}).sort()).toEqual(["clip", "plot", "still", "voice"]);
  });

  it.each(dirs)("%s asserts a call count for every billable stage", (name) => {
    // Zero is a real assertion, not a blank: happy-path claims `clip: 0`
    // because a classic grade must never reach the video model. Leaving a
    // stage out would let a scenario silently start spending.
    const calls = rawScenario(name)._expect?.calls ?? {};
    for (const stage of ["still", "voice", "clip", "plot"]) {
      expect(typeof calls[stage], `${name} does not say how many ${stage} calls it makes`).toBe(
        "number",
      );
    }
  });

  it("a scenario compared against another names one that exists", () => {
    for (const name of dirs) {
      const twin = rawScenario(name)._expect?.same_film_as;
      if (twin) expect(dirs).toContain(twin);
    }
  });

  it("rejects a scenario with no plan — story-plot is a paid call", () => {
    expect(() => loadScenario(join(ROOT, "remotion/fixtures"))).toThrow(/no scenario\.json/);
  });
});
