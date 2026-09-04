/**
 * The direct-Google call shape, pinned.
 *
 * Owner directive 2026-09-04b moved Image, Voice and text off the Lovable
 * gateway onto generativelanguage.googleapis.com. Everything asserted here is
 * something that has ALREADY gone wrong once on this upstream and cost real
 * debugging: the key belongs in the query string and not a bearer header, the
 * body must be Google's native shape (OpenAI field names come back "Cannot
 * find field"), and a non-2xx carries the only message that distinguishes a
 * dead model id from a refused prompt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  firstInlinePart,
  googleErrorMessage,
  googleGenerateContent,
  googleUsage,
  joinedText,
} from "../../../supabase/functions/_shared/googleDirect.ts";

type Captured = { url: string; init: RequestInit };

function stubFetch(res: { status: number; body: unknown }) {
  const seen: Captured[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve({
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: () => Promise.resolve(res.body),
    } as Response);
  });
  return seen;
}

const bodyOf = (c: Captured) => JSON.parse(String(c.init.body));

afterEach(() => vi.unstubAllGlobals());

describe("googleGenerateContent — the request", () => {
  it("puts the key in the query string, never in a header", async () => {
    // A bearer header is what the GATEWAY takes. This upstream ignores it and
    // answers 403, which reads as "the key is wrong" rather than "the key is
    // in the wrong place" — an hour lost the first time.
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({ model: "m", key: "SECRET", parts: [{ text: "hi" }] });
    expect(seen[0].url).toContain("key=SECRET");
    expect(JSON.stringify(seen[0].init.headers ?? {})).not.toContain("SECRET");
  });

  it("url-encodes the key and the model, so neither can break the query", async () => {
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({ model: "a/b", key: "k&x=1", parts: [{ text: "hi" }] });
    expect(seen[0].url).toContain("models/a%2Fb:generateContent");
    expect(seen[0].url).toContain("key=k%26x%3D1");
    // The smuggled parameter must NOT have become a real one.
    expect(seen[0].url).not.toMatch(/[?&]x=1/);
  });

  it("sends Google's native shape with an explicit role", async () => {
    // `prompt` / `input` / `messages` all return "Unknown name …: Cannot find
    // field" here — measured on the music path.
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({ model: "m", key: "k", parts: [{ text: "hi" }] });
    const b = bodyOf(seen[0]);
    expect(b).toEqual({ contents: [{ role: "user", parts: [{ text: "hi" }] }] });
    expect(b).not.toHaveProperty("prompt");
    expect(b).not.toHaveProperty("messages");
  });

  it("omits generationConfig entirely when there is nothing to say", async () => {
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({ model: "m", key: "k", parts: [{ text: "hi" }] });
    expect(bodyOf(seen[0])).not.toHaveProperty("generationConfig");
  });

  it("carries responseModalities and merges extra config beside it", async () => {
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({
      model: "m",
      key: "k",
      parts: [{ text: "hi" }],
      responseModalities: ["AUDIO"],
      generationConfig: {
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    const cfg = bodyOf(seen[0]).generationConfig;
    expect(cfg.responseModalities).toEqual(["AUDIO"]);
    expect(cfg.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("carries responseMimeType, because asking in the prompt is not enough", async () => {
    // Measured 2026-09-04: told "strict JSON, JSON only" in the prompt,
    // gemini-3.1-flash-lite still fenced it in ```json. The prompt is a
    // request; this field is the setting.
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({
      model: "m",
      key: "k",
      parts: [{ text: "hi" }],
      responseMimeType: "application/json",
    });
    expect(bodyOf(seen[0]).generationConfig.responseMimeType).toBe("application/json");
  });

  it("passes an inline media part through untouched, for a reference image", async () => {
    const seen = stubFetch({ status: 200, body: {} });
    await googleGenerateContent({
      model: "m",
      key: "k",
      parts: [{ inlineData: { mimeType: "image/jpeg", data: "AAAA" } }, { text: "make it green" }],
    });
    expect(bodyOf(seen[0]).contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
      { text: "make it green" },
    ]);
  });

  it("makes exactly ONE call and never retries", async () => {
    // No retry anywhere in this codebase on purpose: a refused prompt is
    // refused identically the second time, and a loop is how a month of
    // budget disappears in an hour.
    const seen = stubFetch({ status: 500, body: { error: { message: "boom" } } });
    await googleGenerateContent({ model: "m", key: "k", parts: [{ text: "hi" }] });
    expect(seen).toHaveLength(1);
  });
});

describe("googleGenerateContent — the response", () => {
  it("reads the error message out of a non-2xx instead of dropping it", async () => {
    stubFetch({
      status: 404,
      body: { error: { code: 404, message: "models/nope is not found", status: "NOT_FOUND" } },
    });
    const r = await googleGenerateContent({ model: "nope", key: "k", parts: [{ text: "hi" }] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.errorMessage).toBe("models/nope is not found");
    expect(r.data).toBeNull();
  });

  it("survives a body that is not JSON at all", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("html")),
      } as unknown as Response),
    );
    const r = await googleGenerateContent({ model: "m", key: "k", parts: [{ text: "hi" }] });
    expect(r.status).toBe(502);
    expect(r.errorMessage).toBeNull();
  });

  it("reports a timeout and a network failure apart", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", () => Promise.reject(abort));
    expect((await googleGenerateContent({ model: "m", key: "k", parts: [] })).transport).toBe(
      "timeout",
    );
    vi.stubGlobal("fetch", () => Promise.reject(new Error("dns")));
    const net = await googleGenerateContent({ model: "m", key: "k", parts: [] });
    expect(net.transport).toBe("network");
    expect(net.status).toBe(0);
  });
});

describe("reading the parts back", () => {
  const reply = (parts: unknown[]) => ({ candidates: [{ content: { parts } }] });

  it("finds inline media by mime prefix and keeps the mime verbatim", () => {
    // The rate in an audio mime is what a WAV wrap needs; normalising it away
    // produces a file that plays at the wrong speed.
    const data = reply([
      { text: "here you go" },
      { inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "QUJD" } },
    ]);
    expect(firstInlinePart(data, "audio/")).toEqual({
      mime: "audio/L16;codec=pcm;rate=24000",
      data: "QUJD",
    });
  });

  it("does not hand an audio part to a caller asking for an image", () => {
    const data = reply([{ inlineData: { mimeType: "audio/mpeg", data: "QUJD" } }]);
    expect(firstInlinePart(data, "image/")).toBeNull();
  });

  it("skips an inline part with no data rather than returning an empty file", () => {
    const data = reply([
      { inlineData: { mimeType: "image/png", data: "" } },
      { inlineData: { mimeType: "image/png", data: "REAL" } },
    ]);
    expect(firstInlinePart(data, "image/")?.data).toBe("REAL");
  });

  it("returns null for a refusal, an empty reply and a malformed one alike", () => {
    for (const d of [null, undefined, {}, { candidates: [] }, { candidates: [{}] }, "nope"]) {
      expect(firstInlinePart(d, "image/")).toBeNull();
      expect(joinedText(d)).toBe("");
    }
  });

  it("joins every text part, because a long answer arrives split", () => {
    expect(joinedText(reply([{ text: "one " }, { text: "two" }]))).toBe("one two");
  });

  it("ignores non-string text without throwing", () => {
    expect(joinedText(reply([{ text: 7 }, { text: "ok" }]))).toBe("ok");
  });
});

describe("usage, for provenance only", () => {
  it("reads the plain counts", () => {
    expect(
      googleUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 950 } }),
    ).toEqual({ inputTokens: 10, outputTokens: 950 });
  });

  it("prefers the total-minus-prompt when candidates undercounts", () => {
    // Audio and image replies bill tokens that candidatesTokenCount omits;
    // the total is the only complete figure on those.
    expect(
      googleUsage({
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 960 },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 950 });
  });

  it("is null when the reply carried no usage at all", () => {
    expect(googleUsage({})).toBeNull();
    expect(googleUsage(null)).toBeNull();
  });
});

describe("googleErrorMessage", () => {
  it("returns null rather than an empty string for a body with no error", () => {
    expect(googleErrorMessage({})).toBeNull();
    expect(googleErrorMessage({ error: {} })).toBeNull();
    expect(googleErrorMessage({ error: { message: "" } })).toBeNull();
  });
});
