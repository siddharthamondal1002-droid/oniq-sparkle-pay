import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Defaults chosen to tame the focus/reconnect refetch storm on a mobile
  // WebView (frequent foreground/background) without silencing freshness:
  //   staleTime 30s — a query refetches on focus/remount only if its data is
  //     older than 30s, so the ~76 previously stale-on-arrival queries stop
  //     refetching on every focus. Queries that need tighter freshness set
  //     their own staleTime and override this.
  //   retry 1 — an outage no longer triggers 3× exponential-backoff retries
  //     per mounted query. Per-query overrides (retry:false) still win.
  // refetchOnWindowFocus is left at its default (true): combined with the 30s
  // staleTime it refreshes genuinely-stale data on return without hammering.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
