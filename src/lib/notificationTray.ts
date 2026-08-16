/**
 * Clear a conversation's notification once it has actually been read.
 *
 * THE GAP THIS CLOSES. Nothing ever cancelled a message notification. Only the
 * ringing-call entry (id 4242) was cancelled, by CallSettingsPlugin; a chat's
 * tray entry sat in the drawer until the user swiped it, even after they had
 * opened the chat and read every word — and it sat there on their OTHER device
 * too, which nobody had told either. Android's guidance is explicit that a
 * notification which has gone stale should be dismissed by the app rather than
 * left as tidying for the user.
 *
 * THE ID IS DERIVED IN JAVA, ON PURPOSE. OniqMessagingService turns a
 * conversation id into a notification id with a masked String.hashCode so a
 * chat occupies one tray entry. Mirroring that arithmetic here would be easy
 * and would be a second copy of a rule that has to agree EXACTLY — disagree by
 * one bit and this cancels somebody else's conversation. So the plugin takes
 * the conversation id and does the hashing on the side that owns it.
 *
 * Web builds have no plugin; every call is a silent no-op there. The browser's
 * own Notification API is a separate path and is not touched here.
 */

type TrayPlugin = { clearConversation(o: { conversationId: string }): Promise<void> };

let cached: TrayPlugin | null | undefined;

async function plugin(): Promise<TrayPlugin | null> {
  if (cached !== undefined) return cached;
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) {
      cached = null;
      return null;
    }
    const { registerPlugin } = await import(/* @vite-ignore */ "@capacitor/core");
    cached = registerPlugin<TrayPlugin>("NotificationTray");
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Best-effort, and deliberately so: a tray that refuses to be tidied is not
 * worth surfacing to the user, and never worth throwing into a render.
 */
export async function clearConversationNotification(conversationId: string): Promise<void> {
  if (!conversationId) return;
  try {
    const p = await plugin();
    await p?.clearConversation({ conversationId });
  } catch {
    /* noop */
  }
}
