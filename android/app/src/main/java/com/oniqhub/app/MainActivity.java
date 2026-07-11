package com.oniqhub.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onStart() {
        super.onStart();
        // Grant WebView-level permission requests (mic/camera) from our origin
        // so getUserMedia inside the Capacitor WebView doesn't silently fail
        // even after the Android runtime permission is granted.
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            request.grant(request.getResources());
                        }
                    });
                }
            });
        }
        forwardIntentUrl(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
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
        // Build absolute URL against the configured server origin.
        Uri base = Uri.parse("https://oniqhub.com");
        String target = url.startsWith("http") ? url : base.buildUpon().encodedPath(url).build().toString();
        final String finalTarget = target;
        runOnUiThread(() -> bridge.getWebView().loadUrl(finalTarget));
    }
}
