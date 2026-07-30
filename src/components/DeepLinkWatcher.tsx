import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";

/**
 * Android App Links → in-app navigation.
 * Warm start: appUrlOpen fires while the shell is alive.
 * Cold start: getLaunchUrl carries the link that launched the app.
 * Only oniqhub.com https links are routed; anything else is ignored.
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
        if (u.hostname !== "oniqhub.com") return;
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
