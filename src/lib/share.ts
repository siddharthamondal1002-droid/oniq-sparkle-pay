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

/**
 * Why the last share attempt ended the way it did.
 *
 * "Share doesn't work" is a report with no failure in it: every path here
 * returns a WORD ("unsupported", "failed") and throws the actual reason away,
 * so the difference between a missing plugin, a dead URL and a cancelled
 * sheet never leaves the device. This records the shape of the attempt so a
 * caller can file it, and it is deliberately just facts — no URL, because a
 * signed media URL is a credential.
 */
export type ShareDiagnostics = {
  platform: string;
  native: boolean;
  sharePlugin: boolean;
  filesystemPlugin: boolean;
  webShare: boolean;
  webShareFiles: boolean;
  /** Where it got to before it stopped. */
  stage: string;
  error?: string;
};

let lastDiag: ShareDiagnostics | null = null;

export function lastShareDiagnostics(): ShareDiagnostics | null {
  return lastDiag;
}

function baseDiag(stage: string): ShareDiagnostics {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    sharePlugin: Capacitor.isPluginAvailable("Share"),
    filesystemPlugin: Capacitor.isPluginAvailable("Filesystem"),
    webShare: typeof nav?.share === "function",
    webShareFiles: typeof nav?.canShare === "function",
    stage,
  };
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
  if (!canNativeShare() || !Capacitor.isPluginAvailable("Filesystem")) {
    lastDiag = baseDiag("native-plugins-missing");
    return "unsupported";
  }
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
    if (!dl.path) {
      lastDiag = baseDiag("download-no-path");
      return "failed";
    }
    const fileUri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
    await Share.share({ title: p.title, text: p.text, dialogTitle: p.title, files: [fileUri] });
    return "shared";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && /cancel/i.test(e.message)) {
      lastDiag = baseDiag("native-cancelled");
      return "cancelled";
    }
    // The reason lives HERE and nowhere else — downloadFile failing on a dead
    // or unreachable URL looks identical to a share sheet refusing a file
    // unless the message is kept.
    lastDiag = { ...baseDiag("native-threw"), error: msg };
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
    lastDiag = baseDiag("web-share-absent");
    return "unsupported";
  }
  try {
    onProgress?.(null);
    const res = await fetch(mediaUrl);
    if (!res.ok) {
      lastDiag = { ...baseDiag("web-fetch-failed"), error: `http ${res.status}` };
      return "failed";
    }
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });
    // canShare is the feature test for FILE payloads; navigator.share existing
    // alone only proves link-sharing. Checked after the download because the
    // File object itself is part of the question being asked.
    if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) {
      lastDiag = baseDiag("web-cannot-share-files");
      return "unsupported";
    }
    await navigator.share({ files: [file], title: p.title, text: p.text });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      lastDiag = baseDiag("web-cancelled");
      return "cancelled";
    }
    lastDiag = { ...baseDiag("web-threw"), error: e instanceof Error ? e.message : String(e) };
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
