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
import { DirectionalToaster } from "@/components/DirectionalToaster";

import appCss from "../styles.css?url";
import { THEME_BOOT_SCRIPT } from "../lib/theme";
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
      {
        name: "viewport",
        /*
         * NO interactive-widget HERE. It is added at runtime for the WEB only
         * — see the effect in RootComponent.
         *
         * Having it in the static meta meant the keyboard was subtracted TWICE
         * on native, by two platform layers that each believed they were the
         * only one doing it:
         *
         *   MainActivity   pads android.R.id.content by ime.bottom, making the
         *                  WebView physically shorter.
         *   this meta      makes the WebView ALSO shrink its own layout
         *                  viewport for the same keyboard.
         *
         * On a 2000px screen with a 760px keyboard that leaves 100dvh at about
         * 480px, which is exactly the chat column measured from a screenshot on
         * 2026-08-18: header, a sliver of thread, the composer, and then a
         * keyboard-sized dead band where the native padding shows through.
         *
         * Three CSS fixes chased this in the chat file and none could reach it,
         * because by the time any stylesheet runs the viewport is already wrong.
         * The comment those fixes were written under claimed "the Android
         * WebView does not implement interactive-widget" — it does, from
         * Chromium 108, and that belief is what let both layers coexist.
         *
         * Native keeps MainActivity's padding; the web keeps the meta. Exactly
         * one of the two, on each platform.
         */
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#1a1230" },
      { title: "ONIQ — One App. Every World." },
      {
        name: "description",
        content:
          "Chat with voice and video, study for your boards, compare rides and travel, learn a language and ask an AI. One app for every world.",
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
      // dmca.com ownership verification. In the root head so it is served on
      // every route — their crawler checks whichever document it is pointed at,
      // and the badge in the footer links to the compliance page this unlocks.
      //
      // Verification of ownership only. NOT a 17 U.S.C. §512(c)(2) agent
      // designation, and confers no safe harbour. See /dmca.
      {
        name: "dmca-site-verification",
        content: "cEw5dXpzUUQ1eGNYZytybEFXamhpQT090",
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
        // Theme before first paint: a light-mode user must never see a dark
        // flash while React boots. Tiny, inline, dependency-free.
        children: THEME_BOOT_SCRIPT,
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "ONIQ",
          url: "https://oniqhub.com",
          description:
            "Chat with voice and video, study for your boards, compare rides and travel, learn a language and ask an AI. One app for every world.",

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

  /*
   * THE WEB, AND ONLY THE WEB, GETS interactive-widget=resizes-content.
   *
   * In a browser this is what shrinks the layout viewport when the keyboard
   * opens, so a bottom-anchored composer stays above it. Without it the
   * composer would sit behind the keyboard — so the web genuinely needs it.
   *
   * Native must NOT have it. MainActivity already pads the content view by the
   * IME inset, and the two together subtract the keyboard twice: 2000px screen
   * minus a 760px keyboard twice leaves 100dvh at ~480px, which is the exact
   * broken chat measured from a screenshot on 2026-08-18.
   *
   * Applied here rather than in the static meta so native NEVER carries both,
   * not even for one frame before hydration. Chrome re-evaluates the viewport
   * meta when its content attribute changes, and the keyboard is never up
   * during boot, so switching it at mount costs nothing.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled || Capacitor.isNativePlatform()) return;
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        const content = meta.getAttribute("content") ?? "";
        if (content.includes("interactive-widget")) return;
        meta.setAttribute("content", `${content}, interactive-widget=resizes-content`);
      } catch {
        // No Capacitor bundled means this is the web, which is the branch that
        // wants the flag — but a failed import must not leave the page broken,
        // and a browser without it merely keeps the default resizes-visual.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      <DirectionalToaster theme="dark" position="top-center" richColors />
    </QueryClientProvider>
  );
}
