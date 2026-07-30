import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.oniqhub.app";
const SITE_OG = "https://oniqhub.com/og-image.png";

type Card = { content: string | null; media_url: string | null; username: string | null; display_name: string | null };

/** Public share route for moments — SSR OG from PUBLIC posts only; signed-in
 *  visitors are bounced straight into the app's moments feed. */
export const Route = createFileRoute("/m/$postId")({
  loader: async ({ params }): Promise<{ card: Card | null; postId: string }> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("public_moment_card", { _post_id: params.postId });
      const row = Array.isArray(data) ? data[0] : data;
      return { card: row ?? null, postId: params.postId };
    } catch {
      return { card: null, postId: params.postId };
    }
  },
  head: ({ loaderData }) => {
    const card = loaderData?.card;
    const who = card?.display_name ?? card?.username ?? null;
    const title = who ? `${who} on ONIQ Moments ✨` : "ONIQ Moments ✨";
    const desc = card?.content?.slice(0, 160) ?? "See this moment on ONIQ — one app, every world.";
    const img = card?.media_url && !/\.(mp4|webm|mov|m4a|mp3|ogg|wav)(\?|$)/i.test(card.media_url) ? card.media_url : SITE_OG;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:image", content: img },
        { property: "og:url", content: `https://oniqhub.com/m/${loaderData?.postId ?? ""}` },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "description", content: desc },
      ],
    };
  },
  component: MomentLanding,
});

function MomentLanding() {
  const { card, postId } = Route.useLoaderData();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate({ to: "/app/chat/moments", hash: `post-${postId}`, replace: true });
        return;
      }
      setChecked(true);
    })();
  }, [postId, navigate]);

  if (!checked) return null;
  const who = card?.display_name ?? card?.username;
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-accent/15">
        <Sparkles className="h-7 w-7 text-accent" />
      </div>
      <h1 className="mt-4 font-display text-xl font-bold">{who ? `${who} on ONIQ` : "ONIQ Moments"}</h1>
      {card?.content && <p className="mt-2 text-sm text-muted-foreground">{card.content}</p>}
      <a href={PLAY_URL} className="press mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground">
        Get ONIQ on Google Play 🚀
      </a>
      <Link to="/auth" className="mt-3 text-sm text-primary hover:underline">
        already have an account? sign in →
      </Link>
    </div>
  );
}
