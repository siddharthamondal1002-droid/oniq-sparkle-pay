// PROVIDER-AGNOSTIC PLAN ORCHESTRATION for the two-stage (spine → batches)
// path that long films take (owner P0 directive, 2026-08-21).
//
// WHY THIS EXISTS. A real 43-shot verbatim job 502'd: the Claude spine timed
// out, and the only fallback was a whole-43-shot single Gemini call — the exact
// request the two-stage path exists to avoid — which also timed out. The second
// engine never got to run the SAME small spine contract. Two defects:
//   1. a provider TIMEOUT (transient) never triggered a cross-engine retry, and
//   2. the fallback engine ran a giant whole-film call instead of a spine.
//
// This module is the fix, and it is PURE: the provider calls, the clock, the
// sleep and the RNG are all INJECTED, so every path — Claude ok, Claude timeout
// → Gemini spine, transient→transient bounded failure, permanent-no-retry — is
// unit-testable with mocks, with no network and no Deno APIs (owner: "mocked
// providers first"). The story-plot edge function wires the real spine/batch
// closures into it; the invariants below (43 shots stay 43, order deterministic,
// no persistence) are the edge function's to uphold and the tests' to prove.

/** A provider call's outcome, normalized. `value` on success; `reason` on any
 *  failure (timeout, HTTP status text, network error text, or a parse reason). */
export type CallOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** A single recorded attempt, for the 502 body and the runner log. Carries the
 *  class so a reader can tell a transient blip from a permanent refusal. */
export type Attempt = {
  engine: string;
  stage: "spine" | "batch";
  attempt: number;
  class: "transient" | "permanent";
  reason: string;
  ms: number;
};

/**
 * Transient vs permanent, from a normalized failure reason.
 *
 * TRANSIENT — worth another bounded try, possibly on another engine: timeouts,
 * network/socket/abort errors, and the retryable 5xx/429 family (429, 500, 502,
 * 503, 504, 529 — matching _shared/llm.ts RETRY_STATUSES plus the gateway 504).
 *
 * PERMANENT — the same request fails the same way next time, so retrying only
 * burns the user's wall clock: auth (401/403), bad request/not-found (400/404),
 * unprocessable (422), a credit/quota refusal, and a reply that ARRIVED but
 * would not parse/validate (schema/malformed/bad json). The unknown defaults to
 * permanent: never spend a retry on a reason we cannot vouch for as transient.
 */
export function classifyFailure(reason: string): "transient" | "permanent" {
  const r = (reason ?? "").toLowerCase();
  // Permanent signals win when both could match (e.g. "http 400 credit"), so
  // a billing/auth/parse failure is never mistaken for a retryable blip.
  if (
    /\bhttp\s?(400|401|403|404|422)\b/.test(r) ||
    /unauthor|forbidden|invalid|schema|malformed|bad json|could not parse|unparseable|credit|quota|not configured|no key/.test(
      r,
    )
  ) {
    return "permanent";
  }
  if (
    /\btimeout\b|timed out|network|socket|econn|fetch failed|aborted|abort/.test(r) ||
    /\bhttp\s?(429|500|502|503|504|529)\b/.test(r) ||
    /\b(429|500|502|503|504|529)\b/.test(r)
  ) {
    return "transient";
  }
  return "permanent";
}

/** A monotonically-advancing clock, injected so budget exhaustion is testable.
 *  `remaining()` is ms left on the whole-function wall clock. */
export type Clock = { now: () => number; remaining: () => number };

