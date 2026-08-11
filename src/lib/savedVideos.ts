/**
 * Videos the user has actually saved onto this device.
 *
 * WHY A LOCAL REGISTRY. Saving a Story deletes it from our servers — that is
 * the deal the screen makes before anyone spends their allowance. So once it is
 * saved, the ONLY copy is on the phone, and the server has nothing left to list.
 * If the app forgot about it at that moment, "Your videos" went empty and the
 * film looked lost even though it was sitting in the gallery. This registry is
 * what lets a saved film still be replayed, shared and deleted from inside the
 * app.
 *
 * It stores POINTERS, never bytes: a path we can hand back to a <video> tag and
 * a MediaStore uri for the copy in the gallery. Losing this registry (app data
 * cleared) loses the listing, not the video — the gallery copy is independent
 * and survives, which is the right way round.
 */

export type SavedVideo = {
  /** The story job id it came from — also the de-dup key. */
  id: string;
  /** What the user typed to make it. */
  title: string;
  /** Capacitor Filesystem path of the app-private copy, for in-app replay. */
  path: string;
  /** file:// uri of the app-private copy. */
  uri: string;
  /** MediaStore content:// uri of the gallery copy, when one was made. */
  galleryUri: string | null;
  fileName: string;
  bytes: number;
  savedAt: string;
};

const KEY = "oniq.savedVideos.v1";

function read(): SavedVideo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedVideo[]) : [];
  } catch {
    return [];
  }
}

function write(list: SavedVideo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota or private mode — the file is still on the device, only the
    // listing is lost. Never throw into a save that already succeeded.
  }
}

export function listSavedVideos(): SavedVideo[] {
  return read().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function rememberSavedVideo(v: SavedVideo) {
  const list = read().filter((x) => x.id !== v.id);
  list.unshift(v);
  write(list);
  notify();
}

export function forgetSavedVideo(id: string) {
  write(read().filter((x) => x.id !== id));
  notify();
}

export function getSavedVideo(id: string): SavedVideo | null {
  return read().find((x) => x.id === id) ?? null;
}

/** Lets the library re-render the moment a save lands, without a poll. */
const EVENT = "oniq:saved-videos-changed";
function notify() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // non-browser context
  }
}
export function onSavedVideosChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
