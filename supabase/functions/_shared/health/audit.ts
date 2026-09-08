/**
 * ONIQ HEALTH — the audit event, and the one door it goes through.
 *
 * The chain itself lives in SQL (`health_audit_chain()`), appended only by
 * `health_append_audit()`, which only the service role may execute. This
 * module shapes the call so every caller passes the same fields — and runs
 * every `detail` through the whitelist, so a record's values cannot reach
 * the audit row however a caller assembled the object.
 */
import type { AuditAction, AuditObjectType } from "./domain.ts";
import { auditDetail } from "./redact.ts";

export type AuditOutcome = "ok" | "refused" | "error";

export type AuditInput = {
  userId: string;
  /** Who acted: the person's own id, or "system" for a sweep. */
  actor: string;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId?: string | null;
  purpose?: string | null;
  consentId?: string | null;
  requestId: string;
  outcome: AuditOutcome;
  detail?: Record<string, unknown>;
};

/** Pure: the RPC argument object. Tested without a database. */
export function auditRpcArgs(input: AuditInput): Record<string, unknown> {
  return {
    _user_id: input.userId,
    _actor: input.actor,
    _action: input.action,
    _object_type: input.objectType,
    _object_id: input.objectId ?? null,
    _purpose: input.purpose ?? null,
    _consent_id: input.consentId ?? null,
    _request_id: input.requestId,
    _outcome: input.outcome,
    _detail: auditDetail(input.detail),
  };
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): Promise<{ error: unknown }> };

/**
 * Append one event. Throws when the chain refuses, because a mutation that
 * cannot be audited must be reported as a failure rather than pass quietly.
 */
export async function appendAudit(admin: Rpc, input: AuditInput): Promise<void> {
  const { error } = await admin.rpc("health_append_audit", auditRpcArgs(input));
  if (error) throw new Error("audit_failed");
}
