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
