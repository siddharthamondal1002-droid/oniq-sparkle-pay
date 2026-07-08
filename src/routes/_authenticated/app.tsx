import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Home, MessageCircle, Compass, User } from "lucide-react";

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
  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col bg-background pb-28">
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Fade so content dissolves into the nav instead of hard-cutting */}
      <div className="pointer-events-none fixed bottom-0 left-1/2 z-30 h-28 w-full max-w-md -translate-x-1/2 bg-gradient-to-t from-background via-background/85 to-transparent" />

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-5 rounded-3xl border border-border glass p-1.5 shadow-card">
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
