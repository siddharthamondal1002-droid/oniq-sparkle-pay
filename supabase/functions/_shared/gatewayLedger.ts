// gatewayLedger — what a Lovable-gateway call cost, recorded in the currency
// it was actually billed in.
//
// WHY THIS IS NOT financialLedger.ts. That module is the DOLLAR guard: it
// reserves against request/job/daily USD ceilings before a direct-provider
// call and settles at a measured dollar figure. A gateway call spends Lovable
// CREDITS. Booking one through that guard would either charge a direct-provider
// ceiling with money that never touches it, or require an invented
// credits→USD rate. Both are forbidden, so this is a separate seam writing to
// a separate table, and it holds no USD field at all — `gatewayLedger.test.ts`
// asserts that by reading this file.
//
// WHAT IT WILL NOT DO:
//   - guess a price. The gateway discloses none at call time, so the row is
//     PENDING_RECONCILIATION until a receipt arrives.
//   - treat "unknown" as zero. A null price and a zero price are different
//     facts and the settlement state is what separates them.
//   - reserve, refuse, or cap. This RECORDS; it is not a gate. The gateway's
//     own credit pool is the ceiling, and pretending otherwise here would be a
//     second authorization system to drift from the first.
//
// The rpc is an ARGUMENT with no default, exactly as financialLedger's is: a
// caller that cannot reach the database records nothing and says so, rather
// than silently proceeding as if it had.

export type GatewayCapability = "TEXT" | "IMAGE" | "TTS" | "MUSIC" | "VIDEO" | "SEARCH" | "OTHER";
export type GatewayUnit = "tokens" | "images" | "characters" | "video_seconds" | "provider_unit";
export type GatewayOutcome = "ACCEPTED" | "REJECTED" | "FAILED" | "FILTERED" | "NOT_CALLED";
export type GatewaySettlementState = "PENDING_RECONCILIATION" | "SETTLED" | "NOT_CALLED" | "FAILED";

/** Every gateway call is this provider. Kept as a constant so the ledger can
 *  be grouped by it without a spelling drifting between call sites. */
export const GATEWAY_PROVIDER = "lovable_gateway";

export type GatewayRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export type GatewayCapture = {
  /** Stable per ATTEMPT. Re-capturing the same id is a no-op, by constraint. */
  requestId: string;
  capability: GatewayCapability;
  model: string;
  unit: GatewayUnit;
  jobId?: string | null;
  /** 1-based. Distinguishes a retry ladder's rungs from one another. */
  attempt?: number | null;
  userId?: string | null;
  detail?: Record<string, unknown> | null;
};

