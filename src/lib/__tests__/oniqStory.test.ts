// The story transport — ONIQ's own worker, or nothing.
//
// Owner directive 2026-08-27: a story is written by ONIQ's GPU worker and
// by nothing else. The sharpest tests here are the ones about what a
// COMPLETED job does NOT prove, and the one that reads the worker's real
// contract off disk rather than trusting a copied constant.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_STORY_PROMPT_CHARS,
  MAX_STORY_TOKENS,
  MIN_STORY_TOKENS,
  StoryEngineError,
  generateStoryText,
  storyInvoke,
  verifyStoryOutput,
} from "../../../supabase/functions/_shared/oniqStory.ts";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/_shared/oniqStory.ts"), "utf8");

const GOOD = {
  ok: true,
  op: "story_generate",
  model: "Qwen/Qwen3-8B",
  inference_ms: 4210,
  story_text: '{"title":"The Keeper"}',
  story_chars: '{"title":"The Keeper"}'.length,
};

function rig(states: string[], output: unknown) {
  let poll = 0;
  const deps = {
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ id: "job-1" }) } as unknown as Response;
      }
      const status = states[Math.min(poll++, states.length - 1)];
      return {
        ok: true,
        json: async () => ({ status, output: status === "COMPLETED" ? output : undefined }),
      } as unknown as Response;
    }) as unknown as typeof fetch,
    now: () => 0,
    sleep: async () => {},
  };
  return deps;
}

const ENV = { apiKey: "k", endpointId: "e" };

describe("a COMPLETED job is not a story", () => {
  it("accepts a properly evidenced story", () => {
    const v = verifyStoryOutput(GOOD);
    expect(v.ok).toBe(true);
  });

  it.each([
    ["no output at all", null, /no output/],
    ["a refusal", { ok: false, code: "local-model-unavailable" }, /engine refused/],
    ["the wrong op", { ...GOOD, op: "video_generate" }, /wrong op/],
    ["an empty story", { ...GOOD, story_text: "   ", story_chars: 3 }, /wrote no story/],
    ["no model reported", { ...GOOD, model: "missing" }, /did not report/],
    ["no measurement", { ...GOOD, inference_ms: 0 }, /did not measure/],
  ])("refuses %s", (_label, output, pattern) => {
    const v = verifyStoryOutput(output);
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toMatch(pattern);
  });

  it("refuses text that does not match the length the worker measured", () => {
    // A truncated story is the dangerous case: it PARSES, into a
    // plausible short film, instead of failing.
    const v = verifyStoryOutput({ ...GOOD, story_text: '{"title":"The Ke' });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toMatch(/measured \d+ chars, received \d+/);
  });
});

describe("the transport", () => {
  it("submits, polls past IN_PROGRESS, and returns the text", async () => {
    const out = await generateStoryText(
      "write a story",
      1024,
      ENV,
      rig(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"], GOOD),
    );
    expect(out.text).toBe(GOOD.story_text);
    expect(out.chars).toBe(GOOD.story_chars);
  });

  it("sends no output_key — the worker refuses one on a text op", async () => {
    let body = "";
    const deps = {
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          body = String(init.body);
          return { ok: true, json: async () => ({ id: "j" }) } as unknown as Response;
        }
        return {
          ok: true,
          json: async () => ({ status: "COMPLETED", output: GOOD }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => {},
    };
    await generateStoryText("write a story", 1024, ENV, deps);
    expect(body).not.toContain("output_key");
    expect(JSON.parse(body).input.op).toBe("story_generate");
    expect(JSON.parse(body).input.params.max_tokens).toBe(1024);
  });

  it.each(["FAILED", "CANCELLED", "TIMED_OUT"])("fails on a terminal %s", async (state) => {
    await expect(generateStoryText("write a story", 1024, ENV, rig([state], null))).rejects.toThrow(
      StoryEngineError,
    );
  });

  it("never treats an unknown status as success", async () => {
    // The deadline is what ends this, not a hopeful read of the status.
    let t = 0;
    const deps = {
      ...rig(["SOMETHING_NEW"], null),
      now: () => (t += 100_000),
    };
    await expect(generateStoryText("write a story", 1024, ENV, deps)).rejects.toThrow(
      /took too long/,
    );
  });
});

describe("a prompt the worker would refuse is refused here, unpaid", () => {
  // The worker validates AFTER the job has started, so its refusal costs
  // GPU seconds. This one costs nothing.
  it("refuses an over-long prompt without submitting", async () => {
    let submitted = false;
    const deps = {
      fetchImpl: (async () => {
        submitted = true;
        return { ok: true, json: async () => ({ id: "j" }) } as unknown as Response;
      }) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => {},
    };
    await expect(
      generateStoryText("x".repeat(MAX_STORY_PROMPT_CHARS + 1), 1024, ENV, deps),
    ).rejects.toThrow(/accepts 20000/);
    expect(submitted, "an over-long prompt reached the paid worker").toBe(false);
  });

  it.each([MIN_STORY_TOKENS - 1, MAX_STORY_TOKENS + 1, 1024.5])(
    "refuses max_tokens %s without submitting",
    async (tokens) => {
      let submitted = false;
      const deps = {
        fetchImpl: (async () => {
          submitted = true;
          return { ok: true, json: async () => ({ id: "j" }) } as unknown as Response;
        }) as unknown as typeof fetch,
        now: () => 0,
        sleep: async () => {},
      };
      await expect(generateStoryText("go", tokens, ENV, deps)).rejects.toThrow(/outside 256-8192/);
      expect(submitted).toBe(false);
    },
  );

  it("refuses an empty prompt without submitting", async () => {
    let submitted = false;
    const deps = {
      fetchImpl: (async () => {
        submitted = true;
        return { ok: true, json: async () => ({ id: "j" }) } as unknown as Response;
      }) as unknown as typeof fetch,
      now: () => 0,
      sleep: async () => {},
    };
    await expect(generateStoryText("  ", 1024, ENV, deps)).rejects.toThrow(/empty prompt/);
    expect(submitted).toBe(false);
  });
});

describe("it is the transport and nothing more", () => {
  it("storyInvoke has the shape localStoryModel asks for", async () => {
    const invoke = storyInvoke(ENV, rig(["COMPLETED"], GOOD));
    await expect(invoke("write a story", { maxTokens: 1024 })).resolves.toBe(GOOD.story_text);
  });

  it("does not parse, repair or validate a story", () => {
    // The same split the worker keeps: parsing and validation live in
    // localStoryModel and storyIr, which already own them.
    expect(SRC).not.toContain("JSON.parse");
    expect(SRC).not.toContain("validateStoryIr");
    expect(SRC).not.toContain("repairStoryIr");
  });

  it("names no provider anywhere", () => {
    const flat = SRC.toLowerCase();
    for (const forbidden of ["gemini", "openai", "anthropic", "googleapis", "replicate", "veo"]) {
      expect(flat, forbidden).not.toContain(forbidden);
    }
  });
});
