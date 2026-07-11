// Native (Capacitor) Google OAuth deep-link handler.
// Routes through the Lovable broker (@lovable.dev/cloud-auth-js) — the
// broker redirects to https://oniqhub.com/auth-native-callback with
// access_token + refresh_token in the URL. Android App Links intercept and
// deliver via appUrlOpen; we complete the session and land on /app.
import { toast } from "sonner";
import { completeBrokerReturn } from "@/routes/auth-native-callback";

const CALLBACK_HTTPS = "https://oniqhub.com/auth-native-callback";
const CALLBACK_SCHEME = "com.oniqhub.app://auth-callback";
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
      if (!url.startsWith(CALLBACK_HTTPS) && !url.startsWith(CALLBACK_SCHEME)) return;

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
