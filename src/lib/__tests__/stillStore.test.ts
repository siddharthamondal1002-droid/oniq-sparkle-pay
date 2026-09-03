/**
 * Where a still lands, whoever drew it — the gateway problem, closed.
 *
 * In-house motion does not take a frame. It re-derives the still's BUCKET KEY
 * and animates whatever object is there. A gateway still was bytes and nothing
 * else, so `key` came back null and every clip in a movie-grade film refused:
 * job 64874747, nine shots, nine refusals, zero motion. The key belongs to the
 * SHOT (inHouseMotion's stillIdFor), never to the engine, so the fix is for the
 * gateway to write the same key the GPU would have.
 *
 * These pin the parts that are cheap to get wrong and expensive to discover:
 * what gets uploaded, what happens when it cannot be, and the fact that a
 * storage problem never costs a drawn frame.
 */
import { describe, expect, it, vi } from "vitest";

import {
  STILL_BUCKET,
  bytesOfBase64,
  isPng,
  readStillStoreEnv,
  storeStill,
} from "../../../supabase/functions/_shared/stillStore";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** A signed client that records every request instead of making one. */
function fakeStore(responses: Response[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const r2 = {
    fetch: vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: String(init.method ?? "GET"), body: init.body });
      return responses.shift() ?? new Response(null, { status: 500 });
    }),
  };
  return { store: { r2, endpoint: "https://acct.r2.cloudflarestorage.com" } as never, calls };
}

const headOf = (n: number) =>
  new Response(null, { status: 200, headers: { "content-length": String(n) } });

describe("a stored still lands where the motion stage looks", () => {
  it("PUTs to the derived key in the worker's own bucket, then reads it back", async () => {
    const { store, calls } = fakeStore([
      new Response(null, { status: 200 }),
      headOf(PNG.byteLength),
    ]);
    const got = await storeStill("story/still/job-scene-shot.png", PNG, store);

    expect(got).toEqual({
      stored: true,
      key: "story/still/job-scene-shot.png",
      bytes: PNG.byteLength,
    });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(
      `https://acct.r2.cloudflarestorage.com/${STILL_BUCKET}/story/still/job-scene-shot.png`,
    );
    // The destination is verified, not the status code — a 200 says the
    // request was accepted, not that a later download finds the right object.
    expect(calls[1].method).toBe("HEAD");
  });

  it("uploads an exact ArrayBuffer, never a window onto a larger one", async () => {
    // A Uint8Array may be a VIEW. Handing `.buffer` over would upload the whole
    // backing store — the still plus whatever shares it.
    const backing = new Uint8Array(64).fill(0xaa);
    backing.set(PNG, 8);
    const view = backing.subarray(8, 8 + PNG.byteLength);
    const { store, calls } = fakeStore([
      new Response(null, { status: 200 }),
      headOf(view.byteLength),
    ]);

    await storeStill("k.png", view, store);
    const body = calls[0].body;
    // IT MUST BE AN ArrayBuffer, not the view. Checking byteLength alone does
    // not distinguish them — a 12-byte view and a 12-byte buffer both report
    // 12, which is why the first version of this test passed even when the raw
    // view was uploaded. The view's BACKING STORE is 64 bytes, and that is what
    // would have gone over the wire.
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect((body as ArrayBuffer).byteLength).toBe(PNG.byteLength);
    expect(new Uint8Array(body as ArrayBuffer)).toEqual(PNG);
    expect(view.buffer.byteLength).toBe(64);
  });
});

