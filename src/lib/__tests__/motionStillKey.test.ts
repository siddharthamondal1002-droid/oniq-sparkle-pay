/**
 * THE MOTION STAGE MUST NAME A STILL THAT EXISTS.
 *
 * MEASURED 2026-08-29, reading the LTX path end to end before spending a GPU
 * second on it — the first time anything had, because story-motion had only
 * just been deployed and had never run.
 *
 * story-still drew every frame to `story/still/<crypto.randomUUID()>.png` and
 * returned only the base64 BYTES. The uuid was generated inside generateStill,
 * used once, and discarded: not returned, not stored, not logged.
 *
 * story-motion deliberately accepts NO key — a bucket path must never travel
 * from a caller — and instead DERIVES its input_key from identifiers:
 * `story/still/<jobId>-<sceneId>-<shotId>.png`.
 *
 * A uuid and a derived id are never the same string. So every video_generate
 * job would have named an object that is not in the bucket, and the worker's
 * `storage.download(input_key, ...)` (handler.py) refuses before videogen.run
 * is reached. Not "LTX produced weak motion" — LTX would never have been asked
 * to sample a frame, once per shot, on every film, at the price of a GPU job
 * each time.
 *
 * This is the fourth blocker in a row on this path that was invisible until
 * the one in front of it was cleared: motion_mode, then the still engine's
 * silence, then the 1000-character contract mismatch, then story-motion never
 * being deployed. Each was found by a film dying. This one was found by
 * reading, and these tests are what make it stay found.
 *
 * THE RULE: the key story-still WRITES and the key story-motion READS are one
 * derivation, exercised here against the real functions rather than compared
 * by eye.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  generateStill,
  stillKeyFor as keyForId,
} from "../../../supabase/functions/_shared/oniqImage.ts";
import { stillIdFor, stillKeyFor } from "../../../supabase/functions/_shared/inHouseMotion.ts";

const ROOT = process.cwd();
const stillFn = readFileSync(join(ROOT, "supabase/functions/story-still/index.ts"), "utf8");
const motionFn = readFileSync(join(ROOT, "supabase/functions/story-motion/index.ts"), "utf8");
const worker = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");

const JOB = "1481d262-a79f-40f9-89d4-9aac6b891bf0";

/** A worker that reports one good still, so only the KEY is under test. */
function fakeEngine() {
  const asked: string[] = [];
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/run")) {
      asked.push(JSON.parse(String(init?.body)).input.output_key);
      return new Response(JSON.stringify({ id: "gpu-1" }), { status: 200 });
    }
    if (u.includes("/status/")) {
      return new Response(
        JSON.stringify({
          status: "COMPLETED",
          output: {
            ok: true,
            op: "image_generate",
            format: "png",
            output_bytes: png.byteLength,
            model: "LTX_VIDEO_2B",
            inference_ms: 900,
          },
        }),
        { status: 200 },
      );
    }
    asked.push(`GET ${u}`);
    return new Response(png, { status: 200 });
  });
  return { fetchImpl, asked };
}

const ENV = { apiKey: "k", endpointId: "e", publicBase: "https://cdn.example" };

describe("one derivation, both ends", () => {
  it("the still is written exactly where the motion stage will look for it", async () => {
    const { fetchImpl, asked } = fakeEngine();
    // What story-still now does: derive the id from the job's identifiers.
    const id = stillIdFor(JOB, "s", "shot000");
    await generateStill(
      "a frame",
      ENV,
      { fetchImpl: fetchImpl as never, now: () => 0, sleep: async () => {}, newId: () => "RANDOM" },
      { id },
    );
    // What story-motion sends as input_key, from the same three identifiers.
    const inputKey = stillKeyFor(JOB, "s", "shot000");
    expect(asked[0]).toBe(inputKey);
    expect(asked[0]).toBe("story/still/1481d262-a79f-40f9-89d4-9aac6b891bf0-s-shot000.png");
    // And the artifact is fetched back from that same key, not another.
    expect(asked[1]).toBe(`GET ${ENV.publicBase}/${inputKey}`);
  });

  it("without an id the key is random — the old behaviour, still available", async () => {
    const { fetchImpl, asked } = fakeEngine();
    await generateStill("a frame", ENV, {
      fetchImpl: fetchImpl as never,
      now: () => 0,
      sleep: async () => {},
      newId: () => "RANDOM",
    });
    expect(asked[0]).toBe("story/still/RANDOM.png");
    expect(asked[0]).not.toBe(stillKeyFor(JOB, "s", "shot000"));
  });

  it("the two key functions are one function, not two that agree today", () => {
    expect(stillKeyFor(JOB, "s", "shot000")).toBe(keyForId(stillIdFor(JOB, "s", "shot000")));
  });

  it("different shots of one film never share a still", () => {
    const keys = ["shot000", "shot001", "shot002"].map((s) => stillKeyFor(JOB, "s", s));
    expect(new Set(keys).size).toBe(3);
  });

  it("a film cannot name another film's still", () => {
    expect(stillKeyFor(JOB, "s", "shot000")).not.toBe(stillKeyFor("other-job", "s", "shot000"));
    // The identifiers cannot express a traversal or a new path level.
    expect(() => stillIdFor(JOB, "..", "shot000")).toThrow();
    expect(() => stillIdFor(JOB, "s", "a/b")).toThrow();
    expect(() => stillIdFor("../../etc", "s", "shot000")).toThrow();
  });
});

describe("the wiring that makes those identifiers arrive", () => {
  it("story-still derives the id, and takes the job from the TOKEN not the body", () => {
    expect(stillFn).toContain("stillIdFor");
    // The job id is the verified caller's, never a body field.
    expect(stillFn).toMatch(/stillIdFor\(\s*auth\.jobId/);
    expect(stillFn).not.toMatch(/body\?*\.?\[?["']?jobId/);
  });

  it("story-motion still accepts no key at all — the fence is unchanged", () => {
    // The whole security property: there is no parameter for a bucket path.
    expect(motionFn).not.toMatch(/body\?\.(input_?[Kk]ey|stillKey|key)\b/);
    expect(motionFn).toContain("stillKeyFor(verified.jobId");
  });

  it("the runner sends the identifiers, split by the SAME function the clip stage uses", () => {
    expect(worker).toMatch(/const \[stillSceneId, stillShotId\] = splitShotId\(/);
    expect(worker).toMatch(/sceneId: stillSceneId/);
    expect(worker).toMatch(/shotId: stillShotId/);
    // Both call sites derive from `${job.id}:${stem}` rather than from two
    // separately-maintained strings.
    expect(worker).toMatch(/splitShotId\(`\$\{job\.id\}:\$\{stem\}`\)/);
    expect(worker).toMatch(/generateClip\([^)]*`\$\{job\.id\}:\$\{stem\}`/);
  });

  it("the still's key comes back so a failed animation is diagnosable", () => {
    expect(stillFn).toMatch(/key: still\.key/);
  });
});
