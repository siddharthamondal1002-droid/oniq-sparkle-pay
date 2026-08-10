// One share path for the whole app. Preference order:
// 1. Capacitor Share plugin (full Android system sheet — active once the
//    v1.3 shell is installed).
// 2. navigator.share (mobile browsers).
// 3. Caller-rendered inline fallback (shareTargets) for web/old installs.
import { Capacitor } from "@capacitor/core";

export type SharePayload = { title: string; text?: string; url: string };

export function canNativeShare(): boolean {
  return Capacitor.isPluginAvailable("Share");
}

/** Try the system share sheet. Returns false when the caller should show
 *  the inline fallback instead. */
export async function systemShare(p: SharePayload): Promise<boolean> {
  try {
    if (canNativeShare()) {
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

/**
 * Share the ACTUAL media file (not a link) through the OS chooser.
 * Downloads into Directory.Cache — Capacitor's FileProvider shares from
 * cache by default, which is what avoids FileUriExposedException; never
 * hand a raw file:// URI across the app boundary.
 * Native-only; returns "unsupported" on web so callers can fall back.
 */
export async function shareMediaFile(
  mediaUrl: string,
  filename: string,
  p: SharePayload,
  onProgress?: (pct: number | null) => void,
): Promise<"shared" | "cancelled" | "failed" | "unsupported"> {
  if (!canNativeShare() || !Capacitor.isPluginAvailable("Filesystem")) return "unsupported";
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const path = `share/${filename}`;
  let listener: { remove: () => Promise<void> } | null = null;
  try {
    if (onProgress) {
      onProgress(null);
      listener = await Filesystem.addListener("progress", (ev) => {
        if (ev.contentLength > 0) onProgress(Math.round((ev.bytes / ev.contentLength) * 100));
      });
    }
    const dl = await Filesystem.downloadFile({
      url: mediaUrl,
      path,
      directory: Directory.Cache,
      recursive: true,
      progress: !!onProgress,
    });
    if (!dl.path) return "failed";
    const fileUri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
    await Share.share({ title: p.title, text: p.text, dialogTitle: p.title, files: [fileUri] });
    return "shared";
  } catch (e) {
    if (e instanceof Error && /cancel/i.test(e.message)) return "cancelled";
    return "failed";
  } finally {
    if (listener) void listener.remove();
    // Best-effort cache cleanup; eviction also handles it eventually.
    try {
      const { Filesystem: FS, Directory: Dir } = await import("@capacitor/filesystem");
      void FS.deleteFile({ path, directory: Dir.Cache });
    } catch {
      /* noop */
    }
  }
}

/**
 * Share a VIDEO as an actual file, wherever the platform allows it.
 *
 * Order: Capacitor Share (native sheet — WhatsApp, Facebook, everything
 * installed), then the Web Share API with files (mobile browsers). Desktop
 * browsers land on "unsupported" and the caller shows its own guidance.
 *
 * THE URL IS NEVER SHARED AS A LINK, deliberately. Story URLs are short-lived
 * by product promise — the bytes get purged — so a link pasted into a chat
 * today is a dead link tomorrow, arriving exactly when the recipient taps it.
 * Either the FILE goes, or nothing goes.
 */
export async function shareVideoFile(
  mediaUrl: string,
  filename: string,
  p: SharePayload,
  onProgress?: (pct: number | null) => void,
): Promise<"shared" | "cancelled" | "failed" | "unsupported"> {
  const native = await shareMediaFile(mediaUrl, filename, p, onProgress);
  if (native !== "unsupported") return native;

  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return "unsupported";
  }
  try {
    onProgress?.(null);
    const res = await fetch(mediaUrl);
    if (!res.ok) return "failed";
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });
    // canShare is the feature test for FILE payloads; navigator.share existing
    // alone only proves link-sharing. Checked after the download because the
    // File object itself is part of the question being asked.
    if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) {
      return "unsupported";
    }
    await navigator.share({ files: [file], title: p.title, text: p.text });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    return "failed";
  }
}

const enc = encodeURIComponent;

/** Deep links for the inline fallback (web / installs older than v1.3).
 *  external: true → open in a new tab; sms:/mailto: must NOT use _blank. */
export function shareTargets(p: SharePayload) {
  const msg = p.text ? `${p.text}\n${p.url}` : `${p.title}\n${p.url}`;
  return [
    {
      id: "whatsapp",
      label: "WhatsApp",
      emoji: "🟢",
      href: `https://wa.me/?text=${enc(msg)}`,
      external: true,
    },
    {
      id: "telegram",
      label: "Telegram",
      emoji: "✈️",
      href: `https://t.me/share/url?url=${enc(p.url)}&text=${enc(p.text ?? p.title)}`,
      external: true,
    },
    {
      id: "x",
      label: "X",
      emoji: "✖️",
      href: `https://twitter.com/intent/tweet?text=${enc(p.text ?? p.title)}&url=${enc(p.url)}`,
      external: true,
    },
    {
      id: "facebook",
      label: "Facebook",
      emoji: "🔵",
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(p.url)}`,
      external: true,
    },
    { id: "sms", label: "SMS", emoji: "💬", href: `sms:?body=${enc(msg)}`, external: false },
    {
      id: "email",
      label: "Email",
      emoji: "✉️",
      href: `mailto:?subject=${enc(p.title)}&body=${enc(msg)}`,
      external: false,
    },
  ];
}
