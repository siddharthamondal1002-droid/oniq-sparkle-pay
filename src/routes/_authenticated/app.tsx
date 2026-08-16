import { createFileRoute, Outlet, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, MessageCircle, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserTheme } from "@/components/customize/CustomizeSheet";
import { GlobalIncomingCall } from "@/components/chat/GlobalIncomingCall";
import { GlobalCallHost } from "@/components/chat/GlobalCallHost";
import { CALLS_ENABLED } from "@/lib/flags";
import { PolicyNoticeBanner } from "@/components/safety/PolicyNoticeBanner";
import { RestrictedBanner } from "@/components/safety/RestrictedBanner";
import { DobPrompt } from "@/components/safety/DobPrompt";
import { SafeMount } from "@/components/SafeMount";
import { MiniAppReturnWatcher } from "@/components/miniapps/MiniAppReturnWatcher";
import { MessageNotifier } from "@/components/chat/MessageNotifier";
import { usePresenceTracker } from "@/hooks/usePresence";
import { useEffect } from "react";
import { initPush } from "@/lib/push";
import { syncSystemBarsOnBoot } from "@/lib/theme";
import { PermissionsOnboarding } from "@/components/onboarding/PermissionsOnboarding";
import { FullScreenIntentPrompt } from "@/components/onboarding/FullScreenIntentPrompt";
import { CallReminderWatcher } from "@/components/chat/CallReminderWatcher";
import { HealthDataWatcher } from "@/components/vitals/HealthDataWatcher";
import { LanguageProvider, useT } from "@/lib/i18n/LanguageProvider";
import { useDocumentDirection } from "@/lib/i18n/direction";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

type Tab = { to: string; labelKey: string; fallback: string; icon: typeof Home };
const tabs: Tab[] = [
  { to: "/app", labelKey: "nav.home", fallback: "Home", icon: Home },
  { to: "/app/chat", labelKey: "nav.chat", fallback: "Chat", icon: MessageCircle },
  { to: "/app/profile", labelKey: "nav.profile", fallback: "Profile", icon: User },
];

const TOP_LEVEL = new Set(["/app", "/app/profile"]);

/** Chat sub-tabs share the /app/chat/ prefix but are ordinary scrolling pages. */
const CHAT_SUBTABS = new Set([
  "/app/chat/moments",
  "/app/chat/reels",
  "/app/chat/updates",
  "/app/chat/me",
  "/app/chat/calls",
]);

