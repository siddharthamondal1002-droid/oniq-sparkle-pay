import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { isAppHost } from "@/config/appOrigin";

/**
 * Android App Links → in-app navigation.
 * Warm start: appUrlOpen fires while the shell is alive.
 * Cold start: getLaunchUrl carries the link that launched the app.
 * Only ONIQ https links are routed; anything else is ignored. Both the www
 * host and the apex are accepted — links already shared name the apex, and
 * refusing them would break every one of them permanently.
 */
export function DeepLinkWatcher() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | null = null;

    const go = (raw: string | undefined | null) => {
      if (!raw) return;
      try {
        const u = new URL(raw);
        if (!isAppHost(u.hostname)) return;
        router.history.push(u.pathname + u.search + u.hash);
      } catch {
        /* ignore malformed */
      }
    };

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const launch = await App.getLaunchUrl();
        go(launch?.url);
        const sub = await App.addListener("appUrlOpen", (ev) => go(ev.url));
        remove = () => void sub.remove();
      } catch {
        /* plugin absent on old shells */
      }
    })();

    return () => {
      if (remove) remove();
    };
  }, [router]);

  return null;
}
