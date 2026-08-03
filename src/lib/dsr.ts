// Data-Subject-Request client (DPDP ss.11–13).
//
// Writes go through the dsr-handler edge function (service role); reads are
// plain selects — RLS scopes public.dsr_requests to the signed-in user.
import { supabase } from "@/integrations/supabase/client";

export const DSR_SLA_DAYS = 30;
export const DSR_ERASURE_NOTICE_HOURS = 48;
export const DSR_GRACE_DAYS = 30;

export const DSR_TYPES = ["access", "correction", "erasure", "portability"] as const;
export type DsrType = (typeof DSR_TYPES)[number];

export const DSR_TYPE_LABEL: Record<DsrType, string> = {
  access: "Access my data",
  correction: "Correct my data",
  erasure: "Erase my account",
  portability: "Port my data out",
};

export type DsrStatus =
  | "received"
  | "processing"
  | "completed"
  | "soft_deleted"
  | "purged"
  | "cancelled"
  | "rejected";

export type DsrRequest = {
  id: string;
  request_type: DsrType;
  status: DsrStatus;
  details: string | null;
  created_at: string;
  sla_deadline: string;
  erasure_effective_at: string | null;
  soft_deleted_at: string | null;
  grace_expires_at: string | null;
  purged_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

/** Terminal states — a ticket in one of these is closed for good. */
export const DSR_TERMINAL: DsrStatus[] = ["completed", "cancelled", "rejected", "purged"];

/** The 30-day SLA is identical for every request type. */
export function slaDeadline(createdAt: Date | string): Date {
  const t = new Date(createdAt).getTime();
  return new Date(t + DSR_SLA_DAYS * 24 * 60 * 60 * 1000);
}

/** Erasure takes effect 48 hours after the request; null for other types. */
export function erasureEffectiveAt(requestType: DsrType, createdAt: Date | string): Date | null {
  if (requestType !== "erasure") return null;
  return new Date(new Date(createdAt).getTime() + DSR_ERASURE_NOTICE_HOURS * 60 * 60 * 1000);
}

/**
 * Cancellation is allowed up to the point of no return: while the ticket is
 * still `received`, and — for erasure — before its 48-hour window closes.
 */
export function canCancel(
  req: Pick<DsrRequest, "status" | "request_type" | "erasure_effective_at">,
  now: Date = new Date(),
): boolean {
  if (req.status !== "received") return false;
  if (req.request_type !== "erasure") return true;
  if (!req.erasure_effective_at) return true;
  return now.getTime() < new Date(req.erasure_effective_at).getTime();
}

type CreateResult = {
  ok?: boolean;
  existing?: boolean;
  request?: DsrRequest;
  export?: unknown;
};

async function invoke(body: Record<string, unknown>): Promise<CreateResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("You're signed out");
  const { data, error } = await supabase.functions.invoke("dsr-handler", {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) {
    // Surface the function's own message (legal hold, closed window, …).
    let msg = error.message;
    try {
      const ctx = (error as unknown as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) msg = j.error;
      }
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return (data ?? {}) as CreateResult;
}

export function createDsrRequest(requestType: DsrType, details?: string) {
  return invoke({ action: "create", request_type: requestType, details: details ?? null });
}

export function cancelDsrRequest(id: string) {
  return invoke({ action: "cancel", id });
}

export async function listMyDsrRequests(): Promise<DsrRequest[]> {
  const { data, error } = await supabase
    .from("dsr_requests")
    .select(
      "id, request_type, status, details, created_at, sla_deadline, erasure_effective_at, soft_deleted_at, grace_expires_at, purged_at, completed_at, cancelled_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DsrRequest[];
}

/** "1d 4h 12m" style remainder, or null once the instant has passed. */
export function countdown(target: string | Date, now: Date = new Date()): string | null {
  const ms = new Date(target).getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d ? `${d}d` : null, d || h ? `${h}h` : null, `${m}m`].filter(Boolean).join(" ");
}
