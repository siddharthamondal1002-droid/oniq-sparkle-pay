import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { MessageCircle, Radio, Phone, Sparkles, Film, CircleUser } from "lucide-react";
import { CALLS_ENABLED } from "@/lib/flags";
import { useT } from "@/lib/i18n/LanguageProvider";

export const Route = createFileRoute("/_authenticated/app/chat")({
  component: ChatWorldLayout,
});

// The Calls tab follows CALLS_ENABLED: hidden while the flag is off (the
// route itself still resolves at /app/chat/calls and shows its coming-soon
// state), in the bar when it is on. "My Page" stays last either way.
const ALL_TABS = [
  {
    to: "/app/chat",
    labelKey: "chat.tab.chats",
    fallback: "Chats",
    icon: MessageCircle,
    exact: true,
  },
  {
    to: "/app/chat/moments",
    labelKey: "chat.tab.moments",
    fallback: "Moments",
    icon: Sparkles,
    exact: false,
  },
  {
    to: "/app/chat/reels",
    labelKey: "chat.tab.reels",
    fallback: "Reels",
    icon: Film,
    exact: false,
  },
  {
    to: "/app/chat/updates",
    labelKey: "chat.tab.updates",
    fallback: "Updates",
    icon: Radio,
    exact: false,
  },
  {
    to: "/app/chat/calls",
    labelKey: "chat.tab.calls",
    fallback: "Calls",
    icon: Phone,
    exact: false,
  },
  {
    to: "/app/chat/me",
    labelKey: "chat.tab.me",
    fallback: "My Page",
    icon: CircleUser,
    exact: false,
  },
] as const;

const HIDDEN = new Set<string>(CALLS_ENABLED ? [] : ["/app/chat/calls"]);
const VISIBLE_TABS = ALL_TABS.filter((t) => !HIDDEN.has(t.to));

function ChatWorldLayout() {
  const { t: tr } = useT();
  const { pathname } = useLocation();
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const showTabs = VISIBLE_TABS.some((t) =>
    t.exact ? normalized === t.to : normalized.startsWith(t.to),
  );

  const gridColsClass =
    VISIBLE_TABS.length === 6
      ? "grid-cols-6"
      : VISIBLE_TABS.length === 5
        ? "grid-cols-5"
        : VISIBLE_TABS.length === 4
          ? "grid-cols-4"
          : VISIBLE_TABS.length === 3
            ? "grid-cols-3"
            : "grid-cols-2";

  // No bottom padding here: the shell reserves the clearance for THIS nav
  // (CHAT_SECTION_CHROME in app.tsx), and it has to be the same number that
  // --app-vh subtracts. Padding it twice put dead scroll under every sub-tab.
  //
  // The bar is the same glass pill as the app's bottom nav (OniqBottomNav):
  // the active tab lifts its icon in a soft well and takes the chat world's
  // ink — data-world on the <nav> is what resolves both. py-1 (not the nav's
  // py-2) keeps the pill the height CHAT_SECTION_CHROME was sized for.
  // Logical positioning (inset-x + auto margins) so it centres under dir="rtl".
  return (
    <div>
      <Outlet />
      {showTabs && (
        <nav
          data-world="chat"
          aria-label="Chat sections"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:max-w-lg lg:max-w-xl"
        >
          <div
            className={`grid ${gridColsClass} items-end rounded-[28px] oniq-glass p-1.5 shadow-card`}
          >
            {VISIBLE_TABS.map((t) => {
              const active = t.exact ? normalized === t.to : normalized.startsWith(t.to);
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  to={t.to as any}
                  preload="intent"
                  aria-current={active ? "page" : undefined}
                  className={`press flex flex-col items-center gap-0.5 rounded-2xl py-1 text-[11px] font-medium transition-colors duration-200 ${
                    active ? "text-world" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-xl transition-all duration-200 ${
                      active ? "bg-world-soft -translate-y-0.5" : ""
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : ""}`}
                    />
                  </span>
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
