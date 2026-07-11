// Native (Capacitor) Google OAuth deep-link handler.
// Web builds are no-ops — Google/Supabase browser redirect flow works there.
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const CALLBACK_SCHEME = "com.oniqhub.app://auth-callback";
let listenerBound = false;

function isNative(): boolean {
  try {
    // dynamic guard — @capacitor/core is safe to import top-level in web too,
    // but keep this defensive for SSR
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Capacitor } = require("@capacitor/core");
    return typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function initNativeAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  if (listenerBound) return;
  if (!isNative()) return;
  listenerBound = true;

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", async (event: { url: string }) => {
      const url = event?.url ?? "";
      if (!url.startsWith(CALLBACK_SCHEME)) return;

      try {
        const parsed = new URL(url);
        const errorParam = parsed.searchParams.get("error") || parsed.searchParams.get("error_description");
        if (errorParam) {
          toast.error(`Google sign-in failed — ${errorParam}`);
          return;
        }

        const code = parsed.searchParams.get("code");
        if (!code) {
          toast.error("Google sign-in didn't return a code — try again");
          return;
        }

        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          toast.error(`Sign-in didn't complete — ${error.message}`);
          return;
        }

        try {
          const { Browser } = await import("@capacitor/browser");
          await Browser.close();
        } catch {
          /* Browser.close is best-effort */
        }

        window.location.assign("/app");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sign-in failed");
      }
    });
  } catch (err) {
    console.error("[nativeAuth] failed to bind appUrlOpen listener", err);
  }
}