function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: theme } = useUserTheme();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  usePresenceTracker(me?.id ?? null);
  useEffect(() => {
    if (me?.id) void initPush();
  }, [me?.id]);
  // The status/nav bar icons are transparent-over-app-content now, so Android
  // needs telling which way to paint them. The pre-paint script in <head>
  // applies the theme CLASS before this module exists and knows nothing about
  // native, so the boot sync belongs here — once, in the shell every screen
  // mounts through.
  useEffect(() => {
    syncSystemBarsOnBoot();
  }, []);
  // Native push taps land here as a soft navigation. MainActivity dispatches
  // this event instead of WebView.loadUrl when the SPA is already running —
  // a full page load tore down every live object, including the WebRTC call
  // the user had just answered from the tray.
  useEffect(() => {
    const onPushNavigate = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (typeof url !== "string" || !url.startsWith("/")) return;
      const [path, qs] = url.split("?");
      const search = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigate({ to: path as any, search: search as any });
      // Tray tap on a ringing call: same-route navigation won't remount
      // CallOverlay, so mirror GlobalIncomingCall's fallback event.
      const acceptCall = search?.acceptCall;
      if (acceptCall) {
        const conversationId = path.split("/").pop() ?? "";
        setTimeout(() => {
          try {
            window.dispatchEvent(
              new CustomEvent("oniq:accept-call", {
                detail: {
                  callId: acceptCall,
                  callType: search?.acceptType === "video" ? "video" : "audio",
                  conversationId,
                },
              }),
            );
          } catch {}
        }, 300);
      }
    };
    window.addEventListener("oniq:push-navigate", onPushNavigate);
    return () => window.removeEventListener("oniq:push-navigate", onPushNavigate);
  }, [navigate]);
  const wallpaper = theme?.wallpaper_url ?? null;

  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const showNav = TOP_LEVEL.has(normalized);
  // The message thread owns its own full-height column, so the shell must not
  // add slack under it. Sub-tabs keep theirs.
  const isChatThread = normalized.startsWith("/app/chat/") && !CHAT_SUBTABS.has(normalized);
  // Resolved from the HOME country's CountryConfig.dir (AE => rtl) and mirrored
  // onto <html dir>; portal roots take it from useDir() themselves.
  const dir = useDocumentDirection();

  return (
    <LanguageProvider>
      <div dir={dir} className="contents">
        {/* Desktop/tablet backdrop — subtle branded gradient behind the mobile frame */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 hidden md:block"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, color-mix(in oklab, var(--primary) 8%, transparent) 0%, transparent 60%), var(--background)",
          }}
        />
        <div
          className={`relative mx-auto flex min-h-[100dvh] max-w-md md:max-w-lg lg:max-w-xl flex-col bg-background ${showNav ? "pb-28" : isChatThread ? "pb-0" : "pb-4"}`}
        >
          {wallpaper && (
            <div className="pointer-events-none fixed inset-0 z-0 mx-auto max-w-md md:max-w-lg lg:max-w-xl">
              {/* Desaturated and dimmed in the compositor, not re-encoded: a
              family photo behind a chat is hue chaos, and text has to survive
              whatever the user picked. No blur() and no backdrop-filter — a
              full-screen live blur is the biggest jank source on cheap
              Android. translateZ promotes this to its own layer so the cost
              is one rasterisation for the life of the screen. */}
              <img
                src={wallpaper}
                alt=""
                className="h-full w-full object-cover"
                style={{ filter: "saturate(0.7) brightness(0.85)", transform: "translateZ(0)" }}
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
              {/* Flat scrim. 0.55 over #0E0F13 is the smallest single overlay that
              keeps white text at 4.5:1 over an ARBITRARY photo — including the
              pure-white regions the old 0.20 midpoint failed on. */}
              <div className="absolute inset-0 bg-background/55" />
              {/* Edge scrim under the header and composer. Neutral black, not the
              background token: this is shadow, and it must not tint. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 18%, rgba(0,0,0,0) 76%, rgba(0,0,0,0.50) 100%)",
                }}
              />
            </div>
          )}

          {/*
            THE SAFE AREA, HELD IN ONE PLACE.

            Android's shell used to pad its content view by the top/left/right
            insets and swallow them. That is gone (MainActivity.applyEdgeToEdgeInsets):
            the window is edge-to-edge now, the bars are transparent, and the
            insets reach the WebView so `env(safe-area-inset-*)` is real for
            the first time — the CSS has asked for this all along via
            `viewport-fit=cover`, and got zeroes.

            It lands HERE rather than on each screen because 28 of the 45
            screens under this Outlet carry no top-inset handling of their own
            and would slide under the status bar. One <main> covers them all,
            and the arithmetic is deliberately unchanged for the 17 that DO
            handle it: they use `max(3rem, env(...))`, which still resolves to
            3rem on top of this padding, exactly as it did when the shell
            supplied the inset natively.

            LEFT AND RIGHT ARE NEW. Nothing in the web layer has ever read
            safe-area-inset-left/right — the native padding was quietly
            covering display cutouts in landscape. Dropping that padding
            without this would have put a notch through the call UI.
          */}
          <main
            className="relative z-10 flex-1"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingInlineStart: "env(safe-area-inset-left)",
              paddingInlineEnd: "env(safe-area-inset-right)",
            }}
          >
            <Outlet />
          </main>

          {CALLS_ENABLED && <GlobalIncomingCall />}
          {CALLS_ENABLED && <GlobalCallHost />}
          {/* Non-call global mounts are individually contained: a throw inside a
          banner/prompt/watcher must never reach the root error boundary. Call
          mounts are deliberately left untouched. */}
          <SafeMount name="PolicyNoticeBanner">
            <PolicyNoticeBanner />
          </SafeMount>
          <SafeMount name="RestrictedBanner">
            <RestrictedBanner />
          </SafeMount>
          <SafeMount name="DobPrompt">
            <DobPrompt />
          </SafeMount>
          <SafeMount name="MiniAppReturnWatcher">
            <MiniAppReturnWatcher />
          </SafeMount>
          <SafeMount name="MessageNotifier">
            <MessageNotifier />
          </SafeMount>
          <SafeMount name="PermissionsOnboarding">
            <PermissionsOnboarding />
          </SafeMount>
          <SafeMount name="FullScreenIntentPrompt">
            <FullScreenIntentPrompt />
          </SafeMount>
          <SafeMount name="CallReminderWatcher">
            <CallReminderWatcher />
          </SafeMount>
          <SafeMount name="HealthDataWatcher">
            <HealthDataWatcher />
          </SafeMount>

          {showNav && (
            <>
              <div className="pointer-events-none fixed bottom-0 left-1/2 z-30 h-28 w-full max-w-md md:max-w-lg lg:max-w-xl -translate-x-1/2 bg-gradient-to-t from-background via-background/85 to-transparent" />
              <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md md:max-w-lg lg:max-w-xl -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-3 rounded-3xl border border-border glass p-1.5 shadow-card">
                  {tabs.map((t) => {
                    const active =
                      t.to === "/app" ? normalized === "/app" : normalized.startsWith(t.to);
                    const Icon = t.icon;
                    return (
                      <Link
                        key={t.to}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        to={t.to as any}
                        preload="intent"
                        className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-medium transition-all duration-200 ease-out active:scale-95 ${
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`}
                        />
                        <NavLabel labelKey={t.labelKey} fallback={t.fallback} />
                      </Link>
                    );
                  })}
                </div>
              </nav>
            </>
          )}
        </div>
      </div>
    </LanguageProvider>
  );
}

function NavLabel({ labelKey, fallback }: { labelKey: string; fallback: string }) {
  const { t } = useT();
  return <>{t(labelKey, fallback)}</>;
}
