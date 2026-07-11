package com.oniqhub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Custom FCM service so incoming-call pushes actually RING like a phone.
 * Data-only messages with kind="call" get a full-screen intent + looping
 * ringtone on a dedicated high-importance channel. Non-call payloads fall
 * through to the default @capacitor/push-notifications handling.
 */
public class OniqMessagingService extends FirebaseMessagingService {
    private static final String CALL_CHANNEL_ID = "oniq_calls";
    private static final String MSG_CHANNEL_ID = "oniq_messages";
    private static final int CALL_NOTIFICATION_ID = 4242;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // The Capacitor plugin's own token listener handles upserts into
        // device_tokens; nothing extra needed here.
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String kind = data.get("kind");

        if ("call".equals(kind)) {
            showRingingCallNotification(data);
            return;
        }

        // Non-call: build a plain notification so background messages still
        // reach the tray when no notification block is present.
        showStandardNotification(data, message);
    }

    private void showRingingCallNotification(Map<String, String> data) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CALL_CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(
                    CALL_CHANNEL_ID,
                    "Incoming calls",
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Rings your phone for incoming ONIQ voice and video calls.");
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                channel.setSound(ringUri, attrs);
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[] { 0, 800, 600, 800, 600, 800 });
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true);
                nm.createNotificationChannel(channel);
            }
        }

        String url = safe(data.get("url"), "/app/chat");
        String senderName = safe(data.get("title"), "Someone 📞");
        String callType = safe(data.get("call_type"), "voice");

        Intent tap = new Intent(ctx, MainActivity.class);
        tap.setAction(Intent.ACTION_VIEW);
        tap.putExtra("oniq_url", url);
        tap.putExtra("oniq_call_id", safe(data.get("call_id"), ""));
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPi = PendingIntent.getActivity(ctx, 1001, tap, piFlags);
        PendingIntent fullScreenPi = PendingIntent.getActivity(ctx, 1002, tap, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(senderName)
            .setContentText("Incoming " + callType + " call — tap to answer")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setSound(ringUri, android.media.AudioManager.STREAM_RING)
            .setVibrate(new long[] { 0, 800, 600, 800, 600, 800 })
            .setTimeoutAfter(35_000L)
            .setContentIntent(contentPi)
            .setFullScreenIntent(fullScreenPi, true);

        Notification n = b.build();
        // FLAG_INSISTENT loops the ringtone until the notification is dismissed
        // or tapped — the "phone actually rings" behavior.
        n.flags |= Notification.FLAG_INSISTENT;

        nm.notify(CALL_NOTIFICATION_ID, n);
    }

    private void showStandardNotification(Map<String, String> data, RemoteMessage msg) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && nm.getNotificationChannel(MSG_CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(
                MSG_CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }

        String title = data.get("title");
        String body = data.get("body");
        RemoteMessage.Notification notif = msg.getNotification();
        if (title == null && notif != null) title = notif.getTitle();
        if (body == null && notif != null) body = notif.getBody();
        if (title == null && body == null) return;

        String url = safe(data.get("url"), "/app/chat");
        Intent tap = new Intent(ctx, MainActivity.class);
        tap.setAction(Intent.ACTION_VIEW);
        tap.putExtra("oniq_url", url);
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(ctx, 2001, tap, piFlags);

        Notification n = new NotificationCompat.Builder(ctx, MSG_CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(safe(title, "New message"))
            .setContentText(safe(body, ""))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();
        nm.notify((int) (System.currentTimeMillis() & 0x7fffffff), n);
    }

    private static String safe(String v, String fallback) {
        return (v == null || v.isEmpty()) ? fallback : v;
    }
}
