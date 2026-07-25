package com.oniqhub.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Deep-links to Android's per-app "Allow full-screen notifications"
 * settings page and reports whether the app currently has that grant.
 * Purely additive; no signaling side-effects.
 */
@CapacitorPlugin(name = "CallSettings")
public class CallSettingsPlugin extends Plugin {
    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        Context ctx = getContext();
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            try {
                allowed = nm != null && nm.canUseFullScreenIntent();
            } catch (Throwable t) {
                allowed = true;
            }
        }
        JSObject r = new JSObject();
        r.put("allowed", allowed);
        call.resolve(r);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        Context ctx = getContext();
        boolean opened = false;
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                i.setData(Uri.parse("package:" + ctx.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                opened = true;
            } else {
                Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                opened = true;
            }
        } catch (Throwable t) {
            opened = false;
        }
        JSObject r = new JSObject();
        r.put("opened", opened);
        call.resolve(r);
    }
}
