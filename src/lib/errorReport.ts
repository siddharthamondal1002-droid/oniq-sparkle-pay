/**
 * Detail for admins, a pretty line for everyone else.
 *
 * `prettyFail(surface, err, pretty)` files the RAW error into
 * client_error_reports (admin-only reading, in the dashboard's errors
 * panel) and hands back the friendly sentence for the toast. One call
 * replaces the `toast.error(error.message)` habit that showed users
 * Postgres prose and attackers a map.
 *
 * Fire-and-forget by design: reporting must never turn one failure into
 * two, so the insert's own outcome is ignored.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * File a report with no user-facing message attached.
 *
 * `prettyFail` exists for the toast path — a failure the user is watching.
 * Some failures have no toast to hang off, or already have one written by
 * hand: a call that never reached ICE-connected, TURN credentials that came
 * back unusable. Those still belong in the admin panel, with the state that
 * explains them, so "calls are dropping" stops being a report we can only
 * answer by reading code.
 */
export function reportClientError(surface: string, message: string, detail?: unknown): void {
  const text =
    typeof detail === "string" ? detail : detail == null ? null : safeStringify(detail);
  try {
    void supabase
      .rpc(
        "report_client_error" as never,
        {
          _surface: surface,
          _message: message.slice(0, 500),
          _detail: text ? text.slice(0, 2000) : null,
        } as never,
      )
      .then(() => {});
  } catch {
    /* reporting must never throw */
  }
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function prettyFail(surface: string, err: unknown, pretty: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err ?? "unknown");
  const detail = err instanceof Error && err.stack ? err.stack : null;
  try {
    void supabase
      .rpc(
        "report_client_error" as never,
        {
          _surface: surface,
          _message: raw.slice(0, 500),
          _detail: detail ? detail.slice(0, 2000) : null,
        } as never,
      )
      .then(() => {});
  } catch {
    /* reporting must never throw */
  }
  return pretty;
}
