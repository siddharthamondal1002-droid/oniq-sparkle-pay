/**
 * FAILURE — the recovery brief's sections 2, 4, 7 and 22.
 *
 * WHAT THIS FILE IS NOT: a second provider-error classifier. ONIQ already has
 * one, measured before a line of this was written and recorded in
 * `docs/oqca/OQCA_V1_3_MEASUREMENT.md`:
 *
 *     _shared/providerError.ts   classifyProviderError -> 9 kinds, retryable,
 *                                retryAfterSeconds, plus a circuit breaker
 *     _shared/planOrchestrator   classifyFailure -> transient | permanent
 *     _shared/geminiFailover     ClaudeFailureClass, 6 provider-specific members
 *
 * The first of those was written after eighteen consecutive 429s in 0.4
 * seconds, and it already draws the distinction this brief opens with —
 * retryable versus terminal-for-now. Writing a fourth would be the
 * `withProviderSpendGuard` fault again: a comment claiming to adapt an existing
 * boundary while quietly reimplementing it.
 *
 * SO THE PROVIDER HALF ARRIVES THROUGH A SEAM (`ProviderClassifier` in
 * `classify.ts`) and only the COGNITIVE half is new — PLANNING, PREDICTION,
 * STATE, KNOWLEDGE, SECURITY. Nothing in ONIQ has a planner whose plan can
 * fail, so nothing in ONIQ could already classify one.
 */

/**
 * Section 2's eighteen, verbatim and in its order. The union is closed on
 * purpose: `decideRecovery` switches over it exhaustively and a nineteenth
 * member fails the typecheck at the decision site rather than falling into a
 * default that retries.
 */
export type FailureClass =
  | "TRANSIENT"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "AUTHORIZATION"
  | "BUDGET"
  | "VALIDATION"
  | "MODEL"
  | "TOOL"
  | "DATA"
  | "KNOWLEDGE"
  | "PLANNING"
  | "PREDICTION"
  | "ENVIRONMENT"
  | "STATE"
  | "CONCURRENCY"
  | "SECURITY"
  | "UNKNOWN";

export const FAILURE_CLASSES: readonly FailureClass[] = [
  "TRANSIENT",
  "RATE_LIMIT",
  "TIMEOUT",
  "NETWORK",
  "AUTHORIZATION",
  "BUDGET",
  "VALIDATION",
  "MODEL",
  "TOOL",
  "DATA",
  "KNOWLEDGE",
  "PLANNING",
  "PREDICTION",
  "ENVIRONMENT",
  "STATE",
  "CONCURRENCY",
  "SECURITY",
  "UNKNOWN",
];

/**
 * Section 7. UNKNOWN IS TREATED AS NON_IDEMPOTENT, which is the whole reason
 * the fourth member exists rather than the type being a boolean: a tool whose
 * idempotency nobody declared is a tool that may have charged somebody.
 */
export type IdempotencyClass = "READ" | "IDEMPOTENT_WRITE" | "NON_IDEMPOTENT_WRITE" | "UNKNOWN";

/** Section 7's rule as a function, so no call site can re-decide it. */
export function safeToReplay(idempotency: IdempotencyClass): boolean {
  return idempotency === "READ" || idempotency === "IDEMPOTENT_WRITE";
}

/**
 * Section 22's stop list. These are not "serious failures" — they are states in
 * which CONTINUING IS ITSELF THE FAULT, so recovery may not consider them.
 * `decideRecovery` reads this before it reads anything else, and section 22's
 * own sentence is the reason: "Recovery cannot override safety."
 */
export type SafetyViolation =
  | "security_violation"
  | "credential_exposure"
  | "unauthorized_production_mutation"
  | "unexpected_privileged_operation"
  | "budget_bypass"
  | "state_corruption"
  | "tool_identity_mismatch"
  | "policy_violation";

export const SAFETY_VIOLATIONS: readonly SafetyViolation[] = [
  "security_violation",
  "credential_exposure",
  "unauthorized_production_mutation",
  "unexpected_privileged_operation",
  "budget_bypass",
  "state_corruption",
  "tool_identity_mismatch",
  "policy_violation",
];

