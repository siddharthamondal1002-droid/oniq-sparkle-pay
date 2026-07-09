import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Home, MessageCircle, Compass, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUserTheme } from "@/components/customize/CustomizeSheet";
import { GlobalIncomingCall } from "@/components/chat/GlobalIncomingCall";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

type Tab = { to: string; label: string; icon: typeof Home; exact?: boolean };
const tabs: Tab[] = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/chat", label: "Chat", icon: MessageCircle },
  { to: "/app/discover", label: "Discover", icon: Compass },
  { to: "/app/profile", label: "Profile", icon: User },
];

function AppShell() {
  const { pathname } = useLocation();
  const { data: theme } = useUserTheme();
  const wallpaper = theme?.wallpaper_url ?? null;

  const isClips = pathname.startsWith("/app/clips");
  const [navVisible, setNavVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (!isClips) {
      setNavVisible(true);
      return;
    }

    // On clips: show briefly, then fade out after 1.5s
    setNavVisible(true);
    hideTimerRef.current = setTimeout(() => setNavVisible(false), 1500);

    const onTap = () => {
      setNavVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setNavVisible(false), 4000);
    };
    window.addEventListener("oniq:clips-tap", onTap);

    return () => {
      window.removeEventListener("oniq:clips-tap", onTap);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isClips]);

  const chromeClass = `transition-opacity duration-[400ms] ${
    navVisible ? "opacity-100" : "pointer-events-none opacity-0"
  }`;

  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col bg-background pb-28">
      {/* Global wallpaper layer — shows behind every /app/* screen when set.
          Sits at the shell level so the tabs remain black (clips route paints
          its own opaque overlay on top). */}
      {wallpaper && (
        <div className="pointer-events-none fixed inset-0 z-0 mx-auto max-w-md">
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

      <GlobalIncomingCall />


      {/* Fade so content dissolves into the nav instead of hard-cutting */}
      <div
        className={`pointer-events-none fixed bottom-0 left-1/2 z-30 h-28 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-background via-background/85 to-transparent ${chromeClass}`}
      />

      <nav
        className={`fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${chromeClass}`}
      >
        <div className="grid grid-cols-4 rounded-3xl border border-border glass p-1.5 shadow-card">
          {tabs.map((t) => {
            const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
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
    </div>
  );
}
