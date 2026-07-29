import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { MessageCircle, Radio, Phone, Sparkles, Film, CircleUser } from "lucide-react";
import { CALLS_ENABLED } from "@/lib/flags";
import { useT } from "@/lib/i18n/LanguageProvider";

export const Route = createFileRoute("/_authenticated/app/chat")({
  component: ChatWorldLayout,
});

// Calls tab is intentionally hidden from the visible tab bar (route still resolves at /app/chat/calls).
// To restore, add it back to VISIBLE_TABS below.
const ALL_TABS = [
  { to: "/app/chat", labelKey: "chat.tab.chats", fallback: "Chats", icon: MessageCircle, exact: true },
  { to: "/app/chat/moments", labelKey: "chat.tab.moments", fallback: "Moments", icon: Sparkles, exact: false },
  { to: "/app/chat/reels", labelKey: "chat.tab.reels", fallback: "Reels", icon: Film, exact: false },
  { to: "/app/chat/updates", labelKey: "chat.tab.updates", fallback: "Updates", icon: Radio, exact: false },
  { to: "/app/chat/me", labelKey: "chat.tab.me", fallback: "My Page", icon: CircleUser, exact: false },
  { to: "/app/chat/calls", labelKey: "chat.tab.calls", fallback: "Calls", icon: Phone, exact: false },
] as const;

const HIDDEN = new Set<string>(["/app/chat/calls"]);
const VISIBLE_TABS = ALL_TABS.filter((t) => !HIDDEN.has(t.to));
// CALLS_ENABLED is preserved for future re-enable; unused referenced to prevent lint noise.
void CALLS_ENABLED;

function ChatWorldLayout() {
  const { t: tr } = useT();
  const { pathname } = useLocation();
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const showTabs = VISIBLE_TABS.some((t) =>
    t.exact ? normalized === t.to : normalized.startsWith(t.to),
  );

  const gridColsClass =
    VISIBLE_TABS.length === 5 ? "grid-cols-5"
    : VISIBLE_TABS.length === 4 ? "grid-cols-4"
    : VISIBLE_TABS.length === 3 ? "grid-cols-3"
    : "grid-cols-2";

  return (
    <div className={showTabs ? "pb-24" : ""}>
      <Outlet />
      {showTabs && (
        <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className={`grid ${gridColsClass} rounded-3xl border border-border glass p-1.5 shadow-card`}>
            {VISIBLE_TABS.map((t) => {
              const active = t.exact ? normalized === t.to : normalized.startsWith(t.to);
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  to={t.to as any}
                  preload="intent"
                  className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] font-medium transition-all duration-200 ease-out active:scale-95 ${
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                  <span className="leading-none">{tr(t.labelKey, t.fallback)}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
