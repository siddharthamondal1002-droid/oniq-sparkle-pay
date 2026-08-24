// providerError — one classifier for every provider failure ONIQ can see.
//
// Why this exists: on 2026-08-24 a Veo benchmark hit the daily quota and got
// 18 consecutive `HTTP 429 RESOURCE_EXHAUSTED` in 0.1–0.4s. story-clip had no
// 429 branch, so quota exhaustion arrived at the worker as the same
// "Could not start that clip" a genuine fault produces. A retry ladder above
// that would have hammered a wall that does not move until the window rolls
// over — burning attempts, latency and (on other providers) money.
//
// The distinction that matters is RETRYABLE vs TERMINAL-FOR-NOW. A 429 is not
// a transient blip to back off through; a daily quota is a wall with a clock on
// it. Treating the two the same is what caused the defect.

export type ProviderErrorKind =
  | "PROVIDER_QUOTA_EXHAUSTED"
  | "PROVIDER_RATE_LIMITED"
  | "AUTH_FAILED"
  | "INVALID_REQUEST"
  | "MODEL_UNAVAILABLE"
  | "CONTENT_FILTERED"
  | "NETWORK_FAILURE"
  | "TIMEOUT"
  | "UNKNOWN";

export type ProviderErrorClass = {
  kind: ProviderErrorKind;
  /** May another attempt plausibly succeed soon? */
  retryable: boolean;
  /** Seconds to wait before any retry is worth making. null = do not retry. */
  retryAfterSeconds: number | null;
  /** Safe to show a user. Never contains provider internals or a secret. */
  userMessage: string;
  /** For logs only. Truncated, never includes credentials. */
  detail: string;
};

/** Google/Gemini marks daily-quota exhaustion with this status string. */
const RESOURCE_EXHAUSTED = /RESOURCE_EXHAUSTED/i;
/** A per-minute limit says so explicitly; a daily cap does not. */
const PER_MINUTE_HINT = /per\s*minute|requests per minute|rpm\b/i;

const CAPACITY_MESSAGE = "Video generation is temporarily at capacity. Please try again later.";

/**
 * Parse `Retry-After`, which may be seconds or an HTTP date.
 * Returns null when absent or unparseable — never a guessed number.
 */
export function parseRetryAfter(headers: Headers | null): number | null {
  const raw = headers?.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return null;
}

/**
 * Classify a provider response. `body` is the raw text; it is matched against
 * but never echoed to a user.
 */
export function classifyProviderError(
  status: number,
  body: string,
  headers: Headers | null = null,
): ProviderErrorClass {
  const detail = (body ?? "").slice(0, 300);
  const retryAfter = parseRetryAfter(headers);

  if (status === 429) {
    // A daily quota and a per-minute rate limit both arrive as 429. They need
    // opposite handling, so separate them on the body rather than the status.
    const quota = RESOURCE_EXHAUSTED.test(detail) && !PER_MINUTE_HINT.test(detail);
    if (quota) {
      return {
        kind: "PROVIDER_QUOTA_EXHAUSTED",
        // Not retryable in this job. The window is hours away, not seconds,
        // and retrying is what this module exists to prevent.
        retryable: false,
        retryAfterSeconds: retryAfter,
        userMessage: CAPACITY_MESSAGE,
        detail,
      };
    }
    return {
      kind: "PROVIDER_RATE_LIMITED",
      retryable: true,
      // Honour the provider's own number when it gives one; otherwise a
      // conservative default rather than an immediate retry.
      retryAfterSeconds: retryAfter ?? 30,
      userMessage: CAPACITY_MESSAGE,
      detail,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "AUTH_FAILED",
      retryable: false,
      retryAfterSeconds: null,
      userMessage: "Video generation isn't available right now.",
      detail,
    };
  }

  if (status === 404) {
    return {
      kind: "MODEL_UNAVAILABLE",
      retryable: false,
      retryAfterSeconds: null,
      userMessage: "The video model is unavailable.",
      detail,
    };
  }

  if (status === 400) {
    if (/third.party|prohibited|safety|filtered|blocked/i.test(detail)) {
      return {
        kind: "CONTENT_FILTERED",
        retryable: false,
        retryAfterSeconds: null,
        userMessage: "That shot was refused.",
        detail,
      };
    }
    return {
      kind: "INVALID_REQUEST",
      retryable: false,
      retryAfterSeconds: null,
      userMessage: "Could not start that clip.",
      detail,
    };
  }

  if (status === 408 || status === 504) {
    return {
      kind: "TIMEOUT",
      retryable: true,
      retryAfterSeconds: retryAfter ?? 10,
      userMessage: CAPACITY_MESSAGE,
      detail,
    };
  }

  if (status >= 500) {
    return {
      kind: "NETWORK_FAILURE",
      retryable: true,
      retryAfterSeconds: retryAfter ?? 15,
      userMessage: CAPACITY_MESSAGE,
      detail,
    };
  }

  return {
    kind: "UNKNOWN",
    retryable: false,
    retryAfterSeconds: null,
    userMessage: "Could not start that clip.",
    detail,
  };
}

