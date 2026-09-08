/**
 * ONIQ HEALTH — the one client that talks to `health-api`.
 *
 * Every screen goes through here, so there is exactly one place that knows
 * the action names, one place that refuses while the client flag is off, and
 * one place that turns a server reason code into a sentence for the person.
 * No screen reads a health table directly: the tables have no client write
 * policy at all, and reads go through the function so that consent, the
 * ownership filter and the audit chain are applied on every path.
 *
 * `invoke` reports a non-2xx as `error` and keeps the body on
 * `error.context` (a Response). The server puts its reason code in that body
 * — `consent_required` names the purpose and category — so it is read back
 * here rather than collapsed into "failed".
 */
import { supabase } from "@/integrations/supabase/client";
import { HEALTH_ENABLED } from "./flags";
import { safeMessage } from "./redact";
import type { DocumentKind, DocumentMime, HealthConsent, Provenance, RecordKind } from "./domain";

export type HealthAction =
  | "status"
  | "timeline"
  | "records.create"
  | "records.delete"
  | "documents.list"
  | "documents.register"
  | "documents.confirm"
  | "documents.url"
  | "documents.delete"
  | "consents.list"
  | "consents.grant"
  | "consents.revoke"
  | "export"
  | "purge";

export type HealthOk<T> = { ok: true; data: T; requestId: string | null };
export type HealthErr = {
  ok: false;
  reason: string;
  message: string;
  purpose?: string;
  category?: string;
  requestId: string | null;
};
export type HealthResult<T> = HealthOk<T> | HealthErr;

export type HealthStatus = {
  flags: Record<string, boolean>;
  environment: string;
  counts: { records: number; documents: number; consents: number };
  storeConsent: { active: boolean; categories: string[] };
};

export type TimelineRow = {
  id: string;
  kind: RecordKind;
  display: string;
  valueNum: number | null;
  valueUnit: string | null;
  valueText: string | null;
  effectiveAt: string;
  recordedAt: string;
  provenance: Provenance;
  documentId: string | null;
};

export type DocumentRow = {
  id: string;
  kind: DocumentKind;
  title: string;
  mime: DocumentMime;
  sizeBytes: number;
  status: string;
  capturedAt: string | null;
  createdAt: string;
  provenance: Provenance;
};

export type RegisteredUpload = {
  id: string;
  bucket: string;
  path: string;
  token: string;
};

export type ConsentRow = HealthConsent;

async function reasonFromError(error: unknown): Promise<Record<string, unknown>> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") return body as Record<string, unknown>;
    } catch {
      /* unparseable body: fall through to the generic reason */
    }
  }
  return {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function healthApi<T = unknown>(
  action: HealthAction,
  payload: Record<string, unknown> = {},
): Promise<HealthResult<T>> {
  if (!HEALTH_ENABLED) {
    return {
      ok: false,
      reason: "health_disabled",
      message: safeMessage("health_disabled"),
      requestId: null,
    };
  }
  const { data, error } = await supabase.functions.invoke("health-api", {
    body: { action, ...payload },
  });
  if (error) {
    const body = await reasonFromError(error);
    const reason = str(body.reason) ?? "failed";
    return {
      ok: false,
      reason,
      message: safeMessage(reason),
      purpose: str(body.purpose),
      category: str(body.category),
      requestId: str(body.requestId) ?? null,
    };
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) {
    const reason = str(d.reason) ?? "failed";
    return {
      ok: false,
      reason,
      message: safeMessage(reason),
      purpose: str(d.purpose),
      category: str(d.category),
      requestId: str(d.requestId) ?? null,
    };
  }
  return { ok: true, data: d.data as T, requestId: str(d.requestId) ?? null };
}
