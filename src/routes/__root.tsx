import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeepLinkWatcher } from "@/components/DeepLinkWatcher";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background bg-hero px-4">
      <div className="max-w-md text-center">
        <h1 className="text-8xl font-bold text-gradient-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Lost in the ONIQ-verse</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That world doesn't exist yet. Head back to base.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try again or head home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-muted"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#1a1230" },
      { title: "ONIQ — One App. Every World." },
      {
        name: "description",
        content:
          "Chat, pay, watch live TV, ride, travel, learn — ONIQ is one app for every world.",
      },

      { name: "author", content: "ONIQ" },
      { property: "og:site_name", content: "ONIQ" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://oniqhub.com" },
      { property: "og:image", content: "https://oniqhub.com/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: "https://oniqhub.com/og-image.png" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "ONIQ" },
      { name: "mobile-web-app-capable", content: "yes" },
      {
        name: "google-site-verification",
        content: "TGtlOMz3P5zLi4a1ToyRj6VfsKO6sRwkiU250lMRKOI",
      },

    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700&family=Baloo+Bhai+2:wght@400;600;700&family=Baloo+Bhaijaan+2:wght@400;600;700&family=Baloo+Bhaina+2:wght@400;600;700&family=Baloo+Chettan+2:wght@400;600;700&family=Baloo+Da+2:wght@400;600;700&family=Baloo+Paaji+2:wght@400;600;700&family=Baloo+Tamma+2:wght@400;600;700&family=Baloo+Tammudu+2:wght@400;600;700&family=Baloo+Thambi+2:wght@400;600;700&family=Noto+Nastaliq+Urdu:wght@400;700&family=Noto+Sans+Sinhala:wght@400;600;700&family=Noto+Sans+SC:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&family=Noto+Sans+JP:wght@400;600;700&family=Noto+Sans+KR:wght@400;600;700&family=Noto+Sans+Thai:wght@400;600;700&display=swap",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ONIQ",
          url: "https://oniqhub.com",
          description:
            "Chat, pay, watch live TV, ride, travel, learn — ONIQ is one app for every world.",

          sameAs: [] as string[],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "ONIQ",
          url: "https://oniqhub.com",
          potentialAction: {
            "@type": "SearchAction",
            target: "https://oniqhub.com/?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        }),
      },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    // Native deep-link listener for Google OAuth callback (Chrome Custom Tab → app).
    import("@/lib/nativeAuth").then((m) => m.initNativeAuth()).catch(() => {});
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Domain-agnostic guard: register on any real HTTPS origin that isn't a
    // known preview/dev host or embedded in an iframe. Works from custom
    // domains (e.g. oniqhub.com) while still skipping Lovable previews.
    const host = window.location.hostname;
    const inIframe = window.self !== window.top;
    const isHttps = window.location.protocol === "https:";
    const isPreviewHost =
      host.startsWith("id-preview--") ||
      host.startsWith("preview--") ||
      host.endsWith(".lovableproject.com") ||
      host.endsWith(".lovableproject-dev.com") ||
      host.endsWith(".lovable.dev") ||
      host === "localhost" ||
      host === "127.0.0.1";
    if (inIframe || !isHttps || isPreviewHost) {
      // Clean up any prior registration so preview never serves cached shell.
      navigator.serviceWorker.getRegistrations?.().then((regs) =>
        regs.forEach((r) => {
          if (r.active?.scriptURL.endsWith("/sw.js")) r.unregister();
        }),
      );
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <DeepLinkWatcher />
      <Outlet />
      <Toaster theme="dark" position="top-center" richColors />
    </QueryClientProvider>
  );
}