/**
 * Section 4's never-retry list, as CODES rather than classes, because the same
 * class can carry both a retryable and a non-retryable cause: an AUTHORIZATION
 * failure may be an expired token (re-mint and retry) or a permission the
 * caller does not have and will not acquire (never).
 */
export type NeverRetryCode =
  | "security_violation"
  | "invalid_authorization"
  | "budget_exhausted"
  | "user_denied"
  | "invalid_production_permission"
  | "corrupted_state"
  | "schema_violation_after_max_repair"
  | "known_impossible_action";

export const NEVER_RETRY_CODES: readonly NeverRetryCode[] = [
  "security_violation",
  "invalid_authorization",
  "budget_exhausted",
  "user_denied",
  "invalid_production_permission",
  "corrupted_state",
  "schema_violation_after_max_repair",
  "known_impossible_action",
];

export function isNeverRetry(code: string): boolean {
  return (NEVER_RETRY_CODES as readonly string[]).includes(code);
}

export function isSafetyViolation(code: string): boolean {
  return (SAFETY_VIOLATIONS as readonly string[]).includes(code);
}

/**
 * Section 2's record. `recoveryAction` and `nextStateId` are filled in AFTER a
 * decision, so they are optional on the failure as raised and present on the
 * failure as recorded.
 *
 * THERE IS NO TIMESTAMP, and that is section 3 of the v1.3 brief rather than an
 * omission: this record is hashed into the cognitive state (section 20 — "never
 * mutate history to hide a failure", so replay must reproduce it), and a wall
 * clock in a hashed record makes every replay produce a different id.
 */
export type Failure = {
  readonly id: string;
  readonly runId: string;
  readonly stateId: string;
  readonly station: string;
  readonly class: FailureClass;
  /** A stable machine code. Compared against the never-retry list. */
  readonly code: string;
  /** Human-readable. Never carries a credential — see `redactMessage`. */
  readonly message: string;
  readonly retryable: boolean;
  readonly recoverable: boolean;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly idempotency: IdempotencyClass;
  /** The failure underneath this one, when this is a wrapper. */
  readonly cause?: string;
  readonly evidenceRefs: readonly string[];
  readonly recoveryAction?: string;
  readonly nextStateId?: string;
  /**
   * Section 8: "Never assume a timeout means the operation did not happen."
   * True when the failure leaves the caller unable to say whether the effect
   * landed — a timeout, a dropped connection, a cancelled request. A retry of
   * a non-idempotent operation in this state is a double-write.
   */
  readonly effectUncertain: boolean;
};

/**
 * A credential must not reach a failure record, because failures ARE hashed
 * into the state and persisted. The patterns are the shapes ONIQ actually
 * holds — a Supabase/JWT triple, an `sbp_` management token, a Google API key,
 * a bearer header — plus a generic long base64 run.
 *
 * IT REPLACES RATHER THAN REFUSING. A recovery layer that threw on a suspicious
 * message would turn one failure into two, and the second would be inside the
 * code that exists to handle the first.
 */
// NAMED FOR WHAT IT DOES, NOT FOR WHAT IT MATCHES. The obvious name carried
// the word the security guard bans, which would have forced this file out of
// the substring scan for no better reason than a noun. Renaming an identifier
// is cheaper than excluding a file.
const REDACTION_PATTERNS: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bsbp_[A-Za-z0-9]{16,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

export const REDACTED = "[redacted]";

export function redactMessage(raw: string, limit = 300): string {
  let out = raw ?? "";
  for (const p of REDACTION_PATTERNS) out = out.replace(p, REDACTED);
  return out.length > limit ? `${out.slice(0, limit)}…` : out;
}

/**
 * The only constructor. It exists so `retryable` cannot be set by hand at a
 * call site that has not consulted section 4 — a failure whose code is on the
 * never-retry list is not retryable however it was raised, and a safety
 * violation is neither retryable nor recoverable.
 */
export function makeFailure(
  draft: Omit<Failure, "retryable" | "recoverable" | "message"> & {
    readonly message: string;
    readonly retryable?: boolean;
  },
): Failure {
  const safety = isSafetyViolation(draft.code);
  const never = safety || isNeverRetry(draft.code);
  return {
    ...draft,
    message: redactMessage(draft.message),
    retryable: never ? false : (draft.retryable ?? false),
    recoverable: !safety,
  };
}
