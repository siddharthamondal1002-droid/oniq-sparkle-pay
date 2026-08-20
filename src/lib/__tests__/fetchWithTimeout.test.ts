/**
 * P5 — the client fetch deadline. These exercise the real AbortController +
 * timer wiring against a mocked global fetch, so the abort path is proven, not
 * just asserted in source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("aborts a request that never resolves once the timeout elapses", async () => {
    // A fetch that only ever rejects when its signal aborts — i.e. it hangs.
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as typeof fetch;

    await expect(fetchWithTimeout("https://example.test/hang", {}, 20)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("returns the response when fetch resolves before the deadline", async () => {
    const body = new Response("ok", { status: 200 });
    globalThis.fetch = (() => Promise.resolve(body)) as typeof fetch;
    const res = await fetchWithTimeout("https://example.test/fast", {}, 1000);
    expect(res.status).toBe(200);
  });

  it("passes the timeout signal through to fetch", async () => {
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    await fetchWithTimeout("https://example.test/x", {}, 1000);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it("aborts immediately when the caller's signal is already aborted", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
        resolve(new Response(null, { status: 200 }));
      })) as typeof fetch;

    await expect(
      fetchWithTimeout("https://example.test/y", { signal: AbortSignal.abort() }, 1000),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
