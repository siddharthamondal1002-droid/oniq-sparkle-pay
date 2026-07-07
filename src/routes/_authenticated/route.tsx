import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession reads the locally persisted session (and auto-refreshes if
    // expired) — no network round-trip on every navigation. Only a genuinely
    // absent session redirects. This stops transient network/refresh hiccups
    // from bouncing signed-in users to /auth.
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });

    // Validate the token in the background; only force logout on a definitive
    // auth failure (revoked/invalid token), never on network errors.
    supabase.auth.getUser().then(({ error }) => {
      if (error && error.status === 401) {
        supabase.auth.signOut().then(() => {
          window.location.href = "/auth";
        });
      }
    });

    return { user: data.session.user };
  },
  component: () => <Outlet />,
});
