import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * P11 — a slim top bar shown only while the device is offline, so a failed
 * load reads as "you're offline" rather than "there's nothing here". Mounted
 * once at the app root; renders nothing when online. Sits above everything and
 * respects the top safe-area inset so it never hides under the notch.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 bg-amber-500/95 px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] text-center text-xs font-semibold text-black shadow-md"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      You&apos;re offline — some things may not load
    </div>
  );
}
