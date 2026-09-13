// One share path for the whole app. Preference order:
// 1. Capacitor Share plugin (full Android system sheet — active once the
//    v1.3 shell is installed).
// 2. navigator.share (mobile browsers).
// 3. Caller-rendered inline fallback (shareTargets) for web/old installs.
import { Capacitor } from "@capacitor/core";
import { ensureParentDir } from "@/lib/ensureDir";

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
    // `share/` FIRST. Identical trap to the save path: downloadFile does not
    // create intermediate directories and ignores `recursive` (see
    // ensureDir.ts). Both buttons broke together on the same clean reinstall,
    // because both were relying on a directory neither of them made.
    await ensureParentDir(path, Directory.Cache);

    const dl = await Filesystem.downloadFile({
      url: mediaUrl,
      path,
      directory: Directory.Cache,
      // Kept for the day the plugin honours it. It does not today.
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
): Promise<"shared" | "download-started" | "cancelled" | "failed" | "unsupported"> {
  const native = await shareMediaFile(mediaUrl, filename, p, onProgress);
  if (native !== "unsupported") return native;

  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    lastDiag = baseDiag("web-share-absent");
    return "unsupported";
  }
  // THE FILE FEATURE TEST, MOVED IN FRONT OF THE DOWNLOAD.
  //
  // `canShare` inspects the file's TYPE and SIZE class, not its bytes, so an
  // empty probe answers the same question the real File would — and asking it
  // first means a browser that cannot share files never pays for a
  // multi-megabyte download it was always going to refuse. It does NOT fix
  // activation (see below); it removes one avoidable download.
  const probe = new File([], filename, { type: "video/mp4" });
  if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [probe] })) {
    lastDiag = baseDiag("web-cannot-share-files");
    return "unsupported";
  }

  let downloaded: Blob | null = null;
  try {
    onProgress?.(null);
    const res = await fetch(mediaUrl);
    if (!res.ok) {
      lastDiag = { ...baseDiag("web-fetch-failed"), error: `http ${res.status}` };
      return "failed";
    }
    const blob = await res.blob();
    downloaded = blob;
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });
    if (!navigator.canShare({ files: [file] })) {
      // The real file can still be refused where the probe was not — a size
      // ceiling is the usual reason. Asked again rather than assumed.
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
    // THE MEASURED FAILURE. Both recorded share-video reports (2026-09-04,
    // 2026-09-11) are this exact throw:
    //   NotAllowedError — "The request is not allowed by the user agent or the
    //   platform in the current context, possibly because the user denied
    //   permission."
    // with `webShare:true, webShareFiles:true` in the same diagnostics — so the
    // browser CAN share files and refused anyway.
    //
    // WHAT THIS FILE MUST NOT CLAIM: that the cause is known. A lost transient
    // activation is the leading candidate, because the multi-megabyte `await
    // fetch` above certainly spends the activation the sheet needs. It is NOT
    // the only one — a `web-share` Permissions-Policy on the embedding
    // document, an embedded WebView's own rules, and a user-agent refusal all
    // raise the SAME NotAllowedError with the same message, and nothing
    // reachable from here separates them. The earlier stage name
    // ("web-activation-lost") asserted the diagnosis, which is how a
    // hypothesis becomes a fact that later readers stop checking.
    //
    // THE FETCH ORDER IS NOT FIXED, and cannot be from inside this function: a
    // File is required before `share` may be called, the bytes take an await
    // to obtain, and any await ends the activation window. The remedy is a
    // SECOND explicit tap on an already-prepared file — a UI change, at the
    // call site, not here.
    //
    // The film is in hand either way, so the button is not a dead end: the
    // bytes are offered as a download. A genuine cancel is caught above and
    // must NEVER reach this fallback.
    const shareRefused = e instanceof DOMException && e.name === "NotAllowedError";
    if (shareRefused && downloaded) {
      try {
        const url = URL.createObjectURL(downloaded);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        // "STARTED", NOT "SAVED". A programmatic click REQUESTS a download; it
        // cannot observe whether the browser wrote a file, whether the person
        // dismissed the prompt, or whether a download manager refused it.
        // Reporting a save this side cannot see is the same class of claim as
        // reading FCM's 200 as a handset delivery.
        lastDiag = {
          ...baseDiag("web-share-refused-download-requested"),
          error: "share refused; a download was requested",
        };
        return "download-started";
      } catch (fallbackErr) {
        lastDiag = {
          ...baseDiag("web-download-fallback-failed"),
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        };
        return "failed";
      }
    }
    lastDiag = { ...baseDiag("web-threw"), error: e instanceof Error ? e.message : String(e) };
    return "failed";
  }
}

