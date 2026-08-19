package com.oniqhub.app;

import android.os.Bundle;


import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;

import android.os.Build;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import androidx.activity.EdgeToEdge;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int REQ_AV = 4201;
    private static final int REQ_GEO = 4202;


    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeakerRouterPlugin.class);
        registerPlugin(ContactsBridgePlugin.class);
        registerPlugin(CallSettingsPlugin.class);
        registerPlugin(MediaSaverPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(NotificationTrayPlugin.class);

        super.onCreate(savedInstanceState);
        applyCallWindowFlags(getIntent());
        applyEdgeToEdgeInsets();
        requestBestRefreshRate();
        ensureNotificationChannels();
        applySystemFontScale();
    }

    /**
     * Make the system font-size setting actually do something.
     *
     * THE BUG THIS FIXES IS TOTAL, NOT COSMETIC. Android WebView does not
     * inherit the OS font scale: WebSettings.getTextZoom() is 100 and stays
     * 100 no matter what Settings > Display > Font size says. ONIQ is a
     * Capacitor shell around a web app, so until now a user who set their
     * phone to the largest font got EXACTLY NO CHANGE anywhere in the app.
     * Not smaller-than-ideal text — the accessibility control simply did
     * nothing, which is the kind of failure that never shows up in a design
     * review because the designer never turns the setting on.
     *
     * textZoom scales every text node including CSS px, which is what makes
     * this the right lever for a WebView: it reaches the app's existing
     * fixed-size type without 500 edits.
     *
     * CLAMPED AT 130%. Android offers up to 200% (2.0) and a few OEM skins go
     * further. This app has dense fixed-height rows — chip strips, the call
     * control bar, the chat composer — and past roughly 1.3 they overlap
     * rather than reflow. Honouring 130% of the request beats honouring none
     * of it, and the ceiling is stated here rather than discovered later. The
     * real fix is min-height instead of height across those rows; until that
     * lands, this is the honest limit.
     */
    private void applySystemFontScale() {
        try {
            if (bridge == null || bridge.getWebView() == null) return;
            float scale = getResources().getConfiguration().fontScale;
            if (!(scale > 0f)) return;
            if (scale > 1.3f) scale = 1.3f;
            bridge.getWebView().getSettings().setTextZoom(Math.round(scale * 100f));
        } catch (Throwable ignored) {
            // A WebView that refuses this is not a reason to fail startup.
        }
    }

    /**
     * Belt and braces for a font-scale change while the app is open.
     *
     * As the manifest stands today `fontScale` is NOT in android:configChanges,
     * so Android recreates the activity when the user drags that slider and
     * onCreate re-applies the zoom on its own. This override matters only if
     * someone later adds fontScale to that list — a one-word manifest edit
     * that would otherwise silently strip the setting back out again. It is
     * idempotent, so firing on the configChanges we DO declare costs nothing.
     */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemFontScale();
    }

    /**
     * Create both notification channels at startup. Message pushes carry an
     * FCM notification block rendered by the SYSTEM on the channel named in
     * the manifest meta-data ("oniq_messages") — if that channel doesn't
     * exist yet, FCM quietly falls back to its own "Miscellaneous" channel
     * with whatever defaults the OEM ships. The service creates channels
     * lazily, but only on code paths IT renders; the system-rendered path
     * needs them to exist before the first push ever arrives.
     */
    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel("oniq_messages") == null) {
            nm.createNotificationChannel(new android.app.NotificationChannel(
                "oniq_messages", "Messages", android.app.NotificationManager.IMPORTANCE_DEFAULT));
        }
        if (nm.getNotificationChannel("oniq_calls") == null) {
            android.app.NotificationChannel calls = new android.app.NotificationChannel(
                "oniq_calls", "Incoming calls", android.app.NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Rings your phone for incoming ONIQ voice and video calls.");
            android.net.Uri ringUri = android.media.RingtoneManager.getDefaultUri(
                android.media.RingtoneManager.TYPE_RINGTONE);
            calls.setSound(ringUri, new android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            calls.enableVibration(true);
            calls.setVibrationPattern(new long[] { 0, 800, 600, 800, 600, 800 });
            calls.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            calls.setBypassDnd(true);
            nm.createNotificationChannel(calls);
        }
    }

    /**
     * Ask the display for its fastest mode at the CURRENT resolution.
     *
     * Queried, never hardcoded. A hardcoded 120 is wrong on the 60 Hz panels
     * most of ONIQ's users actually hold, wrong on the 90 Hz ones, and would
     * still be wrong on the next device. So: enumerate the supported modes,
     * keep only those matching the resolution already in use — switching
     * resolution to chase a refresh rate would be a worse trade — and take the
     * highest rate among them. On a 60 Hz panel there is exactly one candidate
     * and this is a silent no-op.
     *
     * This is a REQUEST. The OS grants or refuses it, and refuses routinely:
     * thermal throttling, battery saver, a system-wide policy, or a foreground
     * app it would rather protect. Refusal is normal operation, not an error,
     * so nothing here reads the result back or reports failure.
     *
     * And it buys nothing on its own. A higher ceiling on frame delivery only
     * helps if frames are ready in time; the work that earns it is on the web
     * side. Nothing in the app claims a rate to the user — see the guard in
     * src/lib/__tests__/megaLoopGuardrails.test.ts, which fails the build if a
     * specific number is ever promised in copy.
     */
    private void requestBestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? getDisplay()
                : getWindowManager().getDefaultDisplay();
            if (display == null) return;

            Display.Mode current = display.getMode();
            Display.Mode[] modes = display.getSupportedModes();
            if (current == null || modes == null || modes.length < 2) return;

            Display.Mode best = current;
            for (Display.Mode m : modes) {
                if (m.getPhysicalWidth() != current.getPhysicalWidth()) continue;
                if (m.getPhysicalHeight() != current.getPhysicalHeight()) continue;
                if (m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            if (best.getModeId() == current.getModeId()) return;

            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) {
            // Never let a display-mode preference stop the app starting. The
            // app is entirely usable at whatever rate the panel gives us.
        }
    }

    /**
     * NATIVE OWNS THE INSETS AGAIN — reverted 2026-08-19 by owner decision.
     *
     * WHAT THIS FILE DID, 29 JUL – 17 AUG, AND DOES AGAIN NOW. Pad the content
     * view by the top/left/right system-bar and cutout insets AND by
     * ime.bottom, then return WindowInsetsCompat.CONSUMED. The WebView
     * therefore starts below the status bar, ends above the keyboard, and
     * never sees an inset of its own. That behaviour worked, without a single
     * layout report against it, for nineteen days.
     *
     * WHY IT WAS CHANGED ON 17 AUG, AND WHY THAT WAS NOT WRONG IN PRINCIPLE.
     * 198a3f2d stopped consuming so that env(safe-area-inset-*) would be real
     * for the first time — all 54 reads across ~20 files had been returning
     * zero, and only looked right because every call site is written
     * defensively as max(3rem, env(...)). That is a genuine improvement on
     * paper: it makes the app truly edge-to-edge and moves inset
     * responsibility to the layer that knows what it is drawing.
     *
     * WHY IT FAILED IN PRACTICE. The responsibility moved, but it landed in
     * ONE place — a single paddingTop on <main> in the app shell
     * (src/routes/_authenticated/app.tsx). Padding a container says where its
     * content STARTS, not where it may travel: the document is the scroller,
     * so on every scrolling screen the content simply rode up behind a now
     * transparent status bar. And the keyboard got worse rather than better,
     * because with insets unconsumed Chromium began resizing its own viewport
     * for the IME on top of this file's ime.bottom padding — two subtractions.
     *
     * THE 18 AUG PROBE — KEPT AS THE RECORD, NOT DELETED:
     *   view = screen 832 − padding 310 = 522 CSS
     *   innerHeight = 522 − 311 = 211
     * The WebView took a second keyboard off its own height. The window never
     * resized, which is why versionCode 17 and 18 both measured the decor
     * height, computed an "alreadyTaken" of zero, and shipped no fix.
     *
     * NET: two days of regression across the keyboard and every scrolling
     * screen, against a correctness win nobody could see. On 19 Aug the owner
     * reverted to the behaviour that demonstrably worked. Consuming is a
     * deliberate trade: env(safe-area-inset-*) goes back to zero and the
     * max() fallbacks carry the layout, exactly as they did before 17 Aug.
     *
     * The web-layer work from 17–19 Aug is intentionally LEFT IN PLACE. It is
     * self-neutralising once insets are consumed: env() reads 0 so the shell's
     * padding and the status-bar scrim collapse to nothing, --kb-inset
     * measures 0 because Chromium no longer resizes for an IME inset it never
     * receives, and interactive-widget=overlays-content governs a resize that
     * no longer happens. Nothing needs unpicking, and if this decision is ever
     * revisited the web side is already there.
     *
     * EdgeToEdge.enable(this) STAYS. It is what replaced the four deprecated
     * window setters Play flagged on release 11; that is a separate concern
     * from inset consumption and is not part of this revert.
     */

    private void applyEdgeToEdgeInsets() {
        View content = findViewById(android.R.id.content);
        if (content == null) return;

        // EdgeToEdge.enable REPLACES FOUR DEPRECATED CALLS, and the reason is
        // not tidiness — Play flagged them on release 11 (1.8), under both
        // "uses deprecated APIs or parameters for edge-to-edge" and
        // "edge-to-edge may not display for all users".
        //
        // What was here: setDecorFitsSystemWindows(false), setStatusBarColor,
        // setNavigationBarColor, and the two ContrastEnforced setters. All
        // four window setters are deprecated in API 35 and are NO-OPS from
        // API 36 — which is exactly this app's targetSdk, so on a current
        // device they were already doing nothing. They were not merely
        // untidy; they were the whole transparency mechanism on paper and
        // dead code in practice.
        //
        // Deleting them outright would have been wrong in the other
        // direction: minSdk is 24, and below API 35 those setters ARE what
        // makes the bars transparent. EdgeToEdge.enable is the API that gets
        // both halves right — it applies the modern path where it exists and
        // the legacy setters where they are still needed, so one call covers
        // 24 through 36 without a version ladder to keep in step.
        // GUARDED, LIKE EVERY OTHER DECORATIVE CALL IN THIS FILE.
        //
        // applySystemFontScale and requestBestRefreshRate both swallow their
        // failures for a stated reason: nothing cosmetic may stop the app
        // starting. This call was the one exception, and it was added in the
        // same release that started crashing on open (1.8.1, version code 12,
        // reported 2026-08-17) — the other suspect being R8, now off above.
        //
        // I cannot tell from here which of the two it was: the shipped dex has
        // no dangling class reference, so EdgeToEdge was PRESENT and this is
        // not a NoClassDefFoundError. It is guarded anyway, because the honest
        // position is that one of two changes broke startup, and the cost of
        // being wrong about which is a user whose app will not open. Bars that
        // are not transparent on some OEM skin is a visual regression; an app
        // that will not start is not a regression, it is an outage.
        //
        // If this ever does catch, the app runs without edge-to-edge rather
        // than not at all, and Play's two deprecation notes come back — which
        // is the right way round.
        try {
            EdgeToEdge.enable(this);
        } catch (Throwable t) {
            // Deliberately swallowed. See above.
        }

        // The app's own canvas shows through the bars, so it must not be a
        // colour of its own. Was #1a1230; see the note above. Still ours to
        // set — EdgeToEdge governs the bars, not the content background.
        content.setBackgroundColor(Color.TRANSPARENT);

        /*
         * NO IME PADDING. NONE. THE WEBVIEW HANDLES THE KEYBOARD ITSELF.
         *
         * The timeline that proves it, assembled 2026-08-18 after two shipped
         * builds (versionCode 17 and 18) measured the window and fixed
         * nothing:
         *
         *   Jul 29 – Aug 17   This listener padded by ime.bottom AND returned
         *                     WindowInsetsCompat.CONSUMED. The WebView never
         *                     saw an IME inset, so the padding was the ONLY
         *                     subtraction. The chat worked the whole time.
         *
         *   Aug 17            198a3f2d stopped consuming, correctly, so that
         *                     env(safe-area-inset-*) stopped reading zero.
         *                     Side effect nobody priced: the WebView now
         *                     RECEIVES the IME inset, and modern Chromium
         *                     responds by resizing its own viewport for the
         *                     keyboard. Two subtractions from that moment.
         *                     The owner reported the chat broken THAT DAY.
         *
         *   The probe agrees: view = screen 832 − padding 310 = 522 CSS, and
         *   innerHeight = 522 − 311 = 211 — the WebView took a second
         *   keyboard off its OWN height. The window never resized at all,
         *   which is why vc17/vc18's decor-height measurements both computed
         *   an "alreadyTaken" of zero and left the bug intact.
         *
         * So the padding is deleted rather than computed. The WebView,
         * demonstrably, resizes for the keyboard by itself now that the
         * insets reach it — and the insets MUST keep reaching it, or all 54
         * env() reads go back to zero. One mechanism, by construction: there
         * is no measurement here to take at the wrong moment.
         *
         * If a keyboard ever covers the composer on some device, the fix is
         * in the WEB layer (the viewport meta), never a padding here — this
         * file must stay out of the keyboard business permanently.
         */
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            // Any padding a previous build left behind is cleared, once per
            // dispatch — an updated app reuses the old activity's view state
            // across some update paths, and a stale keyboard-sized padding
            // would be the old bug wearing the new build's version number.
            if (v.getPaddingBottom() != 0) v.setPadding(0, 0, 0, 0);
            // NOT CONSUMED — the WebView needs every inset, the IME one
            // included: env(safe-area-inset-*) reads them, and the keyboard
            // resize is Chromium's to perform. See the block above.
            return insets;
        });
    }

    /**
     * When launched by the incoming-call full-screen intent (the tap intent
     * from OniqMessagingService carries "oniq_call_id"), present over the
     * lockscreen and wake the screen so the callee can answer without
     * unlocking. Without these flags the notification fires but the activity
     * stays hidden behind the keyguard.
     */
    private void applyCallWindowFlags(Intent intent) {
        if (intent == null) return;
        String callId = intent.getStringExtra("oniq_call_id");
        if (callId == null || callId.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
    }


    // Currently-shown WebView A/V request awaiting Android runtime perms.
    private PermissionRequest pendingAvRequest;
    // Additional A/V requests that arrive while one is already pending.
    private final Deque<PermissionRequest> queuedAvRequests = new ArrayDeque<>();

    // Pending geolocation prompt.
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    @Override
    public void onStart() {
        super.onStart();
        if (bridge != null && bridge.getWebView() != null) {
            // Extend BridgeWebChromeClient (not raw WebChromeClient) so Capacitor's
            // onShowFileChooser stays wired — otherwise <input type="file"> taps
            // silently no-op inside the WebView (Smart camera, Ting attach/camera).
            bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> handleAvPermissionRequest(request));
                }

                @Override
                public void onGeolocationPermissionsShowPrompt(final String origin,
                                                               final GeolocationPermissions.Callback callback) {
                    runOnUiThread(() -> handleGeoPermissionRequest(origin, callback));
                }
            });
        }
        forwardIntentUrl(getIntent());
    }

    // ---------- Camera / Microphone (WebView PermissionRequest) ----------

    private void handleAvPermissionRequest(PermissionRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;

        String[] resources = request.getResources();
        List<String> missing = new ArrayList<>();
        boolean needsCamera = false;
        boolean needsMic = false;
        for (String r : resources) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needsCamera = true;
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needsMic = true;
        }
        if (needsCamera && !hasPerm(Manifest.permission.CAMERA)) missing.add(Manifest.permission.CAMERA);
        if (needsMic && !hasPerm(Manifest.permission.RECORD_AUDIO)) missing.add(Manifest.permission.RECORD_AUDIO);

        if (missing.isEmpty()) {
            request.grant(resources);
            return;
        }

        // If another request is already awaiting result, queue this one.
        if (pendingAvRequest != null) {
            // Defensive cap: don't grow unbounded.
            if (queuedAvRequests.size() < 4) {
                queuedAvRequests.add(request);
            } else {
                request.deny();
            }
            return;
        }

        pendingAvRequest = request;
        ActivityCompat.requestPermissions(
            this,
            missing.toArray(new String[0]),
            REQ_AV
        );
    }

    // ---------- Geolocation (WebView GeolocationPermissions) ----------

    private void handleGeoPermissionRequest(String origin, GeolocationPermissions.Callback callback) {
        if (hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)
                || hasPerm(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            callback.invoke(origin, true, false);
            return;
        }

        // If already prompting, deny extras — WebView will re-ask on next use.
        if (pendingGeoCallback != null) {
            callback.invoke(origin, false, false);
            return;
        }

        pendingGeoOrigin = origin;
        pendingGeoCallback = callback;
        ActivityCompat.requestPermissions(
            this,
            new String[] {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            },
            REQ_GEO
        );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_AV) {
            final PermissionRequest req = pendingAvRequest;
            pendingAvRequest = null;
            if (req != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                // Check each requested WebView resource against actual Android perms held now.
                String[] resources = req.getResources();
                List<String> granted = new ArrayList<>();
                for (String r : resources) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                            && hasPerm(Manifest.permission.CAMERA)) {
                        granted.add(r);
                    } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                            && hasPerm(Manifest.permission.RECORD_AUDIO)) {
                        granted.add(r);
                    }
                }
                runOnUiThread(() -> {
                    if (granted.isEmpty()) {
                        req.deny();
                    } else {
                        req.grant(granted.toArray(new String[0]));
                    }
                });
            }
            // Drain one queued request (they'll re-check current perms and either
            // grant immediately or re-prompt).
            PermissionRequest next = queuedAvRequests.pollFirst();
            if (next != null) {
                runOnUiThread(() -> handleAvPermissionRequest(next));
            }
            return;
        }

        if (requestCode == REQ_GEO) {
            final String origin = pendingGeoOrigin;
            final GeolocationPermissions.Callback cb = pendingGeoCallback;
            pendingGeoOrigin = null;
            pendingGeoCallback = null;
            if (cb == null) return;
            final boolean allowed = hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)
                    || hasPerm(Manifest.permission.ACCESS_COARSE_LOCATION);
            runOnUiThread(() -> cb.invoke(origin, allowed, false));
        }
    }

    private boolean hasPerm(String p) {
        return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyCallWindowFlags(intent);
        forwardIntentUrl(intent);
    }

    /**
     * Push notifications built by OniqMessagingService set an "oniq_url" extra
     * pointing at the in-app route to open (e.g. /app/chat/<id>). Forward that
     * to the WebView by loading the site with the path appended.
     */
    private void forwardIntentUrl(Intent intent) {
        if (intent == null) return;
        String url = intent.getStringExtra("oniq_url");
        if (url == null || url.isEmpty()) return;
        intent.removeExtra("oniq_url");
        // Answering from the tray must silence the tray: the ringing
        // notification is insistent and ongoing, and nothing else cancels it —
        // phones kept ringing for the full 35s after the call was picked up.
        try {
            android.app.NotificationManager nm =
                (android.app.NotificationManager) getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(4242);
        } catch (Exception ignored) {}
        if (bridge == null || bridge.getWebView() == null) return;
        // Preserve any query string on the deep link (e.g. ?acceptCall=…) —
        // Uri.encodedPath() would encode ? and break the one-tap-answer flow.
        String target = url.startsWith("http") ? url : ("https://oniqhub.com" + url);
        final String finalTarget = target;
        final String path = url.startsWith("http") ? null : url;
        runOnUiThread(() -> {
            android.webkit.WebView wv = bridge.getWebView();
            String current = wv.getUrl();
            boolean siteLive = current != null && current.startsWith("https://oniqhub.com");
            if (siteLive && path != null) {
                // The SPA is already running: hand it the route as an event
                // instead of a full page load. loadUrl() here tore down the
                // whole JS world — including the live WebRTC session of the
                // call the user just answered from the tray.
                String js = "window.dispatchEvent(new CustomEvent('oniq:push-navigate',{detail:{url:'"
                    + path.replace("\\", "\\\\").replace("'", "\\'") + "'}}))";
                wv.evaluateJavascript(js, null);
            } else {
                wv.loadUrl(finalTarget);
            }
        });
    }
}
