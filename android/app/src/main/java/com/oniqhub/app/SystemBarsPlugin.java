package com.oniqhub.app;

import android.app.Activity;
import android.view.View;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tell Android whether the status/navigation bar icons should be drawn DARK.
 *
 * WHY THIS EXISTS AT ALL. Going edge-to-edge makes the status bar transparent,
 * so the clock, battery and notification icons are drawn straight onto
 * whatever the app is painting underneath. Android decides their colour from a
 * single flag, and it cannot read ONIQ's theme: the light/dark choice lives in
 * localStorage inside the WebView (src/lib/theme.ts) and can differ from the
 * system setting, because the app ships its own toggle.
 *
 * Get this wrong and the failure is total rather than cosmetic — light theme
 * with light icons means a WHITE clock on a #faf9f7 canvas, i.e. no clock. The
 * Android guidance treats it as one instruction with two halves ("make the
 * status bar transparent... THEN set the style of your system bar icons so
 * they have proper contrast"), and the second half is not optional.
 *
 * So the web layer, which is the only thing that knows the answer, says so.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /**
     * @param call `dark: true` when the app is painting a LIGHT surface behind
     *             the bars and therefore needs DARK icons on top of it.
     */
    @PluginMethod
    public void setIconStyle(PluginCall call) {
        final boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("dark", Boolean.FALSE));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                View decor = activity.getWindow().getDecorView();
                WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(activity.getWindow(), decor);
                c.setAppearanceLightStatusBars(darkIcons);
                // The gesture handle gets dynamic colour adaptation from the
                // system, but three-button navigation does not — it honours
                // this flag, so both are set together.
                c.setAppearanceLightNavigationBars(darkIcons);
            } catch (Throwable ignored) {
                // A device that refuses this keeps the system default, which
                // is legible more often than not. Never a reason to throw.
            }
        });
        call.resolve();
    }
}
