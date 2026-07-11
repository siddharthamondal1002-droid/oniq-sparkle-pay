// Global online presence — one Supabase realtime presence channel shared
// by every consumer via the react-query cache. `usePresenceTracker` tracks
// the current user from the app shell; `useOnlineUsers` returns the read-only
// set of currently-online user_ids for any consumer (chat header, chat list).
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PRESENCE_KEY = ["presence-online"] as const;
const CHANNEL_NAME = "presence:online";

export function useOnlineUsers(): Set<string> {
  const { data } = useQuery<Set<string>>({
    queryKey: PRESENCE_KEY,
    queryFn: async () => new Set<string>(),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data ?? new Set<string>();
}

export function useIsOnline(userId: string | null | undefined): boolean {
  const set = useOnlineUsers();
  return !!userId && set.has(userId);
}

export function usePresenceTracker(userId: string | null | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) {
      qc.setQueryData(PRESENCE_KEY, new Set<string>());
      return;
    }
    const channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: userId } },
    });
    const sync = () => {
      const state = channel.presenceState();
      qc.setQueryData(PRESENCE_KEY, new Set<string>(Object.keys(state)));
    };
    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          try {
            await channel.track({ user_id: userId, online_at: new Date().toISOString() });
          } catch {
            /* noop */
          }
        }
      });
    return () => {
      try {
        channel.untrack();
      } catch {
        /* noop */
      }
      supabase.removeChannel(channel);
      qc.setQueryData(PRESENCE_KEY, new Set<string>());
    };
  }, [userId, qc]);
}
