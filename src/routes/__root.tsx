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
         * interactive-widget=overlays-content — ONE keyboard mechanism, the
         * same on every platform and every build state (owner decision,
         * 2026-08-19).
         *
         * It tells Chromium NOT to resize the layout viewport for the IME.
         * The keyboard then only ever occludes the VISUAL viewport, which is
         * what --kb-inset (src/lib/keyboardInset.ts) measures:
         *
         *   installed build (MainActivity still pads by ime.bottom):
         *     WebView is already 522 of 832 and sits entirely above the
         *     keyboard. clientHeight 522, visualViewport 522, --kb-inset 0.
         *     One subtraction, done by native. Correct.
         *   pending build (no native padding):
         *     WebView 832, keyboard occludes 311, visualViewport 521,
         *     --kb-inset 311, subtracted once by the chat column. Correct.
         *
         * The old default (no token) is what produced the 18 Aug probe:
         * 832 − 310 (native) → 522, then Chromium resized again → 211, a
         * keyboard-sized dead band --kb-inset could measure as 0 but never
         * recover. overlays-content removes exactly that second subtraction.
         *
         * A WebView too old to know the token ignores it and keeps today's
         * behaviour — degrades to the status quo, never to something worse.
         *
         * viewport-fit=cover is untouched, so every env(safe-area-inset-*)
         * read keeps resolving.
         */
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content",

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
      let native = false;
      try {
        const { Capacitor } = await import("@capacitor/core");
        native = Capacitor.isNativePlatform();
      } catch {
        // No Capacitor bundled means this is the web, which is the branch
        // that wants the flag. A failed import must not leave the page
        // broken, and a browser without the flag merely keeps the default
        // resizes-visual behaviour.
        native = false;
      }
      if (cancelled) return;
      const meta = document.querySelector('meta[name="viewport"]');
      if (!meta) return;
      const content = meta.getAttribute("content") ?? "";
      const has = content.includes("interactive-widget");

      /*
       * NATIVE STRIPS IT. It is not enough to leave it out of the static meta.
       *
       * Removing it from the served HTML was the right fix and it did not
       * reach the phone. A screenshot on 2026-08-18 13:37, with the probe
       * agreeing, shows the app still collapsed to ~211 of 832 CSS px with a
       * keyboard-sized dead band beneath the composer — the double
       * subtraction, unchanged, after the publish that removed the flag.
       *
       * WHY IS NOT SETTLED, AND THAT IS THE POINT. The service worker is
       * network-first, so it is not serving a stale shell; MainActivity pads
       * once and the manifest declares no windowSoftInputMode, so native
       * subtracts once. Either the WebView had simply not reloaded since the
       * publish, or the flag is arriving from somewhere this file cannot see.
       * The chat probe now records the live meta content, which will say.
       *
       * Either way, "we left it out of the markup" is a weaker guarantee than
       * "we take it off if it is there". So the flag is now removed at runtime
       * wherever native finds it, rather than merely not being added. That is
       * self-healing: the phone corrects itself on the next launch whichever
       * shell it happens to have loaded, from whatever source.
       */
      if (native && has) {
        meta.setAttribute(
          "content",
          content
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part && !part.startsWith("interactive-widget"))
            .join(", "),
        );
        return;
      }
      // The web genuinely needs it: without it a browser keyboard covers the
      // composer instead of shrinking the page.
      if (!native && !has) {
        meta.setAttribute("content", `${content}, interactive-widget=resizes-content`);
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
