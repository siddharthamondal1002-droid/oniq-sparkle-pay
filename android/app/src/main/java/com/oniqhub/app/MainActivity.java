package com.oniqhub.app;

import android.os.Bundle;


import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;

import android.os.Build;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeakerRouterPlugin.class);
        registerPlugin(ContactsBridgePlugin.class);
        registerPlugin(CallSettingsPlugin.class);

        super.onCreate(savedInstanceState);
        applyCallWindowFlags(getIntent());
        applyEdgeToEdgeInsets();
    }

    /**
     * Android 15+ (SDK 35) draws apps edge-to-edge by default. Pad the content
     * view by the system-bar/cutout insets so the WebView never renders under
     * the status or navigation bars, and keep the keyboard (IME) inset so
     * inputs still lift above it. The padded strips are painted in the app's
     * dark theme color. No-op on older Android where the window already fits
     * system bars (insets arrive as zero).
     */
    private void applyEdgeToEdgeInsets() {
        View content = findViewById(android.R.id.content);
        if (content == null) return;
        content.setBackgroundColor(Color.parseColor("#1a1230"));
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
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
        if (bridge == null || bridge.getWebView() == null) return;
        // Preserve any query string on the deep link (e.g. ?acceptCall=…) —
        // Uri.encodedPath() would encode ? and break the one-tap-answer flow.
        String target = url.startsWith("http") ? url : ("https://oniqhub.com" + url);
        final String finalTarget = target;
        runOnUiThread(() -> bridge.getWebView().loadUrl(finalTarget));
    }
}