/**
 * The two-step web share, which is the ONLY shape that keeps the activation.
 *
 * `shareVideoFile` above cannot avoid the refusal it documents: a File is
 * required before `navigator.share` may be called, obtaining the bytes takes an
 * await, and an await ends the activation window the sheet needs. The remedy is
 * structural rather than clever — prepare the file on the FIRST tap, then let a
 * SECOND tap call `share` with nothing awaited in front of it.
 *
 * Step one. Native platforms still finish in one go (their sheet takes a URI,
 * not a File, and has no activation rule), so this reports "done" for them and
 * the caller never shows a second button.
 */
export type PreparedShare =
  | { kind: "done"; outcome: "shared" | "cancelled" | "failed" | "unsupported" }
  | { kind: "ready"; file: File };

export async function prepareVideoShare(
  mediaUrl: string,
  filename: string,
  p: SharePayload,
  onProgress?: (pct: number | null) => void,
): Promise<PreparedShare> {
  const native = await shareMediaFile(mediaUrl, filename, p, onProgress);
  if (native !== "unsupported") return { kind: "done", outcome: native };

  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    lastDiag = baseDiag("web-share-absent");
    return { kind: "done", outcome: "unsupported" };
  }
  // Asked BEFORE the download, so a browser that cannot share files never pays
  // for megabytes it was always going to refuse.
  const probe = new File([], filename, { type: "video/mp4" });
  if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [probe] })) {
    lastDiag = baseDiag("web-cannot-share-files");
    return { kind: "done", outcome: "unsupported" };
  }

  try {
    onProgress?.(null);
    const res = await fetch(mediaUrl);
    if (!res.ok) {
      lastDiag = { ...baseDiag("web-fetch-failed"), error: `http ${res.status}` };
      return { kind: "done", outcome: "failed" };
    }
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type || "video/mp4" });
    if (!navigator.canShare({ files: [file] })) {
      // The real file can be refused where the empty probe was not — a size
      // ceiling is the usual reason. Asked again rather than assumed.
      lastDiag = baseDiag("web-cannot-share-files");
      return { kind: "done", outcome: "unsupported" };
    }
    return { kind: "ready", file };
  } catch (e) {
    lastDiag = { ...baseDiag("web-prepare-threw"), error: e instanceof Error ? e.message : String(e) };
    return { kind: "done", outcome: "failed" };
  }
}

/**
 * Step two. MUST be called straight out of a click handler with nothing
 * awaited in front of it — that is the whole point of the split, and an
 * `await` added above this call silently restores the bug it exists to fix.
 *
 * A CANCEL NEVER BECOMES A DOWNLOAD. Someone who dismissed the sheet chose not
 * to send it; handing them a file anyway is doing the opposite of what they
 * asked. Only a platform REFUSAL falls back, and it reports the download as
 * requested rather than saved, because this side cannot see the file land.
 */
export function shareReadyFile(
  file: File,
  p: SharePayload,
): Promise<"shared" | "cancelled" | "download-started" | "failed"> {
  let shared: Promise<void>;
  try {
    shared = navigator.share({ files: [file], title: p.title, text: p.text });
  } catch (e) {
    return Promise.resolve(afterShareThrew(e, file));
  }
  return shared.then(
    () => "shared" as const,
    (e: unknown) => afterShareThrew(e, file),
  );
}

function afterShareThrew(
  e: unknown,
  file: File,
): "cancelled" | "download-started" | "failed" {
  if (e instanceof DOMException && e.name === "AbortError") {
    lastDiag = baseDiag("web-cancelled");
    return "cancelled";
  }
  // NotAllowedError here is a genuine platform refusal — a Permissions-Policy,
  // an embedded WebView's rules, or a user-agent decision. It is NOT "the
  // activation was lost", because with this split nothing was awaited first.
  if (e instanceof DOMException && e.name === "NotAllowedError") {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      lastDiag = {
        ...baseDiag("web-share-refused-download-requested"),
        error: "share refused; a download was requested",
      };
      return "download-started";
    } catch (fallbackErr) {
      lastDiag = {
        ...baseDiag("web-download-fallback-failed"),
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      };
      return "failed";
    }
  }
  lastDiag = { ...baseDiag("web-threw"), error: e instanceof Error ? e.message : String(e) };
  return "failed";
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
