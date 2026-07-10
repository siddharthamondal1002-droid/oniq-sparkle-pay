import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { consumePendingReturn } from "@/lib/miniapps";

/**
 * Listens for the user coming back to ONIQ after switching to an external
 * mini-app. If a pending return exists within 30 minutes, we land the user
 * on /app (home) and greet them back. Mount once at the AppShell.
 */
export function MiniAppReturnWatcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const pending = consumePendingReturn();
      if (!pending) return;
      if (pathname !== "/app") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ to: "/app" as any });
      }
      toast(`welcome back 👋 hope ${pending.app} treated you well`);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [navigate, pathname]);

  return null;
}
