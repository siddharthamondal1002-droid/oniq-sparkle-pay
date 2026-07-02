import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw redirect({ to: "/auth" });
      return { user };
    }

    const { data } = await supabase.auth.getUser();
    return { user: data.user ?? session.user };
  },
  component: () => <Outlet />,
});
