/**
 * Render-level 18+ check. Reads the fail-closed `public.is_adult_18(uuid)`
 * gate — never `is_minor_account()`, whose threshold is 13 in six of seven
 * countries. Any failure (no session, no DOB, RPC error) resolves to false,
 * so age-restricted tiles stay hidden by default.
 *
 * This is presentation only. The server-side data gates still apply.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdult18(): boolean {
  const { data } = useQuery({
    queryKey: ["is-adult-18"],
    queryFn: async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return false;
        const { data, error } = await supabase.rpc("is_adult_18" as never, {
          _uid: auth.user.id,
        } as never);
        if (error) return false;
        return data === true;
      } catch {
        // Any failure (no session, offline, RPC missing) fails closed.
        return false;
      }
    },
    staleTime: 60_000,
  });
  return data === true;
}
