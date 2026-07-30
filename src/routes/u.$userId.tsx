import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.oniqhub.app";
const SITE_OG = "https://oniqhub.com/og-image.png";

type Card = { username: string | null; display_name: string | null; avatar_url: string | null; bio: string | null };

/** Public share route for profiles — SSR OG card; signed-in visitors go
 *  straight to the in-app profile. */
export const Route = createFileRoute("/u/$userId")({
  loader: async ({ params }): Promise<{ card: Card | null; userId: string }> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("public_profile_card", { _user_id: params.userId });
      const row = Array.isArray(data) ? data[0] : data;
      return { card: row ?? null, userId: params.userId };
    } catch {
      return { card: null, userId: params.userId };
    }
  },
  head: ({ loaderData }) => {
    const card = loaderData?.card;
    const title = card ? `${card.display_name ?? card.username} (@${card.username}) · ONIQ` : "ONIQ";
    const desc = card?.bio?.slice(0, 160) ?? "Find them on ONIQ — one app, every world.";
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:image", content: card?.avatar_url ?? SITE_OG },
        { property: "og:url", content: `https://oniqhub.com/u/${loaderData?.userId ?? ""}` },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "description", content: desc },
      ],
    };
  },
  component: ProfileLanding,
});

function ProfileLanding() {
  const { card, userId } = Route.useLoaderData();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate({ to: "/app/u/$userId", params: { userId }, replace: true });
        return;
      }
      setChecked(true);
    })();
  }, [userId, navigate]);

  if (!checked) return null;
  const name = card?.display_name ?? card?.username ?? "this user";
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
      {card?.avatar_url ? (
        <img src={card.avatar_url} alt="" className="h-24 w-24 rounded-full object-cover" />
      ) : (
        <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-3xl font-bold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <h1 className="mt-4 font-display text-xl font-bold">{name}</h1>
      {card?.username && <p className="text-sm text-muted-foreground">@{card.username}</p>}
      {card?.bio && <p className="mt-2 text-sm text-muted-foreground">{card.bio}</p>}
      <a href={PLAY_URL} className="press mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground">
        Get ONIQ on Google Play 🚀
      </a>
      <Link to="/auth" className="mt-3 text-sm text-primary hover:underline">
        already have an account? sign in →
      </Link>
    </div>
  );
}
