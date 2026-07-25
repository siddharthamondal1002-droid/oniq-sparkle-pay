// Per-conversation mute for in-app notifications (device-local, like
// WhatsApp's mute — the chat stays visible, it just stops pinging you here).
const KEY = "oniq.chat.muted";

function readSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function isConversationMuted(conversationId: string): boolean {
  return readSet().has(conversationId);
}

/** Returns the new muted state. */
export function toggleConversationMute(conversationId: string): boolean {
  const s = readSet();
  if (s.has(conversationId)) s.delete(conversationId);
  else s.add(conversationId);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* private mode — mute just won't persist */
  }
  return s.has(conversationId);
}
