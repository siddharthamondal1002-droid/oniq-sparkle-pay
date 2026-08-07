import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.oniqhub.app";
const SITE_OG = "https://oniqhub.com/og-image.png";

type Card = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

/**
 * The revocable half of profile links — what a profile QR actually encodes.
 *
 * Deliberately shaped like /u/$userId, because it does the same job for a
 * different key: resolve, render an OG card for the scrape, send signed-in
 * visitors into the app, and offer everyone else the download.
 *
 * The difference from /u/ is the key and its lifetime. /u/<user_id> is
 * permanent. /q/<token> can be rotated, so a code printed on a poster or
 * forwarded into a group chat can be switched off. A rotated token resolves to
 * nothing and lands on the "no longer active" state below rather than a 404,
 * because "this code was turned off" and "this link is broken" are different
 * things to the person holding the phone.
 */
export const Route = createFileRoute("/q/$token")({
  loader: async ({ params }): Promise<{ card: Card | null }> => {
    try {
      // Not in the generated types yet — the function landed in migration
      // 20260807000000 and types.ts is regenerated separately. Same pattern
      // and same reason as the public_profile_card call in u.$userId.tsx.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("profile_card_by_qr_token", {
        _token: params.token,
      });
      const row = Array.isArray(data) ? data[0] : data;
      return { card: (row as Card) ?? null };
    } catch {
      return { card: null };
    }
  },
  head: ({ loaderData }) => {
    const card = loaderData?.card;
    const title = card
      ? `${card.display_name ?? card.username} (@${card.username}) · ONIQ`
      : "ONIQ";
    const desc = card?.bio?.slice(0, 160) ?? "Find them on ONIQ — one app, every world.";
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:image", content: card?.avatar_url ?? SITE_OG },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "description", content: desc },
        // No og:url. It would publish the token to every scraper, preview
        // bot and chat unfurl that touches the link, which is the opposite of
        // what a revocable code is for. /u/ can afford one; this cannot.
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: QrLanding,
});

function QrLanding() {
  const { card } = Route.useLoaderData();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      // Signed in and the code resolves — go to the in-app preview, which is
      // where the explicit Add lives. Never add anyone from a scan alone.
      if (data.session && card) {
        navigate({ to: "/app/u/$userId", params: { userId: card.user_id }, replace: true });
        return;
      }
      setChecked(true);
    })();
  }, [card, navigate]);

  if (!checked) return null;

  if (!card) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
        <span className="grid h-24 w-24 place-items-center rounded-full bg-muted text-3xl">🔄</span>
        <h1 className="mt-4 font-display text-xl font-bold">This code isn&apos;t active</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          QR codes can be refreshed by their owner, which switches off the old one. Ask them for a
          fresh code.
        </p>
        <a
          href={PLAY_URL}
          className="press mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          Get ONIQ on Google Play 🚀
        </a>
      </div>
    );
  }

  const name = card.display_name ?? card.username ?? "this user";
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
      {card.avatar_url ? (
        <img src={card.avatar_url} alt="" className="h-24 w-24 rounded-full object-cover" />
      ) : (
        <span className="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-3xl font-bold text-white">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <h1 className="mt-4 font-display text-xl font-bold">{name}</h1>
      {card.username && <p className="text-sm text-muted-foreground">@{card.username}</p>}
      {card.bio && <p className="mt-2 text-sm text-muted-foreground">{card.bio}</p>}
      <a
        href={PLAY_URL}
        className="press mt-6 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
      >
        Get ONIQ on Google Play 🚀
      </a>
      <Link to="/auth" className="mt-3 text-sm text-primary hover:underline">
        already have an account? sign in →
      </Link>
    </div>
  );
}
