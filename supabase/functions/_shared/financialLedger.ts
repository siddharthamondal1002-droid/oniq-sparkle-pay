// financialLedger — ONE spend guard for every capability ONIQ pays for.
//
// The search guard (2026-08-24) proved the shape: reserve, call, measure,
// settle, and fail closed on every unknown. Then video needed the same thing,
// and text, and images, and TTS. Four copies of check-then-spend is four places
// for the check to drift from the spend — so this is the single seam, and what
// varies per capability is the UNIT and the PRICE, not the accounting.
//
//   FINANCIAL_ADMISSION → CAPABILITY → PROVIDER → MODEL → UNIT
//     → RESERVATION → PROVIDER CALL → MEASURED SETTLEMENT
//
// WHAT THIS MODULE REFUSES TO DO. It never converts one capability's unit into
// another's. A video second is not a token and no exchange rate between them
// exists; the ledger only ever adds up DOLLARS, and each capability's adapter
// is responsible for turning its own units into dollars using a rate it can
// point at. An adapter that cannot price its call does not get to guess.

// ------------------------------------------------------------ capabilities
export type Capability = "SEARCH" | "TEXT" | "IMAGE" | "VIDEO" | "VIDEO_AUDIO" | "TTS" | "OTHER";

/**
 * What each capability counts. These strings are recorded on every ledger row
 * so a later reader knows what `units_reserved` meant without guessing.
 */
export type SpendUnit =
  | "search+tokens"
  | "tokens"
  | "images"
  | "video_seconds"
  | "video_seconds_with_audio"
  | "characters"
  | "provider_unit";

/** How a request ended, from the PRODUCT's point of view. */
export type SpendOutcome = "ACCEPTED" | "REJECTED" | "FAILED" | "FILTERED" | "NOT_CALLED";

/**
 * Every reason admission can refuse. Operator-facing, never shown raw to a
 * user — see the per-surface message maps.
 */
export type RefusalReason =
  | "guard-unavailable"
  | "unpriced-model"
  | "zero-estimate"
  | "no-model"
  | "invalid-estimate"
  | "no-budget-configured"
  | "capability-disabled"
  | "over-request-cap"
  | "job-cap-reached"
  | "job-attempts-exhausted"
  | "job-capability-mismatch"
  | "daily-cap-reached"
  | "duplicate-request"
  | "admission-unavailable"
  | (string & {});

// ------------------------------------------------------------ rpc plumbing
/** How long admission may take before the request is refused. */
const RPC_TIMEOUT_MS = 5000;

// Imported by vitest (Node) as well as by the edge functions (Deno). The
// `| undefined` is load-bearing: it forces the typeof guard below, so "no Deno
// runtime" resolves to null — no ledger, no admission — instead of throwing.
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

export type ServiceRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Service-role PostgREST adapter.
 *
 * Returns null when the service role is not configured. A null is NOT a licence
 * to proceed unguarded — every caller must refuse, because "configuration
 * missing" resolving to "spend freely" is the exact bug the ledger exists to
 * make impossible. Never logs, echoes, or returns the key.
 */
export function serviceRoleRpc(): ServiceRpc | null {
  if (typeof Deno === "undefined") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return async (fn, args) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(args),
        signal: ac.signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) return { data: null, error: { message: `${fn} http ${res.status}` } };
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        return { data: null, error: { message: `${fn} unparseable response` } };
      }
      return { data, error: null };
    } catch (e) {
      const why = (e as Error)?.name === "AbortError" ? "timeout" : "network";
      return { data: null, error: { message: `${fn} ${why}` } };
    } finally {
      clearTimeout(t);
    }
  };
}

// ------------------------------------------------------------ admission
export type Admission = {
  ok: boolean;
  reason: RefusalReason;
  attempt?: number;
  remainingUsd?: number;
  dailyCapUsd?: number;
  requestCapUsd?: number;
  jobCapUsd?: number;
  maxAttemptsPerJob?: number;
};

export type SpendRequest = {
  requestId: string;
  capability: Capability;
  provider: string;
  model: string;
  unit: SpendUnit;
  /** How many units the worst case consumes (seconds, tokens, images…). */
  units: number;
  /** The worst-case dollars for those units. Must be > 0. */
  estimatedUsd: number;
  /** Scopes the retry ladder and the per-film ceiling. */
  jobId?: string;
  userId?: string;
  detail?: Record<string, unknown>;
};

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Reserve BEFORE the provider call. Any failure — including an unreachable
 * database — refuses. A spend guard that opens when it cannot reach its own
 * ledger is not a guard.
 */
export async function admitProviderSpend(rpc: ServiceRpc, r: SpendRequest): Promise<Admission> {
  try {
    const { data, error } = await rpc("admit_provider_spend", {
      _request_id: r.requestId,
      _capability: r.capability,
      _provider: r.provider,
      _model: r.model,
      _unit: r.unit,
      _units: r.units,
      _estimated_usd: r.estimatedUsd,
      _job_id: r.jobId ?? null,
      _user_id: r.userId ?? null,
      _detail: r.detail ?? null,
    });
    if (error) return { ok: false, reason: "admission-unavailable" };
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: d.ok === true,
      reason: typeof d.reason === "string" ? d.reason : "unknown",
      attempt: num(d.attempt),
      remainingUsd: num(d.remainingUsd),
      dailyCapUsd: num(d.dailyCapUsd),
      requestCapUsd: num(d.requestCapUsd),
      jobCapUsd: num(d.jobCapUsd),
      maxAttemptsPerJob: num(d.maxAttemptsPerJob),
    };
  } catch {
    return { ok: false, reason: "admission-unavailable" };
  }
}

