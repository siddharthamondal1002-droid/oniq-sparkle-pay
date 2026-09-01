/**
 * The gateway image engine — the parts that have already gone wrong once.
 *
 * Every test below is a real failure this module's history recorded, not a
 * hypothetical:
 *
 *   * The first film through the gateway failed with every frame "refused"
 *     while the logs showed perfect PNGs arriving — the reply used the OpenAI
 *     `data[].b64_json` shape and the reader only knew the documented
 *     `choices[].message.images` one.
 *   * A credit exhaustion read as a content refusal, so the worker's ask
 *     ladder rewrote a perfectly good prompt into a blander one and still got
 *     nothing.
 *   * `String.fromCharCode(...bytes)` on a 1.4 MB reference overflows the
 *     stack — a crash that appears only once a real character is used.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GATEWAY_IMAGE_MODEL,
  GATEWAY_IMAGE_URL,
  GatewayError,
  MAX_GATEWAY_ASK_CHARS,
  base64,
  composeAsk,
  drawStillViaGateway,
  firstImage,
  inlineReference,
  referenceMime,
} from "../../../supabase/functions/_shared/gatewayImage";

const PNG_B64 = "iVBORw0KGgoAAAA";
const KEY = { key: "not-a-real-key" };

function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

/** A fetch that answers once and records what it was asked. */
function stubFetch(res: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof res === "function" ? await res() : res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("reading the reply", () => {
  it("finds the image in the live OpenAI shape, which the docs did not describe", async () => {
    const { impl } = stubFetch(respond({ data: [{ b64_json: PNG_B64 }] }));
    const got = await drawStillViaGateway("a lamp", KEY, { fetchImpl: impl });
    expect(got).toEqual({ mime: "image/png", data: PNG_B64 });
  });

  it("still reads the documented shape, so one side changing does not kill a film", () => {
    const found = firstImage({
      choices: [
        { message: { images: [{ image_url: { url: `data:image/webp;base64,${PNG_B64}` } }] } },
      ],
    });
    expect(found).toEqual({ mime: "image/webp", data: PNG_B64 });
  });

  it("sniffs the type from the bytes, because b64_json carries none", () => {
    expect(firstImage({ data: [{ b64_json: "/9j/4AAQ" }] })?.mime).toBe("image/jpeg");
  });

  it("skips an empty pocket rather than returning an empty image", () => {
    expect(firstImage({ data: [{ b64_json: "" }, { b64_json: PNG_B64 }] })?.data).toBe(PNG_B64);
    expect(firstImage({ data: [] })).toBeNull();
  });
});

describe("a failure means one of four different things", () => {
  it("calls a dry credit pool `credits`, retryable, NOT a refusal", async () => {
    // The distinction the ask ladder depends on: rewording the prompt cannot
    // put money back in the pool, and a step-down loses the shot for nothing.
    const { impl } = stubFetch(respond("payment required", 402));
    const err = await drawStillViaGateway("a lamp", KEY, { fetchImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.kind).toBe("credits");
    expect(err.retryable).toBe(true);
  });

  it("calls a 200 with no image part `refused`, and NOT retryable", async () => {
    const { impl } = stubFetch(
      respond({ choices: [{ finish_reason: "SAFETY", message: { content: "no" } }] }),
    );
    const err = await drawStillViaGateway("a lamp", KEY, { fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("refused");
    expect(err.retryable).toBe(false);
    // The WHY travels, so the runner log says which rung to try next.
    expect(err.message).toContain("SAFETY");
  });

  it("calls a rejected credential `unconfigured`, so nobody retries it", async () => {
    const { impl } = stubFetch(respond("nope", 401));
    const err = await drawStillViaGateway("a lamp", KEY, { fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("unconfigured");
    expect(err.retryable).toBe(false);
  });

  it("calls a gateway 500 `upstream`, retryable", async () => {
    const { impl } = stubFetch(respond("boom", 500));
    const err = await drawStillViaGateway("a lamp", KEY, { fetchImpl: impl }).catch((e) => e);
    expect(err.kind).toBe("upstream");
    expect(err.retryable).toBe(true);
  });
});

describe("what goes on the wire", () => {
  it("sends the ask text-only when there is no reference", async () => {
    const { impl, calls } = stubFetch(respond({ data: [{ b64_json: PNG_B64 }] }));
    await drawStillViaGateway("a lamp on a table", KEY, { fetchImpl: impl });
    expect(calls[0].url).toBe(GATEWAY_IMAGE_URL);
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.model).toBe(GATEWAY_IMAGE_MODEL);
    expect(typeof sent.messages[0].content).toBe("string");
    expect(sent.messages[0].content).toContain("a lamp on a table");
  });

  it("goes multimodal only when a reference rode along", async () => {
    const { impl, calls } = stubFetch(respond({ data: [{ b64_json: PNG_B64 }] }));
    await drawStillViaGateway(
      "a lamp",
      KEY,
      { fetchImpl: impl },
      {
        referenceDataUrl: `data:image/png;base64,${PNG_B64}`,
      },
    );
    const sent = JSON.parse(String(calls[0].init.body));
    expect(Array.isArray(sent.messages[0].content)).toBe(true);
    expect(sent.messages[0].content[1].image_url.url).toContain("data:image/png;base64,");
  });

  it("refuses an http(s) reference outright — the model is never asked to crawl", async () => {
    const { impl, calls } = stubFetch(respond({ data: [{ b64_json: PNG_B64 }] }));
    const err = await drawStillViaGateway(
      "a lamp",
      KEY,
      { fetchImpl: impl },
      {
        referenceDataUrl: "https://example.invalid/face.png",
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    // And it failed BEFORE spending anything.
    expect(calls).toHaveLength(0);
  });

  it("carries the negative terms in the ask, since there is no field for them", () => {
    expect(composeAsk("a lamp", "extra fingers")).toContain("Do not include: extra fingers.");
    expect(composeAsk("a lamp", "   ")).not.toContain("Do not include");
    expect(composeAsk("a lamp")).toContain("Vertical 9:16");
  });

  it("takes a longer ask than the GPU contract, because it is a different engine", () => {
    // Holding the worker's 1000 here would demote a drawable 1400-character
    // shot to a blander rung against an engine that would have drawn it.
    expect(MAX_GATEWAY_ASK_CHARS).toBe(2000);
  });
});

describe("the reference, read from ONIQ's own bucket", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

  it("inlines the bytes and joins the base to the key exactly once", async () => {
    const { impl, calls } = stubFetch(
      respond(PNG, 200, { "content-type": "image/png" }) as unknown as Response,
    );
    const got = await inlineReference("https://cdn.example/", "story/ref/canon/x/v1.png", {
      fetchImpl: impl,
    });
    expect(calls[0].url).toBe("https://cdn.example/story/ref/canon/x/v1.png");
    expect("dataUrl" in got && got.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("reports a missing object as unresolved — never as a refusal of the prompt", async () => {
    // Charging a capability gap against the shot's subject is the 2026-08-31
    // bug where a person became an empty landscape.
    const { impl } = stubFetch(respond("gone", 404));
    const got = await inlineReference("https://cdn.example", "k.png", { fetchImpl: impl });
    expect(got).toEqual({ unresolved: "reference-http-404" });
  });

  it("refuses an oversized object on its header, before reading a byte of it", async () => {
    const body = vi.fn();
    const res = {
      ok: true,
      headers: new Headers({ "content-length": String(64 * 1024 * 1024) }),
      arrayBuffer: body,
    } as unknown as Response;
    const { impl } = stubFetch(res);
    const got = await inlineReference("https://cdn.example", "k.png", { fetchImpl: impl });
    expect(got).toEqual({ unresolved: "reference-too-large" });
    expect(body).not.toHaveBeenCalled();
  });

  it("refuses something that is not an image at all, rather than sending it as a png", async () => {
    const { impl } = stubFetch(
      respond(new Uint8Array([1, 2, 3, 4]), 200, {
        "content-type": "text/html",
      }) as unknown as Response,
    );
    const got = await inlineReference("https://cdn.example", "k.png", { fetchImpl: impl });
    expect(got).toEqual({ unresolved: "reference-not-an-image" });
  });

  it("trusts the bytes over a wrong content-type header", () => {
    expect(referenceMime("application/octet-stream", PNG)).toBe("image/png");
    expect(referenceMime(null, new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
  });

  it("base64s a reference-sized buffer without spreading a million arguments", () => {
    // 1.4 MB is the real owner character frame. `fromCharCode(...bytes)` on
    // this overflows the stack; the chunked loop is why it does not.
    const big = new Uint8Array(1_400_000).fill(0x41);
    const out = base64(big);
    expect(out.length).toBeGreaterThan(1_800_000);
    expect(atob(out.slice(0, 8))).toBe("AAAAAA");
  });
});
