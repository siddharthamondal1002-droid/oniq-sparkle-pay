// Native (Capacitor) Google OAuth deep-link handler.
// Routes through the Lovable broker (@lovable.dev/cloud-auth-js) — the
// broker redirects to <APP_ORIGIN>/auth-native-callback with
// access_token + refresh_token in the URL. Android App Links intercept and
// deliver via appUrlOpen; we complete the session and land on /app.
import { toast } from "sonner";
import { completeBrokerReturn } from "@/routes/auth-native-callback";
import { APP_HOSTS, APP_ORIGIN } from "@/config/appOrigin";

const CALLBACK_PATH = "/auth-native-callback";
const CALLBACK_HTTPS = `${APP_ORIGIN}${CALLBACK_PATH}`;
const CALLBACK_SCHEME = "com.oniqhub.app://auth-callback";

/**
 * Is this the broker coming back to us?
 *
 * Parsed rather than prefix-matched, and accepting EITHER ONIQ host. A prefix
 * test on one origin would drop a return addressed to the other, which is a
 * sign-in that hangs with no error — and the apex has to stay accepted because
 * a broker session begun before the host switch returns to it.
 */
function isCallbackUrl(raw: string): boolean {
  if (raw.startsWith(CALLBACK_SCHEME)) return true;
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      APP_HOSTS.includes(u.hostname.toLowerCase()) &&
      u.pathname === CALLBACK_PATH
    );
  } catch {
    return false;
  }
}
let listenerBound = false;

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function initNativeAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  if (listenerBound) return;
  if (!(await isNative())) return;
  listenerBound = true;

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", async (event: { url: string }) => {
      const url = event?.url ?? "";
      if (!isCallbackUrl(url)) return;

      const result = await completeBrokerReturn(url);
      if (!result.ok) {
        toast.error(`Google sign-in failed — ${result.message}`);
        return;
      }

      try {
        const { Browser } = await import("@capacitor/browser");
        await Browser.close();
      } catch {
        /* best-effort */
      }

      window.location.assign("/app");
    });
  } catch (err) {
    console.error("[nativeAuth] failed to bind appUrlOpen listener", err);
  }
}
