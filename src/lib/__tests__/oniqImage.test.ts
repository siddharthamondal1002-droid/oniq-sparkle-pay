// ONIQ's own image engine, from the application's side — pinned.
//
// Owner directive 2026-08-27 (fully in-house generation). The engine
// client is pure and injectable, so the WHOLE path — submit, poll,
// evidence, artifact, bytes — is exercised here rather than only in
// production. What must hold: it talks to ONIQ's endpoint, it refuses an
// unproven or wrong artifact, and it never reaches for a cloud provider
// when it fails.
import { describe, expect, it, vi } from "vitest";
import {
  EngineError,
  STILL_MIME,
  generateStill,
  looksLikePng,
  stillKeyFor,
  verifyStillOutput,
} from "../../../supabase/functions/_shared/oniqImage.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const ENV = { apiKey: "k", endpointId: "ep-1", publicBase: "https://r2.example/" };

function goodOutput(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    op: "image_generate",
    format: "png",
    output_bytes: PNG.byteLength,
    model: "Lightricks/LTX-Video#distilled",
    model_load_ms: 13000,
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

function transport(
  statuses: { status: string; output?: unknown }[],
  artifact: Uint8Array | null = PNG,
) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith("/run")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "job-1" }),
        _body: init?.body,
      } as unknown as Response;
    }
    if (String(url).includes("/status/")) {
      const next = statuses.shift()!;
      return { ok: true, status: 200, json: async () => next } as unknown as Response;
    }
    if (!artifact) return { ok: false, status: 404 } as unknown as Response;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => artifact.buffer.slice(0),
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls, raw: impl };
}

describe("the still comes from ONIQ's own endpoint", () => {
  it("submits image_generate with the prompt and nothing else", async () => {
    const t = transport([{ status: "COMPLETED", output: goodOutput() }]);
    const out = await generateStill("a lantern", ENV, deps(t.impl));

    const body = JSON.parse(String(t.raw.mock.calls[0][1]!.body));
    expect(body.input.op).toBe("image_generate");
    expect(body.input.params).toEqual({ prompt: "a lantern" });
    expect(body.input.input_key).toBeUndefined(); // text-only by contract
    expect(body.input.output_key).toBe(stillKeyFor("id-1"));
    expect(t.calls[0]).toContain("api.runpod.ai/v2/ep-1/run");
    expect(out.mime).toBe(STILL_MIME);
    expect(out.bytes).toBe(PNG.byteLength);
  });

  it("no external image provider is reachable from this module", async () => {
    const t = transport([{ status: "COMPLETED", output: goodOutput() }]);
    await generateStill("a lantern", ENV, deps(t.impl));
    for (const url of t.calls) {
      expect(url).not.toMatch(/googleapis|generativelanguage|gemini|lovable|openai/i);
    }
  });

  it("waits through queued and running states", async () => {
    const t = transport([
      { status: "IN_QUEUE" },
      { status: "IN_PROGRESS" },
      { status: "COMPLETED", output: goodOutput() },
    ]);
    await expect(generateStill("x", ENV, deps(t.impl))).resolves.toBeTruthy();
  });
});

describe("an unproven still is never returned", () => {
  it("COMPLETED alone is not success", () => {
    expect(verifyStillOutput(goodOutput()).ok).toBe(true);
    for (const [over, why] of [
      [{ ok: false, code: "invalid-input" }, /refused/],
      [{ op: "video_generate" }, /wrong op/],
      [{ format: "jpeg" }, /wrong format/],
      [{ output_bytes: 0 }, /no still/],
      [{ model: "missing" }, /model/],
      [{ inference_ms: 0 }, /inference/],
    ] as const) {
      const v = verifyStillOutput(goodOutput(over));
      expect(v.ok).toBe(false);
      if (v.ok === false) expect(v.reason).toMatch(why);
    }
    expect(verifyStillOutput(null).ok).toBe(false);
  });

  it("a terminal provider failure throws, it does not fall back", async () => {
    const t = transport([{ status: "FAILED" }]);
    await expect(generateStill("x", ENV, deps(t.impl))).rejects.toThrow(EngineError);
  });

  it("bytes that disagree with the engine's own measurement are refused", async () => {
    const short = new Uint8Array(PNG.slice(0, 9));
    const t = transport([{ status: "COMPLETED", output: goodOutput() }], short);
    await expect(generateStill("x", ENV, deps(t.impl))).rejects.toThrow(/bytes/);
  });

  it("a 200 that is not a png is refused", async () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const t = transport([{ status: "COMPLETED", output: goodOutput() }], notPng);
    await expect(generateStill("x", ENV, deps(t.impl))).rejects.toThrow(/not a png/);
    expect(looksLikePng(PNG)).toBe(true);
    expect(looksLikePng(notPng)).toBe(false);
  });

  it("a still that never finishes stops at the deadline", async () => {
    const t = transport(Array.from({ length: 500 }, () => ({ status: "IN_QUEUE" })));
    await expect(generateStill("x", ENV, deps(t.impl), { deadlineMs: 5_000 })).rejects.toThrow(
      /too long/,
    );
  });
});