export type GatewaySettlement = {
  outcome: GatewayOutcome;
  /** Tokens / images / characters the provider reported. Null ⇒ unreported. */
  unitsObserved?: number | null;
  /**
   * Credits the provider says it charged. NULL when it did not say — which is
   * the normal case today and is recorded as PENDING_RECONCILIATION. Never
   * pass 0 to mean "unknown": 0 means the call was genuinely free.
   */
  chargedCredits?: number | null;
  /** The provider's own identifier for the charge, when it returns one. */
  providerReceiptId?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * WHY THE FAILURE VOCABULARY IS A CLOSED LIST. An accounting miss must be
 * VISIBLE — a silently dropped row is a charge nobody can reconcile — but the
 * thing that makes it visible must not be a provider's or an exception's own
 * words. A raw `error.message` written into `ledger.detail` is unbounded text
 * from outside ONIQ landing in a row an authenticated user can read. So the
 * only thing that travels is one of these codes plus, at most, a numeric HTTP
 * status.
 */
export type GatewayAccountingFailure =
  | "ledger-unavailable"
  | "capture-rejected"
  | "capture-threw"
  | "settle-rejected"
  | "settle-threw"
  | "settle-conflict"
  | "settle-unknown-request";

export type CaptureResult = {
  ok: boolean;
  duplicate: boolean;
  reason?: GatewayAccountingFailure;
  settlementState?: GatewaySettlementState;
};

export type SettleResult = {
  ok: boolean;
  reason?: GatewayAccountingFailure;
  settlementState?: GatewaySettlementState;
};

function nonNegative(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * The ONE place an accounting miss is announced. It is a log line and nothing
 * else: an approved generation must never be withheld because a bookkeeping
 * write failed, and the row's absence is already the loudest signal there is
 * to whoever reconciles. Only the closed code and the request id travel.
 */
export function reportAccountingFailure(
  requestId: string,
  phase: "capture" | "settle",
  reason: GatewayAccountingFailure,
): void {
  console.warn(`gatewayLedger: ${phase} not recorded (${reason}) request=${requestId}`);
}

/**
 * The state a settlement lands in, derived in ONE place so the TypeScript seam
 * and the SQL function cannot disagree about it. Exported for the test that
 * pins the two against each other.
 */
export function settlementStateFor(s: GatewaySettlement): GatewaySettlementState {
  if (s.outcome === "NOT_CALLED") return "NOT_CALLED";
  return nonNegative(s.chargedCredits) === null ? "PENDING_RECONCILIATION" : "SETTLED";
}

/** Record the attempt BEFORE the provider is called. Idempotent by requestId. */
export async function captureGatewaySpend(
  rpc: GatewayRpc | null,
  c: GatewayCapture,
): Promise<CaptureResult> {
  if (!rpc) {
    reportAccountingFailure(c.requestId, "capture", "ledger-unavailable");
    return { ok: false, duplicate: false, reason: "ledger-unavailable" };
  }
  try {
    const { data, error } = await rpc("capture_gateway_spend", {
      _request_id: c.requestId,
      _capability: c.capability,
      _provider: GATEWAY_PROVIDER,
      _model: c.model,
      _unit: c.unit,
      _job_id: c.jobId ?? null,
      _attempt: c.attempt ?? null,
      _user_id: c.userId ?? null,
      _detail: c.detail ?? null,
    });
    if (error) {
      reportAccountingFailure(c.requestId, "capture", "capture-rejected");
      return { ok: false, duplicate: false, reason: "capture-rejected" };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.ok !== true) {
      reportAccountingFailure(c.requestId, "capture", "capture-rejected");
      return { ok: false, duplicate: d.duplicate === true, reason: "capture-rejected" };
    }
    return {
      ok: true,
      duplicate: d.duplicate === true,
      settlementState: d.settlementState as GatewaySettlementState | undefined,
    };
  } catch {
    reportAccountingFailure(c.requestId, "capture", "capture-threw");
    return { ok: false, duplicate: false, reason: "capture-threw" };
  }
}

/**
 * Close the attempt out. A lost settle leaves the row PENDING, which is the
 * safe direction: an un-reconciled row is visible, a deleted one is not.
 *
 * THE RESULT IS READ, not discarded. The SQL refuses a replay that contradicts
 * a charge or a receipt already on the row, and a refusal that nothing looks at
 * is the same as no constraint at all.
 */
export async function settleGatewaySpend(
  rpc: GatewayRpc | null,
  requestId: string,
  s: GatewaySettlement,
): Promise<SettleResult> {
  if (!rpc) {
    reportAccountingFailure(requestId, "settle", "ledger-unavailable");
    return { ok: false, reason: "ledger-unavailable" };
  }
  try {
    const { data, error } = await rpc("settle_gateway_spend", {
      _request_id: requestId,
      _outcome: s.outcome,
      _units_observed: nonNegative(s.unitsObserved),
      _charged_credits: nonNegative(s.chargedCredits),
      _provider_receipt_id: s.providerReceiptId ?? null,
      _detail: s.detail ?? null,
    });
    if (error) {
      reportAccountingFailure(requestId, "settle", "settle-rejected");
      return { ok: false, reason: "settle-rejected" };
    }
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.ok !== true) {
      const reason: GatewayAccountingFailure =
        d.reason === "unknown-request" ? "settle-unknown-request" : "settle-conflict";
      reportAccountingFailure(requestId, "settle", reason);
      return { ok: false, reason };
    }
    return { ok: true, settlementState: d.settlementState as GatewaySettlementState | undefined };
  } catch {
    reportAccountingFailure(requestId, "settle", "settle-threw");
    return { ok: false, reason: "settle-threw" };
  }
}

export type GatewayRun<T> = {
  value: T;
  /** True ONLY when no request reached the gateway. Settles NOT_CALLED. */
  neverCalled?: boolean;
  outcome?: GatewayOutcome;
  unitsObserved?: number | null;
  chargedCredits?: number | null;
  providerReceiptId?: string | null;
  detail?: Record<string, unknown> | null;
};

/**
 * Capture → call → settle, with the settle happening on the throwing path too.
 * An ambiguous failure (timeout, non-2xx) settles FAILED rather than
 * NOT_CALLED: the request may well have been served and charged, and claiming
 * otherwise is the one error that makes the ledger under-count.
 */
export async function withGatewayCostCapture<T>(
  rpc: GatewayRpc | null,
  capture: GatewayCapture,
  run: () => Promise<GatewayRun<T>>,
): Promise<T> {
  await captureGatewaySpend(rpc, capture);
  try {
    const r = await run();
    await settleGatewaySpend(rpc, capture.requestId, {
      outcome: r.neverCalled ? "NOT_CALLED" : (r.outcome ?? "ACCEPTED"),
      unitsObserved: r.unitsObserved ?? null,
      chargedCredits: r.chargedCredits ?? null,
      providerReceiptId: r.providerReceiptId ?? null,
      detail: r.detail ?? null,
    });
    return r.value;
  } catch (e) {
    await settleGatewaySpend(rpc, capture.requestId, {
      outcome: "FAILED",
      detail: { error: String((e as Error)?.message ?? e).slice(0, 200) },
    });
    throw e;
  }
}

/**
 * Usage as the OpenAI-shaped gateway reports it. Tokens are the only thing it
 * discloses; there is no price field, which is why `chargedCredits` stays null
 * on every one of these calls today.
 */
export function tokensFromUsage(body: unknown): number | null {
  const u = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u) return null;
  const total = nonNegative(u.total_tokens);
  if (total !== null) return total;
  const inTok = nonNegative(u.prompt_tokens) ?? nonNegative(u.input_tokens);
  const outTok = nonNegative(u.completion_tokens) ?? nonNegative(u.output_tokens);
  if (inTok === null && outTok === null) return null;
  return (inTok ?? 0) + (outTok ?? 0);
}
