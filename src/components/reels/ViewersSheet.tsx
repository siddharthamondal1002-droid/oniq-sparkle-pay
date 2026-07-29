import { useQuery } from "@tanstack/react-query";
import { X, Eye } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type ViewerRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  viewed_at: string;
};

/** Owner-only "seen by" list for a reel (clip_viewers RPC enforces ownership). */
export function ViewersSheet({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const { data: viewers = [], isLoading } = useQuery({
    queryKey: ["clip-viewers", clipId],
    queryFn: async (): Promise<ViewerRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("clip_viewers", { _clip_id: clipId });
      if (error) throw error;
      return (data ?? []) as ViewerRow[];
    },
  });

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[70dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-border bg-card p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold">
            <Eye className="h-4 w-4 text-primary" /> seen by {viewers.length ? `· ${viewers.length}` : ""}
          </h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">loading…</div>
          ) : viewers.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              no views yet — share it and watch this fill up ✨
            </div>
          ) : (
            viewers.map((v) => {
              const name = v.display_name ?? v.username ?? "user";
              return (
                <Link
                  key={v.user_id}
                  to="/app/u/$userId"
                  params={{ userId: v.user_id }}
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl p-2 hover:bg-muted"
                >
                  {v.avatar_url ? (
                    <img src={v.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-sm font-bold text-white">
                      {name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{name}</div>
                    {v.username && <div className="truncate text-[11px] text-muted-foreground">@{v.username}</div>}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(v.viewed_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
