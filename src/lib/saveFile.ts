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

/**
 * Hand a file to the OS.
 *
 * Native: an <a download> cannot save anything inside a Capacitor WebView —
 * there is no download manager behind it. We write the bytes into the app's
 * Cache dir (scoped storage: no runtime permission needed) and open the
 * system share/save sheet.
 *
 * Web: the ordinary anchor download.
 *
 * Errors propagate — the caller decides what to tell the user.
 */
export async function deliverFile(
  filename: string,
  mime: string,
  blob: Blob,
): Promise<"shared" | "downloaded"> {
  if (Capacitor.isNativePlatform()) {
    const base64 = toBase64(await blob.arrayBuffer());
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const path = `exports/${filename}`;
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: filename, dialogTitle: "Save or share file", files: [uri] });
    return "shared";
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
 * Hand a file to the platform share sheet.
 *
 * Native: Capacitor Share (same path as deliverFile).
 * Web: navigator.share with files when supported; otherwise falls back to a
 * plain download so the button is never a dead end.
 *
 * Errors propagate — the caller decides what to tell the user.
 */
export async function shareFile(
  filename: string,
  mime: string,
  blob: Blob,
  opts?: { title?: string; text?: string },
): Promise<"shared" | "downloaded"> {
  if (Capacitor.isNativePlatform()) {
    return deliverFile(filename, mime, blob);
  }

  const file = new File([blob], filename, { type: mime });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: opts?.title ?? filename, text: opts?.text });
    return "shared";
  }

  return deliverFile(filename, mime, blob);
}
