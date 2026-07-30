import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Film, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const REEL_LINK_RE = /https:\/\/oniqhub\.com\/r\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Extract a shared-reel link from message text. Returns the clip id and the
 *  remaining note text (whatever the sender typed around the link). */
export function extractReelShare(text: string): { clipId: string; note: string } | null {
  const m = text.match(REEL_LINK_RE);
  if (!m) return null;
  return { clipId: m[1], note: text.replace(m[0], "").trim() };
}

/**
 * Reel preview bubble in chat. Reads the clip through the caller's own RLS
 * (clips_select scopes by visibility), so a recipient who can't see the
 * reel — or who loses access later — gets the unavailable card, never a
 * leaked thumbnail.
 */
export function ReelChatCard({ clipId }: { clipId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reel-card", clipId],
    staleTime: 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: clip } = await (supabase as any)
        .from("clips")
        .select("id, caption, thumbnail_url, user_id, is_deleted, profiles:profiles!clips_user_id_fkey(username, display_name)")
        .eq("id", clipId)
        .maybeSingle();
      return clip ?? null;
    },
  });

  if (isLoading) {
    return <div className="mt-1 h-40 w-32 animate-pulse rounded-xl bg-muted" aria-hidden />;
  }
  if (!data || data.is_deleted) {
    return (
      <div className="mt-1 flex w-44 items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Film className="h-4 w-4 shrink-0" /> reel unavailable 🙈
      </div>
    );
  }
  const handle = data.profiles?.username ?? data.profiles?.display_name ?? "user";
  return (
    <Link
      to="/r/$clipId"
      params={{ clipId }}
      className="mt-1 block w-36 overflow-hidden rounded-xl border border-border bg-black"
      aria-label={`Open reel by @${handle}`}
    >
      <span className="relative block aspect-[9/16]">
        {data.thumbnail_url ? (
          <img src={data.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1230] to-[#0d0a18]">
            <Film className="h-6 w-6 text-white/60" />
          </span>
        )}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-black/55">
            <Play className="h-4 w-4 text-white" />
          </span>
        </span>
      </span>
      <span className="block p-2">
        {data.caption && <span className="block truncate text-xs text-[#E6EAE9]">{data.caption}</span>}
        <span className="block text-xs text-muted-foreground">@{handle} · ONIQ Reel</span>
      </span>
    </Link>
  );
}
