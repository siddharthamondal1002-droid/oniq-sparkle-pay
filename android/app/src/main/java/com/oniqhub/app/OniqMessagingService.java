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
    /** Group key + summary id for stacked conversation notifications. */
    private static final String MSG_GROUP = "oniq_messages_group";
    private static final int MSG_SUMMARY_ID = 4243;
    /** ONIQ teal. Tints the notification on the surfaces that honour it. */
    private static final int BRAND_TEAL = 0xFF00D4B8;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // FCM delivers MESSAGING_EVENT to exactly ONE service, and it is this
        // one — so the Capacitor plugin's own MessagingService never sees a
        // rotated token, its JS listener never fires, and device_tokens
        // quietly goes stale until send-push hits UNREGISTERED and deletes
        // the row. Forwarding to the plugin's static handler restores the
        // registration event the JS upsert listens for.
        com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String kind = data.get("kind");

        if ("call".equals(kind)) {
            // In the foreground the realtime channel already rings the in-app
            // incoming screen; stacking the insistent system ringtone on top
            // double-rings the device. The tray notification is for the app
            // you are NOT looking at.
            if (!isAppInForeground()) {
                showRingingCallNotification(data);
            }
            return;
        }

        if ("call_cancel".equals(kind)) {
            // Caller hung up (or the call was answered elsewhere) before this
            // device answered. Without this, the insistent ringing
            // notification keeps looping the ringtone for its full 35s on a
            // phone nobody can answer from anymore.
            NotificationManager nm =
                (NotificationManager) getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(CALL_NOTIFICATION_ID);
            return;
        }

        // Non-call: build a plain notification so background messages still
        // reach the tray when no notification block is present. Foreground
        // messages are already rendered by the in-app realtime UI — a tray
        // notification for the conversation you are reading is just noise.
        if (!isAppInForeground()) {
            showStandardNotification(data, message);
        }
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

        // TAP = answer: carries the deep link with ?acceptCall=… so a tray tap
        // goes straight into the call.
        Intent tap = new Intent(ctx, MainActivity.class);
        tap.setAction(Intent.ACTION_VIEW);
        tap.putExtra("oniq_url", url);
        tap.putExtra("oniq_call_id", safe(data.get("call_id"), ""));
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        // FULL-SCREEN = ring: fires by itself the moment the notification
        // posts on a locked phone. It must NOT carry the accept deep link —
        // reusing the tap intent here auto-answered calls on locked phones
        // (and forwardIntentUrl's nm.cancel killed the ringtone instantly).
        // Only oniq_call_id rides along, so MainActivity shows over the
        // lockscreen and the in-app incoming screen rings; answering stays a
        // human decision.
        Intent ring = new Intent(ctx, MainActivity.class);
        ring.setAction(Intent.ACTION_MAIN);
        ring.putExtra("oniq_call_id", safe(data.get("call_id"), ""));
        ring.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPi = PendingIntent.getActivity(ctx, 1001, tap, piFlags);
        PendingIntent fullScreenPi = PendingIntent.getActivity(ctx, 1002, ring, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_oniq)
            .setContentTitle(senderName)
            .setContentText("Incoming " + callType + " call — tap to answer")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // NOT setOngoing: with FLAG_INSISTENT the only ways to stop the
            // ringtone are answer, timeout, or dismissal — swiping the
            // notification away must remain one of them.
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

    /** Best-effort foreground check via our own process importance. */
    private boolean isAppInForeground() {
        try {
            android.app.ActivityManager.RunningAppProcessInfo info =
                new android.app.ActivityManager.RunningAppProcessInfo();
            android.app.ActivityManager.getMyMemoryState(info);
            return info.importance
                <= android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        } catch (Exception e) {
            return false;
        }
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
        // One request code + one notification id PER CONVERSATION. A shared
        // request code (2001) made Android reuse one PendingIntent for every
        // stacked notification — updated each send — so tapping an older chat's
        // notification opened whichever conversation pushed most recently. And
        // timestamp-derived notification ids stacked one tray entry per
        // message, forever; per-conversation ids collapse a chat into a single
        // entry that each new message replaces.
        String convKey = safe(data.get("conversation_id"), url);
        int convId = conversationNotificationId(convKey);
        Intent tap = new Intent(ctx, MainActivity.class);
        tap.setAction(Intent.ACTION_VIEW);
        tap.setData(Uri.parse("oniq://push/" + Uri.encode(convKey)));
        tap.putExtra("oniq_url", url);
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(ctx, convId, tap, piFlags);

        /*
         * MessagingStyle, not a plain title+text.
         *
         * This is the template Android publishes FOR real-time conversation,
         * and using it is not decoration. Three things fall out of it that the
         * old two-line notification could not do:
         *
         *   - the sender becomes a Person rather than a string, so the system
         *     can rank the notification against starred contacts and show it
         *     as a conversation;
         *   - several messages from one chat stack INSIDE one entry instead of
         *     each replacing the last. The previous build kept one tray entry
         *     per conversation, which was right, but the cost was that message
         *     four silently erased messages one to three — you saw the newest
         *     line and had no idea what you had missed;
         *   - history survives this service being killed between pushes,
         *     because it is read back off the live notification rather than
         *     held in memory here.
         */
        String sender = safe(title, "New message");
        androidx.core.app.Person person =
            new androidx.core.app.Person.Builder().setName(sender).setKey(convKey).build();

        NotificationCompat.MessagingStyle style = null;
        Notification existing = findActive(nm, convId);
        if (existing != null) {
            style = NotificationCompat.MessagingStyle
                .extractMessagingStyleFromNotification(existing);
        }
        if (style == null) {
            // "You" is the local user, and it is never shown for a one-to-one
            // chat — it only labels the display name of the conversation.
            style = new NotificationCompat.MessagingStyle(
                new androidx.core.app.Person.Builder().setName("You").build());
        }
        style.addMessage(safe(body, ""), System.currentTimeMillis(), person);

        Notification n = new NotificationCompat.Builder(ctx, MSG_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_oniq)
            .setStyle(style)
            // Ranking and filtering hint. The call path has always set its
            // category; this one never did, so Android had nothing to go on.
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // EXPLICIT, though it matches the effective default. A private
            // message must not put its text on a locked screen, and leaving
            // that to a default nobody has written down is how it changes by
            // accident later.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(BRAND_TEAL)
            .setGroup(MSG_GROUP)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();
        nm.notify(convId, n);
        postGroupSummary(ctx, nm);
    }

    /**
     * The parent entry that several conversations collapse under.
     *
     * Without it, three people messaging at once is three separate rows with
     * three identical ONIQ headers. Android only honours the group once there
     * is a summary to hang it on, which is why this posts alongside rather
     * than being implied by setGroup.
     */
    private void postGroupSummary(Context ctx, NotificationManager nm) {
        Notification summary = new NotificationCompat.Builder(ctx, MSG_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_oniq)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(BRAND_TEAL)
            .setGroup(MSG_GROUP)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .build();
        nm.notify(MSG_SUMMARY_ID, summary);
    }

    /** The live notification with this id, or null. Used to read back history. */
    private static Notification findActive(NotificationManager nm, int id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null;
        try {
            for (android.service.notification.StatusBarNotification sbn :
                    nm.getActiveNotifications()) {
                if (sbn.getId() == id) return sbn.getNotification();
            }
        } catch (Throwable ignored) {
            // getActiveNotifications throws on some OEM builds; a missing
            // history means the next message starts a fresh thread, which is
            // the old behaviour rather than a failure.
        }
        return null;
    }

    /**
     * Drop the group summary once no conversation is left under it.
     *
     * Android is meant to remove a summary with its last child and on most
     * builds does. On the ones that do not, cancelling the only chat leaves an
     * empty ONIQ header behind, which reads as a notification you cannot open.
     */
    static void cancelSummaryIfEmpty(Context ctx, NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            for (android.service.notification.StatusBarNotification sbn :
                    nm.getActiveNotifications()) {
                if (sbn.getId() != MSG_SUMMARY_ID
                    && MSG_GROUP.equals(sbn.getNotification().getGroup())) {
                    return; // a child is still there
                }
            }
            nm.cancel(MSG_SUMMARY_ID);
        } catch (Throwable ignored) {
            /* leave it rather than risk cancelling something else */
        }
    }

    /**
     * ONE notification id per conversation — the single copy of this rule.
     *
     * NotificationTrayPlugin cancels by conversation id and has to arrive at
     * exactly the same number, so it calls this rather than re-deriving it.
     * Two implementations of a hash that must agree is a bug waiting for the
     * day someone "tidies" one of them.
     */
    static int conversationNotificationId(String conversationKey) {
        return 0x20000000 | (conversationKey.hashCode() & 0x0fffffff);
    }

    private static String safe(String v, String fallback) {
        return (v == null || v.isEmpty()) ? fallback : v;
    }
}
