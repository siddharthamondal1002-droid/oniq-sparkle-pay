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
import androidx.core.graphics.Insets;
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

    /**
     * The window's height with NO keyboard up, measured after layout. The IME
     * padding in applyEdgeToEdgeInsets pays only the difference between this
     * and the current height — see the long note there for why the comparison
     * must be against the window's own baseline, post-layout, and not against
     * DisplayMetrics inside the insets callback.
     */
    private int noImeWindowHeight = 0;

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
     * Android 15+ (SDK 35) draws apps edge-to-edge by default. Pad the content
     * view by the top/side system-bar/cutout insets so headers never sit under
     * the status bar, but let the WebView extend BENEATH the bottom gesture/
     * navigation bar (full-bleed surfaces like Reels draw edge to edge; web UI
     * anchored to the bottom already reserves env(safe-area-inset-bottom)).
     * The keyboard (IME) inset is kept so inputs still lift above it. No-op on
     * older Android where the window already fits system bars (insets are 0).
     */
    /**
     * TRUE edge-to-edge — the window draws behind the system bars and the WEB
     * layer places content clear of them.
     *
     * WHAT THIS REPLACES, AND WHY IT WAS BACKWARDS. The previous version
     * padded the content view by the top/left/right insets and returned
     * WindowInsetsCompat.CONSUMED. Two consequences, both invisible until you
     * go looking:
     *
     *   1. CONSUMED stops the insets reaching the WebView, so every
     *      `env(safe-area-inset-*)` in the CSS read ZERO — all 54 of them,
     *      across 20-odd files. The web layer already asks for edge-to-edge
     *      (`viewport-fit=cover` is set in __root.tsx) and already writes
     *      `max(3rem, env(safe-area-inset-top))` everywhere; none of it did
     *      anything. It only looked right because every call site was written
     *      defensively with a max() fallback.
     *   2. Padding the top means the app is NOT edge-to-edge there. The strip
     *      above the content showed an opaque system bar plus a hardcoded
     *      #1a1230 purple that matches neither ONIQ theme (#0e0f13 dark,
     *      #faf9f7 light) — a leftover from an older palette. That is exactly
     *      the "don't have opaque system bars" case in the Android guidance.
     *
     * WHY THIS IS SAFE TO FLIP. The top/left/right inset does not disappear —
     * it MOVES, from here to a single rule on the app shell
     * (src/routes/_authenticated/app.tsx), which wraps all 45 screens through
     * one <main>. Doing it there rather than here is what makes it possible at
     * all: 28 of those 45 screens have no top-inset handling of their own and
     * would slide straight under the status bar if each had to fend for
     * itself.
     *
     * The bottom is deliberately still edge-to-edge, as it already was: only
     * the IME is padded, so content runs under the transparent gesture bar and
     * the web layer holds the bottom inset off its own bars.
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

        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            /*
             * PAD ONLY THE PART OF THE KEYBOARD THE WINDOW HAS NOT ALREADY
             * TAKEN.
             *
             * This line read `v.setPadding(0, 0, 0, ime.bottom)`, and on
             * 2026-08-18 that was measured subtracting the keyboard a SECOND
             * time. The chat probe, from the device, with no
             * interactive-widget anywhere in the page:
             *
             *     screenH 832   innerH 211   vvH 0   docH 200
             *
             * and the screenshot behind it divides as app 196 + a dead grey
             * band 327 + keyboard 310 = 833. The band is where this padding
             * pushed the content view off the bottom of a window that had
             * ALREADY shrunk by one keyboard: the window is 523, this made
             * the content 196.
             *
             * No manifest windowSoftInputMode is declared, so the system
             * resolves it to adjustResize and the window resizes itself. The
             * IME inset is still reported at full height regardless — that is
             * what it is for — so padding by it unconditionally double-counts
             * wherever the window resizes, and padding by nothing would leave
             * the composer under the keyboard wherever it does not.
             *
             * So measure. Whatever height the window has lost against the
             * display is keyboard the platform has already handled; this pads
             * the remainder and nothing more. Correct in both worlds, and it
             * needs no assumption about which one this device is in.
             *
             * Four fixes on the web side chased this before the probe pinned
             * it here. None of them could have worked: by the time any CSS
             * runs, the WebView is already the wrong height, and no
             * expression can recover a viewport it was handed short.
             *
             * AND THE FIRST VERSION OF THE MEASUREMENT WAS TAKEN AT THE WRONG
             * MOMENT, which is why 1.8.3 (versionCode 17) shipped this
             * arithmetic and changed nothing on the device. Two mistakes:
             *
             *   1. Insets are dispatched BEFORE the layout pass that applies
             *      the window's new size. Reading getRootView().getHeight()
             *      inside this callback returns the PRE-keyboard height, so
             *      "alreadyTaken" computed 0 and the padding fell back to the
             *      full inset — the exact double subtraction, preserved. The
             *      measurement now runs in v.post(), after the traversal this
             *      dispatch belongs to has finished laying out.
             *
             *   2. DisplayMetrics.heightPixels historically excludes system
             *      decorations on some devices, which would leak a navbar of
             *      error into the comparison. The baseline is now the
             *      window's OWN height measured while no keyboard is up —
             *      self-referential, so device quirks cancel out. It refreshes
             *      on every keyboard-less dispatch, which also keeps it right
             *      across rotation.
             */
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            final int imeBottom = ime.bottom;
            v.post(() -> {
                int rootH = v.getRootView().getHeight();
                int pad = 0;
                if (imeBottom <= 0) {
                    // No keyboard: this IS the baseline the next open compares
                    // against, and the padding must be gone.
                    noImeWindowHeight = rootH;
                } else {
                    // Whatever height the window lost since the baseline is
                    // keyboard the system already handled; pay the remainder.
                    // A zero baseline (keyboard already up at first dispatch)
                    // degrades to paying the full inset — the pre-vc17
                    // behaviour, for one keyboard cycle at worst.
                    int alreadyTaken = noImeWindowHeight > 0
                            ? Math.max(0, noImeWindowHeight - rootH)
                            : 0;
                    pad = Math.max(0, imeBottom - alreadyTaken);
                }
                if (v.getPaddingBottom() != pad) v.setPadding(0, 0, 0, pad);
            });
            // NOT CONSUMED — the WebView needs these to populate env().
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
