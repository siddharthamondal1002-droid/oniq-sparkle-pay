import { Capacitor } from "@capacitor/core";

/** Chunked base64 — a naive spread over a multi-MB buffer blows the stack. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** True when the native share sheet was dismissed rather than failing. */
export function isShareCancelled(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /cancel|abort|dismiss|share canceled/i.test(msg);
}

/** Cancellations must never be turned into a fallback attempt. */
class ShareCancelled extends Error {
  constructor() {
    super("Share cancelled");
  }
}

/** Web/last-resort delivery: navigator.share → anchor download → new tab. */
async function webDeliver(
  filename: string,
  mime: string,
  blob: Blob,
  opts?: { title?: string; text?: string },
  allowNavigatorShare = false,
): Promise<"shared" | "downloaded"> {
  if (allowNavigatorShare) {
    const file = new File([blob], filename, { type: mime });
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: opts?.title ?? filename, text: opts?.text });
      return "shared";
    }
  }

  const url = URL.createObjectURL(new Blob([blob], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

/**
 * Native hand-off: write the bytes into the app's Cache dir (scoped storage,
 * no runtime permission) and open the system share/save sheet.
 *
 * Returns null when the native path is not usable on this install — an older
 * APK shell can be missing the Filesystem/Share plugins even though the web
 * bundle imports them, which is why availability is checked before use and a
 * plugin failure falls through to the web path instead of dead-ending.
 */
async function nativeDeliver(
  filename: string,
  mime: string,
  blob: Blob,
  dialogTitle: string,
): Promise<"shared" | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (!Capacitor.isPluginAvailable("Filesystem") || !Capacitor.isPluginAvailable("Share")) {
    return null;
  }
  // Keep the OS happy: no path separators or exotic characters in the name.
  const safe = filename.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120) || "file";
  const path = `exports/${safe}`;
  try {
    const base64 = toBase64(await blob.arrayBuffer());
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache, recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: safe, dialogTitle, files: [uri] });
    return "shared";
  } catch (e) {
    if (isShareCancelled(e)) throw new ShareCancelled();
    // Plugin/provider failure — let the caller try the web path.
    console.warn("[saveFile] native delivery failed, falling back", e);
    void mime;
    return null;
  }
}

/**
 * Last resort on NATIVE: hand the signed URL to the system browser so Chrome's
 * own downloader saves it into Downloads.
 *
 * WHY THIS EXISTS AT ALL, and it is the whole bug. The web fallback below ends
 * in `<a download>` + a blob URL, and MediaSaverPlugin.java already records
 * what that does inside a Capacitor WebView: "no DownloadListener is attached,
 * so the click is swallowed silently". It is not a weak fallback, it is a
 * NO-OP — and webDeliver returns "downloaded" afterwards, so the caller shows
 * no error and the person sees a Download button that does nothing at all.
 * That exact behaviour once destroyed a film: the web layer reported success
 * and told the server to purge it.
 *
 * `@capacitor/browser` is already a dependency and needs no new native code,
 * so the URL goes to Chrome, which can genuinely download it.
 */
async function nativeBrowserDownload(url: string | undefined): Promise<boolean> {
  if (!url || !Capacitor.isNativePlatform()) return false;
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return true;
  } catch (e) {
    console.warn("[saveFile] browser download failed", e);
    return false;
  }
}

/**
 * Hand a file to the OS.
 *
 * Native: cache write + system share/save sheet, then the system browser on
 * the signed URL. It NEVER falls through to the web path, because an
 * <a download> inside a Capacitor WebView is a silent no-op — see
 * nativeBrowserDownload above. When both native routes fail this THROWS, so
 * the caller shows "Couldn't download that one" instead of a button that
 * quietly does nothing.
 *
 * Web: the ordinary anchor download, which works.
 *
 * `sourceUrl` is optional only so existing callers keep compiling; on native
 * without it there is no second chance, which is why every caller should pass
 * it — pinned in saveFileNative.test.ts.
 */
export async function deliverFile(
  filename: string,
  mime: string,
  blob: Blob,
  sourceUrl?: string,
): Promise<"shared" | "downloaded"> {
  const native = await nativeDeliver(filename, mime, blob, "Save or share file");
  if (native) return native;
  if (Capacitor.isNativePlatform()) {
    if (await nativeBrowserDownload(sourceUrl)) return "downloaded";
    throw new Error("native delivery unavailable");
  }
  return webDeliver(filename, mime, blob);
}

/**
 * Hand a file to the platform share sheet.
 *
 * Native: Capacitor Share. Web: navigator.share with files when supported;
 * otherwise a plain download so the button is never a dead end.
 */
export async function shareFile(
  filename: string,
  mime: string,
  blob: Blob,
  opts?: { title?: string; text?: string },
  sourceUrl?: string,
): Promise<"shared" | "downloaded"> {
  const native = await nativeDeliver(filename, mime, blob, opts?.title ?? filename);
  if (native) return native;
  // Same rule as deliverFile: on native the anchor cannot save anything, so
  // the browser gets the URL and a total failure is reported rather than
  // silently swallowed.
  if (Capacitor.isNativePlatform()) {
    if (await nativeBrowserDownload(sourceUrl)) return "downloaded";
    throw new Error("native delivery unavailable");
  }
  return webDeliver(filename, mime, blob, opts, true);
}
