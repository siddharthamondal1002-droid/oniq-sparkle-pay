package com.oniqhub.app;

import android.app.NotificationManager;
import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Clear a conversation's tray entry once the user has actually read it.
 *
 * THE BUG THIS FIXES. Message notifications were never cancelled by anything.
 * Open the chat, read every word, put the phone down — the entry stays in the
 * drawer until you swipe it, and it stays there on the OTHER device you were
 * not using too, because nothing tells it either. Android's guidance is
 * explicit that a notification which is no longer relevant should be
 * dismissed by the app rather than left for the user to tidy up.
 *
 * Only the CALL notification (id 4242) was ever cancelled, by
 * CallSettingsPlugin. Messages had no equivalent.
 *
 * WHY THE ID IS COMPUTED HERE and not passed in. OniqMessagingService derives
 * one notification id per conversation so a chat collapses to a single tray
 * entry that each new message replaces. That derivation — a masked Java
 * String.hashCode — is easy enough to mirror in TypeScript and would then be
 * two copies of a rule that must agree exactly or the wrong notification gets
 * cancelled. Passing the conversation id and hashing it on this side keeps
 * one copy. {@link OniqMessagingService#conversationNotificationId} is that
 * copy.
 */
@CapacitorPlugin(name = "NotificationTray")
public class NotificationTrayPlugin extends Plugin {

    @PluginMethod
    public void clearConversation(PluginCall call) {
        String conversationId = call.getString("conversationId");
        if (conversationId == null || conversationId.isEmpty()) {
            call.resolve();
            return;
        }
        try {
            Context ctx = getContext();
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(OniqMessagingService.conversationNotificationId(conversationId));
                // The group summary is not cancelled with its last child on
                // every OEM, which leaves an empty "ONIQ" header sitting in the
                // drawer. Cheap to check, and the alternative looks broken.
                OniqMessagingService.cancelSummaryIfEmpty(ctx, nm);
            }
        } catch (Throwable ignored) {
            // A tray that refuses to be tidied is not worth an error toast.
        }
        call.resolve();
    }
}
