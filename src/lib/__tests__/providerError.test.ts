import { describe, expect, it, beforeEach } from "vitest";
import {
  DEGRADE_AFTER,
  DEFAULT_QUOTA_COOLDOWN_S,
  _resetBreakers,
  breakerState,
  classifyProviderError,
  parseRetryAfter,
  recordFailure,
  recordSuccess,
  shouldSkipProvider,
} from "../../../supabase/functions/_shared/providerError.ts";

/** The exact body Google returned on 2026-08-24 when the daily Veo quota went. */
const QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota, please check your plan and billing details. " +
      "For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
    status: "RESOURCE_EXHAUSTED",
  },
});

const RPM_BODY = JSON.stringify({
  error: {
    code: 429,
    message: "Quota exceeded: 10 requests per minute",
    status: "RESOURCE_EXHAUSTED",
  },
});

describe("classifyProviderError", () => {
  it("classifies the real daily-quota body as QUOTA_EXHAUSTED and NOT retryable", () => {
    const c = classifyProviderError(429, QUOTA_BODY);
    expect(c.kind).toBe("PROVIDER_QUOTA_EXHAUSTED");
    // This is the whole point of the module: a daily wall must not be retried.
    expect(c.retryable).toBe(false);
  });

  it("separates a per-minute rate limit from a daily quota", () => {
    const c = classifyProviderError(429, RPM_BODY);
    expect(c.kind).toBe("PROVIDER_RATE_LIMITED");
    expect(c.retryable).toBe(true);
    expect(c.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never leaks provider internals into the user-facing message", () => {
    for (const [status, body] of [
      [429, QUOTA_BODY],
      [401, "bad key sk-abc"],
      [500, "upstream exploded"],
      [400, "invalid arg"],
      [404, "no such model"],
    ] as const) {
      const c = classifyProviderError(status, body);
      expect(c.userMessage).not.toContain("quota");
      expect(c.userMessage).not.toContain("sk-");
      expect(c.userMessage).not.toContain("RESOURCE_EXHAUSTED");
    }
  });

  it("maps the remaining statuses to distinct kinds", () => {
    expect(classifyProviderError(401, "").kind).toBe("AUTH_FAILED");
    expect(classifyProviderError(403, "").kind).toBe("AUTH_FAILED");
    expect(classifyProviderError(404, "").kind).toBe("MODEL_UNAVAILABLE");
    expect(classifyProviderError(400, "bad").kind).toBe("INVALID_REQUEST");
    expect(classifyProviderError(400, "safety filtered").kind).toBe("CONTENT_FILTERED");
    expect(classifyProviderError(408, "").kind).toBe("TIMEOUT");
    expect(classifyProviderError(503, "").kind).toBe("NETWORK_FAILURE");
    expect(classifyProviderError(418, "").kind).toBe("UNKNOWN");
  });

  it("only marks transient classes retryable", () => {
    const retryable = [408, 500, 502, 503, 504];
    const terminal = [400, 401, 403, 404];
    for (const s of retryable) expect(classifyProviderError(s, "").retryable).toBe(true);
    for (const s of terminal) expect(classifyProviderError(s, "").retryable).toBe(false);
  });

  it("truncates the logged detail", () => {
    expect(classifyProviderError(500, "x".repeat(5000)).detail.length).toBe(300);
  });
});

describe("parseRetryAfter", () => {
  it("reads a seconds value", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "42" }))).toBe(42);
  });

  it("reads an HTTP-date value", () => {
    // BOTH clock readings are fixed. Previously the test took one reading and
    // let the parser take the other, so the assertion window (50 < got <= 61)
    // was really a 10-second budget for everything in between — a load
    // measurement wearing an assertion's clothes. Now it is exact.
    const now = Date.UTC(2026, 7, 24, 12, 0, 0);
    const when = new Date(now + 60_000).toUTCString();
    expect(parseRetryAfter(new Headers({ "retry-after": when }), now)).toBe(60);
  });

  it("does not go negative on a Retry-After that has already passed", () => {
    const now = Date.UTC(2026, 7, 24, 12, 0, 0);
    const past = new Date(now - 60_000).toUTCString();
    expect(parseRetryAfter(new Headers({ "retry-after": past }), now)).toBe(0);
  });

  it("still defaults to the real clock when no reading is injected", () => {
    // The production callers pass no `now`, so the default must stay live.
    const when = new Date(Date.now() + 60_000).toUTCString();
    const got = parseRetryAfter(new Headers({ "retry-after": when }));
    expect(got).not.toBeNull();
    expect(got).toBeGreaterThan(0);
  });

  it("returns null rather than guessing when absent or unparseable", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(new Headers())).toBeNull();
    expect(parseRetryAfter(new Headers({ "retry-after": "soon" }))).toBeNull();
  });

  it("honours the provider's Retry-After over the default", () => {
    const c = classifyProviderError(429, RPM_BODY, new Headers({ "retry-after": "7" }));
    expect(c.retryAfterSeconds).toBe(7);
  });
});

describe("quota circuit breaker", () => {
  beforeEach(() => _resetBreakers());

  it("starts HEALTHY and does not skip", () => {
    expect(breakerState("veo")).toBe("HEALTHY");
    expect(shouldSkipProvider("veo")).toBe(false);
  });

  it("opens straight to QUOTA_EXHAUSTED on a daily quota", () => {
    recordFailure("veo", classifyProviderError(429, QUOTA_BODY));
    expect(breakerState("veo")).toBe("QUOTA_EXHAUSTED");
    // The behaviour that would have prevented 18 wasted submits.
    expect(shouldSkipProvider("veo")).toBe(true);
  });

  it("degrades before opening on repeated rate limits", () => {
    const c = classifyProviderError(429, RPM_BODY);
    expect(recordFailure("veo", c)).toBe("DEGRADED");
    for (let i = 1; i < DEGRADE_AFTER; i++) recordFailure("veo", c);
    expect(breakerState("veo")).toBe("QUOTA_EXHAUSTED");
  });

  it("reopens after the cooldown elapses", () => {
    const now = Date.now();
    recordFailure("veo", classifyProviderError(429, QUOTA_BODY), now);
    expect(breakerState("veo", now + 1000)).toBe("QUOTA_EXHAUSTED");
    expect(breakerState("veo", now + DEFAULT_QUOTA_COOLDOWN_S * 1000 + 1)).toBe("HEALTHY");
  });

  it("uses the provider's Retry-After as the cooldown when given", () => {
    const now = Date.now();
    const c = classifyProviderError(429, QUOTA_BODY, new Headers({ "retry-after": "5" }));
    recordFailure("veo", c, now);
    expect(breakerState("veo", now + 6000)).toBe("HEALTHY");
  });

  it("keeps providers independent", () => {
    recordFailure("veo", classifyProviderError(429, QUOTA_BODY));
    expect(shouldSkipProvider("veo")).toBe(true);
    expect(shouldSkipProvider("runway")).toBe(false);
  });

  it("clears on success", () => {
    recordFailure("veo", classifyProviderError(429, RPM_BODY));
    recordSuccess("veo");
    expect(breakerState("veo")).toBe("HEALTHY");
  });

  it("does not open on non-quota failures", () => {
    for (const s of [400, 401, 404, 500]) {
      recordFailure("veo", classifyProviderError(s, "boom"));
    }
    expect(breakerState("veo")).toBe("HEALTHY");
  });
});
