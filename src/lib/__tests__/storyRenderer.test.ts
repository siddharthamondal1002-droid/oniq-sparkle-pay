/**
 * Routing is cheap to get wrong in an expensive direction.
 *
 * Sending an edge-capable job to CI costs a minute of someone's patience.
 * Sending an oversized job to edge costs a failure AFTER every clip has been
 * generated and billed. The tests below pin that asymmetry, and pin the
 * fallback to one direction so a doomed job cannot ping-pong between backends.
 */
import { describe, expect, it } from "vitest";
import {
  EDGE_MAX_BYTES,
  EDGE_MAX_SECONDS,
  STORY_BITRATE_BPS,
  chooseRenderer,
  estimateBytes,
  fallbackAfter,
  isRetryable,
} from "@/lib/storyRenderer";
import { DEFAULT_STORY_SECONDS, MAX_STORY_SECONDS } from "@/lib/storyPlan";

describe("chooseRenderer keeps the common case off CI", () => {
  it("sends the default minute to the edge function", () => {
    // If the default Story does not fit on the fast path, the fast path is
    // pointless — every user would wait on a runner.
    const r = chooseRenderer(DEFAULT_STORY_SECONDS);
    expect(r.target).toBe("edge");
  });

  it("keeps everything up to the derived ceiling on edge", () => {
    for (let s = 10; s <= EDGE_MAX_SECONDS; s += 5) {
      expect(chooseRenderer(s).target, `${s}s`).toBe("edge");
    }
  });

  it("routes the longest allowed Story to CI", () => {
    // MAX_STORY_SECONDS is ten minutes, far past what WASM ffmpeg can hold.
    // If this ever says edge, the ceiling has drifted above what is safe.
    expect(chooseRenderer(MAX_STORY_SECONDS).target).toBe("ci");
  });

  it("switches exactly at the byte ceiling, not near it", () => {
    const justUnder = Math.floor(EDGE_MAX_BYTES / (STORY_BITRATE_BPS / 8));
    expect(chooseRenderer(justUnder).target).toBe("edge");
    expect(chooseRenderer(justUnder + 1).target).toBe("ci");
  });

  it("explains itself in the reason, with the numbers in it", () => {
    const r = chooseRenderer(MAX_STORY_SECONDS);
    expect(r.reason).toMatch(/MB/);
    expect(r.reason).toMatch(/edge function can hold/);
  });

  it("honours an operational override in both directions", () => {
    // Pinning to CI is how the product survives a broken edge function;
    // pinning to edge is how you test one. Neither is a user-facing setting.
    expect(chooseRenderer(30, { forceTarget: "ci" }).target).toBe("ci");
    expect(chooseRenderer(MAX_STORY_SECONDS, { forceTarget: "edge" }).target).toBe("edge");
    expect(chooseRenderer(30, { forceTarget: "ci" }).reason).toMatch(/forced/);
  });

  it("respects a lowered cap, so the ceiling can be tightened without a deploy", () => {
    expect(chooseRenderer(30, { edgeMaxBytes: 1024 }).target).toBe("ci");
  });

  it("estimates bytes from the measured bitrate", () => {
    expect(estimateBytes(60)).toBe(60 * (STORY_BITRATE_BPS / 8));
  });

  it("rejects a duration that is not one", () => {
    expect(() => chooseRenderer(0)).toThrow(/not a duration/);
    expect(() => chooseRenderer(-5)).toThrow(/not a duration/);
    expect(() => chooseRenderer(NaN)).toThrow(/not a duration/);
  });
});

describe("fallback goes one way only", () => {
  it("lets edge fall back to CI", () => {
    expect(fallbackAfter("edge")).toBe("ci");
  });

  it("does NOT let CI fall back to edge", () => {
    // CI failing on a job edge already declined means edge is certain to fail
    // too. Retrying there turns one failure into two, slowly.
    expect(fallbackAfter("ci")).toBeNull();
  });

  it("terminates — no route can cycle", () => {
    let at: "edge" | "ci" | null = "edge";
    const seen: string[] = [];
    while (at) {
      expect(seen).not.toContain(at);
      seen.push(at);
      at = fallbackAfter(at);
    }
    expect(seen).toEqual(["edge", "ci"]);
  });
});

describe("only the failures another backend could survive are retried", () => {
  it("retries a timeout or an out-of-memory", () => {
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("oom")).toBe(true);
  });

  it("does not retry a malformed input", () => {
    // Every backend fails the same way on bad input. Retrying spends CI
    // minutes to reach the identical answer.
    expect(isRetryable("bad-input")).toBe(false);
  });

  it("does not retry an unknown failure", () => {
    // Defaulting unknown to retryable is how a broken job becomes a loop.
    expect(isRetryable("unknown")).toBe(false);
  });
});
