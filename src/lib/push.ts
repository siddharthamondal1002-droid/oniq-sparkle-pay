// Push notification bootstrap — only runs on native Capacitor (Android/iOS).
// Web builds are unaffected: dynamic import + isNativePlatform guard.
import { supabase } from "@/integrations/supabase/client";

let initialized = false;

export async function initPush() {
  if (initialized) return;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    initialized = true;

    const { PushNotifications } = await import("@capacitor/push-notifications" as string);

    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";
    if (!granted) {
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === "granted";
    }
    if (!granted) return;

    await PushNotifications.register();

    PushNotifications.addListener("registration", async (t) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase
          .from("device_tokens")
          .upsert(
            { user_id: user.id, token: t.value, platform: "android", updated_at: new Date().toISOString() },
            { onConflict: "token" }
          );
      } catch {
        // swallow — push is best-effort
      }
    });

    PushNotifications.addListener("registrationError", () => {
      // ignore
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = (action.notification?.data as { url?: string } | undefined)?.url;
      if (url) {
        window.location.assign(url);
      }
    });
  } catch {
    // native module not available — silently no-op
  }
}