// ---------------------------------------------------------------- breaker
//
// A per-isolate breaker. It is deliberately NOT presented as a global guard:
// Supabase Edge recycles isolates, so this bounds a burst within one isolate
// and nothing more. Durable, fleet-wide quota state would need a table, and
// claiming this is that would be worse than not having it.

export type BreakerState = "HEALTHY" | "DEGRADED" | "QUOTA_EXHAUSTED";

type Entry = { state: BreakerState; strikes: number; openedAt: number; until: number };

const breakers = new Map<string, Entry>();

/** Consecutive rate-limits before a provider is treated as degraded. */
export const DEGRADE_AFTER = 2;
/** How long a quota-exhausted provider stays closed when no Retry-After given. */
export const DEFAULT_QUOTA_COOLDOWN_S = 900;

export function breakerState(provider: string, now = Date.now()): BreakerState {
  const e = breakers.get(provider);
  if (!e) return "HEALTHY";
  if (e.until && now >= e.until) {
    breakers.delete(provider);
    return "HEALTHY";
  }
  return e.state;
}

/** True when the provider should NOT be called at all right now. */
export function shouldSkipProvider(provider: string, now = Date.now()): boolean {
  return breakerState(provider, now) === "QUOTA_EXHAUSTED";
}

export function recordFailure(
  provider: string,
  c: ProviderErrorClass,
  now = Date.now(),
): BreakerState {
  if (c.kind === "PROVIDER_QUOTA_EXHAUSTED") {
    const cooldown = (c.retryAfterSeconds ?? DEFAULT_QUOTA_COOLDOWN_S) * 1000;
    breakers.set(provider, {
      state: "QUOTA_EXHAUSTED",
      strikes: 0,
      openedAt: now,
      until: now + cooldown,
    });
    return "QUOTA_EXHAUSTED";
  }
  if (c.kind === "PROVIDER_RATE_LIMITED") {
    const prev = breakers.get(provider);
    const strikes = (prev?.state === "DEGRADED" ? prev.strikes : 0) + 1;
    if (strikes >= DEGRADE_AFTER) {
      const cooldown = (c.retryAfterSeconds ?? DEFAULT_QUOTA_COOLDOWN_S) * 1000;
      breakers.set(provider, {
        state: "QUOTA_EXHAUSTED",
        strikes,
        openedAt: now,
        until: now + cooldown,
      });
      return "QUOTA_EXHAUSTED";
    }
    breakers.set(provider, {
      state: "DEGRADED",
      strikes,
      openedAt: now,
      until: now + (c.retryAfterSeconds ?? 30) * 1000,
    });
    return "DEGRADED";
  }
  return breakerState(provider, now);
}

export function recordSuccess(provider: string): void {
  breakers.delete(provider);
}

/** Test seam only. */
export function _resetBreakers(): void {
  breakers.clear();
}