describe("storage never costs a drawn frame", () => {
  it("reports a refused write instead of throwing", async () => {
    const { store } = fakeStore([new Response("nope", { status: 403 })]);
    const got = await storeStill("k.png", PNG, store);
    expect(got.stored).toBe(false);
    // The likeliest cause is named so an operator does not have to guess.
    expect("reason" in got && got.reason).toContain("403");
    expect("reason" in got && got.reason).toContain(STILL_BUCKET);
  });

  it("reports a write the destination did not actually keep", async () => {
    // 200 on the PUT, wrong length on the read-back: the object a later
    // download would find is not the one we meant to write.
    const { store } = fakeStore([new Response(null, { status: 200 }), headOf(3)]);
    const got = await storeStill("k.png", PNG, store);
    expect(got.stored).toBe(false);
    expect("reason" in got && got.reason).toContain("unverified");
  });

  it("survives an unreachable store", async () => {
    const store = {
      r2: {
        fetch: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
      endpoint: "https://x",
    } as never;
    const got = await storeStill("k.png", PNG, store);
    expect(got.stored).toBe(false);
    expect("reason" in got && got.reason).toContain("unreachable");
  });

  it("refuses a non-PNG BEFORE spending a request", async () => {
    // stillKeyFor names every still .png because the GPU only made those.
    // Storing JPEG bytes under it would hand the worker's contract an input it
    // may refuse — after claiming a GPU job, which is the expensive place.
    const { store, calls } = fakeStore([]);
    const got = await storeStill("k.png", JPEG, store);
    expect(got).toEqual({ stored: false, reason: "still-not-png" });
    expect(calls).toHaveLength(0);
    expect(isPng(JPEG)).toBe(false);
    expect(isPng(PNG)).toBe(true);
  });
});

describe("configuration is reported by NAME, never by value", () => {
  it("names what is missing", () => {
    const got = readStillStoreEnv(() => undefined);
    expect("missing" in got && got.missing).toEqual([
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_ACCOUNT_ID (or R2_S3_ENDPOINT)",
    ]);
  });

  it("derives the endpoint from the account when one is not given", () => {
    const env: Record<string, string> = {
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_ACCOUNT_ID: "acct123",
    };
    const got = readStillStoreEnv((k) => env[k]);
    expect("endpoint" in got && got.endpoint).toBe("https://acct123.r2.cloudflarestorage.com");
  });

  it("keeps the credential out of every reply story-still can send", () => {
    // readStillStoreEnv necessarily HOLDS the secret — it has to, to build a
    // signing client. The rule it must not break is that the value never
    // travels outward, so the check belongs at the boundary: the handler may
    // report which NAMES are missing and nothing else.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const SRC = readFileSync(
      join(process.cwd(), "supabase/functions/story-still/index.ts"),
      "utf8",
    );
    expect(SRC).toContain("store.missing.join(");
    for (const leak of ["secretAccessKey", "accessKeyId", "R2_SECRET"]) {
      expect(SRC, leak).not.toContain(leak);
    }
  });
});

describe("base64 to bytes", () => {
  it("round-trips a PNG header exactly", () => {
    const b64 = btoa(String.fromCharCode(...PNG));
    expect(bytesOfBase64(b64)).toEqual(PNG);
    expect(isPng(bytesOfBase64(b64))).toBe(true);
  });
});

describe("a refused write carries R2's own error code, not only the status", () => {
  it("names AccessDenied from the XML body beside the 403 and keeps the bucket hint", async () => {
    // MEASURED 2026-09-03: three films answered `still-store-403` and the
    // operator rotated a token; the code would have said which of the three
    // 403s it was. The body is read, bounded, and the code rides beside the
    // status; the bucket hint stays because it is still the likeliest cause.
    const xml =
      '<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
    const { store } = fakeStore([new Response(xml, { status: 403 })]);
    const got = await storeStill("story/still/x.png", PNG, store);
    expect(got.stored).toBe(false);
    const reason = "reason" in got ? got.reason : "";
    expect(reason).toContain("still-store-403");
    expect(reason).toContain("AccessDenied");
    expect(reason).toContain("Access Denied");
    expect(reason).toContain(STILL_BUCKET);
  });

  it("tells a bad signature from a scope refusal", async () => {
    const xml =
      "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>";
    const { store } = fakeStore([new Response(xml, { status: 403 })]);
    const got = await storeStill("story/still/x.png", PNG, store);
    expect("reason" in got && got.reason).toContain("SignatureDoesNotMatch");
  });

  it("stands on the status alone when the body is not an S3 error document", async () => {
    const { store } = fakeStore([new Response("nope", { status: 500 })]);
    const got = await storeStill("story/still/x.png", PNG, store);
    expect("reason" in got && got.reason).toBe("still-store-500");
  });
});
