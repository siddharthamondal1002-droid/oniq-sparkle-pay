// One share path for the whole app. Preference order:
// 1. Capacitor Share plugin (full Android system sheet — WhatsApp,
//    Bluetooth, Nearby, every installed app). Active once the native
//    shell ships with the plugin; harmless no-op check before then.
// 2. navigator.share (mobile browsers — also the full system sheet).
// 3. Caller-rendered in-app ShareSheet fallback (WhatsApp/Telegram/X/
//    Facebook/SMS/Email/copy) for WebViews without Web Share support.
import { Capacitor } from "@capacitor/core";

export type SharePayload = { title: string; text?: string; url: string };

/** Try the system share sheet. Returns false when the caller should show
 *  the in-app ShareSheet fallback instead. */
export async function systemShare(p: SharePayload): Promise<boolean> {
  try {
    if (Capacitor.isPluginAvailable("Share")) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: p.title, text: p.text, url: p.url, dialogTitle: p.title });
      return true;
    }
  } catch (e) {
    // User cancelled the native sheet — that's a completed share flow.
    if (e instanceof Error && /cancel/i.test(e.message)) return true;
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title: p.title, text: p.text, url: p.url });
      return true;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
  }
  return false;
}

const enc = encodeURIComponent;

/** Deep links for the in-app fallback sheet. */
export function shareTargets(p: SharePayload) {
  const msg = p.text ? `${p.text}\n${p.url}` : `${p.title}\n${p.url}`;
  return [
    { id: "whatsapp", label: "WhatsApp", emoji: "🟢", href: `https://wa.me/?text=${enc(msg)}` },
    { id: "telegram", label: "Telegram", emoji: "✈️", href: `https://t.me/share/url?url=${enc(p.url)}&text=${enc(p.text ?? p.title)}` },
    { id: "x", label: "X", emoji: "𝕏", href: `https://twitter.com/intent/tweet?text=${enc(p.text ?? p.title)}&url=${enc(p.url)}` },
    { id: "facebook", label: "Facebook", emoji: "🔵", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(p.url)}` },
    { id: "sms", label: "SMS", emoji: "💬", href: `sms:?body=${enc(msg)}` },
    { id: "email", label: "Email", emoji: "✉️", href: `mailto:?subject=${enc(p.title)}&body=${enc(msg)}` },
  ];
}
