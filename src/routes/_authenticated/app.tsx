import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Home, MessageCircle, Compass, Wallet, User } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

type Tab = { to: string; label: string; icon: typeof Home; exact?: boolean };
const tabs: Tab[] = [
  { to: "/app", label: "Home", icon: Home, exact: true },
  { to: "/app/chat", label: "Chat", icon: MessageCircle },
  { to: "/app/discover", label: "Discover", icon: Compass },
  { to: "/app/pay", label: "Pay", icon: Wallet },
  { to: "/app/profile", label: "Profile", icon: User },
];

function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="relative mx-auto flex min-h-screen max-w-md flex-col bg-background pb-24">
      <main className="flex-1">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-3">
        <div className="grid grid-cols-5 rounded-3xl border border-border glass p-1.5 shadow-card">
          {tabs.map((t) => {
            const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                to={t.to as any}
                className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-medium transition ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
