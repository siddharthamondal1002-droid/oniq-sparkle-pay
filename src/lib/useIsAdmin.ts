/**
 * Render-level admin check, for showing an operator something a user must not
 * be offered yet.
 *
 * THIS IS PRESENTATION ONLY, and saying so matters. Every admin POWER in ONIQ
 * is gated server-side — `requireAdmin()` re-derives the caller from their JWT,
 * gpu_video_jobs is admin-only in RLS — and this hook can no more grant one
 * than a hidden button can take one away. What it decides is what somebody is
 * SHOWN.
 *
 * WHY IT EXISTS, 2026-09-04. capabilityRegistry marks a capability
 * EXPERIMENTAL until one real call proves it end to end, and the screens
 * honour that by hiding it. Weather shipped that way and produced a deadlock
 * worth writing down: the capability could not become LIVE, because the only
 * thing that would prove it is a call, and the only way to make that call was
 * through a screen the EXPERIMENTAL state was hiding. A feature that cannot be
 * exercised cannot be promoted.
 *
 * The way out is the one ONIQ already uses for exactly this — movie grade is
 * admin-only until purchased seconds learn grades, the in-house GPU tool was
 * admin-gated for a month before it opened. An unproven capability is visible
 * to an operator and invisible to everybody else. The operator exercises it,
 * the evidence lands in the registry, and only then does the row flip to LIVE
 * and the feature appear for users.
 *
 * Fails closed: no session, RPC error, offline, anything — false.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return false;
        const { data, error } = await supabase.rpc(
          "is_admin" as never,
          {
            _uid: auth.user.id,
          } as never,
        );
        if (error) return false;
        return data === true;
      } catch {
        // Any failure fails closed — the same rule useIsAdult18 follows.
        return false;
      }
    },
    staleTime: 60_000,
  });
  return data === true;
}
