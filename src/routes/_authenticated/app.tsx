import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, MessageCircle, Compass, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserTheme } from "@/components/customize/CustomizeSheet";
import { GlobalIncomingCall } from "@/components/chat/GlobalIncomingCall";
import { GlobalCallHost } from "@/components/chat/GlobalCallHost";
import { CALLS_ENABLED } from "@/lib/flags";
import { PolicyNoticeBanner } from "@/components/safety/PolicyNoticeBanner";
import { MiniAppReturnWatcher } from "@/components/miniapps/MiniAppReturnWatcher";
import { MessageNotifier } from "@/components/chat/MessageNotifier";
import { usePresenceTracker } from "@/hooks/usePresence";
import { useEffect } from "react";
import { initPush } from "@/lib/push";
import { PermissionsOnboarding } from "@/components/onboarding/PermissionsOnboarding";


export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

type Tab = { to: string; label: string; icon: typeof Home };
const tabs: Tab[] = [
  { to: "/app", label: "Home", icon: Home },
  { to: "/app/chat", label: "Chat", icon: MessageCircle },
  { to: "/app/discover", label: "Discover", icon: Compass },
  { to: "/app/profile", label: "Profile", icon: User },
];

const TOP_LEVEL = new Set(["/app", "/app/discover", "/app/profile"]);

function AppShell() {
  const { pathname } = useLocation();
  const { data: theme } = useUserTheme();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  usePresenceTracker(me?.id ?? null);
  useEffect(() => { if (me?.id) void initPush(); }, [me?.id]);
  const wallpaper = theme?.wallpaper_url ?? null;

  const normalized = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
  const showNav = TOP_LEVEL.has(normalized);

  return (
    <>
      {/* Desktop/tablet backdrop — subtle branded gradient behind the mobile frame */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 hidden md:block"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, color-mix(in oklab, var(--primary) 8%, transparent) 0%, transparent 60%), var(--background)",
        }}
      />
    <div className={`relative mx-auto flex min-h-screen max-w-md md:max-w-lg lg:max-w-xl flex-col bg-background ${showNav ? "pb-28" : "pb-4"}`}>
      {wallpaper && (
        <div className="pointer-events-none fixed inset-0 z-0 mx-auto max-w-md md:max-w-lg lg:max-w-xl">
          <img
            src={wallpaper}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/35 via-background/20 to-background/60" />
        </div>
      )}

      <main className="relative z-10 flex-1">
        <Outlet />
      </main>

      {CALLS_ENABLED && <GlobalIncomingCall />}
      {CALLS_ENABLED && <GlobalCallHost />}
      <PolicyNoticeBanner />
      <MiniAppReturnWatcher />
      <MessageNotifier />
      <PermissionsOnboarding />


      {showNav && (
        <>
          <div className="pointer-events-none fixed bottom-0 left-1/2 z-30 h-28 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-background via-background/85 to-transparent" />
          <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-4 rounded-3xl border border-border glass p-1.5 shadow-card">
              {tabs.map((t) => {
                const active = t.to === "/app" ? normalized === "/app" : normalized.startsWith(t.to);
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
                    <Icon className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                    {t.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

