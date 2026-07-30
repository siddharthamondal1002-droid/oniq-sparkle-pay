import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.oniqhub.app";
const SITE_OG = "https://oniqhub.com/og-image.png";

type Card = { caption: string | null; thumbnail_url: string | null; username: string | null; display_name: string | null };

/**
 * Public share route for reels. The loader runs on the SERVER for crawlers
 * (no JS execution needed) and only ever exposes PUBLIC clips via the
 * anon-callable public_reel_card RPC — moots/private reels fall back to the
 * generic site card, so nothing leaks into link previews.
 */
export const Route = createFileRoute("/r/$clipId")({
  loader: async ({ params }): Promise<{ card: Card | null; clipId: string }> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("public_reel_card", { _clip_id: params.clipId });
      const row = Array.isArray(data) ? data[0] : data;
      return { card: row ?? null, clipId: params.clipId };
    } catch {
      return { card: null, clipId: params.clipId };
    }
  },
  head: ({ loaderData }) => {
    const card = loaderData?.card;
    const who = card?.display_name ?? card?.username ?? null;
    const title = who ? `${who} on ONIQ Reels 🎬` : "ONIQ Reels 🎬";
    const desc = card?.caption?.slice(0, 160) ?? "Watch this reel on ONIQ — one app, every world.";
    const image = card?.thumbnail_url ?? SITE_OG;
    const url = `https://oniqhub.com/r/${loaderData?.clipId ?? ""}`;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:image", content: image },
        { property: "og:url", content: url },
        { property: "og:type", content: "video.other" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "description", content: desc },
      ],
    };
  },
  component: ReelLanding,
});

function ReelLanding() {
  const { card, clipId } = Route.useLoaderData();
  const [authed, setAuthed] = useState<boolean | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [clip, setClip] = useState<any | null | "denied">(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const has = !!data.session;
      setAuthed(has);
      if (has) {
        // Full row through the viewer's own RLS — private/moots reels the
        // viewer can't see render the unavailable state.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row } = await (supabase as any)
          .from("clips")
          .select("id, video_url, caption, thumbnail_url, user_id, is_deleted, profiles:profiles!clips_user_id_fkey(username, display_name)")
          .eq("id", clipId)
          .maybeSingle();
        setClip(row && !row.is_deleted ? row : "denied");
      }
    })();
  }, [clipId]);

  const handle = card?.username ?? card?.display_name;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
      {authed && clip && clip !== "denied" ? (
        <>
          <video
            src={clip.video_url}
            poster={clip.thumbnail_url ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-[70dvh] w-full rounded-2xl bg-black object-contain"
          />
          {clip.caption && <p className="mt-3 text-sm">{clip.caption}</p>}
          <p className="mt-1 text-xs text-muted-foreground">@{clip.profiles?.username ?? "user"} · ONIQ Reels</p>
          <Link
            to="/app/clips"
            className="press mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            more reels on the For You feed ✨
          </Link>
        </>
      ) : authed && clip === "denied" ? (
        <>
          <div className="grid h-16 w-16 place-items-center rounded-3xl bg-muted">
            <Play className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            this reel isn't available — it may be private, moots-only, or deleted 🙈
          </p>
          <Link to="/app" className="press mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground">
            back to ONIQ
          </Link>
        </>
      ) : (
        <>
          {card?.thumbnail_url ? (
            <img src={card.thumbnail_url} alt="" className="max-h-[46dvh] rounded-2xl object-contain" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-muted">
              <Play className="h-7 w-7 text-muted-foreground" />
            </div>
          )}
          <h1 className="mt-4 font-display text-xl font-bold">{handle ? `@${handle} on ONIQ` : "ONIQ Reels"}</h1>
          {card?.caption && <p className="mt-2 text-sm text-muted-foreground">{card.caption}</p>}
          <a
            href={PLAY_URL}
            className="press mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            Get ONIQ on Google Play 🚀
          </a>
          <Link to="/auth" className="mt-3 text-sm text-primary hover:underline">
            already have an account? sign in →
          </Link>
        </>
      )}
    </div>
  );
}
