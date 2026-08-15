/**
 * `Filesystem.downloadFile` SILENTLY IGNORES `recursive`.
 *
 * This is not a guess. In @capacitor/filesystem 8.1.2, downloadFile is served
 * by LegacyFilesystemImplementation.doDownloadInBackground, which reads url,
 * headers, params, timeouts, method, path and directory from the call — and
 * never reads `recursive` at all. It resolves the target with getFileObject(),
 * whose only mkdir is on the BASE directory:
 *
 *     if (!androidDirectory.exists()) androidDirectory.mkdir()
 *     return File(androidDirectory, path)
 *
 * filesDir and cacheDir always exist, so that branch never fires, and any
 * subdirectory in `path` is never created. The next line is
 * `FileOutputStream(file, false)`, which throws:
 *
 *     open failed: ENOENT (No such file or directory)
 *
 * Passing `recursive: true` reads as protection and provides none. writeFile
 * and mkdir DO honour it, which is exactly why this is easy to get wrong —
 * the same option on a neighbouring method behaves.
 *
 * MEASURED 2026-08-15, on device, after a clean reinstall: Save reported
 * ENOENT on files/videos/oniq-story-9b222dd9.mp4 and Share failed at the same
 * step on cache/share/. Both had worked before because the directories
 * survived from an earlier install; uninstalling took them, and nothing in the
 * code had ever created them.
 *
 * So the directory is made explicitly, first, every time.
 */
import type { Directory } from "@capacitor/filesystem";

/**
 * Create the directory a file path sits in, if it is not already there.
 *
 * Takes the FILE path (`videos/x.mp4`) and makes its parent (`videos`),
 * because the call sites think in files. A path with no directory part is a
 * no-op rather than an error — writing to the root of Data is legitimate.
 */
export async function ensureParentDir(path: string, directory: Directory): Promise<void> {
  const cut = path.lastIndexOf("/");
  if (cut <= 0) return;
  const parent = path.slice(0, cut);
  const { Filesystem } = await import("@capacitor/filesystem");
  try {
    await Filesystem.mkdir({ path: parent, directory, recursive: true });
  } catch (e) {
    // ALREADY THERE IS THE OUTCOME WE WANTED. Every call after the first hits
    // this, so treating it as a failure would break the working case and
    // leave only the first save alive.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/exist/i.test(msg)) throw e;
  }
}