export type Settlement = {
  /** Null/undefined ⇒ the provider did not report a cost. The ESTIMATE stands. */
  actualUsd?: number;
  unitsActual?: number;
  outcome: SpendOutcome;
  detail?: Record<string, unknown>;
};

export async function settleProviderSpend(
  rpc: ServiceRpc,
  requestId: string,
  s: Settlement,
): Promise<void> {
  try {
    await rpc("settle_provider_spend", {
      _request_id: requestId,
      _actual_usd: s.actualUsd ?? null,
      _units_actual: s.unitsActual ?? null,
      _outcome: s.outcome,
      _detail: s.detail ?? null,
    });
  } catch {
    // Best effort. A lost settle leaves the reservation standing, which
    // OVER-counts spend — the safe direction to fail.
  }
}

/** ONLY when the provider was never called. The attempt is not given back. */
export async function releaseProviderSpend(rpc: ServiceRpc, requestId: string): Promise<void> {
  try {
    await rpc("release_provider_spend", { _request_id: requestId });
  } catch {
    // Same reasoning as settle: a lost release over-counts, never under-counts.
  }
}

// ------------------------------------------------------------ the seam
/** What a guarded callback hands back. */
export type ProviderRun<T> = {
  /** The callback's own result, returned to the caller untouched. */
  value: T;
  /**
   * Set true ONLY when no request reached the provider — a missing key, a
   * refusal before the fetch. Absent or false settles at cost. An AMBIGUOUS
   * outcome (timeout, network error, non-2xx) is not this: the request may
   * well have been served and billed.
   */
  neverCalled?: boolean;
  /** Dollars the provider reported. Absent ⇒ the estimate is charged. */
  actualUsd?: number;
  /** Units actually consumed (generated seconds, tokens…). */
  unitsActual?: number;
  /** Did the PRODUCT keep it? Defaults to FAILED, the conservative reading. */
  outcome?: SpendOutcome;
  detail?: Record<string, unknown>;
};

export type GuardedResult<T> =
  | { admitted: true; value: T; reservedUsd: number; actualUsd: number | null; attempt: number }
  | { admitted: false; reason: RefusalReason; remainingUsd?: number; maxAttemptsPerJob?: number };

/**
 * Reserve, call, settle. The only path to a billable provider call.
 *
 * The provider call is a CALLBACK, so it cannot run before admission and cannot
 * skip settlement. Every ambiguity defaults to CHARGE: a reservation comes back
 * only when the callback states, explicitly, that nothing left the box.
 */
export async function withProviderSpendGuard<T>(
  rpc: ServiceRpc | null,
  r: SpendRequest,
  run: () => Promise<ProviderRun<T>>,
): Promise<GuardedResult<T>> {
  if (!rpc) return { admitted: false, reason: "guard-unavailable" };
  if (!Number.isFinite(r.estimatedUsd) || r.estimatedUsd <= 0) {
    // An unpriced call is not a free call. The adapter should have thrown
    // before reaching here; this is the backstop.
    return { admitted: false, reason: "zero-estimate" };
  }
  if (!r.model) return { admitted: false, reason: "no-model" };

  const admission = await admitProviderSpend(rpc, r);
  if (!admission.ok) {
    return {
      admitted: false,
      reason: admission.reason,
      remainingUsd: admission.remainingUsd,
      maxAttemptsPerJob: admission.maxAttemptsPerJob,
    };
  }

  let outcome: ProviderRun<T>;
  try {
    outcome = await run();
  } catch (e) {
    // The callback threw AFTER a reservation existed. We do not know whether
    // the provider was reached, so the reservation is charged, not returned.
    await settleProviderSpend(rpc, r.requestId, { outcome: "FAILED" });
    throw e;
  }

  if (outcome.neverCalled === true) {
    await releaseProviderSpend(rpc, r.requestId);
    return {
      admitted: true,
      value: outcome.value,
      reservedUsd: r.estimatedUsd,
      actualUsd: 0,
      attempt: admission.attempt ?? 1,
    };
  }

  await settleProviderSpend(rpc, r.requestId, {
    actualUsd: outcome.actualUsd,
    unitsActual: outcome.unitsActual,
    outcome: outcome.outcome ?? "FAILED",
    detail: outcome.detail,
  });
  return {
    admitted: true,
    value: outcome.value,
    reservedUsd: r.estimatedUsd,
    actualUsd: outcome.actualUsd ?? null,
    attempt: admission.attempt ?? 1,
  };
}

/**
 * A stable id for one guarded request.
 *
 * A client-supplied id is honoured because reusing one is REFUSED
 * ("duplicate-request"), which fails in the safe direction — a retry with the
 * same id cannot double-reserve. A fresh uuid is the fallback.
 */
export function requestIdFrom(raw: unknown): string {
  if (typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw)) return raw;
  return crypto.randomUUID();
}

/** Operator-facing refusal → the one line a user should see. */
export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case "daily-cap-reached":
      return "today's generation budget is used up — back tomorrow 🌙";
    case "job-cap-reached":
      return "this film has used its generation budget";
    case "job-attempts-exhausted":
      return "that shot didn't come out after several tries — moving on";
    case "over-request-cap":
      return "that request is too big to run — try something shorter";
    case "duplicate-request":
      return "that one's already running — hang tight";
    case "no-budget-configured":
    case "capability-disabled":
    case "guard-unavailable":
    case "unpriced-model":
    case "zero-estimate":
    case "no-model":
      return "that isn't switched on yet — try again later";
    default:
      // "admission-unavailable" and anything new. Fail closed, say so plainly.
      return "that's unavailable right now — try again in a moment";
  }
}