export type OrchestrateDeps<S, P> = {
  /** Engines in priority order, already filtered to those with a key
   *  (e.g. ["anthropic","gemini"]). The last one gets no fallback reserve. */
  engines: string[];
  /** Run ONE spine call on `engine` within `timeoutMs`, parse it, and return
   *  the structural spine, or a failure reason. The SAME small contract on
   *  every engine — never a whole-film call. */
  spine: (engine: string, timeoutMs: number) => Promise<CallOutcome<S>>;
  /** Expand the spine into the full shot list on `engine` within `timeoutMs`
   *  (the batch stage), returning the assembled plan or a failure reason. */
  batches: (engine: string, spine: S, timeoutMs: number) => Promise<CallOutcome<P>>;
  clock: Clock;
  /** Per spine attempt. Small on purpose: the spine output is tiny, so a
   *  healthy engine answers fast and a hung one is abandoned quickly, leaving
   *  the other engine real budget. */
  spineBudgetMs: number;
  /** Per batch run. */
  batchBudgetMs: number;
  /** Wall-clock kept in reserve for the NEXT engine's spine+batches while a
   *  fallback still exists, so a slow first engine cannot starve the second. */
  fallbackReserveMs: number;
  /** The least an attempt may have; below this a call is a guaranteed timeout,
   *  so it is skipped and recorded rather than started. */
  minAttemptMs: number;
  /** Bounded transient retries on the SAME engine before falling to the next.
   *  The shared provider helper already double-attempts a timeout, so 1 here is
   *  a further, still-bounded, cross-engine safety net. */
  maxTransientRetriesPerEngine: number;
  /** Jittered backoff (ms) before a same-engine transient retry. Injected so
   *  tests are deterministic. */
  backoffMs: (attempt: number) => number;
  /** Injected sleep, so tests do not actually wait. */
  sleep: (ms: number) => Promise<void>;
};

/**
 * Try each engine in order: bounded transient-retried spine, then batches on
 * the SAME engine. First engine to produce a validated plan wins. When every
 * engine's recovery budget is spent, return a null plan with the full attempt
 * log — a deterministic, bounded failure the caller turns into one 502.
 *
 * NEVER runs a whole-film call, NEVER retries a permanent failure, and NEVER
 * exceeds the wall clock: the total work is bounded by
 * engines × (1 + maxTransientRetriesPerEngine) spine attempts + engines batch
 * runs, each additionally clamped to the time actually left.
 */
export async function orchestratePlan<S, P>(
  deps: OrchestrateDeps<S, P>,
): Promise<{ plan: P | null; servedBy: string; tried: Attempt[] }> {
  const tried: Attempt[] = [];
  const engines = deps.engines;

  for (let e = 0; e < engines.length; e++) {
    const engine = engines[e];
    const isLast = e === engines.length - 1;
    const reserve = isLast ? 0 : deps.fallbackReserveMs;

    // SPINE, with bounded transient retries.
    let spineVal: S | null = null;
    let permanentStop = false;
    const maxAttempts = 1 + Math.max(0, deps.maxTransientRetriesPerEngine);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const room = deps.clock.remaining() - reserve;
      const budget = Math.min(deps.spineBudgetMs, room);
      if (budget < deps.minAttemptMs) {
        tried.push({
          engine,
          stage: "spine",
          attempt,
          class: "transient",
          reason: "no wall-clock room left for the spine",
          ms: 0,
        });
        break;
      }
      const t0 = deps.clock.now();
      const res = await deps.spine(engine, budget);
      const ms = deps.clock.now() - t0;
      if (res.ok) {
        spineVal = res.value;
        break;
      }
      const klass = classifyFailure(res.reason);
      tried.push({ engine, stage: "spine", attempt, class: klass, reason: res.reason, ms });
      if (klass === "permanent") {
        // A retry of a permanent failure reaches the same answer and burns the
        // budget the next engine needs. Stop this engine; the fallback (a
        // DIFFERENT engine) may still succeed on a fresh permanent error.
        permanentStop = true;
        break;
      }
      if (attempt < maxAttempts) await deps.sleep(deps.backoffMs(attempt));
    }
    if (!spineVal) {
      // Move to the next engine whether the spine hit its retry ceiling or a
      // permanent error — a permanent error on THIS engine is not permanent on
      // another provider.
      void permanentStop;
      continue;
    }

    // BATCHES on the SAME engine that wrote the spine.
    const bRoom = deps.clock.remaining();
    const bBudget = Math.min(deps.batchBudgetMs, bRoom);
    if (bBudget < deps.minAttemptMs) {
      tried.push({
        engine,
        stage: "batch",
        attempt: 1,
        class: "transient",
        reason: "no wall-clock room left for batches",
        ms: 0,
      });
      continue;
    }
    const t0 = deps.clock.now();
    const b = await deps.batches(engine, spineVal, bBudget);
    const ms = deps.clock.now() - t0;
    if (b.ok) {
      return { plan: b.value, servedBy: `${engine}:spine+batches`, tried };
    }
    tried.push({
      engine,
      stage: "batch",
      attempt: 1,
      class: classifyFailure(b.reason),
      reason: b.reason,
      ms,
    });
    // Batch failure falls through to the next engine (bounded by the loop).
  }

  return { plan: null, servedBy: "", tried };
}
