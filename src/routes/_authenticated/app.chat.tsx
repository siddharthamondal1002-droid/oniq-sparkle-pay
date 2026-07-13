import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { MessageCircle, Radio, Phone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/chat")({
  component: ChatWorldLayout,
});

const TABS = [
  { to: "/app/chat", label: "Chats", icon: MessageCircle, exact: true },
  { to: "/app/chat/updates", label: "Updates", icon: Radio, exact: false },
  { to: "/app/chat/calls", label: "Calls", icon: Phone, exact: false },
] as const;

function ChatWorldLayout() {
  const { pathname } = useLocation();
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const showTabs =
    normalized === "/app/chat" ||
    normalized === "/app/chat/updates" ||
    normalized === "/app/chat/calls";

  return (
    <div className={showTabs ? "pb-24" : ""}>
      <Outlet />
      {showTabs && (
        <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-3 rounded-3xl border border-border glass p-1.5 shadow-card">
            {TABS.map((t) => {
              const active = t.exact ? normalized === t.to : normalized.startsWith(t.to);
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  to={t.to as any}
                  preload="intent"
                  className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-medium transition-all duration-200 ease-out active:scale-95 ${
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
