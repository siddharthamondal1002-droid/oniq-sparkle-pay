/**
 * CLASSIFY — the recovery brief's sections 2 and 3, and the one place this
 * layer touches ONIQ's existing failure vocabulary.
 *
 * THE PROVIDER HALF IS A SEAM AND NOT A REIMPLEMENTATION. `_shared/providerError.ts`
 * already classifies nine provider failure kinds with `retryable` and
 * `retryAfterSeconds`, already parses a `Retry-After` that may be seconds or an
 * HTTP date, and already runs a circuit breaker over the result. It was written
 * after eighteen consecutive 429s in 0.4 seconds and it draws this brief's own
 * opening distinction — retryable versus terminal-for-now. A second copy here
 * would be the `withProviderSpendGuard` fault: a comment claiming to adapt an
 * existing boundary while quietly duplicating it.
 *
 * The kernel may not import it — `security.test.ts` walks this tree and admits
 * only named siblings — so the runtime passes its verdict in through
 * `ProviderVerdict` and `mapProviderKind` is the only mapping table.
 */
import { type Failure, type FailureClass, type IdempotencyClass, makeFailure } from "./failure.ts";

/**
 * What `_shared/providerError.ts` produces, reduced to the fields a decision
 * needs. `kind` is its own `ProviderErrorKind` string, passed through
 * unmodified so that the mapping below is the only place the two vocabularies
 * meet.
 */
export type ProviderVerdict = {
  readonly kind: string;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly detail: string;
};

/**
 * Nine kinds in, seven classes out. Two mappings are worth stating because
 * neither is the obvious one:
 *
 * - `PROVIDER_QUOTA_EXHAUSTED` becomes RATE_LIMIT, not BUDGET. BUDGET in this
 *   layer means OUR bound — the thing the owner set and the gate enforces.
 *   A provider's daily quota is somebody else's wall with a clock on it, and
 *   `planRetry` already prefers a long Retry-After over the computed backoff.
 *   Calling it BUDGET would end the run on a limit that resets at midnight.
 * - `CONTENT_FILTERED` becomes MODEL with `retryable: false`. It is a refusal
 *   rather than a fault: the same input produces the same refusal, so the
 *   ladder should fall through to an alternate or a replan, which is exactly
 *   what a non-retryable MODEL failure does.
 */
export function mapProviderKind(kind: string): FailureClass {
  switch (kind) {
    case "PROVIDER_QUOTA_EXHAUSTED":
    case "PROVIDER_RATE_LIMITED":
      return "RATE_LIMIT";
    case "AUTH_FAILED":
      return "AUTHORIZATION";
    case "INVALID_REQUEST":
      return "VALIDATION";
    case "MODEL_UNAVAILABLE":
    case "CONTENT_FILTERED":
      return "MODEL";
    case "NETWORK_FAILURE":
      return "NETWORK";
    case "TIMEOUT":
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
}

/**
 * Section 8 as a table rather than a judgement at each call site: "Never assume
 * a timeout means the operation did not happen." A timeout and a dropped
 * connection are the two shapes where the request may well have been served and
 * only the answer was lost.
 */
export function effectIsUncertain(cls: FailureClass): boolean {
  return cls === "TIMEOUT" || cls === "NETWORK" || cls === "CONCURRENCY";
}

export type FailureSite = {
  readonly runId: string;
  readonly stateId: string;
  readonly station: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly idempotency: IdempotencyClass;
  readonly evidenceRefs?: readonly string[];
};

/** `<station>#<attempt>@<stateId>` — stable, replayable, and no clock in it. */
export function failureId(site: FailureSite): string {
  return `${site.station}#${site.attempt}@${site.stateId}`;
}

export function fromProvider(site: FailureSite, verdict: ProviderVerdict): Failure {
  const cls = mapProviderKind(verdict.kind);
  return makeFailure({
    id: failureId(site),
    runId: site.runId,
    stateId: site.stateId,
    station: site.station,
    class: cls,
    code: verdict.kind.toLowerCase(),
    message: verdict.detail,
    attempt: site.attempt,
    maxAttempts: site.maxAttempts,
    idempotency: site.idempotency,
    evidenceRefs: site.evidenceRefs ?? [],
    retryable: verdict.retryable,
    effectUncertain: effectIsUncertain(cls),
  });
}

/**
 * A budget bound, which is the one failure that is NOT a fault. Section 23:
 * BUDGET_EXHAUSTED is a distinct outcome from FAILED and must name which
 * budget — so the bound's own name becomes the code's companion and travels to
 * `RecoveryDecision.budgetName`.
 */
export function fromBudget(site: FailureSite, boundName: string): Failure {
  return makeFailure({
    id: failureId(site),
    runId: site.runId,
    stateId: site.stateId,
    station: site.station,
    class: "BUDGET",
    code: "budget_exhausted",
    message: `bound reached: ${boundName}`,
    attempt: site.attempt,
    maxAttempts: site.maxAttempts,
    idempotency: site.idempotency,
    evidenceRefs: site.evidenceRefs ?? [],
    effectUncertain: false,
  });
}

/**
 * The COGNITIVE half — the classes no provider classifier could produce,
 * because nothing in ONIQ has a planner whose plan can fail. Raised by the
 * stations themselves, where the station already knows what went wrong; there
 * is deliberately no string-sniffing of a message to guess between PLANNING and
 * DATA, because a guess there decides between replanning and researching.
 */
export function fromStation(
  site: FailureSite,
  cls: FailureClass,
  code: string,
  message: string,
  opts: { readonly retryable?: boolean; readonly cause?: string } = {},
): Failure {
  return makeFailure({
    id: failureId(site),
    runId: site.runId,
    stateId: site.stateId,
    station: site.station,
    class: cls,
    code,
    message,
    attempt: site.attempt,
    maxAttempts: site.maxAttempts,
    idempotency: site.idempotency,
    evidenceRefs: site.evidenceRefs ?? [],
    retryable: opts.retryable ?? false,
    effectUncertain: effectIsUncertain(cls),
    ...(opts.cause ? { cause: opts.cause } : {}),
  });
}

/**
 * A thrown value, which is the only case where sniffing is unavoidable — a
 * `catch` receives whatever the runtime threw. It is deliberately CONSERVATIVE:
 * everything it cannot place becomes UNKNOWN, which escalates rather than
 * retrying. A classifier that guessed TRANSIENT from an unrecognised message
 * would be exactly section 1's "unconditional retry" wearing a classification.
 */
export function fromThrown(site: FailureSite, err: unknown): Failure {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  let cls: FailureClass = "UNKNOWN";
  let code = "thrown";
  if (/\babort|timed? ?out|timeout|deadline\b/.test(m)) {
    cls = "TIMEOUT";
    code = "timeout";
  } else if (/econn|socket|network|fetch failed|dns|tls|handshake/.test(m)) {
    cls = "NETWORK";
    code = "network";
  } else if (/conflict|serializ|deadlock|version mismatch|lock/.test(m)) {
    cls = "CONCURRENCY";
    code = "conflict";
  }
  return makeFailure({
    id: failureId(site),
    runId: site.runId,
    stateId: site.stateId,
    station: site.station,
    class: cls,
    code,
    message,
    attempt: site.attempt,
    maxAttempts: site.maxAttempts,
    idempotency: site.idempotency,
    evidenceRefs: site.evidenceRefs ?? [],
    retryable: cls !== "UNKNOWN",
    effectUncertain: effectIsUncertain(cls),
  });
}
